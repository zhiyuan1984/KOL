import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Task } from "../api";
import { taskValue } from "./homeModel";
import { waitStatusLabel } from "../waitStatus";
import "./edit-task-dialog.css";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

const STATUS_OPTIONS: Array<{ value: string; label: string; disabled?: boolean; hint?: string }> = [
  { value: "pending", label: "未开始" },
  { value: "running", label: "进行中" },
  { value: "completed", label: "完成" },
  { value: "cancelled", label: "取消" },
  { value: "failed", label: "失败" },
  { value: "overdue", label: "延期", disabled: true, hint: "由截止日期派生" },
  { value: "due_soon", label: "临期", disabled: true, hint: "由截止日期派生" },
];
const SELECTABLE_STATUS = new Set(["pending", "running", "completed", "cancelled", "failed"]);

const PRIORITY_OPTIONS = [
  { value: "important_urgent", label: "重要紧急" },
  { value: "important", label: "重要" },
  { value: "urgent", label: "紧急" },
  { value: "normal", label: "中" },
  { value: "low", label: "低" },
] as const;
const PRIORITY_LABEL_TO_CODE: Record<string, string> = {
  重要紧急: "important_urgent",
  重要: "important",
  紧急: "urgent",
  中: "normal",
  低: "low",
};

const RISK_OPTIONS = [
  { value: "none", label: "无" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
] as const;

function dateInputValue(value?: string | null): string {
  const match = String(value || "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function initialStatusCode(task: Task): string {
  const display = String(task.display_status || "").trim();
  if (display === "overdue" || display === "due_soon") return display;
  if (display === "in_progress") return "running";
  if (display === "not_started") return "pending";
  if (display === "completed" || display === "cancelled" || display === "failed") return display;
  const status = String(task.status || "").trim();
  if (SELECTABLE_STATUS.has(status)) return status;
  return status || "pending";
}

function initialPriority(task: Task): string {
  const code = String(task.priority || "").trim();
  if (PRIORITY_OPTIONS.some((option) => option.value === code)) return code;
  const fromLabel = PRIORITY_LABEL_TO_CODE[String(task.priority_label || "").trim()];
  if (fromLabel) return fromLabel;
  if (code === "high") return "important";
  if (code === "medium") return "normal";
  return "normal";
}

function initialRisk(task: Task): string {
  const level = String(task.risk_level || "none").trim();
  return RISK_OPTIONS.some((option) => option.value === level) ? level : "none";
}

export default function EditTaskDialog({
  task,
  onClose,
  onSaved,
}: {
  task: Task | null;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  const open = Boolean(task);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const initial = useMemo(() => ({
    title: String(task?.title || ""),
    content: String(task?.content ?? task?.description ?? ""),
    status: task ? initialStatusCode(task) : "pending",
    priority: task ? initialPriority(task) : "normal",
    risk_level: task ? initialRisk(task) : "none",
    start_date: dateInputValue(task?.start_date),
    due_at: dateInputValue(task?.due_at),
  }), [task]);

  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [status, setStatus] = useState(initial.status);
  const [priority, setPriority] = useState(initial.priority);
  const [riskLevel, setRiskLevel] = useState(initial.risk_level);
  const [startDate, setStartDate] = useState(initial.start_date);
  const [dueAt, setDueAt] = useState(initial.due_at);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(initial.title);
    setContent(initial.content);
    setStatus(initial.status);
    setPriority(initial.priority);
    setRiskLevel(initial.risk_level);
    setStartDate(initial.start_date);
    setDueAt(initial.due_at);
    setBusy(false);
    setError("");
  }, [initial]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    returnFocusRef.current = prev instanceof HTMLElement ? prev : null;
    const frame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      const node = returnFocusRef.current;
      if (node && node.isConnected) node.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (busy) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const statusOptions = useMemo(() => {
    if (STATUS_OPTIONS.some((option) => option.value === status)) return STATUS_OPTIONS;
    return [
      { value: status, label: `${waitStatusLabel(status)}（当前状态）`, disabled: true },
      ...STATUS_OPTIONS,
    ];
  }, [status]);

  if (!open || !task || typeof document === "undefined") return null;

  const fields: Record<string, string | null> = {};
  if (title.trim() !== initial.title.trim()) fields.title = title.trim();
  if (content !== initial.content) fields.content = content;
  if (status !== initial.status && SELECTABLE_STATUS.has(status)) fields.status = status;
  if (priority !== initial.priority) fields.priority = priority;
  if (riskLevel !== initial.risk_level) fields.risk_level = riskLevel;
  if (startDate !== initial.start_date) fields.start_date = startDate || null;
  if (dueAt !== initial.due_at) fields.due_at = dueAt || null;
  const formDirty = Object.keys(fields).length > 0;

  const fail = (cause: unknown) => {
    const err = cause as Error & { status?: number; payload?: unknown };
    if (err.name === "AbortError" || /timed? ?out|abort/i.test(String(err.message || ""))) {
      setError("请求超时，请检查网络后重试。");
      return;
    }
    setError(err.message || "保存失败，请稍后重试。");
  };

  const submitForm = async () => {
    if (!title.trim()) {
      setError("标题不能为空。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = taskValue(await api.updateTask(task.id, fields));
      onSaved(updated);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="edit-task-layer" data-edit-task-dialog>
      <div
        className="edit-task-backdrop"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={dialogRef}
        className="edit-task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
      >
        <strong id={titleId} className="edit-task-title">编辑任务</strong>
        <div className="edit-task-field">
          <label htmlFor="edit-task-title">标题</label>
          <input
            id="edit-task-title"
            ref={firstFieldRef}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="edit-task-field">
          <label htmlFor="edit-task-content">任务内容</label>
          <textarea
            id="edit-task-content"
            rows={3}
            value={content}
            disabled={busy}
            onChange={(event) => setContent(event.target.value)}
          />
        </div>
        <RadioBlock
          legend="状态"
          value={status}
          disabled={busy}
          options={statusOptions}
          onChange={setStatus}
        />
        <RadioBlock
          legend="优先级"
          value={priority}
          disabled={busy}
          options={PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={setPriority}
        />
        <RadioBlock
          legend="风险等级"
          value={riskLevel}
          disabled={busy}
          options={RISK_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={setRiskLevel}
        />
        <div className="edit-task-grid">
          <div className="edit-task-field">
            <label htmlFor="edit-task-start">开始日期</label>
            <input
              id="edit-task-start"
              type="date"
              value={startDate}
              disabled={busy}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="edit-task-field">
            <label htmlFor="edit-task-due">结束日期</label>
            <input
              id="edit-task-due"
              type="date"
              value={dueAt}
              disabled={busy}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
        </div>
        {error ? <p className="edit-task-error" role="alert">{error}</p> : null}
        <div className="edit-task-actions">
          <button
            type="button"
            className="btn work sm"
            data-edit-task-save
            disabled={busy || !formDirty}
            onClick={() => void submitForm()}
          >
            {busy ? "正在保存…" : "保存修改"}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            data-edit-task-cancel
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RadioBlock({
  legend,
  value,
  options,
  disabled,
  onChange,
}: {
  legend: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="edit-task-radios" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="edit-task-radio-row">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <label
              key={option.value}
              className={"edit-task-radio" + (on ? " is-on" : "") + (option.disabled ? " is-disabled" : "")}
            >
              <input
                type="radio"
                name={legend}
                value={option.value}
                checked={on}
                disabled={disabled || option.disabled}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
