import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { requireTicketPrincipal, syncWorkbenchTicketPrincipal, withTicketPrincipal } from "../src/ticket-domain/auth.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;

describePostgres("workbench session principal bridge", () => {
  beforeEach(async () => {
    await postgresPool().query("TRUNCATE workbench_principal_binding_events, workbench_principal_bindings, ticket_auth_sessions, ticket_accounts CASCADE");
  });

  afterAll(async () => { await closePostgresPool(); });

  it("creates no password or second session while making one workbench subject auditable in PostgreSQL", async () => {
    const first = await syncWorkbenchTicketPrincipal({
      id: "usr-workbench-1", username: "workbench_admin", name: "Workbench Admin",
      email: "admin@example.test", roles: ["employee", "admin"], active: true,
    });
    expect(first).toMatchObject({ id: "usr-workbench-1", roles: ["employee", "admin"] });
    expect(withTicketPrincipal(first, () => requireTicketPrincipal().id)).toBe("usr-workbench-1");

    const state = await postgresPool().query<{
      identity_provider: string; password_hash: string; username_snapshot: string; roles_snapshot: unknown; event_count: string; session_count: string;
    }>(
      `SELECT a.identity_provider,a.password_hash,b.username_snapshot,b.roles_snapshot,
              (SELECT COUNT(*)::text FROM workbench_principal_binding_events WHERE principal_id=a.id) AS event_count,
              (SELECT COUNT(*)::text FROM ticket_auth_sessions WHERE account_id=a.id) AS session_count
         FROM ticket_accounts a JOIN workbench_principal_bindings b ON b.principal_id=a.id
        WHERE a.id=$1`,
      [first.id],
    );
    expect(state.rows[0]).toMatchObject({
      identity_provider: "workbench_session", password_hash: "workbench-session-only",
      username_snapshot: "workbench_admin", roles_snapshot: ["employee", "admin"], event_count: "1", session_count: "0",
    });

    await syncWorkbenchTicketPrincipal({
      id: "usr-workbench-1", username: "workbench_admin", name: "Workbench Admin Updated",
      email: "admin@example.test", roles: ["employee"], active: true,
    });
    const refresh = await postgresPool().query<{ events: string; name_snapshot: string; roles_snapshot: unknown }>(
      `SELECT b.name_snapshot,b.roles_snapshot,
              (SELECT COUNT(*)::text FROM workbench_principal_binding_events WHERE principal_id=b.principal_id) AS events
         FROM workbench_principal_bindings b WHERE b.workbench_user_id=$1`,
      [first.id],
    );
    expect(refresh.rows[0]).toMatchObject({ name_snapshot: "Workbench Admin Updated", roles_snapshot: ["employee"], events: "2" });
  });
});
