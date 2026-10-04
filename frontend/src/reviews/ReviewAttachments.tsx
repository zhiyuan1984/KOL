import { useEffect, useState } from "react";
import { reviewApi, reviewCompany, reviewHeaders } from "./api";
const url = (id: string, instanceId?: string) => {
  const q = new URLSearchParams();
  if (instanceId) q.set("instanceId", instanceId);
  if (reviewCompany()) q.set("company", reviewCompany());
  return `/api/approvals/v2/attachments/${encodeURIComponent(id)}${q.size ? "?" + q : ""}`;
};
export function AttachmentLinks({
  ids,
  instanceId,
}: {
  ids: string[];
  instanceId?: string;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    Promise.all(
      ids.map(async (id) => {
        const u = url(id, instanceId);
        try {
          const m = await reviewApi<{ name: string }>(
            `${u.slice(4)}${u.includes("?") ? "&" : "?"}metadata=1`,
          );
          return [id, m.name];
        } catch {
          return [id, `附件 ${id}（读取失败，可重试下载）`];
        }
      }),
    ).then((pairs) => {
      if (live) setNames(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [ids.join(","), instanceId]);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>
          <a href={url(id, instanceId)}>{names[id] || `附件 ${id}`}</a>
        </li>
      ))}
    </ul>
  );
}
export function AttachmentInput({
  ids,
  onChange,
  disabled,
  onBusy,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <span className="review-form">
      <input
        type="file"
        disabled={disabled || busy || ids.length >= 10}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          e.target.value = "";
          setError("");
          if (file.size > 2 * 1024 * 1024 || !file.size) {
            setError("请选择不超过 2 MiB 的非空文件");
            return;
          }
          setBusy(true);
          onBusy?.(true);
          try {
            const body = new FormData();
            body.set("file", file);
            const response = await fetch("/api/approvals/v2/attachments", {
              method: "POST",
              credentials: "same-origin",
              headers: reviewHeaders(),
              body,
            });
            const data = await response.json();
            if (!response.ok)
              throw Error(
                typeof data.detail === "string"
                  ? data.detail
                  : data.detail?.message || "上传失败",
              );
            onChange([...ids, data.id]);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
            onBusy?.(false);
          }
        }}
      />
      <small>单个文件最多 2 MiB，每字段最多 10 个；上传完成后才能提交。</small>
      {busy && <span role="status">正在上传并保存附件…</span>}
      {error && <span role="alert">{error}</span>}
      <AttachmentLinks ids={ids} />
      {ids.map((id, index) => (
        <button
          key={id}
          type="button"
          disabled={disabled || busy}
          onClick={() => onChange(ids.filter((x) => x !== id))}
        >
          移除附件 {index + 1}（仅从本草稿移除）
        </button>
      ))}
    </span>
  );
}
