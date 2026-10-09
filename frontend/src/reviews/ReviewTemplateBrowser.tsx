import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { useEffect, useState } from "react";
import type { ReviewDefinition, ReviewStarter, ReviewTemplate } from "../../../shared/review";
import { reviewApi, type ReviewContext } from "./api";

export function ReviewTemplateBrowser({ list, context, busy, creating, onCancel, onCreate, onEdit, onCopy, onToggle }: {
  list: ReviewTemplate[]; context?: ReviewContext; busy: boolean; creating: boolean;
  onCancel: () => void; onCreate: (definition?: ReviewDefinition) => void; onEdit: (template: ReviewTemplate) => void;
  onCopy: (template: ReviewTemplate, source: "draft" | "published") => void; onToggle: (template: ReviewTemplate) => void;
}) {
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all"), [selectedId, setSelectedId] = useState("");
  const [starters, setStarters] = useState<ReviewStarter[]>([]), [error, setError] = useState(""), [retry, setRetry] = useState(0), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!creating) return;
    let live = true; setLoading(true); setError("");
    reviewApi<ReviewStarter[]>("/admin/approval-types/v2/starters").then(rows => { if (live) setStarters(rows); })
      .catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [creating, retry]);
  const rows = list.filter(t => (!query || `${t.definition.name} ${t.definition.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    && (filter === "all" || filter === "draft" && (!t.publishedVersion || t.hasUnpublishedChanges) || filter === "enabled" && t.publishedVersion && t.enabled !== false || filter === "disabled" && t.publishedVersion && t.enabled === false));
  const selected = rows.find(t => t.id === selectedId) || rows[0];
  if (creating) return <section className="review-create-picker" aria-label="创建流程方式">
    <header className="review-toolbar"><h2>新建流程</h2><button onClick={onCancel}>返回流程列表</button></header>
    <p className="review-muted">套用模板、复制现有流程或空白创建。新流程均为 R2 草稿，核对规则并确认发布后员工才能使用。</p>
    <div className="review-creation-options">
      <section aria-label="套用模板"><h3>套用模板</h3>{loading && <p role="status">正在读取流程起点…</p>}
        {error && <p role="alert">{error}<button onClick={() => setRetry(retry + 1)}>重试模板加载</button></p>}
        <ul className="review-starter-list">{starters.map(s => <li key={s.id}><button disabled={busy} onClick={() => onCreate(structuredClone(s.definition))}><strong>{s.name}</strong><span>{s.description}</span></button></li>)}</ul>
      </section>
      <section aria-label="复制或自定义"><h3>复制现有流程</h3><p className="review-muted">复制材料和规则，创建独立草稿；原流程及已有申请保持各自版本。</p>
        <ul className="review-starter-list">{list.map(t => <li key={t.id}><strong>{t.definition.name}</strong><div className="review-toolbar">
          <button disabled={busy || !t.publishedVersion} onClick={() => onCopy(t, "published")}>复制发布版 v{t.publishedVersion || "—"}</button>
          <button disabled={busy} onClick={() => onCopy(t, "draft")}>复制草稿 v{t.version}</button></div></li>)}</ul>
        {!list.length && <p>尚无可复制流程。</p>}<h3>空白创建</h3><p className="review-muted">从“发起 → 负责人评审 → 结束”开始，按需添加字段、分支和办理。</p><button disabled={busy} onClick={() => onCreate()}>从空白创建</button>
      </section>
    </div>
  </section>;
  return <div className="review-workspace review-template-browser">
    <section className="review-list-pane" aria-label="流程列表区域">
      <div className="review-toolbar review-list-tools"><WorkspaceSearchInput aria-label="搜索流程" placeholder="搜索流程名称或说明" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="流程状态筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部流程</option><option value="enabled">已发布 · 可使用</option><option value="draft">待发布草稿</option><option value="disabled">已停用</option></select></div>
      <p className="review-muted">共 {rows.length} 个流程 · 草稿和发布版分别管理</p>
      {!rows.length ? <p>暂无匹配流程。可清空筛选或新建流程。</p> : <table className="review-table"><thead><tr><th>流程名称</th><th>草稿版本</th><th>已发布版本</th><th>版本关系</th></tr></thead>
        <tbody>{rows.map(t => <tr key={t.id} aria-selected={selected?.id === t.id} onClick={() => setSelectedId(t.id)}><td><button className="review-row-title" onClick={() => setSelectedId(t.id)}>{t.definition.name || "未命名流程"}</button></td>
          <td>v{t.version}</td><td>{t.publishedVersion ? `v${t.publishedVersion} · ${t.enabled === false ? "已停用" : "可使用"}` : "未发布"}</td><td>{!t.publishedVersion ? "未发布" : t.version === t.publishedVersion || t.hasUnpublishedChanges === false ? "与发布版一致" : "有未发布修改"}</td></tr>)}</tbody></table>}
    </section>
    {selected && <section className="review-detail" aria-label="流程摘要"><header className="review-detail-head"><h2>{selected.definition.name || "未命名流程"}</h2></header>
      <div className="review-detail-body"><p>{selected.definition.description || "尚未填写适用说明"}</p>
        <dl className="review-values"><div><dt>归属组织</dt><dd>{context?.organization?.units.find(u => u.id === selected.definition.organizationUnitId)?.name || "公司范围"}</dd></div><div><dt>员工使用</dt><dd>{selected.publishedVersion && selected.enabled !== false ? `已发布 v${selected.publishedVersion}` : selected.enabled === false ? "已停用，新申请不可发起" : "尚未发布，员工不可使用"}</dd></div></dl>
        <section><h3>申请材料</h3><ul>{selected.definition.fields.map(f => <li key={f.id}>{f.label} · {f.required ? "必填" : "可选"}</li>)}</ul>{!selected.definition.fields.length && <p>未配置附加材料</p>}</section>
        <section><h3>审批与办理步骤 · 草稿 v{selected.version}</h3><ol>{selected.definition.nodes.filter(n => !["start", "end"].includes(n.type)).map(n => <li key={n.id}>{n.name}{n.type === "handler" ? " · 人工办理" : n.type === "condition" ? " · 按材料分支" : n.assignee?.kind === "requester_choice" ? " · 员工在发布范围内选人" : ""}</li>)}</ol></section>
        <p className="review-muted">编辑草稿不影响已发布版本；新版本只用于新申请。</p>
      </div><footer className="review-action-bar review-toolbar"><button disabled={busy} onClick={() => onEdit(selected)}>编辑流程</button><button disabled={busy} onClick={() => onCopy(selected, selected.publishedVersion ? "published" : "draft")}>复制流程</button>
        {selected.publishedVersion && <button disabled={busy} onClick={() => onToggle(selected)}>{selected.enabled === false ? "启用流程" : "停用流程"}</button>}</footer>
    </section>}
  </div>;
}
