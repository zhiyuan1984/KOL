import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";

const backend = fileURLToPath(new URL("..", import.meta.url));
const migrationId = "20261015_mail_labels_peer_email";
const box = "operator@example.test";

function runPeerMigration(): { applied: string[]; database: string } {
  const output = execFileSync(process.execPath, [
    path.join(backend, "node_modules/tsx/dist/cli.mjs"),
    path.join(backend, "scripts/apply-postgres-schema.ts"),
    `--only=${migrationId}`,
  ], { cwd: backend, env: process.env, encoding: "utf8" });
  return JSON.parse(output.trim());
}

afterEach(async () => { await closePostgresPool(); });

describe("mail peer assignments PostgreSQL migration", () => {
  it("upgrades populated conversation assignments through the runner and skips a recorded replay", async () => {
    await freshTestDatabase();
    const pg = postgresPool();
    // Reconstruct only this disposable database's pre-042 assignment table.
    // The original 035 SQL and both ledgers model a real installation before 042.
    await pg.query("DROP TABLE mail_private_label_assignments");
    await pg.query(fs.readFileSync(new URL("../migrations/035_20261012_mail_private_labels.sql", import.meta.url), "utf8"));
    await pg.query("DELETE FROM app_schema_migrations WHERE id=$1", [migrationId]);
    await pg.query("DELETE FROM schema_migrations WHERE id=$1", [migrationId]);
    for (const user of ["peer-migration-a", "peer-migration-b"]) {
      await pg.query(`INSERT INTO mail_private_labels
        (id,user_id,mailbox,name,normalized_name,created_by,updated_by)
        VALUES ($1,$2,$3,'Follow up','follow up',$2,$2)`, [`label-${user}`, user, box]);
    }
    for (const [conversation, peer] of [
      ["peer-migration-1", "PEER-A@example.test"],
      ["peer-migration-2", "peer-a@example.test"],
      ["peer-migration-outbound", box],
    ]) {
      await pg.query(`INSERT INTO kol_mail_threads
        (id,conversation_id,mailbox,subject,peer_email,created_at,last_at,updated_at)
        VALUES ($1,$2,$3,'Migration test',$4,now(),now(),now())`, [`thread-${conversation}`, conversation, box, peer]);
    }
    await pg.query(`INSERT INTO kol_mail_items
      (id,thread_id,conversation_id,direction,from_addr,to_addr,occurred_at,created_at)
      VALUES ('peer-migration-item','thread-peer-migration-outbound','peer-migration-outbound','outbound',$1,'PEER-B@example.test',now(),now())`, [box]);
    const originalAssignments = [
      ["peer-migration-a", "peer-migration-1", "2026-10-01T00:00:00Z"],
      ["peer-migration-a", "peer-migration-2", "2026-10-02T00:00:00Z"],
      ["peer-migration-a", "peer-migration-outbound", "2026-10-03T00:00:00Z"],
      ["peer-migration-a", "peer-migration-orphan", "2026-10-04T00:00:00Z"],
      ["peer-migration-b", "peer-migration-1", "2026-10-05T00:00:00Z"],
    ];
    for (const [user, conversation, assignedAt] of originalAssignments) {
      await pg.query(`INSERT INTO mail_private_label_assignments
        (user_id,mailbox,conversation_id,label_id,assigned_at,assigned_by)
        VALUES ($1,$2,$3,$4,$5,$1)`, [user, box, conversation, `label-${user}`, assignedAt]);
    }
    expect(runPeerMigration()).toEqual({ applied: [migrationId], database: "postgres" });
    const rows = await pg.query("SELECT user_id,peer_email,assigned_at FROM mail_private_label_assignments ORDER BY user_id,peer_email");
    expect(rows.rows.map(row => ({ user: row.user_id, peer: row.peer_email, assignedAt: row.assigned_at.toISOString() }))).toEqual([
      { user: "peer-migration-a", peer: "peer-a@example.test", assignedAt: "2026-10-01T00:00:00.000Z" },
      { user: "peer-migration-a", peer: "peer-b@example.test", assignedAt: "2026-10-03T00:00:00.000Z" },
      { user: "peer-migration-b", peer: "peer-a@example.test", assignedAt: "2026-10-05T00:00:00.000Z" },
    ]);
    const columns = await pg.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mail_private_label_assignments'");
    expect(columns.rows.map(row => row.column_name)).not.toContain("conversation_id");
    expect(columns.rows.map(row => row.column_name)).toContain("peer_email");
    const constraint = await pg.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='mail_private_label_assignments'::regclass AND contype='p'");
    expect(constraint.rows[0].definition).toBe("PRIMARY KEY (user_id, mailbox, peer_email, label_id)");
    expect(runPeerMigration()).toEqual({ applied: [], database: "postgres" });
    const count = await pg.query("SELECT count(*)::int AS n FROM mail_private_label_assignments");
    expect(count.rows[0].n).toBe(3);
  });
});
