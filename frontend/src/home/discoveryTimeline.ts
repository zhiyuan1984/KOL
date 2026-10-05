import type { Message, RuntimeActionView } from "../api.js";

/** Flatten event snapshots before ordering; message container time is not step time. */
export function discoveryTimeline(messages: Message[], actions: RuntimeActionView[] = []): Message[] {
  const rows: Message[] = [];
  for (const message of messages) {
    if (["process_trace", "operation_trace"].includes(message.kind)) {
      const source = message.payload.timeline_events || message.payload.operations || message.payload.items;
      if (!Array.isArray(source)) continue;
      for (const [index, value] of source.entries()) {
        const item = typeof value === "string" ? { label: value } : value;
        if (!item || typeof item !== "object") continue;
        const label = String(item.label || item.summary || item.reasoning_summary || item.title || item.name || "").trim();
        if (!label) continue;
        rows.push({ ...message, id: `${message.id}:${item.id || index}`, kind: "discovery_step",
          created_at: item.recorded_at || item.observed_at, payload: { ...item, text: label, legacy: !item.observed_at,
            late: Boolean(item.recorded_at && item.observed_at && Date.parse(item.recorded_at) - Date.parse(item.observed_at) > 5000) } });
      }
    } else if (message.kind !== "job_status" && (message.kind !== "text" || message.payload.text || message.payload.streaming)) rows.push(message);
  }
  for (const action of actions) {
    rows.push({ id: `action:${action.id}`, session_id: "", role: "assistant", kind: "discovery_action", created_at: action.created_at || "",
      payload: { action_id: action.id } });
    for (const event of action.events || []) {
      if (event.source === "runtime_actions" && event.state === "pending") continue;
      rows.push({ id: `action:${action.id}:event:${event.sequence}`, session_id: "", role: "assistant",
        kind: "discovery_step", created_at: event.recorded_at,
        payload: { text: runtimeEventLabel(event.source, event.state), status: ["failed", "uncertain", "cancelled", "rejected"].includes(event.state) ? "failed" : "done" } });
    }
  }
  const seen = new Set<string>();
  const unique = rows.filter(row => !seen.has(row.id) && Boolean(seen.add(row.id)));
  const legacy = unique.filter(row => row.kind === "discovery_step" && !Number.isFinite(Date.parse(row.created_at || "")));
  const ordered = unique.filter(row => !legacy.includes(row))
    .map((row, index) => ({ row, index, time: Date.parse(row.created_at || "") }))
    .sort((a, b) => (Number.isFinite(a.time) ? a.time : 0) - (Number.isFinite(b.time) ? b.time : 0) || a.index - b.index)
    .map(({ row }) => row);
  if (legacy.length) ordered.unshift({ id: "discovery:history", session_id: "", role: "assistant", kind: "discovery_history", created_at: "", payload: { items: legacy } });
  return ordered;
}

function runtimeEventLabel(source: string, state: string): string {
  const states: Record<string, string> = source === "runtime_crawl_jobs" ? {
    starting: "正在启动资料采集", running: "开始采集公开红人资料", stopping: "正在停止资料采集",
    succeeded: "本次资料采集已结束", failed: "资料采集失败，请核对原因后重试", cancelled: "资料采集已取消",
    uncertain: "采集结果待核实，请先核对采集服务状态",
  } : { dispatching: "确认已记录，正在提交采集请求", succeeded: "采集请求已提交到采集服务",
    cancelled: "采集请求已取消", rejected: "采集请求未执行，请核对条件", uncertain: "请求结果待核实，请勿重复提交" };
  return states[state] || "业务操作状态已更新，详细说明待核对";
}
