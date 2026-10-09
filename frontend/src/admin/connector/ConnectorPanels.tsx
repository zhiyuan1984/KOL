import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { useFocusLock } from "../../hooks/useFocusLock";
import {
  errorMessage,
  type McpImportPreview,
  type McpImportResult,
  type RuntimeConnectorTransport,
} from "../../runtimeConnectorUi";
import { createConnectorRecord, resolveHeaderRefs, saveConnectorConfigForm, type HeaderRow } from "./connectorSetup";
import { isConnectorIdValid, slugFromLabel } from "./entity";
import { headerNameHint, otherHeaderNames, suggestHeaderNames, validateHeaderName } from "./headerNames";

export type { HeaderRow } from "./connectorSetup";

const MAX_ICON_BYTES = 1024 * 1024;

export function validateIconFile(file: File): string {
  if (file.type !== "image/png" && file.type !== "image/jpeg") return "仅支持 PNG 或 JPG 图标。";
  if (file.size > MAX_ICON_BYTES) return "图标不能超过 1 MB。";
  return "";
}

export function ModalShell({ kind, title, subtitle, onClose, children, footer, wide = false, form = false, headerExtra }: {
  kind: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Form dialogs use the shared density and control tokens in docs/DESIGN.md. */
  form?: boolean;
  headerExtra?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useFocusLock({ open: true, rootRef: ref, onEscape: onClose, lockBody: true, restore: true });
  return createPortal(
    <div className="connector-panel-layer" data-connector-panel={kind}>
      <div className="connector-panel-backdrop" onClick={onClose} />
      <div ref={ref} className={"connector-panel" + (wide ? " is-wide" : "") + (form ? " is-form" : "")} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="connector-panel-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <div className="connector-panel-head-actions">
            {headerExtra}
            <button type="button" className="icon-btn" aria-label="关闭" data-connector-panel-close onClick={onClose}>
              <svg viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </header>
        <div className="connector-panel-body">{children}</div>
        {footer && <footer className="connector-panel-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export type SplitMenuItem = { label: string; onSelect: () => void; disabled?: boolean };

/** Outlined or solid main button with a chevron segment that opens a small menu. */
export function SplitButton({ label, name, variant = "outline", onPrimary, items, disabled }: {
  label: string;
  /** Suffix for the `data-connector-split-*` test hooks. */
  name: string;
  variant?: "outline" | "primary";
  onPrimary: () => void;
  items: SplitMenuItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture phase: close the menu only, without also closing the surrounding dialog.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
  const base = "btn connector-split-btn" + (variant === "primary" ? " work" : " sm");
  return (
    <span className="connector-split" ref={ref} data-connector-split={name}>
      <button type="button" className={base + " connector-split-main"} data-connector-split-main={name} disabled={disabled} onClick={onPrimary}>
        {label}
      </button>
      <button
        type="button"
        className={base + " connector-split-toggle"}
        aria-label={`${label}：更多选项`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-connector-split-toggle={name}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 16 16" aria-hidden><path d="M4 6.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <span className="connector-split-menu" role="menu" data-connector-split-menu={name}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="connector-split-item"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}
            >
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function ConnectorIconUpload({ file, existingUrl, onPick, variant = "plain" }: {
  file: File | null;
  existingUrl?: string | null;
  onPick: (file: File | null) => void;
  /** "dialog" drops the surrounding box and uses the upload dropdown from the reference design. */
  variant?: "plain" | "dialog" | "compact";
}) {
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
  const clear = () => {
    onPick(null);
    setLocalError("");
    if (inputRef.current) inputRef.current.value = "";
  };
  return (
    <div className={"connector-icon-field" + (variant !== "plain" ? " is-bare" : "") + (variant === "compact" ? " is-compact" : "")}>
      <span className="connector-icon-preview" data-connector-icon-preview>
        {shown ? <img src={shown} alt="图标预览" /> : (
          <svg className="connector-icon-placeholder" viewBox="0 0 24 24" aria-hidden>
            <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="9" cy="10" r="1.7" fill="currentColor" />
            <path d="M5.6 16.8l4.1-4.2 3 3 2.5-2.4 3.3 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <div className="connector-icon-actions">
        {variant !== "plain" ? (
          <SplitButton
            name="icon"
            label="上传"
            onPrimary={() => inputRef.current?.click()}
            items={[
              { label: "上传", onSelect: () => inputRef.current?.click() },
              // Only clears the file picked in this form; a saved icon is replaced by uploading a new one.
              { label: "移除", onSelect: clear, disabled: !file },
            ]}
          />
        ) : (
          <>
            <button type="button" className="btn sm" onClick={() => inputRef.current?.click()}>上传</button>
            {file && <button type="button" className="btn sm" onClick={clear}>移除</button>}
          </>
        )}
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
        <p className="muted" data-connector-icon-hint>{variant === "compact" ? "PNG/JPG · ≤1 MB · 推荐256×256" : "PNG 或 JPG，最大 1 MB。推荐尺寸 256×256 像素。"}</p>
        {localError && <p className="error" role="alert">{localError}</p>}
      </div>
    </div>
  );
}

/**
 * 请求头名输入：原生 datalist 给出常用名，自定义名照常手输。
 * `taken` 是同一表单里其他行的名字 —— 已用过的名字不再推荐，避免两行同名在保存时被合并成一个。
 */
export function HeaderNameInput({ value, onChange, disabled, taken, className = "connector-header-name", placeholder = "Header 名称", ariaLabel }: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  taken: string[];
  className?: string;
  placeholder?: string;
  /** 省略时沿用所在 <label> 的可访问名。 */
  ariaLabel?: string;
}) {
  const listId = useId();
  const suggestions = suggestHeaderNames(taken);
  return (
    <>
      <input
        className={className}
        list={suggestions.length ? listId : undefined}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((name) => <option key={name} value={name} />)}
        </datalist>
      )}
    </>
  );
}

/** 已知头名的一行说明；自定义名不渲染任何东西。 */
export function HeaderNameHint({ name, bearerReference = false }: { name: string; bearerReference?: boolean }) {
  const hint = headerNameHint(name, { bearerReference });
  return hint ? <span className="connector-header-hint" data-connector-header-hint>{hint}</span> : null;
}

export function HeaderRowsEditor({ rows, onChange, disabled }: { rows: HeaderRow[]; onChange: (rows: HeaderRow[]) => void; disabled?: boolean }) {
  const update = (index: number, patch: Partial<HeaderRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  return (
    <div className="connector-header-rows" data-connector-header-rows>
      {rows.map((row, index) => (
        <div className="connector-header-row" key={index}>
          <HeaderNameInput
            value={row.name}
            ariaLabel="Header 名称"
            taken={otherHeaderNames(rows, index)}
            disabled={disabled}
            onChange={(name) => update(index, { name })}
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
          <HeaderNameHint name={row.name} />
        </div>
      ))}
      <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange([...rows, { name: "", value: "" }])} data-connector-header-add>
        + 添加自定义 header
      </button>
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

async function saveConnectorSetup(input: {
  id: string;
  label: string;
  protocol: "mcp" | "http";
  transport: RuntimeConnectorTransport;
  url: string;
  noAuth: boolean;
  headerRows: HeaderRow[];
  iconFile: File | null;
}): Promise<void> {
  await saveConnectorConfigForm({
    id: input.id,
    label: input.label,
    protocol: input.protocol,
    transport: input.transport,
    url: input.url,
    noAuth: input.noAuth,
    headerRows: input.headerRows,
    iconFile: input.iconFile,
  }, 0);
}

/**
 * HTTP API creation keeps the identity, notes and secret references only; the
 * base URL and the action catalog are completed in the connector detail.
 */
async function createManagedHttpApi(input: {
  label: string;
  purpose: string;
  secretRows: HeaderRow[];
  iconFile: File | null;
}): Promise<string> {
  const id = await createConnectorRecord(input.label, input.purpose, { prefix: "api", protocol: "http" });
  const refs = await resolveHeaderRefs(input.secretRows, input.label);
  if (Object.keys(refs).length) {
    await api.saveRuntimeConnectorConfig(id, {
      protocol: "http",
      allow_unauthenticated: false,
      timeout_ms: 30_000,
      http_tools: [],
      headers_secret_refs: refs,
      expected_version: 0,
    });
  }
  if (input.iconFile) {
    try {
      await api.uploadConnectorIcon(id, input.iconFile);
    } catch {
      // The connector itself is created; icon upload can be retried from the detail page.
    }
  }
  return id;
}

/** Secret rows become vault credentials; the saved config keeps only references. */
export function SecretKeysEditor({ rows, onChange, disabled }: { rows: HeaderRow[]; onChange: (rows: HeaderRow[]) => void; disabled?: boolean }) {
  const update = (index: number, patch: Partial<HeaderRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  return (
    <div className="connector-secret-keys" data-connector-secret-keys>
      {rows.map((row, index) => (
        <div className="connector-secret-card" data-connector-secret-row key={index}>
          {rows.length > 1 && (
            <button
              type="button"
              className="icon-btn danger connector-secret-remove"
              aria-label={`移除密钥 ${row.name.trim() || index + 1}`}
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, position) => position !== index))}
            >
              <svg viewBox="0 0 16 16" aria-hidden><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
          <label className="field">密钥名称
            <HeaderNameInput
              value={row.name}
              className="connector-secret-name"
              placeholder="SOME_UNIQUE_KEY_NAME"
              taken={otherHeaderNames(rows, index)}
              disabled={disabled}
              onChange={(name) => update(index, { name })}
            />
            <HeaderNameHint name={row.name} />
          </label>
          <label className="field">值
            <textarea
              className="connector-secret-value"
              value={row.value}
              placeholder="Value of the secret, such as sk-example-1234"
              autoComplete="new-password"
              disabled={disabled}
              onChange={(event) => update(index, { value: event.target.value })}
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className="btn connector-secret-add"
        data-connector-secret-add
        disabled={disabled}
        onClick={() => onChange([...rows, { name: "", value: "" }])}
      >
        + 添加密钥
      </button>
    </div>
  );
}

export function secretKeysProblem(rows: HeaderRow[]): string {
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (!name && !value) continue;
    if (!name) return "密钥值已填写，但缺少密钥名称。";
    const problem = validateHeaderName(name, "密钥名称");
    if (problem) return problem;
    if (!value) return `密钥 ${name} 还没有填写值；请填写，或移除该密钥。`;
  }
  return "";
}

/** HTTP API creation collects the name, icon, notes and secrets only (docs/DESIGN.md §7.2 连接器设置向导). */
export function ApiConfigPanel({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [label, setLabel] = useState("");
  const [purpose, setPurpose] = useState("");
  const [secrets, setSecrets] = useState<HeaderRow[]>([{ name: "", value: "" }]);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const name = label.trim();
    const problems: string[] = [];
    if (!name) problems.push("请填写名称。");
    const secretProblem = secretKeysProblem(secrets);
    if (secretProblem) problems.push(secretProblem);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setBusy(true);
    setError("");
    const hasSecrets = secrets.some((row) => row.name.trim() && row.value.trim());
    try {
      await createManagedHttpApi({
        label: name,
        purpose: purpose.trim() || "待补充业务用途",
        secretRows: secrets,
        iconFile,
      });
      onDone(`已创建“${name}”HTTP API 草稿${hasSecrets ? "，密钥已写入凭据保险库" : ""}；下一步在详情填写 Base URL、导入或编辑动作并完成测试。`);
    } catch (cause) {
      setError(errorMessage(cause, "创建 HTTP API 连接器失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      kind="api-config"
      form
      title="添加自定义 API"
      subtitle="使用自定义 API 连接器集成任何支持密钥或令牌授权的外部服务。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn work" data-connector-panel-save disabled={busy || !label.trim()} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
          </button>
        </>
      }
    >
      {error && <p className="error" role="alert" data-connector-panel-error>{error}</p>}
      <label className="field">名称
        <input value={label} placeholder="我的自定义 API" maxLength={120} data-connector-field="label" onChange={(event) => setLabel(event.target.value)} />
      </label>
      <div className="field">图标<ConnectorIconUpload variant="dialog" file={iconFile} onPick={setIconFile} /></div>
      <label className="field"><span>备注<span className="field-optional">（可选）</span></span>
        <textarea value={purpose} rows={5} maxLength={280} placeholder="提供 API 文档或说明，以告知平台如何及何时使用此 API" onChange={(event) => setPurpose(event.target.value)} />
      </label>
      <div className="field">
        <span>密钥（环境变量）
          <span
            className="connector-help"
            role="img"
            aria-label="密钥值写入凭据保险库，仅在调用时以同名请求头发送；保存后不回显。"
            title="密钥值写入凭据保险库，仅在调用时以同名请求头发送；保存后不回显。"
          >?</span>
        </span>
        <SecretKeysEditor rows={secrets} onChange={setSecrets} disabled={busy} />
      </div>
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
      await api.adminSave("/api/admin/connectors", { id: effectiveId, label: label.trim(), purpose: "待补充业务用途" }, "POST");
      await saveConnectorSetup({
        id: effectiveId,
        label: label.trim(),
        protocol: "mcp",
        transport,
        url: url.trim(),
        noAuth,
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
      form
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn work" data-connector-panel-save disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
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
