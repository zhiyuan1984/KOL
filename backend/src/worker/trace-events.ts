import type { Json } from "../types.js";

/** Preserve lifecycle transitions. Receiving an update is a real event; it is not the start time. */
export function traceEventPayload(previous: Json | null, next: Json, recordedAt: string): Json & { timeline_events: Json[] } {
  const source = (payload: Json): Json[] => {
    const items = payload.operations || payload.items;
    return Array.isArray(items) ? items.filter(row => row && typeof row === "object") as Json[] : [];
  };
  const events: Json[] = Array.isArray(previous?.timeline_events) ? previous!.timeline_events.map((row: Json) => ({ ...row }))
    : source(previous || {}).filter((row: Json) => row && (row.label || row.name)).map((row: Json, index: number) => ({
      ...row, id: `${row.id || index}:0`, source_id: String(row.id || index), observed_at: row.observed_at,
    }));
  for (const [index, row] of source(next).entries()) {
    if (!row || !(row.label || row.name)) continue;
    const sourceId = String(row.id || index);
    let lastIndex = -1;
    for (let i = events.length - 1; i >= 0; i--) if (events[i].source_id === sourceId) { lastIndex = i; break; }
    const last = events[lastIndex];
    if (!last || last.status !== row.status) {
      events.push({ ...row, id: `${sourceId}:${events.length}`, source_id: sourceId,
        observed_at: last ? recordedAt : row.observed_at || recordedAt,
        transition: Boolean(last), recorded_at: recordedAt });
    } else {
      // Streaming summaries update their existing row without changing its position or original time.
      events[lastIndex] = { ...last, ...row, id: last.id, source_id: sourceId, observed_at: last.observed_at };
    }
  }
  return { ...next, timeline_events: events };
}
