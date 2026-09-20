import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { setEmailMcpClientFactory } from "../src/starrykol/service.js";
import { syncFollowedKolMail, waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
import { bindStarryUser } from "./helpers/starry-binding.js";
import type { Json } from "../src/types.js";

let conversationId = 1000;

function nextConversation() {
  const id = conversationId++;
  return {
    id,
    conversationId: id,
    subject: `Test subject ${id}`,
    recipientEmail: `kol${id}@example.com`,
    mailboxEmail: "larry.zhao@amperetime.com",
    status: "open",
    unreadCount: 1,
    lastMessageAt: new Date().toISOString(),
  };
}

function bindDemoUser(): void {
  bindStarryUser({ brands: ["LT", "RO", "PQ"], site: "深圳站" });
}

function mockMcp(readMs: number, totalCount: number, pageSize = 10) {
  conversationId = 1000;
  const allConversations = Array.from({ length: totalCount }, nextConversation);
  const counters = { getEmailConversation: 0 };
  return {
    counters,
    async callTool(name: string, args: Json = {}): Promise<Json> {
      await new Promise((resolve) => setTimeout(resolve, readMs));
      if (name === "pageEmailConversations") {
        const pageNo = Number(args.pageNo ?? 1);
        const ps = Math.min(Number(args.pageSize ?? pageSize), pageSize);
        const start = (pageNo - 1) * ps;
        const list = allConversations.slice(start, start + ps);
        return { data: { pageNo, pageSize: ps, total: totalCount, list } };
      }
      if (name === "getEmailConversation") {
        counters.getEmailConversation += 1;
        const cid = args.conversationId;
        return {
          data: {
            id: cid,
            conversationId: cid,
            subject: "Test subject",
            recipientEmail: `kol${cid}@example.com`,
            mailboxEmail: "larry.zhao@amperetime.com",
            messages: [{
              id: `msg-${cid}-1`,
              messageId: `msg-${cid}-1`,
              provider_message_id: `msg-${cid}-1`,
              direction: "inbound",
              from: `kol${cid}@example.com`,
              to: "larry.zhao@amperetime.com",
              body: "Hi, I am interested in collaboration.",
              sentAt: new Date().toISOString(),
            }],
          },
        };
      }
      if (name === "pageKolProfiles" || name === "listAllKolProfiles") {
        return { data: { total: 0, list: [] } };
      }
      throw new Error(`unexpected tool ${name}`);
    },
    async close() { /* noop */ },
  };
}

describe("mail sync performance", () => {
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mail-sync-perf-"));
    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "stub";
    resetConn();
    seedAll();
    bindDemoUser();
  });

  afterEach(async () => {
    await waitForBackgroundSync();
    getConn().close();
    setEmailMcpClientFactory();
  });

  it.each([
    { remoteCount: 30, syncCount: 30, readMs: 200, expectedMaxMs: 3000, pageSize: 30 },
    { remoteCount: 30, syncCount: 30, readMs: 1000, expectedMaxMs: 10000, pageSize: 30 },
    { remoteCount: 10, syncCount: 10, readMs: 1000, expectedMaxMs: 4000 },
    { remoteCount: 30, syncCount: 5, readMs: 1000, expectedMaxMs: 3000, pageSize: 30 },
  ])("syncs $remoteCount remote conversations with $syncCount local syncs and $readMs ms remote read", async ({ remoteCount, syncCount, readMs, expectedMaxMs, pageSize }) => {
    setEmailMcpClientFactory(() => mockMcp(readMs, remoteCount, pageSize));
    const start = Date.now();
    const result = await syncFollowedKolMail();
    const elapsed = Date.now() - start;
    console.log(`remoteCount=${remoteCount} syncCount=${syncCount} readMs=${readMs} elapsed=${elapsed}ms conversations=${result.conversations}`);
    expect(result.conversations).toBe(remoteCount);
    expect(elapsed).toBeLessThan(expectedMaxMs);
  });

  it("hydrates remaining conversations in the background", async () => {
    const mcp = mockMcp(100, 12);
    setEmailMcpClientFactory(() => mcp);
    await syncFollowedKolMail();
    expect(mcp.counters.getEmailConversation).toBe(5);
    await waitForBackgroundSync();
    expect(mcp.counters.getEmailConversation).toBe(12);
    const items = getConn().prepare("SELECT COUNT(*) as c FROM kol_mail_items").get() as { c: number };
    expect(items.c).toBeGreaterThanOrEqual(12);
  });

  it("hydrates conversations across multiple pages in the background", async () => {
    const mcp = mockMcp(50, 30, 10); // 3 pages of 10
    setEmailMcpClientFactory(() => mcp);
    const start = Date.now();
    const result = await syncFollowedKolMail();
    const elapsed = Date.now() - start;
    expect(result.conversations).toBe(10); // first page list length
    expect(elapsed).toBeLessThan(1000);    // foreground only
    expect(mcp.counters.getEmailConversation).toBe(5);

    await waitForBackgroundSync();
    expect(mcp.counters.getEmailConversation).toBe(30);

    const items = getConn().prepare("SELECT COUNT(*) as c FROM kol_mail_items").get() as { c: number };
    expect(items.c).toBeGreaterThanOrEqual(30);

    const pageNo = getConn().prepare("SELECT sync_page_no FROM user_starry_bindings LIMIT 1").get() as { sync_page_no: number };
    expect(pageNo.sync_page_no).toBe(1);
  });

  it("resumes background sync from the last page pointer", async () => {
    const mcp = mockMcp(50, 30, 10);
    setEmailMcpClientFactory(() => mcp);
    // Simulate an interrupted previous run stopped at page 2
    getConn().prepare("UPDATE user_starry_bindings SET sync_page_no=?").run(2);

    await syncFollowedKolMail();
    expect(mcp.counters.getEmailConversation).toBe(5); // page 2 first 5

    await waitForBackgroundSync();
    // page 2 remainder (5) + page 3 (10)
    expect(mcp.counters.getEmailConversation).toBe(20);
  });
});
