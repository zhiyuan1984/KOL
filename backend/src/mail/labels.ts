import type { PoolClient } from "pg";

import { scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { normalizeEmail } from "../host/identity.js";
import { nid } from "../ids.js";
import { postgresTransaction } from "../postgres/pool.js";
import type { Operation } from "../runtime/operations.js";
import type { Json } from "../types.js";
import {
  isLegalGeneratedMailLabelName,
  labelSuggestionReceiptKey,
  loadLabelSuggestionEvidence,
  parseMailLabelSuggestionReceipt,
  type MailLabelSuggestionReceipt,
  type MailLabelSuggestionReceiptCandidate,
} from "./label-suggestions.js";

const MEMORY = {
  entry: "memory" as const,
  kind: "memory" as const,
  creates_session: false,
  creates_turn: false,
  calls_model: false,
};

const COMMAND = {
  entry: "command" as const,
  kind: "command" as const,
  creates_session: false,
  creates_turn: false,
  calls_model: false,
};

type Actor = { id: string; active: boolean };
type Label = { id: string; name: string; count: number };
type Assignment = { conversation_id: string; label_ids: string[] };
type LabelsEnvelope = {
  mailbox: string;
  labels: Label[];
  assignments: Assignment[];
  selected_label_ids: string[];
  version: number;
};

type LabelInput = {
  box?: unknown;
  conversation_id?: unknown;
  mode?: unknown;
  name?: unknown;
  label_id?: unknown;
  candidate_receipt_id?: unknown;
  candidate_id?: unknown;
  expected_version?: unknown;
  confirm?: unknown;
};

type QueryClient = Pick<PoolClient, "query">;
type CandidateReceiptSelection = { receiptId: string; candidateId: string };
const MAILBOX_EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function currentActor(): Actor {
  const user = scopedUser();
  // This direct employee preference API intentionally has no authDisabled/demo
  // fallback. Test callers must install an explicit scoped user too.
  if (!user) throw new HttpFail(401, { code: "authentication_required" });
  if (!user.active) throw new HttpFail(403, { code: "actor_inactive" });
  return { id: user.id, active: user.active };
}

function requiredMailbox(raw: unknown): string {
  if (typeof raw !== "string" || /\p{Cc}/u.test(raw)) throw new HttpFail(400, { code: "mailbox_invalid" });
  const mailbox = normalizeEmail(raw);
  if (!mailbox) throw new HttpFail(400, { code: "mailbox_required" });
  if (!MAILBOX_EMAIL.test(mailbox)) throw new HttpFail(400, { code: "mailbox_invalid" });
  return mailbox;
}

function optionalConversationId(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function requiredConversationId(raw: unknown): string {
  const conversationId = optionalConversationId(raw);
  if (!conversationId) throw new HttpFail(400, { code: "conversation_id_required" });
  return conversationId;
}

/** Normalize only the user-facing name, preserving its normalized display case. */
export function normalizeMailLabelName(raw: unknown): { name: string; normalizedName: string } {
  if (typeof raw !== "string") throw new HttpFail(400, { code: "label_name_invalid" });
  if (/\p{Cc}/u.test(raw)) throw new HttpFail(400, { code: "label_name_invalid" });
  const name = raw.normalize("NFKC").trim();
  if (!name) throw new HttpFail(400, { code: "label_name_invalid" });
  if (/\p{Cc}/u.test(name)) throw new HttpFail(400, { code: "label_name_invalid" });
  if ([...name].length > 40) throw new HttpFail(400, { code: "label_name_invalid" });
  return { name, normalizedName: name.toLowerCase() };
}

function labelSelector(input: LabelInput): { labelId?: string; name?: { name: string; normalizedName: string } } {
  let labelId = "";
  if (input.label_id !== undefined) {
    if (typeof input.label_id !== "string") throw new HttpFail(400, { code: "label_id_invalid" });
    labelId = input.label_id.trim();
    if (!labelId || labelId.length > 160) throw new HttpFail(400, { code: "label_id_invalid" });
  }
  const hasName = input.name !== undefined;
  const name = hasName ? normalizeMailLabelName(input.name) : undefined;
  if (Boolean(labelId) === Boolean(name)) throw new HttpFail(400, { code: "label_selector_required" });
  return labelId ? { labelId } : { name };
}

/**
 * The candidate route intentionally accepts no user-controlled label name or id.
 * Legacy callers keep the established name/id selector unchanged outside this
 * branch; the new UI must use this opaque receipt branch for AI candidates.
 */
function candidateReceiptSelector(input: LabelInput, mode: "add" | "remove"): CandidateReceiptSelection | undefined {
  const hasReceipt = input.candidate_receipt_id !== undefined;
  const hasCandidate = input.candidate_id !== undefined;
  if (!hasReceipt && !hasCandidate) return undefined;
  if (mode !== "add") throw new HttpFail(400, { code: "candidate_receipt_mode_invalid" });
  if (typeof input.candidate_receipt_id !== "string" || typeof input.candidate_id !== "string") {
    throw new HttpFail(400, { code: "candidate_receipt_invalid" });
  }
  const receiptId = input.candidate_receipt_id.trim();
  const candidateId = input.candidate_id.trim();
  if (!UUID.test(receiptId) || !UUID.test(candidateId)) throw new HttpFail(400, { code: "candidate_receipt_invalid" });
  if (input.name !== undefined || input.label_id !== undefined) {
    throw new HttpFail(400, { code: "candidate_selector_conflict" });
  }
  return { receiptId, candidateId };
}

function expectedVersion(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    throw new HttpFail(400, { code: "expected_version_invalid" });
  }
  return raw;
}

async function assertMailboxBound(client: QueryClient, actorId: string, mailbox: string, lock = false): Promise<void> {
  const result = await client.query(
    `SELECT mailbox_email FROM user_starry_bindings
     WHERE user_id=$1 AND lower(mailbox_email)=lower($2) AND status='connected'
     ${lock ? "FOR SHARE" : ""}`,
    [actorId, mailbox],
  );
  if (!result.rows[0]) throw new HttpFail(403, { code: "mailbox_access_denied" });
}

async function assertConversationAccessible(client: QueryClient, mailbox: string, conversationId: string, lock = false): Promise<void> {
  const result = await client.query(
    `SELECT conversation_id FROM kol_mail_threads
     WHERE conversation_id=$1 AND lower(mailbox)=lower($2)
     LIMIT 1 ${lock ? "FOR SHARE" : ""}`,
    [conversationId, mailbox],
  );
  if (!result.rows[0]) throw new HttpFail(404, { code: "conversation_not_found" });
}

async function labelEnvelope(
  client: QueryClient,
  actor: Actor,
  mailbox: string,
  selectedConversationId = "",
): Promise<LabelsEnvelope> {
  await assertMailboxBound(client, actor.id, mailbox);
  if (selectedConversationId) await assertConversationAccessible(client, mailbox, selectedConversationId);

  const versionResult = await client.query<{ version: number }>(
    "SELECT version FROM mail_private_label_states WHERE user_id=$1 AND mailbox=$2",
    [actor.id, mailbox],
  );
  const labelsResult = await client.query<{ id: string; name: string; count: number | string }>(
    `SELECT l.id, l.name, COUNT(DISTINCT t.conversation_id)::int AS count
       FROM mail_private_labels l
       LEFT JOIN mail_private_label_assignments a
         ON a.user_id=l.user_id AND a.mailbox=l.mailbox AND a.label_id=l.id
       LEFT JOIN kol_mail_threads t
         ON t.conversation_id=a.conversation_id AND lower(t.mailbox)=lower(l.mailbox)
       WHERE l.user_id=$1 AND l.mailbox=$2
       GROUP BY l.id, l.name, l.normalized_name
       ORDER BY l.normalized_name, l.id`,
    [actor.id, mailbox],
  );
  const assignmentsResult = await client.query<{ conversation_id: string; label_ids: string[] }>(
    `SELECT a.conversation_id, array_agg(a.label_id ORDER BY l.normalized_name, l.id) AS label_ids
       FROM mail_private_label_assignments a
       JOIN mail_private_labels l
         ON l.id=a.label_id AND l.user_id=a.user_id AND l.mailbox=a.mailbox
       JOIN kol_mail_threads t
         ON t.conversation_id=a.conversation_id AND lower(t.mailbox)=lower(a.mailbox)
       WHERE a.user_id=$1 AND a.mailbox=$2
       GROUP BY a.conversation_id
       ORDER BY a.conversation_id`,
    [actor.id, mailbox],
  );

  const assignments = assignmentsResult.rows.map((row) => ({
    conversation_id: String(row.conversation_id),
    label_ids: Array.isArray(row.label_ids) ? row.label_ids.map(String) : [],
  }));
  return {
    mailbox,
    labels: labelsResult.rows.map((row) => ({ id: String(row.id), name: String(row.name), count: Number(row.count || 0) })),
    assignments,
    selected_label_ids: selectedConversationId
      ? (assignments.find((row) => row.conversation_id === selectedConversationId)?.label_ids || [])
      : [],
    version: Number(versionResult.rows[0]?.version || 0),
  };
}

async function selectScopedLabel(
  client: PoolClient,
  actorId: string,
  mailbox: string,
  selector: ReturnType<typeof labelSelector>,
  mode: "add" | "remove",
): Promise<{ id: string; name: string } | undefined> {
  if (selector.labelId) {
    const result = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM mail_private_labels
       WHERE id=$1 AND user_id=$2 AND mailbox=$3
       FOR KEY SHARE`,
      [selector.labelId, actorId, mailbox],
    );
    // A cross-user/cross-mailbox id deliberately has the same response as an
    // unknown id: it must not become a dictionary-probing API.
    if (!result.rows[0]) throw new HttpFail(404, { code: "label_not_found" });
    return result.rows[0];
  }

  const name = selector.name!;
  const existing = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM mail_private_labels
     WHERE user_id=$1 AND mailbox=$2 AND normalized_name=$3
     FOR KEY SHARE`,
    [actorId, mailbox, name.normalizedName],
  );
  if (existing.rows[0]) return existing.rows[0];
  if (mode === "remove") return undefined;

  const id = nid("mlbl");
  const created = await client.query<{ id: string; name: string }>(
    `INSERT INTO mail_private_labels
     (id,user_id,mailbox,name,normalized_name,created_at,updated_at,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,now(),now(),$2,$2)
     ON CONFLICT (user_id,mailbox,normalized_name) DO NOTHING
     RETURNING id,name`,
    [id, actorId, mailbox, name.name, name.normalizedName],
  );
  if (created.rows[0]) return created.rows[0];
  const raced = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM mail_private_labels
     WHERE user_id=$1 AND mailbox=$2 AND normalized_name=$3
     FOR SHARE`,
    [actorId, mailbox, name.normalizedName],
  );
  if (!raced.rows[0]) throw new HttpFail(409, { code: "label_dictionary_conflict" });
  return raced.rows[0];
}

async function lockedReceiptCandidate(
  client: PoolClient,
  actor: Actor,
  mailbox: string,
  conversationId: string,
  actualVersion: number,
  selection: CandidateReceiptSelection,
): Promise<{ receipt: MailLabelSuggestionReceipt; candidate: MailLabelSuggestionReceiptCandidate }> {
  const row = await client.query<{ value: string }>(
    `SELECT value FROM app_state WHERE key=$1 FOR UPDATE`,
    [labelSuggestionReceiptKey(selection.receiptId)],
  );
  const receipt = parseMailLabelSuggestionReceipt(row.rows[0]?.value || "", selection.receiptId);
  if (!receipt) throw new HttpFail(409, { code: "candidate_receipt_invalid" });
  if (receipt.consumed_at) throw new HttpFail(409, { code: "candidate_receipt_consumed" });
  if (Date.parse(receipt.expires_at) <= Date.now()) throw new HttpFail(409, { code: "candidate_receipt_expired" });
  if (receipt.actor_id !== actor.id || receipt.mailbox !== mailbox || receipt.conversation_id !== conversationId) {
    throw new HttpFail(403, { code: "candidate_receipt_scope_mismatch" });
  }
  if (receipt.label_state_version !== actualVersion) {
    throw new HttpFail(409, {
      code: "candidate_receipt_stale",
      receipt_version: receipt.label_state_version,
      current_version: actualVersion,
    });
  }
  // `assertMailboxBound` and the conversation share lock were acquired by the
  // caller first. This shared reader locks the exact source rows contributing to
  // the fingerprint before the assignment can commit.
  const current = await loadLabelSuggestionEvidence(client, actor, mailbox, conversationId, { lockSource: true });
  if (current.sourceFingerprint !== receipt.source_fingerprint) {
    throw new HttpFail(409, { code: "mail_source_changed" });
  }
  const candidate = receipt.candidates.find((item) => item.id === selection.candidateId);
  if (!candidate) throw new HttpFail(409, { code: "candidate_not_found" });
  return { receipt, candidate };
}

async function selectReceiptCandidateLabel(
  client: PoolClient,
  actorId: string,
  mailbox: string,
  candidate: MailLabelSuggestionReceiptCandidate,
): Promise<{ id: string; name: string }> {
  if (candidate.label_id) {
    const existing = await selectScopedLabel(client, actorId, mailbox, { labelId: candidate.label_id }, "add");
    // The receipt chooses both id and name. A request never supplies either, and
    // a renamed/deleted dictionary entry cannot silently become a different tag.
    if (!existing || existing.name !== candidate.name) throw new HttpFail(409, { code: "candidate_label_changed" });
    return existing;
  }
  if (!isLegalGeneratedMailLabelName(candidate.name)) throw new HttpFail(409, { code: "candidate_receipt_invalid" });
  return (await selectScopedLabel(
    client,
    actorId,
    mailbox,
    { name: normalizeMailLabelName(candidate.name) },
    "add",
  ))!;
}

async function consumeReceipt(client: PoolClient, receipt: MailLabelSuggestionReceipt): Promise<void> {
  const consumed = { ...receipt, consumed_at: new Date().toISOString() };
  await client.query(
    `UPDATE app_state SET value=$2 WHERE key=$1`,
    [labelSuggestionReceiptKey(receipt.receipt_id), JSON.stringify(consumed)],
  );
}

async function applyLabelAction(input: LabelInput): Promise<LabelsEnvelope> {
  const actor = currentActor();
  const mailbox = requiredMailbox(input.box);
  const conversationId = requiredConversationId(input.conversation_id);
  if (input.confirm !== true) throw new HttpFail(400, { code: "confirmation_required" });
  const mode = input.mode === "add" || input.mode === "remove" ? input.mode : undefined;
  if (!mode) throw new HttpFail(400, { code: "label_mode_invalid" });
  const candidateSelection = candidateReceiptSelector(input, mode);
  const selector = candidateSelection ? undefined : labelSelector(input);
  const expected = expectedVersion(input.expected_version);

  return await postgresTransaction(async (client) => {
    // Share locks cover status/mailbox updates and thread changes until this
    // receipt commits; the state row serializes same-mailbox preference writes.
    await assertMailboxBound(client, actor.id, mailbox, true);
    await assertConversationAccessible(client, mailbox, conversationId, true);
    await client.query(
      `INSERT INTO mail_private_label_states(user_id,mailbox,version,updated_at)
       VALUES ($1,$2,0,now()) ON CONFLICT (user_id,mailbox) DO NOTHING`,
      [actor.id, mailbox],
    );
    const state = await client.query<{ version: number }>(
      `SELECT version FROM mail_private_label_states
       WHERE user_id=$1 AND mailbox=$2 FOR UPDATE`,
      [actor.id, mailbox],
    );
    const actual = Number(state.rows[0]?.version || 0);
    if (actual !== expected) {
      throw new HttpFail(409, { code: "version_conflict", expected_version: expected, current_version: actual });
    }

    const receiptCandidate = candidateSelection
      ? await lockedReceiptCandidate(client, actor, mailbox, conversationId, actual, candidateSelection)
      : undefined;
    const scopedLabel = receiptCandidate
      ? await selectReceiptCandidateLabel(client, actor.id, mailbox, receiptCandidate.candidate)
      : await selectScopedLabel(client, actor.id, mailbox, selector!, mode);
    let changed = false;
    if (scopedLabel && mode === "add") {
      const inserted = await client.query(
        `INSERT INTO mail_private_label_assignments
         (user_id,mailbox,conversation_id,label_id,assigned_at,assigned_by)
         VALUES ($1,$2,$3,$4,now(),$1)
         ON CONFLICT (user_id,mailbox,conversation_id,label_id) DO NOTHING`,
        [actor.id, mailbox, conversationId, scopedLabel.id],
      );
      changed = inserted.rowCount === 1;
    } else if (scopedLabel && mode === "remove") {
      const removed = await client.query(
        `DELETE FROM mail_private_label_assignments
         WHERE user_id=$1 AND mailbox=$2 AND conversation_id=$3 AND label_id=$4`,
        [actor.id, mailbox, conversationId, scopedLabel.id],
      );
      changed = removed.rowCount === 1;
    }

    // A candidate receipt is one-time even if a legacy/out-of-band writer made
    // the target assignment visible just before this confirmation. The locked
    // receipt is consumed in this same transaction as the controlled command.
    if (receiptCandidate) await consumeReceipt(client, receiptCandidate.receipt);

    if (changed) {
      const next = actual + 1;
      await client.query(
        `UPDATE mail_private_label_states SET version=$1,updated_at=now()
         WHERE user_id=$2 AND mailbox=$3`,
        [next, actor.id, mailbox],
      );
      await client.query(
        `INSERT INTO mail_sync_audit(id,ts,actor,event_type,payload_json)
         VALUES ($1,now(),$2,$3,$4::jsonb)`,
        [
          nid("msa"),
          actor.id,
          `mail.label.${mode}`,
          JSON.stringify({
            actor_id: actor.id,
            mailbox,
            conversation_id: conversationId,
            label_id: scopedLabel?.id || null,
            version_before: actual,
            version_after: next,
            source: receiptCandidate ? "employee_confirmed_ai_label_candidate" : "employee_ui_preference",
            candidate_receipt_id: receiptCandidate?.receipt.receipt_id || null,
            candidate_id: receiptCandidate?.candidate.id || null,
            source_fingerprint: receiptCandidate?.receipt.source_fingerprint || null,
          }),
        ],
      );
    }
    return labelEnvelope(client, actor, mailbox, conversationId);
  }, { isolation: "REPEATABLE READ" });
}

const queryMailLabels: Operation["handle"] = async (c, input) => {
  c.header("Cache-Control", "no-store");
  const actor = currentActor();
  const mailbox = requiredMailbox(input.box);
  const result = await postgresTransaction(
    async (client) => labelEnvelope(client, actor, mailbox, optionalConversationId(input.conversation_id)),
    { isolation: "REPEATABLE READ" },
  );
  return c.json({ ...MEMORY, ...result });
};

const actionMailLabel: Operation["handle"] = async (c, input) => {
  c.header("Cache-Control", "no-store");
  const result = await applyLabelAction(input as LabelInput);
  return c.json({
    ...COMMAND,
    ok: true,
    mailbox: result.mailbox,
    conversation_id: requiredConversationId((input as LabelInput).conversation_id),
    labels: result.labels,
    assignments: result.assignments,
    label_ids: result.selected_label_ids,
    version: result.version,
  });
};

export const mailLabelOperations: Operation[] = [
  { kind: "query", id: "mail.labels", handle: queryMailLabels },
  { kind: "action", id: "mail.label", handle: actionMailLabel },
];
