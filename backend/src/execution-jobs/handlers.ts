import type { Json } from "../types.js";
import type { ClaimedExecutionJob } from "./contracts.js";
type Handler = (job: ClaimedExecutionJob, checkpoint: () => Promise<void>) => Promise<Json>;
const handlers = new Map<string, Handler>();
export function registerExecutionHandler(type: string, handler: Handler): void {
  if (handlers.has(type)) throw new Error(`Duplicate execution handler ${type}`);
  handlers.set(type, handler);
}
export function executionHandler(type: string): Handler | undefined { return handlers.get(type); }
