import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { connectorDisableConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import {
  credentialVaultMessage,
  errorMessage,
  remoteFailureMessage,
  versionConflictMessage,
  type RuntimeConnectorTransport,
} from "../../runtimeConnectorUi";
import { ConnectorConfigCard } from "./ConnectorConfigCard";
import { ConnectorIconUpload, HeaderRowsEditor, ModalShell, headerRowsProblem } from "./ConnectorPanels";
import { ConnectorToolsReadOnlyList } from "./ConnectorToolsCard";
import {
  createConnectorRecord,
  errorCodeOf,
  readConnectorConfigVersion,
  saveConnectorConfigForm,
  type HeaderRow,
} from "./connectorSetup";
import { connectorHref, type ConnectorCardView } from "./entity";

type WizardStep = "save" | "test" | "tools" | "enable";

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: "save", label: "保存" },
  { id: "test", label: "测试" },
  { id: "tools", label: "工具清单" },
  { id: "enable", label: "启用" },
];

/** The server's own gate, in the user's words. Unknown codes are shown verbatim. */
export function friendlyEnableFailure(code: string): string {
  if (code === "connector_verification_required") return "先完成一次通过的测试，连接器才会被允许启用。";
  if (code === "connector_skill_binding_required") return "尚无技能绑定其工具，请先在技能页挂载。";
  return "";
}

function friendlyProbeFailure(code: string): string {
  if (code === "AbortError" || code === "request_aborted") return "测试已取消或连接中断；请确认服务可访问后重试。";
  if (code === "runtime_connector_disabled") return "连接器已停用，无法测试。请在完成验证后再启用。";
  if (code === "runtime_connector_not_configured") return "尚未保存接入配置。请先保存连接草稿。";
  if (code === "runtime_endpoint_invalid") return "尚未填写 Base URL，或端点无效；请在接入配置中补齐后再测试。";
  const remote = remoteFailureMessage(code);
  if (remote) return remote;
  return code ? `测试未通过；请检查已保存配置后重试（错误码：${code}）。` : "测试未通过；请检查已保存配置后重试。";
}

/**
 * Connection setup wizard: 保存 → 测试 → 工具清单（只读）→ 启用.
 * One solid main action per step; every write keeps its own side effect and
 * receipt (保存 / 测试 / 启用 are never merged). Authorization is not part of
 * this dialog — tools become reachable by mounting them onto a skill.
 */
export function ConnectorSetupWizard({ mode, card, headerExtra, onClose, onDone, reload }: {
  mode: "create" | "configure";
  /** Required in `configure` mode: the connector being configured. */
  card?: ConnectorCardView;
  headerExtra?: ReactNode;
  onClose: () => void;
  onDone: (message: string, tone?: "ok" | "warn") => void;
  reload?: () => void;
}) {
  const { ask, dialog } = useAdminConfirm();
  const [step, setStep] = useState<WizardStep>("save");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const id = createdId ?? card?.id ?? null;

  // Creation fields (docs/DESIGN.md §连接器控制台): name / transport / URL / secrets / icon.
  const [label, setLabel] = useState("");
  const [transport, setTransport] = useState<RuntimeConnectorTransport>("streamable-http");
  const [purpose, setPurpose] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([{ name: "", value: "" }]);
  const [noAuth, setNoAuth] = useState(false);
  const [iconFile, setIconFile] = useState<File | null>(null);

  const [version, setVersion] = useState(0);
  // `verified` = 最近一次测试通过且配置此后未改动；改动后立即回到待验证。
  const [verified, setVerified] = useState(mode === "configure" && (card?.status === "verified" || Boolean(card?.enabled)));
  const [testedAt, setTestedAt] = useState("");
  const [testNotice, setTestNotice] = useState("");
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(Boolean(card?.enabled));
  const [savedInSession, setSavedInSession] = useState(false);
  const [enableBlocked, setEnableBlocked] = useState("");
  const [toolsRequestKey, setToolsRequestKey] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");

  // 配置模式：内嵌配置卡读回服务端已有版本后回传；不覆盖本会话保存得到的新版本。
  const adoptServerVersion = useCallback((loaded: number) => {
    setVersion((current) => current || loaded);
  }, []);

  const canEnable = Boolean(id) && !enabled && verified && !enableBlocked;
  const reachable = (target: WizardStep): boolean => {
    if (target === "save") return true;
    if (!id) return false;
    if (target === "test" || target === "tools") return true;
    return verified;
  };

  const statusLine = useMemo(() => {
    if (!id) return "尚未保存：保存后连接器为待验证状态，不会自动启用。";
    if (enabled) return "已启用：调用仍受平台校验与技能挂载约束。";
    if (!verified) {
      if (!version) return "尚未通过测试：启用前需要一次通过的测试。";
      return savedInSession
        ? `配置已保存（版本 ${version}）；改动后需重新测试才能启用。`
        : `配置已保存（版本 ${version}），尚未通过测试；启用前需要一次通过的测试。`;
    }
    return testedAt ? `测试通过于 ${testedAt}；可启用连接器。` : "测试已通过；可启用连接器。";
  }, [enabled, id, savedInSession, testedAt, verified, version]);

  const rememberSave = (savedVersion: number, message: string) => {
    setVersion(savedVersion);
    setSavedInSession(true);
    setVerified(false);
    setTestedAt("");
    setTestNotice("");
    setToolCount(null);
    setEnableBlocked("");
    setIconFile(null);
    setReceipt(message);
    setStep("test");
    reload?.();
  };

  const save = async () => {
    const problems: string[] = [];
    if (!label.trim()) problems.push("请填写服务器名称。");
    if (!/^https?:\/\//.test(url.trim())) problems.push("服务器 URL 需要以 http:// 或 https:// 开头。");
    const headerProblem = headerRowsProblem(headers);
    if (headerProblem) problems.push(headerProblem);
    if (!headers.some((row) => row.name.trim() && row.value.trim()) && !noAuth) {
      problems.push("至少填写一个请求头密钥，或勾选「该端点明确无鉴权」。");
    }
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setBusy("save");
    setError("");
    setReceipt("");
    const name = label.trim();
    try {
      const targetId = createdId ?? await createConnectorRecord(name, purpose.trim() || "待补充业务用途");
      // Re-saving must read the stored version back; a fresh record starts at 0.
      const currentVersion = createdId ? await readConnectorConfigVersion(targetId) : 0;
      const savedVersion = await saveConnectorConfigForm({
        id: targetId,
        label: name,
        protocol: "mcp",
        transport,
        url: url.trim(),
        noAuth,
        headerRows: headers,
        iconFile,
      }, currentVersion);
      const firstSave = !createdId;
      setCreatedId(targetId);
      rememberSave(
        savedVersion,
        firstSave
          ? `保存成功：已生成待验证草稿（配置版本 ${savedVersion}，当前未启用）；下一步测试。`
          : `保存成功：配置已更新（版本 ${savedVersion}）；改动后需重新测试才能启用。`,
      );
    } catch (cause) {
      setError(versionConflictMessage(cause) || errorMessage(cause, "连接器未保存"));
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    if (!id) return;
    setBusy("test");
    setError("");
    setReceipt("");
    try {
      const result = await api.probeRuntimeConnector(id);
      setVerified(true);
      setTestedAt(result.checked_at || "");
      setTestNotice(result.notice || "");
      setToolCount(result.tool_count);
      setEnableBlocked("");
      setReceipt(`测试通过：发现 ${result.tool_count} 个工具。`);
      setStep("tools");
      // 测试通过会把服务端状态改为「已验证」，列表立即刷新，卡片不必等关闭弹窗。
      reload?.();
    } catch (cause) {
      const code = errorCodeOf(cause);
      setVerified(false);
      setTestedAt("");
      setError(credentialVaultMessage(cause) || friendlyProbeFailure(code));
      // 失败的测试同样写入服务端状态（验证失败/最近错误），列表一并刷新。
      reload?.();
    } finally {
      setBusy("");
    }
  };

  const setConnectorEnabled = async (next: boolean) => {
    if (!id) return;
    setBusy("enable");
    setError("");
    setReceipt("");
    try {
      await api.adminSave(`/api/admin/connectors/${encodeURIComponent(id)}`, { enabled: next }, "PATCH");
      setEnabled(next);
      if (next) setEnableBlocked("");
      setReceipt(next
        ? "连接器已启用。下一步在技能页把它的工具挂载到技能：授权只对技能。"
        : "连接器已停用；重新测试通过后可再次启用。");
      reload?.();
    } catch (cause) {
      const code = errorCodeOf(cause);
      const friendly = friendlyEnableFailure(code);
      if (next && code === "connector_skill_binding_required") {
        setEnableBlocked(friendly || "尚无技能绑定其工具，请先在技能页挂载。");
      }
      setError(friendly || errorMessage(cause, "连接器状态未更新"));
    } finally {
      setBusy("");
    }
  };

  const finish = () => {
    if (enabled) {
      onDone("连接器已启用；请在技能页把它的工具挂载到技能。");
      return;
    }
    // 只有本次会话真的保存过，才回执版本；否则只是关闭，不伪造状态。
    if (savedInSession) {
      const name = card?.label || label.trim() || id;
      onDone(verified
        ? `“${name}”已通过测试（配置版本 ${version}）；尚未启用。`
        : `“${name}”为待验证状态（配置版本 ${version}）；尚未启用。`);
      return;
    }
    onClose();
  };

  const stepFooter = (() => {
    if (step === "save") {
      if (mode === "configure") {
        return <p className="connector-panel-note muted">保存只更新配置并回到待验证；启用前需要一次通过的测试。</p>;
      }
      return (
        <>
          <p className="connector-panel-note muted">保存只生成待验证草稿，不等于启用。</p>
          <button
            type="button"
            className="btn work"
            data-connector-panel-save
            data-connector-wizard-primary
            disabled={busy === "save"}
            onClick={() => void save()}
          >
            {busy === "save" ? "保存中…" : "保存"}
          </button>
        </>
      );
    }
    if (step === "test") {
      return (
        <>
          <p className="connector-panel-note muted">测试只验证工具目录，不代表业务动作可用。</p>
          <button type="button" className="btn" disabled={busy === "test"} onClick={() => setStep("save")}>上一步</button>
          <button
            type="button"
            className="btn work"
            data-connector-wizard-test
            data-connector-wizard-primary
            disabled={busy === "test" || !id}
            onClick={() => void test()}
          >
            {busy === "test" ? "测试中…" : "运行测试"}
          </button>
        </>
      );
    }
    if (step === "tools") {
      return (
        <>
          <p className="connector-panel-note muted">清单只读；是否可用由平台校验与技能挂载决定。</p>
          <button type="button" className="btn" disabled={busy === "test"} onClick={() => setStep("test")}>上一步</button>
          <button type="button" className="btn work" data-connector-wizard-primary onClick={() => setStep("enable")}>下一步：启用</button>
        </>
      );
    }
    return (
      <>
        <p className="connector-panel-note muted">{enableBlocked || "启用后仍受平台校验与技能挂载约束。"}</p>
        <button type="button" className="btn" disabled={busy === "enable"} onClick={() => setStep("tools")}>上一步</button>
        {enabled ? (
          <button type="button" className="btn work" data-connector-wizard-primary onClick={finish}>完成</button>
        ) : (
          <button
            type="button"
            className="btn work"
            data-connector-wizard-enable
            data-connector-wizard-primary
            disabled={busy === "enable" || !canEnable}
            title={canEnable ? undefined : enableBlocked || "需先通过测试"}
            onClick={() => void setConnectorEnabled(true)}
          >
            {busy === "enable" ? "启用中…" : "启用连接器"}
          </button>
        )}
      </>
    );
  })();

  return (
    <ModalShell
      kind={mode === "create" ? "mcp-config" : "connector-config"}
      form
      title={mode === "create" ? "MCP 配置" : card?.label || "连接器配置"}
      headerExtra={headerExtra}
      onClose={finish}
      footer={stepFooter}
    >
      {dialog}
      {/* 回执常驻对话框顶部：保存 / 测试 / 启用的结果先于步骤被看到。 */}
      {receipt && (
        <p className="admin-receipt status-ok connector-wizard-receipt" role="status" data-connector-wizard-receipt>
          {receipt}
        </p>
      )}
      <ol className="connector-wizard-steps" data-connector-wizard-steps aria-label="连接器设置步骤">
        {STEPS.map((entry, index) => {
          const done = index < STEPS.findIndex((item) => item.id === step);
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={"connector-wizard-step" + (step === entry.id ? " on" : "")}
                data-connector-wizard-tab={entry.id}
                aria-current={step === entry.id ? "step" : undefined}
                disabled={!reachable(entry.id)}
                onClick={() => setStep(entry.id)}
              >
                <span className="connector-wizard-step-n" aria-hidden>{done ? "✓" : index + 1}</span>
                {entry.label}
                {done && <span className="sr-only">（已完成）</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="connector-wizard-status" data-connector-wizard-status role="status">{statusLine}</p>
      {/* 测试结果常驻：切到工具清单/启用步后仍能看到上一次测试的结论与免责声明。 */}
      {verified ? (
        <p className="runtime-notice" data-connector-wizard-test-result role="status">
          测试通过（{testedAt || "时间由服务端记录"}{toolCount === null ? "" : ` · ${toolCount} 个工具`}）。{testNotice}
        </p>
      ) : (
        <p className="muted" data-connector-wizard-test-result>
          {version ? `当前配置版本 ${version}，尚未通过测试。` : "尚未保存配置，无法测试。"}
        </p>
      )}
      {error && <p className="error" role="alert" data-connector-wizard-error>{error}</p>}

      {step === "save" && (
      <section data-connector-wizard-step="save">
        {mode === "create" ? (
          <>
            <div className="connector-form-grid">
              <label className="field">服务器名称
                <input value={label} placeholder="e.g., My Custom Server" maxLength={120} data-connector-field="label" onChange={(event) => setLabel(event.target.value)} />
              </label>
              <label className="field">传输类型
                <select value={transport} data-connector-field="transport" onChange={(event) => setTransport(event.target.value as RuntimeConnectorTransport)}>
                  <option value="streamable-http">HTTP</option>
                  <option value="sse">SSE</option>
                </select>
              </label>
            </div>
            <div className="field">图标<ConnectorIconUpload variant="dialog" file={iconFile} onPick={setIconFile} /></div>
            <label className="field"><span>备注<span className="field-optional">（可选）</span></span>
              <textarea value={purpose} rows={5} maxLength={280} placeholder="提供 MCP 文档或说明，以告知平台如何及何时使用此 MCP" onChange={(event) => setPurpose(event.target.value)} />
            </label>
            <label className="field">服务器 URL
              <input value={url} placeholder="https://mcp.yourserver.com/mcp" data-connector-field="url" onChange={(event) => setUrl(event.target.value)} />
            </label>
            <div className="field"><span>自定义 headers<span className="field-optional">（可选）</span></span><HeaderRowsEditor rows={headers} onChange={setHeaders} disabled={busy === "save"} /></div>
            <label className="check"><input type="checkbox" checked={noAuth} onChange={(event) => setNoAuth(event.target.checked)} /> 该端点明确允许无鉴权</label>
          </>
        ) : card ? (
          <ConnectorConfigCard
            card={card}
            reload={() => reload?.()}
            embedded
            onLoaded={adoptServerVersion}
            onSaved={(savedVersion) => rememberSave(
              savedVersion,
              `保存成功：配置已更新（版本 ${savedVersion}）；改动后需重新测试才能启用。`,
            )}
          />
        ) : null}
      </section>
      )}

      {step === "test" && (
      <section data-connector-wizard-step="test">
        <p className="muted">测试会真打远端 MCP 的 <code>tools/list</code>，只验证工具目录，不代表业务动作或其他账号可用。</p>
      </section>
      )}

      {step === "tools" && (
      <section data-connector-wizard-step="tools">
        <p className="muted">从服务端读取工具清单：工具名、描述与平台记录的风险档，全部只读。</p>
        <button type="button" className="btn" data-connector-wizard-tools-open onClick={() => setToolsRequestKey((value) => value + 1)}>
          {toolsRequestKey ? "重新读取工具清单" : "读取工具清单"}
        </button>
        {id
          ? <ConnectorToolsReadOnlyList connectorId={id} requestKey={toolsRequestKey} autoLoad={false} />
          : <p className="muted">尚未保存连接，暂无工具清单。</p>}
      </section>
      )}

      {step === "enable" && (
      <section data-connector-wizard-step="enable">
        <ul className="muted connector-wizard-gates">
          <li>{verified ? "已验证：最近一次测试通过。" : "未验证：需要一次通过的测试。"}</li>
          <li>已被技能绑定其工具：{enableBlocked ? "尚未满足，请先在技能页挂载。" : "由平台在启用时校验。"}</li>
          <li>{enabled ? "当前状态：已启用。" : "当前状态：未启用。"}</li>
        </ul>
        <div className="connector-wizard-actions">
          <Link className="btn sm" to={id ? connectorHref(id) : "/admin/connectors"}>查看详情与审计</Link>
          <Link className="btn sm" to="/admin/skills">去技能页挂载</Link>
        </div>
        {enabled && id && (
          <button
            type="button"
            className="btn"
            data-connector-wizard-disable
            disabled={busy === "enable"}
            onClick={() => ask(connectorDisableConfirm(card?.label || label.trim() || id, id), () => setConnectorEnabled(false))}
          >
            停用连接器
          </button>
        )}
      </section>
      )}
    </ModalShell>
  );
}

/** Creation entry kept as its own component so the hub keeps one import. */
export function McpConfigPanel({ onClose, onDone, reload }: {
  onClose: () => void;
  onDone: (message: string, tone?: "ok" | "warn") => void;
  reload?: () => void;
}) {
  return <ConnectorSetupWizard mode="create" onClose={onClose} onDone={onDone} reload={reload} />;
}
