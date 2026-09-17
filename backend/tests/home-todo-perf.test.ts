import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { isOpenWorkItem } from "../src/host/home-board.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { resetStarryHomeLibrarySync } from "../src/starrykol/library-sync.js";
import { resetFollowedMailSync } from "../src/starrykol/mail-sync.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-todo-perf-"));
  process.env.LINGONG_DB = path.join(tmp, "todo.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  resetStarryHomeLibrarySync();
  resetFollowedMailSync();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  setStarryKolClientFactory();
  resetStarryHomeLibrarySync();
  resetFollowedMailSync();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("GET /api/tasks?view=open", () => {
  it("returns all open work items including unpromoted source=ai", async () => {
    const listed = await request("GET", "/api/tasks?view=open");
    expect(listed.status).toBe(200);
    expect(listed.body.view).toBe("open");
    expect(listed.body.creates_session).toBe(false);
    expect(listed.body.entry).toBe("memory");
    expect(Number(listed.body.limit)).toBe(50);
    const tasks = listed.body.tasks as Json[];
    expect(listed.body.total).toBe(tasks.length);
    expect(tasks.map((row) => row.id).sort()).toEqual([
      "tsk_home_laozhang_quote",
      "tsk_home_outdoor_profile",
      "tsk_home_trip_stage",
      "tsk_home_xiaomei_lost",
    ]);
    expect(tasks.every((row) => isOpenWorkItem(row))).toBe(true);
    expect(tasks.some((row) => row.id === "tsk_home_xiaomei_lost" && row.source === "ai" && !row.promoted_at)).toBe(true);
    expect(tasks.every((row) => !("history" in row) || row.history == null)).toBe(true);
    expect(tasks.every((row) => String(row.history_summary || "").trim())).toBe(true);
    expect(tasks.find((row) => row.id === "tsk_home_laozhang_quote")?.current_stage).toContain("报价待确认");
    expect(JSON.stringify(listed.body)).not.toMatch(/"history":\s*\[/);
  });

  it("compat view=todo uses the same open semantics", async () => {
    const listed = await request("GET", "/api/tasks?view=todo");
    expect(listed.status).toBe(200);
    expect(listed.body.view).toBe("todo");
    expect(listed.body.creates_session).toBe(false);
    const ids = ((listed.body.tasks as Json[]) || []).map((row) => String(row.id));
    expect(ids).toContain("tsk_home_xiaomei_lost");
    expect(ids).toContain("tsk_home_outdoor_profile");
    expect(ids).not.toContain("tsk_home_xiaomei_mail");
    expect(ids).not.toContain("tsk_home_mum_nudge");
  });

  it("omits completed and dismissed items", async () => {
    const listed = await request("GET", "/api/tasks?view=open");
    const ids = ((listed.body.tasks as Json[]) || []).map((row) => String(row.id));
    expect(ids).not.toContain("tsk_home_xiaomei_mail");
    expect(ids).not.toContain("tsk_home_mum_nudge");
  });

  it("honors limit without changing total", async () => {
    const listed = await request("GET", "/api/tasks?view=open&limit=1");
    expect(listed.status).toBe(200);
    expect(listed.body.limit).toBe(1);
    expect(listed.body.total).toBe(4);
    expect((listed.body.tasks as Json[]).length).toBe(1);
  });

  it("never inserts sessions and does not call Starry library/mail tools", async () => {
    const calls: string[] = [];
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        calls.push(name);
        return { data: { list: [] } };
      },
      async close() { /* noop */ },
    }));
    const before = getConn().prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    const listed = await request("GET", "/api/tasks?view=todo");
    expect(listed.status).toBe(200);
    const after = getConn().prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    expect(after.c).toBe(before.c);
    expect(calls).toEqual([]);
  });
});

describe("GET /api/home/board local-first", () => {
  it("returns 200 from local projection without waiting for remote sync", async () => {
    let resolveHang: (() => void) | undefined;
    const hang = new Promise<void>((resolve) => {
      resolveHang = resolve;
    });
    setStarryKolClientFactory(() => ({
      async callTool() {
        await hang;
        return { data: { list: [] } };
      },
      async close() { /* noop */ },
    }));
    const started = Date.now();
    const board = await request("GET", "/api/home/board");
    const elapsed = Date.now() - started;
    expect(board.status).toBe(200);
    expect(elapsed).toBeLessThan(750);
    expect(board.body.creates_session).toBe(false);
    expect(board.body.sync).toMatchObject({ deferred: true, refresh: false });
    expect(board.body.library).toMatchObject({ source: "starry", tool: "listAllKolProfiles" });
    expect((board.body.library as Json).synced_at).toBeFalsy();
    const tasks = (board.body.tasks as Json[]) || [];
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((row) => !("history" in row) || row.history == null)).toBe(true);
    const workbench = board.body.workbench as Json;
    const todo = (workbench.todo as Json[]) || [];
    const open = (workbench.open as Json[]) || [];
    expect(todo.map((row) => row.id).sort()).toEqual(["tsk_home_laozhang_quote", "tsk_home_trip_stage"]);
    expect(open.map((row) => row.id).sort()).toEqual([
      "tsk_home_laozhang_quote",
      "tsk_home_outdoor_profile",
      "tsk_home_trip_stage",
      "tsk_home_xiaomei_lost",
    ]);
    expect(todo.every((row) => row.history == null && row.input == null && row.entities == null)).toBe(true);
    expect((workbench.summary as Json).open).toBe(open.length);
    resolveHang?.();
  });

  it("refresh=1 still returns local-first and does not insert sessions", async () => {
    const before = getConn().prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    const board = await request("GET", "/api/home/board?refresh=1");
    expect(board.status).toBe(200);
    expect(board.body.sync).toMatchObject({ deferred: true, refresh: true });
    const after = getConn().prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    expect(after.c).toBe(before.c);
  });
});
