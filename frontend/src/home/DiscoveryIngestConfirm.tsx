import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

type DiscoveryIngestConfirmProps = {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  confirmDisabled?: boolean;
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

/** L3 入库公海确认。不建联、不发信、不改阶段。 */
export function DiscoveryIngestConfirm({
  open,
  busy = false,
  error = null,
  confirmDisabled = false,
  children,
  onConfirm,
  onCancel,
}: DiscoveryIngestConfirmProps) {
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
    <div className="discovery-confirm-layer" data-discovery-ingest-confirm>
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
        <strong id={titleId}>确认入库公海？</strong>
        <div id={descId}>{children}</div>
        {error ? (
          <p className="discovery-quiet" data-discovery-ingest-error role="alert">{error}</p>
        ) : null}
        <div className="discovery-plan-actions">
          <button
            type="button"
            className="btn work sm"
            data-discovery-ingest-yes
            data-home-entry="ingest-to-pool"
            disabled={busy || confirmDisabled}
            onClick={() => void onConfirm()}
          >
            {busy ? "正在入库…" : "确认入库公海"}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="btn ghost sm"
            data-discovery-ingest-no
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
