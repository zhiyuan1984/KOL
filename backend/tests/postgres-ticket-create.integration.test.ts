import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createFormalTicketPostgres } from "../src/ticket-domain/create-ticket.js";
import { editFormalTicketPostgres } from "../src/ticket-domain/edit-ticket.js";
import { assignFormalTicketPostgres } from "../src/ticket-domain/assign-ticket.js";
import { personalTicketRawCountReport } from "../src/ticket-domain/reports.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { ticketOrgFormBootstrap, ticketOrganizationQualityReport } from "../src/ticket-domain/organization.js";
import { listNativeTickets, nativeTicketById } from "../src/ticket-domain/read-tickets.js";
import { withScopedUser, type AppUser } from "../src/auth.js";
import { tickets } from "../src/routers/tickets.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;
const CREATOR: AppUser = {
  id: "u-creator", username: "ye_guanwang", handle: "ye_guanwang", name: "叶观旺", email: "", phone: "",
  roles: ["employee"], role: "employee", brands: [], site: "", manager_user_id: null, active: true,
  exam_passed: true, exam_todo_count: 0, exam_module: "test",
};

describePostgres("native PostgreSQL formal ticket creation", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
        roles TEXT NOT NULL DEFAULT '[]', brands TEXT NOT NULL DEFAULT '[]', active BIGINT NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS organization_units (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, display_name TEXT NOT NULL, type TEXT NOT NULL,
        parent_id TEXT, level INTEGER NOT NULL, head_person_ref TEXT, head_display_name TEXT, status TEXT NOT NULL,
        org_version INTEGER NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS organization_people (
        person_ref TEXT PRIMARY KEY, display_name TEXT NOT NULL, user_ref TEXT, user_id TEXT,
        starry_open_id TEXT, status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS organization_memberships (
        id TEXT PRIMARY KEY, person_ref TEXT NOT NULL, company_id TEXT NOT NULL, org_unit_id TEXT NOT NULL,
        relation TEXT NOT NULL, position TEXT, status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scope_memberships (
        id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, company_id TEXT NOT NULL,
        brand_id TEXT, region_id TEXT, status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS org_versions (
        company_id TEXT NOT NULL, version INTEGER NOT NULL, effective_at TEXT NOT NULL, note TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_org_seed_state (
        seed_key TEXT PRIMARY KEY, registry_revision TEXT NOT NULL, seeded_at TEXT NOT NULL, seeded_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, task_type TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL,
        status TEXT NOT NULL, priority TEXT NOT NULL, skill TEXT NOT NULL, profile TEXT NOT NULL, due_at TEXT, input JSONB NOT NULL,
        entities JSONB NOT NULL, data_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        kind TEXT, channel TEXT, requester_type TEXT, requester_id TEXT, goal TEXT, next_action TEXT, business_category TEXT,
        stage_group TEXT, stage_code TEXT, ticket_timezone TEXT, no_due_reason TEXT, acceptance_criteria JSONB
      );
      CREATE TABLE IF NOT EXISTS ticket_org_scopes (
        ticket_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, center_unit_id TEXT, department_unit_id TEXT,
        assignee_unit_id TEXT NOT NULL, org_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_assignments (
        ticket_id TEXT NOT NULL, assignee_person_ref TEXT NOT NULL, assignee_user_id TEXT NOT NULL, org_unit_id TEXT NOT NULL,
        role TEXT NOT NULL, status TEXT NOT NULL, cross_group_reason TEXT, assigned_by_user_id TEXT NOT NULL,
        assignment_version INTEGER NOT NULL, effective_from TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_watchers (
        ticket_id TEXT NOT NULL, watcher_person_ref TEXT NOT NULL, watcher_user_id TEXT NOT NULL, reason TEXT NOT NULL,
        automatic BOOLEAN NOT NULL, org_version INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(ticket_id,watcher_person_ref)
      );
      CREATE TABLE IF NOT EXISTS ticket_basis_refs (
        ticket_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_version TEXT,
        occurred_at TEXT, summary_json JSONB NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(ticket_id,source_type,source_id,source_version)
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL, run_id TEXT, sequence INTEGER NOT NULL, event_type TEXT NOT NULL,
        event_class TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL, safe_summary TEXT, time TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(work_item_id,sequence)
      );
      CREATE TABLE IF NOT EXISTS ticket_create_receipts (
        idempotency_key TEXT PRIMARY KEY, requester_user_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
        response_json JSONB NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_audit_events (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, command TEXT NOT NULL,
        request_json JSONB NOT NULL, result_json JSONB NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_command_receipts (
        idempotency_key TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, action TEXT NOT NULL, result_json JSONB NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_acceptances (
        ticket_id TEXT PRIMARY KEY, accepted_at TEXT NOT NULL
      );
      TRUNCATE ticket_acceptances, ticket_command_receipts, ticket_audit_events, ticket_create_receipts, task_events, ticket_basis_refs, ticket_watchers, ticket_assignments, ticket_org_scopes,
        tickets, ticket_org_seed_state, org_versions, scope_memberships, organization_memberships, organization_people,
        organization_units, users CASCADE;
    `);
    await pool.query(
      `INSERT INTO users (id,username,name,password_hash,roles,brands,active,created_at,updated_at)
       VALUES ('u-creator','ye_guanwang','叶观旺','x','["employee"]','[]',1,$1,$1),
              ('u-supervisor','zhong_jiankui','钟建奎','x','["employee"]','[]',1,$1,$1)`,
      ["2031-01-01T00:00:00.000Z"],
    );
  });

  afterAll(async () => { await closePostgresPool(); });

  it("creates one complete formal ticket atomically and replays the idempotent receipt", async () => {
    // The registry provenance is seeded first, then the test makes the two
    // account bindings explicit exactly as production data-quality operations do.
    await ticketOrgFormBootstrap("u-creator");
    const pool = postgresPool();
    await pool.query("UPDATE organization_people SET user_id='u-creator' WHERE person_ref='person:ye_guanwang'");
    await pool.query("UPDATE organization_people SET user_id='u-supervisor' WHERE person_ref='person:zhong_jiankui'");
    const bootstrap = await ticketOrgFormBootstrap("u-creator");
    expect(bootstrap.formal_submission_enabled).toBe(true);
    const quality = await ticketOrganizationQualityReport();
    expect(quality.active_unit_count).toBeGreaterThan(0);
    expect(quality.issues.some((issue) => issue.type === "person_without_account")).toBe(true);

    const command = {
      title: "完成达人合作复盘",
      goal: "完成可核验的本周达人合作复盘",
      business_category: "kol" as const,
      priority: "normal" as const,
      due_at: "2031-01-10T12:00:00+08:00",
      acceptance_criteria: ["复盘报告已归档", "关键数据和结论已核验"],
      assignee_person_ref: "person:ye_guanwang",
      assignee_unit_id: "org:lt_team",
      idempotency_key: "native-ticket-create-idempotency-0001",
    };
    const first = await createFormalTicketPostgres("u-creator", command);
    const replay = await createFormalTicketPostgres("u-creator", command);
    expect(first).toMatchObject({ status: "pending", replayed: false, data_version: 1, org_version: 1 });
    expect(replay).toMatchObject({ ticket_id: first.ticket_id, replayed: true });

    const facts = await pool.query<{ scopes: string; assignments: string; watchers: string; events: string; receipts: string; audit: string }>(
      `SELECT
        (SELECT COUNT(*) FROM ticket_org_scopes WHERE ticket_id=$1)::text AS scopes,
        (SELECT COUNT(*) FROM ticket_assignments WHERE ticket_id=$1)::text AS assignments,
        (SELECT COUNT(*) FROM ticket_watchers WHERE ticket_id=$1)::text AS watchers,
        (SELECT COUNT(*) FROM task_events WHERE work_item_id=$1 AND event_type='task.created' AND event_class='lifecycle')::text AS events,
        (SELECT COUNT(*) FROM ticket_create_receipts WHERE ticket_id=$1)::text AS receipts,
        (SELECT COUNT(*) FROM ticket_audit_events WHERE ticket_id=$1 AND command='ticket.create')::text AS audit`,
      [first.ticket_id],
    );
    expect(facts.rows[0]).toEqual({ scopes: "1", assignments: "1", watchers: "1", events: "1", receipts: "1", audit: "1" });
    const center = await listNativeTickets("u-creator", { view: "created", limit: "10" });
    expect(center.items).toHaveLength(1);
    expect(center.items[0]).toMatchObject({ ticket_id: first.ticket_id, source: "manual", allowed_actions: ["edit", "cancel", "assign", "accept"] });
    const visibleToWatcher = await nativeTicketById("u-supervisor", first.ticket_id);
    expect(visibleToWatcher.allowed_actions).toEqual([]);
    const detail = await nativeTicketById("u-creator", first.ticket_id);
    expect(detail.assignments).toHaveLength(1);
    expect(detail.watchers).toHaveLength(1);
    expect(detail.basis_refs).toEqual([]);
    expect(detail.acceptance).toBeNull();
    expect(detail.runs).toEqual([]);
    expect(detail.audit.some((item: { command: string }) => item.command === "ticket.create")).toBe(true);
    const personalReport = await personalTicketRawCountReport("u-creator");
    expect(personalReport).toMatchObject({
      report_version: "ticket-personal-raw-count.v1",
      scope: "personal_authorized",
      source: "postgresql_formal_tickets",
      total_authorized: 1,
      by_status: { pending: 1 },
      memberships: { created: 1, assigned_primary: 1, watching: 0 },
    });
    const apiResponse = await withScopedUser(CREATOR, () => tickets.fetch(new Request("http://test.local/tickets?view=created")));
    expect(apiResponse.status).toBe(200);
    expect(await apiResponse.json()).toMatchObject({ items: [{ id: first.ticket_id }], page: { limit: 50 } });

    const edited = await editFormalTicketPostgres(first.ticket_id, "u-creator", {
      expected_version: 1,
      idempotency_key: "native-ticket-edit-idempotency-0001",
      title: "完成达人合作复盘（修订）",
      priority: "important",
      acceptance_criteria: ["复盘报告已归档", "关键数据完成验算"],
    });
    expect(edited).toMatchObject({ ticket_id: first.ticket_id, action: "edit", version: 2, replayed: false });
    const editedDetail = await nativeTicketById("u-creator", first.ticket_id);
    expect(editedDetail).toMatchObject({ title: "完成达人合作复盘（修订）", priority: "important", data_version: 2 });
    const editFacts = await pool.query<{ events: string; audit: string; receipt: string }>(
      `SELECT
        (SELECT COUNT(*) FROM task_events WHERE work_item_id=$1 AND event_type='task.updated')::text AS events,
        (SELECT COUNT(*) FROM ticket_audit_events WHERE ticket_id=$1 AND command='ticket.edit')::text AS audit,
        (SELECT COUNT(*) FROM ticket_command_receipts WHERE ticket_id=$1 AND action='edit')::text AS receipt`,
      [first.ticket_id],
    );
    expect(editFacts.rows[0]).toEqual({ events: "1", audit: "1", receipt: "1" });

    const reassigned = await assignFormalTicketPostgres({
      ticket_id: first.ticket_id,
      actor_user_id: "u-creator",
      expected_version: 2,
      idempotency_key: "native-ticket-assign-idempotency-0001",
      assignee_person_ref: "person:ye_guanwang",
      assignee_unit_id: "org:lt_team",
    });
    expect(reassigned).toMatchObject({ action: "assign", version: 3, assignee_user_id: "u-creator" });
    const assignmentFacts = await pool.query<{ active: string; history: string; event: string; audit: string }>(
      `SELECT
        (SELECT COUNT(*) FROM ticket_assignments WHERE ticket_id=$1 AND status='active' AND role='primary')::text AS active,
        (SELECT COUNT(*) FROM ticket_assignments WHERE ticket_id=$1 AND status='superseded')::text AS history,
        (SELECT COUNT(*) FROM task_events WHERE work_item_id=$1 AND event_type='task.reassigned')::text AS event,
        (SELECT COUNT(*) FROM ticket_audit_events WHERE ticket_id=$1 AND command='ticket.assign')::text AS audit`,
      [first.ticket_id],
    );
    expect(assignmentFacts.rows[0]).toEqual({ active: "1", history: "1", event: "1", audit: "1" });
  });
});
