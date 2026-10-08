import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export type DiscoveryConfirmRow = { label: string; value: ReactNode };

type DiscoveryIngestConfirmProps = {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  confirmDisabled?: boolean;
  /** 标题，默认"入库公海"。 */
  title?: string;
  /** 风险等级 chip，默认 "L3"。 */
  risk?: string;
  /** 紧凑键值明细行（替代散文段落）。 */
  rows: DiscoveryConfirmRow[];
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * L3 入库公海确认（dialog-compact 密度档）。
 * 不建联、不发信、不改阶段。信息以紧凑键值行呈现，不用散文段落。
 */
export function DiscoveryIngestConfirm({
  open,
  busy = false,
  error = null,
  confirmDisabled = false,
  title = "入库公海",
  risk = "L3",
  rows,
  confirmText = "确认入库",
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
    <div className="discovery-confirm-layer" data-density="dialog-compact" data-discovery-ingest-confirm>
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
        <div className="discovery-confirm-head">
          <strong id={titleId} className="discovery-confirm-title">{title}</strong>
          <span className="discovery-confirm-risk">{risk}</span>
        </div>
        <dl id={descId} className="discovery-confirm-rows">
          {rows.map((row) => (
            <div key={row.label} className="discovery-confirm-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        {error ? (
          <p className="discovery-confirm-error" data-discovery-ingest-error role="alert">{error}</p>
        ) : null}
        <div className="discovery-confirm-actions">
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
          <button
            type="button"
            className="btn work sm"
            data-discovery-ingest-yes
            data-home-entry="discovery-ingest"
            disabled={busy || confirmDisabled}
            onClick={() => void onConfirm()}
          >
            {busy ? "正在入库…" : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
