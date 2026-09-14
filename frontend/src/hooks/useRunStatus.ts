import { useEffect, useMemo, useState } from "react";
import { api, type Message, type SessionRow, type Task, type TaskEvent } from "../api";
import { employeeProcessLabel, employeeTraceLabel } from "../components/ChatBlocks";

export type AgentRunStatus = SessionRow["agent_status"];

function phaseFromMessages(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const kind = String(m.kind || "");
    const payload = (m.payload && typeof m.payload === "object" ? m.payload : {}) as Record<string, unknown>;
    if (kind === "process_trace") {
      const source = Array.isArray(payload.items) && payload.items.length
        ? payload.items
        : Array.isArray(payload.phases) ? payload.phases : [];
      const rows = source as { label?: string; status?: string; kind?: string; summary?: string; reasoning_summary?: string }[];
      const active = [...rows].reverse().find((p) => p.status === "running") || rows[rows.length - 1];
      const raw = String(active?.label || active?.summary || active?.reasoning_summary || "");
      if (raw) return employeeTraceLabel(raw, active?.kind);
      if (payload.title) return employeeProcessLabel(String(payload.title));
    }
    if (kind === "operation_trace") {
      const items = Array.isArray(payload.items) ? payload.items as { label?: string; name?: string }[] : [];
      const last = items[items.length - 1];
      if (last?.label) return employeeProcessLabel(String(last.label));
    }
    if (kind === "assistant" && payload.text) {
      const text = String(payload.text);
      if (text.length < 80) return employeeProcessLabel(text);
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
    () => {
      const fromMessages = phaseFromMessages(messages);
      if (fromMessages) return fromMessages;
      const raw = phaseFromEvents(events);
      return raw ? employeeProcessLabel(raw) : undefined;
    },
    [messages, events],
  );

  return { agentStatus, phase, task, events };
}
