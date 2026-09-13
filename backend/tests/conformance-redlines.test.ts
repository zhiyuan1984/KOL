import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONAS } from "../src/config.js";
import { resolveAuthorizedFrom } from "../src/host/pep.js";
import { taskDefinition } from "../src/tasks/registry.js";
import { kolAgentManifest } from "../src/contract-scope.js";

describe("constitutional redlines", () => {
  it("does not select the first mailbox when several are authorized", () => {
    const resolved = resolveAuthorizedFrom("", PERSONAS.sriphy, null);
    expect(resolved.allowed.length).toBeGreaterThan(1);
    expect(resolved.email).toBe("");
  });

  it("parses CRLF Skill frontmatter", () => {
    expect(taskDefinition("business_approval")?.id).toBe("business_approval");
  });

  it("keeps real preview on the app-server path", () => {
    const runner = fs.readFileSync(path.resolve(import.meta.dirname, "../src/worker/runner.ts"), "utf8");
    expect(runner).toContain('if (codexMode() === "stub")');
    expect(runner).not.toContain('codexMode() === "stub" || extra.compose_preview_only');
  });

  it("does not restore the forbidden first-mailbox fallback", () => {
    const frontend = fs.readFileSync(path.resolve(import.meta.dirname, "../../frontend/src/components/ChatBlocks.tsx"), "utf8");
    expect(frontend).not.toContain("|| opts[0].email");
    expect(frontend).not.toContain('targets.find((item) => item.kind === "adjacent")?.code');
  });

  it("gives confirmed department heads all configured brand mailboxes", () => {
    const head = { ...PERSONAS.permission_blocked, name: "刘敏" };
    expect(resolveAuthorizedFrom("", head, null).allowed.map((item) => item.brand)).toEqual(["LT", "RO", "PQ"]);
  });

  it("serves employee Agent entries and teams from the publish manifest", () => {
    const manifest = kolAgentManifest() as { employee_views?: { entries?: unknown[]; teams?: unknown[] }; publish_gate?: { employee_submission?: boolean } };
    expect(manifest.publish_gate?.employee_submission).toBe(true);
    expect(manifest.employee_views?.entries?.length).toBeGreaterThan(0);
    expect(manifest.employee_views?.teams?.length).toBeGreaterThan(0);
  });
});
