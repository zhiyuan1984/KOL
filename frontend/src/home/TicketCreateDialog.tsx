import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  api,
  type CreateFormalTicketInput,
  type TicketAssigneeCandidate,
  type TicketFormBootstrap,
} from "../api";
import "./ticket-create-dialog.css";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const CATEGORY_OPTIONS: Array<{ value: CreateFormalTicketInput["business_category"]; label: string }> = [
  { value: "kol", label: "达人 / KOL" },
  { value: "marketing", label: "市场营销" },
  { value: "operations", label: "运营" },
  { value: "data", label: "数据分析" },
  { value: "general", label: "综合事务" },
];
const PRIORITY_OPTIONS: Array<{ value: CreateFormalTicketInput["priority"]; label: string }> = [
  { value: "important_urgent", label: "重要且紧急" },
  { value: "important", label: "重要" },
  { value: "urgent", label: "紧急" },
  { value: "normal", label: "普通" },
  { value: "low", label: "低" },
];

function newIdempotencyKey() {
  return `ticket-form-${crypto.randomUUID()}`;
}

function localDueDateTime(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function matchingAssignees(bootstrap: TicketFormBootstrap | null, unitId: string): TicketAssigneeCandidate[] {
  if (!bootstrap) return [];
  return bootstrap.assignee_candidates.filter((person) => person.org_unit_id === unitId);
}

export default function TicketCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [bootstrap, setBootstrap] = useState<TicketFormBootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [category, setCategory] = useState<CreateFormalTicketInput["business_category"]>("general");
  const [priority, setPriority] = useState<CreateFormalTicketInput["priority"]>("normal");
  const [stageGroup, setStageGroup] = useState("");
  const [stageCode, setStageCode] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [noDueReason, setNoDueReason] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [assigneeUnitId, setAssigneeUnitId] = useState("");
  const [assigneePersonRef, setAssigneePersonRef] = useState("");
  const [crossGroupReason, setCrossGroupReason] = useState("");
  const [basisType, setBasisType] = useState("");
  const [basisId, setBasisId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const assignees = useMemo(() => matchingAssignees(bootstrap, assigneeUnitId), [bootstrap, assigneeUnitId]);
  const isCrossGroup = Boolean(bootstrap?.creator.org_unit_id && assigneeUnitId && bootstrap.creator.org_unit_id !== assigneeUnitId);
  const canSubmit = Boolean(
    bootstrap?.formal_submission_enabled
    && title.trim()
    && goal.trim()
    && assigneeUnitId
    && assigneePersonRef
    && criteriaText.split("\n").some((item) => item.trim())
    && (dueAt || noDueReason.trim())
    && (!isCrossGroup || crossGroupReason.trim()),
  );

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    returnFocusRef.current = previous instanceof HTMLElement ? previous : null;
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    setLoading(true);
    setError("");
    void api.ticketFormBootstrap()
      .then((next) => {
        setBootstrap(next);
        const defaultUnit = next.creator.org_unit_id || next.organization_units[0]?.id || "";
        setAssigneeUnitId(defaultUnit);
        const candidate = matchingAssignees(next, defaultUnit).find((person) => person.assignable);
        setAssigneePersonRef(candidate?.person_ref || "");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "组织与人员信息读取失败"))
      .finally(() => setLoading(false));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  const close = () => {
    if (busy) return;
    onClose();
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  };

  const chooseUnit = (unitId: string) => {
    setAssigneeUnitId(unitId);
    const candidate = matchingAssignees(bootstrap, unitId).find((person) => person.assignable);
    setAssigneePersonRef(candidate?.person_ref || "");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      const acceptanceCriteria = criteriaText.split("\n").map((item) => item.trim()).filter(Boolean);
      const basisRefs = basisType.trim() && basisId.trim()
        ? [{ source_type: basisType.trim(), source_id: basisId.trim(), summary: { origin: "employee_ticket_form" } }]
        : undefined;
      const result = await api.createFormalTicket({
        title: title.trim(),
        goal: goal.trim(),
        business_category: category,
        priority,
        stage_group: stageGroup.trim() || undefined,
        stage_code: stageCode.trim() || undefined,
        due_at: localDueDateTime(dueAt),
        no_due_reason: noDueReason.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
        acceptance_criteria: acceptanceCriteria,
        assignee_person_ref: assigneePersonRef,
        assignee_unit_id: assigneeUnitId,
        cross_group_reason: isCrossGroup ? crossGroupReason.trim() : undefined,
        basis_refs: basisRefs,
        idempotency_key: idempotencyKey,
      });
      setIdempotencyKey(newIdempotencyKey());
      onCreated(result.ticket_id);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工单创建失败");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return createPortal(
    <div className="ticket-create-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="ticket-create-backdrop" />
      <form ref={dialogRef} className="ticket-create-dialog" aria-labelledby={titleId} aria-modal="true" role="dialog" onSubmit={submit}>
        <header className="ticket-create-head">
          <div>
            <p className="eyebrow">正式工单</p>
            <h2 id={titleId}>新建工单</h2>
            <p>创建后固化组织范围、受理人、负责人观察人与验收条件。</p>
          </div>
          <button type="button" className="ticket-create-close" aria-label="关闭新建工单" disabled={busy} onClick={close}>×</button>
        </header>
        <div className="ticket-create-body">
          {loading ? <p className="muted">正在加载组织与人员信息…</p> : null}
          {error ? <p className="ticket-create-error" role="alert">{error}</p> : null}
          {bootstrap?.quality_warnings.length ? <section className="ticket-create-warning" aria-label="组织数据质量提示"><strong>暂不能提交的原因</strong><ul>{bootstrap.quality_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p>请联系管理员补齐账号、三级组织或负责人绑定后再创建正式工单。</p></section> : null}

          <section className="ticket-create-section">
            <h3>任务定义</h3>
            <label className="ticket-create-field ticket-create-field-full"><span>工单标题 <i>*</i></span><input ref={titleRef} value={title} maxLength={200} disabled={loading || busy} onChange={(event) => setTitle(event.target.value)} placeholder="例如：完成本周达人合作复盘" /></label>
            <label className="ticket-create-field ticket-create-field-full"><span>目标 <i>*</i></span><textarea value={goal} rows={3} disabled={loading || busy} onChange={(event) => setGoal(event.target.value)} placeholder="明确可验证的业务目标，而不是仅描述动作。" /></label>
            <div className="ticket-create-grid">
              <label className="ticket-create-field"><span>业务分类 <i>*</i></span><select value={category} disabled={loading || busy} onChange={(event) => setCategory(event.target.value as CreateFormalTicketInput["business_category"])}>{CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="ticket-create-field"><span>优先级 <i>*</i></span><select value={priority} disabled={loading || busy} onChange={(event) => setPriority(event.target.value as CreateFormalTicketInput["priority"])}>{PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="ticket-create-field"><span>阶段组</span><input value={stageGroup} disabled={loading || busy} onChange={(event) => setStageGroup(event.target.value)} placeholder="例如：达人合作" /></label>
              <label className="ticket-create-field"><span>阶段代码</span><input value={stageCode} disabled={loading || busy} onChange={(event) => setStageCode(event.target.value)} placeholder="例如：negotiation" /></label>
            </div>
          </section>

          <section className="ticket-create-section">
            <h3>完成与验收</h3>
            <div className="ticket-create-grid">
              <label className="ticket-create-field"><span>截止时间 <i>*</i></span><input type="datetime-local" value={dueAt} disabled={loading || busy} onChange={(event) => setDueAt(event.target.value)} /></label>
              <label className="ticket-create-field"><span>无截止时间原因</span><input value={noDueReason} disabled={loading || busy} onChange={(event) => setNoDueReason(event.target.value)} placeholder="无固定时间时必须说明" /></label>
            </div>
            <label className="ticket-create-field ticket-create-field-full"><span>验收条件 <i>*</i><small>每行一条</small></span><textarea value={criteriaText} rows={4} disabled={loading || busy} onChange={(event) => setCriteriaText(event.target.value)} placeholder={"例如：\n复盘报告已归档\n关键数据与结论已核验"} /></label>
          </section>

          <section className="ticket-create-section">
            <h3>组织与受理</h3>
            <p className="ticket-create-source">创建人组织：{bootstrap?.creator.org_unit_id || "待解析"}　组织版本：{bootstrap?.creator.org_version ?? "—"}</p>
            <div className="ticket-create-grid">
              <label className="ticket-create-field"><span>受理组织 <i>*</i></span><select value={assigneeUnitId} disabled={loading || busy} onChange={(event) => chooseUnit(event.target.value)}><option value="">请选择组织</option>{bootstrap?.organization_units.map((unit) => <option key={unit.id} value={unit.id}>{"　".repeat(Math.max(0, unit.level - 1))}{unit.display_name}</option>)}</select></label>
              <label className="ticket-create-field"><span>受理人 <i>*</i></span><select value={assigneePersonRef} disabled={loading || busy || !assigneeUnitId} onChange={(event) => setAssigneePersonRef(event.target.value)}><option value="">请选择受理人</option>{assignees.map((person) => <option key={person.person_ref} value={person.person_ref} disabled={!person.assignable}>{person.display_name}{person.position ? `（${person.position}）` : ""}{person.quality_issue ? ` — ${person.quality_issue}` : ""}</option>)}</select></label>
            </div>
            {isCrossGroup ? <label className="ticket-create-field ticket-create-field-full"><span>跨组织分派原因 <i>*</i></span><textarea rows={2} value={crossGroupReason} disabled={loading || busy} onChange={(event) => setCrossGroupReason(event.target.value)} placeholder="说明为何需要跨组织分派。" /></label> : null}
          </section>

          <section className="ticket-create-section">
            <h3>关联依据 <small>可选</small></h3>
            <p className="ticket-create-source">可填写一次来源，以便审计追溯；不填写也可创建人工工单。</p>
            <div className="ticket-create-grid"><label className="ticket-create-field"><span>来源类型</span><input value={basisType} disabled={loading || busy} onChange={(event) => setBasisType(event.target.value)} placeholder="例如：brief / meeting" /></label><label className="ticket-create-field"><span>来源标识</span><input value={basisId} disabled={loading || busy} onChange={(event) => setBasisId(event.target.value)} placeholder="例如：会议纪要 ID" /></label></div>
          </section>
        </div>
        <footer className="ticket-create-actions"><button type="button" className="btn ghost" disabled={busy} onClick={close}>取消</button><button type="submit" className="btn primary" disabled={!canSubmit || busy}>{busy ? "正在创建…" : "创建正式工单"}</button></footer>
      </form>
    </div>,
    document.body,
  );
}
