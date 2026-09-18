import fs from "node:fs";
import path from "node:path";
import { codexBin, codexMode } from "./config.js";

export function isTestRuntime(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
}

export function stubAllowedForSkill(skill: string): boolean {
  if (codexMode() !== "stub") return false;
  if (skill === "today_plan" || skill === "today_analyze") return isTestRuntime();
  return true;
}

export function planningStubForbidden(skill = "today_plan"): boolean {
  return (skill === "today_plan" || skill === "today_analyze") && codexMode() === "stub" && !isTestRuntime();
}

export function codexBinOk(): boolean {
  const override = (process.env.CODEX_BIN || "").trim();
  if (override) return fs.existsSync(override);
  const names = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : [codexBin(), "codex"];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      if (fs.existsSync(path.join(dir, name))) return true;
    }
  }
  return false;
}
