import { useEffect, type RefObject } from "react";

export const FOCUSABLE_SELECTOR =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Move focus in, Tab-trap, optional Escape / body scroll lock, restore on close. */
export function useFocusLock({
  open,
  rootRef,
  initialRef,
  onEscape,
  lockBody = false,
  restore = true,
  enabled = true,
}: {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  initialRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  lockBody?: boolean;
  restore?: boolean;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!open || !enabled) return;
    const prev = document.activeElement;
    const returnNode = prev instanceof HTMLElement ? prev : null;
    const frame = window.requestAnimationFrame(() => {
      const initial = initialRef?.current;
      if (initial) initial.focus();
      else focusablesIn(rootRef.current)[0]?.focus();
    });
    const overflow = document.body.style.overflow;
    if (lockBody) document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      if (lockBody) document.body.style.overflow = overflow;
      if (restore && returnNode?.isConnected) returnNode.focus();
    };
  }, [open, enabled, lockBody, restore, initialRef, rootRef]);

  useEffect(() => {
    if (!open || !enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!onEscape) return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusablesIn(rootRef.current);
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
  }, [open, enabled, onEscape, rootRef]);
}
