import { ensureSystemCronJobs } from "./cron/store.js";
import { getConn } from "./db.js";
import { seedDirectory } from "./host/grants.js";
import { seedKnowledge } from "./host/knowledge.js";

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

function allowStartupDemoCleanup(): boolean {
  if (process.env.LINGONG_ALLOW_SEED_CLEANUP === "1") return true;
  if (process.env.LINGONG_DISABLE_SEED_CLEANUP === "1") return false;
  return process.env.NODE_ENV !== "production";
}

export function seedIfEmpty(): void {
  seedCore();
  if (allowStartupDemoCleanup()) stripLegacyDemoData();
}

export function seedAll(): void {
  seedCore();
  stripLegacyDemoData();
}

function deleteCollaborationTree(conn: ReturnType<typeof getConn>, id: string): void {
  conn.prepare("DELETE FROM kol_mail_items WHERE collaboration_id=?").run(id);
  conn.prepare("DELETE FROM kol_mail_threads WHERE collaboration_id=?").run(id);
  conn.prepare("DELETE FROM kol_mail_seen WHERE collaboration_id=?").run(id);
  conn.prepare("UPDATE inbound SET collaboration_id=NULL WHERE collaboration_id=?").run(id);
  const sessions = conn.prepare("SELECT id FROM sessions WHERE collaboration_id=?").all(id) as { id: string }[];
  for (const row of sessions) {
    conn.prepare("DELETE FROM messages WHERE session_id=?").run(row.id);
    conn.prepare("DELETE FROM drafts WHERE session_id=?").run(row.id);
    conn.prepare("DELETE FROM workers WHERE session_id=?").run(row.id);
    conn.prepare("DELETE FROM sessions WHERE id=?").run(row.id);
  }
  conn.prepare("DELETE FROM collaborations WHERE id=?").run(id);
}

/** E2E / demo reset only. Wipe leftover official writes and tasks from prior runs. */
export function resetDemoRuntimeState(): void {
  const conn = getConn();
  conn.prepare("DELETE FROM starry_stage_writes").run();
  conn.prepare("DELETE FROM task_events").run();
  conn.prepare("DELETE FROM work_items").run();
  // Library sync keeps operator tags when Starry sends []. A workbench reset
  // must still drop them, or the next E2E case toggles 犹豫谨慎 off.
  conn.prepare("UPDATE collaborations SET follow_style_tags=NULL").run();
  conn.exec("DROP TRIGGER IF EXISTS stage_transitions_no_delete");
  try {
    conn.prepare("DELETE FROM stage_transitions").run();
  } finally {
    conn.exec(`
      CREATE TRIGGER IF NOT EXISTS stage_transitions_no_delete
      BEFORE DELETE ON stage_transitions
      BEGIN
        SELECT RAISE(ABORT, 'stage_transitions are immutable');
      END;
    `);
  }
  // Persistent data-e2e can keep Starry rows from a prior real-mode sync or
  // qq-01 detail lookup. Home followed-KOL is "current library", so drop
  // leftover library rows; the reset then re-syncs stub listAll (2 KOLs).
  // Demo fixture ids stay even if a test temporarily stamped kol_uid on them.
  const leftover = conn.prepare(
    `SELECT id FROM collaborations
     WHERE source = 'starry'
        OR (
          kol_uid IS NOT NULL AND trim(kol_uid) != ''
          AND id NOT IN (${DEMO_COLLAB_IDS.map(() => "?").join(",")})
        )`,
  ).all(...DEMO_COLLAB_IDS) as { id: string }[];
  for (const row of leftover) deleteCollaborationTree(conn, row.id);
}

/** Explicit ops path. Do not call from production startup. */
export function runLegacyDemoCleanup(): void {
  stripLegacyDemoData();
}

function seedCore(): void {
  const conn = getConn();
  seedDirectory();
  seedKnowledge(conn);
  conn.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('persona', 'sriphy')").run();
  seedMailboxOwners();
  ensureSystemCronJobs(conn);
}

function stripLegacyDemoData(): void {
  const conn = getConn();
  const legacyApprovals = conn.prepare(
    "SELECT id, wecom_card_id FROM approvals WHERE kind IN ('quote','stage','ingest','content','settlement')",
  ).all() as { id: string; wecom_card_id: string | null }[];
  for (const row of legacyApprovals) {
    if (row.wecom_card_id) conn.prepare("DELETE FROM wecom_cards WHERE id=?").run(row.wecom_card_id);
    conn.prepare("DELETE FROM wecom_cards WHERE approval_id=?").run(row.id);
    conn.prepare("DELETE FROM approvals WHERE id=?").run(row.id);
  }
  for (const id of DEMO_WORK_ITEM_IDS) {
    conn.prepare("DELETE FROM task_events WHERE work_item_id=?").run(id);
    conn.prepare("DELETE FROM work_items WHERE id=?").run(id);
  }
  for (const id of DEMO_INBOUND_IDS) conn.prepare("DELETE FROM inbound WHERE id=?").run(id);
  for (const id of DEMO_SESSION_IDS) {
    conn.prepare("DELETE FROM messages WHERE session_id=?").run(id);
    conn.prepare("DELETE FROM drafts WHERE session_id=?").run(id);
    conn.prepare("DELETE FROM sessions WHERE id=?").run(id);
  }
  for (const id of DEMO_CREATOR_IDS) conn.prepare("DELETE FROM claw_creators WHERE id=?").run(id);
  conn.exec("DROP TRIGGER IF EXISTS stage_transitions_no_delete");
  try {
    for (const id of DEMO_COLLAB_IDS) {
      conn.prepare("DELETE FROM stage_transitions WHERE collaboration_id=?").run(id);
    }
  } finally {
    conn.exec(`
      CREATE TRIGGER IF NOT EXISTS stage_transitions_no_delete
      BEFORE DELETE ON stage_transitions
      BEGIN
        SELECT RAISE(ABORT, 'stage_transitions are immutable');
      END;
    `);
  }
  for (const id of DEMO_COLLAB_IDS) deleteCollaborationTree(conn, id);
}

function seedMailboxOwners(): void {
  const conn = getConn();
  const owners = [
    ["kol.lt@litime.example", "LT", "钟槿年", "推广部", "personal", "active", "", "LT品牌往来邮件", "主要红人建联邮箱"],
    ["kol.ro@renogy.example", "RO", "陈冰冰", "推广部", "personal", "active", "", "RO品牌往来邮件", ""],
    ["kol.pq@powerqueen.example", "PQ", "黎玉燕", "推广部", "personal", "active", "", "PQ品牌往来邮件", "主要红人建联邮箱"],
    ["marketing.de@litime.com", "LT", "李伟瑜", "推广部", "shared", "active", "古佳睿", "LT欧洲品牌往来邮件", "两个邮箱两个人都在用"],
    ["amperetimemarketing.de@gmail.com", "LT", "古佳睿", "推广部", "shared", "active", "李伟瑜", "LT欧洲品牌往来邮件", ""],
  ];
  const ins = conn.prepare(
    `INSERT OR REPLACE INTO mailbox_owners
     (email, brand, owner_name, dept, account_type, status, shared_with, permission_scope, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  for (const row of owners) ins.run(...row);
}
