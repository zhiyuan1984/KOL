import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import {
  classifyTicket,
  ensureTicketForWorkItem,
  reconcileTickets,
  resetTicketTypesCache,
} from "../src/tickets.js";
import { freshTestDatabase } from "./support/pg.js";

const CLASSIFIED_FLAG = "tickets_classified_v1";

async function insertTicket(id: string, overrides: Partial<{ owner: string; taskType: string; source: string; collaborationId: string }> = {}): Promise<void> {
  const now = new Date().toISOString();
  await postgresPool().query(
    `INSERT INTO tickets
     (id,owner_user_id,task_type,title,source,status,priority,skill,profile,collaboration_id,input,entities,data_version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'pending','normal',$3,'lead',$6,'{}','{}',1,$7,$7)`,
    [id, overrides.owner || "usr_task_facts", overrides.taskType || "risk_scan", "测试工单", overrides.source || "manual", overrides.collaborationId || null, now],
  );
}

async function ticketRow(id: string) {
  const result = await postgresPool().query<{
    id: string; kind: string; channel: string; requester_type: string; requester_id: string | null;
    object_type: string | null; object_id: string | null; kind_version: number;
  }>("SELECT id,kind,channel,requester_type,requester_id,object_type,object_id,kind_version FROM tickets WHERE id=$1", [id]);
  return result.rows[0];
}

beforeEach(async () => {
  resetTicketTypesCache();
  await freshTestDatabase();
});

afterEach(async () => {
  resetTicketTypesCache();
  await closePostgresPool();
});

describe("native ticket taxonomy repository", () => {
  it("uses parameterized PostgreSQL writes and preserves owner, object reference, catalog version and idempotency", async () => {
    expect(classifyTicket({ task_type: "email_compose", source: "manual" })).toEqual({ kind: "service", channel: "email" });
    await insertTicket("tsk_native_taxonomy_1", { taskType: "email_compose", source: "manual", collaborationId: "col_native" });

    await expect(ensureTicketForWorkItem("tsk_native_taxonomy_1")).resolves.toBe(true);
    const first = await ticketRow("tsk_native_taxonomy_1");
    expect(first).toMatchObject({
      kind: "service", channel: "email", requester_type: "human", requester_id: "usr_task_facts",
      object_type: "collaboration", object_id: "col_native",
    });
    expect(first!.kind_version).toBeGreaterThanOrEqual(1);

    await expect(ensureTicketForWorkItem("tsk_native_taxonomy_1")).resolves.toBe(true);
    const second = await ticketRow("tsk_native_taxonomy_1");
    expect(second).toEqual(first);
    const count = await postgresPool().query<{ n: number }>("SELECT COUNT(*)::int AS n FROM tickets WHERE id=$1", ["tsk_native_taxonomy_1"]);
    expect(count.rows[0].n).toBe(1);
  });

  it("serializes one-time historical reconciliation with the app-state idempotency marker", async () => {
    await insertTicket("tsk_native_hist_1", { taskType: "risk_scan", source: "schedule" });
    await insertTicket("tsk_native_hist_2", { taskType: "email_compose", source: "manual" });
    await postgresPool().query("DELETE FROM app_state WHERE key=$1", [CLASSIFIED_FLAG]);

    const results = await Promise.all([reconcileTickets(), reconcileTickets()]);
    expect(results.map((result) => result.classified).sort((a, b) => a - b)).toEqual([0, 2]);
    expect(await ticketRow("tsk_native_hist_1")).toMatchObject({ kind: "risk", channel: "system", requester_type: "system", requester_id: null });
    expect(await ticketRow("tsk_native_hist_2")).toMatchObject({ kind: "service", channel: "email" });
    const marker = await postgresPool().query<{ value: string }>("SELECT value FROM app_state WHERE key=$1", [CLASSIFIED_FLAG]);
    expect(marker.rows).toEqual([{ value: "done" }]);
    await expect(reconcileTickets()).resolves.toEqual({ classified: 0 });
    await expect(reconcileTickets({ force: true })).resolves.toEqual({ classified: 2 });
  });
});
