import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { PoolKol } from "./kolContract";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** L3 公海领取确认。建联 ≠ 发现入库 ingest ≠ 发信 ≠ 改阶段。 */
export default function ClaimFollowConfirm({
  card,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  card: PoolKol | null;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open = Boolean(card);
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
    <div className="discovery-confirm-layer" data-claim-follow-confirm>
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
        <strong id={titleId}>确认领取跟进？</strong>
        <div id={descId}>
          <p data-claim-object>对象：{card?.identity.display || "未指定红人"}</p>
          <p data-claim-scope>范围：从公海领取到「我跟进的红人」档案。</p>
          <p data-claim-change>变更：建立跟进归属（建联）。不会发信，也不会改正式阶段。</p>
          <p data-claim-consequence>后果：发送 ≠ 建联 ≠ 改阶段。领取成功后从公海消失，出现在跟进列表。</p>
        </div>
        {error ? (
          <p className="discovery-quiet" data-claim-follow-error role="alert">{error}</p>
        ) : null}
        <div className="discovery-plan-actions">
          <button
            type="button"
            className="btn work sm"
            data-claim-follow-yes
            data-home-entry="claim-kol"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? "正在领取…" : "确认领取"}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="btn ghost sm"
            data-claim-follow-no
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
