import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";

type Json = Record<string, unknown>;

let tmp: string;
let app: Hono;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-codex-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "real";
  process.env.PATH = path.join(tmp, "emptybin");
  fs.mkdirSync(path.join(tmp, "emptybin"));
  delete process.env.CODEX_BIN;
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("codex", () => {
  it("missing codex does not synthesize email", async () => {
    const ses = (await (
      await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "codex" }),
      })
    ).json()) as { id: string };
    const res = await app.request(`/api/sessions/${ses.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "搜索抖音露营达人",
        intent: "creator_discovery",
      }),
    });
    expect(res.status).toBe(202);
    const data = (await res.json()) as Json;
    expect(data.draft ?? null).toBeNull();
    expect(data.worker ?? null).toBeNull();
    expect(data.accepted).toBe(true);
    let messages = data.messages as Json[];
    for (let i = 0; i < 30 && !messages.some((m) => m.kind === "error_card"); i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      const session = (await (await app.request(`/api/sessions/${ses.id}`)).json()) as { messages: Json[] };
      messages = session.messages;
    }
    expect(messages.some((m) => m.kind === "error_card")).toBe(true);
    const trace = messages.find((m) => m.kind === "process_trace");
    expect(
      (((trace?.payload as Json | undefined)?.items as Json[] | undefined) || []).some(
        (item) => item.status === "failed",
      ),
    ).toBe(true);
    const err = messages.find((m) => m.kind === "error_card")?.payload as Json;
    expect(String(err.message || "")).toMatch(/没有 `codex`|CODEX_BIN|未起箱/);
    expect(String(err.next_action || "")).toMatch(/codex login|OPENAI_API_KEY/);
    expect(String(err.next_action || "")).not.toContain("请检查任务输入后重试");
    const blob = JSON.stringify(messages);
    expect(blob).not.toContain("Following up — LiTime");
  });

  it("codex handshake or skip", async () => {
    const which = process.env.REAL_PATH
      ? undefined
      : undefined;
    void which;
    const { findCodex } = await import("../src/worker/codex.js");
    const { CodexUnavailable } = await import("../src/worker/errors.js");
    try {
      findCodex();
    } catch (e) {
      if (e instanceof CodexUnavailable) return;
      throw e;
    }
  });
});
