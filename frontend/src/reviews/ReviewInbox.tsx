import { useEffect, useState } from "react";
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
    [error, setError] = useState("");
  async function load() {
    try {
      setRows(await reviewApi<Notice[]>("/approvals/v2/notifications"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [refreshKey]);
  return (
    <details>
      <summary>
        站内通知
        {rows.filter((r) => !r.read_at).length
          ? ` · ${rows.filter((r) => !r.read_at).length} 条未读`
          : ""}
      </summary>
      {error && (
        <p role="alert">
          {error}
          <button onClick={load}>重试通知加载</button>
        </p>
      )}
      {!rows.length && !error && <p>暂无站内通知</p>}
      <ul className="review-list">
        {rows.map((n) => (
          <li key={n.id}>
            <span>{n.read_at ? "已读" : "未读"}</span>
            <button
              onClick={async () => {
                try {
                  await onOpen(n.instance_id);
                  await reviewApi(
                    `/approvals/v2/notifications/${n.id}/read`,
                    {},
                  );
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {n.message}
            </button>
            <time>{new Date(n.created_at).toLocaleString()}</time>
          </li>
        ))}
      </ul>
    </details>
  );
}
