import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Task reading positions are shared across routes. New output follows only a
 * reader already at the tail; an active form never loses its reading position. */
export function useWorkspaceScroll(key: string, ready: boolean, live: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const following = useRef(false);
  const restore = useRef<number | null>(null);
  const [position, setPosition] = useState({ scrollable: false, atBottom: false, updated: false });
  const liveRef = useRef(live);
  liveRef.current = live;
  useLayoutEffect(() => {
    if (!ready || !ref.current) return;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(key); } catch { /* Storage is optional. */ }
    restore.current = saved !== null && Number.isFinite(Number(saved)) ? Math.max(0, Number(saved)) : 0;
    following.current = false;
    ref.current.scrollTop = Math.min(restore.current, Math.max(0, ref.current.scrollHeight - ref.current.clientHeight));
  }, [key, ready]);
  useEffect(() => {
    if (!ready || !ref.current) return;
    const el = ref.current;
    let previousHeight = el.scrollHeight;
    let previousClientHeight = el.clientHeight;
    const threshold = () => parseFloat(getComputedStyle(el).getPropertyValue("--feed-follow-threshold")) || 48;
    const measure = (updated = false) => {
      const scrollable = el.scrollHeight > el.clientHeight + 1;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold();
      setPosition(current => {
        const changed = !atBottom && (current.updated || updated);
        return current.scrollable === scrollable && current.atBottom === atBottom && current.updated === changed
          ? current : { scrollable, atBottom, updated: changed };
      });
    };
    const save = () => { try { sessionStorage.setItem(key, String(el.scrollTop)); } catch { /* Storage is optional. */ } };
    const update = (changed = false) => {
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && el.contains(active)
        && Boolean(active.closest("input,textarea,select,a,button,summary,[contenteditable='true']"));
      if (restore.current !== null) {
        el.scrollTop = Math.min(restore.current, Math.max(0, el.scrollHeight - el.clientHeight));
        if (el.scrollTop >= restore.current) {
          following.current = (liveRef.current || restore.current > 0)
            && el.scrollHeight - el.scrollTop - el.clientHeight <= threshold();
          restore.current = null;
        }
      } else {
        // A scroll event can still be queued when an SSE mutation arrives.
        // Compare with the previous geometry so reaching the tail is honored.
        if (changed && el.scrollTop > previousTop
          && previousHeight - el.scrollTop - previousClientHeight <= threshold()) following.current = true;
        if (following.current && !editing) el.scrollTop = el.scrollHeight;
      }
      previousHeight = el.scrollHeight;
      previousClientHeight = el.clientHeight;
      measure(changed);
    };
    const intent = () => { restore.current = null; following.current = false; };
    let previousTop = el.scrollTop;
    const onScroll = () => {
      if (restore.current === null) {
        following.current = el.scrollTop >= previousTop && el.scrollHeight - el.scrollTop - el.clientHeight <= threshold();
        save();
      }
      previousTop = el.scrollTop;
      measure();
    };
    const observer = new MutationObserver(() => update(true));
    observer.observe(el, { subtree: true, childList: true, characterData: true });
    const resize = new ResizeObserver(() => update());
    resize.observe(el);
    if (el.firstElementChild) resize.observe(el.firstElementChild);
    el.addEventListener("scroll", onScroll);
    el.addEventListener("wheel", intent, { passive: true });
    el.addEventListener("touchstart", intent, { passive: true });
    el.addEventListener("pointerdown", intent); el.addEventListener("keydown", intent);
    update();
    return () => {
      observer.disconnect(); resize.disconnect();
      el.removeEventListener("scroll", onScroll); el.removeEventListener("wheel", intent);
      el.removeEventListener("touchstart", intent); el.removeEventListener("pointerdown", intent);
      el.removeEventListener("keydown", intent);
    };
  }, [key, ready]);
  const jump = (top: boolean) => {
    if (!ref.current) return;
    restore.current = null; following.current = !top;
    ref.current.scrollTo({ top: top ? 0 : ref.current.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setPosition(current => ({ ...current, updated: false }));
  };
  const reveal = (target?: HTMLElement, animate = true) => {
    const el = ref.current;
    if (!el) return;
    restore.current = null; following.current = false;
    const head = el.querySelector<HTMLElement>(".task-result-head,[data-discovery-run-status]");
    const offset = target ? target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - (head?.offsetHeight || 0) : 0;
    el.scrollTo({ top: Math.max(0, offset), behavior: !animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
  };
  return { ref, position, jump, reveal };
}
