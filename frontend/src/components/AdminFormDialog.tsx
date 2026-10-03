import { useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useFocusLock } from "../hooks/useFocusLock";

/**
 * 治理页居中表单弹窗：scrim + 居中面板，Escape / 遮罩关闭，焦点锁在弹窗内，
 * 与 AdminTextDialog、employee-dialog 同一做法；不引新库。
 */
export function AdminFormDialog({
  open,
  title,
  subtitle,
  children,
  footer,
  error = "",
  busy = false,
  initialFocusRef,
  closeLabel = "关闭",
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
  error?: string;
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeLabel?: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const close = () => {
    if (!busy) onClose();
  };

  useFocusLock({
    open,
    rootRef: panelRef,
    initialRef: initialFocusRef,
    onEscape: close,
    lockBody: true,
    restore: true,
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="governance-modal-layer">
      <div className="governance-modal-backdrop" onClick={close} />
      <section
        ref={panelRef}
        className="governance-modal"
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        aria-labelledby={titleId}
      >
        <header className="governance-modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          <button type="button" className="governance-minor" aria-label="关闭弹窗" disabled={busy} onClick={close}>{closeLabel}</button>
        </header>
        <div className="governance-modal-body">
          {error ? <p className="error" role="alert">{error}</p> : null}
          {children}
        </div>
        <footer className="governance-modal-foot">{footer}</footer>
      </section>
    </div>,
    document.body,
  );
}
