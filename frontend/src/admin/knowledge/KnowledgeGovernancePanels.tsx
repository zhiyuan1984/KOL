import { Link } from "react-router-dom";
import { useState } from "react";
import { kbExpiryLabel } from "../../knowledgeCopy";
import type { WsData } from "./shared";
import "./asset-distribution.css";

type ScopeLevel = "family" | "domain" | "base";
type Props = {
  data: WsData | null;
  error: string;
  reload: () => void;
  onPendingDocuments: () => void;
  onScope: (level: ScopeLevel, id: string) => void;
  /** 「30 天内到期」下钻：打开中栏到期筛选（与队列计数同口径）。 */
  onExpiring: () => void;
};

type DistributionRow = { id: string; name: string; count: number };
type Distribution = { level: ScopeLevel; label: string; all: number; rows: DistributionRow[] };

/** 统计缺失不是零：只接受服务端返回的非负有限数。 */
function statCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function percentOf(count: number, all: number): string {
  if (!all) return "—";
  const value = (count / all) * 100;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function distribution(
  data: WsData,
  level: ScopeLevel,
  label: string,
  categories: Array<{ id: string; name: string }>,
): Distribution | null {
  const facet = data.facets?.[level];
  const all = statCount(facet?.all);
  const values = facet?.values;
  if (all === null || !values || typeof values !== "object") return null;

  const candidates = [
    ...categories,
    {
      id: "__none__",
      name: level === "family" ? "未归属业务族" : level === "domain" ? "未归属业务域" : "未归属知识库",
    },
  ];
  const rows: DistributionRow[] = [];
  for (const candidate of candidates) {
    // workspace-v1 的可用 facet 为稀疏映射：缺少某个已知分类即真实的零值；
    // 但字段存在却不是计数时，整组统计不可用，绝不伪造成 0。
    const count = hasOwn(values, candidate.id) ? statCount(values[candidate.id]) : 0;
    if (count === null) return null;
    rows.push({ ...candidate, count });
  }
  rows.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"));
  return { level, label, all, rows };
}

/**
 * 知识资产 Tab（右栏）：治理驾驶舱。
 * - 健康队列：加工失败 / 待审资料 / 30 天内到期，点行即到可处置的位置（加工页重试 / 中栏筛选）。
 * - 分类分布：业务族 / 业务域 / 知识库，行内比例条，点行按下钻筛选中栏。
 * - 状态分布条已移至中栏顶部（AssetStatStrip），此处不再重复。
 * 全部计数来自 workspace-v1 stats/facets，与中栏列表同源。
 */
export function KnowledgeAssetsPanel({ data, error, reload, onPendingDocuments, onScope, onExpiring }: Props) {
  const [showEmptyCategories, setShowEmptyCategories] = useState(false);
  if (error) return <p role="alert">资产统计读取失败：{error} <button className="kbv-text-action" onClick={reload}>重试</button></p>;
  if (!data) return <p role="status">正在读取知识资产统计…</p>;
  const stats = data.stats as Partial<WsData["stats"]> | null | undefined;
  const status = stats?.status;
  // status 是服务端的稀疏 map：有效 map 中没有 failed 即真实的 0，不能报为统计缺失。
  const failed = status && typeof status === "object" && !Array.isArray(status)
    ? hasOwn(status, "failed") ? statCount(status.failed) : 0
    : null;
  const pendingDocs = stats?.pending_documents;
  const pendingCount = statCount(pendingDocs?.count);
  const pendingMaxWaitDays = statCount(pendingDocs?.max_wait_days);
  const expiring = stats?.expiring;
  const expiringCount = statCount(expiring?.count);
  const queue: Array<{
    key: string; label: string; count: number | null; hint: string;
    action: (() => void) | string; dot: string;
  }> = [{
    key: "failed", label: "加工失败", count: failed,
    hint: failed === null ? "统计暂不可用。" : "资料解析或转码失败，到知识加工重试。",
    action: "/admin/knowledge?stage=processing", dot: "var(--danger)",
  }, {
    key: "documents", label: "待审资料", count: pendingCount,
    hint: pendingCount === null
      ? "统计暂不可用。"
      : `解析完成，等待发布审批。${pendingMaxWaitDays && pendingMaxWaitDays > 0 ? `最长等待 ${pendingMaxWaitDays} 天` : ""}`,
    action: onPendingDocuments, dot: "var(--warning)",
  }, {
    key: "expiry", label: "30 天内到期", count: expiringCount,
    hint: expiringCount === null ? "统计暂不可用。" : expiring?.nearest ? kbExpiryLabel(expiring.nearest) : "需要续期或归档",
    action: onExpiring, dot: "var(--accent)",
  }];

  const distributions = [
    distribution(data, "family", "业务族", (data.domains || []).filter(item => item.level === "family")),
    distribution(data, "domain", "业务域", (data.domains || []).filter(item => item.level === "domain")),
    distribution(data, "base", "知识库", data.bases || []),
  ];
  const hasEmptyCategories = distributions.some(group => group?.rows.some(row => row.count === 0));
  const globalTotal = statCount(data.total);

  return <section className="knowledge-assets-summary" data-knowledge-assets>
    <header className="kbadmin-status-head knowledge-assets-head">
      <div><h3>知识资产分布</h3><span className="muted">{globalTotal === null ? "当前组织 · 全局统计暂不可用" : `当前组织 · 全局共 ${globalTotal} 条`}</span></div>
      <button type="button" className="kbv-text-action knowledge-assets-refresh" onClick={reload}>刷新统计</button>
    </header>
    <p className="knowledge-assets-scope muted">分类分布使用当前权限范围全局统计；中栏数量为当前筛选结果，计数范围不同。</p>

    <nav className="kbadmin-queue" data-kb-asset-queue aria-label="资产健康队列">
      {queue.map(row => {
        const inner = (<>
          <span className="kbv-asset-dot" style={{ background: row.dot }} aria-hidden="true" />
          <span className="kbadmin-queue-label">{row.label}<small className="muted">{row.hint}</small></span>
          <span className="kbadmin-queue-count">{row.count === null ? "统计暂不可用" : row.count}</span>
          <span className="kbadmin-queue-go">查看 →</span>
        </>);
        return typeof row.action === "string" ? (
          <Link key={row.key} className="kbadmin-queue-row" data-kb-queue={row.key} to={row.action}>{inner}</Link>
        ) : (
          <button key={row.key} type="button" className="kbadmin-queue-row" data-kb-queue={row.key} onClick={row.action}>{inner}</button>
        );
      })}
    </nav>

    {hasEmptyCategories ? <button type="button" className="kbv-text-action knowledge-empty-toggle" data-kb-empty-toggle aria-expanded={showEmptyCategories} onClick={() => setShowEmptyCategories(value => !value)}>
      {showEmptyCategories ? "收起空分类" : "显示空分类"}
    </button> : null}

    <div className="knowledge-asset-facets">
      {distributions.map((group, index) => {
        const fallbackLevel: ScopeLevel = index === 0 ? "family" : index === 1 ? "domain" : "base";
        const fallbackLabel = fallbackLevel === "family" ? "业务族" : fallbackLevel === "domain" ? "业务域" : "知识库";
        if (!group) return <section key={fallbackLevel} aria-label={fallbackLabel}>
          <h3>{fallbackLabel}</h3><p className="muted">统计暂不可用。</p>
        </section>;
        const rows = showEmptyCategories ? group.rows : group.rows.filter(item => item.count > 0);
        return <section key={group.level} aria-label={group.label}>
          <h3>{group.label}</h3>
          {rows.length ? rows.map(item => (
            <button key={item.id} className="knowledge-summary-row has-bar" type="button"
              data-kb-dist={`${group.level}:${item.id}`} title={`按「${item.name}」筛选中栏`} onClick={() => onScope(group.level, item.id)}>
              <span className="ksr-name" title={item.name}>{item.name}</span>
              <span className="ksr-bar" aria-hidden="true"><i style={{ width: `${group.all ? Math.min(100, (item.count / group.all) * 100) : 0}%` }} /></span>
              <span className="ksr-meta"><span className="ksr-count">{item.count}</span><span className="ksr-ratio">{percentOf(item.count, group.all)}</span></span>
            </button>
          )) : <p className="muted">当前全局统计中无非零{group.label}分类。</p>}
        </section>;
      })}
    </div>
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
