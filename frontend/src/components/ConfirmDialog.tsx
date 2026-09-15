import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AdminConfirmCopy } from "../adminConfirm";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export type AskAdminConfirm = (copy: AdminConfirmCopy, run: (reason: string) => Promise<void>) => void;

type ConfirmDialogProps = AdminConfirmCopy & {
  open: boolean;
  busy?: boolean;
  error?: string;
  cancelLabel?: string;
  reason?: string;
  onReasonChange?: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  kind,
  title,
  object,
  scope,
  consequence,
  confirmLabel,
  cancelLabel = "取消",
  requireReason = false,
  reasonLabel = "原因",
  reasonPlaceholder = "填写原因",
  reason = "",
  busy = false,
  error = "",
  onReasonChange,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    returnFocusRef.current = prev instanceof HTMLElement ? prev : null;
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
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
        onCancel();
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
  }, [open, busy, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="admin-confirm-layer" data-admin-confirm={kind} data-risk="L3">
      <div
        className="admin-confirm-backdrop"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        ref={dialogRef}
        className="admin-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId}>{title}</h2>
        <dl id={descId} className="admin-confirm-facts">
          <div>
            <dt>对象</dt>
            <dd data-admin-confirm-object>{object}</dd>
          </div>
          <div>
            <dt>范围</dt>
            <dd data-admin-confirm-scope>{scope}</dd>
          </div>
          <div>
            <dt>后果</dt>
            <dd data-admin-confirm-consequence>{consequence}</dd>
          </div>
        </dl>
        {requireReason ? (
          <label className="admin-confirm-reason field">
            {reasonLabel}
            <textarea
              data-admin-confirm-reason
              value={reason}
              placeholder={reasonPlaceholder}
              rows={3}
              disabled={busy}
              onChange={(event) => onReasonChange?.(event.target.value)}
            />
          </label>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="admin-confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn"
            data-admin-confirm-cancel
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn danger"
            data-admin-confirm-ok
            disabled={busy || (requireReason && !reason.trim())}
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

export function useAdminConfirm(): { ask: AskAdminConfirm; dialog: ReactNode } {
  const [pending, setPending] = useState<(AdminConfirmCopy & { run: (reason: string) => Promise<void> }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");

  const ask: AskAdminConfirm = (copy, run) => {
    setError("");
    setReason("");
    setPending({ ...copy, run });
  };

  const dialog = (
    <ConfirmDialog
      open={Boolean(pending)}
      kind={pending?.kind || "user-deactivate"}
      title={pending?.title || ""}
      object={pending?.object || ""}
      scope={pending?.scope || ""}
      consequence={pending?.consequence || ""}
      confirmLabel={pending?.confirmLabel || "确认"}
      requireReason={pending?.requireReason}
      reasonLabel={pending?.reasonLabel}
      reasonPlaceholder={pending?.reasonPlaceholder}
      reason={reason}
      onReasonChange={setReason}
      busy={busy}
      error={error}
      onCancel={() => {
        if (busy) return;
        if (pending?.requireReason && !reason.trim()) {
          setError(pending.reasonLabel || "请填写原因");
          return;
        }
        setPending(null);
        setError("");
        setReason("");
      }}
      onConfirm={async () => {
        if (!pending || busy) return;
        if (pending.requireReason && !reason.trim()) {
          setError(pending.reasonLabel || "请填写原因");
          return;
        }
        setBusy(true);
        setError("");
        try {
          await pending.run(reason.trim());
          setPending(null);
          setReason("");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    />
  );

  return { ask, dialog };
}
