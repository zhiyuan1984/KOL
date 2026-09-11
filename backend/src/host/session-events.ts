import type { Json } from "../types.js";

export type SessionLiveEvent = {
  type: "upsert" | "status" | "journey" | "queue";
  message?: Json;
  agent_status?: string;
  journey?: Json;
  queue?: Json[];
};

type Listener = (event: SessionLiveEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function publishSession(sid: string, event: SessionLiveEvent): void {
  const set = listeners.get(sid);
  if (!set?.size) return;
  for (const fn of [...set]) {
    try { fn(event); } catch { /* one subscriber must not block others */ }
  }
}

export function subscribeSession(sid: string, fn: Listener): () => void {
  const set = listeners.get(sid) || new Set<Listener>();
  set.add(fn);
  listeners.set(sid, set);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(sid);
  };
}

export function subscriberCount(sid?: string): number {
  if (sid) return listeners.get(sid)?.size || 0;
  let total = 0;
  for (const set of listeners.values()) total += set.size;
  return total;
}
