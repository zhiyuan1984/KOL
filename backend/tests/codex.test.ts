import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { setAgentSubmissionOverride } from "../src/contract-scope.js";
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
  process.env.AUTH_MODE = "disabled";
  process.env.PATH = path.join(tmp, "emptybin");
  fs.mkdirSync(path.join(tmp, "emptybin"));
  delete process.env.CODEX_BIN;
  setAgentSubmissionOverride();
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  setAgentSubmissionOverride();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
});

describe("codex", () => {
  it("accepts employee submission once the KOL Agent is published", async () => {
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
        text: "搜索 YouTube 露营达人",
        intent: "creator_discovery",
      }),
    });
    expect(res.status).toBe(202);
    const data = (await res.json()) as Json;
    expect(data.accepted).toBe(true);
    expect(data.agent_status).toBe("running");
    expect(data.detail).toBeUndefined();
  });

  it("blocks employee submission when the publish gate is stubbed unpublished", async () => {
    setAgentSubmissionOverride(false);
    const ses = (await (
      await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "codex unpublished" }),
      })
    ).json()) as { id: string };
    const res = await app.request(`/api/sessions/${ses.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "搜索 YouTube 露营达人",
        intent: "creator_discovery",
      }),
    });
    expect(res.status).toBe(409);
    const data = (await res.json()) as Json;
    expect(data.detail).toMatchObject({ code: "agent_not_published" });
  });

  it("codex handshake or skip", async () => {
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
