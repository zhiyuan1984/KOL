import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConn } from "../src/db.js";
import { recordEffectiveCorrespondence } from "../src/host/kol-memory.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { updateCollaborationConversationPg } from "../src/starrykol/mail-sync-pg.js";
import { freshTestDatabase } from "./support/pg.js";

const NOW = "2026-10-09T12:00:00.000Z";

beforeEach(async () => {
  await freshTestDatabase();
  resetConn();
});

afterEach(async () => {
  resetConn();
  await closePostgresPool();
});

describe("mail sync PostgreSQL regressions", () => {
  it("updates only collaboration conversation_id when the real table has no updated_at", async () => {
    const pool = postgresPool();
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name='collaborations' AND column_name='updated_at'`,
    );
    expect(columns.rows).toEqual([]);
    await pool.query(
      `INSERT INTO collaborations
       (id,handle,display_name,brand,email,mailbox_from,lifecycle_id,conversation_id,stage_code,owner_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      ["col-mail-sync-pg", "creator", "Creator", "LT", "creator@example.test", "team@litime.com", "lc-mail-sync", "conv_local", "INTERESTED", "Owner A"],
    );

    await updateCollaborationConversationPg("conv_remote_123", "col-mail-sync-pg");

    const row = await pool.query<{ conversation_id: string; stage_code: string; owner_name: string }>(
      "SELECT conversation_id,stage_code,owner_name FROM collaborations WHERE id=$1",
      ["col-mail-sync-pg"],
    );
    expect(row.rows[0]).toEqual({
      conversation_id: "conv_remote_123",
      stage_code: "INTERESTED",
      owner_name: "Owner A",
    });
  });

  it("does not regress the correspondence clock for stale, missing, or invalid event times", async () => {
    const pool = postgresPool();
    await pool.query(
      `INSERT INTO kol_follow_index
       (id,company_id,kol_uid,scope_brand,employee_id,employee_name,status,claimed_at,
        last_effective_mail_at,release_due_at,data_version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,7,$7,$7)`,
      [
        "follow-mail-clock", "company:test", "KOL_MAIL_CLOCK", "LT", "user:owner", "Owner",
        NOW, NOW, "2026-10-23T12:00:00.000Z",
      ],
    );

    const stale = recordEffectiveCorrespondence({
      followId: "follow-mail-clock",
      direction: "inbound",
      gatewaySuccess: true,
      kind: "human",
      occurredAt: "2026-10-08T12:00:00.000Z",
    });
    const missing = recordEffectiveCorrespondence({
      followId: "follow-mail-clock",
      direction: "inbound",
      gatewaySuccess: true,
      kind: "human",
    });
    const invalid = recordEffectiveCorrespondence({
      followId: "follow-mail-clock",
      direction: "inbound",
      gatewaySuccess: true,
      kind: "human",
      occurredAt: "not-a-timestamp",
    });
    const newerLocalSend = recordEffectiveCorrespondence({
      followId: "follow-mail-clock",
      direction: "outbound",
      gatewaySuccess: true,
      kind: "human",
      occurredAt: "2026-10-10T12:00:00.000Z",
    });

    expect(stale).toMatchObject({ renewed: false, effective: true, reason: "out_of_order" });
    expect(missing).toMatchObject({ renewed: false, effective: true, reason: "occurred_at_missing" });
    expect(invalid).toMatchObject({ renewed: false, effective: true, reason: "occurred_at_invalid" });
    expect(newerLocalSend).toMatchObject({ renewed: true, effective: true, reason: "human" });

    const row = await pool.query<{ last_effective_mail_at: string; release_due_at: string; data_version: string }>(
      "SELECT last_effective_mail_at,release_due_at,data_version FROM kol_follow_index WHERE id=$1",
      ["follow-mail-clock"],
    );
    expect(row.rows[0]).toEqual({
      last_effective_mail_at: "2026-10-10T12:00:00.000Z",
      release_due_at: "2026-10-24T12:00:00.000Z",
      data_version: "8",
    });
  });
});
