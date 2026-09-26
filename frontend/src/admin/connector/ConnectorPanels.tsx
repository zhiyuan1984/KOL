import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { useFocusLock } from "../../hooks/useFocusLock";
import {
  errorMessage,
  type McpImportPreview,
  type McpImportResult,
  type RuntimeConnectorConfig,
  type RuntimeConnectorTransport,
} from "../../runtimeConnectorUi";
import { isConnectorIdValid, slugFromLabel } from "./entity";

export type HeaderRow = { name: string; value: string };

const RESERVED_HEADERS = new Set([
  "content-length", "host", "connection", "transfer-encoding", "upgrade", "keep-alive", "proxy-connection",
]);
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_ICON_BYTES = 1024 * 1024;

export function validateHeaderName(name: string): string {
  if (!HEADER_NAME.test(name)) return "请求头名称只能包含 token 字符（字母、数字与 !#$%&'*+-.^_`|~）。";
  if (RESERVED_HEADERS.has(name.toLowerCase())) return "该请求头由传输层保留，不能自定义。";
  return "";
}

export function validateIconFile(file: File): string {
  if (file.type !== "image/png" && file.type !== "image/jpeg") return "仅支持 PNG 或 JPG 图标。";
  if (file.size > MAX_ICON_BYTES) return "图标不能超过 1 MB。";
  return "";
}

export function ModalShell({ kind, title, subtitle, onClose, children, footer }: {
  kind: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useFocusLock({ open: true, rootRef: ref, onEscape: onClose, lockBody: true, restore: true });
  return createPortal(
    <div className="connector-panel-layer" data-connector-panel={kind}>
      <div className="connector-panel-backdrop" onClick={onClose} />
      <div ref={ref} className="connector-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="connector-panel-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" data-connector-panel-close onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="connector-panel-body">{children}</div>
        {footer && <footer className="connector-panel-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConnectorIconUpload({ file, existingUrl, onPick }: { file: File | null; existingUrl?: string | null; onPick: (file: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState("");
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const shown = preview || existingUrl || "";
  return (
    <div className="connector-icon-field">
      <span className="connector-icon-preview" data-connector-icon-preview>
        {shown ? <img src={shown} alt="图标预览" /> : <span className="muted" aria-hidden>图</span>}
      </span>
      <div className="connector-icon-actions">
        <button type="button" className="btn sm" onClick={() => inputRef.current?.click()}>上传</button>
        {file && <button type="button" className="btn sm" onClick={() => { onPick(null); if (inputRef.current) inputRef.current.value = ""; }}>移除</button>}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          data-connector-icon-input
          onChange={(event) => {
            const picked = event.target.files?.[0] || null;
            if (!picked) return;
            const problem = validateIconFile(picked);
            setLocalError(problem);
            onPick(problem ? null : picked);
          }}
        />
        <p className="muted">PNG 或 JPG，最大 1 MB。推荐尺寸 256×256 像素。</p>
        {localError && <p className="error" role="alert">{localError}</p>}
      </div>
    </div>
  );
}

export function HeaderRowsEditor({ rows, onChange, disabled }: { rows: HeaderRow[]; onChange: (rows: HeaderRow[]) => void; disabled?: boolean }) {
  const update = (index: number, patch: Partial<HeaderRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  return (
    <div className="connector-header-rows" data-connector-header-rows>
      {rows.map((row, index) => (
        <div className="connector-header-row" key={index}>
          <input
            className="connector-header-name"
            value={row.name}
            placeholder="Header 名称"
            aria-label="Header 名称"
            disabled={disabled}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <input
            className="connector-header-value"
            value={row.value}
            placeholder="Header 值"
            aria-label="Header 值"
            type="password"
            autoComplete="new-password"
            disabled={disabled}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <button
            type="button"
            className="icon-btn danger"
            aria-label="删除这一行"
            disabled={disabled || rows.length <= 1}
            onClick={() => onChange(rows.filter((_, position) => position !== index))}
          >
            <svg viewBox="0 0 16 16" aria-hidden><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      ))}
      <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange([...rows, { name: "", value: "" }])} data-connector-header-add>
        + 添加自定义 header
      </button>
      <p className="muted">值将加密写入凭据保险库，保存后不回显；填 <code>cred_…</code> 可直接引用既有凭据。</p>
    </div>
  );
}

export function headerRowsProblem(rows: HeaderRow[]): string {
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const problem = validateHeaderName(name);
    if (problem) return problem;
    if (!row.value.trim()) return `请求头 ${name} 还没有填写值；请填写，或删除该行。`;
  }
  return "";
}

export async function resolveHeaderRefs(rows: HeaderRow[], label: string): Promise<Record<string, string>> {
  const refs: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (!name || !value) continue;
    if (value.startsWith("cred_")) {
      refs[name] = value;
      continue;
    }
    const created = await api.createRuntimeCredential({
      type: "organization_secret",
      label: `${label} · ${name}`,
      purpose: "由连接器配置表单写入",
      secret: value,
    });
    refs[name] = created.id;
  }
  return refs;
}

async function createManagedMcp(input: {
  id: string;
  label: string;
  purpose: string;
  transport: RuntimeConnectorTransport;
  url: string;
  noAuth: boolean;
  timeoutMs: number;
  headerRows: HeaderRow[];
  iconFile: File | null;
}): Promise<string> {
  await api.adminSave("/api/admin/connectors", { id: input.id, label: input.label, purpose: input.purpose }, "POST");
  const refs = await resolveHeaderRefs(input.headerRows, input.label);
  const config: RuntimeConnectorConfig & { expected_version: number } = {
    protocol: "mcp",
    transport: input.transport,
    url: input.url,
    allow_unauthenticated: input.noAuth,
    timeout_ms: input.timeoutMs,
    expected_version: 0,
  };
  if (Object.keys(refs).length) config.headers_secret_refs = refs;
  await api.saveRuntimeConnectorConfig(input.id, config);
  if (input.iconFile) {
    try {
      await api.uploadConnectorIcon(input.id, input.iconFile);
    } catch {
      // The connector itself is created; icon upload can be retried from the detail page.
    }
  }
  return input.id;
}

export function McpConfigPanel({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [transport, setTransport] = useState<RuntimeConnectorTransport>("streamable-http");
  const [purpose, setPurpose] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([{ name: "", value: "" }]);
  const [noAuth, setNoAuth] = useState(false);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const effectiveId = idTouched ? id : slugFromLabel(label);
  const submit = async () => {
    const problems: string[] = [];
    if (!label.trim()) problems.push("请填写服务器名称。");
    if (!isConnectorIdValid(effectiveId)) problems.push("短名需要以小写字母开头，仅含小写字母、数字、- 或 _，至少 3 个字符。");
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
    setBusy(true);
    setError("");
    try {
      await createManagedMcp({
        id: effectiveId,
        label: label.trim(),
        purpose: purpose.trim() || "待补充业务用途",
        transport,
        url: url.trim(),
        noAuth,
        timeoutMs: 30_000,
        headerRows: headers,
        iconFile,
      });
      onDone(`已将“${label.trim()}”加入连接器目录；下一步在详情中测试并审阅接口。`);
    } catch (cause) {
      setError(errorMessage(cause, "创建连接器失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      kind="mcp-config"
      title="自定义 MCP"
      subtitle="加入目录后再完成测试、接口审阅与范围治理。保存不等于启用。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn work" data-connector-panel-save disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存草稿"}
          </button>
        </>
      }
    >
      {error && <p className="error" role="alert" data-connector-panel-error>{error}</p>}
      <div className="connector-form-grid">
        <label className="field">服务器名称
          <input value={label} placeholder="例如：My Custom Server" maxLength={120} data-connector-field="label" onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label className="field">短名
          <input
            value={effectiveId}
            placeholder="my-custom-server"
            maxLength={63}
            data-connector-field="id"
            onChange={(event) => { setIdTouched(true); setId(event.target.value); }}
          />
          <small className="muted">小写字母开头，创建后不可修改。</small>
        </label>
      </div>
      <label className="field">传输类型
        <select value={transport} data-connector-field="transport" onChange={(event) => setTransport(event.target.value as RuntimeConnectorTransport)}>
          <option value="streamable-http">HTTP（Streamable）</option>
          <option value="sse">SSE</option>
        </select>
      </label>
      <div className="field">图标<ConnectorIconUpload file={iconFile} onPick={setIconFile} /></div>
      <label className="field">备注（可选）
        <textarea value={purpose} rows={3} maxLength={280} placeholder="说明此 MCP 提供的组织业务能力" onChange={(event) => setPurpose(event.target.value)} />
      </label>
      <label className="field">服务器 URL
        <input value={url} placeholder="https://mcp.yourserver.com/mcp" data-connector-field="url" onChange={(event) => setUrl(event.target.value)} />
      </label>
      <div className="field">自定义 headers（可选）<HeaderRowsEditor rows={headers} onChange={setHeaders} disabled={busy} /></div>
      <label className="check"><input type="checkbox" checked={noAuth} onChange={(event) => setNoAuth(event.target.checked)} /> 该端点明确允许无鉴权</label>
    </ModalShell>
  );
}

export function UrlAddPanel({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [transport, setTransport] = useState<RuntimeConnectorTransport>("streamable-http");
  const [headers, setHeaders] = useState<HeaderRow[]>([{ name: "", value: "" }]);
  const [noAuth, setNoAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const effectiveId = idTouched ? id : slugFromLabel(label);

  const submit = async () => {
    const problems: string[] = [];
    if (!label.trim()) problems.push("请填写服务器名称。");
    if (!/^https?:\/\//.test(url.trim())) problems.push("服务器 URL 需要以 http:// 或 https:// 开头。");
    if (!isConnectorIdValid(effectiveId)) problems.push("短名需要以小写字母开头，仅含小写字母、数字、- 或 _。");
    const headerProblem = headerRowsProblem(headers);
    if (headerProblem) problems.push(headerProblem);
    if (!headers.some((row) => row.name.trim() && row.value.trim()) && !noAuth) {
      problems.push("至少填写一个请求头密钥，或勾选「该端点明确无鉴权」。");
    }
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createManagedMcp({
        id: effectiveId,
        label: label.trim(),
        purpose: "待补充业务用途",
        transport,
        url: url.trim(),
        noAuth,
        timeoutMs: 30_000,
        headerRows: headers,
        iconFile: null,
      });
      onDone(`已通过 URL 将“${label.trim()}”加入连接器目录；它处于待验证状态。`);
    } catch (cause) {
      setError(errorMessage(cause, "添加连接器失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      kind="url-add"
      title="通过 URL 添加 MCP"
      subtitle="快速加入组织目录；后续在详情中补齐备注、图标与范围。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn work" data-connector-panel-save disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存草稿"}
          </button>
        </>
      }
    >
      {error && <p className="error" role="alert" data-connector-panel-error>{error}</p>}
      <label className="field">服务器名称 <span className="req">*</span>
        <input value={label} placeholder="例如：我的自定义服务器" maxLength={120} data-connector-field="label" onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className="field">服务器 URL <span className="req">*</span>
        <input value={url} placeholder="https://mcp.yourserver.com/mcp" data-connector-field="url" onChange={(event) => setUrl(event.target.value)} />
      </label>
      <details className="connector-advanced">
        <summary>高级设置（可选）</summary>
        <div className="connector-advanced-body">
          <label className="field">短名
            <input value={effectiveId} maxLength={63} onChange={(event) => { setIdTouched(true); setId(event.target.value); }} />
          </label>
          <label className="field">传输类型
            <select value={transport} onChange={(event) => setTransport(event.target.value as RuntimeConnectorTransport)}>
              <option value="streamable-http">HTTP（Streamable）</option>
              <option value="sse">SSE</option>
            </select>
          </label>
          <div className="field">自定义 headers<HeaderRowsEditor rows={headers} onChange={setHeaders} disabled={busy} /></div>
          <label className="check"><input type="checkbox" checked={noAuth} onChange={(event) => setNoAuth(event.target.checked)} /> 该端点明确允许无鉴权</label>
        </div>
      </details>
      <p className="muted connector-trust-note">仅使用你信任的开发者提供的连接器。平台不控制开发者提供的工具，也无法验证它们是否按预期工作或是否会更改。</p>
    </ModalShell>
  );
}

export function JsonImportPanel({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<McpImportPreview | null>(null);
  const [result, setResult] = useState<McpImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const parse = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await api.importMcpConnectors({ json: text, dry_run: true });
      if (response.dry_run) setPreview(response);
    } catch (cause) {
      setPreview(null);
      setError(errorMessage(cause, "JSON 解析失败"));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await api.importMcpConnectors({ json: text });
      if (!response.dry_run) setResult(response);
    } catch (cause) {
      setError(errorMessage(cause, "导入失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      kind="json-import"
      title="通过 JSON 导入"
      subtitle="请粘贴 mcpServers 配置。导入只创建待验证草稿，不会自动审批工具或授权范围。"
      onClose={onClose}
      footer={
        result ? (
          <button type="button" className="btn work" onClick={() => onDone(`已导入 ${result.created.length} 个连接器；它们处于待验证状态。`)}>完成</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
            <button type="button" className="btn" data-connector-import-preview disabled={busy || !text.trim()} onClick={() => void parse()}>
              {busy ? "解析中…" : "解析预览"}
            </button>
            <button type="button" className="btn work" data-connector-import-confirm disabled={busy || !preview || !preview.valid_count} onClick={() => void commit()}>
              确认导入
            </button>
          </>
        )
      }
    >
      {error && <p className="error" role="alert" data-connector-panel-error>{error}</p>}
      {!result && (
        <label className="field">配置 JSON
          <textarea
            className="connector-json-input"
            rows={14}
            spellCheck={false}
            value={text}
            data-connector-import-json
            placeholder={`{\n  "mcpServers": {\n    "my-server": { "type": "sse", "url": "https://example.com/sse", "headers": { "X-API-Key": "…" } }\n  }\n}`}
            onChange={(event) => { setText(event.target.value); setPreview(null); }}
          />
        </label>
      )}
      {preview && !result && (
        <section className="connector-import-preview" data-connector-import-preview-result>
          <strong>预览：{preview.valid_count} 个可导入 · {preview.invalid_count} 个需处理</strong>
          <ul>
            {preview.servers.map((server) => (
              <li key={server.id} data-connector-import-server={server.id}>
                <span><strong>{server.label}</strong> · <code>{server.url}</code> · {server.transport === "sse" ? "SSE" : "HTTP"}{server.secret_count ? ` · ${server.secret_count} 条密钥将写入保险库` : ""}</span>
                {!server.valid && <em className="error">{server.reason || "不可导入"}</em>}
                {server.conflicts.length > 0 && <em className="muted">冲突：{server.conflicts.join("；")}</em>}
              </li>
            ))}
          </ul>
          <p className="muted">未提供请求头的条目将按「明确允许无鉴权」保存；启用前请确认端点是否真的公开。导入只创建待验证草稿，不会启用或授权。</p>
        </section>
      )}
      {result && (
        <section className="connector-import-preview" data-connector-import-result>
          <strong>已导入 {result.created.length} 个连接器</strong>
          <ul>{result.created.map((row) => <li key={row.id}><code>{row.id}</code> · {row.label}</li>)}</ul>
          {result.skipped.length > 0 && <p className="muted">跳过：{result.skipped.map((row) => `${row.name}（${row.reason}）`).join("；")}</p>}
        </section>
      )}
    </ModalShell>
  );
}
