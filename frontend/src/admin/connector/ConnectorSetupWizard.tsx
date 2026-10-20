import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { connectorDisableConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import {
  credentialVaultMessage,
  errorMessage,
  mountableDeclaredCount,
  remoteFailureMessage,
  versionConflictMessage,
  type RuntimeConnectorTransport,
  type SkillCoverage,
} from "../../runtimeConnectorUi";
import { ConnectorConfigCard } from "./ConnectorConfigCard";
import { ConnectorIconUpload, HeaderRowsEditor, ModalShell, headerRowsProblem } from "./ConnectorPanels";
import { ConnectorToolsReadOnlyList } from "./ConnectorToolsCard";
import {
  createConnectorRecord,
  errorCodeOf,
  friendlyEnableFailure,
  readConnectorConfigVersion,
  saveConnectorConfigForm,
  type HeaderRow,
} from "./connectorSetup";
import { type ConnectorCardView } from "./entity";
import { useDeclaredToolMount } from "./useDeclaredToolMount";
import { initialWizardStep, type WizardStep } from "./wizardSteps";

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: "save", label: "保存" },
  { id: "test", label: "测试" },
  { id: "tools", label: "工具清单" },
  { id: "enable", label: "启用" },
];

function friendlyProbeFailure(code: string): string {
  if (code === "AbortError" || code === "request_aborted") return "测试已取消或连接中断；请确认服务可访问后重试。";
  if (code === "runtime_connector_disabled") return "连接器已停用，无法测试。请在完成验证后再启用。";
  if (code === "runtime_connector_not_configured") return "尚未保存接入配置。请先保存连接草稿。";
  if (code === "runtime_endpoint_invalid") return "尚未填写 Base URL，或端点无效；请在接入配置中补齐后再测试。";
  const remote = remoteFailureMessage(code);
  if (remote) return remote;
  return code ? `测试未通过；请检查已保存配置后重试（错误码：${code}）。` : "测试未通过；请检查已保存配置后重试。";
}

function formatProbeTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
  const [step, setStep] = useState<WizardStep>(() => initialWizardStep(mode, card));
  const [createdId, setCreatedId] = useState<string | null>(null);
  const id = createdId ?? card?.id ?? null;
  const [saveFooterHost, setSaveFooterHost] = useState<HTMLDivElement | null>(null);

  // Creation fields (docs/DESIGN.md §7.2 连接器设置向导): name / transport / URL / secrets / icon.
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
  // 上次测试的服务端记录：重新打开弹窗时用来还原「测试通过但未启用」的上下文。
  const [lastProbe, setLastProbe] = useState<{ checked_at: string; tool_count: number } | null>(null);
  const [mountGate, setMountGate] = useState<SkillCoverage | null>(null);
  const [mountGateError, setMountGateError] = useState("");

  // 配置模式：内嵌配置卡读回服务端已有版本后回传；不覆盖本会话保存得到的新版本。
  const adoptServerVersion = useCallback((loaded: number) => {
    setVersion((current) => current || loaded);
  }, []);

  const canEnable = Boolean(id) && !enabled && verified && !enableBlocked;
  // 本会话的测试结果优先；重新打开弹窗时回落到服务端记录的上次测试。
  const passedAt = testedAt || lastProbe?.checked_at || "";
  const passedToolCount = toolCount ?? lastProbe?.tool_count ?? null;
  const passedAtLabel = formatProbeTime(passedAt);
  const reachable = (target: WizardStep): boolean => {
    if (target === "save") return true;
    if (!id) return false;
    if (target === "test") return true;
    if (target === "tools") return true;
    return verified;
  };

  // 版本与上次测试都独立于当前步骤读取：弹窗直接落在「启用」时也必须知道服务端已有版本，
  // 否则会把「已有配置」误报成「尚未保存配置」。
  useEffect(() => {
    if (!id || mode !== "configure") return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await api.runtimeConnectorConfig(id);
        if (!cancelled) adoptServerVersion(loaded.version);
      } catch {
        // 读不到就保持 0，界面照实说明，不编版本号。
      }
    })();
    return () => { cancelled = true; };
  }, [id, mode, adoptServerVersion]);

  useEffect(() => {
    if (!id || mode !== "configure") return;
    let cancelled = false;
    void (async () => {
      try {
        const activity = await api.runtimeConnectorActivity(id, 1);
        const probe = activity.probes[0];
        if (!cancelled && probe) setLastProbe({ checked_at: String(probe.checked_at || ""), tool_count: Number(probe.tool_count) || 0 });
      } catch {
        // 读不到历史不影响向导本身；上面会照实写「时间由服务端记录」。
      }
    })();
    return () => { cancelled = true; };
  }, [id, mode]);

  const loadMountGate = useCallback(async () => {
    if (!id) return;
    setMountGateError("");
    try {
      setMountGate(await api.runtimeSkillCoverage(id));
    } catch (cause) {
      setMountGate(null);
      setMountGateError(errorMessage(cause, "无法读取技能挂载情况"));
    }
  }, [id]);

  useEffect(() => {
    if (step === "enable" && id) void loadMountGate();
  }, [step, id, loadMountGate]);

  // 启用闸门的可执行部分：扫描出的已上线技能里，声明了本连接器工具且现在就能挂的那些。
  const gate = useMemo(() => {
    const rows = (mountGate?.skills || []).filter((row) => row.implementation === "live");
    const mounted = rows.reduce((sum, row) => sum + row.mounted_tools, 0);
    const mountable = rows.reduce((sum, row) => sum + mountableDeclaredCount(row), 0);
    const pending = rows.reduce((sum, row) => sum + row.pending_tools, 0);
    const declared = rows.reduce((sum, row) => sum + row.declared_tools, 0);
    return { skills: rows.length, mounted, mountable, skipped: pending - mountable, declared };
  }, [mountGate]);

  const declaredMount = useDeclaredToolMount({
    ask,
    connectorId: id,
    connectorLabel: card?.label || label.trim() || (id ?? ""),
    onDone: async () => {
      setEnableBlocked("");
      await loadMountGate();
      reload?.();
    },
  });

  const stepBodyRef = useRef<HTMLElement | null>(null);

  // 切步后焦点落到该步内容，键盘与读屏用户不用再 Tab 过步骤条。
  useEffect(() => {
    stepBodyRef.current?.focus({ preventScroll: true });
  }, [step]);

  const statusLine = useMemo(() => {
    if (!id) return "尚未保存：保存后连接器为待验证状态，不会自动启用。";
    if (enabled) return "已启用：调用仍受平台校验与技能挂载约束。";
    if (!verified) {
      if (!version) return "尚未通过测试：启用前需要一次通过的测试。";
      return savedInSession
        ? `配置已保存（版本 ${version}）；改动后需重新测试才能启用。`
        : `配置已保存（版本 ${version}），尚未通过测试；启用前需要一次通过的测试。`;
    }
    // 测试时间已在下一条事实里给出，这里不重复，避免同一行出现两次时间。
    return "已验证通过，可以启用。";
  }, [enabled, id, passedAt, savedInSession, verified, version]);

  // 启用步的横幅标题已经写明「已启用」/「待启用」，正文只补一句后果，避免同一事实说两遍。
  const enableDetail = enabled
    ? "调用仍需平台校验与技能挂载。"
    : verified
      ? "最近一次测试已通过，可以启用。"
      : statusLine;

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
      const savedConfig = await api.runtimeConnectorConfig(targetId);
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
      setLastProbe({ checked_at: result.checked_at || "", tool_count: result.tool_count });
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
        ? "连接器已启用；调用仍需当前 Agent 使用资格与技能挂载。"
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
      onDone("连接器已启用；调用仍需当前 Agent 使用资格与技能挂载。");
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
    const note = (text: ReactNode) => <p className="connector-panel-note connector-wizard-foot-note">{text}</p>;
    const actions = (children: ReactNode) => <div className="connector-wizard-foot-actions">{children}</div>;

    if (step === "save") {
      if (mode === "configure") {
        return <div ref={setSaveFooterHost} className="connector-config-save-footer" data-connector-config-save-footer />;
      }
      return (
        <>
          {note("保存后可立即测试。")}
          {actions(
            <button
              type="button"
              className="btn work"
              data-connector-panel-save
              data-connector-wizard-primary
              disabled={busy === "save"}
              onClick={() => void save()}
            >
              {busy === "save" ? "保存中…" : "保存"}
            </button>,
          )}
        </>
      );
    }
    if (step === "test") {
      return (
        <>
          {note("测试只校验工具目录，不代表业务动作可用。")}
          {actions(<>
            <button type="button" className="btn text" disabled={busy === "test"} onClick={() => setStep("save")}>上一步</button>
            <button
              type="button"
              className="btn work"
              data-connector-wizard-test
              data-connector-wizard-primary
              disabled={busy === "test" || !id}
              title={!id ? "尚未保存连接，无法测试" : undefined}
              onClick={() => void test()}
            >
              {busy === "test" ? "测试中…" : "运行测试"}
            </button>
          </>)}
        </>
      );
    }
    if (step === "tools") {
      return (
        <>
          {note("这一步不会改变连接器状态。")}
          {actions(<>
            <button type="button" className="btn text" disabled={busy === "test"} onClick={() => setStep("test")}>上一步</button>
            <button type="button" className="btn work" data-connector-wizard-primary onClick={() => setStep("enable")}>下一步：启用</button>
          </>)}
        </>
      );
    }
    return (
      <>
        {note(enableBlocked || (enabled ? "关闭窗口不会改变连接器状态。" : "启用后调用仍需技能挂载。"))}
        {actions(<>
          <button type="button" className="btn text" disabled={busy === "enable"} onClick={() => setStep("tools")}>上一步</button>
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
        </>)}
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
        {STEPS.map((entry, index, visibleSteps) => {
          const done = index < visibleSteps.findIndex((item) => item.id === step);
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={"connector-wizard-step" + (step === entry.id ? " on" : "") + (done ? " done" : "")}
                data-connector-wizard-tab={entry.id}
                aria-current={step === entry.id ? "step" : undefined}
                disabled={!reachable(entry.id)}
                title={reachable(entry.id) ? undefined : "先保存连接，才能进入这一步"}
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

      {/* 状态与最近一次测试压成两行事实；启用步收进信息页，避免同粒度重复。 */}
      {step !== "enable" && (
        <div className="connector-wizard-facts-line">
          <p className="connector-wizard-status" data-connector-wizard-status role="status">{statusLine}</p>
          {verified ? (
            <p className="connector-wizard-test" data-connector-wizard-test-result role="status">
              测试通过 · {passedAtLabel || "时间由服务端记录"}{passedToolCount === null ? "" : ` · ${passedToolCount} 个工具`}{testNotice ? ` · ${testNotice}` : ""}
            </p>
          ) : (
            <p className="connector-wizard-test" data-connector-wizard-test-result>
              {version ? `当前配置版本 ${version}，尚未通过测试。` : "尚未保存配置，无法测试。"}
            </p>
          )}
        </div>
      )}
      {error && <p className="error" role="alert" data-connector-wizard-error>{error}</p>}

      {step === "save" && (
      <section data-connector-wizard-step="save" className="connector-wizard-step-body" tabIndex={-1} ref={stepBodyRef}>
        <div className="connector-wizard-step-head">
          <h3 className="connector-wizard-step-title">接入配置</h3>
          <span className="connector-wizard-step-hint">保存只生成待验证草稿，不影响线上调用</span>
        </div>
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
            <label className="field">服务器 URL
              <input value={url} placeholder="https://mcp.yourserver.com/mcp" data-connector-field="url" onChange={(event) => setUrl(event.target.value)} />
            </label>
            <div className="field"><span>图标<span className="field-optional">（可选）</span></span><ConnectorIconUpload variant="dialog" file={iconFile} onPick={setIconFile} /></div>
            <label className="field"><span>备注<span className="field-optional">（可选）</span></span>
              <textarea value={purpose} rows={3} maxLength={280} placeholder="说明它提供哪些数据、什么时候该用" onChange={(event) => setPurpose(event.target.value)} />
            </label>
            <div className="field"><span>自定义 headers<span className="field-optional">（可选）</span></span>
              <HeaderRowsEditor rows={headers} onChange={setHeaders} disabled={busy === "save"} />
            </div>
            <label className="check"><input type="checkbox" checked={noAuth} onChange={(event) => setNoAuth(event.target.checked)} /> 该端点明确允许无鉴权</label>
          </>
        ) : card ? (
          <ConnectorConfigCard
            card={card}
            reload={() => reload?.()}
            embedded
            saveFooterHost={saveFooterHost}
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
      <section data-connector-wizard-step="test" className="connector-wizard-step-body" tabIndex={-1} ref={stepBodyRef}>
        <div className="connector-wizard-step-head">
          <h3 className="connector-wizard-step-title">连通性测试</h3>
          <span className="connector-wizard-step-hint">约 1–3 秒 · 只读</span>
        </div>
        <ul className="connector-wizard-checks">
          <li>调用远端 <code>tools/list</code>，读取工具目录</li>
          <li>不写入、不采集，也不执行任何工具</li>
          <li>结论只代表当前身份的目录可见性</li>
        </ul>
      </section>
      )}

      {step === "tools" && (
      <section data-connector-wizard-step="tools" className="connector-wizard-step-body" tabIndex={-1} ref={stepBodyRef}>
        <div className="connector-wizard-step-head">
          <h3 className="connector-wizard-step-title">工具清单</h3>
          <span className="connector-wizard-step-hint">只读；能否调用由技能挂载决定</span>
          <button type="button" className="btn sm connector-wizard-tools-open" data-connector-wizard-tools-open onClick={() => setToolsRequestKey((value) => value + 1)}>
            {toolsRequestKey ? "重新读取" : "读取工具清单"}
          </button>
        </div>
        {id
          ? <ConnectorToolsReadOnlyList connectorId={id} requestKey={toolsRequestKey} autoLoad={false} filterable showSchema={false} />
          : <p className="muted">尚未保存连接，暂无工具清单。</p>}
      </section>
      )}

      {step === "enable" && (
      <section data-connector-wizard-step="enable" className="connector-enable-info connector-wizard-step-body" tabIndex={-1} ref={stepBodyRef} aria-label="启用信息">
        {/* 状态横幅：标题即结论，正文只补一句后果。 */}
        <div
          className={"enable-alert" + (enabled ? " is-success" : " is-info")}
          data-connector-wizard-status
          role="status"
        >
          <span className="enable-alert-icon" aria-hidden="true">
            {enabled ? (
              <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.4 8.3l1.9 1.9 3.3-3.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 7.4v3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="5.2" r="0.9" fill="currentColor" /></svg>
            )}
          </span>
          <div className="enable-alert-main">
            <strong>{enabled ? "连接器已启用" : "连接器待启用"}</strong>
            <span>{enableDetail}</span>
          </div>
        </div>
        {/* 测试结论：一行事实，长解释走 tooltip。 */}
        {verified ? (
          <div className="enable-alert is-success enable-test-result" data-connector-wizard-test-result role="status">
            <span className="enable-alert-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.4 8.3l1.9 1.9 3.3-3.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div className="enable-alert-main">
              <strong>测试通过</strong>
              <span className="enable-test-result-copy" title="仅验证该身份的 MCP 工具目录，不代表业务动作或其他账号可用。">
                {passedAtLabel || "时间由服务端记录"}{passedToolCount === null ? "" : ` · ${passedToolCount} 个工具`}{testNotice ? ` · ${testNotice}` : ""}
              </span>
            </div>
          </div>
        ) : (
          <div className="enable-alert is-warn enable-test-result" data-connector-wizard-test-result role="status">
            <span className="enable-alert-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d="M8 2.2L14.6 13.4H1.4L8 2.2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 6.4v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="11.2" r="0.9" fill="currentColor" /></svg>
            </span>
            <div className="enable-alert-main">
              <strong>尚未通过测试</strong>
              <span>{version ? `当前配置版本 ${version}，尚未通过测试。` : "尚未保存配置，无法测试。"}</span>
            </div>
          </div>
        )}
        {/* 事实区：状态 / 时间 / 挂载进度 / 声明数，规则单独说明。 */}
        <dl className="enable-facts" aria-label="连接器基本信息">
          <div className="enable-facts-item">
            <dt>当前状态</dt>
            <dd><span className={"admin-status enable-status-mark is-" + (enabled ? "enabled" : "disabled")}><span className="admin-status-icon" aria-hidden="true">{enabled ? "✓" : "!"}</span>{enabled ? "已启用" : "未启用"}</span></dd>
          </div>
          <div className="enable-facts-item">
            <dt>已验证</dt>
            <dd>{verified ? "最近一次测试通过" : "未验证"}</dd>
          </div>
          <div className="enable-facts-item">
            <dt>测试时间</dt>
            <dd>{passedAtLabel || "—"}</dd>
          </div>
          <div className="enable-facts-item">
            <dt>挂载进度</dt>
            <dd>
              <span className="enable-progress">
                <span className="enable-progress-track" aria-hidden="true">
                  <i style={{ width: `${gate.declared ? Math.round((gate.mounted / gate.declared) * 100) : 0}%` }} />
                </span>
                <span>已挂 {gate.mounted}/{gate.declared} 个</span>
              </span>
            </dd>
          </div>
          <div className="enable-facts-item">
            <dt>技能声明</dt>
            <dd>{gate.skills} 个已上线技能声明了它的工具</dd>
          </div>
          <div className="enable-facts-item">
            <dt>启用条件</dt>
            <dd>至少一个技能把它的工具挂到可用状态</dd>
          </div>
        </dl>
        {/* 启用闸门里唯一还需要人做的一步：把工具挂到技能上。 */}
        <div className="enable-mount" data-connector-wizard-mount>
          {mountGateError && <p className="enable-mount-summary" data-connector-wizard-mount-summary>技能挂载情况未读取：{mountGateError}</p>}
          <div className="enable-mount-actions">
            <button
              type="button"
              className="btn"
              data-connector-wizard-mount-declared
              disabled={declaredMount.busy || !id || gate.mountable === 0}
              title={gate.mountable === 0 ? "没有可自动挂载的声明工具：先完成测试登记工具，或去技能页逐项选择" : undefined}
              onClick={declaredMount.mount}
            >
              {declaredMount.busy ? "挂载中…" : "按技能定义挂载工具"}
            </button>
            <Link className="btn text" to="/admin/skills">去技能页挂载</Link>
            <span className="muted">只挂技能定义里已启用的工具，不改连接器状态。</span>
          </div>
          {declaredMount.receipt && <p className="runtime-notice" role="status" data-connector-wizard-mount-receipt>{declaredMount.receipt}现在可以启用连接器。</p>}
          {declaredMount.failure && <p className="error" role="alert" data-connector-wizard-mount-error>{declaredMount.failure}</p>}
        </div>
        {/* 危险动作独立成区，与普通链接分开。 */}
        {enabled && id && (
          <div className="enable-danger">
            <span className="enable-danger-hint">停用后调用立即失效，重新启用需再次通过测试。</span>
            <button
              type="button"
              className="btn text danger"
              data-connector-wizard-disable
              disabled={busy === "enable"}
              onClick={() => ask(connectorDisableConfirm(card?.label || label.trim() || id, id), () => setConnectorEnabled(false))}
            >
              停用连接器
            </button>
          </div>
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
