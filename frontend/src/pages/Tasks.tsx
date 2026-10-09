import { Button } from "antd";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, type AiTaskWorkOrderAggregate, type AiTaskWorkOrderDashboard, type Task, type TaskDetail, type TaskEvent, type TaskOperationsDashboard, type TaskOperationsPeriod } from "../api";
import { useTaskRunEventStream } from "../hooks/useTaskRunEventStream";
import { TaskDetailDrawer } from "../tasks/TaskDetailDrawer";
import { TaskRowActions } from "../tasks/TaskRowActions";
import { AgentExpandedDetails, BusinessExpandedDetails } from "../tasks/TaskExpandedDetails";
import { TaskOperationsReport, type TaskOperationsFilter } from "../tasks/TaskOperationsReport";
import { BusinessTaskDetailContent } from "../tasks/BusinessTaskDetailContent";
import { captureTaskListSnapshot, readTaskListSnapshot } from "../tasks/taskDetailNavigation";
import { businessTaskStatus, createTaskSearchDebouncer, isAgentTaskInProgress, sortTaskRowsByUpdatedAt } from "../tasks/taskCenterModel";

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
    open: "待启动", queued: "排队中", pending: "排队中", proposed: "待确认", pending_assignment: "待分派", assigned: "已分派", accepted: "已受理",
    running: "进行中", in_progress: "处理中", waiting: "等待中", waiting_external: "等待外部", waiting_approval: "等待确认",
    blocked: "已阻塞", ready_for_review: "待复核", ready_for_acceptance: "待验收", needs_review: "待复核", completed: "已完成", cancelled: "已取消", canceled: "已取消",
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
    task.updated_at,
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
  if (view === "history" || CLOSED.has(normalizedStatus(task))) return "查看结果";
  if (normalizedStatus(task) === "waiting_approval") return "继续处理";
  return "进度";
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
  const navigate = useNavigate();
  const location = useLocation();
  const [restoreSnapshot] = useState(() => {
    const candidate = readTaskListSnapshot<TaskOperationsFilter>();
    const listParams = new URLSearchParams(location.search); listParams.delete("businessTask");
    const listUrl = `/tasks${listParams.size ? `?${listParams}` : ""}`;
    return candidate?.originalUrl === listUrl ? candidate : null;
  });
  const listRef = useRef<HTMLElement | null>(null);
  const loadedAgentPages = useRef(1);
  const loadedBusinessPages = useRef(1);
  const agentRestorePages = useRef(restoreSnapshot?.loadedAgentPages || 1);
  const businessRestorePages = useRef(restoreSnapshot?.loadedBusinessPages || 1);
  const restoreScroll = useRef(restoreSnapshot?.scrollPosition ?? null);
  const [detailDirty, setDetailDirty] = useState(false);
  const [detailEntryOpen, setDetailEntryOpen] = useState(false);
  const [detailSubmitting, setDetailSubmitting] = useState(false);
  const [params, setParams] = useSearchParams();
  const rawPeriod = params.get("period");
  const isPeriod = (value: string | null): value is TaskOperationsPeriod => ["realtime", "today", "week", "month", "year"].includes(String(value));
  const period: TaskOperationsPeriod = isPeriod(rawPeriod) ? rawPeriod : "realtime";
  const selectedStatus: TaskStatusTab = isStatusTab(params.get("status")) ? params.get("status") as TaskStatusTab : "all";
  const view: View = selectedStatus === "all" || ACTIVE.has(selectedStatus) ? "active" : "history";
  const [rows, setRows] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [systemError, setSystemError] = useState("");
  const [reportError, setReportError] = useState("");
  const [periodNotice, setPeriodNotice] = useState("");
  const [selected, setSelected] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [operationsDashboard, setOperationsDashboard] = useState<TaskOperationsDashboard | null>(null);
  const [operationsDashboardLoading, setOperationsDashboardLoading] = useState(true);
  const [operationsReportError, setOperationsReportError] = useState("");
  const [aiDashboard, setAiDashboard] = useState<AiTaskWorkOrderDashboard | null>(null);
  const [aiDashboardLoading, setAiDashboardLoading] = useState(true);
  const [expandedAiTasks, setExpandedAiTasks] = useState<Record<string, AiTaskWorkOrderAggregate>>({});
  const [selectedAiTask, setSelectedAiTask] = useState<AiTaskWorkOrderAggregate | null>(null);
  const selectedAiTaskIdRef = useRef<string | null>(null);
  selectedAiTaskIdRef.current = selectedAiTask?.task.task_id || null;
  const taskAccessCheckRef = useRef(false);
  const [actionBusy, setActionBusy] = useState("");
  const [query, setQuery] = useState(restoreSnapshot?.query || "");
  const [debouncedQuery, setDebouncedQuery] = useState(restoreSnapshot?.query || "");
  const [from, setFrom] = useState(restoreSnapshot?.from || "");
  const [to, setTo] = useState(restoreSnapshot?.to || "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(restoreSnapshot?.selectedIds || []));
  const [expandedSystemTasks, setExpandedSystemTasks] = useState<Set<string>>(new Set(restoreSnapshot?.expandedSystemTasks || []));
  const [operationsFilter, setOperationsFilter] = useState<TaskOperationsFilter>(["in_progress", "waiting", "completed", "overdue", "failed"].includes(restoreSnapshot?.operationsFilter || "") ? restoreSnapshot!.operationsFilter : null);
  const requestRef = useRef<Promise<void> | null>(null);
  const rowsRef = useRef<Task[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const dashboardRef = useRef<AiTaskWorkOrderDashboard | null>(null);
  const businessNextCursorRef = useRef<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [businessNextCursor, setBusinessNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingBusinessMore, setLoadingBusinessMore] = useState(false);
  const queryDebouncer = useMemo(() => createTaskSearchDebouncer(setDebouncedQuery), []);
  useEffect(() => {
    queryDebouncer.schedule(query);
    return () => queryDebouncer.cancel();
  }, [query, queryDebouncer]);

  const selectedRunId = useMemo(() => {
    const runs = selected?.runs || [];
    const latest = [...runs].reverse().find((run) => typeof run.id === "string" || typeof run.run_id === "string");
    return latest ? String(latest.id || latest.run_id || "") || null : null;
  }, [selected]);
  const liveRunEvents = useTaskRunEventStream(selectedRunId);

  const setParam = useCallback((key: string, value: string | null) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value == null || value === "") next.delete(key); else next.set(key, value);
      return next;
    });
  }, [setParams]);

  useEffect(() => {
    if (rawPeriod && !isPeriod(rawPeriod)) {
      setPeriodNotice("周期参数无效，已显示实时数据");
      setParam("period", "realtime");
    }
  }, [rawPeriod, setParam]);

  const load = useCallback((background = false, append = false) => {
    if (requestRef.current) return requestRef.current;
    if (append && !nextCursorRef.current) return Promise.resolve();
    const request = (async () => {
      if (!background && !append) setLoading(true);
      if (append) setLoadingMore(true);
      setSystemError("");
      try {
        let response = await api.taskPage({
          view: "history", q: debouncedQuery, from: period === "realtime" ? from : undefined, to: period === "realtime" ? to : undefined, period, limit: 100,
          cursor: append ? nextCursorRef.current || undefined : undefined,
        });
        let nextRows = response.items || [];
        if (!background && !append) {
          loadedAgentPages.current = 1;
          const targetPages = agentRestorePages.current; agentRestorePages.current = 1;
          let cursor = response.page?.next_cursor;
          while (cursor && loadedAgentPages.current < targetPages) {
            const previousCursor = cursor;
            response = await api.taskPage({ view: "history", q: debouncedQuery, from: period === "realtime" ? from : undefined, to: period === "realtime" ? to : undefined, period, limit: 100, cursor });
            nextRows = mergeTaskRows(nextRows, response.items || []);
            loadedAgentPages.current++;
            cursor = response.page?.next_cursor;
            if (cursor === previousCursor) break;
          }
        } else if (append) loadedAgentPages.current++;

        const merged = append ? mergeTaskRows(rowsRef.current, nextRows) : background ? mergeTaskRows(nextRows, rowsRef.current) : nextRows;
        if (!sameTaskRows(rowsRef.current, merged)) { rowsRef.current = merged; setRows(merged); }
        setTotal(Number(response.page?.total || 0));
        if (!background || append || rowsRef.current.length <= 100) {
          nextCursorRef.current = response.page?.next_cursor || null;
          setNextCursor(nextCursorRef.current);
        }
      } catch (cause) {
        setSystemError(cause instanceof Error ? cause.message : "任务列表加载失败");
      } finally {
        if (!background && !append) setLoading(false);
        if (append) setLoadingMore(false);
        requestRef.current = null;
      }
    })();
    requestRef.current = request;
    return request;
  }, [debouncedQuery, from, to, period]);

  useEffect(() => { void load(); }, [load]);

  const loadOperationsDashboard = useCallback(async (background = false) => {
    if (!background) setOperationsDashboardLoading(true);
    setOperationsReportError("");
    try {
      setOperationsDashboard(await api.taskOperationsDashboard({ period, q: debouncedQuery || undefined }));
    } catch (cause) {
      if (!background) setOperationsDashboard(null);
      setOperationsReportError(cause instanceof Error ? cause.message : "任务运营数据加载失败");
    } finally {
      if (!background) setOperationsDashboardLoading(false);
    }
  }, [period, debouncedQuery]);

  useEffect(() => { void loadOperationsDashboard(); }, [loadOperationsDashboard]);

  const loadAiDashboard = useCallback(async (background = false, append = false) => {
    if (append && !businessNextCursorRef.current) return;
    if (!background && !append) setAiDashboardLoading(true);
    if (append) setLoadingBusinessMore(true);
    setReportError("");
    try {
      let next = await api.aiTaskWorkOrderDashboard({
        limit: 100,
        cursor: append ? businessNextCursorRef.current || undefined : undefined,
        period,
        q: debouncedQuery || undefined,
      });
      if (!append) {
        const targetPages = background ? loadedBusinessPages.current : businessRestorePages.current;
        loadedBusinessPages.current = 1; businessRestorePages.current = 1;
        let items = next.tasks.items;
        let cursor = next.tasks.page.next_cursor;
        while (cursor && loadedBusinessPages.current < targetPages) {
          const previousCursor = cursor;
          next = await api.aiTaskWorkOrderDashboard({ limit: 100, cursor, period, q: debouncedQuery || undefined });
          const map = new Map(items.map(item => [item.task.task_id, item]));
          next.tasks.items.forEach(item => map.set(item.task.task_id, item));
          items = [...map.values()]; loadedBusinessPages.current++;
          cursor = next.tasks.page.next_cursor;
          if (cursor === previousCursor) break;
        }
        next = { ...next, tasks: { ...next.tasks, items } };
      } else if (append) loadedBusinessPages.current++;
      const previousItems = append ? dashboardRef.current?.tasks.items || [] : [];
      const itemsById = new Map(previousItems.map((item) => [item.task.task_id, item]));
      next.tasks.items.forEach((item) => itemsById.set(item.task.task_id, item));
      const dashboard = append ? { ...next, tasks: { ...next.tasks, items: [...itemsById.values()] } } : next;
      businessNextCursorRef.current = next.tasks.page.next_cursor;
      setBusinessNextCursor(businessNextCursorRef.current);
      dashboardRef.current = dashboard;
      setAiDashboard(dashboard);
    } catch (cause) {
      if (!append) setAiDashboard(null);
      setReportError(cause instanceof Error ? cause.message : "业务任务与标准工单数据加载失败");
    } finally {
      if (!background && !append) setAiDashboardLoading(false);
      if (append) setLoadingBusinessMore(false);
    }
  }, [period, debouncedQuery]);

  useEffect(() => { void loadAiDashboard(); }, [loadAiDashboard]);

  useEffect(() => {
    if (view !== "active" || period !== "realtime") return;
    const refresh = () => { if (document.visibilityState === "visible") { void load(true); void loadOperationsDashboard(true); void loadAiDashboard(true); } };
    const timer = window.setInterval(refresh, 4000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load, loadOperationsDashboard, loadAiDashboard, period, view]);

  const clearUnavailableAiTask = useCallback(() => {
    const taskId = selectedAiTaskIdRef.current;
    if (!taskId || taskAccessCheckRef.current) return;
    taskAccessCheckRef.current = true;
    // A restricted related module is not authority to revoke an independently authorized root.
    // The module has already cleared its private cache; re-read the root with the same identity.
    void api.aiTaskWorkOrder(taskId).then(detail => {
      if (selectedAiTaskIdRef.current === taskId) setSelectedAiTask(detail);
    }).catch(() => {
      if (selectedAiTaskIdRef.current !== taskId) return;
      setSelectedAiTask(null); setExpandedAiTasks({}); setAiDashboard(null); dashboardRef.current = null;
      businessNextCursorRef.current = null; setBusinessNextCursor(null);
      setError("该任务当前不可访问，已清除缓存内容。请核对归属或授权后重新读取。");
    }).finally(() => { taskAccessCheckRef.current = false; });
  }, []);

  const openDetail = async (task: Task) => {
    setActionBusy(`detail:${task.id}`); setSelectedAiTask(null);
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
    try { await api.cancelTask(task); await load(); if (selected?.id === task.id) setSelected(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "取消失败"); }
    finally { setActionBusy(""); }
  };

  const rememberList = () => captureTaskListSnapshot({
    originalUrl: `/tasks${location.search}`, query, from, to, operationsFilter,
    selectedIds, expandedSystemTasks, loadedAgentPages: loadedAgentPages.current,
    loadedBusinessPages: loadedBusinessPages.current, scrollY: listRef.current?.scrollTop || 0,
  });
  const openAgentDetail = (task: Task) => {
    const snapshot = rememberList();
    navigate(`/tasks/${encodeURIComponent(task.id)}`, { state: { taskListPath: snapshot?.originalUrl || "/tasks" } });
  };
  const openAiTask = (taskId: string) => {
    rememberList(); setError(""); setSelected(null);
    setParams(current => { const next = new URLSearchParams(current); next.set("businessTask", taskId); return next; }, { state: { taskDetailFromList: true } });
  };
  const closeTaskDetail = () => {
    setSelected(null); setSelectedAiTask(null); setDetailDirty(false);
    if (params.has("businessTask")) {
      if ((location.state as { taskDetailFromList?: boolean } | null)?.taskDetailFromList) navigate(-1);
      else setParams(current => { const next = new URLSearchParams(current); next.delete("businessTask"); return next; }, { replace: true });
    }
  };
  const businessTaskId = params.get("businessTask");
  useEffect(() => {
    if (!businessTaskId) { setSelectedAiTask(null); setDetailDirty(false); return; }
    let cancelled = false;
    setSelectedAiTask(null); setDetailDirty(false);
    setActionBusy(`ai-task:${businessTaskId}`);
    void api.aiTaskWorkOrder(businessTaskId).then(task => { if (!cancelled) { setSelected(null); setSelectedAiTask(task); } })
      .catch(() => { if (!cancelled) { setSelectedAiTask(null); setError("该业务任务当前不可访问，请核对归属或授权。"); } })
      .finally(() => { if (!cancelled) setActionBusy(""); });
    return () => { cancelled = true; };
  }, [businessTaskId]);
  useEffect(() => {
    if (loading || aiDashboardLoading || restoreScroll.current == null) return;
    const top = restoreScroll.current; restoreScroll.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = top; }));
  }, [loading, aiDashboardLoading]);

  const openTaskWorkspace = async (taskId: string) => {
    setActionBusy(`workspace:${taskId}`);
    try { const result = await api.openTaskCollaborationWorkspace(taskId); navigate(`/s/${encodeURIComponent(result.id)}`); }
    catch { setError("协作工作台暂时无法打开，请核对当前任务权限或会话归档状态。"); }
    finally { setActionBusy(""); }
  };

  const toggleAiTaskRow = async (taskId: string) => {
    if (expandedAiTasks[taskId]) {
      setExpandedAiTasks((current) => { const next = { ...current }; delete next[taskId]; return next; });
      return;
    }
    setActionBusy(`ai-task-expand:${taskId}`);
    try { const detail = await api.aiTaskWorkOrder(taskId); setExpandedAiTasks((current) => ({ ...current, [taskId]: detail })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "子工单明细加载失败"); }
    finally { setActionBusy(""); }
  };

  type UnifiedRow = { kind: "agent"; key: string; task: Task; title: string; status: string; summary: string; updatedAt?: string | null; dueAt?: string | null }
    | { kind: "business"; key: string; item: AiTaskWorkOrderDashboard["tasks"]["items"][number]; title: string; status: string; summary: string; updatedAt?: string | null; dueAt?: string | null };
  const unifiedRows = useMemo<UnifiedRow[]>(() => {
    const system = rows.map((task) => ({ kind: "agent" as const, key: `agent:${task.id}`, task, title: safeTaskText(task.title, "未命名任务"), status: normalizedStatus(task), summary: taskSummary(task), updatedAt: typeof task.updated_at === "string" ? task.updated_at : task.started_at || task.created_at, dueAt: task.due_at }));
    const business = (aiDashboard?.tasks.items || []).map((item) => {
      const blocking = item.current_blocking_work_order; const next = item.next_work_order;
      return { kind: "business" as const, key: `business:${item.task.task_id}`, item, title: item.task.title, status: businessTaskStatus({ status: item.task.status, counts: item.counts }),
        summary: blocking ? `阻塞：${blocking.title}` : next ? `下一单：${next.title}` : item.task.goal || "暂无开放工单", updatedAt: item.task.updated_at, dueAt: item.task.due_at };
    });
    return sortTaskRowsByUpdatedAt([...system, ...business]);
  }, [rows, aiDashboard]);
  const tabMatches = (row: UnifiedRow, tab: TaskStatusTab) => {
    if (row.kind === "agent") return belongsToTab(row.task, tab);
    if (tab === "all") return true;
    if (tab === "queued") return row.status === "queued";
    if (tab === "running") return row.status === "running";
    if (tab === "waiting_approval") return row.status === "waiting_approval";
    if (tab === "failed") return row.status === "failed";
    if (tab === "completed") return row.status === "completed";
    return row.status === "cancelled";
  };
  const operationsMatches = (row: UnifiedRow) => {
    if (!operationsFilter) return true;
    if (row.kind !== "agent") return false;
    const status = normalizedStatus(row.task);
    if (operationsFilter === "in_progress") return isAgentTaskInProgress(status);
    if (operationsFilter === "waiting") return ["waiting", "waiting_approval", "needs_clarification", "waiting_external", "needs_review"].includes(status);
    if (operationsFilter === "completed") return COMPLETED.has(status);
    if (operationsFilter === "overdue") return Boolean(row.dueAt && new Date(row.dueAt).getTime() < Date.now() && !CLOSED.has(status));
    return status === "failed";
  };
  const visible = useMemo(() => unifiedRows.filter((row) => tabMatches(row, selectedStatus) && operationsMatches(row)), [unifiedRows, selectedStatus, operationsFilter]);
  const counts = useMemo(() => {
    const next = new Map<TaskStatusTab, number>();
    STATUS_TABS.forEach((tab) => next.set(tab.value, unifiedRows.filter((row) => operationsMatches(row) && tabMatches(row, tab.value)).length));
    return next;
  }, [unifiedRows, operationsFilter]);
  const selectableRows = useMemo(() => visible.filter((row): row is Extract<UnifiedRow, { kind: "agent" }> => row.kind === "agent" && canSelect(row.task)), [visible]);
  useEffect(() => { if (loading) return; const visibleIds = new Set(selectableRows.map((row) => row.task.id)); setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id)))); }, [selectableRows, loading]);
  const cancelSelected = async () => {
    if (!selectedIds.size || !window.confirm(`确认取消 ${selectedIds.size} 个排队任务？`)) return;
    setActionBusy("bulk-cancel");
    try { await Promise.all(rows.filter((task) => selectedIds.has(task.id)).map((task) => api.cancelTask(task))); setSelectedIds(new Set()); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "批量取消失败"); }
    finally { setActionBusy(""); }
  };
  const applyOperationsFilter = (filter: Exclude<TaskOperationsFilter, null>) => {
    setParam("status", "all");
    setOperationsFilter((current) => current === filter ? null : filter);
  };
  const clearOperationsFilter = () => setOperationsFilter(null);

  return <main ref={listRef} className={`tasks-page${selected || selectedAiTask ? " has-task-detail" : ""}`} data-task-center>
    <TaskOperationsReport dashboard={operationsDashboard} workOrders={aiDashboard} period={period} loading={operationsDashboardLoading} workOrdersLoading={aiDashboardLoading} error={operationsReportError} workOrdersError={reportError} activeFilter={operationsFilter}
      onPeriod={(next) => {
        const clearsManualRange = Boolean(from || to);
        setOperationsFilter(null);
        if (clearsManualRange) {
          setFrom("");
          setTo("");
          setPeriodNotice("已按周期口径刷新，手动时间范围已清除");
        } else {
          setPeriodNotice("");
        }
        setParam("period", next);
      }} onFilter={applyOperationsFilter} onClearFilter={clearOperationsFilter} onRetry={() => void loadOperationsDashboard()} onRetryWorkOrders={() => void loadAiDashboard()} />
    {periodNotice ? <p className="task-period-notice muted" role="status">{periodNotice}</p> : null}

    <section className="panel task-center-unified-section" aria-label="任务明细">
    <header className="task-center-system-head"><div><h2>任务明细</h2><p className="muted">按状态、周期和关键指标筛选。</p></div><Link className="btn primary task-center-create-action" to="/">新建任务</Link></header>
      <div className="task-center-filters" role="search" aria-label="筛选任务">
        <label className="task-filter-search"><span className="sr-only">搜索任务</span><span className="task-filter-search-wrap"><svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg><input aria-label="搜索任务名称、内容、技能或模板" placeholder="搜索任务名称、内容、技能或模板" value={query} onChange={(event) => setQuery(event.target.value)} /></span></label>
        <fieldset className="task-filter-date-range"><legend className="sr-only">时间范围</legend><span className="task-filter-date-label">时间范围</span><input type="date" aria-label="开始日期" value={from} onChange={(event) => { setFrom(event.target.value); if (period !== "realtime") { setParam("period", "realtime"); setPeriodNotice("已切换为手动时间范围"); } }} /><span aria-hidden="true">至</span><input type="date" aria-label="结束日期" value={to} onChange={(event) => { setTo(event.target.value); if (period !== "realtime") { setParam("period", "realtime"); setPeriodNotice("已切换为手动时间范围"); } }} /></fieldset>
        <div className="task-filter-actions">{view === "active" && selectedIds.size ? <button type="button" onClick={() => void cancelSelected()} disabled={Boolean(actionBusy)}>取消选中 ({selectedIds.size})</button> : null}{operationsFilter ? <button type="button" onClick={() => setOperationsFilter(null)}>清除联动筛选</button> : null}</div>
      </div>
      <nav className="tasks-tabs" aria-label="任务状态">{STATUS_TABS.map((tab) => <button key={tab.value} type="button" className={selectedStatus === tab.value ? "is-active" : ""} aria-pressed={selectedStatus === tab.value} onClick={() => setParam("status", tab.value)}>{tab.label}<span className="tasks-tab-count" aria-label={`${counts.get(tab.value) || 0} 个任务`}>{counts.get(tab.value) || 0}</span></button>)}</nav>
      {loading ? <p className="muted">正在读取任务状态…</p> : systemError && rows.length === 0 && !operationsDashboard ? <p className="task-center-load-error" role="alert">任务明细暂时无法读取。<button className="task-center-text-action" type="button" onClick={() => void load()}>重试</button></p> : visible.length === 0 ? <section className="task-center-empty"><strong>当前没有符合条件的任务</strong><p>调整状态、筛选条件或等待任务状态变化后再试。</p></section> : <div className="task-center-table-wrap"><table className="task-center-table task-center-unified-table"><colgroup><col className="task-center-col-task" /><col className="task-center-col-status" /><col className="task-center-col-time" /><col className="task-center-col-actions" /></colgroup><thead><tr><th scope="col">任务名</th><th scope="col">状态</th><th scope="col">更新时间</th><th scope="col">操作</th></tr></thead><tbody>{visible.map((row) => {
        if (row.kind === "agent") {
          const task = row.task; const expanded = expandedSystemTasks.has(task.id);
          return <Fragment key={row.key}><tr><td data-label="任务名" className="task-center-task-cell"><div className="task-center-task-content">{view === "active" && canSelect(task) ? <input type="checkbox" aria-label={`选择 ${row.title}`} checked={selectedIds.has(task.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(task.id) : next.delete(task.id); return next; })} /> : null}<strong title={row.title}>{row.title}</strong></div></td><td data-label="状态"><span className={`task-center-status status-${normalizedStatus(task)}`}>{statusOf(task)}</span></td><td data-label="更新时间">{formatTime(row.updatedAt)}</td><td data-label="操作"><TaskRowActions detail={<button type="button" onClick={() => openAgentDetail(task)} disabled={actionBusy === `detail:${task.id}`}>详情</button>} secondary={task.session_id || (view === "active" && canCancel(task)) ? <>{task.session_id ? <Link to={`/s/${task.session_id}`}>{actionLabel(task, view)}</Link> : null}{view === "active" && canCancel(task) ? <button type="button" onClick={() => void cancel(task)} disabled={Boolean(actionBusy)}>取消</button> : null}</> : undefined} expanded={expanded} label={`${expanded ? "收起" : "展开"}${row.title}明细`} onToggle={() => setExpandedSystemTasks((current) => { const next = new Set(current); expanded ? next.delete(task.id) : next.add(task.id); return next; })} /></td></tr>{expanded ? <tr className="task-center-meta-row"><td colSpan={4}><AgentExpandedDetails task={task} title={row.title} summary={row.summary} /></td></tr> : null}</Fragment>;
        }
        const item = row.item; const detail = expandedAiTasks[item.task.task_id];
        return <Fragment key={row.key}><tr className={detail ? "is-expanded" : undefined}><td data-label="任务名" className="task-center-task-cell"><strong title={row.title}>{row.title}</strong></td><td data-label="状态"><span className={`task-center-status status-${row.status}`}>{row.status === "running" ? "进行中" : row.status === "waiting_approval" ? "待确认" : row.status === "completed" ? "已完成" : row.status === "cancelled" ? "已取消" : "排队中"}</span></td><td data-label="更新时间">{formatTime(row.updatedAt)}</td><td data-label="操作"><TaskRowActions detail={<button type="button" onClick={() => void openAiTask(item.task.task_id)}>详情</button>} expanded={Boolean(detail)} label={`${detail ? "收起" : "展开"}${row.title}工单明细`} busy={actionBusy === `ai-task-expand:${item.task.task_id}`} onToggle={() => void toggleAiTaskRow(item.task.task_id)} /></td></tr>{detail ? <tr className="task-center-meta-row"><td colSpan={4}><BusinessExpandedDetails detail={detail} statusLabel={workOrderStatusLabel} decisionSummary={workOrderDecisionSummary} /></td></tr> : null}</Fragment>;
      })}</tbody></table></div>}
      {systemError && rows.length > 0 ? <p className="task-center-load-error" role="alert">系统任务更新失败，当前显示上次载入的任务。<button className="task-center-text-action" type="button" onClick={() => void load()}>重试</button></p> : null}
      {!loading && (rows.length > 0 || aiDashboard?.tasks.items.length) ? <div className="row-actions task-center-pagination" aria-live="polite"><span className="muted">已载入 {rows.length} / {total || rows.length} 个 Agent 任务 · 已载入 {aiDashboard?.tasks.items.length || 0} / {aiDashboard?.tasks.page.total || 0} 个业务任务</span>{nextCursor ? <button type="button" className="btn ghost" onClick={() => void load(false, true)} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更多 Agent 任务"}</button> : null}{businessNextCursor ? <button type="button" className="btn ghost" onClick={() => void loadAiDashboard(false, true)} disabled={loadingBusinessMore}>{loadingBusinessMore ? "加载中…" : "加载更多业务任务"}</button> : null}</div> : null}
    </section>

    {error ? <p className="surface-error" role="alert">{hidesSignalTimeout(error) ? "任务暂时无法读取，请稍后查看。" : error}</p> : null}

    {selected || selectedAiTask ? <TaskDetailDrawer eyebrow={selected ? "任务详情" : "业务任务"} title={selected ? safeTaskText(selected.title, "未命名任务") : selectedAiTask!.task.title}
      status={selectedAiTask ? <span className="task-center-status">{workOrderStatusLabel(selectedAiTask.task.status)}</span> : null}
      dirty={detailDirty} closeDisabled={detailSubmitting} onClose={closeTaskDetail}
      footer={selectedAiTask && detailEntryOpen ? <Button type="primary" htmlType="submit" form="task-business-verified-event-form" disabled={detailSubmitting}>提交已核验事件</Button> : null}>
      {error ? <p role="alert">{error}</p> : null}
      {selected ? <><dl className="task-detail-meta"><div><dt>状态</dt><dd>{statusOf(selected)}</dd></div><div><dt>任务 ID</dt><dd>{selected.id}</dd></div><div><dt>创建时间</dt><dd>{formatTime(selected.created_at)}</dd></div><div><dt>说明</dt><dd>{taskSummary(selected)}</dd></div></dl><p className="muted">已尝试 {selected.runs?.length || 0} 次{selected.runs?.length ? `；最近一次：${String(selected.runs[selected.runs.length - 1]?.status || "未知")}` : ""}</p><section><h3>执行事件 {liveRunEvents.connected ? <small className="muted">实时更新中</small> : liveRunEvents.fallback ? <small className="muted">正在以安全补读更新</small> : null}</h3>{(liveRunEvents.events.length ? liveRunEvents.events : events).length ? <ol className="task-detail-events">{(liveRunEvents.events.length ? liveRunEvents.events : events).map((event, index) => <li key={event.id || `${event.created_at}-${index}`}><strong>{safeTaskText(event.title || event.type, "任务事件")}</strong><small>{formatTime(event.created_at)}</small><p>{safeTaskText(event.summary || event.message)}</p></li>)}</ol> : <p className="muted">暂无执行事件。</p>}</section><div className="task-detail-actions">{selected.session_id ? <Link className="button" to={`/s/${selected.session_id}`}>进入完整会话 →</Link> : null}</div></> : null}
      {selectedAiTask ? <BusinessTaskDetailContent key={selectedAiTask.task.task_id} detail={selectedAiTask} actionBusy={actionBusy}
        onWorkspace={() => { rememberList(); void openTaskWorkspace(selectedAiTask.task.task_id); }} onUnavailable={clearUnavailableAiTask}
        onChanged={() => { void loadAiDashboard(true); }} onTaskUpdated={setSelectedAiTask}
        onDirtyChange={setDetailDirty} onBusyChange={setDetailSubmitting} onEntryOpenChange={setDetailEntryOpen} /> : null}
    </TaskDetailDrawer> : null}
  </main>;
}
