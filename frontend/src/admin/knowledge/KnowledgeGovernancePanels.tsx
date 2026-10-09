import { Link } from "react-router-dom";
import { kbExpiryLabel } from "../../knowledgeCopy";
import type { WsData } from "./shared";

type Props = {
  data: WsData | null;
  error: string;
  reload: () => void;
  onPendingDocuments: () => void;
  onScope: (level: "family" | "domain" | "base", id: string) => void;
  /** 「30 天内到期」下钻：打开中栏到期筛选（与队列计数同口径）。 */
  onExpiring: () => void;
};

/**
 * 知识资产 Tab（右栏）：治理驾驶舱。
 * - 健康队列：加工失败 / 待审资料 / 30 天内到期，点行即到可处置的位置（加工页重试 / 中栏筛选）。
 * - 分类分布：业务族 / 业务域 / 知识库，行内比例条，点行按下钻筛选中栏。
 * - 状态分布条已移至中栏顶部（AssetStatStrip），此处不再重复。
 * 全部计数来自 workspace-v1 stats/facets，与中栏列表同源。
 */
export function KnowledgeAssetsPanel({ data, error, reload, onPendingDocuments, onScope, onExpiring }: Props) {
  if (error) return <p role="alert">资产统计读取失败：{error} <button className="kbv-text-action" onClick={reload}>重试</button></p>;
  if (!data) return <p role="status">正在读取知识资产统计…</p>;
  const stats = data.stats;
  const failed = stats.status.failed || 0;
  const pendingDocs = stats.pending_documents;
  const expiring = stats.expiring;
  const queue: Array<{
    key: string; label: string; count: number; hint: React.ReactNode;
    action: (() => void) | string; dot: string;
  }> = [];
  if (failed > 0) queue.push({
    key: "failed", label: "加工失败", count: failed,
    hint: "资料解析或转码失败，到知识加工重试。",
    action: "/admin/knowledge?stage=processing", dot: "var(--danger)",
  });
  queue.push({
    key: "documents", label: "待审资料", count: pendingDocs.count,
    hint: <>解析完成，等待发布审批。{pendingDocs.max_wait_days > 0 ? <>最长等待 <b>{pendingDocs.max_wait_days} 天</b></> : null}</>,
    action: onPendingDocuments, dot: "var(--warning)",
  });
  queue.push({
    key: "expiry", label: "30 天内到期", count: expiring.count,
    hint: expiring.nearest ? kbExpiryLabel(expiring.nearest) : "需要续期或归档",
    action: onExpiring, dot: "var(--accent)",
  });

  const groups = ([
    ['family', '业务族', data.domains.filter(item => item.level === 'family')],
    ['domain', '业务域', data.domains.filter(item => item.level === 'domain')],
    ['base', '知识库', data.bases],
  ] as const);

  return <section className="knowledge-assets-summary" data-knowledge-assets>
    <header className="kbadmin-status-head"><h3>知识资产</h3><span className="muted">当前组织 · 全局共 {data.total} 条</span></header>

    <nav className="kbadmin-queue" data-kb-asset-queue aria-label="资产健康队列">
      {queue.map(row => {
        const inner = (<>
          <span className="kbv-asset-dot" style={{ background: row.dot }} aria-hidden="true" />
          <span className="kbadmin-queue-label">{row.label}<small className="muted">{row.hint}</small></span>
          <span className="kbadmin-queue-count">{row.count}</span>
          <span className="kbadmin-queue-go">查看 →</span>
        </>);
        return typeof row.action === "string" ? (
          <Link key={row.key} className="kbadmin-queue-row" data-kb-queue={row.key} to={row.action}>{inner}</Link>
        ) : (
          <button key={row.key} type="button" className="kbadmin-queue-row" data-kb-queue={row.key} onClick={row.action}>{inner}</button>
        );
      })}
    </nav>

    <div className="knowledge-asset-facets">
      {groups.map(([level, label, options]) => {
        const rows = options.map(item => ({ id: item.id, name: item.name, count: data.facets[level]?.values[item.id] || 0 }));
        const unclassified = data.facets[level]?.values.__none__ || 0;
        if (unclassified > 0) rows.push({ id: "__none__", name: "未分类", count: unclassified });
        const max = Math.max(1, ...rows.map(r => r.count));
        return <section key={level} aria-label={label}>
          <h3>{label}</h3>
          {rows.length ? rows.map(item => (
            <button key={item.id} className="knowledge-summary-row has-bar" type="button"
              data-kb-dist={`${level}:${item.id}`} title={`按「${item.name}」筛选中栏`} onClick={() => onScope(level, item.id)}>
              <span className="ksr-main"><span className="ksr-name">{item.name}</span><span className="ksr-count">{item.count}</span></span>
              <span className="ksr-bar" aria-hidden="true"><i style={{ width: `${Math.round((item.count / max) * 100)}%` }} /></span>
            </button>
          )) : <p className="muted">尚无{label}。</p>}
        </section>;
      })}
    </div>
    <p className="knowledge-panel-help">点队列行到可处置的位置，点分类行筛选中栏；状态分布在中栏顶部，点段即按状态筛选。选择知识查看内容、来源、版本和发布信息。</p>
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
    </div> : <p className="muted">当前组织尚无已接通的知识关系投影；可先在知识规划配置分类，在查询技能中查看绑定与试算。</p>}
  </section>;
}
