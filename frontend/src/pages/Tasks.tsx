import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Task, type TaskDetail, type TaskEvent } from "../api";

type View = "active" | "history";

const ACTIVE = new Set(["pending", "queued", "running", "starting", "in_progress", "waiting", "waiting_approval"]);
const CLOSED = new Set(["completed", "done", "success", "succeeded", "failed", "cancelled", "canceled"]);

function unwrap(value: Task[] | { tasks?: Task[] }): Task[] {
  return Array.isArray(value) ? value : value.tasks || [];
}

function statusOf(task: Task) {
  const value = String(task.status || task.display_status || "pending").toLowerCase();
  if (value === "waiting_approval") return "待确认";
  if (value === "queued" || value === "pending") return "排队中";
  if (value === "running" || value === "starting" || value === "in_progress") return "执行中";
  if (CLOSED.has(value)) return value === "failed" ? "失败" : value === "cancelled" || value === "canceled" ? "已取消" : "已完成";
  return task.display_status_label || value;
}

function time(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Tasks() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "history" ? "history" : "active";
  const [rows, setRows] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [actionBusy, setActionBusy] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await api.tasks({ view, q: query, status: statusFilter, skill: agentFilter, from, to });
      setRows(unwrap(response));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "任务列表加载失败"); }
    finally { setLoading(false); }
  }, [view, query, statusFilter, agentFilter, from, to]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (view !== "active") return; const timer = window.setInterval(() => void load(), 4000); return () => window.clearInterval(timer); }, [load, view]);

  const openDetail = async (task: Task) => {
    setActionBusy(`detail:${task.id}`);
    try {
      const [detailResponse, eventResponse] = await Promise.all([api.task(task.id), api.taskEvents(task.id)]);
      setSelected(("task" in detailResponse ? detailResponse.task : detailResponse) as TaskDetail);
      setEvents(Array.isArray(eventResponse) ? eventResponse : eventResponse.events || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "任务详情加载失败"); }
    finally { setActionBusy(""); }
  };
  const cancel = async (task: Task) => {
    if (!window.confirm("确认取消这个尚未开始执行的任务？")) return;
    setActionBusy(`cancel:${task.id}`);
    try { await api.cancelTask(task.id); await load(); if (selected?.id === task.id) setSelected(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "取消失败"); }
    finally { setActionBusy(""); }
  };
  const retry = async (task: Task) => {
    setActionBusy(`retry:${task.id}`);
    try { await api.runTask(task.id); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "重试失败"); }
    finally { setActionBusy(""); }
  };

  const visible = useMemo(() => rows.filter((task) => view === "active" ? ACTIVE.has(String(task.status || "").toLowerCase()) : !ACTIVE.has(String(task.status || "").toLowerCase())), [rows, view]);
  const cancelSelected = async () => { if (!selectedIds.size || !window.confirm(`确认取消 ${selectedIds.size} 个排队任务？`)) return; setActionBusy("bulk-cancel"); try { await Promise.all([...selectedIds].map((id) => api.cancelTask(id))); setSelectedIds(new Set()); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "批量取消失败"); } finally { setActionBusy(""); } };

  return <main className="tasks-page" data-task-center>
    <header className="tasks-page-head">
      <div><p className="eyebrow">工作执行</p><h1>任务中心</h1><p className="muted">查看已提交任务的排队、执行、确认与历史结果。</p></div>
      <Link className="button button-primary" to="/">新建任务</Link>
    </header>
    <nav className="tasks-tabs" aria-label="任务范围">
      <button className={view === "active" ? "is-active" : ""} onClick={() => setParams({ view: "active" })}>进行中 / 排队中</button>
      <button className={view === "history" ? "is-active" : ""} onClick={() => setParams({ view: "history" })}>历史任务</button>
    </nav>
    <div className="task-center-filters"><input aria-label="搜索任务" placeholder="搜索任务名称、内容或技能" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="状态筛选" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">全部状态</option><option value="queued">排队中</option><option value="running">执行中</option><option value="waiting_approval">待确认</option><option value="failed">失败</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select><input aria-label="Agent筛选" placeholder="Agent/技能 ID" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} /><label>从 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>到 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>{view === "active" && selectedIds.size ? <button type="button" onClick={() => void cancelSelected()} disabled={Boolean(actionBusy)}>取消选中 ({selectedIds.size})</button> : null}</div>
    {error && <p className="surface-error" role="alert">{error} <button onClick={() => void load()}>重试</button></p>}
    {loading ? <p className="muted">正在读取任务状态…</p> : visible.length === 0 ? <section className="task-center-empty"><strong>{view === "active" ? "当前没有排队或执行中的任务" : "还没有历史任务"}</strong><p>{view === "active" ? "新建任务后，任务会在这里显示真实等待状态。" : "已完成、失败或取消的任务会保留在这里。"}</p></section> :
      <div className="task-center-table-wrap"><table className="task-center-table"><thead><tr><th></th><th>任务</th><th>状态</th><th>时间</th><th>说明</th><th>入口</th></tr></thead><tbody>{visible.map((task) => <tr key={task.id}>
        <td>{view === "active" && ["pending", "queued", "waiting", "needs_clarification"].includes(String(task.status || "")) ? <input type="checkbox" aria-label={`选择 ${task.title}`} checked={selectedIds.has(task.id)} onChange={(e) => setSelectedIds((current) => { const next = new Set(current); e.target.checked ? next.add(task.id) : next.delete(task.id); return next; })} /> : null}</td>
        <td><strong>{task.title || "未命名任务"}</strong><small>{task.skill || task.source || "Agent 任务"}</small></td>
        <td><span className={`task-center-status status-${String(task.status || "pending")}`}>{statusOf(task)}</span>{task.queue_position ? <small>队列第 {task.queue_position} 位</small> : null}</td>
        <td><small>创建 {time(task.created_at)}</small><small>{task.started_at ? `开始 ${time(task.started_at)}` : task.queued_at ? `入队 ${time(task.queued_at)}` : ""}</small></td>
        <td>{task.wait_reason || task.last_error || task.history_summary || task.next_action || "—"}</td>
        <td className="task-center-actions"><button type="button" onClick={() => void openDetail(task)} disabled={actionBusy === `detail:${task.id}`}>详情</button>{task.session_id ? <Link to={`/s/${task.session_id}`}>执行</Link> : null}{view === "active" && ["pending", "queued", "waiting", "needs_clarification"].includes(String(task.status || "")) ? <button type="button" onClick={() => void cancel(task)} disabled={Boolean(actionBusy)}>取消</button> : null}{view === "history" && String(task.status || "") === "failed" ? <button type="button" onClick={() => void retry(task)} disabled={Boolean(actionBusy)}>重试</button> : null}</td>
      </tr>)}</tbody></table></div>}
    {selected ? <div className="task-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="task-detail-drawer" role="dialog" aria-modal="true" aria-label="任务详情">
      <header><div><p className="eyebrow">任务详情</p><h2>{selected.title}</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button></header>
      <dl className="task-detail-meta"><div><dt>状态</dt><dd>{statusOf(selected)}</dd></div><div><dt>任务 ID</dt><dd>{selected.id}</dd></div><div><dt>创建时间</dt><dd>{time(selected.created_at)}</dd></div><div><dt>说明</dt><dd>{selected.wait_reason || selected.last_error || selected.history_summary || "—"}</dd></div></dl>
      <p className="muted">已尝试 {selected.runs?.length || 0} 次{selected.runs?.length ? `；最近一次：${String(selected.runs[selected.runs.length - 1]?.status || "未知")}` : ""}</p>
      <section><h3>执行事件</h3>{events.length ? <ol className="task-detail-events">{events.map((event, index) => <li key={event.id || `${event.created_at}-${index}`}><strong>{event.title || event.type || "任务事件"}</strong><small>{time(event.created_at)}</small><p>{event.summary || event.message || "—"}</p></li>)}</ol> : <p className="muted">暂无执行事件。</p>}</section>
      <div className="task-detail-actions">{selected.session_id ? <Link className="button" to={`/s/${selected.session_id}`}>查看结果 / 继续处理</Link> : null}{selected.status === "waiting" || selected.status === "waiting_approval" ? <Link className="button" to={selected.session_id ? `/s/${selected.session_id}` : "/"}>继续处理</Link> : null}{selected.status === "failed" ? <button className="button button-primary" type="button" onClick={() => void retry(selected)} disabled={Boolean(actionBusy)}>重试任务</button> : null}</div>
    </aside></div> : null}
  </main>;
}
