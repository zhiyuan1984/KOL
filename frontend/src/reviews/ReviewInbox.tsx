import { useEffect, useId, useRef, useState } from "react";
import { reviewApi } from "./api";
type Notice = {
  id: string;
  instance_id: string;
  message: string;
  created_at: string;
  read_at: string | null;
};
export function ReviewInbox({
  refreshKey,
  onOpen,
}: {
  refreshKey: string;
  onOpen: (id: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<Notice[]>([]),
    [error, setError] = useState(""), [unreadCount, setUnreadCount] = useState<number>(),
    [open, setOpen] = useState(false), [loading, setLoading] = useState(true), [opening, setOpening] = useState("");
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), request = useRef(0);
  const panelId = useId();
  async function load() {
    const current = ++request.current; setLoading(true);
    try {
      const inbox = await reviewApi<{ items: Notice[]; unreadCount: number }>("/approvals/v2/notifications/inbox");
      if (current !== request.current) return;
      setRows(inbox.items); setUnreadCount(inbox.unreadCount); setError("");
    } catch (e) {
      if (current === request.current) setError((e as Error).message);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => { ++request.current; };
  }, [refreshKey]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const label = `站内通知${unreadCount === undefined ? "，未读数待加载" : `，${unreadCount} 条未读`}${error ? "，加载失败" : ""}`;
  return (
    <div className="review-inbox" ref={root}>
      <button type="button" ref={trigger} className="review-inbox-trigger" aria-label={label} title={label} aria-expanded={open} aria-controls={panelId}
        onClick={() => { setOpen(!open); if (!open) void load(); }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unreadCount !== undefined && unreadCount > 0 && <span className="review-inbox-badge" aria-hidden="true">{unreadCount}</span>}
        {error && <span className="review-inbox-warning" aria-hidden="true">!</span>}
      </button>
      {open && <section className="review-inbox-panel" id={panelId} aria-label="站内通知列表" aria-busy={loading}>
      <header className="review-toolbar"><h2>站内通知</h2><button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>关闭通知</button></header>
      {loading && <p role="status">正在读取站内通知…</p>}
      {error && (
        <p role="alert">
          {error}
          <button onClick={load}>重试通知加载</button>
        </p>
      )}
      {!loading && !rows.length && !error && <p>暂无站内通知</p>}
      {rows.length === 100 && <p className="review-muted">显示最近 100 条通知；铃铛角标为全部未读数。</p>}
      <ul className="review-list">
        {rows.map((n) => (
          <li key={n.id}>
            <span>{n.read_at ? "已读" : "未读"}</span>
            <button
              disabled={Boolean(opening)}
              onClick={async () => {
                setOpening(n.id);
                try {
                  await onOpen(n.instance_id);
                  await reviewApi(
                    `/approvals/v2/notifications/${n.id}/read`,
                    {},
                  );
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setOpening("");
                }
              }}
            >
              {opening === n.id ? "正在打开审批…" : n.message}
            </button>
            <time>{new Date(n.created_at).toLocaleString()}</time>
          </li>
        ))}
      </ul>
      </section>}
    </div>
  );
}
