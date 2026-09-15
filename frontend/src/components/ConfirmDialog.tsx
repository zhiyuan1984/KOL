import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ADMIN_CANCEL_HINT, ADMIN_CANCEL_LABEL, type AdminConfirmCopy, type AdminConfirmFocus, type AdminConfirmTone } from "../adminConfirm";
import { useFocusLock } from "../hooks/useFocusLock";

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

function isApprovalKind(kind: string) {
  return kind === "approval-approve" || kind === "approval-reject";
}

export function ConfirmDialog({
  open,
  kind,
  title,
  object,
  scope,
  consequence,
  confirmLabel,
  cancelLabel = ADMIN_CANCEL_LABEL,
  cancelHint,
  requireReason = false,
  reasonLabel = "原因",
  reasonPlaceholder = "填写原因",
  reason = "",
  confirmTone = "danger",
  initialFocus,
  busy = false,
  error = "",
  onReasonChange,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const approval = isApprovalKind(kind);
  const focus: AdminConfirmFocus = initialFocus || (requireReason ? "reason" : "cancel");
  const initialRef = focus === "confirm" ? confirmRef : focus === "reason" ? reasonRef : cancelRef;
  const tone: AdminConfirmTone = confirmTone;
  const close = () => {
    if (!busy) onCancel();
  };

  useFocusLock({
    open,
    rootRef: dialogRef,
    initialRef,
    onEscape: close,
    lockBody: true,
    restore: true,
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="admin-confirm-layer" data-admin-confirm={kind} data-risk="L3">
      <div className="admin-confirm-backdrop" onClick={close} />
      <div
        ref={dialogRef}
        className="admin-confirm"
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-approval-confirm={approval ? "" : undefined}
        data-approval-confirm-decision={kind === "approval-reject" ? "reject" : kind === "approval-approve" ? "approve" : undefined}
      >
        <h2 id={titleId}>{title}</h2>
        <dl id={descId} className="admin-confirm-facts">
          <div>
            <dt>对象</dt>
            <dd data-admin-confirm-object data-approval-confirm-object={approval ? "" : undefined}>{object}</dd>
          </div>
          <div>
            <dt>范围</dt>
            <dd data-admin-confirm-scope data-approval-confirm-scope={approval ? "" : undefined}>{scope}</dd>
          </div>
          <div>
            <dt>后果</dt>
            <dd data-admin-confirm-consequence data-approval-confirm-consequence={approval ? "" : undefined}>{consequence}</dd>
          </div>
        </dl>
        {requireReason ? (
          <label className="admin-confirm-reason field">
            {reasonLabel}
            <textarea
              ref={reasonRef}
              name={kind === "approval-reject" ? "reject_reason" : undefined}
              data-admin-confirm-reason
              value={reason}
              placeholder={reasonPlaceholder}
              rows={3}
              disabled={busy}
              onChange={(event) => onReasonChange?.(event.target.value)}
            />
          </label>
        ) : null}
        <p className="admin-confirm-cancel-hint muted" data-admin-confirm-cancel-hint>
          {cancelHint
            || (requireReason
              ? "取消只关闭确认，不会写入。确认这条关闭路径才需要填写原因。"
              : ADMIN_CANCEL_HINT)}
        </p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="admin-confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn"
            data-admin-confirm-cancel
            data-approval-confirm-no={approval ? "" : undefined}
            disabled={busy}
            onClick={close}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={tone === "primary" ? "btn primary" : tone === "work" ? "btn work" : "btn danger"}
            data-admin-confirm-ok
            data-approval-confirm-yes={approval ? "" : undefined}
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

export function useAdminConfirm(): { ask: AskAdminConfirm; dialog: ReactNode; open: boolean } {
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
      cancelLabel={pending?.cancelLabel}
      cancelHint={pending?.cancelHint}
      requireReason={pending?.requireReason}
      reasonLabel={pending?.reasonLabel}
      reasonPlaceholder={pending?.reasonPlaceholder}
      confirmTone={pending?.confirmTone}
      initialFocus={pending?.initialFocus}
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

  return { ask, dialog, open: Boolean(pending) };
}
