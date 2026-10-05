import { useEffect, useRef, useState } from "react";
import { reviewApi, type ReviewContext } from "./api";

export function ReviewAuthorOrganization({ context, unitId, onUnitChange, onCompanyChange, onBack, disabled, editing }: {
  context?: ReviewContext;
  unitId?: string;
  onUnitChange: (id: string | undefined) => void;
  onCompanyChange: (id: string) => void;
  onBack: () => void;
  disabled: boolean;
  editing: boolean;
}) {
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const container = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [wideLayout, setWideLayout] = useState(true);
  useEffect(() => {
    reviewApi<{ id: string; name: string }[]>("/approvals/v2/companies").then(setCompanies).catch(e => setError(e.message));
  }, []);
  useEffect(() => { if (!wideLayout) setExpanded(false); }, [wideLayout]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const wide = entries[0].contentRect.width >= 720;
      setWideLayout(wide);
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const units = context?.organization?.units || [];
  const path: string[] = [];
  let current = units.find(unit => unit.id === unitId);
  while (current && current.id !== context?.tenant && path.length < 3) {
    path.unshift(current.id);
    current = units.find(unit => unit.id === current?.parentId);
  }
  const unavailable = Boolean(unitId && !units.some(unit => unit.id === unitId));
  const departmentControls = ["一级部门", "二级部门", "三级部门"].map((label, index) => {
    const parent = index === 0 ? context?.tenant : path[index - 1];
    const children = parent ? units.filter(unit => unit.parentId === parent) : [];
    return <label key={label}>{label}<select aria-label={label} value={path[index] || (index === 0 && unitId === context?.tenant && children.length ? unitId : "")} disabled={disabled || !editing || !children.length} onChange={e => onUnitChange(e.target.value || parent)}>
      <option value="">{children.length ? "请选择（可留在上级组织）" : "无下级部门"}</option>
      {index === 0 && children.length > 0 && <option value={context?.tenant}>当前公司范围</option>}
      {children.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
    </select></label>;
  });
  return <section ref={container} className="review-author-org" aria-label="流程归属组织">
    <label>当前组织<select aria-label="当前组织" value={context?.tenant || ""} disabled={disabled} onChange={e => onCompanyChange(e.target.value)}>
      <option value="" disabled>请选择组织</option>
      {companies.map(company => <option value={company.id} key={company.id}>{company.name}</option>)}
    </select></label>
    {wideLayout ? departmentControls : <details className="review-departments" onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary>{expanded ? "部门选择" : path.map(id => units.find(unit => unit.id === id)?.name).join(" / ") || "部门选择（当前公司）"}</summary>
      <div className="review-department-controls">{departmentControls}</div>
    </details>}
    <button type="button" className="review-back review-quiet" aria-label="返回上一页" title="返回上一页" onClick={onBack} disabled={disabled}><span aria-hidden="true">←</span></button>
    {error && <p role="alert">组织列表加载失败：{error}</p>}
    {unavailable && <p role="alert">草稿归属组织已不可用，请重新选择后保存。</p>}
    {editing && !unitId && context?.organization?.units.length ? <p>未找到唯一主部门，请选择部门或当前公司范围。</p> : null}
  </section>;
}
