import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { setEmailMcpClientFactory } from "../src/starrykol/service.js";
import { syncFollowedKolMail, waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
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

function mockMcp(readMs: number, count: number) {
  conversationId = 1000;
  const conversations = Array.from({ length: count }, nextConversation);
  const counters = { getEmailConversation: 0 };
  return {
    counters,
    async callTool(name: string, args: Json = {}): Promise<Json> {
      await new Promise((resolve) => setTimeout(resolve, readMs));
      if (name === "pageEmailConversations") {
        return { data: { pageNo: 1, pageSize: 50, total: count, list: conversations } };
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
    process.env.LG_DATA_DIR = tmp;
    resetConn();
    seedAll();
  });

  afterEach(async () => {
    await waitForBackgroundSync();
    getConn().close();
    setEmailMcpClientFactory();
  });

  it.each([
    { remoteCount: 30, syncCount: 30, readMs: 200, expectedMaxMs: 3000 },
    { remoteCount: 30, syncCount: 30, readMs: 1000, expectedMaxMs: 10000 },
    { remoteCount: 10, syncCount: 10, readMs: 1000, expectedMaxMs: 4000 },
    { remoteCount: 30, syncCount: 5, readMs: 1000, expectedMaxMs: 3000 },
  ])("syncs $remoteCount remote conversations with $syncCount local syncs and $readMs ms remote read", async ({ remoteCount, syncCount, readMs, expectedMaxMs }) => {
    setEmailMcpClientFactory(() => mockMcp(readMs, remoteCount));
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
    console.log(`after sync: getEmailConversation=${mcp.counters.getEmailConversation}`);
    expect(mcp.counters.getEmailConversation).toBe(5);
    await waitForBackgroundSync();
    console.log(`after background: getEmailConversation=${mcp.counters.getEmailConversation}`);
    expect(mcp.counters.getEmailConversation).toBe(12);
    const items = getConn().prepare("SELECT COUNT(*) as c FROM kol_mail_items").get() as { c: number };
    expect(items.c).toBeGreaterThanOrEqual(12);
  });
});
