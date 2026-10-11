import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AdminProjectDeliveryResponse } from "../api";
import { apiErrorMessage } from "./kol-shared";
import "./admin-observability.css";

/** 管理端驾驶舱 · 项目交付看板。数据来自只读的 PG 聚合接口。 */
function formatAsOf(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export default function AdminProjectDelivery() {
  const [data, setData] = useState<AdminProjectDeliveryResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.adminProjectDelivery());
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const kpis = data?.kpis;
  const distributionLabel = data?.stage_distribution.map((item) => `${item.label} ${item.count}`).join("；") || "暂无阶段分布";

  return (
    <main className="admin-observability" aria-label="项目交付管理看板" aria-busy={loading}>
      <header className="ao-head">
        <div>
          <p className="ao-eyebrow">管理驾驶舱 · 只读聚合</p>
          <h2 className="ao-title">项目交付</h2>
          <p className="ao-description">查看在途项目的异常、逾期工单、待验收工单与正式阶段分布。</p>
        </div>
        <div className="ao-head-actions">
          {data ? <span className="ao-as-of">数据截至 {formatAsOf(data.as_of)}</span> : null}
          <button type="button" className="ao-text-action" onClick={() => void load()} disabled={loading}>
            {loading && data ? "正在刷新…" : "刷新数据"}
          </button>
        </div>
      </header>

      {loading ? (
        <section className="ao-resource-state" data-state="loading" role="status" aria-live="polite">
          <span className="ao-loading-mark">读取中</span>
          <div className="ao-resource-copy">
            <p className="ao-resource-title">正在读取项目交付聚合</p>
            <p>正在等待已授权的 PostgreSQL 汇总返回；完成前不会显示新的统计值。</p>
          </div>
        </section>
      ) : null}

      {error ? (
        <section className="ao-resource-state" data-state="error" role="alert">
          <div className="ao-resource-copy">
            <p className="ao-resource-title">项目交付暂时无法读取</p>
            <p>{error}{data ? " 下方保留上次成功读取的数据。" : ""}</p>
          </div>
          <button type="button" className="ao-text-action" onClick={() => void load()}>重新加载</button>
        </section>
      ) : null}

      {data && kpis ? <>
        <section className="ao-kpis" aria-label="项目交付核心指标">
          <article className="ao-kpi"><span className="ao-kpi-label">在途项目</span><strong className="ao-kpi-value">{kpis.active}</strong></article>
          <Link className="ao-kpi ao-kpi-link" data-tone={kpis.exception_count > 0 ? "danger" : undefined} to="/cooperations?stage=exception"><span className="ao-kpi-label">异常项目</span><strong className="ao-kpi-value">{kpis.exception_count}</strong></Link>
          <article className="ao-kpi" data-tone={kpis.overdue_count > 0 ? "warning" : undefined}><span className="ao-kpi-label">有逾期工单</span><strong className="ao-kpi-value">{kpis.overdue_count}</strong></article>
          <article className="ao-kpi"><span className="ao-kpi-label">待验收工单</span><strong className="ao-kpi-value">{kpis.pending_acceptance}</strong></article>
          <article className="ao-kpi"><span className="ao-kpi-label">本周完成</span><strong className="ao-kpi-value">{kpis.completed_this_week}</strong></article>
          <article className="ao-kpi"><span className="ao-kpi-label">按期交付率</span><strong className="ao-kpi-value">{kpis.on_time_rate ?? "—"}{kpis.on_time_rate != null ? <span className="ao-kpi-suffix">%</span> : null}</strong></article>
        </section>

        <section className="ao-panel" aria-labelledby="delivery-exception-title">
          <div className="ao-section-head"><h3 id="delivery-exception-title">异常队列</h3><p>正式 exception 态 · 按停留时长排序，待人工处理异常</p></div>
          {data.exceptions.length ? <div className="ao-table-wrap" tabIndex={0}>
            <table className="ao-table">
              <thead><tr><th scope="col">项目</th><th scope="col">异常类型</th><th scope="col">停留</th><th scope="col" data-mobile-hidden="true">负责人</th></tr></thead>
              <tbody>{data.exceptions.map((item) => <tr key={item.id}>
                <td><Link className="ao-table-title ao-inline-link" title={item.title} to={`/cooperations?id=${encodeURIComponent(item.id)}`}>{item.title}</Link></td>
                <td><span className="ao-chip" data-state="danger">{item.exception_label || item.exception_kind || "异常"}</span></td>
                <td className="ao-table-number"><span className="ao-exception-stay">{item.stay_days} 天</span></td>
                <td data-mobile-hidden="true">{item.owner_principal_id || "—"}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="ao-empty">暂无异常项目</p>}
        </section>

        <section className="ao-panel" aria-labelledby="delivery-distribution-title">
          <div className="ao-section-head"><h3 id="delivery-distribution-title">阶段分布</h3><p>正式阶段在途分布（不含异常）</p></div>
          {data.stage_distribution.length ? <div className="ao-distribution">
            <div className="ao-distribution-bar" role="img" aria-label={distributionLabel}>
              {data.stage_distribution.map((item) => <span key={item.stage} className="ao-distribution-segment" data-zero={item.count === 0} title={`${item.label}：${item.count}`} style={{ flexGrow: Math.max(item.count, 1) }} />)}
            </div>
            <ul className="ao-distribution-legend">
              {data.stage_distribution.map((item) => <li key={item.stage}><span className="ao-legend-marker" aria-hidden="true" /><Link className="ao-inline-link" to={`/cooperations?stage=${encodeURIComponent(item.stage)}`}>{item.label}</Link><b>{item.count}</b></li>)}
            </ul>
          </div> : <p className="ao-empty">暂无阶段分布</p>}
        </section>

        <div className="ao-two-column">
          <section className="ao-panel" aria-labelledby="delivery-overdue-title">
            <div className="ao-section-head"><h3 id="delivery-overdue-title">逾期预警</h3><p>工单 due_at 已过且未终态</p></div>
            {data.overdue.length ? <div className="ao-table-wrap" tabIndex={0}>
              <table className="ao-table">
                <thead><tr><th scope="col">项目</th><th scope="col">工单</th><th scope="col">逾期</th><th scope="col" data-mobile-hidden="true">负责人</th></tr></thead>
                <tbody>{data.overdue.map((item) => <tr key={item.wo_id}>
                  <td><Link className="ao-table-title ao-inline-link" title={item.coop_title} to={`/cooperations?id=${encodeURIComponent(item.coop_id)}`}>{item.coop_title}</Link></td>
                  <td><span className="ao-table-title" title={item.wo_title}>{item.wo_title}</span></td>
                  <td className="ao-table-number"><span className="ao-overdue">{item.overdue_days} 天</span></td>
                  <td data-mobile-hidden="true">{item.owner_principal_id || "—"}</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="ao-empty">暂无逾期</p>}
          </section>

          <section className="ao-panel" aria-labelledby="delivery-acceptance-title">
            <div className="ao-section-head"><h3 id="delivery-acceptance-title">待验收</h3><p>ready_for_acceptance</p></div>
            {data.pending_acceptance.length ? <div className="ao-table-wrap" tabIndex={0}>
              <table className="ao-table">
                <thead><tr><th scope="col">项目</th><th scope="col">工单</th><th scope="col">等待</th></tr></thead>
                <tbody>{data.pending_acceptance.map((item) => <tr key={item.wo_id}>
                  <td><Link className="ao-table-title ao-inline-link" title={item.coop_title} to={`/cooperations?id=${encodeURIComponent(item.coop_id)}`}>{item.coop_title}</Link></td>
                  <td><span className="ao-table-title" title={item.wo_title}>{item.wo_title}</span></td>
                  <td className="ao-table-number">{item.waiting_days} 天</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="ao-empty">暂无待验收</p>}
          </section>
        </div>
      </> : null}
    </main>
  );
}
