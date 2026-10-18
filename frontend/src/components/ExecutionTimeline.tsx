import type { Message, ProcessTraceItem } from "../api";

export type ExecutionEntry = ProcessTraceItem & { id: string; label: string };

/** Project actual observations, not the skill's expected-step template. */
export function executionEntries(messages: Message[]): ExecutionEntry[] {
  const entries = new Map<string, ExecutionEntry>();
  for (const message of messages) {
    if (!["process_trace", "operation_trace"].includes(message.kind)) continue;
    const source = message.payload.items || message.payload.phases || [];
    if (!Array.isArray(source)) continue;
    for (const [index, raw] of source.entries()) {
      const item = raw as ProcessTraceItem;
      if (item.kind === "host" || item.kind === "result") continue;
      const id = `${message.id}:${item.id || index}`;
      entries.set(id, { ...item, id, label: String(item.label || item.summary || item.reasoning_summary || item.title || ""),
        kind: item.kind || (message.kind === "operation_trace" ? "business_step" : "milestone"),
        observed_at: item.observed_at || message.created_at });
    }
  }
  return [...entries.values()].sort((a, b) => Date.parse(a.observed_at || "") - Date.parse(b.observed_at || ""));
}

export default function ExecutionTimeline({ messages, label }: {
  messages: Message[];
  label: (text: string, kind?: string) => string;
}) {
  const rows = executionEntries(messages);
  const latestReasoning = rows.filter(row => row.kind === "reasoning").at(-1)?.id;
  if (!rows.length) return null;
  return <section className="execution-timeline" data-execution-timeline aria-label="本次执行记录">
    <ul className="trace-list">
      {rows.map(row => {
        const text = label(row.label, row.kind);
        const reasoning = row.kind === "reasoning";
        const state = String(row.status || "running");
        const clock = row.observed_at && Number.isFinite(Date.parse(row.observed_at))
          ? new Date(row.observed_at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "";
        return <li key={row.id} data-kind={row.kind} data-status={state}>
          {clock ? <time dateTime={row.observed_at}>{clock}</time> : null}
          {reasoning ? <details key={`${row.id}:${row.id === latestReasoning}`} className="trace-reasoning" open={row.id === latestReasoning || undefined}>
            <summary>分析摘要{state === "running" ? " · 分析中" : ""}</summary><p>{text}</p>
          </details> : <><i aria-hidden>{state === "done" || state === "completed" ? "✓" : state === "failed" ? "!" : state === "interrupted" ? "■" : "…"}</i>
            <span>{text}</span><span className="sr-only">{state === "done" || state === "completed" ? "已完成" : state === "failed" ? "失败" : state === "interrupted" ? "已中断" : "执行中"}</span></>}
        </li>;
      })}
    </ul>
  </section>;
}
