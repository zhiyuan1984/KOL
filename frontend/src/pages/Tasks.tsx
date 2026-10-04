import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type AiTaskWorkOrderAggregate, type AiTaskWorkOrderDashboard, type Task, type TaskDetail, type TaskEvent } from "../api";
import { useTaskRunEventStream } from "../hooks/useTaskRunEventStream";

type View = "active" | "history";
type TaskStatusTab = "all" | "queued" | "running" | "waiting_approval" | "failed" | "completed" | "cancelled";

const STATUS_TABS: Array<{ value: TaskStatusTab; label: string }> = [
  { value: "all", label: "全部" },
  { value: "queued", label: "排队中" },
  { value: "running", label: "执行中" },
  { value: "waiting_approval", label: "待确认" },
  { value: "failed", label: "失败" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];
const ACTIVE = new Set(["pending", "queued", "running", "starting", "in_progress", "waiting", "waiting_approval"]);
const CLOSED = new Set(["completed", "done", "success", "succeeded", "failed", "cancelled", "canceled"]);
const QUEUED = new Set(["pending", "queued"]);
const RUNNING = new Set(["running", "starting", "in_progress"]);
const WAITING = new Set(["waiting", "waiting_approval"]);
const COMPLETED = new Set(["completed", "done", "success", "succeeded"]);
const CANCELLED = new Set(["cancelled", "canceled"]);

function isStatusTab(value: string | null): value is TaskStatusTab {
  return STATUS_TABS.some((tab) => tab.value === value);
}

function normalizedStatus(task: Task) {
  return String(task.status || task.display_status || "pending").toLowerCase();
}

function statusOf(task: Task) {
  const value = normalizedStatus(task);
  if (value === "waiting_approval") return "待确认";
  if (value === "queued" || value === "pending") return "排队中";
  if (value === "running" || value === "starting" || value === "in_progress") return "执行中";
  if (CLOSED.has(value)) return value === "failed" ? "失败" : value === "cancelled" || value === "canceled" ? "已取消" : "已完成";
  return task.display_status_label || value;
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function workOrderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    proposed: "待确认", pending_assignment: "待分派", assigned: "已分派", accepted: "已受理",
    in_progress: "处理中", waiting_external: "等待外部", waiting_approval: "等待确认",
    ready_for_acceptance: "待验收", needs_review: "待复核", completed: "已完成", cancelled: "已取消",
  };
  return labels[status] || status;
}

function workOrderDecisionSummary(order: AiTaskWorkOrderAggregate["work_orders"][number]) {
  if (!order.latest_decision) return "无自动化决策";
  const confidence = order.latest_decision.confidence == null ? "" : ` · 置信度 ${Math.round(order.latest_decision.confidence * 100)}%`;
  return `${order.latest_decision.outcome}${confidence}`;
}

function hidesSignalTimeout(value?: unknown) {
  return typeof value === "string" && /signal\s+timed\s+out/i.test(value);
}

function safeTaskText(value?: unknown, fallback = "—") {
  if (value == null || String(value).trim() === "") return fallback;
  const cleaned = String(value).replace(/signal\s+timed\s+out/gi, "").replace(/\s{2,}/g, " ").trim();
  return cleaned || fallback;
}

function taskSummary(task: Task) {
  return safeTaskText(task.wait_reason || task.last_error || task.history_summary || task.next_action || task.description || task.content);
}

function taskSignature(task: Task) {
  return [
    task.id,
    normalizedStatus(task),
    task.title,
    task.skill,
    task.skill_id,
    task.source,
    task.created_at,
    task.started_at,
    task.queued_at,
    task.queue_position,
    task.session_id,
    task.retryable,
    task.cancelable,
    taskSummary(task),
  ].map((value) => String(value ?? "")).join("\u001f");
}

function sameTaskRows(current: Task[], next: Task[]) {
  if (current.length !== next.length) return false;
  const currentById = new Map(current.map((task) => [task.id, task]));
  return next.every((task) => currentById.has(task.id) && taskSignature(currentById.get(task.id)!) === taskSignature(task));
}

function mergeTaskRows(head: Task[], tail: Task[]): Task[] {
  const seen = new Set(head.map((task) => task.id));
  return [...head, ...tail.filter((task) => !seen.has(task.id))];
}

function canSelect(task: Task) {
  return QUEUED.has(normalizedStatus(task)) || normalizedStatus(task) === "needs_clarification";
}

function canCancel(task: Task) {
  return task.cancelable !== false && canSelect(task);
}

function actionLabel(task: Task, view: View) {
  if (view === "history") return "查看结果";
  if (normalizedStatus(task) === "waiting_approval") return "继续处理";
  return "查看进度";
}

function belongsToTab(task: Task, tab: TaskStatusTab) {
  const value = normalizedStatus(task);
  if (tab === "all") return true;
  if (tab === "queued") return QUEUED.has(value);
  if (tab === "running") return RUNNING.has(value);
  if (tab === "waiting_approval") return WAITING.has(value);
  if (tab === "failed") return value === "failed";
  if (tab === "completed") return COMPLETED.has(value);
  return CANCELLED.has(value);
}

export default function Tasks() {
  const [params, setParams] = useSearchParams();
  const selectedStatus: TaskStatusTab = isStatusTab(params.get("status")) ? params.get("status") as TaskStatusTab : "running";
  const view: View = selectedStatus === "all" || ACTIVE.has(selectedStatus) ? "active" : "history";
  const [rows, setRows] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [aiDashboard, setAiDashboard] = useState<AiTaskWorkOrderDashboard | null>(null);
  const [aiDashboardLoading, setAiDashboardLoading] = useState(true);
  const [expandedAiTasks, setExpandedAiTasks] = useState<Record<string, AiTaskWorkOrderAggregate>>({});
  const [selectedAiTask, setSelectedAiTask] = useState<AiTaskWorkOrderAggregate | null>(null);
  const [showAiTaskCreate, setShowAiTaskCreate] = useState(false);
  const [aiTaskDraft, setAiTaskDraft] = useState({ title: "", goal: "", due_at: "", priority: "normal" });
  const [showAiEventCreate, setShowAiEventCreate] = useState(false);
  const [aiEventDraft, setAiEventDraft] = useState({ event_type: "mail.reply_verified", summary: "", evidence_ref: "", occurred_at: "", work_order_id: "", evidence_keys: "", completed_stages: "" });
  const [aiEventNotice, setAiEventNotice] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSystemTasks, setShowSystemTasks] = useState(false);
  const requestRef = useRef<Promise<void> | null>(null);
  const rowsRef = useRef<Task[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const selectedRunId = useMemo(() => {
    const runs = selected?.runs || [];
    const latest = [...runs].reverse().find((run) => typeof run.id === "string" || typeof run.run_id === "string");
    return latest ? String(latest.id || latest.run_id || "") || null : null;
  }, [selected]);
  const liveRunEvents = useTaskRunEventStream(selectedRunId);

  const load = useCallback((background = false, append = false) => {
    if (requestRef.current) return requestRef.current;
    if (append && !nextCursorRef.current) return Promise.resolve();
    const request = (async () => {
      if (!background && !append) setLoading(true);
      if (append) setLoadingMore(true);
      setError("");
      try {
        const response = await api.taskPage({
          view: "history", q: query, from, to, limit: 100,
          cursor: append ? nextCursorRef.current || undefined : undefined,
        });
        const nextRows = response.items || [];
        const merged = append
          ? mergeTaskRows(rowsRef.current, nextRows)
          : background
            ? mergeTaskRows(nextRows, rowsRef.current)
            : nextRows;
        if (!sameTaskRows(rowsRef.current, merged)) {
          rowsRef.current = merged;
          setRows(merged);
        }
        setTotal(Number(response.page?.total || 0));
        if (!background || append || rowsRef.current.length <= 100) {
          nextCursorRef.current = response.page?.next_cursor || null;
          setNextCursor(nextCursorRef.current);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "任务列表加载失败");
      } finally {
        if (!background && !append) setLoading(false);
        if (append) setLoadingMore(false);
        requestRef.current = null;
      }
    })();
    requestRef.current = request;
    return request;
  }, [view, query, from, to]);

  useEffect(() => { void load(); }, [load]);
  const loadAiDashboard = useCallback(async (background = false) => {
    if (!background) setAiDashboardLoading(true);
    try {
      setAiDashboard(await api.aiTaskWorkOrderDashboard({ limit: 50 }));
    } catch (cause) {
      // The retained system-run task list must stay usable while the progressive
      // PostgreSQL business read model is unavailable.
      setAiDashboard(null);
      if (!background) setError(cause instanceof Error ? cause.message : "业务任务与标准工单数据加载失败");
    } finally {
      if (!background) setAiDashboardLoading(false);
    }
  }, []);
  useEffect(() => { void loadAiDashboard(); }, [loadAiDashboard]);
  useEffect(() => {
    if (view !== "active") return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, 4000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, view]);

  const openDetail = async (task: Task) => {
    setActionBusy(`detail:${task.id}`);
    try {
      const [detailResponse, eventResponse] = await Promise.all([api.task(task.id), api.taskEvents(task.id)]);
      setSelected(("task" in detailResponse ? detailResponse.task : detailResponse) as TaskDetail);
      setEvents(Array.isArray(eventResponse) ? eventResponse : eventResponse.events || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务详情加载失败");
    } finally {
      setActionBusy("");
    }
  };

  const cancel = async (task: Task) => {
    if (!window.confirm("确认取消这个尚未开始执行的任务？")) return;
    setActionBusy(`cancel:${task.id}`);
    try {
      await api.cancelTask(task);
      await load();
      if (selected?.id === task.id) setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取消失败");
    } finally {
      setActionBusy("");
    }
  };

  const openAiTask = async (taskId: string) => {
    setActionBusy(`ai-task:${taskId}`);
    try {
      setSelectedAiTask(await api.aiTaskWorkOrder(taskId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 工单任务详情加载失败");
    } finally {
      setActionBusy("");
    }
  };

  const toggleAiTaskRow = async (taskId: string) => {
    if (expandedAiTasks[taskId]) {
      setExpandedAiTasks((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
      return;
    }
    setActionBusy(`ai-task-expand:${taskId}`);
    try {
      const detail = await api.aiTaskWorkOrder(taskId);
      setExpandedAiTasks((current) => ({ ...current, [taskId]: detail }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "子工单明细加载失败");
    } finally {
      setActionBusy("");
    }
  };

  const createAiTask = async () => {
    if (!aiTaskDraft.title.trim()) {
      setError("请填写业务任务标题。");
      return;
    }
    setActionBusy("ai-task:create");
    setError("");
    try {
      const created = await api.createAiTaskWorkOrderRoot({
        title: aiTaskDraft.title.trim(),
        goal: aiTaskDraft.goal.trim() || undefined,
        due_at: aiTaskDraft.due_at ? new Date(`${aiTaskDraft.due_at}T23:59:59`).toISOString() : undefined,
        priority: aiTaskDraft.priority as "important_urgent" | "important" | "urgent" | "normal" | "low",
        idempotency_key: `ai-task-root-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      });
      setAiTaskDraft({ title: "", goal: "", due_at: "", priority: "normal" });
      setShowAiTaskCreate(false);
      await loadAiDashboard(true);
      setSelectedAiTask(await api.aiTaskWorkOrder(created.task.task_id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 业务任务创建失败");
    } finally {
      setActionBusy("");
    }
  };

  const recordAiVerifiedEvent = async () => {
    if (!selectedAiTask) return;
    if (!aiEventDraft.summary.trim() || !aiEventDraft.evidence_ref.trim()) {
      setError("请填写已核验事实摘要和证据引用。");
      return;
    }
    const taskId = selectedAiTask.task.task_id;
    setActionBusy("ai-task:verified-event");
    setError("");
    setAiEventNotice("");
    try {
      const stamp = Date.now();
      const split = (value: string) => [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
      const evidenceKeys = split(aiEventDraft.evidence_keys);
      const completedStages = split(aiEventDraft.completed_stages);
      const result = await api.recordAiTaskVerifiedEvent(taskId, {
        source_system: "workbench_human_verification",
        source_event_id: `workbench:${taskId}:${stamp}`,
        source_version: "workbench.v1",
        event_type: aiEventDraft.event_type,
        occurred_at: aiEventDraft.occurred_at ? new Date(aiEventDraft.occurred_at).toISOString() : new Date().toISOString(),
        summary: aiEventDraft.summary.trim(),
        evidence_ref: aiEventDraft.evidence_ref.trim(),
        evidence: {
          verified_in: "workbench", actor_action: "human_verified_event",
          completed_stages: completedStages,
          ...Object.fromEntries(evidenceKeys.map((key) => [key, true])),
        },
        payload: {},
        work_order_id: aiEventDraft.work_order_id || undefined,
        idempotency_key: `workbench-verified-event-${taskId}-${stamp}`,
      });
      setAiEventDraft({ event_type: "mail.reply_verified", summary: "", evidence_ref: "", occurred_at: "", work_order_id: "", evidence_keys: "", completed_stages: "" });
      setShowAiEventCreate(false);
      setAiEventNotice(`已核验事件已进入 Jev → Outbox → Worker 管道（决策：${result.decision.outcome}；作业：${result.execution_job.status}）。阶段写入只会在 A3 模板、置信度、证据一致性和发布开关全部通过时发生。`);
      await loadAiDashboard(true);
      setSelectedAiTask(await api.aiTaskWorkOrder(taskId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "已核验事件登记失败");
    } finally {
      setActionBusy("");
    }
  };

  const visible = useMemo(() => rows.filter((task) => belongsToTab(task, selectedStatus)), [rows, selectedStatus]);
  const counts = useMemo(() => {
    const next = new Map<TaskStatusTab, number>();
    STATUS_TABS.forEach((tab) => next.set(tab.value, tab.value === "all" ? rows.length : rows.filter((task) => belongsToTab(task, tab.value)).length));
    return next;
  }, [rows]);
  const selectableRows = useMemo(() => visible.filter(canSelect), [visible]);
  const allSelected = selectableRows.length > 0 && selectableRows.every((task) => selectedIds.has(task.id));
  useEffect(() => {
    const visibleIds = new Set(selectableRows.map((task) => task.id));
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [selectableRows]);

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(selectableRows.map((task) => task.id)) : new Set());
  };

  const cancelSelected = async () => {
    if (!selectedIds.size || !window.confirm(`确认取消 ${selectedIds.size} 个排队任务？`)) return;
    setActionBusy("bulk-cancel");
    try {
      const selectedTasks = rows.filter((task) => selectedIds.has(task.id));
      await Promise.all(selectedTasks.map((task) => api.cancelTask(task)));
      setSelectedIds(new Set());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量取消失败");
    } finally {
      setActionBusy("");
    }
  };

  const loadMore = () => { void load(false, true); };

  return (
    <main className="tasks-page" data-task-center>
      <section className="panel task-work-order-dashboard" aria-label="标准工单运营报表">
        <div className="split-head">
          <div>
            <p className="eyebrow">业务运营 · PostgreSQL 工单事实</p>
            <h2>标准工单运营报表</h2>
            <p className="muted">先看授权范围内的工单存量、自动生成和自动派单事实，再按业务任务展开查看归属子工单。运行成功不会自动完成业务任务。</p>
          </div>
          <div className="row-actions">
            <span className="muted">{aiDashboard?.scope === "organization_authorized" ? "组织授权范围" : "个人授权范围"}</span>
            <button className="btn ghost" type="button" onClick={() => void loadAiDashboard()} disabled={aiDashboardLoading}>{aiDashboardLoading ? "刷新中…" : "刷新报表"}</button>
          </div>
        </div>
        {aiDashboardLoading ? <p className="muted">正在汇总标准工单运营事实…</p> : !aiDashboard ? <p className="muted">暂时无法读取工单运营报表；系统运行任务仍可在下方展开查看。</p> : <>
          <div className="task-work-order-kpis" aria-label="工单运营关键计数">
            <article><span>业务任务</span><strong>{aiDashboard.summary.tasks.total}</strong><small>开放 {aiDashboard.summary.tasks.open} · 有阻塞 {aiDashboard.summary.tasks.blocked}</small></article>
            <article><span>标准工单</span><strong>{aiDashboard.summary.work_orders.total}</strong><small>开放 {aiDashboard.summary.work_orders.open} · 待复核 {aiDashboard.summary.work_orders.waiting_review}</small></article>
            <article><span>自动生成</span><strong>{aiDashboard.summary.work_orders.automatic_created}</strong><small>仅计成功物化的执行事实</small></article>
            <article><span>自动派单</span><strong>{aiDashboard.summary.work_orders.automatic_assigned}</strong><small>自动生成且当前有确定性主受理路由</small></article>
          </div>
          <div className="task-work-order-template-wrap">
            <h3>工单类型与版本</h3>
            {aiDashboard.by_template.length ? <table className="task-work-order-template-table">
              <thead><tr><th>标准模板</th><th>等级</th><th>总数</th><th>自动生成</th><th>自动派单</th><th>开放 / 阻塞 / 待复核</th></tr></thead>
              <tbody>{aiDashboard.by_template.map((template) => <tr key={`${template.template_code}:${template.template_version}:${template.automation_level}`}>
                <td><strong>{template.template_title}</strong><small>{template.template_code}.v{template.template_version}</small></td>
                <td>{template.automation_level}</td><td>{template.total}</td><td>{template.automatic_created}</td><td>{template.automatic_assigned}</td><td>{template.open} / {template.blocked} / {template.waiting_review}</td>
              </tr>)}</tbody>
            </table> : <p className="muted">当前授权范围内尚无标准工单。</p>}
          </div>
          <p className="muted task-work-order-as-of">口径：{aiDashboard.source} · 截止 {formatTime(aiDashboard.as_of)} · 时区 {aiDashboard.timezone}</p>
        </>}
      </section>

      <section className="panel task-work-order-task-list" aria-label="业务任务及其标准工单">
        <div className="split-head">
          <div><h2>业务任务与标准工单</h2><p className="muted">每一行是一个业务目标；展开后查看它已物化的标准工单、自动化来源、主受理、当前阶段与阻塞事实。</p></div>
          <div className="row-actions"><span className="status-ok">{aiDashboard?.tasks.page.total || 0} 个业务任务</span><button className="btn ghost" type="button" onClick={() => setShowAiTaskCreate((current) => !current)}>{showAiTaskCreate ? "收起" : "新建业务任务"}</button></div>
        </div>
        {showAiTaskCreate && <form className="task-work-order-create" onSubmit={(event) => { event.preventDefault(); void createAiTask(); }}>
          <label>任务标题<input value={aiTaskDraft.title} maxLength={200} placeholder="例如：推进 KOL 报价确认" onChange={(event) => setAiTaskDraft((current) => ({ ...current, title: event.target.value }))} /></label>
          <label>业务目标<textarea value={aiTaskDraft.goal} maxLength={4000} placeholder="说明要达成的业务结果；工单将围绕该目标生成。" onChange={(event) => setAiTaskDraft((current) => ({ ...current, goal: event.target.value }))} /></label>
          <label>优先级<select value={aiTaskDraft.priority} onChange={(event) => setAiTaskDraft((current) => ({ ...current, priority: event.target.value }))}><option value="important_urgent">重要且紧急</option><option value="important">重要</option><option value="urgent">紧急</option><option value="normal">普通</option><option value="low">低</option></select></label>
          <label>截止日期<input type="date" value={aiTaskDraft.due_at} onChange={(event) => setAiTaskDraft((current) => ({ ...current, due_at: event.target.value }))} /></label>
          <div className="row-actions"><button className="btn primary" type="submit" disabled={actionBusy === "ai-task:create"}>{actionBusy === "ai-task:create" ? "创建中…" : "创建业务任务"}</button></div>
        </form>}
        {aiDashboard && aiDashboard.tasks.items.length ? <div className="task-work-order-task-table-wrap"><table className="task-work-order-task-table">
          <thead><tr><th>业务任务</th><th>子工单</th><th>自动化</th><th>当前风险 / 下一单</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>{aiDashboard.tasks.items.map((item) => {
            const detail = expandedAiTasks[item.task.task_id];
            const blocking = item.current_blocking_work_order;
            const next = item.next_work_order;
            return <Fragment key={item.task.task_id}>
              <tr className={detail ? "is-expanded" : undefined}>
                <td><strong>{item.task.title}</strong><small>{item.task.goal}</small><small>截止 {formatTime(item.task.due_at)} · {item.task.priority}</small></td>
                <td><strong>{item.counts.open} / {item.counts.total}</strong><small>阻塞 {item.counts.blocked} · 待复核 {item.counts.waiting_review}</small></td>
                <td><strong>生成 {item.counts.automatic_created}</strong><small>派单 {item.counts.automatic_assigned}</small></td>
                <td>{blocking ? <><strong className="status-alert">阻塞：{blocking.title}</strong><small>{workOrderStatusLabel(blocking.status)} · {blocking.template_code}.v{blocking.template_version}</small></> : next ? <><strong>下一单：{next.title}</strong><small>{workOrderStatusLabel(next.status)} · {next.template_code}.v{next.template_version}</small></> : <span className="muted">暂无开放工单</span>}</td>
                <td>{item.task.status}</td>
                <td className="task-work-order-row-actions"><button className="btn ghost sm" type="button" disabled={actionBusy === `ai-task-expand:${item.task.task_id}`} onClick={() => void toggleAiTaskRow(item.task.task_id)}>{detail ? "收起工单" : actionBusy === `ai-task-expand:${item.task.task_id}` ? "展开中…" : "展开工单"}</button><button className="btn ghost sm" type="button" onClick={() => void openAiTask(item.task.task_id)}>详情</button></td>
              </tr>
              {detail ? <tr className="task-work-order-detail-row"><td colSpan={6}><div className="task-work-order-detail-panel">
                <div className="split-head"><div><h3>归属标准工单</h3><p className="muted">自动化状态来自不可变执行尝试和当前生效的主受理路由；不会由模板等级推断。</p></div><button className="btn ghost sm" type="button" onClick={() => void openAiTask(item.task.task_id)}>完整任务详情</button></div>
                {detail.work_orders.length ? <table className="task-work-order-child-table"><thead><tr><th>标准工单</th><th>业务目标与阶段</th><th>生成与派单</th><th>主受理</th><th>状态</th><th>决策摘要</th></tr></thead><tbody>{detail.work_orders.map((order) => <tr key={order.work_order_id}>
                  <td><strong>{order.template_title}</strong><small>{order.template_code}.v{order.template_version} · {order.automation_level}</small></td>
                  <td><strong>{order.title}</strong><small>{order.objective || "—"}</small><small>阶段：{order.stage_code || "未设置"}</small></td>
                  <td><strong>{order.automatic_created ? "自动生成" : "人工 / 非自动生成"}</strong><small>{order.automatic_assigned ? "自动派单已生效" : "未形成自动派单事实"}</small></td>
                  <td><strong>{order.primary_assignee?.person_ref || order.primary_assignee?.principal_id || "尚未分派"}</strong><small>{order.routing_policy_code ? `路由：${order.routing_policy_code}` : order.assignment_origin === "manual_or_unverified" ? "人工或未验证路由" : "—"}</small></td>
                  <td><span className={`task-center-status status-${order.status}`}>{workOrderStatusLabel(order.status)}</span></td>
                  <td><small>{workOrderDecisionSummary(order)}</small></td>
                </tr>)}</tbody></table> : <p className="muted">该业务任务尚未物化标准执行工单。</p>}
              </div></td></tr> : null}
            </Fragment>;
          })}</tbody>
        </table></div> : <p className="muted">尚未建立业务任务。创建任务后，只有已核验事件、已发布模板和受控 Jev 判断才会生成或分派标准工单。</p>}
      </section>

      {error && <p className="surface-error" role="alert">{hidesSignalTimeout(error) ? "任务暂时无法读取，请稍后查看。" : error}</p>}

      <section className="panel task-center-system-section" aria-label="系统运行任务">
        <button className="task-center-system-toggle" type="button" aria-expanded={showSystemTasks} onClick={() => setShowSystemTasks((current) => !current)}>
          <span><strong>系统运行任务</strong><small>保留原工作台 Agent、计划和执行任务</small></span><span>{showSystemTasks ? "收起" : `展开（${total || rows.length}）`}</span>
        </button>
        {showSystemTasks ? <div className="task-center-system-body">
          <nav className="tasks-tabs" aria-label="任务状态">
            {STATUS_TABS.map((tab) => (
              <button key={tab.value} type="button" className={selectedStatus === tab.value ? "is-active" : ""} aria-pressed={selectedStatus === tab.value} onClick={() => setParams({ status: tab.value })}>{tab.label}<span className="tasks-tab-count" aria-label={`${counts.get(tab.value) || 0} 个任务`}>{counts.get(tab.value) || 0}</span></button>
            ))}
            {selectedStatus === "cancelled" ? <Link className="button button-primary task-center-create-action" to="/">新建任务</Link> : null}
          </nav>
          <div className="task-center-filters" role="search" aria-label="筛选任务">
            <label className="task-filter-search"><span className="sr-only">搜索任务</span><span className="task-filter-search-wrap"><svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg><input aria-label="搜索任务名称、内容或技能" placeholder="搜索任务名称、内容或技能" value={query} onChange={(event) => setQuery(event.target.value)} /></span></label>
            <fieldset className="task-filter-date-range"><span className="task-filter-date-label">时间范围</span><input type="date" aria-label="开始日期" value={from} onChange={(event) => setFrom(event.target.value)} /><span aria-hidden="true">至</span><input type="date" aria-label="结束日期" value={to} onChange={(event) => setTo(event.target.value)} /></fieldset>
            <div className="task-filter-actions">{view === "active" && selectedIds.size ? <button type="button" onClick={() => void cancelSelected()} disabled={Boolean(actionBusy)}>取消选中 ({selectedIds.size})</button> : null}</div>
          </div>
          {loading ? <p className="muted">正在读取系统任务状态…</p> : visible.length === 0 ? <section className="task-center-empty"><strong>当前没有{STATUS_TABS.find((tab) => tab.value === selectedStatus)?.label}任务</strong><p>任务状态变化后会自动更新。</p></section> : <div className="task-center-table-wrap"><table className="task-center-table"><colgroup><col className="task-center-col-select" /><col className="task-center-col-task" /><col className="task-center-col-status" /><col className="task-center-col-time" /><col className="task-center-col-summary" /><col className="task-center-col-actions" /></colgroup><thead><tr><th className="task-center-select">{view === "active" && selectableRows.length ? <input type="checkbox" aria-label="全选可取消任务" checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} /> : null}</th><th>任务</th><th>状态</th><th>时间</th><th>结果摘要</th><th>操作</th></tr></thead><tbody>{visible.map((task) => { const summary = taskSummary(task); return <tr key={task.id}><td className="task-center-select">{view === "active" && canSelect(task) ? <input type="checkbox" aria-label={`选择 ${task.title || "未命名任务"}`} checked={selectedIds.has(task.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(task.id) : next.delete(task.id); return next; })} /> : null}</td><td className="task-center-task-cell"><strong title={safeTaskText(task.title, "未命名任务")}>{safeTaskText(task.title, "未命名任务")}</strong><small>{task.skill || task.skill_id || task.source || "Agent 任务"}</small></td><td className="task-center-status-cell"><span className={`task-center-status status-${normalizedStatus(task)}`}>{statusOf(task)}</span>{task.queue_position ? <small>队列第 {task.queue_position} 位</small> : null}</td><td className="task-center-time-cell"><small>创建 {formatTime(task.created_at)}</small>{task.started_at ? <small>开始 {formatTime(task.started_at)}</small> : task.queued_at ? <small>入队 {formatTime(task.queued_at)}</small> : null}</td><td className="task-center-summary-cell" title={summary}><span>{summary}</span></td><td className="task-center-actions"><button type="button" onClick={() => void openDetail(task)} disabled={actionBusy === `detail:${task.id}`}>详情</button>{task.session_id ? <Link to={`/s/${task.session_id}`}>{actionLabel(task, view)}</Link> : null}{view === "active" && canCancel(task) ? <button type="button" onClick={() => void cancel(task)} disabled={Boolean(actionBusy)}>取消</button> : null}</td></tr>; })}</tbody></table></div>}
          {!loading && rows.length > 0 ? <div className="row-actions task-center-pagination" aria-live="polite"><span className="muted">已载入 {rows.length} / {total || rows.length} 个系统任务</span>{nextCursor ? <button type="button" className="btn ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更多任务"}</button> : <span className="muted">已显示全部匹配任务</span>}</div> : null}
        </div> : null}
      </section>

      {selected ? <div className="task-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="task-detail-drawer" role="dialog" aria-modal="true" aria-label="任务详情">
        <header><div><p className="eyebrow">任务详情</p><h2>{safeTaskText(selected.title, "未命名任务")}</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button></header>
        <dl className="task-detail-meta"><div><dt>状态</dt><dd>{statusOf(selected)}</dd></div><div><dt>任务 ID</dt><dd>{selected.id}</dd></div><div><dt>创建时间</dt><dd>{formatTime(selected.created_at)}</dd></div><div><dt>说明</dt><dd>{taskSummary(selected)}</dd></div></dl>
        <p className="muted">已尝试 {selected.runs?.length || 0} 次{selected.runs?.length ? `；最近一次：${String(selected.runs[selected.runs.length - 1]?.status || "未知")}` : ""}</p>
        <section><h3>执行事件 {liveRunEvents.connected ? <small className="muted">实时更新中</small> : liveRunEvents.fallback ? <small className="muted">正在以安全补读更新</small> : null}</h3>{(liveRunEvents.events.length ? liveRunEvents.events : events).length ? <ol className="task-detail-events">{(liveRunEvents.events.length ? liveRunEvents.events : events).map((event, index) => <li key={event.id || `${event.created_at}-${index}`}><strong>{safeTaskText(event.title || event.type, "任务事件")}</strong><small>{formatTime(event.created_at)}</small><p>{safeTaskText(event.summary || event.message)}</p></li>)}</ol> : <p className="muted">暂无执行事件。</p>}</section>
        <div className="task-detail-actions">{selected.session_id ? <Link className="button" to={`/s/${selected.session_id}`}>{selected.status === "waiting" || selected.status === "waiting_approval" ? "继续处理" : "查看任务"}</Link> : null}</div>
      </aside></div> : null}
      {selectedAiTask ? <div className="task-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAiTask(null); }}><aside className="task-detail-drawer" role="dialog" aria-modal="true" aria-label="AI 标准工单任务详情">
        <header><div><p className="eyebrow">业务任务 · AI 标准工单</p><h2>{selectedAiTask.task.title}</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelectedAiTask(null)}>×</button></header>
        <dl className="task-detail-meta"><div><dt>任务状态</dt><dd>{selectedAiTask.task.status}</dd></div><div><dt>业务目标</dt><dd>{selectedAiTask.task.goal}</dd></div><div><dt>任务截止</dt><dd>{formatTime(selectedAiTask.task.due_at)}</dd></div><div><dt>子工单</dt><dd>{selectedAiTask.counts.open} 开放 / {selectedAiTask.counts.total} 总计 / {selectedAiTask.counts.blocked} 阻塞</dd></div></dl>
        <section>
          <div className="split-head"><div><h3>登记已核验业务事件</h3><p className="muted">只登记已核验事实，不填写推测或结论。提交后才会触发受控 Jev 判断与异步工单管道；运行成功不代表工单或任务完成。选择目标子工单后，A3 可以提出非相邻阶段，但必须由模板明确授权，并证明每一个中间阶段事实。</p></div><button className="btn ghost sm" type="button" onClick={() => setShowAiEventCreate((current) => !current)}>{showAiEventCreate ? "收起" : "登记事件"}</button></div>
          {showAiEventCreate && <form className="task-work-order-create task-work-order-event-create" onSubmit={(event) => { event.preventDefault(); void recordAiVerifiedEvent(); }}>
            <label>事件类型<select value={aiEventDraft.event_type} onChange={(event) => setAiEventDraft((current) => ({ ...current, event_type: event.target.value }))}><option value="mail.reply_verified">已验证邮件回复</option><option value="mail.commitment_verified">已验证邮件承诺</option><option value="deadline.quote">报价期限</option><option value="deadline.contract">合同期限</option><option value="deadline.sample">样品期限</option><option value="deadline.content">内容期限</option></select></label>
            <label>作用子工单（A3 可选）<select value={aiEventDraft.work_order_id} onChange={(event) => setAiEventDraft((current) => ({ ...current, work_order_id: event.target.value }))}><option value="">不指定：仅判断是否新建/分派工单</option>{selectedAiTask.work_orders.filter((order) => !["completed", "cancelled"].includes(order.status)).map((order) => <option key={order.work_order_id} value={order.work_order_id}>{order.title} · 当前阶段 {order.stage_code || "未设定"}</option>)}</select></label>
            <label>事实摘要<textarea value={aiEventDraft.summary} maxLength={1000} placeholder="仅写已经确认的事实，例如：样品已签收并进入测试。" onChange={(event) => setAiEventDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
            <label>证据引用<input value={aiEventDraft.evidence_ref} maxLength={1000} placeholder="例如：mail:thread/123 或 fulfillment:receipt/2" onChange={(event) => setAiEventDraft((current) => ({ ...current, evidence_ref: event.target.value }))} /></label>
            <label>已核验证据键（每行一个）<textarea value={aiEventDraft.evidence_keys} placeholder={"receipt_verified\ncompleted_stages"} onChange={(event) => setAiEventDraft((current) => ({ ...current, evidence_keys: event.target.value }))} /><small className="muted">需匹配 A3 模板策略；键值将随事件不可变审计。</small></label>
            <label>已完成阶段（每行一个）<textarea value={aiEventDraft.completed_stages} placeholder={"SHIPPED\nTESTING"} onChange={(event) => setAiEventDraft((current) => ({ ...current, completed_stages: event.target.value }))} /><small className="muted">跨阶段时必须逐项列出并已由当前证据核验的中间阶段与目标阶段。</small></label>
            <label>发生时间<input type="datetime-local" value={aiEventDraft.occurred_at} onChange={(event) => setAiEventDraft((current) => ({ ...current, occurred_at: event.target.value }))} /></label>
            <div className="row-actions"><button className="btn primary" type="submit" disabled={actionBusy === "ai-task:verified-event"}>{actionBusy === "ai-task:verified-event" ? "提交中…" : "提交已核验事件"}</button></div>
          </form>}
          {aiEventNotice && <p className="muted" role="status">{aiEventNotice}</p>}
        </section>
        <section><h3>已核验业务事件</h3>{selectedAiTask.verified_events.length ? <ol className="task-detail-events">{selectedAiTask.verified_events.map((event) => <li key={event.id}><strong>{event.event_type}</strong><small>{formatTime(event.occurred_at)} · 核验 {formatTime(event.verified_at)}</small><p>{event.summary}</p><p className="muted">证据：{event.evidence_ref}</p></li>)}</ol> : <p className="muted">尚未记录可用于自动化判断的已核验业务事件。</p>}</section>
        <section><h3>标准执行工单</h3>{selectedAiTask.work_orders.length ? <ol className="task-detail-events">{selectedAiTask.work_orders.map((order) => <li key={order.work_order_id}><strong>{order.title}</strong><small>{order.template_code}.v{order.template_version} · {order.automation_level} · {order.status}</small><p>{order.objective}</p><p className="muted">主受理：{order.primary_assignee?.person_ref || order.primary_assignee?.principal_id || "尚未分派"} · 决策：{order.latest_decision ? `${order.latest_decision.outcome}（${order.latest_decision.confidence ?? "—"}）` : "—"}</p></li>)}</ol> : <p className="muted">该业务任务尚未物化标准执行工单。</p>}</section>
        <p className="muted">数据来源：PostgreSQL 任务—工单关系；子工单终态不会直接改变任务根状态。</p>
      </aside></div> : null}
    </main>
  );
}
