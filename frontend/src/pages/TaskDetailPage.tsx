import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Collapse } from "antd";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, type AiTaskWorkOrderAggregate, type TaskDetail, type TaskEvent } from "../api";
import { useAccount } from "../components/AuthGate";
import { useTaskDetailLeaveGuard } from "../hooks/useTaskDetailLeaveGuard";
import { useTaskRunEventStream } from "../hooks/useTaskRunEventStream";
import { TaskDetailLeaveBlocker } from "../tasks/TaskDetailLeaveBlocker";
import { BusinessTaskDetailContent } from "../tasks/BusinessTaskDetailContent";
import { TaskDetailThemeProvider } from "../tasks/TaskDetailTheme";
import {
  taskListReturnState,
  taskListReturnUrl,
  taskListScopeKey,
} from "../tasks/taskDetailNavigation";
import { businessTaskStatusLabel, formatDetailTime } from "../tasks/taskDetailPresentation";
import "../tasks/independent-task-detail.css";

type Scoped<T> = { taskId: string; value: T };
type ScopedError = { taskId: string; message: string };
type DetailKind = "business" | "agent" | "unknown";

const CLOSED = new Set(["completed", "done", "success", "succeeded", "failed", "cancelled", "canceled"]);

function cleanedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.replace(/signal\s+timed\s+out/gi, "").replace(/\s{2,}/g, " ").trim();
  return next || null;
}

function taskKind(task: TaskDetail): DetailKind {
  const taskType = cleanedText(task.task_type);
  if (taskType === "business_task") return "business";
  // A published template is explicit metadata. An arbitrary future type string
  // is not evidence that the object is an Agent task.
  return taskType && task.skill_template && typeof task.skill_template === "object" ? "agent" : "unknown";
}

function normalizedStatus(task: Pick<TaskDetail, "status" | "display_status">): string {
  return String(task.status || task.display_status || "pending").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "pending";
}

function agentStatusLabel(task: TaskDetail): string {
  const value = normalizedStatus(task);
  if (value === "waiting_approval") return "待确认";
  if (["queued", "pending", "open"].includes(value)) return "待启动";
  if (["running", "starting", "in_progress"].includes(value)) return "进行中";
  if (["waiting", "waiting_external", "needs_review", "needs_clarification"].includes(value)) return task.display_status_label || "等待处理";
  if (value === "failed") return "失败";
  if (["cancelled", "canceled"].includes(value)) return "已取消";
  if (CLOSED.has(value)) return "已完成";
  return cleanedText(task.display_status_label) || cleanedText(task.status) || "状态未知";
}

function rootErrorMessage(cause: unknown): string {
  const status = Number((cause as { status?: unknown })?.status);
  if ([401, 403].includes(status)) return "当前账号没有访问此任务的权限。";
  if (status === 404) return "该任务不存在，或已不再可访问。";
  if (status === 0) return "读取任务时网络中断或超时，请检查连接后重试。";
  const message = cause instanceof Error ? cleanedText(cause.message) : null;
  return message ? `读取任务失败：${message}` : "读取任务失败，请稍后重试。";
}

function relatedErrorMessage(cause: unknown, label: string): string {
  const status = Number((cause as { status?: unknown })?.status);
  if ([401, 403, 404].includes(status)) return `${label}当前不可访问；不展示该模块的旧缓存。`;
  if (status === 0) return `${label}读取时网络中断或超时，请重试。`;
  const message = cause instanceof Error ? cleanedText(cause.message) : null;
  return message ? `${label}读取失败：${message}` : `${label}读取失败，请重试。`;
}

function eventTitle(event: TaskEvent): string {
  return cleanedText(event.title) || cleanedText(event.label) || cleanedText(event.type) || "事件记录";
}

function eventSummary(event: TaskEvent): string | null {
  return cleanedText(event.summary) || cleanedText(event.message);
}

function eventTime(event: TaskEvent): string | null {
  return cleanedText(event.created_at) || cleanedText(event.occurred_at);
}

function runIdOf(task: TaskDetail | null): string | null {
  const run = [...(task?.runs || [])].reverse().find((item) => item.id || item.run_id);
  return run ? String(run.id || run.run_id || "") || null : null;
}

function recordField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanedText(record[key]);
    if (value) return value;
  }
  return null;
}

function artifactTitle(artifact: Record<string, unknown>): string | null {
  return recordField(artifact, ["title", "name", "label", "type", "kind"]);
}

function artifactSummary(artifact: Record<string, unknown>): string | null {
  return recordField(artifact, ["summary", "description", "message"]);
}

function artifactTime(artifact: Record<string, unknown>): string | null {
  return recordField(artifact, ["updated_at", "created_at", "completed_at", "occurred_at"]);
}

function traceEntries(task: TaskDetail): Array<{ key: string; label: string; value: string }> {
  const entries: Array<{ key: string; label: string; value: string | null | undefined }> = [
    { key: "id", label: "任务标识", value: task.id },
    { key: "type", label: "原始类型", value: cleanedText(task.task_type) },
    { key: "source", label: "来源", value: cleanedText(task.source) },
    { key: "skill", label: "技能键", value: cleanedText(task.skill) || cleanedText(task.skill_id) },
    { key: "created", label: task.created_at === task.updated_at ? "创建 / 更新时间" : "创建时间", value: task.created_at ? `${formatDetailTime(task.created_at)}（原始：${task.created_at}）` : null },
    { key: "updated", label: "更新时间", value: task.updated_at && task.updated_at !== task.created_at ? `${formatDetailTime(task.updated_at)}（原始：${task.updated_at}）` : null },
    { key: "started", label: "开始时间", value: task.started_at ? `${formatDetailTime(task.started_at)}（原始：${task.started_at}）` : null },
    { key: "completed", label: "完成时间", value: task.completed_at ? `${formatDetailTime(task.completed_at)}（原始：${task.completed_at}）` : null },
    { key: "due", label: "截止时间", value: task.due_at ? `${formatDetailTime(task.due_at)}（原始：${task.due_at}）` : null },
    { key: "description", label: "原始说明", value: cleanedText(task.description) || cleanedText(task.content) || cleanedText(task.context) },
  ];
  return entries.filter((entry): entry is { key: string; label: string; value: string } => Boolean(entry.value));
}

function DetailBody() {
  const { taskId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { account } = useAccount();
  const scopeKey = taskListScopeKey(account);
  const returnUrl = taskListReturnUrl(location.state, taskId, scopeKey);
  const returnState = taskListReturnState(taskId, scopeKey);
  const [root, setRoot] = useState<Scoped<TaskDetail> | null>(null);
  const [business, setBusiness] = useState<Scoped<AiTaskWorkOrderAggregate> | null>(null);
  const [storedEvents, setStoredEvents] = useState<Scoped<TaskEvent[]> | null>(null);
  const [rootLoadingTaskId, setRootLoadingTaskId] = useState<string | null>(taskId);
  const [relatedLoadingTaskId, setRelatedLoadingTaskId] = useState<string | null>(null);
  const [rootError, setRootError] = useState<ScopedError | null>(null);
  const [relatedError, setRelatedError] = useState<ScopedError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const requestVersion = useRef(0);
  const accessCheck = useRef(false);
  const currentTask = root?.taskId === taskId ? root.value : null;
  const currentBusiness = business?.taskId === taskId ? business.value : null;
  const currentStoredEvents = storedEvents?.taskId === taskId ? storedEvents.value : null;
  const currentRootError = rootError?.taskId === taskId ? rootError.message : "";
  const currentRelatedError = relatedError?.taskId === taskId ? relatedError.message : "";
  const kind = currentTask ? taskKind(currentTask) : "unknown";
  const timezone = typeof currentTask?.ticket_timezone === "string" ? currentTask.ticket_timezone : undefined;
  const runId = useMemo(() => runIdOf(kind !== "business" ? currentTask : null), [currentTask, kind]);
  const live = useTaskRunEventStream(runId);
  const leaveGuard = useTaskDetailLeaveGuard({ dirty: draftDirty, busy: entrySubmitting });

  const load = useCallback(async (mode: "initial" | "refresh" | "related" = "initial") => {
    const version = ++requestVersion.current;
    const preserveUntilRootRead = mode === "related";
    if (!preserveUntilRootRead) {
      setRoot(null);
      setBusiness(null);
      setStoredEvents(null);
    }
    setRootError(null);
    setRelatedError(null);
    setRootLoadingTaskId(taskId);
    if (mode === "refresh") setRefreshing(true);

    try {
      const response = await api.task(taskId);
      const detail = ("task" in response ? response.task : response) as TaskDetail;
      if (version !== requestVersion.current) return;
      if (detail.id !== taskId) throw new Error("任务服务返回了不匹配的任务标识。");

      setRoot({ taskId, value: detail });
      setRootLoadingTaskId(null);
      setBusiness(null);
      setStoredEvents(null);
      setDraftDirty(false);
      setEntryOpen(false);
      setEntrySubmitting(false);

      if (taskKind(detail) === "business") {
        setRelatedLoadingTaskId(taskId);
        try {
          const aggregate = await api.aiTaskWorkOrder(taskId);
          if (version !== requestVersion.current) return;
          if (aggregate.task.task_id !== taskId) throw new Error("业务聚合返回了不匹配的任务标识。");
          setBusiness({ taskId, value: aggregate });
        } catch (cause) {
          if (version !== requestVersion.current) return;
          setBusiness(null);
          setRelatedError({ taskId, message: relatedErrorMessage(cause, "业务聚合") });
        } finally {
          if (version === requestVersion.current) setRelatedLoadingTaskId(null);
        }
        return;
      }

      // Execution events are deliberately a separate read. A trace failure does
      // not revoke an independently authorized root task or turn it into an empty state.
      setRelatedLoadingTaskId(taskId);
      try {
        const responseEvents = await api.taskEvents(taskId);
        if (version !== requestVersion.current) return;
        setStoredEvents({ taskId, value: Array.isArray(responseEvents) ? responseEvents : responseEvents.events || [] });
      } catch (cause) {
        if (version !== requestVersion.current) return;
        setStoredEvents(null);
        setRelatedError({ taskId, message: relatedErrorMessage(cause, "任务执行记录") });
      } finally {
        if (version === requestVersion.current) setRelatedLoadingTaskId(null);
      }
    } catch (cause) {
      if (version !== requestVersion.current) return;
      // A root 401/403/404 and a root network error both remove cached body/action
      // content. The message makes access errors and transient failures distinct.
      setRoot(null);
      setBusiness(null);
      setStoredEvents(null);
      setRootError({ taskId, message: rootErrorMessage(cause) });
      setRootLoadingTaskId(null);
      setRelatedLoadingTaskId(null);
    } finally {
      if (version === requestVersion.current) setRefreshing(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load("initial");
    return () => { requestVersion.current += 1; };
  }, [load]);

  const rereadRootAfterRelatedFailure = useCallback(() => {
    if (accessCheck.current) return;
    accessCheck.current = true;
    const version = requestVersion.current;
    void (async () => {
      try {
        const response = await api.task(taskId);
        const detail = ("task" in response ? response.task : response) as TaskDetail;
        if (version !== requestVersion.current) return;
        if (detail.id !== taskId) throw new Error("任务服务返回了不匹配的任务标识。");
        setRoot({ taskId, value: detail });
        // Do not unmount an authorized business body: this preserves the draft,
        // receipt, and the related module's honest restricted state.
        try {
          const refreshed = await api.aiTaskWorkOrder(taskId);
          if (version !== requestVersion.current) return;
          if (refreshed.task.task_id !== taskId) throw new Error("业务聚合返回了不匹配的任务标识。");
          setBusiness({ taskId, value: refreshed });
        } catch (cause) {
          if (version !== requestVersion.current) return;
          setBusiness(null);
          setRelatedError({ taskId, message: relatedErrorMessage(cause, "业务聚合") });
        }
      } catch (cause) {
        if (version !== requestVersion.current) return;
        setRoot(null); setBusiness(null); setStoredEvents(null);
        setRootError({ taskId, message: rootErrorMessage(cause) });
        setRootLoadingTaskId(null); setRelatedLoadingTaskId(null);
      } finally { accessCheck.current = false; }
    })();
  }, [taskId]);

  const openWorkspace = useCallback(async () => {
    if (!currentBusiness || draftDirty || entrySubmitting) return;
    const businessTaskId = currentBusiness.task.task_id;
    setActionBusy(`workspace:${businessTaskId}`);
    try {
      const result = await api.openTaskCollaborationWorkspace(businessTaskId);
      navigate(`/s/${encodeURIComponent(result.id)}`);
    } catch {
      setRelatedError({ taskId: businessTaskId, message: "协作工作台暂时无法打开，请核对当前任务权限或会话归档状态。" });
    } finally {
      setActionBusy("");
    }
  }, [currentBusiness, draftDirty, entrySubmitting, navigate]);

  const visibleEvents = live.events.length ? live.events : currentStoredEvents || [];
  const taskTitle = cleanedText(currentBusiness?.task.title || currentTask?.title) || "未命名任务";
  const status = currentBusiness
    ? businessTaskStatusLabel(currentBusiness.task.status)
    : currentTask && kind === "business"
      ? businessTaskStatusLabel(String(currentTask.status || currentTask.display_status || ""))
      : currentTask
        ? agentStatusLabel(currentTask)
        : "";
  const progress = currentTask?.progress == null ? null : Number(currentTask.progress);
  const showProgress = Number.isFinite(progress) && progress != null && progress > 0 && progress <= 100;
  const trace = currentTask ? traceEntries(currentTask) : [];
  const businessRootTrace = trace.filter((entry) => ["type", "source", "created", "updated", "started", "completed", "due"].includes(entry.key));

  const retry = () => { void load("refresh"); };
  const backClick = (event: { preventDefault: () => void }) => leaveGuard.onManagedLeave(event, returnUrl, { state: returnState });

  if (!currentTask) {
    return <main className="independent-task-detail" data-task-detail>
      <TaskDetailLeaveBlocker {...leaveGuard.blockerProps} />
      <header className="independent-task-detail__header">
        <Link
          className="independent-task-detail__return"
          to={returnUrl}
          state={returnState}
          {...leaveGuard.managedLinkProps}
          aria-disabled={entrySubmitting || undefined}
          tabIndex={entrySubmitting ? -1 : undefined}
          onClick={backClick}
        >← 返回任务明细</Link>
      </header>
      <div className="independent-task-detail__content">
        {rootLoadingTaskId === taskId && !currentRootError ? <p className="independent-task-detail__empty" role="status">正在读取任务详情…</p> : <section className="independent-task-detail__error" role="alert">
          <strong>任务详情暂时无法读取</strong>
          <p>{currentRootError || "任务不存在或当前账号没有访问权限。"}</p>
          <Button type="text" onClick={retry} disabled={refreshing}>重新读取</Button>
        </section>}
      </div>
    </main>;
  }

  return <main className="independent-task-detail" data-task-detail data-task-kind={kind}>
    <TaskDetailLeaveBlocker {...leaveGuard.blockerProps} />
    <header className="independent-task-detail__header">
      <div className="independent-task-detail__header-top">
        <Link
          className="independent-task-detail__return"
          to={returnUrl}
          state={returnState}
          {...leaveGuard.managedLinkProps}
          aria-disabled={entrySubmitting || undefined}
          tabIndex={entrySubmitting ? -1 : undefined}
          onClick={backClick}
        >← 返回任务明细</Link>
        <button className="independent-task-detail__refresh" type="button" onClick={retry} disabled={refreshing || entrySubmitting || draftDirty} aria-busy={refreshing} title={draftDirty ? "请先提交或取消当前登记，再刷新详情" : undefined}>
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </div>
      <div className="independent-task-detail__heading">
        <div className="independent-task-detail__heading-copy">
          <div className="independent-task-detail__type-row"><span className="independent-task-detail__kind">{kind === "business" ? "业务任务" : kind === "agent" ? "Agent 任务" : "任务详情"}</span></div>
          <h1 title={taskTitle}>{taskTitle}</h1>
        </div>
        <div className="independent-task-detail__header-actions">
          <span className="independent-task-detail__status" data-status={normalizedStatus(currentBusiness ? { status: currentBusiness.task.status } : currentTask)}>{status}</span>
        </div>
      </div>
    </header>

    <div className="independent-task-detail__content">
      {kind === "business" ? <>
        {relatedLoadingTaskId === taskId && !currentBusiness && !currentRelatedError ? <p className="independent-task-detail__empty" role="status">正在读取业务目标和工单记录…</p> : null}
        {currentRelatedError ? <section className="independent-task-detail__error independent-task-detail__error--module" role="alert">
          <strong>业务详情未能完整读取</strong>
          <p>{currentRelatedError}</p>
          <Button type="text" onClick={retry} disabled={refreshing || entrySubmitting}>重新读取</Button>
        </section> : null}
        {currentBusiness ? <BusinessTaskDetailContent
          key={currentBusiness.task.task_id}
          detail={currentBusiness}
          timezone={timezone}
          extraTraceItems={businessRootTrace.map(entry => ({ key: `root-${entry.key}`, label: entry.label, children: entry.value }))}
          actionBusy={actionBusy}
          onWorkspace={openWorkspace}
          onUnavailable={rereadRootAfterRelatedFailure}
          // BusinessTaskDetailContent refreshes its own aggregate and reports it
          // through onTaskUpdated. Reloading the shell here would unmount the
          // component and discard the just-received R3 receipt.
          onChanged={() => undefined}
          onTaskUpdated={(detail) => { if (detail.task.task_id === taskId) setBusiness({ taskId, value: detail }); }}
          onDirtyChange={setDraftDirty}
          onBusyChange={setEntrySubmitting}
          onEntryOpenChange={setEntryOpen}
        /> : null}
        {entryOpen && currentBusiness ? <footer className="independent-task-detail__submit-bar" aria-label="登记提交操作">
          <Button type="primary" htmlType="submit" form="task-business-verified-event-form" disabled={entrySubmitting} loading={entrySubmitting}>
            {entrySubmitting ? "正在提交…" : "提交已核验事件"}
          </Button>
        </footer> : null}
      </> : <>
        {cleanedText(currentTask.description || currentTask.content || currentTask.context) ? <section className="independent-task-detail__section" aria-label="任务说明">
          <h2>任务说明</h2>
          <p className="independent-task-detail__section-copy">{cleanedText(currentTask.description || currentTask.content || currentTask.context)}</p>
        </section> : null}
        {showProgress ? <section className="independent-task-detail__section" aria-label="执行进度">
          <h2>执行进度</h2>
          <p className="independent-task-detail__section-copy">{progress}%</p>
        </section> : null}
        <section className="independent-task-detail__section" aria-label={kind === "agent" ? "执行过程" : "任务记录"}>
          <h2>{kind === "agent" ? "执行过程" : "任务记录"}</h2>
          {live.connected ? <p className="independent-task-detail__section-copy" role="status">执行记录正在实时更新。</p> : null}
          {live.fallback ? <p className="independent-task-detail__section-copy" role="status">实时连接暂不可用，正在安全补读记录。</p> : null}
          {relatedLoadingTaskId === taskId && !currentStoredEvents && !live.events.length ? <p className="independent-task-detail__empty" role="status">正在读取执行记录…</p> : null}
          {currentRelatedError ? <p className="independent-task-detail__error independent-task-detail__error--module" role="alert">{currentRelatedError} <Button type="text" onClick={retry} disabled={refreshing}>重新读取</Button></p> : null}
          {visibleEvents.length ? <ol className="independent-task-detail__event-list">{visibleEvents.map((event, index) => {
            const timestamp = eventTime(event);
            const summary = eventSummary(event);
            return <li className="independent-task-detail__event" key={String(event.id || `${timestamp || "event"}-${index}`)}>
              <div className="independent-task-detail__event-heading"><strong>{eventTitle(event)}</strong>{timestamp ? <time className="independent-task-detail__event-time" dateTime={timestamp}>{formatDetailTime(timestamp)}</time> : null}</div>
              {summary ? <p className="independent-task-detail__event-summary">{summary}</p> : null}
            </li>;
          })}</ol> : relatedLoadingTaskId !== taskId && !currentRelatedError ? <p className="independent-task-detail__empty">尚无可展示的执行记录。</p> : null}
        </section>
        {currentTask.artifacts?.length ? <section className="independent-task-detail__section" aria-label="结果产物">
          <h2>结果产物</h2>
          <ul className="independent-task-detail__artifact-list">{currentTask.artifacts.map((artifact, index) => {
            const title = artifactTitle(artifact);
            const summary = artifactSummary(artifact);
            const timestamp = artifactTime(artifact);
            if (!title && !summary && !timestamp) return null;
            return <li className="independent-task-detail__artifact" key={String(artifact.id || `${title || "artifact"}-${index}`)}>
              <div className="independent-task-detail__artifact-heading">{title ? <strong>{title}</strong> : null}{timestamp ? <time className="independent-task-detail__artifact-meta" dateTime={timestamp}>{formatDetailTime(timestamp)}</time> : null}</div>
              {summary ? <p className="independent-task-detail__artifact-summary">{summary}</p> : null}
            </li>;
          })}</ul>
        </section> : null}
        {currentTask.session_id ? <section className="independent-task-detail__section" aria-label="会话入口">
          <h2>继续处理</h2>
          <Link className="independent-task-detail__session-link" to={`/s/${encodeURIComponent(currentTask.session_id)}`}>进入完整会话 →</Link>
        </section> : null}
        {trace.length ? <section className="independent-task-detail__section independent-task-detail__trace independent-task-detail__section--last" aria-label="技术来源与追溯">
          <Collapse ghost items={[{
            key: "task-trace",
            label: "技术来源与追溯",
            children: <dl className="independent-task-detail__trace-grid">{trace.map((entry) => <div key={entry.key}><dt>{entry.label}</dt><dd className="independent-task-detail__trace-value">{entry.value}</dd></div>)}</dl>,
          }]} />
        </section> : null}
      </>}
    </div>
  </main>;
}

export default function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const { account } = useAccount();
  const identity = taskListScopeKey(account);
  return <TaskDetailThemeProvider><DetailBody key={`${taskId}:${identity}`} /></TaskDetailThemeProvider>;
}
