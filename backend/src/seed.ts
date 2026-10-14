import { ensureSystemCronJobs } from "./cron/store.js";
import { postgresDb, pgTransaction } from "./postgres/access.js";
import { seedDirectory } from "./host/grants.js";
import { seedKnowledge } from "./host/knowledge.js";
import { seedPostgresReferenceData } from "./postgres/reference-seed.js";
const DEMO_COLLAB_IDS = ["col_xiaomei", "col_laozhang", "col_mum", "col_trip"];
const DEMO_CREATOR_IDS = ["cr_xiaomei", "cr_laozhang", "cr_mum", "cr_outdoor"];
const DEMO_INBOUND_IDS = ["inb_unbound_1"];
const DEMO_SESSION_IDS = ["ses_demo_ot", "ses_demo_north"];
const DEMO_WORK_ITEM_IDS = [
  "tsk_home_xiaomei_mail",
  "tsk_home_xiaomei_lost",
  "tsk_home_laozhang_quote",
  "tsk_home_mum_nudge",
  "tsk_home_trip_stage",
  "tsk_home_outdoor_profile",
];
export async function seedIfEmpty(): Promise<void> {
  await seedCore();
}
export async function seedAll(): Promise<void> {
  await seedCore();
}
async function deleteCollaborationTree(conn: ReturnType<typeof postgresDb>, id: string): Promise<void> {
  (await conn.execute("DELETE FROM kol_mail_items WHERE collaboration_id=$1", id));
  (await conn.execute("DELETE FROM kol_mail_threads WHERE collaboration_id=$1", id));
  (await conn.execute("DELETE FROM kol_mail_seen WHERE collaboration_id=$1", id));
  (await conn.execute("UPDATE inbound SET collaboration_id=NULL WHERE collaboration_id=$1", id));
  const sessions = (await conn.many("SELECT id FROM sessions WHERE collaboration_id=$1", id)) as {
    id: string;
  }[];
  for (const row of sessions) {
    (await conn.execute("DELETE FROM messages WHERE session_id=$1", row.id));
    (await conn.execute("DELETE FROM drafts WHERE session_id=$1", row.id));
    (await conn.execute("DELETE FROM workers WHERE session_id=$1", row.id));
    (await conn.execute("DELETE FROM sessions WHERE id=$1", row.id));
  }
  (await conn.execute("DELETE FROM collaborations WHERE id=$1", id));
}
/** Fixture reset is restricted to a database created by the PostgreSQL test helper. */
export async function resetDemoRuntimeState(): Promise<void> {
  const url = new URL(String(process.env.DATABASE_URL || ""));
  const admin = new URL(String(process.env.TEST_DATABASE_URL || ""));
  const prefix = String(process.env.TEST_DB_PREFIX || "lingong_t");
  const name = decodeURIComponent(url.pathname.slice(1));
  const suffix = name.startsWith(`${prefix}_`) ? name.slice(prefix.length + 1) : "";
  if (process.env.NODE_ENV !== "test" || url.host !== admin.host || !/^\d+_\d+$/.test(suffix))
    throw new Error("Demo reset is restricted to a self-created isolated PostgreSQL test database");
  await pgTransaction(async (conn) => {
    const other = await conn.one("SELECT 1 FROM tickets WHERE NOT (id = ANY($1::text[])) LIMIT 1", DEMO_WORK_ITEM_IDS);
    if (other) {
      if (await conn.one("SELECT 1 FROM task_events WHERE work_item_id = ANY($1::text[]) AND event_class='lifecycle' LIMIT 1", DEMO_WORK_ITEM_IDS))
        throw new Error("Demo reset refuses to truncate mixed non-demo lifecycle facts");
      await conn.execute("DELETE FROM task_events WHERE work_item_id = ANY($1::text[])", DEMO_WORK_ITEM_IDS);
      await conn.execute("DELETE FROM tickets WHERE id = ANY($1::text[])", DEMO_WORK_ITEM_IDS);
    } else {
      // TRUNCATE is fixture teardown, not a runtime deletion of historical facts.
      // Row immutability triggers remain installed and enforce every subsequent write.
      await conn.command("TRUNCATE task_events, tickets CASCADE");
    }
    await cleanupDemoResources(conn);
  });
}
async function cleanupDemoResources(conn: ReturnType<typeof postgresDb>): Promise<void> {
  await conn.execute("DELETE FROM inbound WHERE id = ANY($1::text[])", DEMO_INBOUND_IDS);
  await conn.execute("DELETE FROM messages WHERE session_id = ANY($1::text[])", DEMO_SESSION_IDS);
  await conn.execute("DELETE FROM drafts WHERE session_id = ANY($1::text[])", DEMO_SESSION_IDS);
  await conn.execute("DELETE FROM workers WHERE session_id = ANY($1::text[])", DEMO_SESSION_IDS);
  await conn.execute("DELETE FROM sessions WHERE id = ANY($1::text[])", DEMO_SESSION_IDS);
  await conn.execute("DELETE FROM claw_creators WHERE id = ANY($1::text[])", DEMO_CREATOR_IDS);
  for (const id of DEMO_COLLAB_IDS) {
    if (await conn.one("SELECT 1 FROM tickets WHERE collaboration_id=$1 LIMIT 1", id))
      continue;
    await deleteCollaborationTree(conn, id);
  }
}
/** Explicit ops path. Do not call from production startup. */
export async function runLegacyDemoCleanup(): Promise<void> {
  await pgTransaction(async (conn) => {
    const removable = await conn.many<{
      id: string;
    }>(`SELECT t.id FROM tickets t WHERE t.id = ANY($1::text[])
      AND NOT EXISTS (SELECT 1 FROM task_events e WHERE e.work_item_id=t.id AND e.event_class='lifecycle')
      FOR UPDATE`, DEMO_WORK_ITEM_IDS);
    const ids = removable.map(row => row.id);
    await conn.execute("DELETE FROM task_events WHERE work_item_id = ANY($1::text[]) AND event_class IS DISTINCT FROM 'lifecycle'", ids);
    await conn.execute("DELETE FROM tickets WHERE id = ANY($1::text[])", ids);
    await cleanupDemoResources(conn);
  });
}
async function seedCore(): Promise<void> {
  const conn = postgresDb();
  await seedPostgresReferenceData();
  await seedDirectory();
  await seedKnowledge(conn);
  await conn.execute("INSERT INTO app_state (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", "persona", "sriphy");
  await seedMailboxOwners();
  await ensureSystemCronJobs(conn);
}
async function seedMailboxOwners(): Promise<void> {
  const conn = postgresDb();
  const owners = [
    ["kol.lt@litime.example", "LT", "钟槿年", "推广部", "personal", "active", "", "LT品牌往来邮件", "主要红人建联邮箱"],
    ["kol.ro@renogy.example", "RO", "陈冰冰", "推广部", "personal", "active", "", "RO品牌往来邮件", ""],
    ["kol.pq@powerqueen.example", "PQ", "黎玉燕", "推广部", "personal", "active", "", "PQ品牌往来邮件", "主要红人建联邮箱"],
    ["marketing.de@litime.com", "LT", "李伟瑜", "推广部", "shared", "active", "古佳睿", "LT欧洲品牌往来邮件", "两个邮箱两个人都在用"],
    ["amperetimemarketing.de@gmail.com", "LT", "古佳睿", "推广部", "shared", "active", "李伟瑜", "LT欧洲品牌往来邮件", ""],
  ];
  for (const row of owners) {
    await conn.execute(`INSERT INTO mailbox_owners
          (email,brand,owner_name,dept,account_type,status,shared_with,permission_scope,notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (email) DO UPDATE SET brand=EXCLUDED.brand,owner_name=EXCLUDED.owner_name,
           dept=EXCLUDED.dept,account_type=EXCLUDED.account_type,status=EXCLUDED.status,
           shared_with=EXCLUDED.shared_with,permission_scope=EXCLUDED.permission_scope,notes=EXCLUDED.notes`, ...row);
  }
}
