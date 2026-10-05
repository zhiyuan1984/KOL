import { useEffect, useRef, useState } from "react";
import { api, type AiTaskWorkOrderAggregate } from "../api";

export function useTaskCollaborationWorkspace(sessionId: string | undefined, onUnavailable: () => void) {
  const [snapshot, setSnapshot] = useState<{ sessionId: string; task: AiTaskWorkOrderAggregate; version: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const boundSession = useRef<string | null>(null);
  useEffect(() => {
    let stopped = false, reading = false;
    setSnapshot(null);
    const read = async () => {
      if (!sessionId || stopped || reading) return;
      reading = true;
      try {
        const data = await api.taskSessionWorkspace(sessionId);
        if (stopped) return;
        if (!data.workspace) { setSnapshot(null); return; }
        boundSession.current = sessionId;
        const task = await api.aiTaskWorkOrder(data.workspace.task_id);
        if (!stopped) setSnapshot({sessionId,task,version:data.workspace.evidence_version});
      } catch (cause) {
        if (!stopped) {
          setSnapshot(null);
          if (boundSession.current === sessionId && [401,403,404].includes(Number((cause as { status?: number }).status))) onUnavailable();
        }
      } finally { reading = false; }
    };
    void read();
    const timer = window.setInterval(() => { void read(); },15_000);
    return () => { stopped=true; window.clearInterval(timer); };
  },[sessionId,refresh,onUnavailable]);
  return { task: snapshot && snapshot.sessionId === sessionId ? snapshot.task : null,
    version: snapshot && snapshot.sessionId === sessionId ? snapshot.version : null, refresh: () => setRefresh(value=>value+1) };
}
