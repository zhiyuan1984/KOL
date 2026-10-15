import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withScopedUser, type AppUser } from "../src/auth.js";
import { authorizeMailSync } from "../src/mail/sync-job.js";
import { setEmailMcpClientFactory } from "../src/starrykol/service.js";
import { syncFollowedKolMail, type MailSyncAuthorizedScope, waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
import type { Json } from "../src/types.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { pgVisibleSkillIdsForUser } from "../src/postgres/auth-pg.js";
import { createAgentBinding, syncUserOrganization } from "../src/runtime/organization-tree.js";
import { getAgentSkills, setAgentSkill } from "../src/runtime/store.js";
import { freshTestDatabase } from "./support/pg.js";
import { seedPublishedAgent } from "./fixtures/runtime-auth.js";

let conversationId = 1000;
const ACTOR_ID = "mail-sync-perf-actor";
const MAILBOX = "larry.zhao@amperetime.com";
const CREDENTIAL = "cred_native_mail_sync_12345678";
const AGENT_ID = "agent:mail-perf";
const ORG_UNIT_ID = "org:lt_team";
const COMPANY_ID = "company:amperetime";
const MAIL_SYNC_SKILLS = ["email_conversation_list", "email_conversation_read"] as const;

function actor(): AppUser {
  return {
    id: ACTOR_ID, username: ACTOR_ID, name: "Native mail performance actor", handle: ACTOR_ID,
    email: MAILBOX, phone: "", roles: ["employee"], role: "employee", brands: ["LT"], site: ORG_UNIT_ID,
    manager_user_id: null, active: true, exam_passed: true, exam_todo_count: 0, exam_module: "",
  };
}

async function seedNativeAuthorization(): Promise<void> {
  const now = new Date().toISOString();
  const pool = postgresPool();
  await pool.query(
    `INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email)
     VALUES ($1,$2,$3,'test-only',$4,$5,$6,1,$7,$7,$8)`,
    [ACTOR_ID, ACTOR_ID, "Native mail performance actor", JSON.stringify(["employee"]), JSON.stringify(["LT"]), ORG_UNIT_ID, now, MAILBOX],
  );
  await seedPublishedAgent(AGENT_ID, "Native mail performance agent");
  for (const skill of MAIL_SYNC_SKILLS) {
    const current = (await getAgentSkills(AGENT_ID)).find((row) => row.skill_id === skill);
    await setAgentSkill(AGENT_ID, skill, true, Number(current?.version || 0));
  }
  const personRef = await syncUserOrganization(ACTOR_ID, ORG_UNIT_ID);
  await createAgentBinding({
    agent_id: AGENT_ID,
    target_type: "person",
    target_id: personRef,
    company_id: COMPANY_ID,
    source: "isolated-native-test",
  });
  const visibleSkills = await pgVisibleSkillIdsForUser(ACTOR_ID, new Date().toISOString());
  for (const skill of MAIL_SYNC_SKILLS) expect(visibleSkills).toContain(skill);
  await pool.query(
    `INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,bearer_token,status,updated_at)
     VALUES ($1,$2,1,$3,'connected',$4)`, [ACTOR_ID, MAILBOX, CREDENTIAL, now],
  );
}

/** The index-first receipt is not hydration completion; observe the durable PG result instead. */
async function waitForFollowedMailSync(expectedItems: number): Promise<void> {
  await expect.poll(async () => {
    const result = await postgresPool().query<{ item_count: number; sync_page_no: number }>(
      `SELECT (SELECT count(*)::int FROM kol_mail_items) AS item_count, sync_page_no
         FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2`,
      [ACTOR_ID, MAILBOX],
    );
    return {
      item_count: Number(result.rows[0]?.item_count || 0),
      sync_page_no: Number(result.rows[0]?.sync_page_no || 0),
    };
  }, { timeout: 30_000 }).toEqual({ item_count: expectedItems, sync_page_no: 1 });
  await waitForBackgroundSync();
}

/** A partial remote body failure is complete only after its durable failure audit is committed. */
async function waitForPartialBackgroundFailure(): Promise<void> {
  await expect.poll(async () => {
    const result = await postgresPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mail_sync_audit
       WHERE event_type='starrykol.followed_mail_sync_background_failed'`,
    );
    return Number(result.rows[0]?.n || 0);
  }, { timeout: 30_000 }).toBe(1);
  await waitForBackgroundSync();
}

async function nativeSync(): Promise<Awaited<ReturnType<typeof syncFollowedKolMail>>> {
  return withScopedUser(actor(), async () => {
    const authorization = await authorizeMailSync(MAILBOX);
    return syncFollowedKolMail(MAILBOX, {
      actorId: authorization.actor.id,
      authorizedScope: authorization.scope as MailSyncAuthorizedScope,
      durable: false,
    });
  });
}

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
      if (name === "pageMailboxes") return { data: { list: [] } };
      if (name === "pageKolProfiles" || name === "listAllKolProfiles") {
        return { data: { total: 0, list: [] } };
      }
      throw new Error(`unexpected tool ${name}`);
    },
    async close() { /* noop */ },
  };
}

describe("mail sync performance", () => {
  beforeEach(async () => {
    await freshTestDatabase({ reclaimPrevious: true });
    await seedNativeAuthorization();
  });

  afterEach(async () => {
    await waitForBackgroundSync();
    setEmailMcpClientFactory();
    await closePostgresPool();
  });

  it.each([
    { remoteCount: 30, syncCount: 30, readMs: 200, expectedMaxMs: 3000, pageSize: 30 },
    { remoteCount: 30, syncCount: 30, readMs: 1000, expectedMaxMs: 10000, pageSize: 30 },
    { remoteCount: 10, syncCount: 10, readMs: 1000, expectedMaxMs: 4000 },
    { remoteCount: 30, syncCount: 5, readMs: 1000, expectedMaxMs: 3000, pageSize: 30 },
  ])("syncs $remoteCount remote conversations with $syncCount local syncs and $readMs ms remote read", async ({ remoteCount, syncCount, readMs, expectedMaxMs, pageSize }) => {
    setEmailMcpClientFactory(() => mockMcp(readMs, remoteCount, pageSize));
    const start = Date.now();
    const result = await nativeSync();
    const elapsed = Date.now() - start;
    console.log(`remoteCount=${remoteCount} syncCount=${syncCount} readMs=${readMs} elapsed=${elapsed}ms conversations=${result.conversations}`);
    expect(result.conversations).toBe(remoteCount);
    expect(elapsed).toBeLessThan(expectedMaxMs);
  });

  it("hydrates remaining conversations in the background", async () => {
    const mcp = mockMcp(100, 12);
    setEmailMcpClientFactory(() => mcp);
    const result = await nativeSync();
    expect(result).toMatchObject({ ok: true, index_updated: 10, body_pending: 10 });
    const indexed = await postgresPool().query<{ n: number }>("SELECT count(*)::int AS n FROM kol_mail_threads");
    expect(Number(indexed.rows[0].n)).toBe(10);
    await waitForFollowedMailSync(12);
    expect(mcp.counters.getEmailConversation).toBe(12);
    const items = await postgresPool().query<{ n: number }>("SELECT count(*)::int AS n FROM kol_mail_items");
    expect(Number(items.rows[0].n)).toBeGreaterThanOrEqual(12);
  });

  it("commits the first-page index before any delayed body request completes", async () => {
    const mcp = mockMcp(0, 10);
    const original = mcp.callTool.bind(mcp);
    let releaseBody!: () => void;
    const bodyGate = new Promise<void>((resolve) => { releaseBody = resolve; });
    let bodyStarted!: () => void;
    const bodyStartedPromise = new Promise<void>((resolve) => { bodyStarted = resolve; });
    mcp.callTool = async (name: string, args: Json = {}) => {
      if (name === "getEmailConversation") {
        bodyStarted();
        await bodyGate;
      }
      return original(name, args);
    };
    setEmailMcpClientFactory(() => mcp);

    const sync = nativeSync();
    try {
      await bodyStartedPromise;
      const indexed = await postgresPool().query<{ n: number }>("SELECT count(*)::int AS n FROM kol_mail_threads");
      expect(Number(indexed.rows[0].n)).toBe(10);
      const bodiesBeforeRelease = await postgresPool().query<{ n: number }>("SELECT count(*)::int AS n FROM kol_mail_items");
      expect(Number(bodiesBeforeRelease.rows[0].n)).toBe(0);
    } finally {
      releaseBody();
      const result = await sync;
      expect(result).toMatchObject({ ok: true, index_updated: 10, body_pending: 10 });
      await waitForFollowedMailSync(10);
    }
    expect(mcp.counters.getEmailConversation).toBe(10);
  });

  it("keeps indexed threads and deduplicates completed bodies after a partial remote failure", async () => {
    const mcp = mockMcp(0, 10);
    const original = mcp.callTool.bind(mcp);
    let failuresLeft = 2; // one read plus its one safe session-rebuild retry
    const detailAttempts: string[] = [];
    mcp.callTool = async (name: string, args: Json = {}) => {
      if (name === "getEmailConversation") detailAttempts.push(String(args.conversationId));
      if (name === "getEmailConversation" && String(args.conversationId) === "1000" && failuresLeft > 0) {
        failuresLeft -= 1;
        throw Object.assign(new Error("fixture upstream unavailable"), { remoteStatus: 503 });
      }
      return original(name, args);
    };
    setEmailMcpClientFactory(() => mcp);

    const first = await nativeSync();
    expect(first).toMatchObject({ ok: true, index_updated: 10 });
    await waitForPartialBackgroundFailure();
    const afterFailure = await postgresPool().query<{ n: number }>("SELECT count(*)::int AS n FROM kol_mail_threads");
    expect(afterFailure.rows[0].n).toBe(10);
    const partialItems = await postgresPool().query<{ n: number }>("SELECT count(*)::int AS n FROM kol_mail_items");
    expect(partialItems.rows[0].n).toBeLessThan(10);

    await nativeSync();
    await waitForFollowedMailSync(10);
    const itemCounts = await postgresPool().query<{ total: number; distinct_count: number }>(
      "SELECT count(*)::int AS total,count(DISTINCT provider_message_id)::int AS distinct_count FROM kol_mail_items",
    );
    expect(detailAttempts.filter((conversationId) => conversationId === "1000")).toHaveLength(3);
    expect(itemCounts.rows[0].total).toBe(itemCounts.rows[0].distinct_count);
    expect(itemCounts.rows[0].total).toBeGreaterThanOrEqual(10);
  });

  it("hydrates conversations across multiple pages in the background", async () => {
    const mcp = mockMcp(50, 30, 10); // 3 pages of 10
    setEmailMcpClientFactory(() => mcp);
    const start = Date.now();
    const result = await nativeSync();
    const elapsed = Date.now() - start;
    expect(result.conversations).toBe(10); // first page list length
    expect(elapsed).toBeLessThan(1000);    // foreground only

    await waitForFollowedMailSync(30);
    expect(mcp.counters.getEmailConversation).toBe(30);

    const items = await postgresPool().query<{ n: number }>("SELECT count(*)::int AS n FROM kol_mail_items");
    expect(Number(items.rows[0].n)).toBeGreaterThanOrEqual(30);

    const pageNo = await postgresPool().query<{ sync_page_no: number }>("SELECT sync_page_no FROM user_starry_bindings WHERE user_id=$1", [ACTOR_ID]);
    expect(Number(pageNo.rows[0].sync_page_no)).toBe(1);
  });

  it("resumes background sync from the last page pointer", async () => {
    const mcp = mockMcp(50, 30, 10);
    setEmailMcpClientFactory(() => mcp);
    // Simulate an interrupted previous run stopped at page 2
    await postgresPool().query("UPDATE user_starry_bindings SET sync_page_no=2 WHERE user_id=$1", [ACTOR_ID]);

    const resumed = await nativeSync();
    expect(resumed.conversations).toBe(10); // second page is the committed foreground index

    await waitForFollowedMailSync(20);
    // page 2 remainder (5) + page 3 (10)
    expect(mcp.counters.getEmailConversation).toBe(20);
  });
});
