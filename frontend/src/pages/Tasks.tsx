import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button, DatePicker, Pagination, Select, Table, Tag } from "antd";
import dayjs from "dayjs";
import { LifecycleNavigation } from "../components/LifecycleNavigation";
import { TaskTheme } from "../tasks/TaskTheme";
import { TaskTypeBreakdown } from "../tasks/TaskTypeBreakdown";
import { agentLifecycle, formatTaskTime, patchTaskQuery, readTaskQuery, TASK_LIFECYCLES, type TaskLifecycle, type TaskSource } from "../tasks/taskQuery";
import { api, type AiTaskWorkOrderAggregate, type AiTaskWorkOrderDashboard, type Task, type TaskDetail, type TaskEvent, type TaskOperationsDashboard, type TaskOperationsPeriod } from "../api";
import { useTaskRunEventStream } from "../hooks/useTaskRunEventStream";
import { TaskDetailDrawer } from "../tasks/TaskDetailDrawer";
import { TaskRowActions } from "../tasks/TaskRowActions";
import { AgentExpandedDetails, BusinessExpandedDetails } from "../tasks/TaskExpandedDetails";
import { TaskOperationsReport, type TaskOperationsFilter } from "../tasks/TaskOperationsReport";
import { BusinessTaskDetailContent } from "../tasks/BusinessTaskDetailContent";
import { captureTaskListSnapshot, readTaskListSnapshot } from "../tasks/taskDetailNavigation";
import { canCancelTask, businessTaskStatus, createTaskSearchDebouncer, sortTaskRowsByUpdatedAt } from "../tasks/taskCenterModel";
import { ActionGroup, PropertyList, RecordRow, TruncatableText } from "../components/InformationLayout";
import "./global-layout-tasks.css";

type View = "active" | "history";
type TaskStatusTab = TaskLifecycle;
const STATUS_TABS = TASK_LIFECYCLES;
const CLOSED = new Set(["completed", "done", "success", "succeeded", "failed", "cancelled", "canceled"]);
const QUEUED = new Set(["pending", "queued"]);
const RUNNING = new Set(["running", "starting", "in_progress"]);
const WAITING = new Set(["waiting", "waiting_approval", "needs_clarification", "waiting_external", "needs_review"]);
const COMPLETED = new Set(["completed", "done", "success", "succeeded"]);
const CANCELLED = new Set(["cancelled", "canceled"]);

function normalizedStatus(task: Task) {
  return String(task.status || task.display_status || "pending").toLowerCase();
}

function statusOf(task: Task) {
  const value = normalizedStatus(task);
  if (value === "waiting_approval") return "待确认";
  if (value === "queued" || value === "pending" || value === "open") return "待启动";
  if (WAITING.has(value)) return task.display_status_label || ({ waiting: "等待处理", needs_clarification: "待补充", waiting_external: "等待外部", needs_review: "待复核" } as Record<string, string>)[value] || "等待处理";
  if (value === "running" || value === "starting" || value === "in_progress") return "执行中";
  if (CLOSED.has(value)) return value === "failed" ? "失败" : value === "cancelled" || value === "canceled" ? "已取消" : "已完成";
  return task.display_status_label || value;
}

const formatTime = formatTaskTime;

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

const canSelect = canCancelTask;
const canCancel = canCancelTask;

function actionLabel(task: Task, view: View) {
  if (view === "history" || CLOSED.has(normalizedStatus(task))) return "查看结果";
  if (normalizedStatus(task) === "waiting_approval") return "继续处理";
  return "进度";
}

function belongsToTab(task: Task, tab: TaskStatusTab) {
  return tab === "all" || agentLifecycle(normalizedStatus(task)) === tab;
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
  const taskQuery = readTaskQuery(params);
  const selectedStatus = taskQuery.status;
  const source: TaskSource = taskQuery.from || taskQuery.to || taskQuery.taskType ? "agent" : taskQuery.source;
  const from = taskQuery.from;
  const to = taskQuery.to;
  const debouncedQuery = taskQuery.q;
  const view: View = ["all", "queued", "running", "waiting"].includes(selectedStatus) ? "active" : "history";
  const operationsFilter: TaskOperationsFilter = source !== "agent" ? null : taskQuery.overdue ? "overdue" : selectedStatus === "all" ? null : selectedStatus;
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
  const [query, setQuery] = useState(taskQuery.q);
  const requestedListPage = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const [pageSize] = useState(20);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(restoreSnapshot?.selectedIds || []));
  const [expandedSystemTasks, setExpandedSystemTasks] = useState<Set<string>>(new Set(restoreSnapshot?.expandedSystemTasks || []));
  const listRequestVersion = useRef(0);
  const reportRequestVersion = useRef(0);
  const businessRequestVersion = useRef(0);
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
  const queryDebouncer = useMemo(() => createTaskSearchDebouncer((value: string) => setParams(current => patchTaskQuery(current, { q: value, page: null }))), [setParams]);
  useEffect(() => { setQuery(taskQuery.q); }, [taskQuery.q]);
  useEffect(() => {
    if (query !== taskQuery.q) queryDebouncer.schedule(query);
    return () => queryDebouncer.cancel();
  }, [query, taskQuery.q, queryDebouncer]);

  const selectedRunId = useMemo(() => {
    const runs = selected?.runs || [];
    const latest = [...runs].reverse().find((run) => typeof run.id === "string" || typeof run.run_id === "string");
    return latest ? String(latest.id || latest.run_id || "") || null : null;
  }, [selected]);
  const liveRunEvents = useTaskRunEventStream(selectedRunId);

  const patchParams = useCallback((values: Record<string, string | null>) => {
    setParams(current => patchTaskQuery(current, Object.keys(values).every(key => key === "page") ? values : { ...values, page: null }));
  }, [setParams]);
  const setParam = useCallback((key: string, value: string | null) => patchParams({ [key]: value }), [patchParams]);

  useEffect(() => {
    if (rawPeriod && !isPeriod(rawPeriod)) {
      setPeriodNotice("周期参数无效，已显示实时数据");
      setParam("period", "realtime");
    }
  }, [rawPeriod, setParam]);

  const load = useCallback((background = false, append = false) => {
    if (background && requestRef.current) return requestRef.current;
    if (append && !nextCursorRef.current) return Promise.resolve();
    const version = ++listRequestVersion.current;
    const request = (async () => {
      if (!background && !append) setLoading(true);
      if (append) setLoadingMore(true);
      setSystemError("");
      try {
        let response = await api.taskPage({
          view: "history", q: debouncedQuery, from: from || undefined, to: to || undefined, period, limit: 100,
          status: selectedStatus !== "all" ? selectedStatus : undefined,
          overdue: taskQuery.overdue ? true : undefined, task_type: taskQuery.taskType || undefined,
          cursor: append ? nextCursorRef.current || undefined : undefined,
        });
        if (version !== listRequestVersion.current) return;
        let nextRows = response.items || [];
        if (!background && !append) {
          loadedAgentPages.current = 1;
          const targetPages = agentRestorePages.current; agentRestorePages.current = 1;
          let cursor = response.page?.next_cursor;
          while (cursor && loadedAgentPages.current < targetPages) {
            const previousCursor = cursor;
            response = await api.taskPage({ view: "history", q: debouncedQuery, from: from || undefined, to: to || undefined, period, limit: 100, cursor,
              status: selectedStatus !== "all" ? selectedStatus : undefined,
              overdue: taskQuery.overdue ? true : undefined, task_type: taskQuery.taskType || undefined });
            if (version !== listRequestVersion.current) return;
            nextRows = mergeTaskRows(nextRows, response.items || []);
            loadedAgentPages.current++; cursor = response.page?.next_cursor;
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
        if (version !== listRequestVersion.current) return;
        setSystemError(cause instanceof Error ? cause.message : "任务列表加载失败");
      } finally {
        if (version !== listRequestVersion.current) return;
        if (!background && !append) setLoading(false);
        if (append) setLoadingMore(false);
        requestRef.current = null;
      }
    })();
    requestRef.current = request;
    return request;
  }, [debouncedQuery, from, to, period, source, selectedStatus, taskQuery.overdue, taskQuery.taskType]);

  useEffect(() => { void load(); }, [load]);

  const loadOperationsDashboard = useCallback(async (background = false) => {
    const version = ++reportRequestVersion.current;
    if (!background) setOperationsDashboardLoading(true);
    setOperationsReportError("");
    try {
      const dashboard = await api.taskOperationsDashboard({ period, q: debouncedQuery || undefined, from: from || undefined, to: to || undefined, task_type: taskQuery.taskType || undefined });
      if (version === reportRequestVersion.current) setOperationsDashboard(dashboard);
    } catch (cause) {
      if (version !== reportRequestVersion.current) return;
      setOperationsReportError(cause instanceof Error ? cause.message : "任务运营数据加载失败");
    } finally {
      if (version === reportRequestVersion.current) setOperationsDashboardLoading(false);
    }
  }, [period, debouncedQuery, from, to, taskQuery.taskType]);

  useEffect(() => { void loadOperationsDashboard(); }, [loadOperationsDashboard]);

  const loadAiDashboard = useCallback(async (background = false, append = false) => {
    const version = ++businessRequestVersion.current;
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
      if (version !== businessRequestVersion.current) return;
      if (!append) {
        const targetPages = background ? loadedBusinessPages.current : businessRestorePages.current;
        loadedBusinessPages.current = 1; businessRestorePages.current = 1;
        let items = next.tasks.items;
        let cursor = next.tasks.page.next_cursor;
        while (cursor && loadedBusinessPages.current < targetPages) {
          const previousCursor = cursor;
          next = await api.aiTaskWorkOrderDashboard({ limit: 100, cursor, period, q: debouncedQuery || undefined });
          if (version !== businessRequestVersion.current) return;
          const map = new Map(items.map(item => [item.task.task_id, item]));
          next.tasks.items.forEach(item => map.set(item.task.task_id, item));
          items = [...map.values()]; loadedBusinessPages.current++;
          cursor = next.tasks.page.next_cursor;
          if (cursor === previousCursor) break;
        }
        next = { ...next, tasks: { ...next.tasks, items } };
      } else if (append) loadedBusinessPages.current++;
      if (version !== businessRequestVersion.current) return;
      const previousItems = append ? dashboardRef.current?.tasks.items || [] : [];
      const itemsById = new Map(previousItems.map((item) => [item.task.task_id, item]));
      next.tasks.items.forEach((item) => itemsById.set(item.task.task_id, item));
      const dashboard = append ? { ...next, tasks: { ...next.tasks, items: [...itemsById.values()] } } : next;
      businessNextCursorRef.current = next.tasks.page.next_cursor;
      setBusinessNextCursor(businessNextCursorRef.current);
      dashboardRef.current = dashboard;
      setAiDashboard(dashboard);
    } catch (cause) {
      if (version !== businessRequestVersion.current) return;
      setReportError(cause instanceof Error ? cause.message : "业务任务与标准工单数据加载失败");
    } finally {
      if (version === businessRequestVersion.current) setAiDashboardLoading(false);
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
    if (!canCancel(task) || !window.confirm("确认取消这个任务？")) return;
    setActionBusy(`cancel:${task.id}`);
    try { await api.cancelTask(task); await load(); await loadOperationsDashboard(); if (selected?.id === task.id) setSelected(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "取消失败"); }
    finally { setActionBusy(""); }
  };

  const rememberList = () => {
    queryDebouncer.cancel();
    const canonical = patchTaskQuery(new URLSearchParams(location.search), { q: query, page: listPage > 1 ? String(listPage) : null });
    canonical.delete("businessTask");
    const originalUrl = `/tasks${canonical.size ? `?${canonical}` : ""}`;
    if (originalUrl !== `/tasks${location.search}`) navigate(originalUrl, { replace: true });
    return captureTaskListSnapshot({
      originalUrl, query, from, to, operationsFilter, selectedIds, expandedSystemTasks,
      loadedAgentPages: loadedAgentPages.current, loadedBusinessPages: loadedBusinessPages.current,
      scrollY: listRef.current?.querySelector(".task-center-table-wrap")?.scrollTop || listRef.current?.scrollTop || 0,
    });
  };
  const openAgentDetail = (task: Task) => {
    const snapshot = rememberList();
    navigate(`/tasks/${encodeURIComponent(task.id)}`, { state: { taskListPath: snapshot?.originalUrl || "/tasks" } });
  };
  const openAiTask = (taskId: string) => {
    const snapshot = rememberList(); setError(""); setSelected(null);
    const next = new URLSearchParams(snapshot?.originalUrl.split("?")[1] || location.search);
    next.set("businessTask", taskId);
    navigate(`/tasks?${next}`, { state: { taskDetailFromList: true } });
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
    requestAnimationFrame(() => requestAnimationFrame(() => { if (listRef.current) { const table = listRef.current.querySelector(".task-center-table-wrap"); if (table) table.scrollTop = top; else listRef.current.scrollTop = top; } }));
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
    return tab === "waiting" ? row.status === "waiting_approval" : row.status === tab;
  };
  const sourceMatches = (row: UnifiedRow) => source === "all" || row.kind === source;
  const attentionMatches = (row: UnifiedRow) => !taskQuery.overdue || Boolean(row.dueAt && new Date(row.dueAt).getTime() < Date.now() && !CLOSED.has(row.status));
  const visible = useMemo(() => unifiedRows.filter(row => sourceMatches(row) && tabMatches(row, selectedStatus) && attentionMatches(row)), [unifiedRows, source, selectedStatus, taskQuery.overdue]);
  const counts = useMemo(() => {
    const next = new Map<TaskStatusTab, number>();
    STATUS_TABS.forEach(tab => next.set(tab.value, unifiedRows.filter(row => sourceMatches(row) && attentionMatches(row) && tabMatches(row, tab.value)).length));
    return next;
  }, [unifiedRows, source, taskQuery.overdue]);
  const listPage = Math.min(requestedListPage, Math.max(1, Math.ceil(visible.length / pageSize)));
  const pageRows = visible.slice((listPage - 1) * pageSize, listPage * pageSize);
  const selectableRows = useMemo(() => visible.filter((row): row is Extract<UnifiedRow, { kind: "agent" }> => row.kind === "agent" && canSelect(row.task)), [visible]);
  useEffect(() => { if (loading) return; const visibleIds = new Set(selectableRows.map((row) => row.task.id)); setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id)))); }, [selectableRows, loading]);
  const cancelSelected = async () => {
    const targets = rows.filter(task => selectedIds.has(task.id) && canCancel(task));
    if (!targets.length || !window.confirm(`确认取消 ${targets.length} 个选中任务？`)) return;
    setActionBusy("bulk-cancel");
    try {
      const receipts = await Promise.allSettled(targets.map(task => api.cancelTask(task)));
      const failures = receipts.filter(receipt => receipt.status === "rejected").length;
      setSelectedIds(new Set());
      await load();
      await loadOperationsDashboard();
      if (failures) setError(`已取消 ${targets.length - failures} 个任务；${failures} 个未确认成功，请刷新核对权限和状态后再操作。`);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "批量取消失败"); }
    finally { setActionBusy(""); }
  };
  const applyOperationsFilter = (filter: Exclude<TaskOperationsFilter, null>) => {
    if (filter === "overdue") patchParams({ source: "agent", attention: "overdue" });
    else {
      const status = filter === "in_progress" ? "running" : filter;
      patchParams({ source: "agent", status });
    }
  };
  const clearOperationsFilter = () => patchParams({ source: "agent", status: "all", attention: null });
  const changeRange = (dates: [string, string]) => {
    patchParams({ from: dates[0], to: dates[1], source: dates[0] || dates[1] ? "agent" : source, period: "realtime" });
    setPeriodNotice(dates[0] || dates[1] ? "手动日期用于 Agent 汇总与明细；子工单仍按报表周期统计。" : "");
  };
  const clearConditions = () => {
    queryDebouncer.cancel(); setQuery("");
    patchParams({ q: null, status: "all", attention: null, source: "all", task_type: null, from: null, to: null });
    setPeriodNotice("");
  };
  const filteredRangeLabel = from || to ? `${from || "不限"} 至 ${to || "不限"}` : undefined;
  const displayedScope = source === "agent" ? "Agent／系统任务" : source === "business" ? "业务任务" : "全部来源";
  const conditions = [
    ...(source !== "all" ? [{ key: "source", text: `来源：${displayedScope}`, clear: () => patchParams({ source: "all", from: null, to: null, task_type: null }) }] : []),
    ...(selectedStatus !== "all" ? [{ key: "status", text: `状态：${STATUS_TABS.find(item => item.value === selectedStatus)?.label}`, clear: () => setParam("status", "all") }] : []),
    ...(taskQuery.overdue ? [{ key: "attention", text: "异常：逾期", clear: () => setParam("attention", null) }] : []),
    ...(taskQuery.taskType ? [{ key: "task_type", text: `类型：${operationsDashboard?.task_types.find(item => item.task_type === taskQuery.taskType)?.title || taskQuery.taskType}`, clear: () => setParam("task_type", null) }] : []),
    ...(from || to ? [{ key: "range", text: `日期：${filteredRangeLabel}`, clear: () => { patchParams({ from: null, to: null }); setPeriodNotice(""); } }] : []),
    ...(debouncedQuery ? [{ key: "q", text: `搜索：${debouncedQuery}`, clear: () => { queryDebouncer.cancel(); setQuery(""); setParam("q", null); } }] : []),
  ];

  return <TaskTheme><main ref={listRef} className={`tasks-page${selected || selectedAiTask ? " has-task-detail" : ""}`} data-task-center data-density="data-grid" data-source={source}>
    <TaskOperationsReport dashboard={operationsDashboard} workOrders={aiDashboard} period={period} loading={operationsDashboardLoading} workOrdersLoading={aiDashboardLoading} error={operationsReportError} workOrdersError={reportError} activeFilter={operationsFilter}
      activeStatus={source === "agent" && selectedStatus !== "all" ? selectedStatus : null} filteredRangeLabel={filteredRangeLabel}
      headerAction={<Link className={`btn ${detailEntryOpen ? "ghost" : "primary"} task-center-create-action`} to="/">新建任务</Link>}
      onPeriod={(next) => {
        patchParams({ period: next, from: null, to: null });
        setPeriodNotice(from || to ? "已按周期口径刷新，手动时间范围已清除" : "");
      }} onFilter={applyOperationsFilter} onClearFilter={clearOperationsFilter} onRetry={() => void loadOperationsDashboard()} onRetryWorkOrders={() => void loadAiDashboard()} />
    {periodNotice ? <p className="task-period-notice muted" role="status">{periodNotice}</p> : null}

    <section className="panel task-center-unified-section" aria-label="任务明细">
      <header className="task-center-system-head"><h2>任务明细</h2><span className="task-result-scope">{displayedScope} · {visible.length} 条已载入结果{nextCursor || businessNextCursor ? "（非全量）" : ""}</span></header>
      <div className="task-center-filters" role="search" aria-label="筛选任务">
        <WorkspaceSearchInput className="task-filter-search" aria-label="搜索任务名称、内容、技能或模板" placeholder="搜索名称、内容、技能或模板" value={query} onChange={event => setQuery(event.target.value)} />
        <Select className="task-filter-source" aria-label="任务来源" value={source} onChange={(value: TaskSource) => patchParams({ source: value, ...(value !== "agent" ? { from: null, to: null, task_type: null } : {}) })} options={[{ value: "all", label: "全部来源" }, { value: "agent", label: "Agent／系统任务" }, { value: "business", label: "业务任务" }]} />
        <DatePicker.RangePicker className="task-filter-date-range" aria-label="Agent任务时间范围" placeholder={["开始日期", "结束日期"]} format="YYYY-MM-DD" value={[from ? dayjs(from) : null, to ? dayjs(to) : null]} onChange={(_dates, values) => changeRange(values)} allowEmpty={[true, true]} />
        <Button type="text" className={`task-attention-filter${taskQuery.overdue ? " is-active" : ""}`} aria-pressed={taskQuery.overdue} onClick={() => setParam("attention", taskQuery.overdue ? null : "overdue")}>逾期任务</Button>
        {conditions.length ? <Button type="text" onClick={clearConditions}>清空筛选</Button> : null}
        {view === "active" && selectedIds.size ? <Button type="text" danger onClick={() => void cancelSelected()} disabled={Boolean(actionBusy)}>取消选中 ({selectedIds.size})</Button> : null}
      </div>
      <div className="task-status-filter-row">
        <LifecycleNavigation label="任务状态" idPrefix="task-status" mode="filter" value={selectedStatus} options={STATUS_TABS.filter(tab => tab.value === "all" || tab.value === selectedStatus || (counts.get(tab.value) || 0) > 0).map(tab => ({ id: tab.value, label: tab.label, count: counts.get(tab.value) || 0 }))} onChange={value => setParam("status", value)} />
        <span className="task-count-note">状态数量：当前条件已载入集合；运营为周期全量</span>
      </div>
      {conditions.length ? <div className="task-active-conditions" aria-label="当前筛选条件">{conditions.map(condition => <Tag key={condition.key} closable onClose={event => { event.preventDefault(); condition.clear(); }}>{condition.text}</Tag>)}</div> : null}
      {loading || (source !== "agent" && aiDashboardLoading) ? <p className="muted">正在读取任务状态…</p> : visible.length === 0 && ((source !== "business" && systemError) || (source !== "agent" && reportError)) ? <p className="task-center-load-error" role="alert">任务明细暂时无法读取。<button className="task-center-text-action" type="button" onClick={() => { if (source !== "business") void load(); if (source !== "agent") void loadAiDashboard(); }}>重试</button></p> : visible.length === 0 ? <section className="task-center-empty"><strong>{(source !== "business" && nextCursor) || (source !== "agent" && businessNextCursor) ? "已载入集合暂无匹配结果，仍有更多任务可读取" : "当前没有符合条件的任务"}</strong><p>调整状态、筛选条件或等待任务状态变化后再试。</p></section> : <div className="task-center-table-wrap"><Table<UnifiedRow>
        className="task-center-unified-table" size="small" rowKey="key" dataSource={pageRows} pagination={false} tableLayout="fixed"
        rowSelection={selectableRows.length ? {
          selectedRowKeys: [...selectedIds].map(id => `agent:${id}`), preserveSelectedRowKeys: true,
          onChange: keys => setSelectedIds(new Set(keys.map(String).filter(key => key.startsWith("agent:")).map(key => key.slice(6)))),
          getCheckboxProps: row => ({ disabled: row.kind !== "agent" || !canCancel(row.task) || Boolean(actionBusy), "aria-label": `选择 ${row.title}` }),
          columnWidth: 40,
        } : undefined}
        expandable={{
          expandedRowKeys: pageRows.filter(row => row.kind === "agent" ? expandedSystemTasks.has(row.task.id) : Boolean(expandedAiTasks[row.item.task.task_id])).map(row => row.key),
          showExpandColumn: false,
          expandedRowRender: row => row.kind === "agent" ? <AgentExpandedDetails task={row.task} title={row.title} summary={row.summary} /> : <BusinessExpandedDetails detail={expandedAiTasks[row.item.task.task_id]} statusLabel={workOrderStatusLabel} decisionSummary={workOrderDecisionSummary} />,
        }}
        columns={[
          { title: "任务名", key: "title", render: (_, row) => <div className="task-center-task-content"><span className="task-source-label">{row.kind === "agent" ? "Agent" : "业务"}</span><TruncatableText className="task-center-task-title" text={row.title} /></div> },
          { title: "状态", key: "status", width: 88, render: (_, row) => <span className={`task-center-status status-${row.status}`}>{row.kind === "agent" ? statusOf(row.task) : row.status === "running" ? "进行中" : row.status === "waiting_approval" ? "待确认" : row.status === "completed" ? "已完成" : row.status === "cancelled" ? "已取消" : "排队中"}</span> },
          { title: "更新时间", key: "time", width: 112, render: (_, row) => formatTaskTime(row.updatedAt, row.kind === "agent" ? operationsDashboard?.timezone : aiDashboard?.timezone) },
          { title: "操作", key: "actions", width: 180, render: (_, row) => {
            if (row.kind === "agent") {
              const task = row.task, expanded = expandedSystemTasks.has(task.id);
              return <TaskRowActions detail={<button type="button" onClick={() => openAgentDetail(task)} disabled={actionBusy === `detail:${task.id}`}>详情</button>}
                secondary={task.session_id || canCancel(task) ? <>{task.session_id ? <Link to={`/s/${task.session_id}`}>{actionLabel(task, view)}</Link> : null}{canCancel(task) ? <button type="button" onClick={() => void cancel(task)} disabled={Boolean(actionBusy)}>取消</button> : null}</> : undefined}
                expanded={expanded} label={`${expanded ? "收起" : "展开"}${row.title}明细`} onToggle={() => setExpandedSystemTasks(current => { const next = new Set(current); expanded ? next.delete(task.id) : next.add(task.id); return next; })} />;
            }
            const id = row.item.task.task_id, expanded = Boolean(expandedAiTasks[id]);
            return <TaskRowActions detail={<button type="button" onClick={() => void openAiTask(id)}>详情</button>} expanded={expanded} label={`${expanded ? "收起" : "展开"}${row.title}工单明细`} busy={actionBusy === `ai-task-expand:${id}`} onToggle={() => void toggleAiTaskRow(id)} />;
          } },
        ]}
      /></div>}
      {systemError && rows.length > 0 ? <p className="task-center-load-error" role="alert">系统任务更新失败，当前显示上次载入的任务。<button className="task-center-text-action" type="button" onClick={() => void load()}>重试</button></p> : null}
      {!loading && (visible.length > 0 || (source !== "business" && nextCursor) || (source !== "agent" && businessNextCursor)) ? <div className="task-center-pagination" aria-label="已载入任务分页">
        <span className="muted">已载入 Agent {rows.length} / {total} · 业务 {aiDashboard?.tasks.items.length || 0} / {aiDashboard?.tasks.page.total || 0}</span>
        <Pagination size="small" current={listPage} pageSize={pageSize} total={visible.length} showSizeChanger={false} onChange={page => setParam("page", String(page))} />
        {(source !== "business" && nextCursor) || (source !== "agent" && businessNextCursor) ? <Button type="text" onClick={() => { if (source !== "business" && nextCursor) void load(false, true); if (source !== "agent" && businessNextCursor) void loadAiDashboard(false, true); }} disabled={loadingMore || loadingBusinessMore}>{loadingMore || loadingBusinessMore ? "加载中…" : "加载更多结果"}</Button> : null}
      </div> : null}

    </section>

    <TaskTypeBreakdown dashboard={operationsDashboard} period={period} loading={operationsDashboardLoading} error={operationsReportError} activeType={taskQuery.taskType} onTypeFilter={type => patchParams({ source: "agent", task_type: taskQuery.taskType === type ? null : type })} />

    {error ? <p className="surface-error" role="alert">{hidesSignalTimeout(error) ? "任务暂时无法读取，请稍后查看。" : error}</p> : null}

    {selected || selectedAiTask ? <TaskDetailDrawer eyebrow={selected ? "任务详情" : "业务任务"} title={selected ? safeTaskText(selected.title, "未命名任务") : selectedAiTask!.task.title}
      status={selectedAiTask ? <span className="task-center-status">{workOrderStatusLabel(selectedAiTask.task.status)}</span> : null}
      dirty={detailDirty} closeDisabled={detailSubmitting} onClose={closeTaskDetail}
      footer={selectedAiTask && detailEntryOpen ? <Button type="primary" htmlType="submit" form="task-business-verified-event-form" disabled={detailSubmitting}>提交已核验事件</Button> : null}>
      {error ? <p role="alert">{error}</p> : null}
      {selected ? <><PropertyList aria-label="任务属性" items={[{ key: "status", label: "状态", value: statusOf(selected) }, { key: "id", label: "任务 ID", value: selected.id }, { key: "created_at", label: "创建时间", value: formatTime(selected.created_at) }]} /><section><h3>说明</h3><p>{taskSummary(selected)}</p></section><p className="muted">已尝试 {selected.runs?.length || 0} 次{selected.runs?.length ? `；最近一次：${String(selected.runs[selected.runs.length - 1]?.status || "未知")}` : ""}</p><section><h3>执行事件 {liveRunEvents.connected ? <small className="muted">实时更新中</small> : liveRunEvents.fallback ? <small className="muted">正在以安全补读更新</small> : null}</h3>{(liveRunEvents.events.length ? liveRunEvents.events : events).length ? <ol className="task-detail-events">{(liveRunEvents.events.length ? liveRunEvents.events : events).map((event, index) => <li key={event.id || `${event.created_at}-${index}`}><RecordRow title={<strong>{safeTaskText(event.title || event.type, "任务事件")}</strong>} meta={formatTime(event.created_at)} detail={<p>{safeTaskText(event.summary || event.message)}</p>} /></li>)}</ol> : <p className="muted">暂无执行事件。</p>}</section><ActionGroup className="task-detail-actions">{selected.session_id ? <Link className="button" to={`/s/${selected.session_id}`}>进入完整会话 →</Link> : null}</ActionGroup></> : null}
      {selectedAiTask ? <BusinessTaskDetailContent key={selectedAiTask.task.task_id} detail={selectedAiTask} actionBusy={actionBusy}
        onWorkspace={() => { rememberList(); void openTaskWorkspace(selectedAiTask.task.task_id); }} onUnavailable={clearUnavailableAiTask}
        onChanged={() => { void loadAiDashboard(true); }} onTaskUpdated={setSelectedAiTask}
        onDirtyChange={setDetailDirty} onBusyChange={setDetailSubmitting} onEntryOpenChange={setDetailEntryOpen} /> : null}
    </TaskDetailDrawer> : null}
  </main></TaskTheme>;
}
