import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AdminLeadFunnelResponse } from "../api";
import { apiErrorMessage, LEAD_STAGE_LABELS } from "./kol-shared";
import "./admin-observability.css";

/** 管理端驾驶舱 · 线索漏斗看板。数据来自只读的 PG 聚合接口。 */
function formatAsOf(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export default function AdminLeadFunnel() {
  const [data, setData] = useState<AdminLeadFunnelResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.adminLeadFunnel());
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const kpis = data?.kpis;
  const maxFunnel = Math.max(1, ...(data?.funnel.map((item) => item.count) ?? []));
  const firstContactPublished = data?.rules.first_contact_template?.status === "published";

  const auditLeadId = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return null;
    const candidate = payload as { lead_id?: unknown; id?: unknown; object_id?: unknown };
    for (const value of [candidate.lead_id, candidate.id, candidate.object_id]) {
      if (typeof value === "string" && value) return value;
    }
    return null;
  };

  return (
    <main className="admin-observability" aria-label="线索漏斗管理看板" aria-busy={loading}>
      <header className="ao-head">
        <div>
          <p className="ao-eyebrow">管理驾驶舱 · 只读聚合</p>
          <h2 className="ao-title">线索漏斗</h2>
          <p className="ao-description">查看当前线索存量、阶段转化与超过 14 天未推进的线索。</p>
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
            <p className="ao-resource-title">正在读取线索漏斗聚合</p>
            <p>正在等待已授权的 PostgreSQL 汇总返回；完成前不会显示新的统计值。</p>
          </div>
        </section>
      ) : null}

      {error ? (
        <section className="ao-resource-state" data-state="error" role="alert">
          <div className="ao-resource-copy">
            <p className="ao-resource-title">线索漏斗暂时无法读取</p>
            <p>{error}{data ? " 下方保留上次成功读取的数据。" : ""}</p>
          </div>
          <button type="button" className="ao-text-action" onClick={() => void load()}>重新加载</button>
        </section>
      ) : null}

      {data && kpis ? <>
        <section className="ao-kpis" aria-label="线索核心指标">
          <article className="ao-kpi"><span className="ao-kpi-label">线索总数</span><strong className="ao-kpi-value">{kpis.total}</strong></article>
          <article className="ao-kpi"><span className="ao-kpi-label">在跟进（未终态）</span><strong className="ao-kpi-value">{kpis.active}<span className="ao-kpi-suffix">/ {kpis.total}</span></strong></article>
          <article className="ao-kpi"><span className="ao-kpi-label">漏斗转化率</span><strong className="ao-kpi-value">{kpis.conversion_rate ?? "—"}{kpis.conversion_rate != null ? <span className="ao-kpi-suffix">%</span> : null}</strong></article>
          <article className="ao-kpi"><span className="ao-kpi-label">平均阶段停留</span><strong className="ao-kpi-value">{kpis.avg_stay_days ?? "—"}{kpis.avg_stay_days != null ? <span className="ao-kpi-suffix">天</span> : null}</strong></article>
          <article className="ao-kpi" data-tone={kpis.stuck_count > 0 ? "warning" : undefined}><span className="ao-kpi-label">停留超 14 天</span><strong className="ao-kpi-value">{kpis.stuck_count}</strong></article>
          <article className="ao-kpi"><span className="ao-kpi-label">本月已转化</span><strong className="ao-kpi-value">{kpis.converted_this_month}</strong></article>
        </section>

        <section className="ao-panel" aria-labelledby="lead-funnel-stage-title">
          <div className="ao-section-head">
            <h3 id="lead-funnel-stage-title">阶段漏斗</h3>
            <p>现存人数 / 近 30 天到下一阶段转化率</p>
          </div>
          <div className="ao-funnel-grid">
            {data.funnel.map((item) => (
              <Link className="ao-funnel-stage-link" to={`/leads?stage=${encodeURIComponent(item.stage)}`} key={item.stage}>
                <article className="ao-funnel-stage" data-stage={item.stage} data-terminal={item.terminal}>
                  <div className="ao-funnel-stage-head"><h4 title={item.label}>{item.label}</h4><strong>{item.count}</strong></div>
                  <progress className="ao-funnel-progress" max={maxFunnel} value={item.count}>{item.count}</progress>
                  <p className="ao-funnel-meta">{item.terminal ? "当前阶段为终态" : item.conversion_to_next != null ? `近 30 天推进 ${item.conversion_to_next}%` : "下一阶段转化率暂无数据"}</p>
                </article>
              </Link>
            ))}
          </div>
        </section>

        <div className="ao-two-column">
          <section className="ao-panel" aria-labelledby="lead-stuck-title">
            <div className="ao-section-head"><h3 id="lead-stuck-title">停留异常</h3><p>超过 14 天未推进</p></div>
            {data.stuck.length ? <div className="ao-table-wrap" tabIndex={0}>
              <table className="ao-table">
                <thead><tr><th scope="col">线索</th><th scope="col">阶段</th><th scope="col">停留</th><th scope="col" data-mobile-hidden="true">负责人</th></tr></thead>
                <tbody>{data.stuck.map((item) => <tr key={item.id}>
                  <td><Link className="ao-table-title ao-inline-link" title={item.display_name} to={`/leads?id=${encodeURIComponent(item.id)}`}>{item.display_name}</Link></td>
                  <td><span className="ao-chip" data-state="accent">{LEAD_STAGE_LABELS[item.lead_stage] || item.lead_stage}</span></td>
                  <td className="ao-table-number"><span className="ao-stay" data-alert="true">{item.stay_days} 天</span></td>
                  <td data-mobile-hidden="true">{item.owner_principal_id || "—"}</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="ao-empty">暂无停留异常</p>}
          </section>

          <section className="ao-panel" aria-labelledby="lead-loss-title">
            <div className="ao-section-head"><h3 id="lead-loss-title">流失分析</h3><p>拒绝 / 归档原因</p></div>
            {data.loss.length ? <div className="ao-table-wrap" tabIndex={0}>
              <table className="ao-table">
                <thead><tr><th scope="col">原因</th><th scope="col" className="ao-table-number">拒绝</th><th scope="col" className="ao-table-number">归档</th></tr></thead>
                <tbody>{data.loss.map((item) => <tr key={item.reason}>
                  <td><span className="ao-table-title" title={item.reason}>{item.reason}</span></td>
                  <td className="ao-table-number">{item.rejected}</td><td className="ao-table-number">{item.archived}</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="ao-empty">暂无流失</p>}
          </section>
        </div>

        <div className="ao-two-column">
          <section className="ao-panel" aria-labelledby="lead-rules-title">
            <div className="ao-section-head"><h3 id="lead-rules-title">规则配置</h3><p>线索域自动化规则</p></div>
            <ul className="ao-rule-list">
              <li className="ao-rule"><div className="ao-rule-copy"><h4>初次建联工单自动创建</h4><p className="ao-rule-description">{data.rules.first_contact_template ? `${data.rules.first_contact_template.title} · ${data.rules.first_contact_template.template_code} v${data.rules.first_contact_template.version} · 状态 ${data.rules.first_contact_template.status}` : "未配置模板"}</p></div><span className="ao-status" data-state={firstContactPublished ? "published" : "unpublished"}>{firstContactPublished ? "模板已发布" : "未发布"}</span></li>
              <li className="ao-rule"><div className="ao-rule-copy"><h4>阶段约束：已转化锁定</h4><p className="ao-rule-description">{data.rules.converted_lock.note}</p></div><span className="ao-status" data-state={data.rules.converted_lock.enabled ? "enabled" : "disabled"}>{data.rules.converted_lock.enabled ? "已启用" : "未启用"}</span></li>
            </ul>
          </section>

          <section className="ao-panel" aria-labelledby="lead-audit-title">
            <div className="ao-section-head"><h3 id="lead-audit-title">审计 · 最近阶段变更</h3><p>lead.stage_changed / lead.archived</p></div>
            {data.audit.length ? <ol className="ao-audit">{data.audit.map((item, index) => {
              const payload = (item.payload || {}) as { from_stage?: string; to_stage?: string; archived_reason?: string };
              const description = item.event_type === "lead.stage_changed"
                ? `从 ${LEAD_STAGE_LABELS[payload.from_stage || ""] || payload.from_stage || "—"} → ${LEAD_STAGE_LABELS[payload.to_stage || ""] || payload.to_stage || "—"}`
                : item.event_type === "lead.archived" ? `归档${payload.archived_reason ? `（${payload.archived_reason}）` : ""}` : item.event_type;
              const leadId = auditLeadId(item.payload);
              return <li key={`${item.occurred_at}-${item.display_name}-${index}`}><span className="ao-audit-summary">{item.actor_id || "—"} · {leadId ? <Link className="ao-inline-link" to={`/leads?id=${encodeURIComponent(leadId)}`}><strong>{item.display_name}</strong></Link> : <strong>{item.display_name}</strong>} · {description}</span><time dateTime={item.occurred_at}>{formatAsOf(item.occurred_at)}</time></li>;
            })}</ol> : <p className="ao-empty">暂无审计记录</p>}
          </section>
        </div>
      </> : null}
    </main>
  );
}
