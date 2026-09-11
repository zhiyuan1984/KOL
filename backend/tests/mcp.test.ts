import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAW_TOOLS, STARRY_TOOLS, callMcpTool, isForbiddenWriteTool } from "../mcp/tools.js";
import { describeTools } from "../mcp/stdio.js";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-mcp-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  seedWorkbenchFixtures();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("mcp tools (Dify 工具节点)", () => {
  it("tools/list 没有发信 / 改阶段 / ingest", () => {
    const names = [...STARRY_TOOLS, ...CLAW_TOOLS].map((t) => t.name);
    for (const n of names) {
      expect(isForbiddenWriteTool(n)).toBe(false);
    }
    expect(names.some((n) => /send|ingest|confirm_stage/.test(n))).toBe(false);
  });

  it("tools/list marks every exposed tool as read-only", () => {
    for (const tool of describeTools([...STARRY_TOOLS, ...CLAW_TOOLS])) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it("写工具名被拒绝", () => {
    expect(() => callMcpTool("starry", "send_mail", {})).toThrow(/Gateway/);
    expect(() => callMcpTool("starry", "confirm_stage", {})).toThrow(/Gateway/);
    expect(() => callMcpTool("claw", "ingest_mediacrawler", {})).toThrow(/Host\/Gateway/);
    expect(() => callMcpTool("claw", "wecom_send", {})).toThrow();
  });

  it("seeded DB 可读", () => {
    const stages = callMcpTool("starry", "stage_options", {});
    expect((stages.options as unknown[]).length).toBeGreaterThan(10);
    const creators = callMcpTool("claw", "list_creators", {});
    expect((creators.creators as unknown[]).length).toBeGreaterThan(0);
    expect(((creators.creators as Record<string, unknown>[]).find((c) => c.id === "cr_outdoor"))?.email).toBe(
      "vanlife.kit@example.com",
    );
    const col = callMcpTool("starry", "get_collaboration", { handle: "小美妆日记" });
    expect(col.found).toBe(true);
    expect(col.stage_code).toBe("INITIAL_CONTACT");
    const overdue = callMcpTool("claw", "list_overdue", {});
    expect(Array.isArray(overdue.items)).toBe(true);
  });
});
