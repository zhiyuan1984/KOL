/**
 * Gateway reject for discovery_plan / discovery_brief turns.
 * Model must not start crawl, import, send, stage-write, decrypt, or follow.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { audit } from "../db.js";
import { HttpFail } from "../host/errors.js";

export const DISCOVERY_HARNESS_SKILLS = new Set(["discovery_plan", "discovery_brief"]);

export const DISCOVERY_HARNESS_FORBIDDEN_TOOLS = [
  "start_crawl",
  "upload_creators",
  "import",
  "importKolProfilesFromCrawler",
  "importKolProfilesV2",
  "sendEmailNow",
  "changeLifecycleStage",
  "decryptKolContact",
  "follow",
  "creator_discovery",
] as const;

type HarnessScope = {
  skill: string;
  session_id?: string;
  work_item_id?: string;
  run_id?: string;
};

const scope = new AsyncLocalStorage<HarnessScope>();

export function discoveryHarnessScope(): HarnessScope | undefined {
  return scope.getStore();
}

export function runInDiscoveryHarness<T>(ctx: HarnessScope, fn: () => T): T {
  return scope.run(ctx, fn);
}

export function isDiscoveryHarnessForbiddenTool(name: string): boolean {
  const tool = String(name || "").trim();
  if (!tool) return false;
  const bare = tool.includes(".") ? tool.slice(tool.lastIndexOf(".") + 1) : tool;
  return (DISCOVERY_HARNESS_FORBIDDEN_TOOLS as readonly string[]).some((item) => (
    tool === item || bare === item || tool.endsWith(`.${item}`) || tool.toLowerCase().includes(item.toLowerCase())
  ));
}

export function rejectDiscoveryHarnessTool(name: string): void {
  const current = scope.getStore();
  if (!current || !DISCOVERY_HARNESS_SKILLS.has(current.skill)) return;
  if (!isDiscoveryHarnessForbiddenTool(name)) return;
  audit("gateway", "discovery.harness.tool_rejected", {
    skill: current.skill,
    tool: name,
    session_id: current.session_id || null,
    work_item_id: current.work_item_id || null,
    run_id: current.run_id || null,
  });
  throw new HttpFail(403, {
    code: "discovery_harness_tool_rejected",
    message: "当前发现回合不能执行该动作。",
    tool: name,
    skill: current.skill,
  });
}

export const FROM_TEXT_FORBIDDEN_TASK_TYPES = new Set([
  "discovery_plan",
  "discovery_crawl",
  "discovery_brief",
]);
