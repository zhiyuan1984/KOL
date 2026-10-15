import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";

const legacyMigration = fs.readFileSync(new URL("../migrations/035_20261012_mail_private_labels.sql", import.meta.url), "utf8");
const peerMigration = fs.readFileSync(new URL("../migrations/042_20261015_mail_labels_peer_email.sql", import.meta.url), "utf8");

beforeEach(async () => {
  await freshTestDatabase();
});

describe("mail private label production migration contract", () => {
  it("clones the fully migrated peer-email schema instead of replaying a retired conversation index", async () => {
    const columns = await postgresPool().query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mail_private_label_assignments'",
    );
    expect(columns.rows.map((row) => row.column_name)).toContain("peer_email");
    expect(columns.rows.map((row) => row.column_name)).not.toContain("conversation_id");
    const indexes = await postgresPool().query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='mail_private_label_assignments'",
    );
    expect(indexes.rows.length).toBeGreaterThan(0);
    expect(indexes.rows.every((row) => !row.indexdef.includes("conversation_id"))).toBe(true);
    expect(indexes.rows.some((row) => row.indexdef.includes("peer_email"))).toBe(true);
  });

  it("upgrades the real legacy tables, merges same-peer assignments and preserves private scope", async () => {
    const db = postgresPool();
    // Only this isolated clone is reset to the old migration boundary. Runtime
    // tests use the final template; migration tests own their legacy starting state.
    await db.query("DROP TABLE mail_private_label_assignments; DROP TABLE mail_private_labels; DROP TABLE mail_private_label_states");
    await db.query(legacyMigration);
    await db.query(`INSERT INTO kol_mail_threads(id,conversation_id,mailbox,peer_email,created_at,updated_at)
      VALUES ('migration-thread-a','migration-conv-a','box@example.test','Peer@Example.Test',now(),now()),
             ('migration-thread-b','migration-conv-b','box@example.test','peer@example.test',now(),now()),
             ('migration-thread-out','migration-conv-out','box@example.test','box@example.test',now(),now())`);
    await db.query(`INSERT INTO kol_mail_items(id,thread_id,conversation_id,direction,to_addr,body_text,created_at,occurred_at)
      VALUES ('migration-outbound','migration-thread-out','migration-conv-out','outbound','other@example.test','fixture',now(),now())`);
    await db.query(`INSERT INTO mail_private_labels(id,user_id,mailbox,name,normalized_name,created_by,updated_by)
      VALUES ('migration-label-a','user-a','box@example.test','Follow up','follow up','user-a','user-a'),
             ('migration-label-b','user-b','box@example.test','Follow up','follow up','user-b','user-b')`);
    await db.query(`INSERT INTO mail_private_label_assignments(user_id,mailbox,conversation_id,label_id,assigned_by,assigned_at)
      VALUES ('user-a','box@example.test','migration-conv-a','migration-label-a','user-a','2026-10-01T00:00:00Z'),
             ('user-a','box@example.test','migration-conv-b','migration-label-a','user-a','2026-10-02T00:00:00Z'),
             ('user-b','box@example.test','migration-conv-a','migration-label-b','user-b','2026-10-03T00:00:00Z'),
             ('user-a','box@example.test','migration-conv-out','migration-label-a','user-a','2026-10-04T00:00:00Z')`);
    await db.query(peerMigration);
    const migrated = await db.query<{ user_id: string; peer_email: string; assigned_at: Date }>(
      "SELECT user_id,peer_email,assigned_at FROM mail_private_label_assignments ORDER BY user_id,peer_email",
    );
    expect(migrated.rows.map((row) => ({ user_id: row.user_id, peer_email: row.peer_email }))).toEqual([
      { user_id: "user-a", peer_email: "other@example.test" },
      { user_id: "user-a", peer_email: "peer@example.test" },
      { user_id: "user-b", peer_email: "peer@example.test" },
    ]);
    expect(migrated.rows[1].assigned_at.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
