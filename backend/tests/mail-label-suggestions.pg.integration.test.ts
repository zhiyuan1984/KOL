import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AppUser } from "../src/auth.js";
import { withScopedUser } from "../src/auth.js";
import { getConn, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import {
  createMailLabelSuggestionOperations,
  labelSuggestionReceiptKey,
  type LabelSuggestionHarness,
  type LabelSuggestionHarnessInput,
} from "../src/mail/label-suggestions.js";
import { mailLabelOperations } from "../src/mail/labels.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { createAgentBinding, syncUserOrganization } from "../src/runtime/organization-tree.js";
import { ensureManagedAgents } from "../src/runtime/managed-agents.js";
import { ensureRuntimeSchema, setAgentSkill } from "../src/runtime/store.js";
import { operationRouter } from "../src/runtime/operations.js";
import { freshTestDatabase } from "./support/pg.js";

const BOX_A = "operator-a@example.test";
const BOX_B = "operator-b@example.test";
const CONVERSATION_A = "label-suggestions-conversation-a";
const CONVERSATION_B = "label-suggestions-conversation-b";

let app: Hono;
let calls: LabelSuggestionHarnessInput[];

function actor(id: string, active = true): AppUser {
  return {
    id,
    username: id,
    name: id,
    handle: id,
    email: `${id}@example.test`,
    phone: "",
    roles: ["employee"],
    role: "employee",
    brands: [],
    site: "",
    manager_user_id: null,
    active,
    exam_passed: true,
    exam_todo_count: 0,
    exam_module: "",
  };
}

const ACTOR_A = actor("label-suggestion-user-a");
const ACTOR_B = actor("label-suggestion-user-b");

async function within<T>(user: AppUser, fn: () => T | Promise<T>): Promise<T> {
  return withScopedUser(user, fn);
}

async function responseBody(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function ensureUser(user: AppUser): Promise<void> {
  const now = new Date().toISOString();
  await postgresPool().query(
    `INSERT INTO users(id,username,name,password_hash,roles,active,created_at,updated_at)
     VALUES ($1,$2,$3,'isolated-test-only',$4,1,$5,$5)
     ON CONFLICT (id) DO UPDATE SET roles=EXCLUDED.roles,active=1`,
    [user.id, user.username, user.name, JSON.stringify(user.roles), now],
  );
}

async function bind(userId: string, mailbox: string, isDefault = true): Promise<void> {
  if (isDefault) {
    await postgresPool().query(
      "UPDATE user_starry_bindings SET is_default=0 WHERE user_id=$1 AND is_default=1",
      [userId],
    );
  }
  await postgresPool().query(
    `INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,status,updated_at)
     VALUES ($1,$2,$3,'connected',now())
     ON CONFLICT (user_id,mailbox_email) DO UPDATE
       SET is_default=EXCLUDED.is_default,status='connected',updated_at=now()`,
    [userId, mailbox, isDefault ? 1 : 0],
  );
}

async function thread(conversationId = CONVERSATION_A, mailbox = BOX_A): Promise<void> {
  const suffix = `${conversationId}-${mailbox}`.replace(/[^a-z0-9]+/gi, "-");
  await postgresPool().query(
    `INSERT INTO kol_mail_threads(id,conversation_id,mailbox,subject,digest_text,digest_source,digest_fingerprint,peer_email,created_at,last_at,updated_at)
     VALUES ($1,$2,$3,'Price and timing','Stored summary: the creator asked for a rate card.','codex_memory',$4,'peer-a@example.test',now(),now(),now())`,
    [`thread-${suffix}`, conversationId, mailbox, `thread-fingerprint-${suffix}`],
  );
  await postgresPool().query(
    `INSERT INTO kol_mail_items(id,thread_id,conversation_id,provider_message_id,direction,subject,body_text,summary,summary_source,memory_fingerprint,created_at)
     VALUES ($1,$2,$3,$4,'inbound','Price and timing',
             'Please send your rate card and proposed dates.','Creator requested rate and date details.','codex_memory',$5,now())`,
    [`item-${suffix}`, `thread-${suffix}`, conversationId, `provider-${suffix}`, `item-fingerprint-${suffix}`],
  );
}

async function label(id: string, name: string): Promise<void> {
  await postgresPool().query(
    `INSERT INTO mail_private_labels(id,user_id,mailbox,name,normalized_name,created_at,updated_at,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,now(),now(),$2,$2)`,
    [id, ACTOR_A.id, BOX_A, name, name.toLowerCase()],
  );
}

async function seedCurrentAgentEligibility(user: AppUser): Promise<void> {
  // The test uses the same current-user → Agent binding and published existing
  // mail_summary skill guard as production, not an auth-disabled bypass.
  (await ensureRuntimeSchema());
  (await ensureManagedAgents());
  const db = getConn();
  (await db.query("INSERT INTO managed_agents(id,name,description,status,version,created_at,updated_at)\n    VALUES ('agent:kol','KOL test Agent','', 'published',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)\n    ON CONFLICT (id) DO UPDATE SET status='published'",[]));
  // The template database can already contain this managed binding. Read its
  // authoritative version and still submit it through the production CAS API.
  const skill = (await db.query<{ version: number }>(
    "SELECT version FROM runtime_agent_skills WHERE agent_id=$1 AND skill_id=$2",
    ["agent:kol", "mail_summary"],
  )).rows[0];
  (await setAgentSkill("agent:kol", "mail_summary", true, Number(skill?.version || 0)));
  const personRef = (await syncUserOrganization(user.id, "org:lt_team"));
  (await createAgentBinding({
    agent_id: "agent:kol",
    target_type: "person",
    target_id: personRef,
    company_id: "company:amperetime",
    source: "test",
  }));
}

function installApp(harness: LabelSuggestionHarness): void {
  const router = operationRouter([
    ...mailLabelOperations,
    ...createMailLabelSuggestionOperations({ harness }),
  ]);
  router.onError((error, context) => {
    if (error instanceof HttpFail) return context.json({ detail: error.detail }, error.status as 400);
    return context.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
  });
  app = router;
}

function installDefaultApp(): void {
  installApp(async (input) => {
    calls.push(input);
    return { suggestions: [{ label_id: "label-pricing", name: "Pricing", reason: "会话包含报价与档期的明确诉求。" }] };
  });
}

async function ask(user: AppUser, body: Record<string, unknown> = { box: BOX_A, conversation_id: CONVERSATION_A }) {
  return responseBody(await within(user, async () => (app.request("/actions/mail.label-suggestions", {
    method: "POST", body: JSON.stringify(body),
  }))));
}

async function changeLabel(user: AppUser, body: Record<string, unknown>) {
  return responseBody(await within(user, async () => (app.request("/actions/mail.label", {
    method: "POST", body: JSON.stringify(body),
  }))));
}

async function getLabels(user: AppUser, box = BOX_A, conversationId = CONVERSATION_A) {
  const query = new URLSearchParams({ box, conversation_id: conversationId });
  return responseBody(await within(user, async () => (app.request(`/queries/mail.labels?${query.toString()}`))));
}

async function clearDictionary(): Promise<void> {
  await postgresPool().query(
    "DELETE FROM mail_private_labels WHERE user_id=$1 AND mailbox=$2",
    [ACTOR_A.id, BOX_A],
  );
}

async function assignmentCount(userId = ACTOR_A.id, mailbox = BOX_A, peerEmail = "peer-a@example.test"): Promise<number> {
  const result = await postgresPool().query<{ n: string }>(
    `SELECT count(*)::int AS n FROM mail_private_label_assignments
     WHERE user_id=$1 AND mailbox=$2 AND peer_email=$3`,
    [userId, mailbox, peerEmail],
  );
  return Number(result.rows[0]?.n || 0);
}

function receiptIdentity(result: { body: Record<string, unknown> }, index = 0): { receiptId: string; candidateId: string } {
  const receiptId = String(result.body.receipt_id || "");
  const suggestions = result.body.suggestions as Array<Record<string, unknown>>;
  const candidateId = String(suggestions[index]?.id || "");
  expect(receiptId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(candidateId).toMatch(/^[0-9a-f-]{36}$/i);
  return { receiptId, candidateId };
}

async function receiptValue(receiptId: string): Promise<Record<string, unknown>> {
  const row = await postgresPool().query<{ value: string }>(
    "SELECT value FROM app_state WHERE key=$1",
    [labelSuggestionReceiptKey(receiptId)],
  );
  expect(row.rows).toHaveLength(1);
  return JSON.parse(row.rows[0].value) as Record<string, unknown>;
}

function candidateConfirm(receiptId: string, candidateId: string, input: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    box: BOX_A,
    conversation_id: CONVERSATION_A,
    mode: "add",
    candidate_receipt_id: receiptId,
    candidate_id: candidateId,
    expected_version: 0,
    confirm: true,
    ...input,
  };
}

beforeEach(async () => {
  await freshTestDatabase();
  await resetConn();
  // freshTestDatabase applies the complete formal native manifest, including
  // the already-deployed peer assignment schema; never replay obsolete 035 SQL.
  await ensureUser(ACTOR_A);
  (await seedCurrentAgentEligibility(ACTOR_A));
  await bind(ACTOR_A.id, BOX_A);
  await thread();
  await label("label-follow-up", "Follow up");
  await label("label-pricing", "Pricing");
  calls = [];
  installDefaultApp();
});

afterEach(async () => {
  await closePostgresPool();
  (await resetConn());
});

describe("mail label suggestions PostgreSQL integration", () => {
  it("uses current Agent eligibility and scoped raw/saved evidence, then returns candidates without saving labels", async () => {
    const result = await ask(ACTOR_A);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      entry: "think", kind: "think", creates_session: false, creates_turn: true, calls_model: true,
      mailbox: BOX_A, conversation_id: CONVERSATION_A, runtime_agent_id: "agent:kol", runtime_skill_id: "mail_summary",
      status: "completed", assigned_label_ids: [],
    });
    expect(result.body.source_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.body.suggestions).toEqual([expect.objectContaining({
      label_id: "label-pricing", name: "Pricing", reason: "会话包含报价与档期的明确诉求。",
      mailbox: BOX_A, conversation_id: CONVERSATION_A, source_fingerprint: result.body.source_fingerprint,
    })]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ agentId: "agent:kol", skillId: "mail_summary" });
    expect(calls[0].evidence.messages[0]).toMatchObject({
      body_text: "Please send your rate card and proposed dates.",
      summary: "Creator requested rate and date details.",
      memory_fingerprint: expect.stringContaining("item-fingerprint"),
    });
    expect(calls[0].evidence.available_labels).toEqual([
      { id: "label-follow-up", name: "Follow up" },
      { id: "label-pricing", name: "Pricing" },
    ]);
    expect(await assignmentCount()).toBe(0);
  });

  it("rejects a mailbox outside the current binding before a harness call", async () => {
    const result = await ask(ACTOR_A, { box: BOX_B, conversation_id: CONVERSATION_A });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ detail: { code: "mailbox_access_denied" } });
    expect(calls).toEqual([]);
  });

  it("does not treat an existing unassigned label as a model-created label and rejects invalid model label ids", async () => {
    installApp(async () => ({ suggestions: [{ label_id: "foreign-label", name: "Foreign", reason: "not allowed" }] }));
    const result = await ask(ACTOR_A);
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ detail: { code: "label_suggestion_invalid_model_output" } });
    const dictionary = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::int AS n FROM mail_private_labels WHERE user_id=$1 AND mailbox=$2",
      [ACTOR_A.id, BOX_A],
    );
    expect(Number(dictionary.rows[0].n)).toBe(2);
  });

  it("suppresses a model result when the authorized mail snapshot changes during the one turn", async () => {
    installApp(async () => {
      await postgresPool().query("UPDATE kol_mail_items SET body_text='Changed after the turn' WHERE conversation_id=$1", [CONVERSATION_A]);
      return { suggestions: [{ label_id: "label-pricing", name: "Pricing", reason: "报价请求" }] };
    });
    const result = await ask(ACTOR_A);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ detail: { code: "mail_source_changed" } });
  });

  it("persists an opaque receipt in app_state for 2-to-16-Han new candidates without changing an empty dictionary", async () => {
    await clearDictionary();
    const sixteenHan = "一二三四五六七八九十甲乙丙丁戊己";
    expect([...sixteenHan]).toHaveLength(16);
    installApp(async (input) => {
      calls.push(input);
      return {
        suggestions: [
          { label_id: "", name: "跟进", reason: "邮件明确提出需要继续沟通。" },
          { label_id: "", name: sixteenHan, reason: "邮件内容值得按此主题归档。" },
        ],
      };
    });

    const result = await ask(ACTOR_A);
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(1); // one injected Codex-harness response, never a live model
    expect(result.body.source_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.body.suggestions).toEqual([
      expect.objectContaining({ label_id: null, name: "跟进", mailbox: BOX_A, conversation_id: CONVERSATION_A }),
      expect.objectContaining({ label_id: null, name: sixteenHan, mailbox: BOX_A, conversation_id: CONVERSATION_A }),
    ]);
    const { receiptId } = receiptIdentity(result);
    const persisted = await receiptValue(receiptId);
    expect(persisted).toMatchObject({
      kind: "mail_label_suggestion_receipt_v1",
      receipt_id: receiptId,
      actor_id: ACTOR_A.id,
      mailbox: BOX_A,
      conversation_id: CONVERSATION_A,
      source_fingerprint: result.body.source_fingerprint,
      label_state_version: 0,
      consumed_at: null,
    });
    expect(Date.parse(String(persisted.expires_at)) - Date.parse(String(persisted.issued_at))).toBe(10 * 60 * 1_000);
    expect(persisted.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ label_id: null, name: "跟进" }),
      expect.objectContaining({ label_id: null, name: sixteenHan }),
    ]));
    const receiptRows = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::int AS n FROM app_state WHERE key LIKE 'mail.label_suggestion_receipt:%'",
    );
    expect(Number(receiptRows.rows[0].n)).toBe(1);
    const dictionary = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::int AS n FROM mail_private_labels WHERE user_id=$1 AND mailbox=$2",
      [ACTOR_A.id, BOX_A],
    );
    expect(Number(dictionary.rows[0].n)).toBe(0);
    expect(await assignmentCount()).toBe(0);
  });

  it("adopts one opaque new candidate, survives a pool reload, and rejects replay", async () => {
    await clearDictionary();
    installApp(async () => ({ suggestions: [{ label_id: "", name: "报价跟进", reason: "邮件明确询问报价与后续安排。" }] }));
    const proposed = await ask(ACTOR_A);
    const { receiptId, candidateId } = receiptIdentity(proposed);

    const adopted = await changeLabel(ACTOR_A, candidateConfirm(receiptId, candidateId));
    expect(adopted.status).toBe(200);
    expect(adopted.body).toMatchObject({
      entry: "command", kind: "command", calls_model: false, version: 1,
      label_ids: expect.any(Array),
    });
    expect((adopted.body.labels as Array<Record<string, unknown>>)).toEqual([
      expect.objectContaining({ name: "报价跟进", count: 1 }),
    ]);
    expect(await assignmentCount()).toBe(1);
    expect((await receiptValue(receiptId)).consumed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await closePostgresPool();
    const reloaded = await getLabels(ACTOR_A);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body).toMatchObject({ version: 1 });
    expect(reloaded.body.labels).toEqual([expect.objectContaining({ name: "报价跟进", count: 1 })]);
    expect(reloaded.body.selected_label_ids).toEqual((adopted.body.labels as Array<Record<string, unknown>>).map((item) => item.id));

    const replay = await changeLabel(ACTOR_A, candidateConfirm(receiptId, candidateId, { expected_version: 1 }));
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ detail: { code: "candidate_receipt_consumed" } });
    expect(await assignmentCount()).toBe(1);
  });

  it("requires true confirmation and prohibits handwritten names on the candidate branch while preserving the legacy branch", async () => {
    await clearDictionary();
    installApp(async () => ({ suggestions: [{ label_id: "", name: "报价跟进", reason: "邮件明确询问报价与后续安排。" }] }));
    const proposed = await ask(ACTOR_A);
    const { receiptId, candidateId } = receiptIdentity(proposed);

    const notConfirmed = await changeLabel(ACTOR_A, candidateConfirm(receiptId, candidateId, { confirm: false }));
    expect(notConfirmed.status).toBe(400);
    expect(notConfirmed.body).toMatchObject({ detail: { code: "confirmation_required" } });
    const handwritten = await changeLabel(ACTOR_A, candidateConfirm(receiptId, candidateId, { name: "随意手写名称" }));
    expect(handwritten.status).toBe(400);
    expect(handwritten.body).toMatchObject({ detail: { code: "candidate_selector_conflict" } });
    expect((await receiptValue(receiptId)).consumed_at).toBeNull();
    expect(await assignmentCount()).toBe(0);

    // Existing manual preference callers intentionally retain their documented selector.
    const legacy = await changeLabel(ACTOR_A, {
      box: BOX_A, conversation_id: CONVERSATION_A, mode: "add", name: "legacy free-form !", expected_version: 0, confirm: true,
    });
    expect(legacy.status).toBe(200);
    expect(legacy.body.labels).toEqual([expect.objectContaining({ name: "legacy free-form !", count: 1 })]);
  });

  it("rejects an expired receipt without creating a dictionary entry or assignment", async () => {
    await clearDictionary();
    installApp(async () => ({ suggestions: [{ label_id: "", name: "报价跟进", reason: "邮件明确询问报价与后续安排。" }] }));
    const proposed = await ask(ACTOR_A);
    const { receiptId, candidateId } = receiptIdentity(proposed);
    const expired = await receiptValue(receiptId);
    expired.expires_at = new Date(Date.now() - 1_000).toISOString();
    await postgresPool().query("UPDATE app_state SET value=$2 WHERE key=$1", [labelSuggestionReceiptKey(receiptId), JSON.stringify(expired)]);

    const rejected = await changeLabel(ACTOR_A, candidateConfirm(receiptId, candidateId));
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ detail: { code: "candidate_receipt_expired" } });
    expect(await assignmentCount()).toBe(0);
  });

  it("rejects a receipt when the source fingerprint has become stale without a new assignment", async () => {
    await clearDictionary();
    installApp(async () => ({ suggestions: [{ label_id: "", name: "报价跟进", reason: "邮件明确询问报价与后续安排。" }] }));
    const proposed = await ask(ACTOR_A);
    const { receiptId, candidateId } = receiptIdentity(proposed);
    await postgresPool().query("UPDATE kol_mail_items SET body_text='changed after receipt' WHERE conversation_id=$1", [CONVERSATION_A]);

    const rejected = await changeLabel(ACTOR_A, candidateConfirm(receiptId, candidateId));
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ detail: { code: "mail_source_changed" } });
    expect(await assignmentCount()).toBe(0);
  });

  it("rejects a receipt presented by another scoped actor without a new assignment", async () => {
    await clearDictionary();
    await ensureUser(ACTOR_B);
    await bind(ACTOR_B.id, BOX_A);
    installApp(async () => ({ suggestions: [{ label_id: "", name: "报价跟进", reason: "邮件明确询问报价与后续安排。" }] }));
    const proposed = await ask(ACTOR_A);
    const { receiptId, candidateId } = receiptIdentity(proposed);

    const rejected = await changeLabel(ACTOR_B, candidateConfirm(receiptId, candidateId));
    expect(rejected.status).toBe(403);
    expect(rejected.body).toMatchObject({ detail: { code: "candidate_receipt_scope_mismatch" } });
    expect(await assignmentCount()).toBe(0);
  });

  it("rejects a receipt replayed into a different bound mailbox and conversation", async () => {
    await clearDictionary();
    await bind(ACTOR_A.id, BOX_B, false);
    await thread(CONVERSATION_B, BOX_B);
    installApp(async () => ({ suggestions: [{ label_id: "", name: "报价跟进", reason: "邮件明确询问报价与后续安排。" }] }));
    const proposed = await ask(ACTOR_A);
    const { receiptId, candidateId } = receiptIdentity(proposed);

    const rejected = await changeLabel(ACTOR_A, candidateConfirm(receiptId, candidateId, {
      box: BOX_B,
      conversation_id: CONVERSATION_B,
    }));
    expect(rejected.status).toBe(403);
    expect(rejected.body).toMatchObject({ detail: { code: "candidate_receipt_scope_mismatch" } });
    expect(await assignmentCount(ACTOR_A.id, BOX_A, CONVERSATION_A)).toBe(0);
    expect(await assignmentCount(ACTOR_A.id, BOX_B, CONVERSATION_B)).toBe(0);
  });

  it("rejects a receipt after its mailbox binding is revoked without a new assignment", async () => {
    await clearDictionary();
    installApp(async () => ({ suggestions: [{ label_id: "", name: "报价跟进", reason: "邮件明确询问报价与后续安排。" }] }));
    const proposed = await ask(ACTOR_A);
    const { receiptId, candidateId } = receiptIdentity(proposed);
    await postgresPool().query(
      "UPDATE user_starry_bindings SET status='disconnected' WHERE user_id=$1 AND mailbox_email=$2",
      [ACTOR_A.id, BOX_A],
    );

    const rejected = await changeLabel(ACTOR_A, candidateConfirm(receiptId, candidateId));
    expect(rejected.status).toBe(403);
    expect(rejected.body).toMatchObject({ detail: { code: "mailbox_access_denied" } });
    expect(await assignmentCount()).toBe(0);
  });

  it("requires the receipt version to match before it can create an assignment", async () => {
    await clearDictionary();
    installApp(async () => ({ suggestions: [{ label_id: "", name: "报价跟进", reason: "邮件明确询问报价与后续安排。" }] }));
    const proposed = await ask(ACTOR_A);
    const { receiptId, candidateId } = receiptIdentity(proposed);

    const rejected = await changeLabel(ACTOR_A, candidateConfirm(receiptId, candidateId, { expected_version: 1 }));
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ detail: { code: "version_conflict", expected_version: 1, current_version: 0 } });
    expect(await assignmentCount()).toBe(0);
    expect((await receiptValue(receiptId)).consumed_at).toBeNull();
  });

  it("rejects an illegal generated label from the harness and leaves the dictionary and assignments empty", async () => {
    await clearDictionary();
    installApp(async () => ({ suggestions: [{ label_id: "", name: "illegal label", reason: "not a permitted generated label" }] }));
    const rejected = await ask(ACTOR_A);
    expect(rejected.status).toBe(502);
    expect(rejected.body).toMatchObject({ detail: { code: "label_suggestion_invalid_model_output" } });
    const dictionary = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::int AS n FROM mail_private_labels WHERE user_id=$1 AND mailbox=$2",
      [ACTOR_A.id, BOX_A],
    );
    const receipts = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::int AS n FROM app_state WHERE key LIKE 'mail.label_suggestion_receipt:%'",
    );
    expect(Number(dictionary.rows[0].n)).toBe(0);
    expect(Number(receipts.rows[0].n)).toBe(0);
    expect(await assignmentCount()).toBe(0);
  });
});

describe("mail label suggestions opt-in live Codex PostgreSQL integration", () => {
  it.skipIf(process.env.MAIL_LABEL_LIVE_CODEX !== "1")(
    "runs one isolated live Codex turn without persisting an assignment",
    async () => {
      // The runner supplies isolated LINGONG_DATA and Codex settings. This test
      // deliberately invokes the production factory with no harness override.
      await clearDictionary();
      const router = operationRouter([
        ...mailLabelOperations,
        ...createMailLabelSuggestionOperations(),
      ]);
      router.onError((error, context) => {
        if (error instanceof HttpFail) return context.json({ detail: error.detail }, error.status as 400);
        return context.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
      });
      app = router;

      const started = Date.now();
      const result = await ask(ACTOR_A);
      const elapsedMs = Date.now() - started;
      const suggestionCount = Array.isArray(result.body.suggestions) ? result.body.suggestions.length : -1;
      const assignments = await assignmentCount();

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ status: "completed", source: "codex" });
      expect(suggestionCount).toBeGreaterThan(0);
      expect(assignments).toBe(0);
      // State/count/timing only: never print mailbox content, model text, or URLs.
      console.info(JSON.stringify({ live_codex_pg: {
        status: result.body.status,
        source: result.body.source,
        suggestion_count: suggestionCount,
        assignment_count: assignments,
        elapsed_ms: elapsedMs,
      } }));
    },
  );
});
