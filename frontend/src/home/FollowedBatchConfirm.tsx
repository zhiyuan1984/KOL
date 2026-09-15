import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { formatStageBadge, type FollowedKolCardModel } from "../followedKolCard";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

type FollowedBatchConfirmProps = {
  open: boolean;
  cards: FollowedKolCardModel[];
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Clear multi confirm before opening existing per-item L3 ConfirmStage. SEND≠STAGE. */
export function FollowedBatchConfirm({
  open,
  cards,
  busy = false,
  onConfirm,
  onCancel,
}: FollowedBatchConfirmProps) {
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
    <div
      className="discovery-confirm-layer"
      data-followed-batch-confirm-dialog
      data-risk="L3"
    >
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
        <strong id={titleId}>确认进入建议阶段？</strong>
        <div id={descId}>
          <p>将为以下跟进对象打开阶段确认。不会发信。发送与改阶段分开。</p>
          <ul className="followed-batch-confirm-list" data-followed-batch-confirm-list>
            {cards.map((card) => (
              <li key={card.id} data-followed-batch-item={card.id}>
                {card.identity.display}
                {" → "}
                {formatStageBadge(card.recommended_action.target_stage_label || "")}
              </li>
            ))}
          </ul>
        </div>
        <div className="discovery-plan-actions">
          <button
            type="button"
            className="btn work sm followed-batch-cta"
            data-followed-batch-confirm-yes
            disabled={busy || !cards.length}
            onClick={() => void onConfirm()}
          >
            {busy ? "正在打开…" : "打开阶段确认"}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="btn ghost sm"
            data-followed-batch-confirm-no
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
