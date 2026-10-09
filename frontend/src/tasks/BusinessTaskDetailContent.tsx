import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Collapse, Descriptions, Form, Input, Modal, Select, Tag, Timeline } from "antd";
import { api, type AiTaskWorkOrderAggregate } from "../api";
import { TaskCollaborationContext } from "./TaskCollaborationContext";
import { WorkOrderSuggestions } from "./WorkOrderSuggestions";

type BusinessTaskDetailContentProps = {
  detail: AiTaskWorkOrderAggregate;
  actionBusy: string;
  onWorkspace: () => void;
  onUnavailable: () => void;
  onChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onTaskUpdated?: (detail: AiTaskWorkOrderAggregate) => void;
  onBusyChange?: (busy: boolean) => void;
  onEntryOpenChange?: (open: boolean) => void;
};

type EventDraft = {
  event_type: string;
  summary: string;
  evidence_ref: string;
  occurred_at: string;
  work_order_id?: string;
  evidence_keys: string;
  completed_stages: string;
};

type PendingSubmission = {
  values: EventDraft;
  stamp: number;
  occurredAt: string;
  fingerprint: string;
};

type SubmissionNotice = {
  eventId: string;
  replayed: boolean;
  decisionOutcome: string;
  decisionStatus: string;
  decisionConfidence: number | null;
  executionJobId: string;
  executionJobStatus: string;
  executionMode: string;
  refreshFailed: boolean;
};

type WorkOrder = AiTaskWorkOrderAggregate["work_orders"][number];

const EMPTY_EVENT_DRAFT: EventDraft = {
  event_type: "mail.reply_verified",
  summary: "",
  evidence_ref: "",
  occurred_at: "",
  work_order_id: "",
  evidence_keys: "",
  completed_stages: "",
};

const EVENT_TYPES = [
  { value: "mail.reply_verified", label: "已验证邮件回复" },
  { value: "mail.commitment_verified", label: "已验证邮件承诺" },
  { value: "deadline.quote", label: "报价期限" },
  { value: "deadline.contract", label: "合同期限" },
  { value: "deadline.sample", label: "样品期限" },
  { value: "deadline.content", label: "内容期限" },
];

const EVENT_LABELS: Record<string, string> = {
  "lead.created": "线索已建档",
  ...Object.fromEntries(EVENT_TYPES.map((item) => [item.value, item.label])),
};

const WORK_ORDER_STATUS_LABELS: Record<string, string> = {
  open: "待启动",
  queued: "排队中",
  pending: "排队中",
  proposed: "待确认",
  pending_assignment: "待分派",
  assigned: "已分派",
  accepted: "已受理",
  running: "进行中",
  in_progress: "处理中",
  waiting: "等待中",
  waiting_external: "等待外部",
  waiting_approval: "等待确认",
  blocked: "已阻塞",
  ready_for_review: "待复核",
  ready_for_acceptance: "待验收",
  needs_review: "待复核",
  completed: "已完成",
  cancelled: "已取消",
  canceled: "已取消",
};

const TERMINAL_WORK_ORDER_STATUSES = new Set(["completed", "cancelled", "canceled"]);

function formatTime(value?: string | null) {
  if (!value) return "—";
  const time = new Date(value);
  return Number.isNaN(time.valueOf())
    ? value
    : time.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function eventLabel(eventType: string) {
  return EVENT_LABELS[eventType] || eventType;
}

function workOrderStatusLabel(status: string) {
  return WORK_ORDER_STATUS_LABELS[status] || status;
}

function splitLines(value?: string) {
  return [...new Set((value || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

function hasDraftValues(values: EventDraft) {
  return Boolean(
    values.summary?.trim()
      || values.evidence_ref?.trim()
      || values.occurred_at
      || values.work_order_id
      || values.evidence_keys?.trim()
      || values.completed_stages?.trim()
      || values.event_type !== EMPTY_EVENT_DRAFT.event_type,
  );
}

function displayAssignee(order: WorkOrder) {
  const assignee = order.primary_assignee;
  if (!assignee) return "尚未分派";
  const parts = [
    assignee.person_ref ? `人员：${assignee.person_ref}` : null,
    assignee.principal_id ? `主体：${assignee.principal_id}` : null,
    assignee.org_unit_id ? `组织：${assignee.org_unit_id}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "尚未分派";
}

function displayDecision(order: WorkOrder) {
  const decision = order.latest_decision;
  if (!decision) return "暂无自动化决策";
  const confidence = decision.confidence == null ? "—" : `${Math.round(decision.confidence * 100)}%`;
  return `结果：${decision.outcome} · 状态：${decision.status} · 模式：${decision.decision_mode} · 置信度：${confidence} · ${formatTime(decision.created_at)}`;
}

function readableOrder(order: WorkOrder) {
  return `${order.title || "未命名工单"} · ${workOrderStatusLabel(order.status)}`;
}

function businessGoalSummary(goal: string, taskTitle: string) {
  const full = goal.trim();
  const withoutRepeatedTitle = taskTitle.trim() && full.includes(taskTitle.trim())
    ? full.replace(taskTitle.trim(), "").replace(/^[\s:：,，、-]+/, "").trim()
    : full;
  const withoutRepeatedYoutubeId = withoutRepeatedTitle
    .replace(/\s*[（(]?\s*YouTube\s*(?:channel\s*)?(?:ID)?\s*[:：]?\s*UC[A-Za-z0-9_-]{20,}\s*[）)]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return withoutRepeatedYoutubeId || full || "—";
}

function verifiedEventFingerprint(taskId: string, stamp: number, values: EventDraft, occurredAt: string) {
  const evidenceKeys = splitLines(values.evidence_keys);
  const completedStages = splitLines(values.completed_stages);
  return JSON.stringify({
    source_system: "workbench_human_verification",
    source_event_id: `workbench:${taskId}:${stamp}`,
    source_version: "workbench.v1",
    event_type: values.event_type,
    occurred_at: occurredAt,
    summary: values.summary.trim(),
    evidence_ref: values.evidence_ref.trim(),
    evidence: {
      verified_in: "workbench",
      actor_action: "human_verified_event",
      completed_stages: completedStages,
      ...Object.fromEntries(evidenceKeys.map((key) => [key, true])),
    },
    payload: {},
    work_order_id: values.work_order_id || undefined,
    idempotency_key: `workbench-verified-event-${taskId}-${stamp}`,
  });
}

function makePendingSubmission(taskId: string, values: EventDraft): PendingSubmission {
  const sourceTime = values.occurred_at ? new Date(values.occurred_at) : new Date();
  if (Number.isNaN(sourceTime.valueOf())) throw new Error("发生时间无效，请修正后重新确认。");
  const stamp = Date.now();
  const occurredAt = sourceTime.toISOString();
  return { values, stamp, occurredAt, fingerprint: verifiedEventFingerprint(taskId, stamp, values, occurredAt) };
}

/**
 * Business detail content only. The drawer header owns root-task status and close handling.
 * Formal writes remain behind the explicit confirmation modal and the published API contract.
 */
export function BusinessTaskDetailContent({
  detail,
  actionBusy,
  onWorkspace,
  onUnavailable,
  onChanged,
  onDirtyChange,
  onTaskUpdated,
  onBusyChange,
  onEntryOpenChange,
}: BusinessTaskDetailContentProps) {
  const [form] = Form.useForm<EventDraft>();
  const [entryOpen, setEntryOpen] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [resultMayBeUnknown, setResultMayBeUnknown] = useState(false);
  const [notice, setNotice] = useState<SubmissionNotice | null>(null);
  const dirtyRef = useRef(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onBusyChangeRef = useRef(onBusyChange);
  const activeTaskIdRef = useRef(detail.task.task_id);

  onDirtyChangeRef.current = onDirtyChange;
  onBusyChangeRef.current = onBusyChange;
  activeTaskIdRef.current = detail.task.task_id;

  const setDirty = useCallback((dirty: boolean) => {
    if (dirtyRef.current === dirty) return;
    dirtyRef.current = dirty;
    onDirtyChangeRef.current?.(dirty);
  }, []);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; onDirtyChangeRef.current?.(false); }; }, []);
  useEffect(() => { onEntryOpenChange?.(entryOpen); return () => onEntryOpenChange?.(false); }, [entryOpen, onEntryOpenChange]);
  useEffect(() => () => { onBusyChangeRef.current?.(false); }, []);
  useEffect(() => { onBusyChange?.(submitting); }, [onBusyChange, submitting]);

  useEffect(() => {
    form.resetFields();
    setEntryOpen(false);
    setPendingSubmission(null);
    setConfirmationOpen(false);
    setSubmitting(false);
    setSubmitError("");
    setResultMayBeUnknown(false);
    setNotice(null);
    setDirty(false);
  }, [detail.task.task_id, form, setDirty]);

  const titles = useMemo(
    () => Object.fromEntries(detail.work_orders.map((order) => [order.work_order_id, order.title])),
    [detail.work_orders],
  );
  const currentBlocking = detail.current_blocking_work_order;
  const openWorkOrders = useMemo(
    () => detail.work_orders.filter((order) => !TERMINAL_WORK_ORDER_STATUSES.has(order.status)),
    [detail.work_orders],
  );

  const refreshAggregate = useCallback(async () => {
    const taskId = detail.task.task_id;
    try {
      const refreshed = await api.aiTaskWorkOrder(taskId);
      if (mountedRef.current && activeTaskIdRef.current === taskId) onTaskUpdated?.(refreshed);
      return true;
    } catch {
      return false;
    } finally {
      if (mountedRef.current) onChanged();
    }
  }, [detail.task.task_id, onChanged, onTaskUpdated]);

  const openConfirmation = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setNotice(null);
      setSubmitError("");
      setResultMayBeUnknown(false);
      const existing = pendingSubmission;
      if (existing && existing.fingerprint === verifiedEventFingerprint(detail.task.task_id, existing.stamp, values, existing.occurredAt)) {
        setConfirmationOpen(true);
      } else {
        setPendingSubmission(makePendingSubmission(detail.task.task_id, values));
        setConfirmationOpen(true);
      }
    } catch (cause) {
      if (cause instanceof Error) setSubmitError(cause.message);
    }
  }, [detail.task.task_id, form, pendingSubmission]);

  const submitVerifiedEvent = useCallback(async () => {
    if (!pendingSubmission || submittingRef.current) return;
    const { values, stamp, occurredAt } = pendingSubmission;
    const taskId = detail.task.task_id;
    if (pendingSubmission.fingerprint !== verifiedEventFingerprint(taskId, stamp, form.getFieldsValue(), occurredAt)) {
      setPendingSubmission(null);
      setConfirmationOpen(false);
      setResultMayBeUnknown(false);
      setSubmitError("表单内容已变化，原确认已失效；请重新确认后再写入。");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    setResultMayBeUnknown(false);
    try {
      const evidenceKeys = splitLines(values.evidence_keys);
      const completedStages = splitLines(values.completed_stages);
      const result = await api.recordAiTaskVerifiedEvent(taskId, {
        source_system: "workbench_human_verification",
        source_event_id: `workbench:${taskId}:${stamp}`,
        source_version: "workbench.v1",
        event_type: values.event_type,
        occurred_at: occurredAt,
        summary: values.summary.trim(),
        evidence_ref: values.evidence_ref.trim(),
        evidence: {
          verified_in: "workbench",
          actor_action: "human_verified_event",
          completed_stages: completedStages,
          ...Object.fromEntries(evidenceKeys.map((key) => [key, true])),
        },
        payload: {},
        work_order_id: values.work_order_id || undefined,
        idempotency_key: `workbench-verified-event-${taskId}-${stamp}`,
      });
      if (!mountedRef.current) return;
      const refreshSucceeded = await refreshAggregate();
      if (!mountedRef.current) return;
      setNotice({
        eventId: result.event.id,
        replayed: result.event.replayed,
        decisionOutcome: result.decision.outcome,
        decisionStatus: result.decision.status,
        decisionConfidence: result.decision.confidence,
        executionJobId: result.execution_job.id,
        executionJobStatus: result.execution_job.status,
        executionMode: result.execution_mode,
        refreshFailed: !refreshSucceeded,
      });
      form.resetFields();
      setDirty(false);
      setEntryOpen(false);
      setPendingSubmission(null);
      setConfirmationOpen(false);
    } catch (cause) {
      const status = Number((cause as { status?: unknown })?.status);
      const unknown = !Number.isFinite(status) || status >= 500;
      setResultMayBeUnknown(unknown);
      setSubmitError(unknown
        ? "提交结果尚未确认，系统未自动重试。请先核对业务记录；如需再次提交，必须使用当前确认中的同一登记标识。"
        : cause instanceof Error ? cause.message : "已核验事件登记失败，请修正后重新确认。");
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, [detail.task.task_id, form, pendingSubmission, refreshAggregate, setDirty, submitting]);

  const cancelConfirmation = useCallback(() => {
    if (submitting) return;
    setConfirmationOpen(false);
    setSubmitError("");
    setResultMayBeUnknown(false);
  }, [submitting]);

  const handleValuesChange = useCallback((_changed: Partial<EventDraft>, values: EventDraft) => {
    setDirty(hasDraftValues(values));
    if (pendingSubmission && pendingSubmission.fingerprint !== verifiedEventFingerprint(detail.task.task_id, pendingSubmission.stamp, values, pendingSubmission.occurredAt)) {
      setPendingSubmission(null);
      setConfirmationOpen(false);
      setSubmitError("");
      setResultMayBeUnknown(false);
    }
  }, [detail.task.task_id, pendingSubmission, setDirty]);

  const handleSuggestionsChanged = useCallback(() => {
    void refreshAggregate();
  }, [refreshAggregate]);

  return <div className="business-task-detail">
    <section className="task-business-summary" aria-label="业务摘要">
      <Descriptions
        className="task-business-descriptions"
        column={1}
        size="small"
        colon={false}
        items={[
          { key: "goal", label: "业务目标", children: businessGoalSummary(detail.task.goal, detail.task.title) },
          ...(detail.task.due_at ? [{ key: "due", label: "截止时间", children: <span className={new Date(detail.task.due_at).valueOf() < Date.now() && !["completed", "cancelled", "canceled"].includes(detail.task.status) ? "task-business-overdue" : undefined}>{formatTime(detail.task.due_at)}{new Date(detail.task.due_at).valueOf() < Date.now() && !["completed", "cancelled", "canceled"].includes(detail.task.status) ? " · 已逾期" : ""}</span> }] : []),
          { key: "progress", label: "当前推进", children: detail.work_orders.length === 0 ? "尚无执行工单。" : currentBlocking ? readableOrder(currentBlocking) : "当前无阻塞工单。" },
        ]}
      />
      <div className="task-business-actions">
        <Button type="text" size="small" onClick={() => setEntryOpen(current => !current)} disabled={submitting} aria-expanded={entryOpen} aria-controls="task-business-event-entry">{entryOpen ? "收起登记" : "登记事件"}</Button>
        {detail.task.workspace_allowed ? <Button type="text" size="small" onClick={onWorkspace} disabled={Boolean(actionBusy) || submitting || dirtyRef.current} aria-busy={actionBusy.startsWith("workspace:")} title={dirtyRef.current ? "请先提交或取消当前登记，再打开工作台" : undefined}>打开协作工作台</Button> : null}
      </div>
    </section>

    <TaskCollaborationContext taskId={detail.task.task_id} titles={titles} onUnavailable={onUnavailable} compactEmpty />
    <WorkOrderSuggestions taskId={detail.task.task_id} onChanged={handleSuggestionsChanged} compactEmpty />

    {entryOpen || notice ? <section id="task-business-event-entry" className="task-business-entry" aria-label="登记已核验事件">
      {entryOpen ? <div className="task-business-entry-head">
        <div>
          <h3>登记已核验事件</h3>
          <p className="task-business-helper">只填写已确认的事实与证据；写入后会进入受控判断和异步工单管道。</p>
        </div>
      </div> : null}
      {notice ? <Alert
        className="task-business-form-notice"
        type={notice.refreshFailed ? "warning" : "success"}
        showIcon
        message={notice.replayed ? "已核对既有登记回执" : "已登记核验事件"}
        description={<>
          <p>事件 {notice.eventId}；决策：{notice.decisionOutcome}（{notice.decisionStatus}{notice.decisionConfidence == null ? "" : `，置信度 ${Math.round(notice.decisionConfidence * 100)}%`}）。</p>
          <p>异步作业 {notice.executionJobId} 当前为「{notice.executionJobStatus}」；执行模式：{notice.executionMode}。这不表示业务任务已完成。</p>
          {notice.refreshFailed ? <p>写入回执已收到，但详情重新读取失败；请刷新后核对最新业务记录。</p> : null}
        </>}
      /> : null}
      {entryOpen ? <Form<EventDraft>
        className="task-business-form"
        form={form}
        id="task-business-verified-event-form"
        onFinish={() => void openConfirmation()}
        disabled={submitting}
        layout="vertical"
        initialValues={EMPTY_EVENT_DRAFT}
        onValuesChange={handleValuesChange}
        requiredMark
      >
        <Form.Item name="event_type" label="事件类型" rules={[{ required: true, message: "请选择事件类型。" }]}>
          <Select options={EVENT_TYPES} />
        </Form.Item>
        <Form.Item name="work_order_id" label="作用子工单（A3 可选）">
          <Select
            allowClear
            placeholder="不指定：仅判断是否新建或分派工单"
            options={openWorkOrders.map((order) => ({ value: order.work_order_id, label: `${order.title} · 当前阶段 ${order.stage_code || "未设定"}` }))}
          />
        </Form.Item>
        <Form.Item name="summary" label="已核验事实摘要" rules={[{ required: true, whitespace: true, message: "请填写已核验事实摘要。" }]}>
          <Input.TextArea maxLength={1000} placeholder="只写已经确认的事实" />
        </Form.Item>
        <Form.Item name="evidence_ref" label="证据引用" rules={[{ required: true, whitespace: true, message: "请填写证据引用。" }]}>
          <Input maxLength={1000} placeholder="例如：mail:thread/123" />
        </Form.Item>
        <Form.Item name="occurred_at" label="发生时间">
          <Input type="datetime-local" />
        </Form.Item>
        <Collapse
          className="task-business-form-advanced"
          ghost
          items={[{
            key: "advanced-verification",
            label: "高级核验字段",
            children: <>
              <Form.Item name="evidence_keys" label="已核验证据键（每行一个）">
                <Input.TextArea placeholder={"receipt_verified\ncompleted_stages"} />
              </Form.Item>
              <Form.Item name="completed_stages" label="已完成阶段（每行一个）">
                <Input.TextArea placeholder={"SHIPPED\nTESTING"} />
              </Form.Item>
            </>,
          }]}
        />
        <div className="task-business-form-actions">
          <Button type="text" onClick={() => { form.resetFields(); setDirty(false); setPendingSubmission(null); setConfirmationOpen(false); setEntryOpen(false); }} disabled={submitting}>取消本次登记</Button>
        </div>
      </Form> : null}
    </section> : null}

    {detail.verified_events.length ? <section className="task-business-events" aria-label="已核验业务事件">
      <h3>已核验业务事件</h3>
      <Timeline
        items={detail.verified_events.map((event) => ({
          key: event.id,
          children: <div className="task-business-event">
            <strong>{eventLabel(event.event_type)}</strong>
            <p className="task-business-event-meta">{event.occurred_at === event.verified_at ? `${formatTime(event.occurred_at)} · 已核验` : `发生：${formatTime(event.occurred_at)} · 核验：${formatTime(event.verified_at)}`}</p>
            <p>{event.summary}</p>
            <Collapse
              className="task-business-event-evidence"
              ghost
              items={[{ key: `evidence-${event.id}`, label: "查看证据与追溯", children: <>
                <p>证据：{event.evidence_ref || "—"}</p>
                <p className="task-business-event-trace">事件类型：{event.event_type} · 事件标识：{event.id}</p>
                <p>发生：{formatTime(event.occurred_at)} · 核验：{formatTime(event.verified_at)} · 核验人：{event.verified_by || "—"}</p>
              </> }]}
            />
          </div>,
        }))}
      />
    </section> : null}

    {detail.work_orders.length ? <section className="task-business-orders" aria-label="标准执行工单">
      <h3>标准执行工单</h3>
      <ul className="task-business-work-order-list">
        {detail.work_orders.map((order) => <li key={order.work_order_id} className="task-business-work-order">
          <Collapse
            ghost
            items={[{
              key: order.work_order_id,
              label: <span className="task-business-work-order-label">
                <span>{order.title || "未命名工单"}</span>
                <Tag className="task-business-status">{workOrderStatusLabel(order.status)}</Tag>
              </span>,
              children: <Descriptions
                className="task-business-work-order-details"
                column={1}
                size="small"
                colon={false}
                items={[
                  { key: "raw-status", label: "原始状态", children: order.status },
                  { key: "objective", label: "工单目标", children: order.objective || "—" },
                  { key: "stage", label: "当前阶段", children: order.stage_code || "未设定" },
                  { key: "automation", label: "自动化等级", children: order.automation_level || "—" },
                  { key: "assignee", label: "主受理", children: displayAssignee(order) },
                  { key: "decision", label: "自动化决策", children: displayDecision(order) },
                  { key: "template", label: "模板追溯", children: `${order.template_title || order.template_code} · ${order.template_code}.v${order.template_version}` },
                  { key: "assignment", label: "创建与分派追溯", children: `创建：${order.creation_mode} · 分派：${order.assignment_origin} · 路由：${order.routing_policy_code || "—"}` },
                ]}
              />,
            }]}
          />
        </li>)}
      </ul>
    </section> : null}

    <section className="task-business-technical" aria-label="技术来源与追溯">
      <Collapse
        ghost
        items={[{
          key: "source-trace",
          label: "技术来源与追溯",
          children: <Descriptions
            column={1}
            size="small"
            colon={false}
            items={[
              { key: "original-goal", label: "原始业务目标", children: detail.task.goal || "—" },
              { key: "source", label: "数据来源", children: detail.source },
              { key: "as-of", label: "数据时间", children: formatTime(detail.as_of) },
              { key: "task-id", label: "任务标识", children: detail.task.task_id },
              { key: "version", label: "任务版本", children: detail.task.data_version },
            ]}
          />,
        }]}
      />
    </section>

    <Modal
      className="task-business-confirmation"
      width="var(--dialog-w-md)"
      keyboard={!submitting}
      open={confirmationOpen && Boolean(pendingSubmission)}
      title="确认登记已核验事件"
      onCancel={cancelConfirmation}
      closable={!submitting}
      mask={{ closable: !submitting }}
      footer={<div className="task-business-confirmation-actions">
        <Button type="text" onClick={cancelConfirmation} disabled={submitting}>返回编辑</Button>
        <Button type="primary" onClick={() => void submitVerifiedEvent()} loading={submitting}>
          {resultMayBeUnknown ? "使用同一登记标识再次提交" : "确认写入并进入异步处理"}
        </Button>
      </div>}
    >
      {pendingSubmission ? <>
        <p>将登记一条已核验业务事实；服务端会按当前发布规则进行 Jev 判断，并把后续工单处理交给异步 Outbox 与 Worker。</p>
        <Descriptions
          column={1}
          size="small"
          colon={false}
          items={[
            { key: "event", label: "事件", children: eventLabel(pendingSubmission.values.event_type) },
            { key: "summary", label: "事实摘要", children: pendingSubmission.values.summary },
            { key: "evidence", label: "证据引用", children: pendingSubmission.values.evidence_ref },
            { key: "order", label: "作用工单", children: pendingSubmission.values.work_order_id ? detail.work_orders.find((order) => order.work_order_id === pendingSubmission.values.work_order_id)?.title || "指定工单" : "不指定" },
          ]}
        />
        <p className="task-business-confirmation-warning">登记成功只表示事件已写入并返回实际判断/作业状态，不表示业务任务完成。</p>
        {submitError ? <Alert type={resultMayBeUnknown ? "warning" : "error"} showIcon message={submitError} /> : null}
      </> : null}
    </Modal>
  </div>;
}
