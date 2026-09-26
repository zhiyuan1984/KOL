import { onConnReset } from "../db.js";
import { nid } from "../ids.js";
import type { Intent, Json } from "../types.js";

export const WRITE_SKILLS = new Set(["confirm_stage", "creator_contact_decrypt"]);

export type QueuedAsk = {
  id: string;
  text: string;
  intent: Intent;
  me: Json;
};

const running = new Set<string>();
const stopped = new Set<string>();
const aborts = new Map<string, AbortController>();
const queues = new Map<string, QueuedAsk[]>();

/**
 * Bumped by every run/queue mutation. `agent_status` is derived from these
 * in-memory sets, so callers that cache a projection must include this in their
 * invalidation key — the database fingerprint cannot see it.
 */
let revision = 0;

export function runControlRevision(): number {
  return revision;
}

onConnReset(() => {
  running.clear();
  stopped.clear();
  aborts.clear();
  queues.clear();
  revision += 1;
});

export function isWriteSkill(skill: string | null | undefined): boolean {
  return Boolean(skill && WRITE_SKILLS.has(skill));
}

export function isSessionRunning(sid: string): boolean {
  return running.has(sid);
}

export function beginSessionAsk(sid: string): void {
  stopped.delete(sid);
  revision += 1;
}

export function markSessionRunning(sid: string): boolean {
  if (stopped.has(sid)) return false;
  running.add(sid);
  revision += 1;
  return true;
}

export function clearSessionRunning(sid: string): void {
  running.delete(sid);
  aborts.delete(sid);
  revision += 1;
}

export function wasSessionStopped(sid: string): boolean {
  return stopped.has(sid);
}

export function attachRunAbort(sid: string, controller: AbortController): void {
  aborts.set(sid, controller);
  if (stopped.has(sid)) controller.abort();
}

export function hasRunAbort(sid: string): boolean {
  return aborts.has(sid);
}

export function abortSessionRun(sid: string): boolean {
  const controller = aborts.get(sid);
  const active = Boolean(controller) || running.has(sid);
  stopped.add(sid);
  controller?.abort();
  revision += 1;
  return active;
}

export function listQueue(sid: string): QueuedAsk[] {
  return [...(queues.get(sid) || [])];
}

export function publicQueue(sid: string): Json[] {
  return listQueue(sid).map((item) => ({
    id: item.id,
    text: item.text,
    intent: item.intent.type,
  }));
}

export function enqueueAsk(sid: string, item: Omit<QueuedAsk, "id">): QueuedAsk {
  const row: QueuedAsk = { ...item, id: nid("q") };
  const list = queues.get(sid) || [];
  list.push(row);
  queues.set(sid, list);
  revision += 1;
  return row;
}

export function removeQueued(sid: string, id: string): boolean {
  const list = queues.get(sid);
  if (!list?.length) return false;
  const next = list.filter((item) => item.id !== id);
  if (next.length === list.length) return false;
  if (next.length) queues.set(sid, next);
  else queues.delete(sid);
  revision += 1;
  return true;
}

export function shiftQueue(sid: string): QueuedAsk | null {
  const list = queues.get(sid);
  if (!list?.length) return null;
  const next = list.shift() || null;
  if (list.length) queues.set(sid, list);
  else queues.delete(sid);
  revision += 1;
  return next;
}

export function resetRunControl(): void {
  running.clear();
  stopped.clear();
  aborts.clear();
  queues.clear();
  revision += 1;
}
