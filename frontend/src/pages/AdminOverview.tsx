import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type AdminAuditEvent, type ExecutionWorker } from "../api";

function number(value: number | undefined): number { return Number(value || 0); }

/** Operational overview intentionally composes read models; it does not create a second status store. */
export default function AdminOverview() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [backlog, setBacklog] = useState(0);
  const [workers, setWorkers] = useState<ExecutionWorker[]>([]);
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [scheduling, audit] = await Promise.all([
        api.adminExecutionJobs({ limit: 1 }),
        api.adminAuditEvents({ limit: 8 }),
      ]);
      setCounts(scheduling.counts || {});
      setBacklog(Number(scheduling.backlog?.count || 0));
      setWorkers(scheduling.workers || []);
      setEvents(audit.items || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取平台概览");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const attention = useMemo(
    () => number(counts.failed) + number(counts.uncertain) + workers.filter((worker) => worker.stale).length,
    [counts, workers],
  );

  return (
    <section className="admin-grid" data-admin-overview>
      <header className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="split-head">
          <div><h2>概览</h2><p className="muted">平台运行、队列积压与最近治理操作的只读汇总。</p></div>
          <button type="button" className="btn ghost" onClick={() => void load()} disabled={loading}>刷新</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </header>
      <article className="panel"><h3>需要关注</h3><strong className={attention ? "status-warn" : "status-ok"}>{attention ? `${attention} 项` : "无"}</strong><p className="muted">失败、待人工确认与心跳超时。</p></article>
      <article className="panel"><h3>队列积压</h3><strong>{backlog}</strong><p className="muted">queued 与 retrying 作业；详情见调度监控。</p></article>
      <article className="panel"><h3>Worker</h3><strong>{workers.filter((worker) => worker.status === "running" && !worker.stale).length}/{workers.length}</strong><p className="muted">运行中 / 已观测 Worker。</p></article>
      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        <h3>最近审计</h3>
        {loading && !events.length && <p className="muted">读取中…</p>}
        {!loading && !events.length && <p className="muted">暂无审计事件。</p>}
        {events.map((event) => <div className="admin-row" key={event.id}><strong>{event.event_type}</strong><span className="muted">{event.ts} · {event.actor}</span></div>)}
      </article>
    </section>
  );
}
