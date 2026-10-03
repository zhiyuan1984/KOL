import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type AdminWorkReport,
  type AdminWorkReportDetail,
  type AdminWorkReportTicket,
  type WorkReportView,
} from "../api";
import "./admin-work-report.css";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

const viewCopy: Record<WorkReportView, { label: string; empty: string }> = {
  accepted: { label: "今日验收", empty: "这个统计范围内暂无已验收工单。" },
  processing: { label: "处理中", empty: "这个统计范围内暂无处理中工单。" },
  waiting: { label: "等待处理", empty: "这个统计范围内暂无等待处理工单。" },
  exception: { label: "失败 / 取消", empty: "这个统计范围内暂无失败或取消工单。" },
};

function currentDate(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date())
      .reduce((result, part) => ({ ...result, [part.type]: part.value }), {} as Record<string, string>);
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function time(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: DEFAULT_TIMEZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    pending: "待处理", queued: "排队中", starting: "启动中", running: "处理中", in_progress: "处理中",
    needs_clarification: "待补充", waiting: "等待处理", waiting_approval: "等待确认",
    completed: "已验收", failed: "失败", cancelled: "已取消",
  };
  return labels[value] || value;
}

function eventLabel(value?: string): string {
  if (value === "task.accepted") return "已验收";
  if (value === "task.created") return "已创建";
  if (value === "task.updated") return "已更新";
  if (value?.startsWith("run.")) return "运行过程";
  return value || "过程记录";
}

export default function AdminWorkReport() {
  const [date, setDate] = useState(currentDate);
  const [owner, setOwner] = useState("");
  const [kind, setKind] = useState("");
  const [team, setTeam] = useState("");
  const [report, setReport] = useState<AdminWorkReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drilldown, setDrilldown] = useState<WorkReportView | null>(null);
  const [tickets, setTickets] = useState<AdminWorkReportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminWorkReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const filters = useMemo(() => ({ date, timezone: DEFAULT_TIMEZONE, owner: owner || undefined, kind: kind || undefined, team: team || undefined }), [date, owner, kind, team]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await api.adminWorkReport(filters));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取工作战报");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!drilldown) {
      setTickets([]);
      return;
    }
    let active = true;
    setTicketsLoading(true);
    void api.adminWorkReportTickets(drilldown, filters)
      .then((response) => { if (active) setTickets(response.items || []); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "无法读取工单下钻"); })
      .finally(() => { if (active) setTicketsLoading(false); });
    return () => { active = false; };
  }, [drilldown, filters]);

  useEffect(() => {
    if (!selectedTicketId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    void api.adminWorkReportTicket(selectedTicketId)
      .then((response) => { if (active) setDetail(response); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "无法读取工单详情"); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedTicketId]);

  const summary = report?.summary;
  const metricCards: Array<{ view: WorkReportView; label: string; value: number; detail: string }> = [
    { view: "accepted", label: "今日验收", value: summary?.accepted || 0, detail: summary?.accepted_unattributed ? `其中 ${summary.accepted_unattributed} 条历史验收未归因` : "以验收事实计，一张工单一次" },
    { view: "processing", label: "处理中", value: summary?.processing || 0, detail: "统计时点仍在推进的正式工单" },
    { view: "waiting", label: "等待处理", value: summary?.waiting || 0, detail: "等待信息、审批或人工动作" },
    { view: "exception", label: "失败 / 取消", value: summary?.exception || 0, detail: "需复盘或确认后续处置" },
  ];

  return (
    <section className="work-report" data-admin-work-report>
      <header className="work-report__head">
        <div>
          <p className="work-report__eyebrow">管理端 · 每日工作战报</p>
          <h2>团队今天交付了什么，哪里需要关注</h2>
          <p className="muted">以 ticket 验收与过程事实汇总。运行成功不等于工单完成；不提供个人绩效分数或排名。</p>
        </div>
        <div className="work-report__head-actions">
          {report && <span className="work-report__asof">截至 {time(report.data_cutoff_at)}</span>}
          <button type="button" className="btn ghost" onClick={() => void load()} disabled={loading}>刷新</button>
        </div>
      </header>

      <div className="work-report__filters" aria-label="工作战报筛选">
        <label>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>当前团队
          <select value={team} onChange={(event) => setTeam(event.target.value)}>
            <option value="">全部团队</option>
            {(report?.filter_options.teams || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>票型
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">全部票型</option>
            {(report?.filter_options.kinds || []).map((item) => <option key={item.id} value={item.id}>{item.id} ({item.count})</option>)}
          </select>
        </label>
        <label>负责人
          <select value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">全部负责人</option>
            {(report?.filter_options.owners || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <span className="work-report__timezone">{DEFAULT_TIMEZONE}</span>
      </div>

      {error && <p className="error work-report__error" role="alert">{error}</p>}

      <div className="work-report__metrics" aria-label="工作摘要">
        {metricCards.map((metric) => (
          <button
            key={metric.view}
            type="button"
            className={`work-report__metric${drilldown === metric.view ? " is-active" : ""}`}
            onClick={() => setDrilldown(metric.view)}
            aria-pressed={drilldown === metric.view}
          >
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </button>
        ))}
      </div>

      <div className="work-report__main-grid">
        <article className="work-report__panel work-report__members">
          <div className="work-report__panel-head">
            <div><h3>成员工作</h3><p>按验收时负责人归因，当前负责工单和过程状态按统计时点计算。</p></div>
            <span>{report?.employees.length || 0} 位成员</span>
          </div>
          {loading && !report && <p className="muted">读取中…</p>}
          {report && (
            <div className="work-report__table-wrap">
              <table className="work-report__table">
                <thead><tr><th>成员</th><th>负责工单</th><th>今日验收</th><th>处理中</th><th>等待</th><th>最早待处理</th></tr></thead>
                <tbody>
                  {report.employees.map((person) => (
                    <tr key={person.user_id}>
                      <td><button type="button" className="work-report__person" onClick={() => setOwner(person.user_id)}>{person.name}<small>{person.username || person.user_id}</small></button></td>
                      <td>{person.responsible}</td><td>{person.accepted}</td><td>{person.processing}</td><td>{person.waiting}</td><td>{time(person.earliest_waiting_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="work-report__panel work-report__process">
          <div className="work-report__panel-head"><div><h3>关键过程与阻塞</h3><p>优先显示当前等待、失败和取消；其余为当天发生的 ticket 过程事件。</p></div></div>
          {!report?.process.blockers.length && !report?.process.activity.length && !loading && <p className="muted">当前没有需要展示的过程记录。</p>}
          <div className="work-report__activity-list">
            {(report?.process.blockers || []).map((item) => (
              <button type="button" className="work-report__activity is-blocker" key={`blocker:${item.ticket_id}`} onClick={() => setSelectedTicketId(item.ticket_id)}>
                <span className="work-report__event-dot" /><span className="work-report__activity-body"><strong>{item.title}</strong><small>{item.owner_name || item.owner_user_id} · {statusLabel(item.status)}{item.due_at ? ` · 截止 ${time(item.due_at)}` : ""}</small></span><time>{time(item.occurred_at)}</time>
              </button>
            ))}
            {(report?.process.activity || []).map((item) => (
              <button type="button" className="work-report__activity" key={`event:${item.event_id}`} onClick={() => setSelectedTicketId(item.ticket_id)}>
                <span className="work-report__event-dot" /><span className="work-report__activity-body"><strong>{item.title}</strong><small>{eventLabel(item.event_type)} · {item.label}{item.safe_summary ? ` · ${item.safe_summary}` : ""}</small></span><time>{time(item.occurred_at)}</time>
              </button>
            ))}
          </div>
        </article>
      </div>

      {report?.attribution.legacy_note && <p className="work-report__note">{report.attribution.legacy_note}</p>}
      {report?.attribution.team_scope_note && <p className="work-report__note">{report.attribution.team_scope_note}</p>}

      {drilldown && (
        <article className="work-report__panel work-report__drilldown" aria-live="polite">
          <div className="work-report__panel-head"><div><h3>{viewCopy[drilldown].label} · 工单下钻</h3><p>沿用当前日期、团队、票型和负责人的筛选口径。</p></div><button type="button" className="btn ghost sm" onClick={() => setDrilldown(null)}>收起</button></div>
          {ticketsLoading && <p className="muted">读取工单中…</p>}
          {!ticketsLoading && !tickets.length && <p className="muted">{viewCopy[drilldown].empty}</p>}
          <div className="work-report__ticket-list">
            {tickets.map((ticket) => <TicketRow key={ticket.ticket_id} ticket={ticket} onOpen={setSelectedTicketId} />)}
          </div>
        </article>
      )}

      {selectedTicketId && (
        <aside className="work-report__drawer" aria-label="工单详情">
          <div className="work-report__drawer-head"><div><span>工单详情</span><strong>{detail?.ticket.title || "读取中…"}</strong></div><button type="button" className="btn ghost sm" onClick={() => setSelectedTicketId(null)}>关闭</button></div>
          {detailLoading && <p className="muted">读取详情中…</p>}
          {detail && <TicketDetail detail={detail} />}
        </aside>
      )}
    </section>
  );
}

function TicketRow({ ticket, onOpen }: { ticket: AdminWorkReportTicket; onOpen: (id: string) => void }) {
  return <button type="button" className="work-report__ticket" onClick={() => onOpen(ticket.ticket_id)}>
    <span><strong>{ticket.title}</strong><small>{ticket.owner_name || ticket.owner_user_id || "未分配"} · {ticket.kind}</small></span>
    <span className={`work-report__status is-${ticket.status}`}>{statusLabel(ticket.status)}</span>
    <time>{time(ticket.accepted_at || ticket.due_at || ticket.updated_at)}</time>
  </button>;
}

function TicketDetail({ detail }: { detail: AdminWorkReportDetail }) {
  const { ticket, acceptance } = detail;
  return <div className="work-report__detail-body">
    <section><h4>目标与负责人</h4><dl><div><dt>目标</dt><dd>{ticket.goal}</dd></div><div><dt>负责人</dt><dd>{ticket.owner_name || ticket.owner_user_id}</dd></div><div><dt>来源</dt><dd>{ticket.source}</dd></div><div><dt>状态</dt><dd>{statusLabel(ticket.status)}</dd></div></dl></section>
    <section><h4>验收证据</h4>{acceptance ? <dl><div><dt>验收时间</dt><dd>{time(acceptance.accepted_at)}</dd></div><div><dt>验收时负责人</dt><dd>{acceptance.owner_name_at_acceptance || acceptance.owner_user_id_at_acceptance || "未归因"}</dd></div><div><dt>验收人</dt><dd>{acceptance.accepted_by_name || acceptance.accepted_by_user_id || "未归因"}</dd></div><div><dt>证据</dt><dd><pre>{acceptance.evidence ? JSON.stringify(acceptance.evidence, null, 2) : "历史事件未保存验收证据"}</pre></dd></div></dl> : <p className="muted">尚未验收。</p>}</section>
    <section><h4>时间线</h4><ol className="work-report__timeline">{detail.timeline.map((event) => <li key={event.event_id}><time>{time(event.occurred_at)}</time><div><strong>{event.label}</strong><small>{event.safe_summary || statusLabel(event.status)}</small></div></li>)}</ol></section>
    <section><h4>运行与产物</h4><p className="muted">运行 {detail.runs.length} 条 · 产物 {detail.artifacts.length} 条。运行结果仅作过程证据，不代表工单验收完成。</p></section>
  </div>;
}
