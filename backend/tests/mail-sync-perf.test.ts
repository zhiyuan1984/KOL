import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withScopedUser, type AppUser } from "../src/auth.js";
import { authorizeMailSync } from "../src/mail/sync-job.js";
import { setEmailMcpClientFactory } from "../src/starrykol/service.js";
import { syncFollowedKolMail, type MailSyncAuthorizedScope, waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
import type { Json } from "../src/types.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";

let conversationId = 1000;
const ACTOR_ID = "mail-sync-perf-actor";
const MAILBOX = "larry.zhao@amperetime.com";
const CREDENTIAL = "cred_native_mail_sync_12345678";

function actor(): AppUser {
  return {
    id: ACTOR_ID, username: ACTOR_ID, name: "Native mail performance actor", handle: ACTOR_ID,
    email: MAILBOX, phone: "", roles: ["employee"], role: "employee", brands: [], site: "",
    manager_user_id: null, active: true, exam_passed: true, exam_todo_count: 0, exam_module: "",
  };
}

async function seedNativeAuthorization(): Promise<void> {
  const now = new Date().toISOString();
  const pool = postgresPool();
  await pool.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email)
     VALUES ($1,$2,$3,'test-only',$4,'[]','',1,$5,$5,$6)`, [ACTOR_ID, ACTOR_ID, "Native mail performance actor", JSON.stringify(["employee"]), now, MAILBOX]);
  await pool.query(`INSERT INTO managed_agents(id,name,description,status,version,created_at,updated_at)
     VALUES ('agent:mail-perf','Native mail performance agent','test-only','published',1,$1,$1)`, [now]);
  for (const skill of ["email_conversation_list", "email_conversation_read"]) {
    await pool.query("INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at) VALUES ('agent:mail-perf',$1,1,1,$2)", [skill, now]);
  }
  await pool.query(`INSERT INTO organization_people(person_ref,display_name,user_ref,user_id,status,source,created_at,updated_at)
     VALUES ('person:mail-perf','Native mail performance actor',$1,$1,'active','test',$2,$2)`, [ACTOR_ID, now]);
  await pool.query(`INSERT INTO agent_bindings
     (id,agent_id,target_type,target_id,company_id,status,binding_version,org_version,created_at,updated_at)
     VALUES ('binding:mail-perf','agent:mail-perf','person','person:mail-perf','company:test','active',1,1,$1,$1)`, [now]);
  await pool.query(`INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,bearer_token,status,updated_at)
     VALUES ($1,$2,1,$3,'connected',$4)`, [ACTOR_ID, MAILBOX, CREDENTIAL, now]);
}
async function nativeSync(): Promise<Awaited<ReturnType<typeof syncFollowedKolMail>>> {
  return (await withScopedUser(actor(), async () => {
    const authorization = await authorizeMailSync(MAILBOX);
    return (await syncFollowedKolMail(MAILBOX, {
      actorId: authorization.actor.id,
      authorizedScope: authorization.scope as MailSyncAuthorizedScope,
      durable: false,
    }));
  }));
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
      if (name === "pageMailboxes")
        return { data: { list: [] } };
      if (name === "pageKolProfiles" || name === "listAllKolProfiles") {
        return { data: { total: 0, list: [] } };
      }
      throw new Error(`unexpected tool ${name}`);
    },
    async close() { },
  };
}
describe("mail sync performance", () => {
  beforeEach(async () => {
    await freshTestDatabase();
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
    const indexed = await postgresPool().query<{
      n: number;
    }>("SELECT count(*)::int AS n FROM kol_mail_threads");
    expect(Number(indexed.rows[0].n)).toBe(10);
    await waitForBackgroundSync();
    expect(mcp.counters.getEmailConversation).toBe(12);
    const items = await postgresPool().query<{
      n: number;
    }>("SELECT count(*)::int AS n FROM kol_mail_items");
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
      return (await original(name, args));
    };
    setEmailMcpClientFactory(() => mcp);
    try {
      const result = await nativeSync();
      await bodyStartedPromise;
      expect(result).toMatchObject({ ok: true, index_updated: 10, body_pending: 10 });
      const indexed = await postgresPool().query<{
        n: number;
      }>("SELECT count(*)::int AS n FROM kol_mail_threads");
      expect(Number(indexed.rows[0].n)).toBe(10);
      const bodiesBeforeRelease = await postgresPool().query<{
        n: number;
      }>("SELECT count(*)::int AS n FROM kol_mail_items");
      expect(Number(bodiesBeforeRelease.rows[0].n)).toBe(0);
    }
    finally {
      releaseBody();
      await waitForBackgroundSync();
    }
    expect(mcp.counters.getEmailConversation).toBe(10);
  });

  it("keeps indexed threads and deduplicates completed bodies after a partial remote failure", async () => {
    const mcp = mockMcp(0, 10);
    const original = mcp.callTool.bind(mcp);
    let failuresLeft = 2; // one read plus its one safe session-rebuild retry
    mcp.callTool = async (name: string, args: Json = {}) => {
      if (name === "getEmailConversation" && String(args.conversationId) === "1000" && failuresLeft > 0) {
        failuresLeft -= 1;
        throw Object.assign(new Error("fixture upstream unavailable"), { remoteStatus: 503 });
      }
      return (await original(name, args));
    };
    setEmailMcpClientFactory(() => mcp);
    const first = await nativeSync();
    expect(first).toMatchObject({ ok: true, index_updated: 10 });
    await waitForBackgroundSync();
    const afterFailure = await postgresPool().query<{
      n: number;
    }>("SELECT count(*)::int AS n FROM kol_mail_threads");
    expect(afterFailure.rows[0].n).toBe(10);
    const partialItems = await postgresPool().query<{
      n: number;
    }>("SELECT count(*)::int AS n FROM kol_mail_items");
    expect(partialItems.rows[0].n).toBeLessThan(10);
    await nativeSync();
    await waitForBackgroundSync();
    const itemCounts = await postgresPool().query<{
      total: number;
      distinct_count: number;
    }>("SELECT count(*)::int AS total,count(DISTINCT provider_message_id)::int AS distinct_count FROM kol_mail_items");
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
    await waitForBackgroundSync();
    expect(mcp.counters.getEmailConversation).toBe(30);
    const items = await postgresPool().query<{
      n: number;
    }>("SELECT count(*)::int AS n FROM kol_mail_items");
    expect(Number(items.rows[0].n)).toBeGreaterThanOrEqual(30);
    const pageNo = await postgresPool().query<{
      sync_page_no: number;
    }>("SELECT sync_page_no FROM user_starry_bindings WHERE user_id=$1", [ACTOR_ID]);
    expect(Number(pageNo.rows[0].sync_page_no)).toBe(1);
  });
  it("resumes background sync from the last page pointer", async () => {
    const mcp = mockMcp(50, 30, 10);
    setEmailMcpClientFactory(() => mcp);
    // Simulate an interrupted previous run stopped at page 2
    await postgresPool().query("UPDATE user_starry_bindings SET sync_page_no=2 WHERE user_id=$1", [ACTOR_ID]);

    const resumed = await nativeSync();
    expect(resumed.conversations).toBe(10); // second page is the committed foreground index

    await waitForBackgroundSync();
    // page 2 remainder (5) + page 3 (10)
    expect(mcp.counters.getEmailConversation).toBe(20);
  });
});
