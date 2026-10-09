import { useCallback, useContext, useEffect, useRef } from "react";
import { UNSAFE_DataRouterContext, useNavigate, type NavigateOptions, type To } from "react-router-dom";
import { TASK_DRAFT_DISCARD_MESSAGE } from "../tasks/TaskDetailLeaveBlocker";
type LeaveGuardOptions = { dirty: boolean; busy: boolean };
function historyIndex() {
  return typeof window !== "undefined" && typeof window.history.state?.idx === "number" ? window.history.state.idx as number : null;
}
/** Local protection: use the existing data router when present, never migrate the app router. */
export function useTaskDetailLeaveGuard({ dirty, busy }: LeaveGuardOptions) {
  const navigate = useNavigate();
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const approvedNavigation = useRef(false);
  const dirtyRef = useRef(dirty), busyRef = useRef(busy);
  const restoringHistoryRef = useRef(false), protectedIndex = useRef<number | null>(historyIndex());
  dirtyRef.current = dirty; busyRef.current = busy;
  const needsProtection = useCallback(() => dirtyRef.current || busyRef.current, []);
  const confirmDiscard = useCallback(() => !busyRef.current && window.confirm(TASK_DRAFT_DISCARD_MESSAGE), []);
  useEffect(() => {
    if (!needsProtection()) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [needsProtection, dirty, busy]);
  useEffect(() => {
    if (dataRouter || !needsProtection()) return;
    protectedIndex.current = historyIndex();
    const handler = (event: PopStateEvent) => {
      if (!needsProtection()) return;
      if (restoringHistoryRef.current) { restoringHistoryRef.current = false; return; }
      if (busyRef.current || !confirmDiscard()) {
        event.stopImmediatePropagation();
        restoringHistoryRef.current = true;
        const next = typeof event.state?.idx === "number" ? event.state.idx as number : null;
        const delta = protectedIndex.current != null && next != null ? protectedIndex.current - next : 1;
        window.history.go(delta || 1);
      } else protectedIndex.current = historyIndex();
    };
    window.addEventListener("popstate", handler, true);
    return () => window.removeEventListener("popstate", handler, true);
  }, [confirmDiscard, needsProtection, dirty, busy, dataRouter]);
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!needsProtection() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.dataset.taskDetailLeaveManaged === "true" || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname && url.search === window.location.search && url.hash === window.location.hash) return;
      event.preventDefault(); event.stopPropagation();
      if (busyRef.current || !confirmDiscard()) return;
      approvedNavigation.current = true;
      navigate(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [confirmDiscard, navigate, needsProtection]);
  const onManagedLeave = useCallback((event: { preventDefault: () => void; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }, to: To, options?: NavigateOptions) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button != null && event.button !== 0 || !needsProtection()) return;
    event.preventDefault();
    if (busyRef.current || !confirmDiscard()) return;
    approvedNavigation.current = true;
    navigate(to, options);
  }, [confirmDiscard, navigate, needsProtection]);
  return { busy, blockerProps: { dirty, busy, approvedNavigation }, managedLinkProps: { "data-task-detail-leave-managed": "true" as const }, onManagedLeave };
}
