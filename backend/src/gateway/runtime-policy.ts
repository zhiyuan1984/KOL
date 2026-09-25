import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Published lower bound for formal side effects. Runtime governance may tighten
 * this policy but cannot relabel protected actions as L1/L2. The list is a
 * versioned policy asset, not a connector/vendor-specific execution branch.
 */
type PolicyAsset = { controlled_tools?: unknown };
const POLICY_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../config/connector-risk-floor.json");
let cached: Set<string> | undefined;
function policyTools(): Set<string> {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(fs.readFileSync(POLICY_FILE, "utf8")) as PolicyAsset;
    if (!Array.isArray(parsed.controlled_tools) || parsed.controlled_tools.some((name) => typeof name !== "string")) {
      throw new Error("invalid controlled_tools");
    }
    cached = new Set(parsed.controlled_tools.map((name) => name.replace(/[^a-z0-9]/gi, "").toLowerCase()));
  } catch {
    // Fail closed if the published lower-bound asset was removed or corrupted.
    cached = new Set(["sendemailnow", "changelifecyclestage", "decryptkolcontact", "importkolprofilesfromcrawler", "startcrawl", "stopcrawl"]);
  }
  return cached;
}

export function runtimeHostOnlyTool(name: string): boolean {
  const bare = name.split(/[.:/]/).at(-1) || name;
  return policyTools().has(bare.replace(/[^a-z0-9]/gi, "").toLowerCase());
}
