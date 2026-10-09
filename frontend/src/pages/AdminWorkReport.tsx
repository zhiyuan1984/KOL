import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type AdminWorkReport,
  type AdminWorkReportDetail,
  type AdminWorkReportTicket,
  type AiTaskWorkOrderList,
  type WorkReportPeriod,
  type WorkReportView,
} from "../api";
import {
  buildSummaryText,
  flattenEvidence,
  formatDelta,
  isOverdue,
  overdueLabel,
  periodLabel,
  periodWindowLabel,
  sortInterventions,
  type Intervention,
} from "./adminWorkReportModel";
import "./admin-work-report.css";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const PAGE_SIZES = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

const PERIODS: Array<{ value: WorkReportPeriod; label: string }> = [
  { value: "day", label: "今日" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
];

const TABS: Array<{ view: WorkReportView; label: string }> = [
  { view: "accepted", label: "验收明细" },
  { view: "processing", label: "处理中" },
  { view: "waiting", label: "等待处理" },
  { view: "exception", label: "失败·取消" },
];

const STATUS_META: Record<string, { label: string; tone: "warning" | "danger" | "success" | "accent" | "muted" }> = {
  waiting_approval: { label: "等审批", tone: "warning" },
  waiting: { label: "等待处理", tone: "warning" },
  needs_clarification: { label: "待补充", tone: "warning" },
  failed: { label: "失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "muted" },
  completed: { label: "已验收", tone: "success" },
  running: { label: "处理中", tone: "accent" },
  in_progress: { label: "处理中", tone: "accent" },
  starting: { label: "启动中", tone: "accent" },
  pending: { label: "待处理", tone: "muted" },
  queued: { label: "排队中", tone: "muted" },
};

const TONE_ICON: Record<string, string> = { warning: "⚠", danger: "⚠", success: "✓", accent: "●", muted: "○" };

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

function statusMeta(status: string): { label: string; tone: "warning" | "danger" | "success" | "accent" | "muted" } {
  return STATUS_META[status] || { label: status, tone: "muted" };
}

function smoothScroll(element: HTMLElement | null): void {
  if (!element || typeof window === "undefined") return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

function StatusChip({ status, overdue, dueAt, nowMs }: { status: string; overdue?: boolean; dueAt?: string | null; nowMs?: number }) {
  if (overdue && dueAt && nowMs != null) {
    return (
      <span className="wr-chip is-danger">
        <i aria-hidden="true">⚠</i>
        {overdueLabel(dueAt, nowMs)}
      </span>
    );
  }
  const meta = statusMeta(status);
  return (
    <span className={`wr-chip is-${meta.tone}`}>
      <i aria-hidden="true">{TONE_ICON[meta.tone]}</i>
      {meta.label}
    </span>
  );
}

export default function AdminWorkReport() {
  const today = useMemo(currentDate, []);
  const [period, setPeriod] = useState<WorkReportPeriod>("day");
  const [date, setDate] = useState(today);
  const [owner, setOwner] = useState("");
  const [kind, setKind] = useState("");
  const [team, setTeam] = useState("");
  const [tab, setTab] = useState<WorkReportView>("accepted");
  const [report, setReport] = useState<AdminWorkReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tickets, setTickets] = useState<AdminWorkReportTicket[]>([]);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminWorkReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiTaskRoots, setAiTaskRoots] = useState<AiTaskWorkOrderList["items"]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const queueRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const nowMs = useMemo(() => Date.now(), [report?.as_of]);

  const filters = useMemo(
    () => ({ date, period, timezone: DEFAULT_TIMEZONE, owner: owner || undefined, kind: kind || undefined, team: team || undefined }),
    [date, period, owner, kind, team],
  );

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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.aiTaskWorkOrders().then((response) => setAiTaskRoots(response.items || [])).catch(() => setAiTaskRoots([]));
  }, []);

  const offset = (page - 1) * pageSize;
  const pageCount = Math.max(1, Math.ceil(ticketTotal / pageSize));

  useEffect(() => {
    setPage(1);
    setTicketTotal(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filters, pageSize]);

  useEffect(() => {
    let active = true;
    setTicketsLoading(true);
    setTicketsError("");
    void api
      .adminWorkReportTickets(tab, { ...filters, limit: pageSize, offset })
      .then((response) => {
        if (active) {
          setTickets(response.items || []);
          setTicketTotal(typeof response.total === "number" ? response.total : 0);
          if (typeof response.offset === "number" && response.offset !== offset) {
            setPage(Math.floor(response.offset / pageSize) + 1);
          }
        }
      })
      .catch((cause) => {
        if (active) {
          setTickets([]);
          setTicketTotal(0);
          setTicketsError(cause instanceof Error ? cause.message : "无法读取工单明细");
        }
      })
      .finally(() => {
        if (active) setTicketsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, filters, page, pageSize, offset]);

  useEffect(() => {
    if (!selectedTicketId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    void api
      .adminWorkReportTicket(selectedTicketId)
      .then((response) => {
        if (active) setDetail(response);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取工单详情");
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedTicketId]);

  useEffect(() => {
    if (!selectedTicketId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedTicketId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTicketId]);

  const summary = report?.summary;
  const delta = summary ? formatDelta(summary.accepted, summary.previous_accepted) : null;

  const interventions: Intervention[] = useMemo(
    () =>
      sortInterventions(
        ((report?.process.blockers || []) as Intervention[]).filter((item) => item.status !== "cancelled"),
        nowMs,
      ),
    [report, nowMs],
  );
  const attention = useMemo(() => {
    const approvals = interventions.filter((item) => item.status === "waiting_approval").length;
    const overdue = interventions.filter((item) => isOverdue(item.due_at, item.status, nowMs)).length;
    const failed = interventions.filter((item) => item.status === "failed").length;
    const waiting = interventions.filter((item) => item.status === "waiting" && !isOverdue(item.due_at, item.status, nowMs)).length;
    return { total: interventions.length, approvals, overdue, failed, waiting };
  }, [interventions, nowMs]);

  const aiSummary = useMemo(() => {
    const open = aiTaskRoots.reduce((sum, item) => sum + (item.counts.open || 0), 0);
    const blocked = aiTaskRoots.reduce((sum, item) => sum + (item.counts.blocked || 0), 0);
    return { roots: aiTaskRoots.length, open, blocked };
  }, [aiTaskRoots]);

  const kindSegments = useMemo(() => {
    const list = report?.accepted_by_kind || [];
    const total = list.reduce((sum, item) => sum + item.count, 0);
    const top = list.slice(0, 5);
    const rest = total - top.reduce((sum, item) => sum + item.count, 0);
    return { top, rest, total };
  }, [report]);

  const members = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    const list = report?.employees || [];
    if (!query) return list;
    return list.filter((person) => `${person.name} ${person.username || ""} ${person.user_id}`.toLowerCase().includes(query));
  }, [report, memberQuery]);

  const tabCounts: Record<WorkReportView, number> = {
    accepted: summary?.accepted || 0,
    processing: summary?.processing || 0,
    waiting: summary?.waiting || 0,
    exception: summary?.exception || 0,
  };

  const stats: Array<{ view: WorkReportView; label: string; caliber: string; value: number; delta?: { text: string; tone: "up" | "down" | "flat" } | null }> = [
    { view: "accepted", label: `${periodLabel(period)}验收`, caliber: "事件口径", value: summary?.accepted || 0, delta },
    { view: "processing", label: "处理中", caliber: "当前时点", value: summary?.processing || 0 },
    { view: "waiting", label: "等待处理", caliber: "当前时点", value: summary?.waiting || 0 },
    { view: "exception", label: "失败·取消", caliber: "当前时点", value: summary?.exception || 0 },
  ];

  const pickTab = useCallback((view: WorkReportView) => {
    setTab(view);
    smoothScroll(detailRef.current);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!report) return;
    const ok = await copyText(buildSummaryText(report, time(report.data_cutoff_at)));
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
    else setError("复制失败，请手动选择文本复制");
  }, [report]);

  const isFuture = date > today;
  const windowLabel = report ? periodWindowLabel(report.period, report.period.timezone) : "";

  return (
    <section className="work-report" data-grid data-admin-work-report>
      <header className="wr-head">
        <div className="wr-head-title">
          <p className="wr-eyebrow">管理端 · 工作战报</p>
          <h2>
            工作战报 <span className="wr-window">{windowLabel}</span>
          </h2>
          <p className="wr-caliber">
            验收以验收事实计，一张工单一次；运行成功不等于交付 · 截至 {report ? time(report.data_cutoff_at) : "—"}
          </p>
        </div>
        <div className="wr-head-actions">
          <div className="task-period-segmented" role="group" aria-label="统计周期">
            {PERIODS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={period === item.value ? "is-active" : ""}
                aria-pressed={period === item.value}
                onClick={() => setPeriod(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="wr-date">
            日期
            <input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} />
          </label>
          <button type="button" className="wr-text-btn" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
          <button type="button" className="wr-text-btn" onClick={() => void handleCopy()} disabled={!report}>
            {copied ? "已复制" : "复制摘要"}
          </button>
        </div>
      </header>

      <div className="wr-filters" aria-label="工作战报筛选">
        <label>
          团队
          <select value={team} onChange={(event) => setTeam(event.target.value)}>
            <option value="">全部团队</option>
            {(report?.filter_options.teams || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          票型
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">全部票型</option>
            {(report?.filter_options.kinds || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} ({item.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          负责人
          <select value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">全部负责人</option>
            {(report?.filter_options.owners || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {kind && (
          <button type="button" className="wr-text-btn" onClick={() => setKind("")}>
            清除票型筛选
          </button>
        )}
      </div>

      {isFuture && <p className="wr-note">所选日期在未来，暂无数据。</p>}
      {error && (
        <p className="wr-error" role="alert">
          {error}
        </p>
      )}

      {attention.total > 0 && (
        <div className="task-report-warning" role="alert">
          <span>
            <i aria-hidden="true">⚠</i> {attention.total} 项需要处理：{attention.approvals} 等审批 · {attention.overdue}{" "}
            已逾期 · {attention.failed} 失败 · {attention.waiting} 等待中
          </span>
          <button type="button" onClick={() => smoothScroll(queueRef.current)}>
            查看干预队列
          </button>
        </div>
      )}

      <div className="wr-stats" role="group" aria-label="关键指标">
        {stats.map((stat) => (
          <button
            key={stat.view}
            type="button"
            className={`wr-stat${tab === stat.view ? " is-active" : ""}`}
            aria-pressed={tab === stat.view}
            onClick={() => pickTab(stat.view)}
          >
            <span className="wr-stat-label">
              {stat.label}
              <i>{stat.caliber}</i>
            </span>
            <strong className="wr-stat-value">{stat.value}</strong>
            {stat.delta ? (
              <span className={`wr-stat-delta is-${stat.delta.tone}`}>
                {stat.delta.text}
                <i>较上期</i>
              </span>
            ) : (
              <span className="wr-stat-delta is-none">点击查看明细</span>
            )}
          </button>
        ))}
      </div>

      {kindSegments.total > 0 && (
        <section className="wr-dist" aria-label="验收构成（按票型）">
          <div className="wr-dist-bar" role="img" aria-label={`验收构成：${kindSegments.top.map((s) => `${s.kind} ${s.count}`).join("、")}`}>
            {kindSegments.top.map((segment) => (
              <i key={segment.kind} style={{ flexGrow: Math.max(segment.count, 1) }} title={`${segment.kind} ${segment.count}`} />
            ))}
          </div>
          <ul className="wr-dist-legend">
            {kindSegments.top.map((segment) => (
              <li key={segment.kind}>
                <button
                  type="button"
                  className={kind === segment.kind ? "is-active" : ""}
                  aria-pressed={kind === segment.kind}
                  onClick={() => setKind(kind === segment.kind ? "" : segment.kind)}
                  title="按此票型筛选"
                >
                  {segment.kind} <b>{segment.count}</b>
                  <span>· {Math.round((segment.count / kindSegments.total) * 100)}%</span>
                </button>
              </li>
            ))}
            {kindSegments.rest > 0 && (
              <li className="wr-dist-rest">
                其余 <b>{kindSegments.rest}</b>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="wr-queue" ref={queueRef} aria-label="干预队列" tabIndex={-1}>
        <div className="wr-section-head">
          <h3>
            干预队列 <span className="wr-count">{interventions.length}</span>
          </h3>
          <p>等审批 → 已逾期 → 失败 → 等待</p>
        </div>
        {loading && !report ? (
          <p className="wr-muted">读取中…</p>
        ) : interventions.length === 0 ? (
          <p className="wr-muted">当前没有等待、失败或取消的工单。</p>
        ) : (
          <ul className="wr-queue-list">
            {interventions.map((item) => {
              const overdue = isOverdue(item.due_at, item.status, nowMs);
              return (
                <li key={item.ticket_id} className="wr-queue-row">
                  <StatusChip status={item.status} overdue={overdue} dueAt={item.due_at} nowMs={nowMs} />
                  <span className="wr-queue-title" title={item.title}>
                    {item.title}
                    <small>{item.ticket_kind}</small>
                  </span>
                  <span className="wr-queue-owner">{item.owner_name || item.owner_user_id || "未分配"}</span>
                  <time className="wr-queue-time">{time(item.due_at || item.occurred_at)}</time>
                  <button type="button" className="wr-text-btn" onClick={() => setSelectedTicketId(item.ticket_id)}>
                    查看
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="wr-detail" ref={detailRef} aria-label="工单明细" tabIndex={-1}>
        <div className="home-tabs" role="tablist" aria-label="明细视图">
          {TABS.map((item) => (
            <button
              key={item.view}
              type="button"
              role="tab"
              aria-selected={tab === item.view}
              onClick={() => setTab(item.view)}
            >
              {item.label} <span className="home-mode-count">{tabCounts[item.view]}</span>
            </button>
          ))}
        </div>
        {ticketsLoading ? (
          <p className="wr-muted">读取工单中…</p>
        ) : ticketsError ? (
          <p className="wr-error" role="alert">
            {ticketsError}
          </p>
        ) : tickets.length === 0 ? (
          <p className="wr-muted">本期暂无{tab === "accepted" ? "验收" : TABS.find((t) => t.view === tab)?.label}工单。</p>
        ) : (
          <>
            <div className="wr-table-wrap">
              <table className="wr-table">
                <thead>
                  <tr>
                    <th>工单</th>
                    {tab === "accepted" ? (
                      <>
                        <th>验收时负责人</th>
                        <th>验收人</th>
                        <th className="wr-num">验收时间</th>
                      </>
                    ) : (
                      <>
                        <th>状态</th>
                        <th>负责人</th>
                        <th>票型</th>
                        <th className="wr-num">时间</th>
                      </>
                    )}
                    <th>
                      <span className="wr-visually-hidden">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr key={ticket.ticket_id}>
                      <td className="wr-cell-title">
                        <span title={ticket.title}>{ticket.title}</span>
                        <small>{ticket.kind}</small>
                      </td>
                      {tab === "accepted" ? (
                        <>
                          <td>{ticket.accepted_owner_name || ticket.owner_name || "—"}</td>
                          <td>{ticket.accepted_by_name || "—"}</td>
                          <td className="wr-num">{time(ticket.accepted_at)}</td>
                        </>
                      ) : (
                        <>
                          <td>
                            <StatusChip status={ticket.status} />
                          </td>
                          <td>{ticket.owner_name || ticket.owner_user_id || "—"}</td>
                          <td>{ticket.kind}</td>
                          <td className="wr-num">{time(ticket.due_at || ticket.updated_at)}</td>
                        </>
                      )}
                      <td className="wr-cell-action">
                        <button type="button" className="wr-text-btn" onClick={() => setSelectedTicketId(ticket.ticket_id)}>
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="wr-pager">
              <span className="wr-pager-total">共 {ticketTotal} 条</span>
              <span className="wr-pager-controls">
                <label className="wr-pager-size">
                  每页
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                    aria-label="每页条数"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="wr-text-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  上一页
                </button>
                <span className="wr-pager-page" aria-live="polite">
                  {page} / {pageCount}
                </span>
                <button
                  type="button"
                  className="wr-text-btn"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </span>
            </div>
          </>
        )}
      </section>

      <details className="wr-fold">
        <summary>
          成员维度 <span className="wr-count">{report?.employees.length || 0} 位</span>
        </summary>
        <div className="wr-fold-body">
          <div className="wr-members-tools">
            <WorkspaceSearchInput
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="搜索成员"
              aria-label="搜索成员"
            />
            <span className="wr-muted">点击成员名可只看该负责人</span>
          </div>
          <div className="wr-table-wrap">
            <table className="wr-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th className="wr-num">本期验收</th>
                  <th className="wr-num">处理中</th>
                  <th className="wr-num">等待</th>
                  <th className="wr-num">最早待处理</th>
                </tr>
              </thead>
              <tbody>
                {members.map((person) => (
                  <tr key={person.user_id}>
                    <td className="wr-cell-title">
                      <button
                        type="button"
                        className="wr-link-btn"
                        title="只看该负责人"
                        onClick={() => setOwner(owner === person.user_id ? "" : person.user_id)}
                        aria-pressed={owner === person.user_id}
                      >
                        {person.name}
                      </button>
                      <small>{person.username || person.user_id}</small>
                    </td>
                    <td className="wr-num">{person.accepted}</td>
                    <td className="wr-num">{person.processing}</td>
                    <td className="wr-num">{person.waiting}</td>
                    <td className="wr-num">{time(person.earliest_waiting_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {members.length === 0 && <p className="wr-muted">没有匹配的成员。</p>}
        </div>
      </details>

      <details className="wr-fold">
        <summary>口径说明</summary>
        <ul className="wr-caliber-list">
          <li>验收以 ticket_acceptances 事实计，一张工单一次；运行成功只是过程证据，不计入交付。</li>
          <li>处理中 / 等待处理 / 失败·取消为当前时点库存，与所选统计周期无关。</li>
          <li>环比＝本期验收数 － 上一周期验收数。</li>
          <li>成员「本期验收」按验收时负责人归因；历史验收事件缺少归因的不计入个人。</li>
          <li>本页不生成个人绩效分数或排名。</li>
          {report?.attribution.legacy_note && <li>{report.attribution.legacy_note}</li>}
          {report?.attribution.team_scope_note && <li>{report.attribution.team_scope_note}</li>}
        </ul>
      </details>

      <div className="wr-ai-strip">
        <span>
          AI 任务存量：{aiSummary.roots} 个任务根 · 开放子工单 {aiSummary.open} · 阻塞 {aiSummary.blocked}
        </span>
        <Link className="wr-link" to="/admin/work-orders">
          在工单管理中查看
        </Link>
      </div>

      {selectedTicketId && (
        <div className="wr-scrim" onClick={() => setSelectedTicketId(null)}>
          <aside className="wr-drawer" role="dialog" aria-label="工单详情" onClick={(event) => event.stopPropagation()}>
            <div className="wr-drawer-head">
              <div>
                <span>工单详情</span>
                <strong>{detail?.ticket.title || "读取中…"}</strong>
              </div>
              <button type="button" className="wr-text-btn" onClick={() => setSelectedTicketId(null)}>
                关闭
              </button>
            </div>
            {detailLoading && <p className="wr-muted">读取详情中…</p>}
            {detail && <TicketDetail detail={detail} />}
          </aside>
        </div>
      )}
    </section>
  );
}

function TicketDetail({ detail }: { detail: AdminWorkReportDetail }) {
  const { ticket, acceptance } = detail;
  const evidence = flattenEvidence(acceptance?.evidence);
  return (
    <div className="wr-detail-body">
      <section>
        <h4>目标与负责人</h4>
        <dl>
          <div>
            <dt>目标</dt>
            <dd>{ticket.goal || "—"}</dd>
          </div>
          <div>
            <dt>负责人</dt>
            <dd>
              {ticket.owner_name || ticket.owner_user_id || "—"}
              {ticket.owner_username ? `（${ticket.owner_username}）` : ""}
            </dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{ticket.source}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>
              <StatusChip status={ticket.status} />
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <h4>验收证据</h4>
        {!acceptance ? (
          <p className="wr-muted">尚未验收。</p>
        ) : (
          <dl>
            <div>
              <dt>验收时间</dt>
              <dd>{time(acceptance.accepted_at)}</dd>
            </div>
            <div>
              <dt>验收时负责人</dt>
              <dd>{acceptance.owner_name_at_acceptance || acceptance.owner_user_id_at_acceptance || "未归因"}</dd>
            </div>
            <div>
              <dt>验收人</dt>
              <dd>{acceptance.accepted_by_name || acceptance.accepted_by_user_id || "未归因"}</dd>
            </div>
            <div>
              <dt>证据</dt>
              <dd>
                {evidence.length === 0 ? (
                  <span className="wr-muted">历史事件未保存验收证据</span>
                ) : (
                  <dl className="wr-evidence">
                    {evidence.map((entry) => (
                      <div key={entry.key}>
                        <dt>{entry.key}</dt>
                        <dd title={entry.value}>{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </dd>
            </div>
          </dl>
        )}
      </section>
      <section>
        <h4>时间线</h4>
        <ol className="wr-timeline">
          {detail.timeline.map((event) => (
            <li key={event.event_id}>
              <time>{time(event.occurred_at)}</time>
              <div>
                <strong>{event.label}</strong>
                <small>{event.safe_summary || statusMeta(event.status).label}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h4>运行与产物</h4>
        <p className="wr-muted">
          运行 {detail.runs.length} 条 · 产物 {detail.artifacts.length} 条。运行结果仅作过程证据，不代表工单验收完成。
        </p>
      </section>
    </div>
  );
}
