import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { transitionTicketLifecyclePostgres } from "../src/ticket-lifecycle.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;

describePostgres("native PostgreSQL ticket lifecycle", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        data_version INTEGER NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        run_id TEXT,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_class TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        safe_summary TEXT,
        time TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(work_item_id,sequence)
      );
      CREATE TABLE IF NOT EXISTS ticket_command_receipts (
        idempotency_key TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_acceptances (
        ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
        acceptance_event_id TEXT,
        accepted_at TEXT NOT NULL,
        owner_user_id_at_acceptance TEXT NOT NULL,
        accepted_by_user_id TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        rules_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_audit_events (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        actor_user_id TEXT NOT NULL, command TEXT NOT NULL, request_json JSONB NOT NULL, result_json JSONB NOT NULL, created_at TEXT NOT NULL
      );
      TRUNCATE ticket_audit_events, ticket_acceptances, ticket_command_receipts, task_events, tickets CASCADE;
      INSERT INTO tickets (id,owner_user_id,task_type,title,status,data_version,created_at,updated_at)
      VALUES ('t-native-1','employee:native','manual_ticket','原生生命周期测试','waiting',1,'2031-01-01T00:00:00.000Z','2031-01-01T00:00:00.000Z');
    `);
  });

  afterAll(async () => {
    await closePostgresPool();
  });

  it("atomically commits accepted ticket, immutable lifecycle event, acceptance snapshot and replay receipt", async () => {
    const input = {
      ticketId: "t-native-1",
      action: "complete" as const,
      expectedVersion: 1,
      idempotencyKey: "native-ticket-lifecycle-idempotency-0001",
      actorId: "employee:native",
      acceptanceEvidence: { url: "https://example.test/evidence/1", note: "已验收" },
    };
    const first = await transitionTicketLifecyclePostgres(input);
    const replay = await transitionTicketLifecyclePostgres(input);
    expect(first).toMatchObject({ ticket_id: "t-native-1", status: "completed", version: 2, replayed: false });
    expect(replay).toMatchObject({ ...first, replayed: true });

    const rows = await postgresPool().query<{
      ticket_status: string;
      data_version: number;
      event_type: string;
      event_class: string;
      accepted_by: string;
      audit_command: string;
    }>(`
      SELECT t.status AS ticket_status,t.data_version,e.event_type,e.event_class,a.accepted_by_user_id AS accepted_by,
             ae.command AS audit_command
      FROM tickets t
      JOIN task_events e ON e.work_item_id=t.id
      JOIN ticket_acceptances a ON a.ticket_id=t.id
      JOIN ticket_audit_events ae ON ae.ticket_id=t.id
      WHERE t.id='t-native-1'
    `);
    expect(rows.rows).toEqual([{
      ticket_status: "completed",
      data_version: 2,
      event_type: "task.accepted",
      event_class: "lifecycle",
      accepted_by: "employee:native",
      audit_command: "ticket.complete",
    }]);
  });

  it("rejects a stale version without creating a lifecycle fact", async () => {
    await expect(transitionTicketLifecyclePostgres({
      ticketId: "t-native-1",
      action: "complete",
      expectedVersion: 2,
      idempotencyKey: "native-ticket-lifecycle-idempotency-0002",
      actorId: "employee:native",
      acceptanceEvidence: { note: "old version" },
    })).rejects.toMatchObject({ status: 409 });
    const count = await postgresPool().query<{ count: string }>("SELECT COUNT(*)::text AS count FROM task_events");
    expect(count.rows[0]?.count).toBe("0");
  });

  it("records explicit primary-assignee acceptance without completing the ticket", async () => {
    await postgresPool().query(
      `INSERT INTO tickets (id,owner_user_id,task_type,title,status,data_version,created_at,updated_at)
       VALUES ('t-native-accept','employee:native','manual_ticket','受理测试','pending',1,$1,$1)`,
      ["2031-01-01T00:00:00.000Z"],
    );
    const accepted = await transitionTicketLifecyclePostgres({
      ticketId: "t-native-accept",
      action: "accept",
      expectedVersion: 1,
      idempotencyKey: "native-ticket-accept-idempotency-0001",
      actorId: "employee:native",
    });
    expect(accepted).toMatchObject({ ticket_id: "t-native-accept", action: "accept", status: "accepted", version: 2 });
    const event = await postgresPool().query<{ status: string; event_type: string; event_class: string }>(
      "SELECT status,event_type,event_class FROM task_events WHERE work_item_id='t-native-accept'",
    );
    expect(event.rows).toEqual([{ status: "accepted", event_type: "task.claimed", event_class: "lifecycle" }]);
  });
});
