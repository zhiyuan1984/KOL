import { useCallback, useEffect, useState } from "react";
import { api, type AdminAuditEvent } from "../api";

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function payloadSummary(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload).filter(([, value]) => value !== null && value !== "").slice(0, 4);
  if (!entries.length) return "无附加字段";
  return entries.map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`).join(" · ");
}

/** Read-only cross-domain audit timeline. It never mutates business facts. */
export default function AdminAudit() {
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [eventType, setEventType] = useState("");
  const [actor, setActor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (append = false, cursor?: number) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.adminAuditEvents({ limit: 50, cursor, event_type: eventType.trim() || undefined, actor: actor.trim() || undefined });
      setEvents((current) => append ? [...current, ...(data.items || [])] : (data.items || []));
      setNextCursor(data.next_cursor || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取审计事件");
    } finally {
      setLoading(false);
    }
  }, [actor, eventType]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="admin-grid" data-admin-audit>
      <header className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="split-head">
          <div>
            <h2>审计中心</h2>
            <p className="muted">跨域操作审计只读展示；业务事实、审批与运行记录仍保留各自的权威 ID。</p>
          </div>
          <button type="button" className="btn ghost" onClick={() => void load()} disabled={loading}>刷新</button>
        </div>
        <form className="row-actions" onSubmit={(event) => { event.preventDefault(); void load(); }}>
          <label className="field">事件类型<input value={eventType} onChange={(event) => setEventType(event.target.value)} placeholder="例如 execution_job.retry_requested" /></label>
          <label className="field">执行者<input value={actor} onChange={(event) => setActor(event.target.value)} placeholder="用户或 system" /></label>
          <button type="submit" className="btn work" disabled={loading}>筛选</button>
        </form>
      </header>

      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        {error && <p className="error" role="alert">{error}</p>}
        {loading && !events.length && <p className="muted">读取中…</p>}
        {!loading && !events.length && !error && <p className="muted">当前筛选没有审计记录。</p>}
        {events.map((event) => (
          <div className="admin-row" key={event.id} data-audit-event={event.id}>
            <div><strong>{event.event_type}</strong><p className="muted">{formatTime(event.ts)} · {event.actor}</p></div>
            <p className="muted">{payloadSummary(event.payload || {})}</p>
          </div>
        ))}
        {nextCursor ? <button type="button" className="btn ghost" disabled={loading} onClick={() => void load(true, nextCursor)}>加载更早记录</button> : null}
      </article>
    </section>
  );
}
