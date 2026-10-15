import { pgEnsureSystemCronJobs } from "./cron/postgres-store.js";
import { getConn, tx } from "./db.js";
import { seedDirectory, seedKnowledge } from "./postgres/bootstrap-seed.js";

const DEMO_COLLAB_IDS = ["col_xiaomei", "col_laozhang", "col_mum", "col_trip"];

/** Bootstrap existing catalog content only; never erase migrated facts or change schema at startup. */
export async function seedIfEmpty(): Promise<void> { await seedCore(); }
export async function seedAll(): Promise<void> { await seedCore(); }
async function seedCore(): Promise<void> {
  await tx(async (client) => {
    await seedDirectory(client);
    await seedKnowledge(client);
    await client.query("INSERT INTO app_state (key,value) VALUES ('persona','sriphy') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
    await seedMailboxOwners(client);
    await client.query("UPDATE collaborations SET list_in_projects=1 WHERE id=ANY($1::text[])", [DEMO_COLLAB_IDS]);
  });
  await pgEnsureSystemCronJobs();
}

/** Destructive demo reset is permitted only against an explicitly prefixed isolated test database. */
export async function assertDisposableTestDatabase(): Promise<void> {
  const prefix = String(process.env.TEST_DB_PREFIX || "");
  if (process.env.NODE_ENV !== "test" || !/^[a-z_][a-z0-9_]+$/.test(prefix)) throw new Error("fixture writes require an explicit isolated TEST_DB_PREFIX and NODE_ENV=test");
  const { rows } = await getConn().query<{ name: string }>("SELECT current_database() AS name");
  if (!rows[0]?.name.startsWith(`${prefix}_`)) throw new Error("refusing fixture writes outside the isolated test database prefix");
}
export async function resetDemoRuntimeState(): Promise<void> {
  await assertDisposableTestDatabase();
  await tx(async (client) => {
    // TRUNCATE on disposable fixtures does not weaken/recreate immutable row triggers.
    await client.query("TRUNCATE starry_stage_writes,task_events,tickets,business_events,stage_transitions CASCADE");
    await client.query("UPDATE collaborations SET follow_style_tags=NULL");
    const rows = (await client.query<{ id: string }>("SELECT id FROM collaborations WHERE source='starry' OR (kol_uid IS NOT NULL AND trim(kol_uid)<>'' AND NOT (id=ANY($1::text[])))", [DEMO_COLLAB_IDS])).rows;
    for (const row of rows) {
      for (const table of ["kol_mail_items","kol_mail_threads","kol_mail_seen"] as const) await client.query(`DELETE FROM ${table} WHERE collaboration_id=$1`, [row.id]);
      await client.query("UPDATE inbound SET collaboration_id=NULL WHERE collaboration_id=$1", [row.id]);
      await client.query("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE collaboration_id=$1)", [row.id]);
      await client.query("DELETE FROM drafts WHERE session_id IN (SELECT id FROM sessions WHERE collaboration_id=$1)", [row.id]);
      await client.query("DELETE FROM workers WHERE session_id IN (SELECT id FROM sessions WHERE collaboration_id=$1)", [row.id]);
      await client.query("DELETE FROM sessions WHERE collaboration_id=$1", [row.id]);
      await client.query("DELETE FROM collaborations WHERE id=$1", [row.id]);
    }
  });
}
import type { PoolClient } from "pg";
async function seedMailboxOwners(client: PoolClient): Promise<void> {
  const owners = [
    ["kol.lt@litime.example", "LT", "钟槿年", "推广部", "personal", "active", "", "LT品牌往来邮件", "主要红人建联邮箱"],
    ["kol.ro@renogy.example", "RO", "陈冰冰", "推广部", "personal", "active", "", "RO品牌往来邮件", ""],
    ["kol.pq@powerqueen.example", "PQ", "黎玉燕", "推广部", "personal", "active", "", "PQ品牌往来邮件", "主要红人建联邮箱"],
    ["marketing.de@litime.com", "LT", "李伟瑜", "推广部", "shared", "active", "古佳睿", "LT欧洲品牌往来邮件", "两个邮箱两个人都在用"],
    ["amperetimemarketing.de@gmail.com", "LT", "古佳睿", "推广部", "shared", "active", "李伟瑜", "LT欧洲品牌往来邮件", ""],
  ];
  for (const row of owners) await client.query(
    "INSERT INTO mailbox_owners (email,brand,owner_name,dept,account_type,status,shared_with,permission_scope,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (email) DO UPDATE SET brand=EXCLUDED.brand,owner_name=EXCLUDED.owner_name,dept=EXCLUDED.dept,account_type=EXCLUDED.account_type,status=EXCLUDED.status,shared_with=EXCLUDED.shared_with,permission_scope=EXCLUDED.permission_scope,notes=EXCLUDED.notes", row,
  );
}
