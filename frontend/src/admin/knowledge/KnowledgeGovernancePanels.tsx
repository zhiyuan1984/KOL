import { kbDocStatusLabel, kbStatusSegments } from "../../knowledgeCopy";
import type { KbView } from "./LibraryPane";
import type { WsData } from "./shared";

type Props = { data: WsData | null; error: string; reload: () => void; onView: (view: KbView) => void; onScope: (level: "family" | "domain" | "base", id: string) => void };
export function KnowledgeAssetsPanel({ data, error, reload, onView, onScope }: Props) {
  if (error) return <p role="alert">资产统计读取失败：{error} <button className="kbv-text-action" onClick={reload}>重试</button></p>;
  if (!data) return <p role="status">正在读取知识资产统计…</p>;
  const s = data.stats.status;
  const segments = kbStatusSegments({ draft: s.draft || 0, pending: s.pending_review || 0, published: s.published || 0, archived: s.archived || 0, total: data.total });
  const otherStates = Object.entries(s).filter(([key, count]) => !["draft", "pending_review", "published", "archived"].includes(key) && count > 0);
  const groups = ([['family', '业务族', data.domains.filter(item => item.level === 'family')], ['domain', '业务域', data.domains.filter(item => item.level === 'domain')], ['base', '知识库', data.bases]] as const);
  return <section className="knowledge-assets-summary" data-knowledge-assets>
    <header className="kbadmin-status-head"><h3>知识资产</h3><span className="muted">当前组织 · 全局共 {data.total} 条</span></header>
    <div className="kbadmin-status-bar" role="group" aria-label="按资产状态筛选">
      {segments.map(item => <button key={item.key} type="button" className={`kbadmin-status-seg is-${item.key}`}
        data-kb-status={item.key} style={{ flexGrow: Math.max(item.value, 1) }} onClick={() => onView(item.view as KbView)}>
        <span>{item.label}</span><strong className="kbadmin-status-count">{item.value}</strong>
      </button>)}
      {otherStates.map(([key, count]) => <span key={key} className="kbadmin-status-seg" data-kb-status={key} style={{flexGrow:Math.max(count,1)}}>
        <span>{kbDocStatusLabel(key)}</span><strong className="kbadmin-status-count">{count}</strong>
      </span>)}
    </div>
    <div className="knowledge-asset-facets">
      {groups.map(([level, label, options]) => <section key={level}>
        <h3>{label}</h3>
        {options.length ? options.map(item => <button key={item.id} className="knowledge-summary-row" type="button" onClick={() => onScope(level, item.id)}>
          <span>{item.name}</span><span>{data.facets[level]?.values[item.id] || 0}</span>
        </button>) : <p className="muted">尚无{label}。</p>}
        {data.facets[level]?.values.__none__ ? <button className="knowledge-summary-row" type="button" onClick={() => onScope(level, '__none__')}><span>未分类</span><span>{data.facets[level].values.__none__}</span></button> : null}
      </section>)}
    </div>
    <p className="knowledge-panel-help">点可操作状态或分类筛选中栏；加工状态为只读分布，详情和恢复操作在知识加工。选择知识查看内容、来源、版本和发布信息。</p>
  </section>;
}

export function KnowledgeGraphPanel({ data, error, reload }: Pick<Props, "data" | "error" | "reload">) {
  if (error) return <p role="alert">关系数据读取失败：{error} <button className="kbv-text-action" onClick={reload}>重试</button></p>;
  if (!data) return <p role="status">正在读取知识关系…</p>;
  const graph = data.governance;
  return <section data-kb-knowledge-graph>
    <h3>知识关系</h3>
    <p className="knowledge-panel-help">分类主数据 → 知识资产 → 技能 → Agent；以下使用服务端已接通的关系投影，不代表全部知识库。</p>
    {graph ? <div className="kbadmin-graph-path">
      <span>{graph.family_name || "未分类"}</span><b>→</b><span>{graph.domain_name || "未分类"}</span><b>→</b><strong>{graph.base_name}</strong>
      <b>→</b><span>文档 {graph.document_count}（范围 {graph.scoped_document_count}）</span><b>→</b><span>技能 {graph.skill_count}</span><b>→</b><span>Agent {graph.agent_count}</span>
    </div> : <p className="muted">当前组织尚无已接通的知识关系投影；可先在知识目录配置分类，在查询技能中查看绑定与试算。</p>}
  </section>;
}
