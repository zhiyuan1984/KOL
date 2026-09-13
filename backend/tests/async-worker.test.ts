import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-async-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  // Real Codex mode engages the unpublished-agent employee-submission gate.
  // Isolate AUTH_MODE so a repo-root .env or inherited CI env cannot flip 409 → 401.
  process.env.CODEX_MODE = "real";
  process.env.AUTH_MODE = "disabled";
  resetConn();
  seedAll();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
});

describe("real Codex HTTP flow", () => {
  it("blocks creator-discovery session messages while the KOL Agent is unpublished", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "async discovery" }),
    });
    const { id } = (await created.json()) as { id: string };

    const response = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索抖音露营达人", intent: "creator_discovery", act: "ask" }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ detail: { code: "agent_not_published" } });
  });

  it("blocks discovery-review session messages while the KOL Agent is unpublished", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "discovery review" }),
    });
    const { id } = (await created.json()) as { id: string };
    const response = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索抖音露营达人", intent: "creator_discovery", act: "ask" }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({ detail: { code: "agent_not_published" } });
  });

  it("blocks from-text crawl-plan creation while the KOL Agent is unpublished", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/tasks/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索抖音露营达人" }),
    });
    // Recognized discovery phrases create a work item; createWorkItem is gated
    // while the KOL Agent is unpublished (pilot-not-production).
    expect(created.status).toBe(409);
    expect((await created.json()) as Record<string, unknown>).toMatchObject({
      detail: { code: "agent_not_published" },
    });
  });
});
