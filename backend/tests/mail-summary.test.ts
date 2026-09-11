import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { analyzeMailBody, analyzeThreadDigest, digestMailBody, ensureCodexThreadDigest, mailHistoryRows, mailMemoryLines, mailSummaryOf, readThreadDigest } from "../src/host/mail-summary.js";
import { ingestKolMail } from "../src/host/kol-journey.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { setIntentLlmFetch } from "../src/tasks/openai-intent.js";
import { collectDealMemoryItems } from "../src/worker/session-items.js";
import type { Json } from "../src/types.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-mail-summary-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  seedWorkbenchFixtures();
});

afterEach(() => {
  setIntentLlmFetch();
  delete process.env.INTENT_LLM_MODE;
  delete process.env.OPENAI_API_KEY;
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Codex mail memory", () => {
  it("summarizes from the letter body, not the subject", () => {
    const row = {
      subject: "KOL合作",
      body: "Hi, I am interested and would love to collaborate with your brand.",
    };
    expect(digestMailBody(row)).toContain("would love to collaborate");
    expect(mailSummaryOf(row)).toContain("would love to collaborate");
    expect(mailSummaryOf(row)).toMatch(/有兴趣|合作意愿/);
    expect(mailSummaryOf(row)).not.toBe("KOL合作");
  });

  it("analyzes greeting follow-ups instead of printing the English opener", () => {
    const row = {
      direction: "outbound",
      subject: "Re: KOL合作",
      body: "Hi 灵工连通测试-qiyou1984, I hope you’re doing well! I wanted to reach out and express our continued interest.",
    };
    const summary = analyzeMailBody(row);
    expect(summary).toMatch(/寒暄跟进|合作意愿/);
    expect(summary).not.toMatch(/Hi 灵工连通测试/);
    expect(mailSummaryOf({ ...row, summary: digestMailBody(row), summary_source: "body_digest" })).toMatch(/寒暄跟进|合作意愿/);
    expect(mailSummaryOf({ ...row, summary: digestMailBody(row), summary_source: "body_digest" })).not.toMatch(/^Hi /);
  });

  it("asks the remote model for one thread digest when not in stub", async () => {
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENAI_API_KEY = "sk-test-mail-memory";
    setIntentLlmFetch(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        digest: "来信明确说想合作，并请品牌补充下一步。",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    ingestKolMail("col_xiaomei", {
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Hi, I am interested and would love to collaborate.",
      from: "xiaomei.beauty@example.com",
    });
    const digest = await ensureCodexThreadDigest("col_xiaomei");
    expect(digest.text).toBe("来信明确说想合作，并请品牌补充下一步。");
    expect(digest.source).toBe("luna");
    expect(digest.text).not.toMatch(/^Hi,/);
    expect(readThreadDigest("col_xiaomei")?.text).toBe(digest.text);
  });

  it("does not stamp the greeting rule as Codex when the remote fails", async () => {
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENAI_API_KEY = "sk-test-mail-memory";
    setIntentLlmFetch(async () => new Response("no", { status: 500 }));
    ingestKolMail("col_xiaomei", {
      subject: "Re: KOL合作",
      body: "Hi 灵工连通测试-qiyou1984, I hope you’re doing well! I wanted to reach out.",
      from: "larry.zhao@amperetime.com",
      to: "qiyou1984@gmail.com",
      direction: "outbound",
      provider_message_id: "out-fail-1",
    });
    const digest = await ensureCodexThreadDigest("col_xiaomei");
    expect(digest.source).toBe("analysis_failed");
    expect(digest.text).toMatch(/寒暄跟进|往来/);
    await ensureCodexThreadDigest("col_xiaomei");
    expect(readThreadDigest("col_xiaomei")?.source).toBe("analysis_failed");
  });

  it("retries a poisoned greeting digest and folds two bodies into one paragraph", async () => {
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENAI_API_KEY = "sk-test-mail-memory";
    setIntentLlmFetch(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        digest: "两封去信都只寒暄跟进，晚上那封提到 brief，下午那封只问 timing，都还没有报价或明确兴趣。",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    ingestKolMail("col_xiaomei", {
      subject: "Re: KOL合作",
      body: "Hi 灵工连通测试-qiyou1984, I hope you’re doing well! I wanted to reach out this evening.",
      from: "larry.zhao@amperetime.com",
      to: "qiyou1984@gmail.com",
      direction: "outbound",
      occurred_at: "2026-09-08T15:50:31.000Z",
      provider_message_id: "out-poison-1",
    });
    ingestKolMail("col_xiaomei", {
      subject: "Re: KOL合作",
      body: "Hi 灵工连通测试-qiyou1984, I hope this message finds you in great spirits. Just checking in.",
      from: "larry.zhao@amperetime.com",
      to: "qiyou1984@gmail.com",
      direction: "outbound",
      occurred_at: "2026-09-08T12:32:54.000Z",
      provider_message_id: "out-poison-2",
    });
    getConn().prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run(
      "mail_digest:col_xiaomei",
      JSON.stringify({
        text: "去信寒暄跟进，尚未落到报价、档期或明确兴趣。",
        source: "codex_memory",
        mail_count: 2,
        fingerprint: "stale",
      }),
    );
    expect(analyzeThreadDigest(mailHistoryRows("col_xiaomei"))).toMatch(/往来/);
    const digest = await ensureCodexThreadDigest("col_xiaomei", undefined, { retryFailed: true });
    expect(digest.text).toBe("两封去信都只寒暄跟进，晚上那封提到 brief，下午那封只问 timing，都还没有报价或明确兴趣。");
    expect(digest.source).toBe("luna");
    expect(digest.text).not.toBe("去信寒暄跟进，尚未落到报价、档期或明确兴趣。");
  });

  it("folds all bodies into one stub digest and keeps Deal Memory on the letter body", () => {
    const ingested = ingestKolMail("col_xiaomei", {
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Hi, I am interested and would love to collaborate.",
      from: "xiaomei.beauty@example.com",
    });
    expect(ingested.ok).toBe(true);
    const rows = mailHistoryRows("col_xiaomei");
    expect(mailSummaryOf(rows[0] || {})).toContain("would love to collaborate");
    expect(analyzeThreadDigest(rows)).toMatch(/本会话共 1 封往来/);
    expect(analyzeThreadDigest(rows)).toMatch(/有兴趣|合作意愿/);
    const lines = mailMemoryLines(rows);
    expect(lines[0]).toContain("would love to collaborate");
    expect(lines[0]).not.toMatch(/^来信 · Re: Collaboration Opportunity with LiTime$/);
    const col = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get("col_xiaomei") as Json;
    const memory = collectDealMemoryItems(col, "小美妆日记");
    expect(JSON.stringify(memory)).toContain("would love to collaborate");
    expect(JSON.stringify(memory)).toContain("往来摘要");
  });
});
