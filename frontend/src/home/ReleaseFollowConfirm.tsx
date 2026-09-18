import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** L3 回公海确认。释放跟进，不改正式阶段。 */
export default function ReleaseFollowConfirm({
  handle,
  open,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  handle?: string;
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
    <div className="discovery-confirm-layer" data-release-follow-confirm>
      <div
        className="discovery-confirm-backdrop"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        ref={dialogRef}
        className="discovery-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={busy || undefined}
      >
        <strong id={titleId}>确认回公海？</strong>
        <div id={descId}>
          <p data-release-object>对象：{handle ? `@${handle.replace(/^@/, "")}` : "未指定红人"}</p>
          <p data-release-scope>范围：释放「我跟进的红人」归属，档案回到公海。</p>
          <p data-release-change>变更：B.active → released。不会改正式阶段。</p>
          <p data-release-consequence>后果：回公海 ≠ 改阶段。发送记录与阶段保持原样。</p>
        </div>
        {error ? (
          <p className="discovery-quiet" data-release-follow-error role="alert">{error}</p>
        ) : null}
        <div className="discovery-plan-actions">
          <button
            type="button"
            className="btn work sm"
            data-release-follow-yes
            data-home-entry="release-follow"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? "正在释放…" : "确认释放"}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="btn ghost sm"
            data-release-follow-no
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
