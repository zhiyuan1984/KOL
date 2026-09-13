import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import {
  FOLLOW_STYLE_PRESETS,
  isFollowStyleTagCommand,
  mergeFollowStyleTags,
  normalizeFollowStyleTags,
  parseFollowStyleTagCommand,
  suggestFollowStyleTags,
} from "../src/follow-style-tags.js";
import { composeFactsFromContext, composePreviewPrompt } from "../src/host/compose-loop.js";
import { buildHomeBoard } from "../src/host/home-board.js";
import { resetDemoRuntimeState, seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const res = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) as Json : {}, text };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-follow-style-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
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

describe("follow-style tags", () => {
  it("normalizes presets, mutex, and custom words", () => {
    expect(FOLLOW_STYLE_PRESETS.map((tag) => tag.label)).toContain("犹豫谨慎");
    const tags = normalizeFollowStyleTags(["犹豫谨慎", "决策快", "很挑剔"]);
    expect(tags.map((tag) => tag.label)).toEqual(["决策快", "很挑剔"]);
    expect(mergeFollowStyleTags(
      [{ id: "cautious", label: "犹豫谨慎" }],
      ["回复慢"],
      "add",
    ).map((tag) => tag.id)).toEqual(["cautious", "slow_reply"]);
  });

  it("suggests cautious from hesitant copy and skips already applied tags", () => {
    const suggested = suggestFollowStyleTags("我再考虑一下，还不太确定能不能接。");
    expect(suggested.map((tag) => tag.id)).toEqual(["cautious"]);
    expect(suggestFollowStyleTags("Thanks, I am interested. Please send the rate card.")).toEqual([]);
    expect(suggestFollowStyleTags("我再考虑一下。", [{ id: "cautious", label: "犹豫谨慎" }])).toEqual([]);
  });

  it("parses 打标签 commands without locking a skill", () => {
    expect(isFollowStyleTagCommand("给 @小美妆日记 打标签 犹豫谨慎")).toBe(true);
    expect(isFollowStyleTagCommand("写跟进邮件，这个红人比较犹豫谨慎请打标签")).toBe(false);
    expect(parseFollowStyleTagCommand("给 @小美妆日记 打标签 犹豫谨慎、回复慢")).toEqual({
      handle: "小美妆日记",
      labels: ["犹豫谨慎", "回复慢"],
    });
  });

  it("saves tags on the collaboration, shows them on the home card, and injects them into compose", async () => {
    const saved = await request("PUT", "/api/collaborations/col_xiaomei/follow-style-tags", {
      tags: ["犹豫谨慎"],
    });
    expect(saved.status).toBe(200);
    expect((saved.body.follow_style_tags as Json[])[0]).toMatchObject({ id: "cautious", label: "犹豫谨慎" });

    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    expect(((opened.body.journey as Json).follow_style_tags as Json[])[0]).toMatchObject({ label: "犹豫谨慎" });

    getConn().prepare("UPDATE collaborations SET kol_uid='KOLXIAOMEI' WHERE id='col_xiaomei'").run();
    const board = buildHomeBoard();
    const card = ((board.kols as Json[]) || []).find((row) => row.handle === "小美妆日记");
    expect(card).toBeTruthy();
    expect((card?.follow_style_tags as Json[]).some((tag) => tag.label === "犹豫谨慎")).toBe(true);

    const facts = composeFactsFromContext({
      stage: "INITIAL_CONTACT",
      raw: "写跟进邮件",
      style_tags: saved.body.follow_style_tags as { id: string; label: string }[],
    });
    expect(facts.items.join(" ")).toContain("犹豫谨慎");
    const prompt = composePreviewPrompt("写跟进邮件", "", facts);
    expect(prompt).toContain("跟进不要催");
    resetDemoRuntimeState();
    const cleared = getConn().prepare("SELECT follow_style_tags FROM collaborations WHERE id='col_xiaomei'").get() as {
      follow_style_tags: string | null;
    };
    expect(cleared.follow_style_tags).toBeNull();
  });

  it("applies a chat 打标签 command without starting a worker", async () => {
    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    const sid = String(opened.body.id);
    const asked = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "给 @小美妆日记 打标签 犹豫谨慎",
    });
    expect(asked.status, asked.text).toBe(200);
    expect(asked.body.worker).toBeNull();
    const msgs = asked.body.messages as Json[];
    expect(msgs.some((row) => row.kind === "task_result_card" && String((row.payload as Json).summary || "").includes("犹豫谨慎"))).toBe(true);
    const row = getConn().prepare("SELECT follow_style_tags FROM collaborations WHERE id='col_xiaomei'").get() as { follow_style_tags: string };
    expect(row.follow_style_tags).toContain("cautious");
  });
});
