import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminConfirm } from "../components/ConfirmDialog";
import "./AdminOntology.css";

type OntologyScope = "objects" | "events" | "tickets" | "rules";

type OntologyRegistry = {
  scope: OntologyScope;
  scope_label?: string;
  base_version?: string;
  target_digest?: string | null;
  data: unknown;
};

type OntologyApproval = {
  approval_id?: string;
  status?: string;
  scope?: OntologyScope;
  base_version?: string;
};

type LatestApprovalResponse = {
  scope?: OntologyScope;
  scope_label?: string;
  base_version?: string;
  latest?: OntologyApproval | null;
};

type RegistryResponse = { registries?: OntologyRegistry[] };
type RegistryEntry = { id: string; collection: string; value: unknown };

const SCOPES: Array<{ id: OntologyScope; label: string; listKeys: string[] }> = [
  { id: "objects", label: "对象", listKeys: ["objects"] },
  { id: "events", label: "事件", listKeys: ["events"] },
  { id: "tickets", label: "票型", listKeys: ["kinds", "tickets"] },
  { id: "rules", label: "规则", listKeys: ["nodes", "rules"] },
];
const TARGET_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;

function isScope(value: unknown): value is OntologyScope {
  return SCOPES.some((scope) => scope.id === value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("、");
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function shortText(value: unknown, limit = 180): string {
  const text = textOf(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function valueAt(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
  }
  return null;
}

function entryTitle(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return shortText(entry.value, 80);
  return shortText(valueAt(record, ["name", "label", "title", "code", "id"]) ?? entry.collection, 120);
}

function entryCode(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return "";
  const code = valueAt(record, ["code", "id", "key"]);
  return code ? shortText(code, 120) : "";
}

function entrySummary(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return shortText(entry.value);
  const value = valueAt(record, ["desc", "description", "note", "rule", "follow_up", "payload"]);
  return shortText(value ?? "—");
}

function entryCategory(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return "—";
  return shortText(valueAt(record, ["category", "layer", "kind", "domain", "object_type"]) ?? "—", 80);
}

function entryStatus(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return "—";
  return shortText(valueAt(record, ["status", "implementation_status", "host_enforced", "live_enforced"]) ?? "—", 80);
}

function entrySource(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return entry.collection;
  return shortText(valueAt(record, ["source_ref", "carrier", "producer", "authority_source"]) ?? entry.collection, 140);
}

function registryEntries(data: unknown, scope: OntologyScope): RegistryEntry[] {
  if (Array.isArray(data)) return data.map((value, index) => ({ id: String(index), collection: "items", value }));
  const record = asRecord(data);
  if (!record) return [{ id: "root", collection: "config", value: data }];

  const preferred = SCOPES.find((item) => item.id === scope)?.listKeys || [];
  const keys = [...preferred, ...Object.keys(record)];
  for (const key of [...new Set(keys)]) {
    const value = record[key];
    if (Array.isArray(value)) return value.map((item, index) => ({ id: `${key}-${index}`, collection: key, value: item }));
  }
  return Object.entries(record).map(([key, value]) => ({ id: key, collection: key, value }));
}

function approvalTone(status?: string): "pending" | "ok" | "error" | "muted" {
  const value = String(status || "").toLowerCase();
  if (value === "pending") return "pending";
  if (["approved", "consumed", "completed"].includes(value)) return "ok";
  if (["rejected", "cancelled", "failed", "expired"].includes(value)) return "error";
  return "muted";
}

async function ontologyRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  if (!response.ok) {
    const body = asRecord(payload);
    const message = typeof body?.message === "string"
      ? body.message
      : typeof body?.error === "string"
        ? body.error
        : typeof payload === "string" && payload.trim()
          ? payload
          : `请求失败（${response.status}）`;
    throw new Error(message);
  }
  return payload as T;
}

export default function AdminOntology() {
  const [registries, setRegistries] = useState<Record<OntologyScope, OntologyRegistry | null>>({
    objects: null,
    events: null,
    tickets: null,
    rules: null,
  });
  const [latestByScope, setLatestByScope] = useState<Record<OntologyScope, LatestApprovalResponse | null>>({
    objects: null,
    events: null,
    tickets: null,
    rules: null,
  });
  const [scope, setScope] = useState<OntologyScope>("objects");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState("");
  const [changeRef, setChangeRef] = useState("");
  const [targetDigest, setTargetDigest] = useState("");
  const [formError, setFormError] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const loadSequence = useRef(0);
  const { ask, dialog } = useAdminConfirm();

  const loadLatest = useCallback(async (nextScope: OntologyScope): Promise<LatestApprovalResponse> => (
    ontologyRequest<LatestApprovalResponse>(`/api/admin/ontology/change-approvals/latest?scope=${encodeURIComponent(nextScope)}`)
  ), []);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const registriesResponse = await ontologyRequest<RegistryResponse>("/api/admin/ontology/registries");
      const rows = Array.isArray(registriesResponse.registries) ? registriesResponse.registries : [];
      const nextRegistries: Record<OntologyScope, OntologyRegistry | null> = { objects: null, events: null, tickets: null, rules: null };
      for (const row of rows) {
        if (isScope(row.scope)) nextRegistries[row.scope] = row;
      }
      const latestRows = await Promise.all(SCOPES.map(async (item) => [item.id, await loadLatest(item.id)] as const));
      if (sequence !== loadSequence.current) return;
      setRegistries(nextRegistries);
      setLatestByScope(Object.fromEntries(latestRows) as Record<OntologyScope, LatestApprovalResponse>);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(cause instanceof Error ? cause.message : "无法读取本体注册表或审批状态");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [loadLatest]);

  useEffect(() => { void load(); }, [load]);

  const activeRegistry = registries[scope];
  const activeScope = SCOPES.find((item) => item.id === scope) || SCOPES[0];
  const activeLabel = activeRegistry?.scope_label || activeScope.label;
  const latestResponse = latestByScope[scope];
  const latest = latestResponse?.latest || null;
  const baseline = activeRegistry?.base_version || latestResponse?.base_version || "—";
  const entries = useMemo(() => activeRegistry ? registryEntries(activeRegistry.data, scope) : [], [activeRegistry, scope]);
  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return entries;
    return entries.filter((entry) => jsonText(entry.value).toLocaleLowerCase().includes(normalized));
  }, [entries, query]);

  const reloadScopeStatus = useCallback(async (nextScope: OntologyScope) => {
    setError("");
    try {
      const latestStatus = await loadLatest(nextScope);
      setLatestByScope((current) => ({ ...current, [nextScope]: latestStatus }));
      setNotice(`已重新读取「${SCOPES.find((item) => item.id === nextScope)?.label || nextScope}」的最新审批状态。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取最新审批状态");
    }
  }, [loadLatest]);

  const submitApproval = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    const body: Record<string, string> = { scope, summary: summary.trim() };
    if (title.trim()) body.title = title.trim();
    if (changeRef.trim()) body.change_ref = changeRef.trim();
    if (targetDigest.trim()) body.target_digest = targetDigest.trim();

    try {
      await ontologyRequest("/api/admin/ontology/change-approvals", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNotice("待审批请求已响应；正在重新读取该范围的真实最新审批状态。");
      try {
        const latestStatus = await loadLatest(scope);
        setLatestByScope((current) => ({ ...current, [scope]: latestStatus }));
        setNotice(`待审批请求已响应；已重新读取「${activeLabel}」的真实最新审批状态。`);
        setSummary("");
        setTitle("");
        setChangeRef("");
        setTargetDigest("");
      } catch (refreshCause) {
        setError(`审批请求已响应，但读取最新审批状态失败：${refreshCause instanceof Error ? refreshCause.message : "未知错误"}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法发起本体变更审批");
    } finally {
      setSubmitting(false);
    }
  }, [activeLabel, changeRef, loadLatest, scope, submitting, summary, targetDigest, title]);

  const openApprovalConfirm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanSummary = summary.trim();
    const cleanChangeRef = changeRef.trim();
    const cleanTargetDigest = targetDigest.trim();
    if (!scope || !cleanSummary) {
      setFormError("范围与变更摘要为必填项。");
      return;
    }
    if (!cleanTargetDigest && !cleanChangeRef) {
      setFormError("必须提供目标内容摘要，或提供可由后端解析的 Git 变更引用。");
      return;
    }
    if (cleanTargetDigest && !TARGET_DIGEST_PATTERN.test(cleanTargetDigest)) {
      setFormError("目标内容摘要必须是 sha256:<64 位十六进制字符>；也可改为提供可解析的 Git 变更引用。");
      return;
    }
    setFormError("");
    const digestForConfirm = cleanTargetDigest || "未填写（由后端根据 Git 变更引用计算）";
    const refForConfirm = cleanChangeRef || "未填写（使用显式目标内容摘要）";
    ask({
      kind: "approval-initiate",
      title: "确认发起本体变更审批？",
      object: `${activeLabel} · ${scope}`,
      scope: `${activeLabel}（${scope}）`,
      change: `摘要：${cleanSummary}；目标内容摘要：${digestForConfirm}；Git 变更引用：${refForConfirm}${title.trim() ? `；标题：${title.trim()}` : ""}`,
      consequence: "确认后只创建待审批请求，不产生 CEO 批准。此页面不写入注册表文件；文件级变更仍必须通过 Git 完成，并由后端按当前基线与目标内容校验。",
      ruleVersion: baseline,
      approvalState: latest?.status ? `当前最新状态：${latest.status}` : "当前暂无审批记录",
      confirmLabel: "确认提交审批",
      busyLabel: "提交审批中…",
      confirmTone: "primary",
      initialFocus: "cancel",
      cancelLabel: "取消，不提交",
      cancelHint: "取消只关闭确认，不会创建审批请求或写入文件。",
    }, async () => {
      await submitApproval();
    });
  };

  const selectScope = (nextScope: OntologyScope) => {
    setScope(nextScope);
    setShowConfig(false);
    setFormError("");
  };

  const onScopeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? SCOPES.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + SCOPES.length) % SCOPES.length;
    const nextScope = SCOPES[nextIndex].id;
    selectScope(nextScope);
    window.requestAnimationFrame(() => document.getElementById(`ontology-tab-${nextScope}`)?.focus());
  };

  return (
    <section className="admin-ontology" data-admin-ontology>
      {dialog}
      <header className="ontology-head">
        <div>
          <p className="ontology-kicker">治理 · 注册表与审批</p>
          <h1>本体管理</h1>
          <p className="muted">浏览当前注册表基线与最新审批状态。此页面不会写入配置文件；文件变更始终通过 Git 完成，发起审批不产生 CEO 批准。</p>
        </div>
        <button type="button" className="btn text" onClick={() => void load()} disabled={loading || submitting} aria-busy={loading || undefined}>
          {loading ? "读取中…" : "重新读取"}
        </button>
      </header>

      {notice ? <p className="ontology-notice" role="status">{notice}</p> : null}
      {error ? (
        <div className="ontology-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn text" onClick={() => void load()} disabled={loading || submitting}>重试读取</button>
        </div>
      ) : null}

      <div className="ontology-tabs" role="tablist" aria-label="本体注册表范围">
        {SCOPES.map((item, index) => (
          <button
            key={item.id}
            id={`ontology-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={scope === item.id}
            aria-controls="ontology-panel"
            tabIndex={scope === item.id ? 0 : -1}
            className={scope === item.id ? "is-selected" : ""}
            onClick={() => selectScope(item.id)}
            onKeyDown={(event) => onScopeKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id="ontology-panel" role="tabpanel" aria-labelledby={`ontology-tab-${scope}`}>
        <section className="ontology-facts" aria-label={`${activeLabel} 当前状态`}>
          <div className="ontology-fact">
            <span>当前 baseline</span>
            <code title={baseline}>{baseline}</code>
          </div>
          <div className="ontology-fact">
            <span>目标内容摘要</span>
            <code title={activeRegistry?.target_digest || ""}>{activeRegistry?.target_digest || "未提供（当前运行文件摘要不作为待变更目标）"}</code>
          </div>
          <div className="ontology-fact">
            <span>最新审批状态</span>
            {latest ? (
              <div className="ontology-approval-state" data-tone={approvalTone(latest.status)}>
                <strong>状态：{latest.status || "未返回"}</strong>
                <span>审批 ID：{latest.approval_id || "未返回"}</span>
              </div>
            ) : <strong className="ontology-empty-status">暂无审批记录</strong>}
            <button type="button" className="btn text" onClick={() => void reloadScopeStatus(scope)} disabled={loading || submitting}>重试状态读取</button>
          </div>
        </section>

        <section className="ontology-list-panel" aria-labelledby="ontology-list-title">
          <div className="ontology-list-head">
            <div>
              <h2 id="ontology-list-title">{activeLabel}数据列表</h2>
              <p className="muted">搜索匹配当前范围内条目的完整字段内容。列表仅作浏览，不提供文件编辑。</p>
            </div>
            <label className="ontology-search">
              <span className="sr-only">搜索当前注册表</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、代码、状态或引用" disabled={loading} />
            </label>
          </div>
          <div className="ontology-table-wrap">
            <table className="ontology-table">
              <thead>
                <tr><th>条目</th><th>摘要</th><th>分类 / 状态</th><th>来源</th></tr>
              </thead>
              <tbody>
                {loading && !activeRegistry ? <tr><td colSpan={4} className="ontology-table-message">正在读取当前注册表…</td></tr> : null}
                {!loading && !activeRegistry && !error ? <tr><td colSpan={4} className="ontology-table-message">该范围尚未返回注册表数据。</td></tr> : null}
                {activeRegistry && !filteredEntries.length ? <tr><td colSpan={4} className="ontology-table-message">当前搜索没有匹配条目。</td></tr> : null}
                {filteredEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong title={entryTitle(entry)}>{entryTitle(entry)}</strong>
                      {entryCode(entry) && entryCode(entry) !== entryTitle(entry) ? <code>{entryCode(entry)}</code> : null}
                    </td>
                    <td title={entrySummary(entry)}>{entrySummary(entry)}</td>
                    <td>
                      <span>{entryCategory(entry)}</span>
                      <span className="ontology-cell-status">{entryStatus(entry)}</span>
                    </td>
                    <td title={entrySource(entry)}>{entrySource(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {activeRegistry ? (
            <div className="ontology-config-toggle">
              <button type="button" className="btn text" aria-expanded={showConfig} onClick={() => setShowConfig((current) => !current)}>
                {showConfig ? "收起完整配置对象" : "查看完整配置对象"}
              </button>
              {showConfig ? <pre aria-label={`${activeLabel}完整配置对象`}>{jsonText(activeRegistry.data)}</pre> : null}
            </div>
          ) : null}
        </section>

        <form className="ontology-approval-form" onSubmit={openApprovalConfirm}>
          <div className="ontology-form-head">
            <div>
              <h2>发起变更审批</h2>
              <p className="muted">审批请求绑定当前范围与后端返回的 baseline。必须提供目标内容摘要，或可由后端解析的 Git 变更引用；当前运行文件摘要不会被自动当作待变更目标。</p>
            </div>
            <span className="ontology-risk">R3 · 正式写入前确认</span>
          </div>
          <div className="ontology-form-grid">
            <label className="field">
              审批范围
              <select value={scope} onChange={(event) => selectScope(event.target.value as OntologyScope)} disabled={submitting}>
                {SCOPES.map((item) => <option key={item.id} value={item.id}>{item.label}（{item.id}）</option>)}
              </select>
            </label>
            <label className="field">
              审批标题（可选）
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} disabled={submitting} placeholder={`默认：本体变更审批：${activeLabel}`} />
            </label>
            <label className="field ontology-field-wide">
              变更摘要
              <textarea required value={summary} onChange={(event) => setSummary(event.target.value)} disabled={submitting} rows={3} placeholder="说明改了什么、为什么，以及受影响的范围" />
            </label>
            <label className="field">
              Git 变更引用（目标内容摘要未填时必填）
              <input value={changeRef} onChange={(event) => setChangeRef(event.target.value)} disabled={submitting} placeholder="可由后端解析为提交的 Git 引用" />
            </label>
            <label className="field">
              目标内容摘要 target_digest（必填；或提供可解析 Git 版本）
              <input value={targetDigest} onChange={(event) => setTargetDigest(event.target.value)} disabled={submitting} placeholder="sha256:<64 位十六进制字符>" />
            </label>
          </div>
          {formError ? <p className="field-error" role="alert">{formError}</p> : null}
          <div className="ontology-form-actions">
            <p className="muted">确认页会再次展示范围、变更摘要与目标内容摘要；提交只创建待审批请求，不产生 CEO 批准，随后只读取真实 latest。</p>
            <button type="submit" className="btn work" disabled={submitting || loading} aria-busy={submitting || undefined}>{submitting ? "提交审批中…" : "发起审批"}</button>
          </div>
        </form>
      </div>
    </section>
  );
}
