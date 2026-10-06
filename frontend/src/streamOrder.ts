import type { Message } from "./api";

/**
 * 中栏时间流的排序键：一条条目「最后一次有新内容」的时刻。
 * 原地更新的流式回答与状态行带 Host 写的 `updated_at`；处理过程与系统能力调用
 * 取其中最晚出现的一步；其余条目按创建时间。没有可用时间的条目（会话开头的
 * 上下文）排在最前。
 */
export function streamTime(message: Message): number {
  const payload = (message.payload || {}) as Record<string, unknown>;
  const updated = Date.parse(String(payload.updated_at || ""));
  if (Number.isFinite(updated)) return updated;
  if (message.kind === "process_trace" || message.kind === "operation_trace") {
    const steps = [payload.items, payload.phases, payload.operations]
      .flatMap((value) => (Array.isArray(value) ? value : []));
    let latest = Number.NaN;
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const at = Date.parse(String((step as Record<string, unknown>).observed_at || ""));
      if (Number.isFinite(at) && !(at <= latest)) latest = at;
    }
    if (Number.isFinite(latest)) return latest;
  }
  const created = Date.parse(String(message.created_at || ""));
  return Number.isFinite(created) ? created : 0;
}

/** 稳定排序：同一时刻保持原有先后（Host 返回顺序）。 */
export function orderStream(rows: Message[]): Message[] {
  return rows
    .map((row, index) => ({ row, index, time: streamTime(row) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ row }) => row);
}
