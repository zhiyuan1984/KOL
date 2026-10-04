import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Task, type Ticket } from "../api";
import "./ticket-create-dialog.css";

const PRIORITIES = [
  ["important_urgent", "重要紧急"], ["important", "重要"], ["urgent", "紧急"], ["normal", "中"], ["low", "低"],
] as const;

function dateInput(value: unknown) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

/** Business-field editor for pending formal tickets. Lifecycle state and
 * organization responsibility are intentionally absent from this form. */
export default function TicketEditDialog({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: Task | null;
  onClose: () => void;
  onSaved: (ticket: Ticket) => void;
}) {
  const titleId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const open = Boolean(ticket);
  const initial = useMemo(() => ({
    title: String(ticket?.title || ""),
    goal: String(ticket?.goal || ticket?.description || ticket?.content || ""),
    priority: String(ticket?.priority || "normal"),
    dueAt: dateInput(ticket?.due_at),
    criteria: Array.isArray(ticket?.acceptance_criteria) ? ticket!.acceptance_criteria.map(String).join("\n") : "",
  }), [ticket]);
  const [title, setTitle] = useState(initial.title);
  const [goal, setGoal] = useState(initial.goal);
  const [priority, setPriority] = useState(initial.priority);
  const [dueAt, setDueAt] = useState(initial.dueAt);
  const [criteria, setCriteria] = useState(initial.criteria);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(initial.title); setGoal(initial.goal); setPriority(initial.priority); setDueAt(initial.dueAt); setCriteria(initial.criteria); setBusy(false); setError("");
  }, [initial]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = oldOverflow; };
  }, [open]);
  if (!open || !ticket || typeof document === "undefined") return null;

  const submit = async () => {
    if (!title.trim()) { setError("工单标题不能为空。"); return; }
    const expectedVersion = Number(ticket.data_version || 0);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) { setError("工单版本不可用，请刷新页面后重试。"); return; }
    setBusy(true); setError("");
    try {
      const result = await api.editFormalTicket(ticket.id, {
        expected_version: expectedVersion,
        idempotency_key: `ticket-edit-${crypto.randomUUID()}`,
        title: title.trim(),
        goal: goal.trim() || null,
        priority: priority as "important_urgent" | "important" | "urgent" | "normal" | "low",
        due_at: dueAt ? `${dueAt}T23:59:59+08:00` : null,
        no_due_reason: dueAt ? null : "暂未设置截止日期",
        acceptance_criteria: criteria.split("\n").map((item) => item.trim()).filter(Boolean),
      });
      onSaved(result.ticket);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工单编辑失败");
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="ticket-create-layer" data-ticket-edit-dialog>
      <div className="ticket-create-backdrop" onMouseDown={() => { if (!busy) onClose(); }} />
      <form className="ticket-create-dialog" aria-modal="true" role="dialog" aria-labelledby={titleId} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <header className="ticket-create-head"><div><p className="eyebrow">正式工单</p><h2 id={titleId}>编辑业务字段</h2><p>仅待受理工单可编辑标题、目标、优先级、截止时间和验收标准。</p></div><button type="button" className="ticket-create-close" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></header>
        <div className="ticket-create-body">
          <section className="ticket-create-section"><h3>业务信息</h3><div className="ticket-create-grid">
            <label className="ticket-create-field ticket-create-field-full"><span>工单标题 <i>*</i></span><input ref={titleRef} value={title} maxLength={120} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="ticket-create-field ticket-create-field-full"><span>目标</span><textarea value={goal} maxLength={4000} disabled={busy} onChange={(event) => setGoal(event.target.value)} /></label>
            <label className="ticket-create-field"><span>优先级</span><select value={priority} disabled={busy} onChange={(event) => setPriority(event.target.value)}>{PRIORITIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="ticket-create-field"><span>截止日期</span><input type="date" value={dueAt} disabled={busy} onChange={(event) => setDueAt(event.target.value)} /></label>
          </div></section>
          <section className="ticket-create-section"><h3>验收标准 <small>每行一项</small></h3><label className="ticket-create-field"><textarea value={criteria} placeholder="例如：复盘报告已归档" disabled={busy} onChange={(event) => setCriteria(event.target.value)} /></label></section>
          {error ? <p className="ticket-create-error" role="alert">{error}</p> : null}
        </div>
        <footer className="ticket-create-actions"><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="btn work" disabled={busy}>{busy ? "正在保存…" : "保存修改"}</button></footer>
      </form>
    </div>, document.body,
  );
}
