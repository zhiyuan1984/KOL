import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type TaskDetail, type TaskEvent } from "../api";
import { useTaskRunEventStream } from "../hooks/useTaskRunEventStream";

const CLOSED = new Set(["completed", "done", "success", "succeeded", "failed", "cancelled", "canceled"]);
function statusLabel(task: TaskDetail) {
  const value = String(task.status || task.display_status || "pending").toLowerCase();
  if (value === "waiting_approval") return "待确认";
  if (["queued", "pending"].includes(value)) return "排队中";
  if (["running", "starting", "in_progress"].includes(value)) return "进行中";
  if (value === "failed") return "失败";
  if (["cancelled", "canceled"].includes(value)) return "已取消";
  if (CLOSED.has(value)) return "已完成";
  return task.display_status_label || value;
}
function statusClass(task: TaskDetail) {
  return String(task.status || task.display_status || "pending").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}
function time(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function text(value: unknown, fallback = "—") {
  const clean = String(value ?? "").replace(/signal\s+timed\s+out/gi, "").replace(/\s{2,}/g, " ").trim();
  return clean || fallback;
}
function eventTitle(event: TaskEvent) { return text(event.title || event.label || event.type, "任务事件"); }
function eventSummary(event: TaskEvent) { return text(event.summary || event.message, "暂无事件说明"); }

export default function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const runId = useMemo(() => {
    const run = [...(task?.runs || [])].reverse().find((item) => item.id || item.run_id);
    return run ? String(run.id || run.run_id) : null;
  }, [task]);
  const live = useTaskRunEventStream(runId);
  const load = async (background = false) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const [detail, eventResponse] = await Promise.all([api.task(taskId), api.taskEvents(taskId)]);
      setTask(("task" in detail ? detail.task : detail) as TaskDetail);
      setEvents(Array.isArray(eventResponse) ? eventResponse : eventResponse.events || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务详情加载失败");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };
  useEffect(() => { void load(); }, [taskId]);
  const visibleEvents = live.events.length ? live.events : events;
  const progress = task?.progress == null ? null : Math.max(0, Math.min(100, Number(task.progress)));
  if (loading) return <main className="task-detail-page"><p className="muted">正在读取任务详情…</p></main>;
  if (!task) return <main className="task-detail-page"><Link className="task-detail-back" to="/tasks">← 返回消息中心</Link><section className="task-detail-error" role="alert"><strong>任务详情暂时无法读取</strong><p>{error || "任务不存在或当前账号没有访问权限。"}</p><button className="btn ghost" type="button" onClick={() => void load()}>重试</button></section></main>;
  return <main className="task-detail-page" data-task-detail>
    <header className="task-detail-page-header">
      <div className="task-detail-breadcrumb"><Link className="task-detail-back" to="/tasks">← 消息中心</Link><span>/</span><span>任务详情</span></div>
      <div className="task-detail-heading"><div><p className="eyebrow">Agent 任务 · {text(task.source, "系统任务")}</p><h1 title={task.title}>{text(task.title, "未命名任务")}</h1><p className="task-detail-subtitle">任务 ID：{task.id}</p></div><div className="task-detail-header-actions"><span className={`task-center-status status-${statusClass(task)}`}>{statusLabel(task)}</span><button className="btn ghost" type="button" onClick={() => void load(true)} disabled={refreshing}>{refreshing ? "刷新中…" : "刷新"}</button>{task.session_id ? <Link className="btn primary" to={`/s/${task.session_id}`}>查看进度</Link> : null}</div></div>
    </header>
    {error ? <p className="task-detail-inline-error" role="alert">{error} <button type="button" onClick={() => void load()}>重试</button></p> : null}
    <div className="task-detail-layout">
      <div className="task-detail-main">
        <section className="task-detail-section task-detail-overview"><div className="task-detail-section-head"><div><h2>任务概览</h2><p>先确认当前状态，再查看最近发生的事件。</p></div>{live.connected ? <span className="task-detail-live">实时更新中</span> : null}</div>{progress != null ? <div className="task-detail-progress"><div><span>执行进度</span><strong>{progress}%</strong></div><div className="task-detail-progress-track"><span style={{ width: `${progress}%` }} /></div></div> : null}<dl className="task-detail-info-grid"><div><dt>任务类型</dt><dd>Agent 任务</dd></div><div><dt>任务状态</dt><dd>{statusLabel(task)}</dd></div><div><dt>更新时间</dt><dd>{time(task.updated_at)}</dd></div><div><dt>创建时间</dt><dd>{time(task.created_at)}</dd></div><div><dt>开始时间</dt><dd>{time(task.started_at)}</dd></div><div><dt>完成时间</dt><dd>{time(task.completed_at)}</dd></div><div><dt>截止时间</dt><dd>{time(task.due_at)}</dd></div></dl></section>
        <section className="task-detail-section"><div className="task-detail-section-head"><div><h2>执行过程</h2><p>{visibleEvents.length ? `共 ${visibleEvents.length} 条过程记录` : "暂无执行事件"}</p></div></div>{visibleEvents.length ? <ol className="task-detail-timeline">{visibleEvents.map((event, index) => <li key={event.id || `${event.created_at}-${index}`}><span className="task-detail-timeline-dot" /><div><div className="task-detail-event-head"><strong>{eventTitle(event)}</strong><time>{time(event.created_at)}</time></div><p>{eventSummary(event)}</p>{event.status ? <small>{text(event.status)}</small> : null}</div></li>)}</ol> : <div className="task-detail-empty">任务开始运行后，执行事件会按时间显示在这里。</div>}</section>
        {(task.artifacts?.length || task.business_events?.length) ? <section className="task-detail-section"><div className="task-detail-section-head"><div><h2>相关记录</h2><p>任务执行过程中产生的结果与业务记录。</p></div></div><div className="task-detail-records">{task.artifacts?.length ? <div><strong>结果产物</strong><span>{task.artifacts.length} 条</span></div> : null}{task.business_events?.length ? <div><strong>业务事件</strong><span>{task.business_events.length} 条</span></div> : null}</div></section> : null}
      </div>
      <aside className="task-detail-side"><section className="task-detail-section"><div className="task-detail-section-head"><div><h2>任务信息</h2><p>创建任务时记录的上下文。</p></div></div><dl className="task-detail-side-list"><div><dt>任务说明</dt><dd>{text(task.description || task.content || task.context, "暂无任务说明")}</dd></div><div><dt>技能</dt><dd>{text(task.skill || task.skill_id, "未指定")}</dd></div><div><dt>优先级</dt><dd>{text(task.priority_label || task.priority, "普通")}</dd></div><div><dt>风险等级</dt><dd>{text(task.risk_level || task.risk, "未标注")}</dd></div><div><dt>下一步</dt><dd>{text(task.next_action || task.wait_reason, CLOSED.has(String(task.status).toLowerCase()) ? "任务已结束" : "等待系统更新")}</dd></div></dl></section><section className="task-detail-section task-detail-next"><h2>接下来</h2>{task.session_id ? <Link to={`/s/${task.session_id}`}>进入完整会话 <span>→</span></Link> : <p>该任务没有可继续的会话入口。</p>}{task.retryable ? <p className="task-detail-hint">任务失败后支持重新执行，请在任务列表中操作。</p> : null}</section></aside>
    </div>
  </main>;
}
