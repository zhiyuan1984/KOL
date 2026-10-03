import { useEffect, useMemo, useRef, useState } from "react";
import { api, type TaskEvent } from "../api";

type StreamEvent = TaskEvent & { sequence?: number; event_id?: string; safe_summary?: string | null; occurred_at?: string };

function normalizeEvent(value: StreamEvent): TaskEvent {
  return {
    ...value,
    id: String(value.event_id || value.id || ""),
    title: value.label || value.title || value.type || "任务事件",
    summary: value.safe_summary || value.summary || value.message || "",
    created_at: value.occurred_at || value.created_at,
  };
}

export function mergeTaskRunEvents(current: TaskEvent[], incoming: StreamEvent[]): TaskEvent[] {
  const byKey = new Map<string, TaskEvent>();
  for (const event of current) byKey.set(String(event.id || event.sequence || `${event.created_at}:${event.type}`), event);
  for (const raw of incoming) {
    const event = normalizeEvent(raw);
    byKey.set(String(event.id || raw.sequence || `${event.created_at}:${event.type}`), event);
  }
  return [...byKey.values()].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
}

/**
 * Prefers the durable run SSE stream and falls back to the cursor endpoint
 * while the browser reconnects. Both transport paths merge by immutable event
 * id/sequence, so repeated snapshots or reconnects cannot duplicate a trace.
 */
export function useTaskRunEventStream(runId: string | null): { events: TaskEvent[]; connected: boolean; fallback: boolean } {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [fallback, setFallback] = useState(false);
  const afterRef = useRef(0);

  useEffect(() => {
    setEvents([]);
    setConnected(false);
    setFallback(false);
    afterRef.current = 0;
    if (!runId) return;
    let disposed = false;
    let fallbackTimer: number | null = null;
    const append = (incoming: StreamEvent[]) => {
      if (disposed || !incoming.length) return;
      for (const event of incoming) afterRef.current = Math.max(afterRef.current, Number(event.sequence || 0));
      setEvents((current) => mergeTaskRunEvents(current, incoming));
    };
    const reconcile = async () => {
      try {
        const page = await api.ticketRunEvents(runId, { after: afterRef.current, limit: 100 });
        append(page.items as StreamEvent[]);
      } catch {
        // The EventSource continues reconnecting; the visible trace stays intact.
      }
    };
    const beginFallback = () => {
      if (fallbackTimer != null || disposed) return;
      setFallback(true);
      void reconcile();
      fallbackTimer = window.setInterval(() => { void reconcile(); }, 2_000);
    };
    const endFallback = () => {
      if (fallbackTimer != null) window.clearInterval(fallbackTimer);
      fallbackTimer = null;
      if (!disposed) setFallback(false);
    };
    if (typeof EventSource === "undefined") {
      beginFallback();
      return () => { disposed = true; endFallback(); };
    }
    const stream = new EventSource(api.ticketRunStreamUrl(runId, 0));
    stream.onopen = () => { if (!disposed) { setConnected(true); endFallback(); } };
    stream.addEventListener("snapshot", (message) => {
      try {
        const payload = JSON.parse((message as MessageEvent<string>).data) as { items?: StreamEvent[]; next_sequence?: number };
        append(payload.items || []);
        afterRef.current = Math.max(afterRef.current, Number(payload.next_sequence || 0));
      } catch { beginFallback(); }
    });
    stream.addEventListener("task_event", (message) => {
      try { append([JSON.parse((message as MessageEvent<string>).data) as StreamEvent]); } catch { beginFallback(); }
    });
    stream.addEventListener("terminal", (message) => {
      try {
        const payload = JSON.parse((message as MessageEvent<string>).data) as { next_sequence?: number };
        afterRef.current = Math.max(afterRef.current, Number(payload.next_sequence || 0));
      } catch { /* terminal data is informational */ }
      stream.close();
      endFallback();
      if (!disposed) setConnected(false);
    });
    stream.onerror = () => {
      if (!disposed) {
        setConnected(false);
        beginFallback();
      }
    };
    return () => {
      disposed = true;
      stream.close();
      endFallback();
    };
  }, [runId]);

  return useMemo(() => ({ events, connected, fallback }), [events, connected, fallback]);
}
