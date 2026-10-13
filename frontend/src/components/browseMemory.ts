import type { RefObject } from "react";
import { useEffect, useRef } from "react";

export function readBrowseMemory<T>(userId: string, page: string): Partial<T> {
  try {
    const value = userId ? JSON.parse(sessionStorage.getItem(`asset-browse:${userId}:${page}`) || "{}") : {};
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
export function useBrowseMemory<T>(userId: string, page: string, state: T, listRef: RefObject<HTMLElement | null>, ready: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    if (!userId || !ready || restored.current || !listRef.current) return;
    const memory = readBrowseMemory<{ scrollTop: number }>(userId, page);
    requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = memory.scrollTop || 0; });
    restored.current = true;
  }, [userId, page, ready]);
  useEffect(() => {
    if (!userId || !ready) return;
    const list = listRef.current;
    const save = () => {
      try { sessionStorage.setItem(`asset-browse:${userId}:${page}`, JSON.stringify({ ...state, scrollTop: list?.scrollTop || 0 })); } catch { /* Browser storage unavailable; current page remains usable. */ }
    };
    list?.addEventListener("scroll", save, { passive: true }); save();
    return () => { save(); list?.removeEventListener("scroll", save); };
  }, [userId, page, state, ready]);
}
