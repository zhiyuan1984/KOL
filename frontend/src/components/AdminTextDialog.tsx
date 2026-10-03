import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ADMIN_CANCEL_HINT, ADMIN_CANCEL_LABEL } from "../adminConfirm";
import { useFocusLock } from "../hooks/useFocusLock";

/**
 * 单字段文本弹窗：改名、版本说明、负责人等自由输入。
 * 事实变更确认与原因门禁仍走 ConfirmDialog；本组件只承担输入，不做 L3 说明。
 */
export function AdminTextDialog({
  open,
  title,
  description,
  label,
  value,
  placeholder,
  required = false,
  multiline = false,
  confirmLabel = "保存",
  cancelLabel = ADMIN_CANCEL_LABEL,
  hint,
  busy = false,
  error = "",
  onChange,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  hint?: string;
  busy?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const close = () => {
    if (!busy) onCancel();
  };

  useFocusLock({
    open,
    rootRef: dialogRef,
    initialRef: multiline ? textareaRef : inputRef,
    onEscape: close,
    lockBody: true,
    restore: true,
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="admin-confirm-layer" data-admin-text-dialog="">
      <div className="admin-confirm-backdrop" onClick={close} />
      <div
        ref={dialogRef}
        className="admin-confirm governance-text-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{title}</h2>
        {description ? <p className="muted">{description}</p> : null}
        <label className="admin-confirm-reason field">
          {label}
          {multiline ? (
            <textarea
              ref={textareaRef}
              data-admin-text-input
              value={value}
              placeholder={placeholder}
              rows={3}
              disabled={busy}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : (
            <input
              ref={inputRef}
              data-admin-text-input
              className="governance-text-input"
              type="text"
              value={value}
              placeholder={placeholder}
              disabled={busy}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </label>
        <p className="admin-confirm-cancel-hint muted">{hint || ADMIN_CANCEL_HINT}</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="admin-confirm-actions">
          <button type="button" className="btn" data-admin-text-cancel disabled={busy} onClick={close}>{cancelLabel}</button>
          <button
            type="button"
            className="btn work"
            data-admin-text-confirm
            disabled={busy || (required && !value.trim())}
            onClick={() => void onConfirm()}
          >
            {busy ? "执行中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
