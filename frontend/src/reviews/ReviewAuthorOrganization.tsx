import { useEffect, useState } from "react";
import { reviewApi, type ReviewContext } from "./api";
export function ReviewAuthorOrganization({ context, unitId, onUnitChange, onCompanyChange, onBack, disabled, editing, saved = false }: {
  context?: ReviewContext; unitId?: string; onUnitChange: (id: string | undefined) => void;
  onCompanyChange: (id: string) => void; onBack: () => void; disabled: boolean; editing: boolean; saved?: boolean;
}) {
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]), [error, setError] = useState("");
  useEffect(() => { let live = true; reviewApi<{ id: string; name: string }[]>("/approvals/v2/companies").then(rows => live && setCompanies(rows)).catch(e => live && setError(e.message)); return () => { live = false; }; }, []);
  const units = context?.organization?.units || [], path: string[] = [];
  let current = units.find(u => u.id === unitId);
  while (current && current.id !== context?.tenant && !path.includes(current.id) && path.length < 64) { path.unshift(current.id); current = units.find(u => u.id === current?.parentId); }
  const unavailable = Boolean(unitId && !units.some(u => u.id === unitId));
  const roots = units.filter(u => u.id !== context?.tenant && (u.parentId === context?.tenant || u.parentId === null));
  const company = companies.find(c => c.id === context?.tenant)?.name || units.find(u => u.id === context?.tenant)?.name || "正在加载公司";
  return <section className="review-author-org" aria-label="流程归属组织">
    <span className="review-org-path">{company}{path.map(id => ` / ${units.find(u => u.id === id)?.name}`).join("")}{unitId === context?.tenant ? " / 公司范围" : ""}</span>
    <details className="review-departments"><summary>{editing ? "切换归属" : "切换公司"}</summary><div className="review-department-controls">
      {companies.length > 1 && <label>当前公司<select aria-label="当前公司" value={context?.tenant || ""} disabled={disabled} onChange={e => onCompanyChange(e.target.value)}>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {editing && <><p className="review-muted">创建归属不会扩大使用权限。切换公司将离开当前编辑上下文，草稿不会迁移。</p><label>当前组织<select aria-label="当前组织" value={path[0] || (unitId === context?.tenant ? unitId : "")} disabled={disabled} onChange={e => onUnitChange(e.target.value || undefined)}><option value="">请选择组织</option><option value={context?.tenant}>当前公司范围</option>{roots.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      {Array.from({ length: Math.max(3, path.length) }, (_, index) => {
        const parent = path[index], children = parent ? units.filter(u => u.parentId === parent) : [];
        const label = ["一级部门", "二级部门", "三级部门"][index] || `第 ${index+1} 级部门`;
        return <label key={index}>{label}<select aria-label={label} value={path[index+1] || ""} disabled={disabled || !children.length} onChange={e => onUnitChange(e.target.value || parent)}><option value="">{children.length ? "可留在上级组织" : "无下级部门"}</option>{children.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>;
      })}</>}
    </div></details>
    <button type="button" className="review-back review-quiet" aria-label="返回上一页" title="返回上一页" onClick={onBack} disabled={disabled}>←</button>
    {error && <p role="alert">组织列表加载失败：{error}</p>}
    {unavailable && <p role="alert">草稿归属组织已不可用，请重新选择后保存。</p>}
    {editing && !unitId && units.length ? <p className="review-muted">{saved ? "此草稿未记录创建组织，可按需设置归属。" : "未找到唯一主组织，请选择组织或公司范围。"}</p> : null}
  </section>;
}
