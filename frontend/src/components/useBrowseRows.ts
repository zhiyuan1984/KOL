import { useEffect, useRef, useState } from "react";

/** Fill the available viewport with already-fetched records; expanding causes no fake I/O. */
export function useBrowseRows(resetKey: string, restoredLimit = 0, ready = true) {
  const listRef = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState(5);
  const [limit, setLimit] = useState(restoredLimit || 5);
  useEffect(() => {
    const list = listRef.current;
    if (!list || !ready) return;
    const measure = () => {
      if (!list.clientHeight) return;
      const tools = toolbarRef.current?.getBoundingClientRect().height || 0;
      const rowHeight = Number.parseFloat(getComputedStyle(list).getPropertyValue("--knowledge-row-h")) || 36;
      const size = Math.max(1, Math.floor((list.clientHeight - tools - rowHeight) / rowHeight));
      setPageSize(size); setLimit(current => Math.max(current, size));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    measure(); return () => observer.disconnect();
  }, [ready]);
  useEffect(() => { if (ready) setLimit(Math.max(pageSize, restoredLimit)); }, [resetKey]);
  return { listRef, toolbarRef, limit, pageSize, more: () => setLimit(current => current + pageSize) };
}
