import { useEffect, useMemo, useState } from "react";
import { api, type Message, type SessionRow, type Task, type TaskEvent } from "../api";

export type AgentRunStatus = SessionRow["agent_status"];

function phaseFromMessages(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const kind = String(m.kind || "");
    const payload = (m.payload && typeof m.payload === "object" ? m.payload : {}) as Record<string, unknown>;
    if (kind === "process_trace") {
      const phases = Array.isArray(payload.phases) ? payload.phases as { label?: string; status?: string }[] : [];
      const active = [...phases].reverse().find((p) => p.status === "running") || phases[phases.length - 1];
      if (active?.label) return String(active.label);
      if (payload.title) return String(payload.title);
    }
    if (kind === "operation_trace") {
      const items = Array.isArray(payload.items) ? payload.items as { label?: string; name?: string }[] : [];
      const last = items[items.length - 1];
      if (last?.label) return String(last.label);
    }
    if (kind === "assistant" && payload.text) {
      const text = String(payload.text);
      if (text.length < 80) return text;
    }
  }
  return undefined;
}

function phaseFromEvents(events: TaskEvent[]): string | undefined {
  const row = [...events].reverse().find((e) => e.label || e.title || e.summary);
  return row ? String(row.label || row.title || row.summary) : undefined;
}

export function useRunStatus(sessionId: string | undefined, messages: Message[], agentStatus: AgentRunStatus) {
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setTask(null);
      setEvents([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const bound = await api.taskBySession(sessionId);
        const row = (bound as { task?: Task }).task || (bound as Task);
        if (cancelled || !row?.id) return;
        setTask(row);
        const ev = await api.taskEvents(row.id).catch(() => []);
        if (!cancelled) setEvents(Array.isArray(ev) ? ev : (ev as { events?: TaskEvent[] }).events || []);
      } catch {
        if (!cancelled) {
          setTask(null);
          setEvents([]);
        }
      }
    };
    void load();
    if (agentStatus === "running") {
      const timer = window.setInterval(load, 2000);
      return () => {
        cancelled = true;
        window.clearInterval(timer);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [sessionId, agentStatus]);

  const phase = useMemo(
    () => phaseFromMessages(messages) || phaseFromEvents(events),
    [messages, events],
  );

  return { agentStatus, phase, task, events };
}
