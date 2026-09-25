import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { errorMessage, versionConflictMessage, type RuntimeCredentialMetadata } from "../runtimeConnectorUi";

type FormState = {
  type: RuntimeCredentialMetadata["type"];
  owner: string;
  label: string;
  purpose: string;
  secret: string;
};
const EMPTY: FormState = { type: "organization_secret", owner: "", label: "", purpose: "", secret: "" };

export function ConnectorCredentialVault() {
  const [rows, setRows] = useState<RuntimeCredentialMetadata[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(await api.runtimeCredentials()); }
    catch (cause) { setError(errorMessage(cause, "无法读取凭据元数据")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setNotice("");
    if (!form.secret) { setError("请输入一次性秘密值；保存后不会回显。 "); return; }
    if (form.type === "user_account" && !form.owner.trim()) { setError("个人账号凭据必须指定所属用户 ID。 "); return; }
    setBusy(true);
    try {
      const created = await api.createRuntimeCredential({ type: form.type, owner_user_id: form.type === "user_account" ? form.owner.trim() : undefined,
        label: form.label.trim(), purpose: form.purpose.trim(), secret: form.secret });
      setRows((current) => [...current, created]); setForm(EMPTY);
      setNotice(`凭据“${created.label || created.id}”已写入保险库。只有引用 ID 会显示；秘密已从页面状态清除。`);
    } catch (cause) { setError(versionConflictMessage(cause) || errorMessage(cause, "凭据未写入")); }
    finally { setBusy(false); }
  };
  const toggle = async (row: RuntimeCredentialMetadata) => {
    setError(""); setNotice("");
    try {
      const next = await api.updateRuntimeCredential(row.id, { status: row.status === "active" ? "disabled" : "active", expected_version: row.version });
      setRows((current) => current.map((item) => item.id === row.id ? next : item));
    } catch (cause) { setError(versionConflictMessage(cause) || errorMessage(cause, "凭据状态未更新")); }
  };
  const remove = async (row: RuntimeCredentialMetadata) => {
    if (!window.confirm(`删除凭据引用“${row.label || row.id}”？已被连接器引用的凭据不能删除。`)) return;
    setError(""); setNotice("");
    try { await api.deleteRuntimeCredential(row.id, row.version); setRows((current) => current.filter((item) => item.id !== row.id)); setNotice("凭据元数据已删除。 "); }
    catch (cause) { setError(versionConflictMessage(cause) || errorMessage(cause, "凭据未删除")); }
  };
  return <section className="runtime-vault" data-runtime-credential-vault>
    <div className="runtime-section-heading"><div><h3>凭据保险库</h3><p className="muted">组织 Secret 与明确归属的个人账号。秘密只在写入时提交，不能读取、复制或回显。</p></div><button className="btn sm" type="button" onClick={() => void load()} disabled={loading}>刷新</button></div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="runtime-notice" role="status">{notice}</p>}
    <form className="runtime-vault-form" onSubmit={(event) => void create(event)}>
      <label className="field">类型<select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as FormState["type"] }))}><option value="organization_secret">组织 Secret</option><option value="user_account">个人账号 Bearer</option></select></label>
      {form.type === "user_account" && <label className="field">所属用户 ID<input value={form.owner} onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))} placeholder="精确用户 ID，不采用默认账号" autoComplete="off" /></label>}
      <label className="field">标签<input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="例如 Starry 组织 API Key" autoComplete="off" /></label>
      <label className="field">用途<input value={form.purpose} onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))} placeholder="可选；不写入秘密内容" autoComplete="off" /></label>
      <label className="field runtime-vault-secret">秘密值（仅本次）<input type="password" value={form.secret} onChange={(event) => setForm((current) => ({ ...current, secret: event.target.value }))} placeholder="保存后不回显" autoComplete="new-password" /></label>
      <button className="btn work" disabled={busy}>{busy ? "加密保存中…" : "写入保险库"}</button>
    </form>
    {loading && <p className="muted">正在读取凭据引用…</p>}
    {!loading && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>引用 ID</th><th>类型 / 所属</th><th>标签与用途</th><th>状态</th><th>密钥版本</th><th /></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><code>{row.id}</code></td><td>{row.type === "organization_secret" ? "组织" : "个人账号"}<p className="muted">{row.owner_user_id || "—"}</p></td><td><strong>{row.label || "未命名"}</strong><p className="muted">{row.purpose || "—"}</p></td><td><span className={`admin-status is-${row.status === "active" ? "configured" : "unattached"}`}>{row.status === "active" ? "可用" : "停用"}</span></td><td>v{row.key_version} · 记录 v{row.version}</td><td className="admin-inline-actions"><button className="btn sm" type="button" onClick={() => void toggle(row)}>{row.status === "active" ? "停用" : "启用"}</button><button className="btn sm danger" type="button" onClick={() => void remove(row)}>删除</button></td></tr>)}
    </tbody></table></div>}
    {!loading && !rows.length && <p className="muted">暂无凭据引用。连接器可继续使用环境变量引用；不要在连接器表单填写真实 Token。</p>}
  </section>;
}
