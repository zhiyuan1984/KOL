/**
 * Host = Dify「应用后端」。
 * 职责：意图分类、选 Skill、起/杀 box、落 session、把 Item 映成 UI Markdown。
 * 确定性分支（阶段门、报价矩阵、From、考试、Cc、fingerprint）在 Host + PEP。
 * 发信 / 企微 / confirm-stage 只调 Gateway，不自己打带 secret 的 HTTP。
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { requireConnector, requireSkill, requireStageWrite, scopedUser, authDisabled, isAdmin } from "../auth.js";
import { translateDraftInternal, stubInternalZh } from "../starrykol/translate-zh.js";
import {
  BRAND_MAILBOXES,
  PLATFORM_EXAMPLE_TITLES,
  codexMode,
  hostWorkerTimeout,
  liveRemoteSideEffectsEnabled,
  liveTestKolAllowed,
  starryKolMcpConfigured,
} from "../config.js";
import { audit, getConn, isSqliteClosedError, isSqliteForeignKeyError, nowIso, tx } from "../db.js";
import { sendDraft } from "../gateway/send.js";
import { mailSendAction, claimMailSend, assertDraftEditable, validateMailSend, markMailSendUnknown } from "./mail-send-confirmation.js";
import { confirmStarryStage } from "../gateway/starry.js";
import { createWorkApproval, listApprovals } from "../gateway/wecom.js";
import { nid } from "../ids.js";
import { stageHeadline } from "../sops.js";
import {
  BY_CODE,
  LOCKED_PROMISE,
  approvalKindForStage,
  confirmTargetKind,
  confirmTargetViews,
  groupedStageTracks,
  label,
  normalizeStage,
  skippedStagesForConfirm,
  toLegacyStarryStage,
} from "../stages.js";
import { assertStageTransition } from "../stage-transitions-graph.js";
import type { Intent, Json, Row, SessionStatus, StageTransitionInput, WorkerResult } from "../types.js";
import { mcpSyncAssistantNote } from "../confirm-stage-feedback.js";
import { CodexUnavailable } from "../worker/errors.js";
import { runWorker, type WorkerProgress } from "../worker/runner.js";
import {
  applyProgress,
  finishProcessItems,
  preferHostOperations,
  reasoningSummariesOf,
  statusTextForProgress,
  upsertOperationItem,
  REMOTE_MCP_TITLE,
  type WorkerTraceItem,
} from "../worker/progress.js";
import { sanitizeAttachments } from "./attachments.js";
import { HostReject, HttpFail } from "./errors.js";
import { classify, resolveCollab, collabById } from "./intent.js";
import { bindCollaborationEmail, firstEmail, resolveMailTo } from "./mail-to.js";
import {
  attachComposeLoopCard,
  composeContextForCollaboration,
  composeFactsFromContext,
  composeFactsFromRow,
  composeLoopSections,
  composeRouteFacts,
  previewComposeForCollaboration,
  rememberOutboundAndRefreshDigest,
  requestedMailKind,
  stageMailAction,
  stageMailSpec,
  type ComposeFacts,
} from "./compose-loop.js";
import { looksLikeEmailDraft } from "./quote-amount.js";
import {
  abortSessionRun,
  attachRunAbort,
  beginSessionAsk,
  clearSessionRunning,
  enqueueAsk,
  hasRunAbort,
  isSessionRunning,
  isWriteSkill,
  markSessionRunning,
  publicQueue,
  removeQueued,
  runControlRevision,
  shiftQueue,
  wasSessionStopped,
  type QueuedAsk,
} from "./run-control.js";
import {
  changedLabel,
  collectReviseFields,
  isResultRevision,
  lastUnsentResult,
  mergeReviseFields,
  snapshotFromCards,
  stampResultRevise,
  type ResultSnapshot,
} from "./result-revise.js";
import { calculateApprovalPlan, expenseFactsFromWorkerItem, hintRequesterFromOrg, readExpenseFactsFromText, tryCitedApprovalPlan } from "../approval/plan.js";
import { isSkillGranted } from "./grants.js";
import { currentFingerprint } from "./fingerprint.js";
import { allowedFromMailboxes, brandOfMailbox, enforceSend, PepFail, resolveAuthorizedFrom } from "./pep.js";
import { currentUser } from "./persona.js";
import { boundMailboxEmail } from "./starry-bind.js";
import { assertSessionAccess } from "../routers/enterprise.js";
import { appendTaskEvent } from "../routers/tasks.js";
import {
  assertKolAnalyzeVerbsSafe,
  failKolAnalyzeIllegalVerb,
  illegalKolAnalyzeVerbs,
  KOL_ANALYZE_TASK_TYPE,
} from "./kol-memory.js";
import { taskDefinition, validateTaskResultSchema } from "../tasks/registry.js";
import { isSafeSkillResultForMemory, persistValidatedSkillResult } from "./skill-result-memory.js";
import { recognizeTaskIntent } from "../tasks/recognize.js";
import { insertSessionMessage, isSessionNotFound } from "./session-messages.js";
import { publishSession, subscribeSession } from "./session-events.js";
import { agentSubmissionAllowed } from "../contract-scope.js";
import { assertRuntimeSkill } from "../runtime/execution.js";
import { extractTaskEntities, mergeExtractedOntoIntent } from "../tasks/resolver.js";
import { fieldLabel } from "../labels.js";
import { assertCollaborationInScope, inboundVisibleSql, scopedCollaborationSearch } from "./inbound-scope.js";
import { parseExpectedVersion } from "./version.js";
import { cachedPoll, pollEpoch } from "./response-cache.js";
import { CRAWL_PLATFORMS, CRAWL_PLATFORM_SET } from "../crawl/platforms.js";
import { startCrawl } from "../crawl/service.js";
import { isKolClawTask } from "../kolclaw/service.js";
import {
  composePayloadFromItem,
  emailMcpResultCard,
  executeStarryKolTask,
  isEmailMcpTask,
  lastComposeFollowup,
  lastKolMailReply,
  resolveComposeSubject,
  remoteLifecycleIdFrom,
  writeRemoteOfficialStageWalk,
} from "../starrykol/service.js";
import { itemsForCollaboration } from "../starrykol/mail-sync.js";
import { hasComposeDraftOutput } from "../worker/parse.js";
import { templateAllowedForStage, templateById } from "../email-templates.js";
import {
  FOLLOW_STYLE_PRESETS,
  followStyleCardPayload,
  isFollowStyleTagCommand,
  parseFollowStyleTagCommand,
  readFollowStyleTags,
  writeFollowStyleTags,
} from "../follow-style-tags.js";
import {
  assertMailTemplateSnapshotApplicable,
  assertUsableKnowledge,
  compileMailDraft,
  leftoverPlaceholders,
  mailTemplatePayload,
  recordFailedSession,
  resolveApplicableMailTemplates,
  resolveMailTemplate,
  workerSafeExtra,
  type UsableTemplate,
} from "./knowledge.js";

export const host = new Hono();
const progressBySession = new Map<string, (progress: WorkerProgress) => void>();

function requireTaskAccess(skill: string): void {
  const definition = taskDefinition(skill);
  if (!definition) throw new HttpFail(400, { code: "unknown_task_type", task_type: skill });
  if (codexMode() !== "stub") {
    assertRuntimeSkill({ agentId: definition.runtime_agent_id, skillId: skill,
      userId: scopedUser()?.id || "", runId: "submission" });
    return;
  }
  if (definition.runtime_access === "authenticated") {
    if (!authDisabled() && !scopedUser()) throw new HttpFail(401, "authentication required");
    return;
  }
  requireSkill(skill);
  for (const server of new Set(definition.mcp.map((tool) => tool.split(".", 1)[0]))) {
    if (server === "starry" || server === "claw" || server === "kolclaw" || server === "starrykol" || server === "emailmcp") requireConnector(server === "emailmcp" ? "starrykol" : server, "read");
  }
  for (const permission of definition.permissions) {
    const [connector, level] = permission.split(":");
    const connectorId = connector === "emailmcp" ? "starrykol" : connector;
    if ((connectorId === "starry" || connectorId === "claw" || connectorId === "kolclaw" || connectorId === "starrykol") && ["read", "write", "admin"].includes(level)) {
      requireConnector(connectorId, level as "read" | "write" | "admin");
    }
  }
}

function sessionRow(sid: string): Row {
  return { ...assertSessionAccess(sid) };
}

type ComposePrepare = {
  status: "ready" | "needs_context" | "needs_template" | "needs_fields" | "blocked";
  skill_id: "email_compose";
  message?: string;
  context: Json;
  template?: Json;
  editor?: Json;
  missing_fields: string[];
  candidates: Json[];
  context_version?: string;
};

function composeContextVersion(input: Json): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
}

function stringValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Json)
      .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
      .map(([key, item]) => [key, String(item)]),
  );
}

function placeholderField(token: string): string | null {
  if (/发件/.test(token)) return "from";
  if (/收件/.test(token)) return "to";
  if (/主题/.test(token)) return "subject";
  return null;
}

function templateCandidate(template: UsableTemplate): Json {
  return {
    knowledge_id: template.id,
    title: template.title,
    published_version: template.version,
  };
}

function prepareReply(partial: Omit<ComposePrepare, "skill_id">): ComposePrepare {
  return { skill_id: "email_compose", ...partial };
}

function collaborationRefs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const ref = value as Json;
    const kind = String(ref.kind || ref.type || "").toLowerCase();
    if (!["collaboration", "collab", "kol", "creator", "object"].includes(kind)) return [];
    const id = String(ref.id || ref.collaboration_id || "").trim();
    return id ? [id] : [];
  });
}

function preparedCollaboration(body: Json, session: Row | null): { row: Row | null; ambiguous: boolean; conflict: boolean } {
  const requested = String(body.collaboration_id || "").trim();
  const sessionId = String(session?.collaboration_id || "").trim();
  if (sessionId && requested && sessionId !== requested) return { row: null, ambiguous: false, conflict: true };
  const ids = [...new Set([sessionId, requested, ...collaborationRefs(body.object_refs)].filter(Boolean))];
  const rows = new Map<string, Row>();
  for (const id of ids) {
    const direct = collabById(id);
    if (direct) rows.set(String(direct.id), direct);
    else {
      for (const candidate of scopedCollaborationSearch(id)) {
        if (String(candidate.handle || "") === id || String(candidate.id || "") === id) {
          const full = collabById(String(candidate.id));
          if (full) rows.set(String(full.id), full);
        }
      }
    }
  }
  if (!rows.size) {
    const handle = String(body.handle || "").trim();
    if (handle) {
      const found = scopedCollaborationSearch(handle)
        .filter((candidate) => String(candidate.handle || "") === handle || String(candidate.id || "") === handle);
      for (const candidate of found) {
        const full = collabById(String(candidate.id));
        if (full) rows.set(String(full.id), full);
      }
    }
  }
  if (rows.size !== 1) return { row: null, ambiguous: rows.size > 1, conflict: false };
  const row = [...rows.values()][0];
  assertCollaborationInScope(String(row.id));
  return { row, ambiguous: false, conflict: false };
}

function preparedSender(row: Row): string {
  const from = boundMailboxEmail() || String(row.mailbox_from || "").trim();
  const resolved = resolveAuthorizedFrom(from, currentUser(), String(row.brand || ""));
  const brandAllowed = resolved.allowed.filter((item) => item.brand === String(row.brand || ""));
  if (resolved.matched) return resolved.email;
  if (brandAllowed.length === 1) return brandAllowed[0].email;
  return "";
}

function mailComposeContextVersion(row: Row, template: UsableTemplate): string {
  return composeContextVersion({
    collaboration_id: row.id, stage: String(row.stage_code || ""), stage_version: row.stage_version || 0,
    brand: String(row.brand || ""), from: preparedSender(row), to: firstEmail(row.email),
    knowledge_id: template.id, published_version: template.version,
  });
}

function preparedTemplateChoice(templates: UsableTemplate[], stage: string, brand: string): UsableTemplate[] {
  if (!templates.length) return [];
  const score = (template: UsableTemplate) =>
    (template.brand === brand ? 0 : 2) + (template.stage_codes.includes(stage) ? 0 : 1);
  const best = Math.min(...templates.map(score));
  return templates.filter((template) => score(template) === best);
}

type ComposeInput = {
  mode: "edited_draft";
  knowledge_version: number;
  context_version?: string;
  subject: string;
  body: string;
  variables?: Record<string, unknown>;
  source_draft_id?: string | null;
};

function readComposeInput(value: unknown): ComposeInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Json;
  if (String(input.mode || "") !== "edited_draft") {
    throw new HttpFail(400, { code: "compose_input_invalid", message: "compose_input.mode 必须是 edited_draft" });
  }
  const knowledgeVersion = Number(input.knowledge_version);
  const subject = String(input.subject || "");
  const body = String(input.body || "");
  if (!Number.isInteger(knowledgeVersion) || knowledgeVersion < 1 || !subject.trim() || !body.trim()) {
    throw new HttpFail(422, { code: "compose_input_invalid", message: "compose_input 需要已发布版本、主题和正文" });
  }
  return {
    mode: "edited_draft",
    knowledge_version: knowledgeVersion,
    ...(input.context_version ? { context_version: String(input.context_version) } : {}),
    subject,
    body,
    ...(input.variables && typeof input.variables === "object" && !Array.isArray(input.variables)
      ? { variables: input.variables as Record<string, unknown> }
      : {}),
    source_draft_id: input.source_draft_id == null ? null : String(input.source_draft_id),
  };
}

function validateComposeInput(intent: Intent, col: Row | null): ComposeInput | null {
  const composeInput = readComposeInput(intent.extras?.compose_input);
  if (!composeInput) return null;
  const knowledgeId = String(intent.extras?.knowledge_id || "").trim();
  if (String(intent.skill || intent.type || "") !== "email_compose" || !knowledgeId || !col) {
    throw new HttpFail(422, { code: "compose_input_context", message: "编辑后的邮件需要已选择的邮件模板和单个合作对象" });
  }
  const template = assertMailTemplateSnapshotApplicable({
    knowledgeId,
    version: composeInput.knowledge_version,
    skillId: "email_compose",
    stageCode: String(col.stage_code || ""),
    brand: String(col.brand || ""),
  });
  assertCollaborationInScope(String(col.id));
  if (composeInput.context_version && composeInput.context_version !== mailComposeContextVersion(col, template)) {
    throw new HttpFail(409, { code: "compose_context_stale", message: "合作阶段、收发件信息或模板版本已变化，请保留草稿并重新核对上下文。" });
  }
  if (!preparedSender(col) || !firstEmail(col.email)) {
    throw new HttpFail(422, { code: "compose_addresses_required", message: "请补充授权发件邮箱和当前合作的收件邮箱。" });
  }
  if (leftoverPlaceholders(`${composeInput.subject}\n${composeInput.body}`).length) {
    throw new HttpFail(422, { code: "compose_fields_required", message: "请补齐草稿中的模板变量后再提交。" });
  }
  if (composeInput.source_draft_id) {
    const source = getDraft(composeInput.source_draft_id);
    assertDraftEditable(source);
    if (String(source.collaboration_id || "") !== String(col.id)) {
      throw new HttpFail(409, { code: "compose_source_conflict", message: "原草稿属于其他合作对象。" });
    }
  }
  intent.extras = {
    ...intent.extras,
    compose_input: composeInput,
    knowledge_id: template.id,
    knowledge_version: template.version,
    mail_template: mailTemplatePayload(template),
  };
  return composeInput;
}

function authoredComposeItem(item: Json, composeInput: ComposeInput | null): Json {
  if (!composeInput) return item;
  return {
    ...item,
    subject: composeInput.subject,
    body: composeInput.body,
    body_en: composeInput.body,
    context_version: composeInput.context_version || null,
    source_draft_id: composeInput.source_draft_id || null,
  };
}

host.post("/email-compose/prepare", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  if (String(body.skill_id || "") !== "email_compose") {
    throw new HttpFail(400, { code: "invalid_skill", message: "skill_id 必须是 email_compose" });
  }
  requireTaskAccess("email_compose");
  const sessionId = String(body.session_id || "").trim();
  const session = sessionId ? sessionRow(sessionId) : null;
  const selected = preparedCollaboration(body, session);
  if (selected.conflict) {
    throw new HttpFail(409, { code: "collaboration_conflict", message: "会话已绑定其他合作对象，不能由请求覆盖" });
  }
  if (!selected.row) {
    const sceneHint = String(body.scene_hint || "").trim();
    return c.json(prepareReply({
      status: "needs_context",
      message: selected.ambiguous
        ? "请选择单个红人或合作对象。"
        : sceneHint === "first_touch"
          ? "首封场景尚未建立正式合作阶段；请选择单个红人并补充授权发件信息。"
          : "请选择红人或补充收件信息。",
      context: sceneHint === "first_touch" ? { scene: "first_touch", stage_source: "scene_hint" } : {},
      missing_fields: ["collaboration_id"],
      candidates: [],
    }));
  }
  const row = selected.row;
  const stage = String(row.stage_code || "").trim();
  const brand = String(row.brand || "").trim();
  if (!stage || !brand || !BY_CODE[stage]) {
    return c.json(prepareReply({
      status: "needs_context",
      message: "当前合作缺少可核验的正式阶段或品牌。",
      context: { collaboration_id: row.id },
      missing_fields: [!stage ? "stage_code" : "brand"],
      candidates: [],
    }));
  }
  const context: Json = {
    collaboration_id: row.id,
    stage_code: stage,
    stage_source: "collaboration",
    scene: stageMailSpec(stage).kind,
    brand,
  };
  const templates = resolveApplicableMailTemplates({
    knowledgeId: String(body.knowledge_id || "").trim() || null,
    skillId: "email_compose",
    stageCode: stage,
    brand,
  });
  if (!templates.length) {
    return c.json(prepareReply({
      status: "needs_template",
      message: "暂无已启用的适用模板。",
      context,
      missing_fields: [],
      candidates: [],
      context_version: composeContextVersion({ collaboration_id: row.id, stage, brand }),
    }));
  }
  const choices = preparedTemplateChoice(templates, stage, brand);
  if (choices.length !== 1) {
    return c.json(prepareReply({
      status: "needs_template",
      message: "有多个同等适用的模板，请选择其一。",
      context,
      missing_fields: [],
      candidates: choices.map(templateCandidate),
      context_version: composeContextVersion({ collaboration_id: row.id, stage, brand, candidates: choices.map((item) => [item.id, item.version]) }),
    }));
  }
  const template = choices[0];
  const from = preparedSender(row);
  const to = firstEmail(row.email);
  const values = {
    ...stringValues(body.variables),
    handle: String(row.handle || row.display_name || ""),
    mailboxEmail: from,
    to,
  };
  const compiled = compileMailDraft(template, values);
  const missing = new Set<string>([...compiled.missing, ...(!from ? ["from"] : []), ...(!to ? ["to"] : [])]);
  for (const token of template.placeholders) {
    const field = placeholderField(token);
    if (field === "from" && !from) missing.add(token);
    if (field === "to" && !to) missing.add(token);
  }
  const missingFields = [...missing];
  const contextVersion = mailComposeContextVersion(row, template);
  return c.json(prepareReply({
    status: missingFields.length ? "needs_fields" : "ready",
    ...(missingFields.length ? { message: "请补齐模板中的必填字段。" } : {}),
    context,
    template: {
      knowledge_id: template.id,
      published_version: template.version,
      template_id: template.template_id,
      title: template.title,
      source: "knowledge",
    },
    editor: { from, to: to ? [to] : [], subject: compiled.subject, body: compiled.body },
    missing_fields: missingFields,
    candidates: [],
    context_version: contextVersion,
  }));
});

function collabDisplay(id: unknown): string {
  const cid = String(id || "");
  if (!cid) return "该合作";
  const row = getConn().prepare("SELECT handle, display_name FROM collaborations WHERE id=?").get(cid) as
    | { handle?: string; display_name?: string }
    | undefined;
  const handle = String(row?.handle || "").trim();
  if (handle) return `@${handle}`;
  const name = String(row?.display_name || "").trim();
  return name || "该合作";
}

function addMsg(sid: string, role: string, kind: string, payload: Json): Json {
  if (kind === "me") {
    const last = getConn().prepare(
      "SELECT id, payload, created_at FROM messages WHERE session_id=? AND kind='me' ORDER BY created_at DESC, id DESC LIMIT 1",
    ).get(sid) as { id: string; payload: string; created_at: string } | undefined;
    if (last) {
      let prev: Json = {};
      try { prev = JSON.parse(String(last.payload || "{}")); } catch { prev = {}; }
      const age = Date.now() - Date.parse(String(last.created_at));
      if (String(prev.text || "") === String(payload.text || "") && Number.isFinite(age) && age >= 0 && age < 8000) {
        return { id: last.id, session_id: sid, role, kind, payload: prev, created_at: last.created_at };
      }
    }
  }
  return insertSessionMessage(sid, role, kind, payload);
}

function updateMsg(mid: string, payload: Json): void {
  const row = getConn().prepare("SELECT session_id, role, kind, created_at FROM messages WHERE id=?").get(mid) as
    | { session_id: string; role: string; kind: string; created_at: string }
    | undefined;
  tx((c) => {
    c.prepare("UPDATE messages SET payload = ? WHERE id = ?").run(JSON.stringify(payload), mid);
  });
  if (row) {
    publishSession(row.session_id, {
      type: "upsert",
      message: { id: mid, session_id: row.session_id, role: row.role, kind: row.kind, payload, created_at: row.created_at },
    });
  }
}

function messages(sid: string): Json[] {
  const rows = getConn().prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at, id").all(sid) as Row[];
  return rows.map((r) => ({ ...r, payload: JSON.parse(String(r.payload)) }));
}

type BoundTask = { workItemId: string; runId: string; taskType: string };

function bindTaskMessage(sid: string, body: Json): BoundTask | null {
  if (!body.work_item_id) {
    if (body.run_id || body.task_type) throw new HttpFail(400, "work_item_id required for task message");
    return null;
  }
  const item = getConn().prepare("SELECT * FROM work_items WHERE id=?").get(body.work_item_id) as Row | undefined;
  if (!item) throw new HttpFail(404, "task not found");
  const user = scopedUser();
  if (!authDisabled() && (!user || (!isAdmin(user) && String(item.owner_user_id) !== user.id))) {
    throw new HttpFail(404, "task not found");
  }
  if (String(item.session_id || "") !== sid) throw new HttpFail(409, "task is linked to a different session");
  const taskType = String(body.task_type || "");
  if (!taskType || taskType !== String(item.task_type) || !taskDefinition(taskType)) {
    throw new HttpFail(409, { code: "task_type_mismatch", expected: item.task_type, actual: taskType });
  }
  const run = (body.run_id
    ? getConn().prepare("SELECT * FROM task_runs WHERE id=? AND work_item_id=? AND session_id=?")
      .get(body.run_id, item.id, sid)
    : getConn().prepare(
      "SELECT * FROM task_runs WHERE work_item_id=? AND session_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
    ).get(item.id, sid)) as Row | undefined;
  if (!run) throw new HttpFail(409, "pending task run not found");
  if (!["pending", "failed"].includes(String(run.status))) throw new HttpFail(409, `task run is ${run.status}`);
  const now = nowIso();
  tx((db) => {
    db.prepare("UPDATE task_runs SET status='running',started_at=?,error=NULL WHERE id=?").run(now, run.id);
    db.prepare(
      "UPDATE work_items SET status='running',started_at=COALESCE(started_at,?),updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, now, item.id);
  });
  appendTaskEvent(String(item.id), String(run.id), "run.started", "任务开始处理", "running", taskType);
  audit(user?.id || "demo", "task.run.started", { work_item_id: item.id, run_id: run.id, task_type: taskType });
  return { workItemId: String(item.id), runId: String(run.id), taskType };
}

function finishBoundTask(bound: BoundTask | null, sid: string, result?: Json, error?: unknown): void {
  if (!bound) return;
  let failed = Boolean(error || result?.error);
  if (bound.taskType === KOL_ANALYZE_TASK_TYPE) {
    const worker = result?.worker && typeof result.worker === "object" ? result.worker as Json : {};
    const payload = {
      items: Array.isArray(worker.items) ? worker.items : result?.items,
      recommended_actions: result?.recommended_actions,
      actions: result?.actions,
      verb: result?.verb,
      action: result?.action,
    };
    const illegal = illegalKolAnalyzeVerbs(payload);
    if (illegal.length) {
      failKolAnalyzeIllegalVerb(bound.workItemId, illegal);
      failed = true;
      error = error || { code: "illegal_kol_analyze_verb", illegal_verbs: illegal, applied: false };
    }
  }
  const runStatus = failed ? "failed" : "completed";
  const taskStatus = failed ? "failed" : "waiting";
  const now = nowIso();
  const worker = result?.worker && typeof result.worker === "object" ? result.worker as Json : {};
  try {
    tx((db) => {
      db.prepare(
        "UPDATE task_runs SET status=?,worker_id=?,thread_id=?,turn_id=?,error=?,completed_at=? WHERE id=? AND work_item_id=?",
      ).run(
        runStatus,
        worker.id || null,
        worker.thread_id || null,
        worker.turn_id || null,
        failed ? JSON.stringify(result?.error || { message: error instanceof Error ? error.message : String(error) }) : null,
        now,
        bound.runId,
        bound.workItemId,
      );
      db.prepare(
        "UPDATE work_items SET status=?,completed_at=NULL,updated_at=?,data_version=data_version+1 WHERE id=?",
      ).run(taskStatus, now, bound.workItemId);
      const run = db.prepare("SELECT created_at FROM task_runs WHERE id=?").get(bound.runId) as
        | { created_at: string }
        | undefined;
      if (!run) return;
      const rows = db.prepare(
        `SELECT id,kind,payload FROM messages
          WHERE session_id=? AND created_at>=?
            AND kind IN ('task_result_card','email_card','confirm_stage_card','inbound_card','error_card')
          ORDER BY created_at,id`,
      ).all(sid, run.created_at) as Row[];
      for (const message of rows) {
        db.prepare(
          `INSERT INTO task_artifacts
           (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).run(
          nid("art"), bound.workItemId, bound.runId, message.kind, message.id, 1,
          message.payload || "{}", now,
        );
      }
    });
  } catch (error) {
    if (isSqliteForeignKeyError(error) || isSqliteClosedError(error)) return;
    throw error;
  }
  appendTaskEvent(
    bound.workItemId,
    bound.runId,
    `run.${runStatus}`,
    failed ? "Task failed" : "Task result ready",
    runStatus,
    failed ? "Task execution failed; inspect the linked error artifact." : "Task result and artifacts are ready for review.",
  );
  audit(scopedUser()?.id || "demo", `task.run.${runStatus}`, {
    work_item_id: bound.workItemId,
    run_id: bound.runId,
  });
  const definition = taskDefinition(bound.taskType);
  const memoryPolicy = definition?.memory_policy;
  if (
    runStatus === "completed"
    && bound.taskType !== "creator_discovery"
    && definition?.result_schema
    && memoryPolicy?.kind === "skill_result"
    && memoryPolicy.scope === "owner"
    && memoryPolicy.auto_persist === "on_complete"
  ) {
    const workerItems = Array.isArray(result?.items)
      ? result.items as Json[]
      : result?.worker && typeof result.worker === "object" && Array.isArray((result.worker as Json).items)
        ? (result.worker as Json).items as Json[] : [];
    const summary = { items: workerItems } as Json;
    const issues = Buffer.byteLength(JSON.stringify(summary), "utf8") > 256_000
      ? ["$result exceeds the memory size limit"]
      : validateTaskResultSchema(definition.result_schema, summary);
    if (!issues.length && !isSafeSkillResultForMemory(summary)) issues.push("$result contains credential-like material");
    const owner = getConn().prepare("SELECT owner_user_id FROM work_items WHERE id=?").get(bound.workItemId) as
      | { owner_user_id?: string }
      | undefined;
    if (issues.length || !owner?.owner_user_id || !workerItems.length) {
      audit(scopedUser()?.id || "host", "skill_result_memory.skipped", {
        work_item_id: bound.workItemId,
        run_id: bound.runId,
        skill_id: bound.taskType,
        reason: issues.length ? (issues.some((issue) => issue.includes("credential-like")) ? "unsafe_result" : "result_schema_invalid")
          : !workerItems.length ? "empty_result" : "owner_missing",
        issue_count: issues.length,
      });
      appendTaskEvent(bound.workItemId, bound.runId, "memory.write_skipped", "结果记忆未保存", "completed",
        issues.length ? "结果不符合技能声明的保存结构。" : "缺少可保存的结果或任务归属。");
    } else {
      try {
        persistValidatedSkillResult({
          owner: owner.owner_user_id,
          skillId: bound.taskType,
          runId: bound.runId,
          sourceVersion: "unversioned",
          staleRefs: memoryPolicy.stale_refs,
          summary,
        });
      } catch {
        audit(scopedUser()?.id || "host", "skill_result_memory.failed", {
          work_item_id: bound.workItemId,
          run_id: bound.runId,
          skill_id: bound.taskType,
          reason: "memory_write_failed",
        });
        appendTaskEvent(bound.workItemId, bound.runId, "memory.write_failed", "结果记忆写入失败", "completed",
          "本次运行结果已保留；记忆索引未更新，可稍后重试。");
      }
    }
  }
  if (
    !failed &&
    bound.taskType === "creator_discovery" &&
    result?.crawl_plan &&
    typeof result.crawl_plan === "object" &&
    (codexMode() !== "stub" || process.env.MEDIACRAWLER_AUTO_START === "1")
  ) {
    void autoStartBoundCrawl(bound, sid, result.crawl_plan as Json).catch((error) => {
      if (isSqliteForeignKeyError(error) || isSqliteClosedError(error) || isSessionNotFound(error)) return;
    });
  }
}

async function autoStartBoundCrawl(bound: BoundTask, sid: string, plan: Json): Promise<void> {
  try {
    const item = getConn().prepare("SELECT owner_user_id FROM work_items WHERE id=?").get(bound.workItemId) as
      | { owner_user_id: string }
      | undefined;
    if (!item) return;
    const run = getConn().prepare("SELECT id FROM task_runs WHERE id=? AND work_item_id=?").get(bound.runId, bound.workItemId);
    if (!run) return;
    const mode = String(plan.mode || "search");
    const platform = String(plan.platform || "").trim();
    if (!CRAWL_PLATFORM_SET.has(platform)) {
      const message = platform
        ? `不支持的采集平台：${platform}。可用平台：${CRAWL_PLATFORMS.join(" / ")}。`
        : "启动采集前需要补充平台。";
      getConn().prepare("UPDATE work_items SET status='needs_clarification',updated_at=? WHERE id=?")
        .run(nowIso(), bound.workItemId);
      appendTaskEvent(
        bound.workItemId,
        bound.runId,
        "crawl.clarification",
        "请补充可用采集平台",
        "needs_clarification",
        message,
      );
      addMsg(sid, "assistant", "error_card", {
        code: "crawl_platform_unsupported",
        message,
        next_action: "请改用 MediaCrawler 支持的平台后重试。",
        persistent: true,
      });
      return;
    }
    const required = mode === "detail" ? "specified_ids" : mode === "creator" ? "creator_ids" : "keywords";
    const value = plan[required];
    if (!Array.isArray(value) || !value.length) {
      getConn().prepare("UPDATE work_items SET status='needs_clarification',updated_at=? WHERE id=?")
        .run(nowIso(), bound.workItemId);
      appendTaskEvent(
        bound.workItemId,
        bound.runId,
        "crawl.clarification",
        `请补充${fieldLabel(required)}`,
        "needs_clarification",
        "未启动远程采集。",
      );
      addMsg(sid, "assistant", "error_card", {
        code: "crawl_input_required",
        message: `启动采集前需要补充${fieldLabel(required)}。`,
        persistent: true,
      });
      return;
    }
    try {
      await startCrawl({
        ownerUserId: item.owner_user_id,
        workItemId: bound.workItemId,
        sessionId: sid,
        platform,
        mode,
        parameters: {
          keywords: plan.keywords || [],
          specified_ids: plan.specified_ids || [],
          creator_ids: plan.creator_ids || [],
        },
        idempotencyKey: `auto:${bound.runId}`,
      });
      if (!getConn().prepare("SELECT id FROM work_items WHERE id=?").get(bound.workItemId)) return;
      addMsg(sid, "assistant", "assistant", {
        text: "远程创作者采集已自动启动，进度会持续更新。",
      });
    } catch (error) {
      if (isSqliteForeignKeyError(error) || isSqliteClosedError(error) || isSessionNotFound(error)) return;
      if (!getConn().prepare("SELECT id FROM work_items WHERE id=?").get(bound.workItemId)) return;
      const detail = error instanceof HttpFail && error.detail && typeof error.detail === "object"
        ? error.detail as Json
        : {};
      if (detail.code === "work_item_not_found") return;
      const message = String(detail.message || (error instanceof Error ? error.message : error));
      const nextAction = String(
        detail.next_action || "检查远程 Claw 配置或等待当前采集任务完成后重试。",
      );
      getConn().prepare("UPDATE work_items SET status='failed',updated_at=? WHERE id=?")
        .run(nowIso(), bound.workItemId);
      appendTaskEvent(bound.workItemId, bound.runId, "crawl.start_failed", "远程采集启动失败", "failed", message);
      addMsg(sid, "assistant", "error_card", {
        code: "crawl_start_failed",
        message: `远程采集启动失败：${message}`,
        next_action: nextAction,
        persistent: true,
      });
    }
  } catch (error) {
    if (isSqliteForeignKeyError(error) || isSqliteClosedError(error) || isSessionNotFound(error)) return;
    throw error;
  }
}

function sessionStatus(sid: string): SessionStatus {
  return sessionStatusMap([sid]).get(sid) || "listening";
}

/**
 * Batched `sessionStatus` for the session list: two indexed queries for the
 * whole page instead of two per session. The per-session branch order is
 * preserved exactly.
 */
function sessionStatusMap(sids: string[]): Map<string, SessionStatus> {
  const out = new Map<string, SessionStatus>();
  if (!sids.length) return out;
  const placeholders = sids.map(() => "?").join(",");
  const workerStatus = new Map<string, string>();
  for (const row of getConn().prepare(
    `SELECT session_id, status FROM workers
     WHERE session_id IN (${placeholders})
       AND created_at = (SELECT MAX(w2.created_at) FROM workers w2 WHERE w2.session_id = workers.session_id)`,
  ).all(...sids) as Row[]) {
    const key = String(row.session_id);
    if (!workerStatus.has(key)) workerStatus.set(key, String(row.status));
  }
  const draftStatus = new Map<string, string>();
  for (const row of getConn().prepare(
    `SELECT session_id, status FROM drafts
     WHERE session_id IN (${placeholders})
       AND id = (SELECT MAX(d2.id) FROM drafts d2 WHERE d2.session_id = drafts.session_id)`,
  ).all(...sids) as Row[]) {
    const key = String(row.session_id);
    if (!draftStatus.has(key)) draftStatus.set(key, String(row.status));
  }
  for (const sid of sids) {
    if (wasSessionStopped(sid)) {
      out.set(sid, workerStatus.get(sid) === "waiting_approval" ? "waiting_approval" : "listening");
      continue;
    }
    if (isSessionRunning(sid)) {
      out.set(sid, "running");
      continue;
    }
    const w = workerStatus.get(sid);
    if (w === "waiting_approval" || w === "running") {
      out.set(sid, w);
      continue;
    }
    out.set(sid, draftStatus.get(sid) === "waiting_approval" ? "waiting_approval" : "listening");
  }
  return out;
}

/**
 * Invalidation key for the cached session list: SQL rows plus the in-memory
 * run-control revision that `agent_status` is derived from.
 */
function sessionsEpoch(): string {
  const row = getConn().prepare(
    `SELECT (SELECT COUNT(*) FROM sessions) AS session_count,
            (SELECT MAX(updated_at) FROM sessions) AS updated_at,
            (SELECT COALESCE(MAX(archived_at), '') FROM sessions) AS archived_at,
            (SELECT COUNT(*) FROM sessions WHERE deleted_at IS NOT NULL) AS deleted,
            (SELECT MAX(rowid) FROM workers) AS workers,
            (SELECT MAX(rowid) FROM drafts) AS drafts`,
  ).get() as {
    session_count: number;
    updated_at: string | null;
    archived_at: string;
    deleted: number;
    workers: number | null;
    drafts: number | null;
  };
  return pollEpoch([
    row.session_count, row.updated_at, row.archived_at, row.deleted, row.workers, row.drafts, runControlRevision(),
  ]);
}

function runInBackground(sid: string, me: Json, intent: Intent, col: Row | null, text: string): void {
  const bound = intent.extras?.work_item_id && intent.extras?.task_run_id
    ? {
        workItemId: String(intent.extras.work_item_id),
        runId: String(intent.extras.task_run_id),
        taskType: intent.type,
      }
    : null;
  if (!markSessionRunning(sid)) {
    publishSession(sid, { type: "status", agent_status: sessionStatus(sid) });
    publishQueue(sid);
    return;
  }
  let progress: Json;
  let trace: Json;
  let operations: Json;
  try {
    progress = addMsg(sid, "assistant", "job_status", {
      status: "running",
      text: "正在准备任务…",
    });
    trace = addMsg(sid, "assistant", "process_trace", {
      title: "处理过程",
      items: [{ id: "host:preparing", label: "准备任务", status: "running", kind: "host" }],
    });
    operations = addMsg(sid, "assistant", "operation_trace", {
      title: REMOTE_MCP_TITLE,
      persistent: true,
      active: true,
      items: [],
    });
  } catch (error) {
    clearSessionRunning(sid);
    if (isSessionNotFound(error)) return;
    throw error;
  }
  const progressId = String(progress.id);
  const traceId = String(trace.id);
  const operationId = String(operations.id);
  let operationItems: { id: string; name: string; label: string; status: string }[] = [];
  let processItems: WorkerTraceItem[] = [
    { id: "host:preparing", label: "准备任务", status: "running", kind: "host" },
  ];
  let latestPhase: WorkerProgress["phase"] = "preparing";
  let latestSummary = "";
  let streamId = "";
  let streamText = "";
  let streamFlushAt = 0;
  let traceFlushAt = 0;
  const publishTrace = (force = false) => {
    const now = Date.now();
    const streaming = processItems.some((item) => item.kind === "reasoning" && item.status === "running");
    if (!force && streaming && now - traceFlushAt < 80) return;
    traceFlushAt = now;
    updateMsg(traceId, {
      title: "处理过程",
      items: processItems,
      summaries: reasoningSummariesOf(processItems),
    });
  };
  const publishOperations = (active: boolean) => {
    updateMsg(operationId, {
      title: REMOTE_MCP_TITLE,
      persistent: true,
      active,
      items: operationItems,
    });
  };
  const flushStream = (force = false) => {
    if (!streamText) return;
    const now = Date.now();
    if (!force && streamId && now - streamFlushAt < 80) return;
    streamFlushAt = now;
    if (!streamId) {
      streamId = String(addMsg(sid, "assistant", "assistant", { text: streamText, streaming: true }).id);
      return;
    }
    updateMsg(streamId, { text: streamText, streaming: true });
  };
  publishSession(sid, { type: "status", agent_status: "running" });
  progressBySession.set(sid, (progressEvent) => {
    const { phase, summary, delta, operation } = progressEvent;
    const phaseChanged = phase !== latestPhase;
    latestPhase = phase;
    if (bound && phaseChanged) {
      const taskEventLabels: Partial<Record<WorkerProgress["phase"], string>> = {
        preparing: "准备任务",
        skill_ready: "加载任务规则",
        reading_data: "读取业务数据",
        generating: "正在分析",
        formatting: "整理结果",
        validating: "校验输出",
      };
      appendTaskEvent(bound.workItemId, bound.runId, "run.progress", taskEventLabels[phase] || phase, "running", summary);
    }
    if (delta) {
      streamText += delta;
      flushStream();
    }
    if (summary) latestSummary = summary;
    if (operation) {
      operationItems = upsertOperationItem(operationItems, operation);
      publishOperations(true);
    }
    processItems = applyProgress(processItems, progressEvent);
    const reasoningDelta = progressEvent.trace?.kind === "reasoning" && progressEvent.trace.status === "running";
    publishTrace(!reasoningDelta);
    const statusText = statusTextForProgress(phase, latestSummary);
    if (intent.type === "email_compose" && phase === "generating" && !latestSummary) {
      updateMsg(progressId, { status: "running", text: "正在拟定邮件主题和正文…" });
      return;
    }
    updateMsg(progressId, { status: "running", text: statusText });
  });
  void dispatch(sid, me, intent, col, text)
    .then((result) => {
      finishBoundTask(bound, sid, result);
      const error = result.error as Json | undefined;
      processItems = finishProcessItems(processItems, Boolean(error));
      publishTrace(true);
      publishOperations(false);
      updateMsg(progressId, error
        ? {
            status: "failed",
            text: "未能生成结果，请查看下方提示。",
          }
        : {
            status: "done",
            text: "结果已生成。",
          });
    })
    .catch((e: unknown) => {
      if (isSessionNotFound(e)) {
        finishBoundTask(bound, sid, undefined, e);
        return;
      }
      const stopped = wasSessionStopped(sid) || (e instanceof Error && e.name === "WorkerStopped");
      if (stopped) {
        finishBoundTask(bound, sid, {});
        processItems = finishProcessItems(processItems, false);
        publishTrace(true);
        publishOperations(false);
        updateMsg(progressId, { status: "done", text: "已停止生成。已保留已产生的内容。" });
        return;
      }
      finishBoundTask(bound, sid, undefined, e);
      processItems = finishProcessItems(processItems, true);
      publishTrace(true);
      publishOperations(false);
      if (e instanceof CodexUnavailable) {
        updateMsg(progressId, {
          status: "failed",
          text: "未能生成结果，请查看下方提示。",
        });
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      updateMsg(progressId, {
        status: "failed",
        text: "处理失败，请查看下方提示。",
      });
      if (!isEmailMcpTask(intent.type) && !isKolClawTask(intent.type)) {
        try {
          addMsg(sid, "assistant", "error_card", {
            code: "worker_failed",
            status: "worker_failed",
            message: "任务生成失败。",
            next_action: message,
            persistent: true,
          });
        } catch (writeError) {
          if (!isSessionNotFound(writeError)) throw writeError;
        }
      }
      audit("host", "worker.failed", { message });
    })
    .finally(() => {
      if (streamId) updateMsg(streamId, { text: streamText, streaming: false });
      progressBySession.delete(sid);
      afterRun(sid);
    });
}

function afterRun(sid: string): void {
  clearSessionRunning(sid);
  if (!wasSessionStopped(sid)) {
    const next = shiftQueue(sid);
    if (next) {
      publishQueue(sid);
      launchQueuedAsk(sid, next);
      return;
    }
  }
  publishSession(sid, { type: "status", agent_status: sessionStatus(sid) });
  publishQueue(sid);
}

function publishQueue(sid: string): void {
  publishSession(sid, { type: "queue", queue: publicQueue(sid) });
}

function launchQueuedAsk(sid: string, item: QueuedAsk): void {
  try {
    const col = resolveCollab(item.intent);
    runInBackground(sid, item.me, item.intent, col, item.text);
  } catch (error) {
    if (isSessionNotFound(error)) return;
    throw error;
  }
}

function ok(sid: string, me: Json, intent: Intent, extra: Json = {}): Json {
  const { worker, draft, approval, ...rest } = extra;
  return {
    me,
    intent: { ...intent },
    worker: worker ?? null,
    draft: draft ?? null,
    approval: approval ?? null,
    messages: messages(sid),
    ...rest,
  };
}

function patchDraftFromSnapshot(did: string, snapshot: ResultSnapshot): Row {
  const d = getDraft(did);
  assertDraftEditable(d);
  const extra = {
    ...(typeof d.extra === "object" && d.extra ? d.extra as Json : {}),
    confirmation_revision: Number((d.extra as Json)?.confirmation_revision || 0) + 1,
    amount_usd: snapshot.amount_usd ?? d.amount_usd,
    currency: snapshot.currency || d.currency,
    tracking: snapshot.tracking || null,
    carrier: snapshot.carrier || null,
  };
  const next: Row = {
    ...d,
    from_addr: snapshot.from || d.from_addr,
    to_addr: snapshot.to || d.to_addr,
    subject: snapshot.subject || d.subject,
    body_en: snapshot.body || d.body_en,
    body_zh_internal: snapshot.body_zh_internal || d.body_zh_internal,
    amount_usd: snapshot.amount_usd ?? d.amount_usd,
    currency: snapshot.currency || d.currency,
    extra,
  };
  next.fingerprint = currentFingerprint(next);
  tx((db) => {
    db.prepare(
      `UPDATE drafts SET from_addr=?, to_addr=?, subject=?, body_en=?, body_zh_internal=?,
       amount_usd=?, extra=?, currency=?, fingerprint=? WHERE id=?`,
    ).run(
      next.from_addr,
      next.to_addr,
      next.subject,
      next.body_en,
      next.body_zh_internal,
      next.amount_usd,
      JSON.stringify(extra),
      next.currency,
      next.fingerprint,
      did,
    );
  });
  return getDraft(did);
}

async function applyResultRevision(sid: string, me: Json, intent: Intent, text: string): Promise<Json> {
  const last = lastUnsentResult(messages(sid).filter((row) => String(row.id) !== String(me.id)));
  if (!last) {
    addMsg(sid, "assistant", "assistant", { text: "当前没有可修订的本轮结果。可以说「写合作邮件」或点芯片开新任务。" });
    return ok(sid, me, intent);
  }
  const { fields, thread_id } = await collectReviseFields(last.snapshot, text);
  const { next, changed } = mergeReviseFields(last.snapshot, fields);
  next.thread_id = thread_id || last.thread_id || next.thread_id;
  let draftRow: Row | null = null;
  if (last.draft_id) {
    try {
      draftRow = patchDraftFromSnapshot(String(last.draft_id), next);
      next.draft_id = String(draftRow.id);
      next.from = String(draftRow.from_addr || next.from);
      next.to = String(draftRow.to_addr || next.to);
      next.subject = String(draftRow.subject || next.subject);
      next.body = String(draftRow.body_en || next.body);
      next.body_zh_internal = String(draftRow.body_zh_internal || next.body_zh_internal);
      next.amount_usd = draftRow.amount_usd != null ? Number(draftRow.amount_usd) : next.amount_usd;
    } catch {
      draftRow = null;
    }
  }
  const note = changedLabel(changed);
  addMsg(sid, "assistant", "assistant", { text: note });
  if (last.skill === "email_compose" || last.card.compose_loop || draftRow) {
    const data: Json = {
      ...(last.card.starrykol_data && typeof last.card.starrykol_data === "object" ? last.card.starrykol_data as Json : {}),
      mailboxEmail: next.from,
      from: next.from,
      to: next.to,
      subject: next.subject,
      body: next.body,
      bodyText: next.body,
      amount_usd: next.amount_usd,
      currency: next.currency,
      tracking: next.tracking,
      carrier: next.carrier,
      current_stage: next.stage,
      sent: false,
    };
    const rebuilt = emailMcpResultCard("email_compose", data);
    const loop = next.compose_loop && typeof next.compose_loop === "object" ? next.compose_loop as Json : {};
    const facts = composeFactsFromContext({
      stage: next.stage,
      amount_usd: next.amount_usd,
      currency: next.currency,
      rate_unit: loop.rate_unit === "hour" ? "hour" : null,
      tracking: next.tracking,
      carrier: next.carrier,
      digest: next.digest,
    });
    let card = attachComposeLoopCard({
      ...rebuilt,
      skill: "email_compose",
      persistent: true,
    }, facts, { ...data, handle: next.handle || last.handle });
    card.summary = `${note} ${card.summary || ""}`.trim();
    card = stampResultRevise(card, { skill: "email_compose", snapshot: next, thread_id: next.thread_id, changed });
    addMsg(sid, "assistant", "task_result_card", card);
    if (draftRow) addMsg(sid, "assistant", "email_card", emailCardPayload(draftRow));
    return ok(sid, me, intent, { draft: draftRow });
  }
  const card = stampResultRevise({
    ...last.card,
    title: next.title || last.card.title,
    summary: `${note} ${next.summary || last.card.summary || ""}`.trim(),
    sections: next.sections,
    skill: last.skill,
    persistent: true,
  }, { skill: last.skill, snapshot: next, thread_id: next.thread_id, changed });
  addMsg(sid, "assistant", "task_result_card", card);
  return ok(sid, me, intent);
}

function resolveFollowStyleCollaboration(collaborationId?: string | null, handle?: string | null): Row {
  if (collaborationId) {
    const row = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(collaborationId) as Row | undefined;
    if (row) return row;
  }
  if (handle) {
    const row = getConn().prepare("SELECT * FROM collaborations WHERE handle=? OR display_name=?").get(handle, handle) as
      | Row
      | undefined;
    if (row) return row;
  }
  throw new HttpFail(400, "还需要指定红人。");
}

async function commitFollowStyleTags(input: {
  collaborationId: string;
  tags: unknown;
  mode?: "replace" | "add";
  sessionId?: string;
  announce?: boolean;
}): Promise<Json> {
  const saved = writeFollowStyleTags(input.collaborationId, input.tags, {
    mode: input.mode || "replace",
    actor: scopedUser()?.id || "demo",
  });
  const { publishJourneyForCollaboration } = await import("./kol-journey.js");
  const journey = publishJourneyForCollaboration(input.collaborationId);
  const kolUid = String(saved.collaboration.kol_uid || "").trim();
  if (kolUid && starryKolMcpConfigured() && codexMode() !== "stub") {
    try {
      await executeStarryKolTask("creator_status_update", {
        kolUid,
        followStyleTags: saved.tags,
      }, "host");
    } catch (error) {
      audit("host", "host.follow_style.mcp_failed", {
        kolUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (input.sessionId && input.announce !== false) {
    addMsg(input.sessionId, "assistant", "task_result_card", followStyleCardPayload(saved.collaboration, saved.tags, saved.previous));
  }
  return {
    ok: true,
    follow_style_tags: saved.tags,
    follow_style_presets: FOLLOW_STYLE_PRESETS,
    journey,
    collaboration_id: input.collaborationId,
    handle: saved.collaboration.handle,
  };
}

async function handleFollowStyleTagMessage(sid: string, me: Json, session: Row, text: string, body: Json): Promise<Json> {
  const parsed = parseFollowStyleTagCommand(text);
  const col = resolveFollowStyleCollaboration(
    String(session.collaboration_id || body.collaboration_id || ""),
    parsed.handle,
  );
  if (!parsed.labels.length) {
    addMsg(sid, "assistant", "task_result_card", followStyleCardPayload(col, readFollowStyleTags(col), readFollowStyleTags(col)));
    return {
      me,
      messages: messages(sid),
      accepted: true,
      agent_status: "listening",
      worker: null,
      draft: null,
      follow_style_tags: readFollowStyleTags(col),
      follow_style_presets: FOLLOW_STYLE_PRESETS,
    };
  }
  const result = await commitFollowStyleTags({
    collaborationId: String(col.id),
    tags: parsed.labels,
    mode: "add",
    sessionId: sid,
    announce: true,
  });
  return {
    me,
    messages: messages(sid),
    accepted: true,
    agent_status: "listening",
    worker: null,
    draft: null,
    ...result,
  };
}

export function getDraft(did: string): Row {
  const row = getConn().prepare("SELECT * FROM drafts WHERE id = ?").get(did) as Row | undefined;
  if (!row) throw new HttpFail(404, "draft not found");
  assertSessionAccess(String(row.session_id));
  const d = { ...row };
  if (d.extra) {
    try {
      d.extra = JSON.parse(String(d.extra));
    } catch {
      d.extra = {};
    }
  } else {
    d.extra = {};
  }
  return d;
}

function preferredDraftBrand(item: Json): string | null {
  const direct = String(item.brand || item.brandCode || item.brand_code || "").trim();
  if (direct) return direct;
  if (!item.collaboration_id) return null;
  const col = getConn().prepare("SELECT brand FROM collaborations WHERE id = ?").get(String(item.collaboration_id)) as
    | { brand?: string }
    | undefined;
  return col?.brand ? String(col.brand) : null;
}

function applyAuthorizedFrom(did: string, fromAddr: string, preferredBrand?: string | null): Row {
  const resolved = resolveAuthorizedFrom(fromAddr, currentUser(), preferredBrand);
  if (resolved.email && resolved.email !== fromAddr) {
    tx((db) => {
      db.prepare("UPDATE drafts SET from_addr = ? WHERE id = ?").run(resolved.email, did);
    });
  }
  let d = getDraft(did);
  const fp = currentFingerprint(d);
  if (d.fingerprint !== fp) {
    tx((db) => {
      db.prepare("UPDATE drafts SET fingerprint = ? WHERE id = ?").run(fp, did);
    });
    d = getDraft(did);
  }
  return d;
}

export function persistDraft(sid: string, item: Json): Row {
  const did = nid("dft");
  const requestedFrom = String(item.from || item.mailboxEmail || "").trim();
  const preferredBrand = preferredDraftBrand(item);
  const resolved = resolveAuthorizedFrom(requestedFrom, currentUser(), preferredBrand);
  const extra = {
    amount_usd: item.amount_usd,
    currency: item.currency || (item.amount_usd != null ? "USD" : null),
    rate_unit: item.rate_unit || null,
    deliverables: item.deliverables,
    brand: item.brand || resolved.brand || brandOfMailbox(requestedFrom),
    cpm: item.cpm,
    approval_policy: item.approval_policy,
    missing: item.missing,
    tracking: item.tracking,
    carrier: item.carrier,
    footer: item.footer,
    knowledge_id: item.knowledge_id || null,
    knowledge_version: item.knowledge_version ?? null,
    context_version: item.context_version || null,
    source_draft_id: item.source_draft_id ?? null,
    ...(resolved.email && resolved.email !== requestedFrom ? { send_from: resolved.email } : {}),
  };
  const row: Row = {
    id: did,
    session_id: sid,
    collaboration_id: item.collaboration_id ?? null,
    skill: item.skill || "email_compose",
    from_addr: requestedFrom,
    to_addr: resolveMailTo(null, null, item) || item.to || "",
    cc: item.cc || "",
    subject: item.subject || "",
    body_en: item.body || "",
    body_zh_internal: String(item.body_zh_internal || "").trim()
      || (item.body ? stubInternalZh(String(item.body)) : ""),
    lang_label: "English · 发送为原文",
    amount_usd: item.amount_usd ?? null,
    keep_stage: 1,
    proposed_stage: item.proposed_stage ?? null,
    official_stage: item.official_stage ?? null,
    approval_id: null,
    fingerprint: null,
    template_id: item.template_id || `${item.skill}.v1`,
    sent_at: null,
    status: "draft",
    extra: JSON.stringify(extra),
    currency: extra.currency,
  };
  row.fingerprint = currentFingerprint(row);
  tx((c) => {
    c.prepare(
      `INSERT INTO drafts (
        id, session_id, collaboration_id, skill, from_addr, to_addr, cc, subject,
        body_en, body_zh_internal, lang_label, amount_usd, keep_stage, proposed_stage,
        official_stage, approval_id, fingerprint, template_id, sent_at, status, extra, currency
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      row.id,
      row.session_id,
      row.collaboration_id,
      row.skill,
      row.from_addr,
      row.to_addr,
      row.cc,
      row.subject,
      row.body_en,
      row.body_zh_internal,
      row.lang_label,
      row.amount_usd,
      row.keep_stage,
      row.proposed_stage,
      row.official_stage,
      row.approval_id,
      row.fingerprint,
      row.template_id,
      row.sent_at,
      row.status,
      row.extra,
      row.currency,
    );
  });
  return getDraft(did);
}

export function emailCardPayload(d: Row): Json {
  const extra = typeof d.extra === "object" && d.extra ? (d.extra as Json) : {};
  const user = currentUser();
  const resolved = resolveAuthorizedFrom(String(d.from_addr), user, String(extra.brand || ""));
  const allowed = resolved.allowed.length ? resolved.allowed : allowedFromMailboxes(user, null);
  const brand = resolved.brand;
  const official = d.official_stage as string | null;
  const lockedFrom = allowed.length <= 1;
  const buttons = ["一键翻译中文（内部）"];
  const st = d.status as string;
  if (st === "waiting_approval") buttons.push("提交审批");
  else buttons.push("校验并发送原文");
  let colVer = 0;
  if (d.collaboration_id) {
    const r = getConn().prepare("SELECT stage_version FROM collaborations WHERE id = ?").get(d.collaboration_id) as
      | { stage_version: number }
      | undefined;
    colVer = r ? Number(r.stage_version || 0) : 0;
  }
  if (String(d.skill) === "email_compose") {
    buttons.push("确认推进阶段");
  }
  return {
    draft_id: d.id,
    collaboration_id: d.collaboration_id,
    expected_version: colVer,
    from: d.from_addr,
    send_from: resolved.email || d.from_addr,
    allowed_from_mailboxes: allowed,
    from_locked: lockedFrom,
    from_lock_text: lockedFrom ? "已按品牌和权限锁定" : null,
    to: d.to_addr,
    cc: d.cc || "",
    lang: "English · 发送为原文",
    subject: d.subject,
    body: d.body_en,
    body_zh_internal: d.body_zh_internal,
    amount_usd: d.amount_usd,
    currency: d.currency || extra.currency,
    rate_unit: extra.rate_unit || null,
    deliverables: extra.deliverables,
    brand: extra.brand || brand,
    cpm: extra.cpm,
    approval_policy: extra.approval_policy,
    approval_id: d.approval_id,
    keep_stage: true,
    official_stage: official,
    official_stage_label: official ? label(official) : "",
    proposed_stage: d.proposed_stage,
    proposed_stage_label: d.proposed_stage ? label(String(d.proposed_stage)) : "",
    targets: official
      ? confirmTargetViews(official)
      : [],
    tracks: official ? groupedStageTracks(official) : [],
    status: st,
    send_error: d.send_error,
    knowledge_id: extra.knowledge_id || null,
    knowledge_version: extra.knowledge_version || null,
    buttons,
    send_disabled: ["waiting_approval", "sent", "sending", "send_unknown"].includes(st),
    footer: extra.footer || (d.skill === "ship_notice" ? "已发货" : null),
    skill: d.skill,
  };
}

function setDraftStatus(did: string, status: string, sendError: string | null = null): void {
  tx((c) => {
    c.prepare("UPDATE drafts SET status = ?, send_error = ? WHERE id = ?").run(status, sendError, did);
  });
}

function syncEmailCard(did: string): void {
  const d = getDraft(did);
  const card = emailCardPayload(d);
  const rows = getConn()
    .prepare("SELECT id, payload FROM messages WHERE session_id = ? AND kind = 'email_card'")
    .all(d.session_id) as { id: string; payload: string }[];
  for (const r of rows) {
    try {
      const payload = JSON.parse(r.payload) as Json;
      if (payload.draft_id === did) {
        tx((c) => {
          c.prepare("UPDATE messages SET payload = ? WHERE id = ?").run(JSON.stringify(card), r.id);
        });
      }
    } catch {
      /* skip */
    }
  }
}

function syncComposeResultCard(d: Row): void {
  const rows = getConn()
    .prepare("SELECT id, payload FROM messages WHERE session_id = ? AND kind = 'task_result_card' ORDER BY created_at DESC")
    .all(String(d.session_id)) as { id: string; payload: string }[];
  for (const r of rows) {
    let payload: Json;
    try {
      payload = JSON.parse(r.payload) as Json;
    } catch {
      continue;
    }
    if (payload.skill !== "email_compose" && payload.title !== "邮件草稿") continue;
    const nested = payload.starrykol_data && typeof payload.starrykol_data === "object"
      ? payload.starrykol_data as Json
      : (payload.emailmcp_data && typeof payload.emailmcp_data === "object" ? payload.emailmcp_data as Json : {});
    const data: Json = {
      ...nested,
      subject: d.subject,
      body: d.body_en,
      bodyText: d.body_en,
      mailboxEmail: d.from_addr,
      from: d.from_addr,
      to: d.to_addr,
    };
    const rebuilt = emailMcpResultCard("email_compose", data);
    const next = {
      ...payload,
      title: rebuilt.title,
      summary: rebuilt.summary,
      sections: rebuilt.sections,
      recommended_actions: rebuilt.recommended_actions,
      starrykol_data: data,
      emailmcp_data: data,
    };
    tx((c) => {
      c.prepare("UPDATE messages SET payload = ? WHERE id = ?").run(JSON.stringify(next), r.id);
    });
    break;
  }
}

function syncDraftArtifacts(did: string): void {
  syncEmailCard(did);
  syncComposeResultCard(getDraft(did));
}

function attachMinimalProgress(sid: string): void {
  if (progressBySession.has(sid)) return;
  let processItems: WorkerTraceItem[] = [];
  let operationItems: { id: string; name: string; label: string; status: string }[] = [];
  const trace = addMsg(sid, "assistant", "process_trace", {
    title: "处理过程",
    items: [],
  });
  const operations = addMsg(sid, "assistant", "operation_trace", {
    title: REMOTE_MCP_TITLE,
    persistent: true,
    active: true,
    items: [],
  });
  progressBySession.set(sid, (progress) => {
    if (progress.operation) {
      operationItems = upsertOperationItem(operationItems, progress.operation);
      updateMsg(String(operations.id), {
        title: REMOTE_MCP_TITLE,
        persistent: true,
        active: true,
        items: operationItems,
      });
    }
    processItems = applyProgress(processItems, progress);
    updateMsg(String(trace.id), {
      title: "处理过程",
      items: processItems,
      summaries: reasoningSummariesOf(processItems),
    });
  });
}

function finishWorkerTrace(sid: string, failed: boolean): void {
  const row = getConn().prepare(
    "SELECT id, payload FROM messages WHERE session_id=? AND kind='process_trace' ORDER BY created_at DESC, id DESC LIMIT 1",
  ).get(sid) as { id: string; payload: string } | undefined;
  if (row) {
    let payload: { title?: string; items?: WorkerTraceItem[] } = {};
    try { payload = JSON.parse(String(row.payload || "{}")); } catch { payload = {}; }
    const items = finishProcessItems((payload.items || []) as WorkerTraceItem[], failed);
    updateMsg(row.id, {
      title: payload.title || "处理过程",
      items,
      summaries: reasoningSummariesOf(items),
    });
  }
  const op = getConn().prepare(
    "SELECT id, payload FROM messages WHERE session_id=? AND kind='operation_trace' ORDER BY created_at DESC, id DESC LIMIT 1",
  ).get(sid) as { id: string; payload: string } | undefined;
  if (op) {
    let payload: { title?: string; items?: Json[]; persistent?: boolean } = {};
    try { payload = JSON.parse(String(op.payload || "{}")); } catch { payload = {}; }
    updateMsg(op.id, {
      title: payload.title || REMOTE_MCP_TITLE,
      persistent: true,
      active: false,
      items: payload.items || [],
    });
  }
}

async function execWorker(sid: string, skill: string, text: string, extra: Json): Promise<WorkerResult> {
  const definition = taskDefinition(skill);
  if (!definition) throw new HttpFail(400, { code: "unknown_task_type", task_type: skill });
  requireTaskAccess(skill);
  const sec = hostWorkerTimeout();
  const controller = new AbortController();
  attachRunAbort(sid, controller);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ownedSink = !progressBySession.has(sid);
  if (ownedSink) attachMinimalProgress(sid);
  try {
    const timed = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new CodexUnavailable(
            `生成服务超过 ${sec}s 未返回。`,
            "任务已停止，请稍后重试。",
          ),
        );
      }, sec * 1000);
    });
    const result = await Promise.race([
      Promise.resolve(runWorker(sid, definition, text, extra, controller.signal, progressBySession.get(sid))),
      timed,
    ]);
    if (wasSessionStopped(sid)) {
      if (ownedSink) finishWorkerTrace(sid, false);
      throw Object.assign(new Error("已停止生成"), { name: "WorkerStopped" });
    }
    return result;
  } catch (e) {
    if (wasSessionStopped(sid) || (e instanceof Error && e.name === "WorkerStopped")) {
      if (ownedSink) finishWorkerTrace(sid, false);
      throw Object.assign(new Error("已停止生成"), { name: "WorkerStopped" });
    }
    if (ownedSink) finishWorkerTrace(sid, true);
    if (e instanceof CodexUnavailable) {
      addMsg(sid, "assistant", "error_card", { ...e.asDict(), persistent: true });
      audit("host", "codex.unavailable", {
        skill,
        synthesized: false,
        detail: e.message,
        next_action: e.next_action,
      });
    }
    throw e;
  } finally {
    if (ownedSink) progressBySession.delete(sid);
    if (timer) clearTimeout(timer);
  }
}

function unavailableOk(sid: string, me: Json, intent: Intent, e: CodexUnavailable): Json {
  return ok(sid, me, intent, { worker: null, draft: null, error: e.asDict() });
}

function ensureCompletedWorkerTrace(sid: string, wr: WorkerResult): void {
  const existing = getConn().prepare(
    "SELECT id FROM messages WHERE session_id=? AND kind='process_trace' LIMIT 1",
  ).get(sid);
  if (existing) {
    finishWorkerTrace(sid, wr.status === "failed");
    return;
  }
  addMsg(sid, "assistant", "process_trace", {
    title: "处理过程",
    items: finishProcessItems([], wr.status === "failed"),
    summaries: [],
  });
}

/** Dify 节点输出 → Host Item → 会话 Markdown / 邮件卡 / 黄条 / 清单 */
async function mapWorker(sid: string, me: Json, intent: Intent, wr: WorkerResult): Promise<Json> {
  const workItemId = intent.extras?.work_item_id ? String(intent.extras.work_item_id) : null;
  if (wr.skill === KOL_ANALYZE_TASK_TYPE || intent.type === KOL_ANALYZE_TASK_TYPE) {
    assertKolAnalyzeVerbsSafe(KOL_ANALYZE_TASK_TYPE, { items: wr.items }, workItemId);
  }
  ensureCompletedWorkerTrace(sid, wr);
  const worker: Json = {
    id: wr.worker_id,
    status: wr.status,
    skill: wr.skill,
    profile_id: wr.profile_id,
    thread_id: wr.thread_id || null,
    turn_id: wr.turn_id || null,
    contract_log: wr.contract_log,
  };
  addMsg(sid, "assistant", "steps", {
    title: "箱内步骤（Codex app-server）",
    items: wr.contract_log.map((e) => ({ title: e.method, meta: "" })),
  });
  let draftRow: Row | null = null;
  let approval: Row | null = null;
  let crawlPlan: Json | null = null;
  const composeInput = readComposeInput(intent.extras?.compose_input);
  const skipKolAnalyzeApply = wr.skill === KOL_ANALYZE_TASK_TYPE || intent.type === KOL_ANALYZE_TASK_TYPE;
  for (const item of wr.items) {
    if (item.type === "create_draft") {
      if (skipKolAnalyzeApply) continue;
      const col = resolveCollab(intent);
      Object.assign(item, authoredComposeItem(item, composeInput));
      if (composeInput && col) {
        if (draftRow) continue;
        Object.assign(item, {
          skill: "email_compose", from: preparedSender(col), to: firstEmail(col.email),
          collaboration_id: col.id, official_stage: col.stage_code,
          knowledge_id: intent.extras?.knowledge_id, knowledge_version: composeInput.knowledge_version,
        });
      }
      item.to = assertDraftTo(sid, me, intent, col, item, intent.raw);
      if (col && !item.collaboration_id) item.collaboration_id = col.id;
      if (intent.extras?.knowledge_id && !item.knowledge_id) {
        item.knowledge_id = intent.extras.knowledge_id;
        item.knowledge_version = intent.extras.knowledge_version ?? null;
      }
      const lockedTemplate = intent.extras?.mail_template && typeof intent.extras.mail_template === "object"
        ? intent.extras.mail_template as Json
        : null;
      if (lockedTemplate?.template_id) item.template_id = lockedTemplate.template_id;
      draftRow = persistDraft(sid, item);
      addMsg(sid, "assistant", "email_card", emailCardPayload(draftRow));
    } else if (item.type === "create_approval") {
      continue;
    } else if (item.type === "list_overdue") {
      addMsg(sid, "assistant", "steps", {
        title: "T8 失联与延期",
        items: ((item.items as Json[]) || []).map((i) => ({
          title: `@${i.handle}`,
          meta: `${i.stage_label} · ${i.days} 天`,
        })),
      });
    } else if (item.type === "crawl_plan") {
      crawlPlan = {
        platform: item.platform,
        mode: item.mode,
        ...(Array.isArray(item.keywords) ? { keywords: item.keywords } : {}),
        ...(Array.isArray(item.specified_ids) ? { specified_ids: item.specified_ids } : {}),
        ...(Array.isArray(item.creator_ids) ? { creator_ids: item.creator_ids } : {}),
        requires_confirmation: false,
      };
      addMsg(sid, "assistant", "crawl_plan", {
        text: `已识别远程采集参数：${item.platform || "待选择平台"} / ${item.mode || "search"}。正在自动启动采集。`,
        crawl_plan: crawlPlan,
      });
    } else if (item.type === "task_result") {
      if (intent.type === "business_approval" || wr.skill === "business_approval") continue;
      if (Array.isArray(item.operations) && item.operations.length) {
        const existing = getConn().prepare(
          "SELECT id, payload FROM messages WHERE session_id=? AND kind='operation_trace' ORDER BY created_at DESC, id DESC LIMIT 1",
        ).get(sid) as { id: string; payload: string } | undefined;
        let live: Json[] = [];
        if (existing) {
          try { live = (JSON.parse(String(existing.payload || "{}")).items as Json[]) || []; } catch { live = []; }
        }
        const items = preferHostOperations(live, item.operations as Json[]);
        if (existing) {
          updateMsg(existing.id, {
            title: REMOTE_MCP_TITLE,
            persistent: true,
            active: false,
            items,
          });
        } else {
          addMsg(sid, "assistant", "operation_trace", {
            title: REMOTE_MCP_TITLE,
            items,
            persistent: true,
            active: false,
          });
        }
      }
      const col = resolveCollab(intent);
      const starry = item.starrykol_data && typeof item.starrykol_data === "object"
        ? item.starrykol_data as Json
        : (item.emailmcp_data && typeof item.emailmcp_data === "object" ? item.emailmcp_data as Json : null);
      let card: Json = {
        type: "task_result",
        title: String(item.title || "任务结果"),
        summary: String(item.summary || ""),
        sections: Array.isArray(item.sections) ? item.sections : [],
        ...(item.metrics && typeof item.metrics === "object" ? { metrics: item.metrics } : {}),
        ...(Array.isArray(item.recommended_actions) ? { recommended_actions: item.recommended_actions } : {}),
        ...(Array.isArray(item.suggested_follow_tags) ? { suggested_follow_tags: item.suggested_follow_tags } : {}),
        ...(item.crawl_plan && typeof item.crawl_plan === "object" ? { crawl_plan: item.crawl_plan } : {}),
        ...(Array.isArray(item.candidates) ? { candidates: item.candidates } : {}),
        ...(item.contact_needed !== undefined ? { contact_needed: Boolean(item.contact_needed) } : {}),
        ...(item.notice ? { notice: String(item.notice) } : {}),
        ...(starry ? { starrykol_data: starry, emailmcp_data: starry } : {}),
        ...(item.sop_id ? {
          sop_id: item.sop_id,
          version: item.version,
          stage: item.stage,
          domain: item.domain,
          advancement_mode: item.advancement_mode,
          current_step: item.current_step,
          next_step: item.next_step,
        } : {}),
        ...(Array.isArray(item.phases) ? { phases: item.phases } : {}),
        skill: item.skill || wr.skill,
        profile: item.profile || wr.profile_id,
        persistent: true,
      };
      const composePayload = wr.skill === "email_compose"
        ? composePayloadFromItem(item, wr.items, composeRouteFacts({
          col,
          extra: intent.extras,
          boundMailbox: boundMailboxEmail(),
        }))
        : null;
      if (composePayload) {
        if (composeInput) Object.assign(composePayload, {
          subject: composeInput.subject, body: composeInput.body, bodyText: composeInput.body,
          sent: false, status: "draft", knowledge_id: intent.extras?.knowledge_id, knowledge_version: composeInput.knowledge_version,
        });
        const rebuilt = emailMcpResultCard("email_compose", composePayload);
        card = {
          ...card,
          title: rebuilt.title,
          summary: rebuilt.summary,
          sections: rebuilt.sections,
          recommended_actions: rebuilt.recommended_actions,
          starrykol_data: composePayload,
          emailmcp_data: composePayload,
        };
        const storedFacts = intent.extras?.compose_facts && typeof intent.extras.compose_facts === "object"
          ? intent.extras.compose_facts as ReturnType<typeof composeFactsFromRow>
          : composeFactsFromRow(col, {
            raw: intent.raw,
            amount_usd: intent.amount_usd,
            rate_unit: intent.extras?.rate_unit === "hour" ? "hour" : null,
            stage_code: col?.stage_code,
            tracking: intent.tracking,
            carrier: intent.carrier,
          }, String(intent.extras?.mail_digest || ""));
        card = attachComposeLoopCard(card, storedFacts, {
          ...composePayload,
          handle: String(col?.handle || intent.handle || ""),
        });
      }
      const snap = snapshotFromCards(card, draftRow ? emailCardPayload(draftRow) : null);
      snap.skill = String(item.skill || wr.skill || snap.skill);
      snap.thread_id = wr.thread_id || snap.thread_id;
      snap.handle = String(intent.handle || snap.handle || "");
      snap.collaboration_id = String(intent.collaboration_id || col?.id || snap.collaboration_id || "");
      snap.draft_id = draftRow ? String(draftRow.id) : snap.draft_id;
      card = stampResultRevise(card, {
        skill: snap.skill,
        snapshot: snap,
        thread_id: wr.thread_id || null,
      });
      addMsg(sid, "assistant", "task_result_card", card);
      if (composePayload?.sent && col) {
        void rememberOutboundAndRefreshDigest({
          collaborationId: String(col.id),
          sessionId: sid,
          subject: String(composePayload.subject || ""),
          body: String(composePayload.body || composePayload.bodyText || ""),
          from: firstEmail(composePayload.mailboxEmail || composePayload.from),
          to: firstEmail(composePayload.to || composePayload.recipient),
          conversationId: String(composePayload.conversationId || composePayload.conversation_id || ""),
          providerMessageId: String(composePayload.remote_id || composePayload.messageId || composePayload.message_id || ""),
        });
      }
    } else if (item.type === "propose_stage") {
      if (skipKolAnalyzeApply) continue;
      const cid = String(item.collaboration_id || "");
      const row = cid
        ? getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(cid) as Row | undefined
        : resolveCollab(intent) || undefined;
      if (!row) {
        addMsg(sid, "assistant", "supplement_card", {
          intent: "confirm_stage",
          title: "补全记状态对象",
          handle: intent.handle,
          collaboration_id: intent.collaboration_id,
          fields: [{ key: "handle", label: "红人 / 合作", required: true, value: intent.handle || "" }],
          message: "提出阶段变更需要指定红人或合作。本次未写入阶段。",
        });
        continue;
      }
      const current = normalizeStage(String(row.stage_code));
      const proposed = normalizeStage(String(item.proposed_stage || ""));
      const tracks = groupedStageTracks(current, proposed || null);
      const targets = confirmTargetViews(current, proposed || null);
      if (!targets.some((item) => item.code === proposed)) {
        addMsg(sid, "assistant", "error_card", {
          code: "proposal_illegal_target",
          message: "Skill 提出的阶段不在当前可确认目标中，已阻止展示为可确认建议。",
          current_stage: current,
          proposed_stage: proposed,
          allowed: targets.map((item) => item.code),
          persistent: true,
        });
        continue;
      }
      addMsg(sid, "assistant", "confirm_stage_card", {
        collaboration_id: row.id,
        handle: row.handle,
        current_stage: current,
        current_label: label(current),
        proposed_stage: proposed,
        proposed_label: label(proposed),
        targets,
        tracks,
        expected_version: Number(row.stage_version || 0),
        reason: String(item.reason || ""),
        evidence: item.evidence && typeof item.evidence === "object" ? item.evidence : {},
        locked: Boolean(row.locked) || LOCKED_PROMISE.has(current),
        requires_human_confirmation: true,
        persistent: true,
      });
      addMsg(sid, "system", "sys_msg", {
        text: "这是 Skill 的候选阶段与证据。只有你在确认卡提交后才会写入正式阶段。",
        tone: "yellow",
        has_confirm: false,
      });
    }
  }
  tx((c) => {
    c.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(intent.raw.slice(0, 24), sid);
  });
  if (intent.type === "business_approval" || wr.skill === "business_approval") {
    const created = wr.items.find((row) => row.type === "create_approval") || {};
    const result = wr.items.find((row) => row.type === "task_result") || {};
    const item = { ...result, ...created };
    const expense = handleExpenseApproval(sid, me, intent, intent.raw, item, "worker");
    return { ...expense, worker };
  }
  if (wr.skill === "creator_lifecycle_kanban" || intent.type === "creator_lifecycle_kanban") {
    attachUnboundInbound(sid);
  }
  return ok(sid, me, intent, {
    worker: { ...worker, items: wr.items },
    draft: draftRow,
    approval,
    items: wr.items,
    ...(crawlPlan ? { crawl_plan: crawlPlan } : {}),
  });
}

function attachUnboundInbound(sid: string): void {
  const rows = getConn().prepare(
    "SELECT * FROM inbound WHERE bound = 0 AND IFNULL(deferred, 0) = 0 ORDER BY ts DESC, id DESC",
  ).all() as Row[];
  for (const row of rows) {
    let candidates: { id?: string; handle?: string; score?: number }[] = [];
    try {
      const parsed = JSON.parse(String(row.candidates || "[]"));
      if (Array.isArray(parsed)) candidates = parsed as { id?: string; handle?: string; score?: number }[];
    } catch {
      candidates = [];
    }
    addMsg(sid, "assistant", "inbound_card", {
      inbound_id: row.id,
      from_name: row.from_name,
      from: row.from_addr,
      email: row.from_addr,
      subject: row.subject,
      time: row.ts,
      summary: row.summary,
      candidates,
    });
    addMsg(sid, "system", "sys_msg", {
      text: "无法判断，请人选阶段。不会「已自动记入」。",
      tone: "yellow",
      has_confirm: false,
    });
  }
}

function throwMailToSupplement(sid: string, me: Json, intent: Intent, col: Row | null): never {
  const handle = String(col?.handle || intent.handle || "").trim();
  addMsg(sid, "assistant", "supplement_card", {
    intent: intent.skill || intent.type || "kol",
    title: "补全收件邮箱",
    handle,
    collaboration_id: col?.id || intent.collaboration_id,
    fields: [
      { key: "to", label: "收件邮箱", required: true, value: "" },
    ],
    message: handle
      ? `@${handle} 的画像没有可核验的明文邮箱。不能解密或编造。填写收件邮箱后再出草稿。本次未发送。`
      : "没有可核验的收件邮箱。不能解密或编造。填写收件邮箱后再出草稿。本次未发送。",
  });
  audit("host", "mail.to_missing", { handle, collaboration_id: col?.id || intent.collaboration_id });
  throw new HostReject(422, {
    ...ok(sid, me, intent),
    worker: null,
    draft: null,
    error: { code: "mail_to_missing", message: "To 为空。未发送。" },
  });
}

function assertDraftTo(sid: string, me: Json, intent: Intent, col: Row | null, item?: Json, text?: string): string {
  const to = resolveMailTo(col, intent, item, text || intent.raw);
  if (!to) throwMailToSupplement(sid, me, intent, col);
  if (col?.id) bindCollaborationEmail(String(col.id), to);
  return to;
}

function isMailDraftIntent(intent: Intent): boolean {
  return String(intent.skill || intent.type || "") === "email_compose";
}

function mailOccurredMs(value: unknown): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function composePriorCards(sid: string, col: Row | null): Json[] {
  const items = col?.id
    ? itemsForCollaboration(String(col.id))
      .slice()
      .sort((left, right) => mailOccurredMs(left.occurred_at || left.created_at) - mailOccurredMs(right.occurred_at || right.created_at))
      .map((item) => ({ kind: "kol_mail_card", payload: item }))
    : [];
  return [...items, ...messages(sid)];
}

function namedMailHandleReady(intent: Intent, col: Row | null, text: string): boolean {
  const leftover = leftoverPlaceholders(text).some((token) => /红人或合作/.test(token));
  if (leftover) return false;
  const handle = String(col?.handle || intent.handle || "").trim();
  return Boolean(handle) && !/红人或合作/.test(handle);
}

function applyNamedMailGates(
  sid: string,
  me: Json,
  intent: Intent,
  col: Row | null,
  text: string,
  composeFacts: ComposeFacts,
): Json | null {
  const named = requestedMailKind(text);
  if (named === "testing" && /催大纲/.test(text)) {
    if (!namedMailHandleReady(intent, col, text)) {
      addMsg(sid, "assistant", "supplement_card", {
        intent: "content_nudge",
        title: "补全催大纲对象",
        handle: intent.handle,
        collaboration_id: col?.id || intent.collaboration_id,
        fields: [{ key: "handle", label: "红人或合作", required: true, value: "" }],
        message: "催大纲需要指定红人或合作。未替换「[红人或合作]」时不会默认代发。本次未起箱。",
      });
      return ok(sid, me, intent, { worker: null });
    }
    const stage = normalizeStage(String(col?.stage_code || ""));
    if (!templateAllowedForStage("content_nudge.outline", stage)) {
      addMsg(sid, "assistant", "error_card", {
        code: "nudge_stage_gate",
        message: "仅测试中或内容策划阶段可催大纲。当前阶段不能催大纲，请到已签收-测试中后再试。",
        next_action: "等红人进入已签收-测试中或内容策划后，再催大纲。",
        persistent: true,
      });
      return ok(sid, me, intent, { worker: null });
    }
  }
  if (named === "ship" && !composeFacts.tracking) {
    addMsg(sid, "assistant", "supplement_card", {
      intent: "email_compose",
      title: "补全发货运单",
      handle: intent.handle,
      collaboration_id: col?.id || intent.collaboration_id,
      fields: [{ key: "tracking", label: "运单号", required: true, value: "" }],
      message: "发货通知需要运单号。未填写运单号时不会默认代发。本次未起箱。",
    });
    return ok(sid, me, intent, { worker: null });
  }
  if (named === "address" && !composeFacts.items.some((item) => /寄样资料未齐/.test(item))) {
    const card = attachComposeLoopCard({
      title: "寄样地址核对",
      summary: "可以进入人工确认后的出库流程",
      sections: composeLoopSections(composeFacts),
      recommended_actions: ["联系仓储人工确认出库"],
    }, composeFacts, { handle: String(col?.handle || intent.handle || "") });
    addMsg(sid, "assistant", "task_result_card", card);
    return ok(sid, me, intent, { worker: null });
  }
  return null;
}

async function runWorkerFlow(sid: string, me: Json, intent: Intent, col: Row | null, text: string): Promise<Json> {
  if (intent.type === "business_approval" && isApprovalPathLookup(text)) {
    const entities = intent.extras?.entities && typeof intent.extras.entities === "object"
      ? intent.extras.entities as Json
      : {};
    const amount = expenseFactsFromWorkerItem(entities).amount;
    if (!Number.isFinite(amount) || Number(amount) <= 0) {
      return handleExpenseApproval(sid, me, intent, text);
    }
  }
  const extracted = extractTaskEntities(text);
  mergeExtractedOntoIntent(intent, extracted);
  const sessionCards = messages(sid);
  const priorCompose = {
    ...lastKolMailReply(composePriorCards(sid, col)),
    ...(extracted.confirm_send || extracted.another_letter
      ? lastComposeFollowup(sessionCards, extracted.another_letter ? { body: false } : undefined)
      : {}),
  };
  const composeSubject = resolveComposeSubject({
    raw: text,
    prior: priorCompose,
    extracted,
    entities: intent.extras?.entities && typeof intent.extras.entities === "object"
      ? intent.extras.entities as Json
      : {},
  });
  if (composeSubject) {
    const current = intent.extras?.entities && typeof intent.extras.entities === "object"
      ? intent.extras.entities as Json
      : {};
    intent.extras = {
      ...intent.extras,
      entities: {
        ...current,
        subject: composeSubject,
      },
    };
    priorCompose.subject = composeSubject;
  }
  const mailContext = composeContextForCollaboration(col?.id ? String(col.id) : null);
  const composeFacts = composeFactsFromRow(col, {
    ...(intent.extras?.entities && typeof intent.extras.entities === "object" ? intent.extras.entities as Json : {}),
    stage_code: col?.stage_code,
    raw: text,
    amount_usd: intent.amount_usd ?? extracted.amount_usd,
    currency: extracted.currency,
    rate_unit: intent.extras?.rate_unit === "hour" || extracted.rate_unit === "hour" ? "hour" : null,
    deliverables: extracted.deliverables,
    tracking: intent.tracking,
    carrier: intent.carrier,
  }, mailContext.text);
  const route = composeRouteFacts({
    col,
    extra: {
      entities: {
        ...(priorCompose.mailboxEmail || priorCompose.from
          ? { mailboxEmail: priorCompose.mailboxEmail || priorCompose.from, from: priorCompose.mailboxEmail || priorCompose.from }
          : {}),
        ...(priorCompose.to ? { to: priorCompose.to } : {}),
      },
    },
    boundMailbox: boundMailboxEmail(),
  });
  const extra: Json = {
    handle: col?.handle || intent.handle,
    stage_code: col?.stage_code,
    stage: col?.stage_code,
    creator_id: intent.extras?.creator_id,
    amount_usd: intent.amount_usd ?? composeFacts.amount_usd,
    rate_unit: composeFacts.rate_unit || intent.extras?.rate_unit || null,
    tracking: intent.tracking,
    carrier: intent.carrier,
    collaboration_id: col?.id,
    attachments: intent.extras?.attachments || [],
    model_tier: intent.extras?.model_tier || "balanced",
    mail_digest: mailContext.text,
    mail_memory: mailContext.memory,
    mail_count: mailContext.digest?.mail_count || 0,
    compose_facts: composeFacts,
    derive_child: Boolean(intent.extras?.derive_child),
    entities: {
      ...(intent.extras?.entities && typeof intent.extras.entities === "object" ? intent.extras.entities as Json : {}),
      mail_digest: mailContext.text,
      amount_usd: intent.amount_usd ?? composeFacts.amount_usd,
      currency: composeFacts.currency,
      rate_unit: composeFacts.rate_unit || intent.extras?.rate_unit || null,
      deliverables: composeFacts.deliverables,
      stage_code: col?.stage_code,
      stage: col?.stage_code,
      tracking: intent.tracking,
      carrier: intent.carrier,
      text,
      follow_style_tags: composeFacts.style_tags || [],
      ...(looksLikeEmailDraft(text) ? { body: text } : {}),
      ...(priorCompose.conversationId ? { conversationId: priorCompose.conversationId } : {}),
      ...(route.mailboxEmail ? { mailboxEmail: route.mailboxEmail, from: route.from } : {}),
      ...(route.to ? { to: route.to, email: route.to, recipient: route.to } : {}),
    },
    prior_compose: priorCompose,
    raw: text,
    text,
    subject: composeSubject || String((intent.extras?.entities as Json | undefined)?.subject || ""),
    links: Array.isArray((intent.extras?.entities as Json | undefined)?.links)
      ? (intent.extras?.entities as Json).links
      : [],
    fulfillment: {
      tracking: intent.tracking,
      carrier: intent.carrier,
      eta: intent.eta,
      ...((intent.extras?.entities as Json | undefined)?.fulfillment && typeof (intent.extras?.entities as Json).fulfillment === "object"
        ? (intent.extras?.entities as Json).fulfillment as Json
        : {}),
    },
  };
  const composeInput = readComposeInput(intent.extras?.compose_input);
  const mailTemplate = resolveComposeMailTemplate(intent, col);
  if (mailTemplate) {
    extra.mail_template = mailTemplatePayload(mailTemplate);
    extra.knowledge_id = mailTemplate.id;
    extra.knowledge_version = mailTemplate.version;
    intent.extras = {
      ...intent.extras,
      knowledge_id: mailTemplate.id,
      knowledge_version: mailTemplate.version,
      mail_template: extra.mail_template,
    };
  }
  intent.extras = {
    ...intent.extras,
    mail_digest: mailContext.text,
    compose_facts: composeFacts,
    entities: extra.entities as Json,
  };
  const namedGate = applyNamedMailGates(sid, me, intent, col, text, composeFacts);
  if (namedGate) return namedGate;
  try {
    const wr = await execWorker(sid, intent.skill || intent.type || "creator_discovery", text, workerSafeExtra(extra));
    const mapped = await mapWorker(sid, me, intent, wr);
    if (!mapped.draft && composeInput && mailTemplate) {
      const route = composeRouteFacts({ col, extra, boundMailbox: boundMailboxEmail() });
      const item: Json = {
        type: "create_draft",
        skill: "email_compose",
        template_id: mailTemplate.template_id,
        from: col ? preparedSender(col) : route.from,
        to: col ? firstEmail(col.email) : route.to,
        context_version: composeInput.context_version || null,
        source_draft_id: composeInput.source_draft_id || null,
        subject: composeInput.subject,
        body: composeInput.body,
        collaboration_id: col?.id || null,
        official_stage: col?.stage_code || null,
        knowledge_id: mailTemplate.id,
        knowledge_version: mailTemplate.version,
      };
      const draft = persistDraft(sid, item);
      addMsg(sid, "assistant", "email_card", emailCardPayload(draft));
      syncDraftArtifacts(String(draft.id));
      return { ...ok(sid, me, intent, { worker: mapped.worker, draft, items: mapped.items }), worker: mapped.worker };
    }
    if (!mapped.draft && mailTemplate && !hasComposeDraftOutput(wr.items)) {
      const compiled = compileMailDraft(mailTemplate, knowledgeFillValues(intent, col));
      const leftover = compiled.missing.filter((token) => !COMPOSE_SLOT_PLACEHOLDERS.has(token));
      if (
        compiled.subject
        && compiled.body
        && leftover.length === 0
        && compiled.missing.length === 0
        && !unfilledComposeSlots(mailTemplate, knowledgeFillValues(intent, col))
      ) {
        return { ...persistKnowledgeDraft(sid, me, intent, col, mailTemplate), worker: mapped.worker };
      }
    }
    return mapped;
  } catch (e) {
    if (e instanceof CodexUnavailable) {
      if (intent.type === "business_approval") return handleExpenseApproval(sid, me, intent, text);
      return unavailableOk(sid, me, intent, e);
    }
    if (e instanceof HttpFail) {
      const detail = e.detail && typeof e.detail === "object" ? e.detail as Json : {};
      addMsg(sid, "assistant", "error_card", {
        code: String(detail.code || (isEmailMcpTask(intent.type) ? "starrykol_failed" : isKolClawTask(intent.type) ? "kolclaw_failed" : "worker_failed")),
        message: String(detail.message || e.message),
        next_action: String(detail.next_action || "请稍后重试。"),
        persistent: true,
      });
    }
    throw e;
  }
}

function knowledgeFillValues(intent: Intent, col: Row | null): Record<string, string> {
  const entities = intent.extras?.entities && typeof intent.extras.entities === "object"
    ? intent.extras.entities as Json
    : {};
  const amount = intent.amount_usd != null
    ? intent.amount_usd
    : entities.amount_usd != null && Number.isFinite(Number(entities.amount_usd))
      ? Number(entities.amount_usd)
      : null;
  return {
    handle: String(col?.handle || intent.handle || entities.handle || ""),
    amount: amount != null ? String(amount) : "",
    tracking: String(intent.tracking || entities.tracking || ""),
    carrier: String(intent.carrier || entities.carrier || ""),
    eta: String(intent.eta || entities.eta || ""),
    mailboxEmail: String(entities.mailboxEmail || entities.from || ""),
    to: String(entities.to || entities.email || entities.recipient || col?.email || ""),
    subject: String(entities.subject || ""),
  };
}

const COMPOSE_SLOT_PLACEHOLDERS = new Set([
  "[发件邮箱]", "[发件箱]", "[收件邮箱]", "[收件人]", "[主题]", "[邮件主题]",
]);

function unfilledComposeSlots(template: UsableTemplate, values: Record<string, string>): boolean {
  return template.placeholders.some((token) => {
    if (!COMPOSE_SLOT_PLACEHOLDERS.has(token)) return false;
    if (/发件/.test(token)) return !values.mailboxEmail;
    if (/收件/.test(token)) return !values.to;
    if (/主题/.test(token)) return !values.subject;
    return false;
  });
}

function resolveComposeMailTemplate(intent: Intent, col: Row | null): UsableTemplate | null {
  const skill = String(intent.skill || intent.type || "");
  const authored = readComposeInput(intent.extras?.compose_input);
  if (authored) {
    return assertMailTemplateSnapshotApplicable({
      knowledgeId: String(intent.extras?.knowledge_id || ""), version: authored.knowledge_version,
      skillId: "email_compose", stageCode: String(col?.stage_code || ""), brand: String(col?.brand || ""),
    });
  }
  const entities = intent.extras?.entities && typeof intent.extras.entities === "object"
    ? intent.extras.entities as Json
    : {};
  const exceptionTemplateId = String(entities.exception_template || "").trim();
  if (exceptionTemplateId) {
    const exception = templateById(exceptionTemplateId);
    if (exception) {
      return {
        id: exception.id,
        version: 1,
        kind: "mail_template",
        skill_id: "email_compose",
        brand: "*",
        subject: exception.subject,
        body_en: exception.body_en,
        body: exception.body_en,
        placeholders: [],
        stage_codes: exception.stages,
        title: exception.title,
        template_id: exception.id,
      };
    }
  }
  const knowledgeId = String(intent.extras?.knowledge_id || "").trim();
  if (!knowledgeId && skill !== "email_compose") return null;
  try {
    const template = resolveMailTemplate({
      knowledgeId,
      stageCode: col?.stage_code ? String(col.stage_code) : null,
      skillId: skill === "email_compose" ? "email_compose" : skill || "email_compose",
    });
    if (!template || template.kind !== "mail_template") return null;
    return template;
  } catch (e) {
    if (knowledgeId) throw e;
    return null;
  }
}

function throwKnowledgeSupplement(sid: string, me: Json, intent: Intent, missing: string[]): never {
  addMsg(sid, "assistant", "supplement_card", {
    intent: intent.type,
    title: intent.type === "content_nudge" ? "补全催大纲对象" : "补全知识模板占位",
    handle: intent.handle,
    collaboration_id: intent.collaboration_id,
    fields: missing.map((key) => ({
      key,
      label: key.replace(/^\[|\]$/g, ""),
      required: true,
      value: "",
    })),
    message: intent.type === "content_nudge"
      ? "催大纲需要指定红人或合作。未替换「[红人或合作]」时不会默认代发。本次未起箱。"
      : "启用的邮件模板仍有未填占位，本次未起箱、未写入 wiki。",
  });
  throw new HostReject(422, {
    ...ok(sid, me, intent),
    worker: null,
    error: { code: "knowledge_incomplete", message: "知识模板占位未填", missing },
  });
}

function persistKnowledgeDraft(
  sid: string,
  me: Json,
  intent: Intent,
  col: Row | null,
  template: UsableTemplate,
): Json {
  const compiled = compileMailDraft(template, knowledgeFillValues(intent, col));
  const leftover = [...new Set([...compiled.missing, ...leftoverPlaceholders(intent.raw)])];
  if (leftover.length) throwKnowledgeSupplement(sid, me, intent, leftover);
  const item: Json = {
    type: "create_draft",
    skill: template.skill_id || intent.skill || intent.type,
    template_id: template.template_id,
    from: col?.mailbox_from || BRAND_MAILBOXES[template.brand === "*" ? "" : template.brand] || "",
    to: assertDraftTo(sid, me, intent, col, { to: col?.email }, intent.raw),
    cc: "",
    subject: compiled.subject,
    body: compiled.body,
    body_zh_internal: `内部译稿（不进 SMTP）：${template.title}`,
    keep_stage: true,
    official_stage: col?.stage_code || null,
    collaboration_id: col?.id || null,
    amount_usd: intent.amount_usd,
    tracking: intent.tracking,
    carrier: intent.carrier,
    knowledge_id: template.id,
    knowledge_version: template.version,
  };
  const draft = persistDraft(sid, item);
  addMsg(sid, "assistant", "email_card", emailCardPayload(draft));
  return ok(sid, me, intent, { worker: null, draft });
}

function isApprovalPathLookup(text: string): boolean {
  return /审批路径|查看审批|催办审批|工作审批/.test(text);
}

function latestExpenseApproval(requesterName?: string): Row | null {
  const rows = listApprovals().filter((row) => String(row.kind || "") === "expense");
  if (requesterName) {
    const hit = rows.find((row) => {
      const payload = row.payload && typeof row.payload === "object" ? row.payload as Json : {};
      return String(payload.requester_name || "") === requesterName;
    });
    if (hit) return hit;
  }
  return rows[0] || null;
}

function presentExpenseApproval(sid: string, me: Json, intent: Intent, approval: Row, reused: boolean): Json {
  const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as Json : {};
  const steps = Array.isArray(payload.steps) ? payload.steps as { sequence?: number; name?: string; role?: string; source?: string }[] : [];
  const detail = Array.isArray(approval.chain_detail) ? approval.chain_detail as { name?: string }[] : [];
  const waiting = String(detail[Number(approval.current_index || 0)]?.name || steps[0]?.name || "下一位审批人");
  const names = steps.map((step) => String(step.name || "")).filter(Boolean);
  const chainLine = names.length ? `人员路径：${names.join(" → ")}。` : "";
  const amount = payload.amount;
  const currency = payload.currency || "CNY";
  const amountBase = payload.amount_base;
  const fx = payload.fx_rate;
  const rule = payload.rule_id || "";
  const fxCite = payload.fx_citation && typeof payload.fx_citation === "object" ? payload.fx_citation as Json : null;
  const policyCite = payload.policy_citation && typeof payload.policy_citation === "object" ? payload.policy_citation as Json : null;
  const fxLine = Number.isFinite(Number(amount)) && Number.isFinite(Number(fx))
    ? `${currency} ${amount} × ${fx} = CNY ${amountBase}`
    : "";
  const sourceLine = [fxCite?.source_url, policyCite?.source_url].filter(Boolean).length
    ? `来源：${[fxCite?.source_title || fxCite?.source_url, policyCite?.source_title || policyCite?.id || policyCite?.source_url].filter(Boolean).join("；")}`
    : "";
  addMsg(sid, "assistant", "task_result_card", {
    type: "task_result",
    title: "审批路径",
    summary: reused
      ? `已打开上一笔。${fxLine ? `${fxLine}，` : ""}适用 ${rule}。${sourceLine ? `${sourceLine}。` : ""}${chainLine}当前等待 ${waiting}。`
      : `已提交。${fxLine ? `${fxLine}，` : ""}适用 ${rule}。${sourceLine ? `${sourceLine}。` : ""}${chainLine}当前等待 ${waiting}。`,
    sections: [{
      title: "审批人",
      items: steps.map((step) => `${step.sequence || ""}. ${step.name}｜${step.role}`),
    }],
    metrics: [
      { label: "规则", value: rule },
      { label: "金额", value: `${currency} ${amount}` },
      { label: "人民币等值", value: `CNY ${amountBase}` },
      ...(fxCite?.source_url || policyCite?.source_url
        ? [{ label: "出处", value: String(fxCite?.source_title || policyCite?.title || policyCite?.id || "本轮检索") }]
        : []),
    ],
    recommended_actions: [{ label: "打开工作审批", href: `/approvals?id=${approval.id}` }],
    skill: "business_approval",
    approval_id: approval.id,
    persistent: true,
  });
  addMsg(sid, "assistant", "assistant", {
    text: `${reused ? "已打开上一笔费用审批。" : "已提交。"}${fxLine ? `${fxLine}，适用 ${rule}。` : ""}${sourceLine ? `${sourceLine}。` : ""}${chainLine}当前等待 ${waiting}。`,
    approval_id: approval.id,
    chain_id: approval.chain_id,
  });
  return ok(sid, me, intent, { worker: null, approval, approval_plan: payload });
}

function handleExpenseApproval(
  sid: string,
  me: Json,
  intent: Intent,
  text: string,
  workerItem: Json = {},
  source: "worker" | "host" = "host",
): Json {
  const entities = intent.extras?.entities && typeof intent.extras.entities === "object"
    ? intent.extras.entities as Json
    : {};
  const facts = expenseFactsFromWorkerItem({ ...entities, ...workerItem });
  const fromText = readExpenseFactsFromText(text);
  const hinted = hintRequesterFromOrg(text);
  const parsed = {
    amount: facts.amount ?? fromText.amount ?? Number.NaN,
    currency: facts.currency || fromText.currency,
    requester_id: facts.requester_id || fromText.requester_id || hinted?.id,
    requester_name: facts.requester_name || fromText.requester_name || hinted?.name,
    mailbox: facts.mailbox,
    purpose: facts.purpose || fromText.purpose,
    business_type: facts.business_type || "marketing_expense",
  };
  if (!parsed.requester_id && !parsed.requester_name) {
    try {
      parsed.requester_name = currentUser().name;
    } catch {
      /* demo */
    }
  }
  if (!Number.isFinite(parsed.amount) || parsed.amount <= 0) {
    if (isApprovalPathLookup(text)) {
      const stored = latestExpenseApproval(parsed.requester_name);
      if (stored) return presentExpenseApproval(sid, me, intent, stored, true);
      addMsg(sid, "assistant", "assistant", {
        text: "还没有已提交的费用审批。请先说明申请人、金额和币种。",
      });
      return ok(sid, me, intent, { worker: null });
    }
    addMsg(sid, "assistant", "supplement_card", {
      intent: "business_approval",
      title: "还需要金额和币种",
      fields: [
        { key: "amount", label: "金额", required: true, value: "" },
        { key: "currency", label: "币种（人民币、美元等）", required: true, value: "" },
      ],
      message: "请补上这次申请的金额和币种，例如 50000 美元。审批人不用填，系统按规则计算。",
    });
    return ok(sid, me, intent, { worker: null });
  }
  const cited = tryCitedApprovalPlan({ ...entities, ...workerItem }, parsed);
  const requireCitations = source === "worker" && codexMode() !== "stub";
  if (requireCitations && !cited) {
    addMsg(sid, "assistant", "supplement_card", {
      intent: "business_approval",
      title: "还需要可引用的汇率或费用档",
      fields: [
        { key: "policy_url", label: "费用审批制度公布页", required: false, value: "" },
        { key: "fx_url", label: "汇率来源（央行中间价页）", required: false, value: "" },
      ],
      message: "没有查到可引用的现行中间价或费用档。请补上制度公布页，或让我用网络搜索再查一次。审批人不用填。",
    });
    return ok(sid, me, intent, { worker: null, approval_plan: { blocked: { code: "missing_search_citation" } } });
  }
  const plan = cited || calculateApprovalPlan(parsed);
  if (plan.blocked) {
    addMsg(sid, "assistant", "error_card", {
      code: plan.blocked.code,
      message: plan.explanation,
      policy_id: plan.policy_id,
    });
    return ok(sid, me, intent, { worker: null, approval_plan: plan });
  }
  const approval = createWorkApproval({
    kind: "expense",
    brand: "LT",
    amountUsd: plan.amount_base,
    title: `${plan.requester_name}申请 ${plan.currency} ${plan.amount}，折合人民币 ${plan.amount_base}`,
    chain: plan.steps.map((step) => step.employee_id),
    payload: {
      ...plan,
      steps: plan.steps,
      purpose: parsed.purpose,
    },
  });
  if (!approval?.id) {
    addMsg(sid, "assistant", "error_card", {
      code: "empty_approval_chain",
      message: plan.explanation || "规则引擎没有算出可执行的审批链。",
      policy_id: plan.policy_id,
    });
    return ok(sid, me, intent, { worker: null, approval_plan: plan });
  }
  audit("host", "expense.approval.created", {
    approval_id: approval.id,
    policy_id: plan.policy_id,
    rule_id: plan.rule_id,
    requester_id: plan.requester_id,
  });
  return presentExpenseApproval(sid, me, intent, approval, false);
}

async function applyKnowledge(
  sid: string,
  me: Json,
  intent: Intent,
  col: Row | null,
  text: string,
): Promise<Json | null> {
  const knowledgeId = String(intent.extras?.knowledge_id || "").trim();
  if (!knowledgeId) return null;
  const template = assertUsableKnowledge(knowledgeId);
  if (template.kind !== "mail_template") {
    return runWorkerFlow(sid, me, intent, col, text);
  }
  const entities = extractTaskEntities(text);
  intent.type = template.skill_id || "email_compose";
  intent.skill = template.skill_id || "email_compose";
  intent.needs_worker = true;
  intent.extras = {
    ...intent.extras,
    knowledge_id: template.id,
    knowledge_version: template.version,
    entities: {
      ...entities,
      ...(intent.extras?.entities && typeof intent.extras.entities === "object" ? intent.extras.entities as Json : {}),
      subject: String(entities.subject || template.subject || ""),
      prompt: text,
      raw: text,
    },
  };
  const compiled = compileMailDraft(template, knowledgeFillValues(intent, col));
  const leftover = [...new Set([...compiled.missing, ...leftoverPlaceholders(intent.raw)])]
    .filter((token) => !COMPOSE_SLOT_PLACEHOLDERS.has(token));
  if (leftover.length) throwKnowledgeSupplement(sid, me, intent, leftover);
  const wr = await runWorkerFlow(sid, me, intent, col, text);
  if (wr.draft) return wr;
  const filled = compileMailDraft(template, knowledgeFillValues(intent, col));
  if (
    filled.subject
    && filled.body
    && filled.missing.length === 0
    && !unfilledComposeSlots(template, knowledgeFillValues(intent, col))
  ) {
    return { ...persistKnowledgeDraft(sid, me, intent, col, template), worker: wr.worker };
  }
  return wr;
}

async function dispatch(sid: string, me: Json, intent: Intent, col: Row | null, text: string): Promise<Json> {
  if (intent.extras?.result_revise) {
    return applyResultRevision(sid, me, intent, text);
  }
  if (intent.extras?.knowledge_id) {
    const templated = await applyKnowledge(sid, me, intent, col, text);
    if (templated) return templated;
  }
  if (!intent.needs_worker || intent.type === "chat") {
    addMsg(sid, "assistant", "assistant", {
      text: "可以说「写合作邮件」「记状态」「回复分析」或「发现达人」。",
    });
    return ok(sid, me, intent);
  }
  return runWorkerFlow(sid, me, intent, col, text);
}

type HumanSkipRecord = {
  skip_kind: "skip";
  skip_reason: string;
  skipped_stages: string[];
};

function humanSkipRecord(
  current: string,
  target: string,
  reason: string | null | undefined,
  autoWrite: boolean,
): HumanSkipRecord | null {
  if (autoWrite) return null;
  if (confirmTargetKind(current, target) !== "skip") return null;
  return {
    skip_kind: "skip",
    skip_reason: String(reason || "").trim(),
    skipped_stages: skippedStagesForConfirm(current, target),
  };
}

function persistHumanSkip(collaborationId: string, skip: HumanSkipRecord | null, clearIfAbsent: boolean): void {
  if (skip) {
    getConn().prepare(
      "UPDATE collaborations SET last_skip_kind=?, last_skip_reason=?, last_skipped_stages=? WHERE id=?",
    ).run(skip.skip_kind, skip.skip_reason, JSON.stringify(skip.skipped_stages), collaborationId);
    return;
  }
  if (!clearIfAbsent) return;
  getConn().prepare(
    "UPDATE collaborations SET last_skip_kind=NULL, last_skip_reason=NULL, last_skipped_stages=NULL WHERE id=?",
  ).run(collaborationId);
}

export function hostConfirmStage(
  handle: string | null | undefined,
  stageCode: string | null | undefined,
  collaborationId?: string | null,
  expectedVersion?: number | null,
  reason?: string | null,
  metadata: Json = {},
): Json {
  requireStageWrite();
  const db = getConn();
  let row: Row | undefined;
  if (collaborationId) {
    row = db.prepare("SELECT * FROM collaborations WHERE id = ?").get(collaborationId) as Row | undefined;
  }
  if (!row && handle) {
    row = db.prepare("SELECT * FROM collaborations WHERE handle = ? OR display_name = ?").get(handle, handle) as
      | Row
      | undefined;
  }
  if (!row) throw new HttpFail(404, "collaboration not found");
  const col = { ...row };
  if (!stageCode || /下一阶段|next\s*stage/i.test(String(stageCode).trim())) {
    throw new HttpFail(400, "必须指定具体目标阶段，不能用「下一阶段」");
  }
  const current = normalizeStage(String(col.stage_code));
  const target = normalizeStage(stageCode);
  if (!BY_CODE[target]) throw new HttpFail(400, { code: "unknown_stage", target });
  if (current === target) {
    syncSessionStageCopy(String(col.id), current);
    return {
      waiting_approval: false,
      stage_changed: false,
      already_there: true,
      collaboration_id: col.id,
      kol_uid: col.kol_uid || null,
      stage_code: current,
      stage_label: label(current),
      target,
      target_label: label(target),
      expected_version: Number(col.stage_version || 0),
      new_version: Number(col.stage_version || 0),
    };
  }
  if (LOCKED_PROMISE.has(current) || col.locked) {
    throw new HttpFail(403, { code: "locked_promise", message: "承诺锁定期，禁止改阶段" });
  }
  const autoWrite = String(metadata.recommender || "") === "fact_advance";
  const actor = autoWrite ? "auto" : "human";
  assertStageTransition(current, target, actor, reason);
  // require_approval from the graph is enforced below via approvalKindForStage.
  const skip = humanSkipRecord(current, target, reason, autoWrite);
  const ver = Number(col.stage_version || 0);
  if (expectedVersion != null && Number(expectedVersion) !== ver) {
    throw new HttpFail(409, { code: "version_conflict", message: "阶段已被他人更新，请刷新后再确认", expected: expectedVersion, actual: ver });
  }
  const fromApproval = Boolean(metadata.from_approval_id);
  const approvalKind = approvalKindForStage(target);
  if (approvalKind && !fromApproval) {
    const pending = listApprovals().find((row) => {
      const payload = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Json;
      return String(row.status) === "pending"
        && String(row.kind) === approvalKind
        && String(payload.collaboration_id || "") === String(col.id)
        && String(payload.stage_code || "") === target;
    });
    if (pending?.id) {
      return {
        waiting_approval: true,
        stage_changed: false,
        approval_id: pending.id,
        collaboration_id: col.id,
        kol_uid: col.kol_uid || null,
        stage_code: current,
        stage_label: label(current),
        target,
        target_label: label(target),
        expected_version: ver,
        new_version: ver,
        kind: approvalKind,
      };
    }
    const user = currentUser();
    const chain = {
      ids: ["emp_wang"],
      steps: [{ employee_id: "emp_wang", name: "王主管", role: "推广部负责人" }],
    };
    const approval = createWorkApproval({
      kind: approvalKind,
      brand: String(col.brand || "LT"),
      title: `确认阶段：${label(current)} → ${label(target)}`,
      chain: chain.ids,
      payload: {
        handle: col.handle,
        collaboration_id: col.id,
        stage_code: target,
        current_stage: current,
        stage_label: label(current),
        target_label: label(target),
        expected_version: ver,
        reason: reason || "人工确认阶段",
        reason_code: metadata.reason_code || (skip ? "HUMAN_SKIP" : undefined),
        evidence: metadata.evidence,
        recommender: metadata.recommender,
        approver: metadata.approver,
        session_id: metadata.session_id,
        requester_name: user.name || user.handle,
        steps: chain.steps,
        skip_kind: skip?.skip_kind,
        skip_reason: skip?.skip_reason,
        skipped_stages: skip?.skipped_stages,
      },
    });
    if (!approval?.id) {
      throw new HttpFail(500, { code: "empty_approval_chain", message: "阶段审批链为空，无法提交审批" });
    }
    audit("host", "host.confirm_stage.queued", {
      collaboration_id: col.id,
      from_stage: current,
      to_stage: target,
      approval_id: approval.id,
      kind: approvalKind,
      sent: false,
    });
    return {
      waiting_approval: true,
      stage_changed: false,
      approval_id: approval.id,
      collaboration_id: col.id,
      kol_uid: col.kol_uid || null,
      stage_code: current,
      stage_label: label(current),
      target,
      target_label: label(target),
      expected_version: ver,
      new_version: ver,
      kind: approvalKind,
    };
  }
  const targetStage = BY_CODE[target];
  const user = currentUser();
  const transition: StageTransitionInput = {
    collaboration_id: String(col.id),
    from_stage: current,
    to_stage: target,
    reason_code: String(metadata.reason_code || (skip ? "HUMAN_SKIP" : "HUMAN_CONFIRMED")),
    evidence: (metadata.evidence && typeof metadata.evidence === "object"
      ? metadata.evidence
      : { reason: reason || "人工确认", source: "workbench" }) as Json,
    recommender: String(metadata.recommender || "Commander"),
    approver: String(metadata.approver || user.handle),
    occurred_at: String(metadata.occurred_at || nowIso()),
    data_version_before: ver,
    data_version_after: ver + 1,
    capability_profile: String(targetStage.domain || "Commander"),
    advancement_mode: targetStage.advancementMode,
  };
  const result = confirmStarryStage(String(col.lifecycle_id), target, "host", transition);
  persistHumanSkip(String(col.id), skip, !autoWrite);
  audit("host", "host.confirm_stage", {
    lifecycle_id: col.lifecycle_id,
    from_stage: current,
    to_stage: target,
    transition_id: result.transition_id,
    sent: false,
    reason,
    reason_code: transition.reason_code,
    evidence: transition.evidence,
    recommender: transition.recommender,
    approver: transition.approver,
    occurred_at: transition.occurred_at,
    data_version_before: ver,
    data_version_after: ver + 1,
    skip_kind: skip?.skip_kind || null,
    skip_reason: skip?.skip_reason || null,
    skipped_stages: skip?.skipped_stages || [],
    remote_stage_code: toLegacyStarryStage(target),
  });
  syncSessionStageCopy(String(col.id), target, String(metadata.session_id || ""), skip);
  void import("./kol-journey.js").then((mod) => mod.publishJourneyForCollaboration(String(col.id)));
  return {
    ...result,
    expected_version: ver,
    new_version: ver + 1,
    reason,
    transition,
    collaboration_id: col.id,
    kol_uid: col.kol_uid || null,
    waiting_approval: false,
    stage_changed: true,
    skip_kind: skip?.skip_kind || null,
    skip_reason: skip?.skip_reason || null,
    skipped_stages: skip?.skipped_stages || [],
    remote_stage_code: toLegacyStarryStage(target),
    from_stage: current,
  };
}

export function syncSessionStageCopy(
  collaborationId: string,
  stageCode: string,
  extraSessionId = "",
  skip: HumanSkipRecord | null = null,
): void {
  const col = getConn().prepare("SELECT handle, display_name FROM collaborations WHERE id=?").get(collaborationId) as Row | undefined;
  if (!col) return;
  const official = label(stageCode);
  const headline = stageHeadline(stageCode);
  const title = `${col.display_name || col.handle} · ${official}`;
  const now = nowIso();
  const sessions = getConn().prepare(
    "SELECT id FROM sessions WHERE collaboration_id=? AND deleted_at IS NULL AND archived_at IS NULL",
  ).all(collaborationId) as { id: string }[];
  const extra = String(extraSessionId || "").trim();
  if (extra && !sessions.some((session) => session.id === extra)) {
    getConn().prepare("UPDATE sessions SET collaboration_id=?, title=?, updated_at=? WHERE id=?").run(
      collaborationId, title, now, extra,
    );
    sessions.push({ id: extra });
  }
  for (const session of sessions) {
    getConn().prepare("UPDATE sessions SET title=?, updated_at=? WHERE id=?").run(title, now, session.id);
    const rows = getConn().prepare(
      "SELECT id, payload FROM messages WHERE session_id=? AND kind='assistant'",
    ).all(session.id) as { id: string; payload: string }[];
    for (const row of rows) {
      let payload: Json;
      try {
        payload = JSON.parse(row.payload) as Json;
      } catch {
        continue;
      }
      const text = String(payload.text || "");
      if (!/的合作会话。当前阶段：/.test(text)) continue;
      const next = text.replace(/当前阶段：[^。]+/, `当前阶段：${headline}`);
      if (next === text) continue;
      payload.text = next;
      getConn().prepare("UPDATE messages SET payload=? WHERE id=?").run(JSON.stringify(payload), row.id);
    }
    const cards = getConn().prepare(
      "SELECT id, payload FROM messages WHERE session_id=? AND kind='confirm_stage_card'",
    ).all(session.id) as { id: string; payload: string }[];
    for (const row of cards) {
      let payload: Json;
      try {
        payload = JSON.parse(row.payload) as Json;
      } catch {
        continue;
      }
      payload.current_stage = stageCode;
      payload.current_label = official;
      payload.resolved = true;
      payload.locked = true;
      if (skip) {
        payload.skip_kind = skip.skip_kind;
        payload.skip_reason = skip.skip_reason;
        payload.skipped_stages = skip.skipped_stages;
      }
      getConn().prepare("UPDATE messages SET payload=? WHERE id=?").run(JSON.stringify(payload), row.id);
    }
  }
}

function confirmedFromStage(result: Json, fallback?: string | null): string {
  const transition = result.transition && typeof result.transition === "object" ? result.transition as Json : {};
  return String(result.from_stage || transition.from_stage || fallback || "");
}

async function syncConfirmedStageToMcp(
  col: Row,
  target: string,
  reason?: string | null,
  fromStage?: string | null,
): Promise<Json | null> {
  const kolUid = String(col.kol_uid || "").trim();
  if (!kolUid) return { skipped: true, reason: "missing_kol_uid" };
  if (!starryKolMcpConfigured() && codexMode() !== "stub") {
    return { skipped: true, reason: "mcp_not_configured" };
  }
  if (codexMode() !== "stub" && !liveRemoteSideEffectsEnabled()) {
    return { skipped: true, reason: "live_side_effects_disabled" };
  }
  if (codexMode() !== "stub" && !liveTestKolAllowed(kolUid)) {
    return { skipped: true, reason: "kol_not_in_live_test_allowlist" };
  }
  const from = String(fromStage || "").trim();
  if (!from) return { skipped: true, reason: "missing_from_stage" };
  try {
    const data = await writeRemoteOfficialStageWalk({
      kolUid,
      lifecycleId: col.lifecycle_id as string | number | null | undefined,
      lastLifecycleId: col.last_lifecycle_id as string | number | null | undefined
        ?? (col as { lastLifecycleId?: string | number }).lastLifecycleId,
      last_lifecycle_id: col.last_lifecycle_id as string | number | null | undefined,
      fromStage: from,
      stageCode: target,
      reason: reason || `会话确认进入 ${label(target)}`,
    });
    const hops = Array.isArray(data.hops) ? data.hops as Json[] : [];
    for (const hop of hops) {
      audit("host", "host.confirm_stage.mcp", {
        kolUid,
        target,
        from_stage: hop.from,
        to_stage: hop.to,
        native: hop.native,
        lifecycleId: remoteLifecycleIdFrom(col, {
          lastLifecycleId: col.last_lifecycle_id,
          lifecycle_id: col.lifecycle_id,
        }),
        tool: data.tool,
        updated: Boolean(hop.updated),
      });
    }
    if (data.error) {
      audit("host", "host.confirm_stage.mcp_failed", {
        kolUid,
        target,
        from_stage: from,
        failed_hop: data.failed_hop,
        failed_native: data.failed_native,
        hops,
        error: data.message,
      });
    } else if (data.skipped) {
      audit("host", "host.confirm_stage.mcp", {
        kolUid,
        target,
        from_stage: from,
        skipped: true,
        reason: data.reason,
      });
    }
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit("host", "host.confirm_stage.mcp_failed", { kolUid, target, from_stage: from, error: message });
    return { error: true, message };
  }
}

export function hostRejectStage(
  sessionId: string,
  reason?: string | null,
  collaborationId?: string | null,
): Json {
  requireSkill("confirm_stage");
  const note = String(reason || "").trim();
  if (!note) throw new HttpFail(400, "驳回必须填写备注");
  const sid = String(sessionRow(sessionId).id);
  const cards = getConn().prepare(
    "SELECT id, payload FROM messages WHERE session_id=? AND kind='confirm_stage_card' ORDER BY created_at DESC",
  ).all(sid) as { id: string; payload: string }[];
  let touched = 0;
  let colId = String(collaborationId || "");
  for (const row of cards) {
    let payload: Json;
    try {
      payload = JSON.parse(row.payload) as Json;
    } catch {
      continue;
    }
    if (colId && String(payload.collaboration_id || "") !== colId) continue;
    if (payload.resolved || payload.rejected) continue;
    if (!colId) colId = String(payload.collaboration_id || "");
    payload.rejected = true;
    payload.resolved = true;
    payload.locked = true;
    payload.reject_reason = note;
    getConn().prepare("UPDATE messages SET payload=? WHERE id=?").run(JSON.stringify(payload), row.id);
    touched += 1;
  }
  const msg = addMsg(sid, "assistant", "assistant", {
    text: `已驳回阶段建议：${note}。正式阶段未改，也未写远程。`,
    rejected: true,
  });
  if (colId) {
    void import("./kol-journey.js").then((mod) => mod.publishJourneyForCollaboration(colId));
  }
  audit("host", "host.confirm_stage.rejected", { session_id: sid, collaboration_id: colId || null, reason: note });
  return {
    rejected: true,
    stage_changed: false,
    sent: false,
    collaboration_id: colId || null,
    message: msg,
    cards_resolved: touched,
  };
}

export async function applyConfirmedStageFromApproval(payload: Json, approvalId: string): Promise<Json> {
  const result = hostConfirmStage(
    payload.handle ? String(payload.handle) : undefined,
    String(payload.stage_code || ""),
    payload.collaboration_id ? String(payload.collaboration_id) : undefined,
    parseExpectedVersion(payload.expected_version),
    payload.reason ? String(payload.reason) : undefined,
    {
      ...payload,
      from_approval_id: approvalId,
      reason_code: payload.reason_code,
      evidence: payload.evidence,
      recommender: payload.recommender,
      approver: payload.approver,
    },
  );
  if (!result.waiting_approval && result.collaboration_id) {
    const col = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(String(result.collaboration_id)) as Row | undefined;
    if (col) {
      result.mcp_sync = await syncConfirmedStageToMcp(
        col,
        String(result.stage_code || payload.stage_code || ""),
        payload.reason ? String(payload.reason) : null,
        confirmedFromStage(result, payload.current_stage ? String(payload.current_stage) : null),
      );
    }
  }
  return result;
}

host.post("/sessions", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  if (body.collaboration_id) {
    const { openKolSession } = await import("./kol-journey.js");
    return c.json(await openKolSession(String(body.collaboration_id)));
  }
  const sid = nid("ses");
  const title = String(body.title || "新会话");
  const now = nowIso();
  tx((db) => {
    db.prepare("INSERT INTO sessions (id, title, created_at, updated_at, kind, disabled, owner_user_id) VALUES (?,?,?,?,?,?,?)").run(
      sid,
      title,
      now,
      now,
      body.kind || "work",
      0,
      scopedUser()?.id || null,
    );
  });
  return c.json({ id: sid, title, created_at: now });
});

host.post("/collaborations/:id/session", async (c) => {
  const { openKolSession, syncKolSessionMail, isMailSyncing, journeyPayloadWithMailMemory, journeyPayload } = await import("./kol-journey.js");
  const opened = openKolSession(c.req.param("id"));
  const cid = c.req.param("id");
  void syncKolSessionMail(String(opened.id), cid)
    .then(() => journeyPayloadWithMailMemory(cid, { retryFailed: true }))
    .then((journey) => {
      if (journey) publishSession(String(opened.id), { type: "journey", journey });
    })
    .catch(() => 0);
  opened.journey = {
    ...(journeyPayload(cid) || {}),
    // Mail collection is started in the background. Expose its actual state in
    // the opening response so the client can render progress immediately.
    mail_sync_pending: isMailSyncing(cid),
  };
  return c.json(opened);
});

host.post("/collaborations/:id/ingest-mail", async (c) => {
  const { ingestKolMail } = await import("./kol-journey.js");
  const body = (await c.req.json().catch(() => ({}))) as Json;
  return c.json(ingestKolMail(c.req.param("id"), body));
});

host.get("/sessions", (c) => {
  const user = scopedUser();
  const all = c.req.query("scope") === "all" && user && isAdmin(user);
  const includeArchived = c.req.query("include_archived") === "1";
  // Every open tab polls this endpoint; a 4s cache of the same data window
  // replaces ~800 rows-worth of per-session queries with one projection.
  const cacheKey = `sessions:${all ? "all" : user?.id || "anon"}:${includeArchived ? 1 : 0}`;
  const payload = cachedPoll(cacheKey, sessionsEpoch(), () => {
    const archivedClause = includeArchived ? "" : " AND archived_at IS NULL";
    const rows = (!authDisabled() && user && !all
      ? getConn().prepare(
          `SELECT * FROM sessions WHERE owner_user_id=? AND deleted_at IS NULL${archivedClause} ORDER BY updated_at DESC`,
        ).all(user.id)
      : getConn().prepare(
          `SELECT * FROM sessions WHERE deleted_at IS NULL${archivedClause} ORDER BY updated_at DESC`,
        ).all()) as Row[];
    const visible = rows.filter((r) => {
      const title = String(r.title || "");
      return !(
        (PLATFORM_EXAMPLE_TITLES as readonly string[]).includes(title) ||
        r.disabled ||
        r.kind === "platform_example"
      );
    });
    const statusBySession = sessionStatusMap(visible.map((r) => String(r.id)));
    return visible.map((r) => ({
      ...r,
      agent_status: statusBySession.get(String(r.id)) || sessionStatus(String(r.id)),
    }));
  });
  return c.json(payload);
});

host.get("/sessions/:sid", async (c) => {
  const s = sessionRow(c.req.param("sid"));
  if (s.collaboration_id) {
    const col = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(String(s.collaboration_id)) as Row | undefined;
    if (col) {
      const { restoreOfficialCollaborationStage } = await import("../starrykol/library-sync.js");
      restoreOfficialCollaborationStage(col);
    }
    if (c.req.query("sync") === "1") {
      const { syncKolSessionMail } = await import("./kol-journey.js");
      void syncKolSessionMail(String(s.id), String(s.collaboration_id), {
        force: c.req.query("force") === "1",
      }).catch(() => 0);
      const stage = getConn().prepare("SELECT stage_code FROM collaborations WHERE id=?").get(String(s.collaboration_id)) as Row | undefined;
      syncSessionStageCopy(String(s.collaboration_id), normalizeStage(String(stage?.stage_code || col?.stage_code || "")));
    }
  }
  s.messages = messages(String(s.id));
  s.agent_status = sessionStatus(String(s.id));
  s.run_queue = publicQueue(String(s.id));
  const { journeyPayloadWithMailMemory } = await import("./kol-journey.js");
  s.journey = await journeyPayloadWithMailMemory(
    s.collaboration_id ? String(s.collaboration_id) : null,
    { retryFailed: c.req.query("sync") === "1" },
  );
  return c.json(s);
});

host.get("/sessions/:sid/events", async (c) => {
  const sid = c.req.param("sid");
  const row = sessionRow(sid);
  const snapshot = async () => {
    const { journeyPayloadWithMailMemory } = await import("./kol-journey.js");
    return {
      messages: messages(sid),
      agent_status: sessionStatus(sid),
      collaboration_id: row.collaboration_id ? String(row.collaboration_id) : null,
      journey: await journeyPayloadWithMailMemory(
        row.collaboration_id ? String(row.collaboration_id) : null,
      ),
    };
  };
  const first = await snapshot();
  return new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("snapshot", { ...first, run_queue: publicQueue(sid) });
      const unsub = subscribeSession(sid, (ev) => send(ev.type, ev));
      const ping = setInterval(() => send("ping", { t: Date.now() }), 15000);
      const abort = () => {
        clearInterval(ping);
        unsub();
        try { controller.close(); } catch { /* already closed */ }
      };
      c.req.raw.signal.addEventListener("abort", abort);
    },
    cancel() {
      /* abort handler already tears down */
    },
  }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});

host.patch("/sessions/:sid", async (c) => {
  const row = sessionRow(c.req.param("sid"));
  const body = (await c.req.json()) as Json;
  const title = String(body.title || "").trim();
  if (!title) throw new HttpFail(400, "title required");
  getConn().prepare("UPDATE sessions SET title=?,updated_at=? WHERE id=?")
    .run(title.slice(0, 120), nowIso(), row.id);
  audit(scopedUser()?.id || "demo", "session.rename", { session_id: row.id });
  return c.json({ ...row, title: title.slice(0, 120) });
});

async function recognizeBoxOrAsk(
  sid: string,
  me: Json,
  text: string,
  body: Json,
  boundTask: BoundTask | null,
): Promise<Intent | null> {
  const locked = boundTask?.taskType
    || (body.intent && taskDefinition(String(body.intent)) ? String(body.intent) : undefined);
  const resolution = await recognizeTaskIntent({
    text,
    task_type: locked,
    entities: body.entities && typeof body.entities === "object" ? body.entities as Record<string, unknown> : undefined,
    input: {
      ...(body.knowledge_id ? { knowledge_id: String(body.knowledge_id) } : {}),
      ...(body.collaboration_id ? { collaboration_id: String(body.collaboration_id) } : {}),
    },
  });
  if (resolution.error || resolution.source === "none") {
    addMsg(sid, "assistant", "error_card", {
      code: "intent_unavailable",
      message: resolution.error || "识别服务未就绪，请再试一次。",
      next_action: resolution.next_action || "检查 OPENAI_API_KEY 是否已被 Host 加载后，在箱内重试。",
      persistent: true,
    });
    return null;
  }
  if (!resolution.task_type || resolution.clarification_kind === "direction") {
    addMsg(sid, "assistant", "supplement_card", {
      intent: "",
      title: "需要确认任务方向",
      clarification_kind: "direction",
      alternatives: resolution.alternatives,
      fields: [],
      message: "请选择最符合你意图的任务，或补充说明后再发。",
    });
    return null;
  }
  const intent = classify(text, resolution.task_type, body.collaboration_id as string | undefined);
  intent.type = resolution.task_type;
  intent.skill = resolution.task_type;
  intent.needs_worker = true;
  intent.extras = {
    ...intent.extras,
    entities: resolution.entities,
    derive_child: !locked,
  };
  return intent;
}

host.post("/sessions/:sid/compose-preview", async (c) => {
  const sid = c.req.param("sid");
  const session = sessionRow(sid);
  requireTaskAccess("email_compose");
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const col = collabById(String(body.collaboration_id || session.collaboration_id || ""))
    || resolveCollab({
      type: "email_compose",
      skill: "email_compose",
      handle: String(body.handle || "") || null,
      amount_usd: null,
      tracking: null,
      carrier: null,
      eta: null,
      needs_worker: false,
      raw: "",
      collaboration_id: String(body.collaboration_id || session.collaboration_id || "") || null,
      extras: {},
    });
  const handle = String(col?.handle || body.handle || "");
  const stage = String(col?.stage_code || "");
  const text = String(body.text || "").trim() || stageMailAction(handle, stage).prompt;
  const extra: Json = {
    handle,
    stage_code: stage,
    collaboration_id: col?.id,
    compose_preview_only: true,
    raw: text,
    text,
  };
  if (codexMode() !== "stub") {
    if (!col) {
      throw new HttpFail(400, { code: "collaboration_required", message: "真实预览必须绑定具体 KOL 合作记录" });
    }
    try {
      const wr = await runWorker(sid, "email_compose", text, extra);
      const draft = wr.items.find((item) => item.type === "create_draft");
      const bodyText = String(draft?.body || "").trim();
      if (bodyText) {
        return c.json({
          subject: String(draft?.subject || ""),
          body: bodyText,
          amount_usd: draft?.amount_usd ?? null,
          currency: draft?.currency || null,
          rate_unit: draft?.rate_unit || null,
          source: "codex",
        });
      }
      throw new CodexUnavailable("Codex 未返回可用邮件草稿，未使用本地模板代替。", "检查 app-server、Skill 和 MCP 后重试。");
    } catch (e) {
      throw e;
    }
  }
  return c.json({
    ...previewComposeForCollaboration(col || null, text, extra),
    source: "seed",
  });
});

host.post("/sessions/:sid/messages", async (c) => {
  const sid = c.req.param("sid");
  const session = sessionRow(sid);
  if (!isSessionRunning(sid)) beginSessionAsk(sid);
  const body = (await c.req.json()) as Json;
  if (session.collaboration_id && !body.collaboration_id) {
    body.collaboration_id = session.collaboration_id;
  }
  if (body.act && body.act !== "ask") {
    throw new HttpFail(400, "go 只改路由，禁止 POST /messages、禁止起箱");
  }
  if (!agentSubmissionAllowed()) {
    throw new HttpFail(409, { code: "agent_not_published", message: "KOL Agent 尚未发布，员工端暂不可提交", next_action: "等待管理员发布 Agent" });
  }
  const boundTask = bindTaskMessage(sid, body);
  const text = String(body.text || body.content || "").trim();
  const attachments = sanitizeAttachments(body.attachments);
  const pendingResult = lastUnsentResult(messages(sid));
  const lockedIntent = boundTask?.taskType
    || (body.intent && taskDefinition(String(body.intent)) ? String(body.intent) : undefined);
  const me = addMsg(sid, "me", "me", { text, grey: true, attachments });
  if (!boundTask && !body.compose_input && /^(?:确认发送(?:原文|邮件)?|发送这封(?:邮件)?|confirm\s+send)[。.!！\s]*$/i.test(text)) {
    addMsg(sid, "assistant", "assistant", {
      text: "请在右栏草稿点击「确认发送」，核对收件人、发件人、抄送、主题及完整正文后确认。聊天中的这句话不会发送邮件。",
      needs_confirmation: true, sent: false,
    });
    return c.json({ messages: messages(sid), agent_status: "listening", needs_confirmation: true, sent: false, worker: null, draft: null });
  }
  if (!boundTask && isFollowStyleTagCommand(text)) {
    return c.json(await handleFollowStyleTagMessage(sid, me, session, text, body));
  }
  const intent = boundTask
    ? (() => {
      const locked = classify(text, boundTask.taskType, body.collaboration_id as string | undefined);
      locked.type = boundTask.taskType;
      locked.skill = boundTask.taskType;
      locked.needs_worker = true;
      return locked;
    })()
    : isResultRevision(text, pendingResult, { lockedIntent, boundTask: Boolean(boundTask) })
      ? (() => {
        const revise = classify(text, pendingResult?.skill || "email_compose", body.collaboration_id as string | undefined);
        revise.type = String(pendingResult?.skill || "email_compose");
        revise.skill = String(pendingResult?.skill || "email_compose");
        revise.needs_worker = true;
        revise.handle = pendingResult?.handle || revise.handle;
        revise.collaboration_id = pendingResult?.collaboration_id || revise.collaboration_id;
        revise.extras = { result_revise: true };
        return revise;
      })()
    : await recognizeBoxOrAsk(sid, me, text, body, boundTask);
  if (!intent) {
    return c.json({
      messages: messages(sid),
      accepted: true,
      agent_status: "listening",
      needs_clarification: true,
      worker: null,
      draft: null,
    });
  }
  intent.extras = {
    ...intent.extras,
    ...(attachments.length ? { attachments } : {}),
    ...(body.creator_id ? { creator_id: body.creator_id } : {}),
    ...(body.knowledge_id ? { knowledge_id: String(body.knowledge_id) } : {}),
    ...(body.compose_input ? { compose_input: readComposeInput(body.compose_input) } : {}),
    model_tier: String(body.model_tier || "balanced"),
    entities: {
      ...(intent.extras?.entities && typeof intent.extras.entities === "object" ? intent.extras.entities as Json : {}),
      ...(body.entities && typeof body.entities === "object" ? body.entities as Json : {}),
    },
    ...(boundTask
      ? { work_item_id: boundTask.workItemId, task_run_id: boundTask.runId }
      : {}),
  };
  mergeExtractedOntoIntent(intent, {
    ...extractTaskEntities(text),
    ...(intent.extras.entities && typeof intent.extras.entities === "object" ? intent.extras.entities as Json : {}),
  });
  if (intent.skill && !isSkillGranted(intent.skill)) {
    throw new HttpFail(400, "未授权该技能");
  }
  let col = resolveCollab(intent);
  // Internal stub runs may receive the generic exception template before the
  // async library sync has exposed its exception row on the home board. Use
  // one seeded exception only in that test profile; production requires an
  // explicit collaboration selected by the user.
  const exceptionTemplate = intent.extras?.entities
    && typeof intent.extras.entities === "object"
    && String((intent.extras.entities as Json).exception_template || "");
  if (!col && exceptionTemplate && codexMode() === "stub" && authDisabled()) {
    col = getConn().prepare(
      "SELECT * FROM collaborations WHERE stage_code IN ('PAUSED','DISPUTED','LOST','REJECTED','CANCELLED') ORDER BY id LIMIT 1",
    ).get() as Row | undefined || null;
  }
  if (col) {
    intent.collaboration_id = String(col.id);
    if (!intent.handle) intent.handle = String(col.handle || "");
  }
  validateComposeInput(intent, col);
  if (col && isMailDraftIntent(intent) && !isEmailMcpTask(intent.type) && !intent.extras?.result_revise && !resolveMailTo(col, intent, {}, text)) {
    throwMailToSupplement(sid, me, intent, col);
  }
  // Real Codex / Starry KOL MCP may take tens of seconds. Never hold the
  // browser/proxy request open: acknowledge immediately and let GET /sessions/:sid poll.
  const startsWorker = Boolean(intent.needs_worker && intent.type !== "chat");
  const skill = intent.skill || intent.type || "creator_discovery";
  if (startsWorker) requireTaskAccess(skill);
  if (isWriteSkill(skill) && isSessionRunning(sid)) {
    dropOwnMe(me);
    throw new HttpFail(409, "请先停止当前生成，再确认阶段。");
  }
  if (startsWorker && isSessionRunning(sid)) {
    enqueueAsk(sid, { text, intent, me });
    publishQueue(sid);
    return c.json({
      ...ok(sid, me, intent),
      accepted: true,
      queued: true,
      agent_status: "running",
      run_queue: publicQueue(sid),
    }, 202);
  }
  if (startsWorker && wasSessionStopped(sid)) {
    return c.json({
      ...ok(sid, me, intent),
      accepted: true,
      stopped: true,
      agent_status: sessionStatus(sid),
      run_queue: publicQueue(sid),
    });
  }
  if (codexMode() !== "stub" && startsWorker) {
    runInBackground(sid, me, intent, col, text);
    return c.json({
      ...ok(sid, me, intent),
      accepted: true,
      agent_status: sessionStatus(sid),
      run_queue: publicQueue(sid),
    }, 202);
  }
  try {
    if (startsWorker && !markSessionRunning(sid)) {
      return c.json({
        ...ok(sid, me, intent),
        accepted: true,
        stopped: true,
        agent_status: sessionStatus(sid),
        run_queue: publicQueue(sid),
      });
    }
    const result = await dispatch(sid, me, intent, col, text);
    finishBoundTask(boundTask, sid, result);
    return c.json(result);
  } catch (e) {
    if (e instanceof Error && e.name === "WorkerStopped") {
      finishBoundTask(boundTask, sid, {});
      return c.json({
        ...ok(sid, me, intent),
        accepted: true,
        stopped: true,
        agent_status: sessionStatus(sid),
        run_queue: publicQueue(sid),
      });
    }
    if (e instanceof CodexUnavailable) {
      const result = unavailableOk(sid, me, intent, e);
      finishBoundTask(boundTask, sid, result);
      return c.json(result);
    }
    finishBoundTask(boundTask, sid, undefined, e);
    throw e;
  } finally {
    if (startsWorker) afterRun(sid);
  }
});

function dropOwnMe(me: Json): void {
  const age = Date.now() - Date.parse(String(me.created_at || ""));
  if (!Number.isFinite(age) || age > 2000) return;
  getConn().prepare("DELETE FROM messages WHERE id=?").run(me.id);
}

host.post("/sessions/:sid/stop", (c) => {
  const sid = c.req.param("sid");
  sessionRow(sid);
  const wasRunning = isSessionRunning(sid);
  const attached = hasRunAbort(sid);
  abortSessionRun(sid);
  if (wasRunning && !attached) {
    afterRun(sid);
  } else {
    publishSession(sid, { type: "status", agent_status: sessionStatus(sid) });
    publishQueue(sid);
  }
  return c.json({
    stopped: wasRunning,
    run_queue: publicQueue(sid),
    agent_status: sessionStatus(sid),
  });
});

host.delete("/sessions/:sid/queue/:qid", (c) => {
  const sid = c.req.param("sid");
  sessionRow(sid);
  const qid = c.req.param("qid");
  if (!removeQueued(sid, qid)) throw new HttpFail(404, "队列中没有这条任务");
  publishQueue(sid);
  return c.json({ ok: true, run_queue: publicQueue(sid) });
});

host.get("/drafts/:did/actions", (c) => {
  return c.json(mailSendAction(getDraft(c.req.param("did"))));
});

host.post("/drafts/:did/send", async (c) => {
  const did = c.req.param("did");
  const d = getDraft(did);
  const body = (await c.req.json().catch(() => ({}))) as Json;
  if (["cc", "from_addr", "to_addr", "subject", "body", "body_en", "template_id"].some((key) => body[key] !== undefined)) {
    throw new HttpFail(409, { code: "mail_edits_require_reconfirmation", message: "请先保存修改，再核对当前草稿并确认发送。" });
  }
  try {
    validateMailSend(d);
  } catch (error) {
    if (error instanceof PepFail) {
      // Preserve the existing persistent, actionable policy feedback, but do not send.
      if (!d.sent_at && !["sent", "sending", "send_unknown"].includes(String(d.status))) {
        setDraftStatus(did, error.status, error.message);
      }
      const msg = addMsg(String(d.session_id), "assistant", "error_card", { ...error.asDict(), draft_id: did, persistent: true });
      audit("host", "host.send.fail", { draft_id: did, status: error.status, called_stage: false });
      recordFailedSession({ reason: error.status, code: error.status, draft_id: did, message: error.message }, String(d.session_id));
      syncEmailCard(did);
      throw new HttpFail(error.http, { ...error.asDict(), toast_success: false, draft: emailCardPayload(getDraft(did)), message_id: msg.id });
    }
    throw error;
  }
  const input = { confirmation_version: String(body.confirmation_version || ""), request_id: String(body.request_id || "") };
  const claimed = claimMailSend(did, input);
  if (claimed.replay) {
    return c.json({ ok: true, status: "sent", replayed: true, result: claimed.replay, stage_changed: false, keep_stage: true });
  }
  syncEmailCard(did);
  let result: Json;
  try {
    result = await sendDraft(did, "operator", input.request_id);
  } catch {
    // A successful provider receipt must not be turned into a false failure by ancillary work.
    if (getDraft(did).status === "sent") {
      const replay = claimMailSend(did, input).replay;
      return c.json({ ok: true, status: "sent", replayed: true, result: replay, stage_changed: false, keep_stage: true });
    }
    markMailSendUnknown(did, input.request_id);
    const msg = addMsg(String(d.session_id), "assistant", "error_card", {
      status: "send_unknown", message: "邮件发送回执暂未确认；请核对邮件服务结果，勿重复发送。",
      next_action: "核对邮件回执后再处理。正式阶段未改。", persistent: true,
    });
    syncEmailCard(did);
    return c.json({ ok: false, status: "send_unknown", stage_changed: false, toast_success: false, message: msg }, 502);
  }
  syncEmailCard(did);
  const sentExtra = typeof d.extra === "object" && d.extra ? d.extra as Json : {};
  audit("host", "host.send", { draft_id: did, request_id: input.request_id, called_stage: false, knowledge_id: sentExtra.knowledge_id || null, knowledge_version: sentExtra.knowledge_version || null });
  const col = d.collaboration_id ? getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(d.collaboration_id) as Row | undefined : undefined;
  const stageNow = col?.stage_code as string | undefined;
  const msg = addMsg(String(d.session_id), "assistant", "assistant", {
    text: `已发送原文。正式阶段仍是 ${stageNow ? label(stageNow) : "不变"}（发送 ≠ 改阶段）。`,
    sent: true, status: "sent", draft_id: did, request_id: input.request_id,
  });
  if (col) {
    void rememberOutboundAndRefreshDigest({
      collaborationId: String(col.id), sessionId: String(d.session_id), subject: String(d.subject || ""), body: String(d.body_en || ""),
      from: String(d.from_addr || ""), to: String(d.to_addr || ""), conversationId: String(col.conversation_id || ""), providerMessageId: String(d.id),
    }).catch(() => audit("host", "host.send.digest_pending", { draft_id: did }));
  }
  return c.json({ ok: true, status: "sent", result, official_stage: stageNow, stage_changed: false, toast_success: false, message: msg, keep_stage: true });
});

host.post("/drafts/:did/translate", async (c) => {
  requireConnector("starry", "read");
  const did = c.req.param("did");
  const d = getDraft(did);
  const cached = String(d.body_zh_internal || "").trim();
  const zh = await translateDraftInternal(String(d.body_en || ""), cached);
  if (!zh) throw new HttpFail(409, { message: "暂时无法生成中文译稿" });
  if (zh !== cached) {
    tx((db) => {
      db.prepare("UPDATE drafts SET body_zh_internal = ? WHERE id = ?").run(zh, did);
    });
    syncEmailCard(did);
  }
  return c.json({ ok: true, zh, internal_only: true, smtp: false });
});

host.get("/drafts/:did/export", (c) => {
  const d = getDraft(c.req.param("did"));
  if ((c.req.query("format") || "eml") !== "eml") throw new HttpFail(400, "format must be eml");
  const header = (value: unknown) => String(value || "").replace(/[\r\n]+/g, " ").trim();
  const eml = [
    `From: ${header(d.from_addr)}`,
    `To: ${header(d.to_addr)}`,
    ...(d.cc ? [`Cc: ${header(d.cc)}`] : []),
    `Subject: ${header(d.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(d.body_en || ""),
  ].join("\r\n");
  c.header("Content-Type", "message/rfc822");
  c.header("Content-Disposition", `attachment; filename="${header(d.id)}.eml"`);
  return c.body(eml);
});

host.patch("/drafts/:did", async (c) => {
  const did = c.req.param("did");
  const existing = getDraft(did);
  assertDraftEditable(existing);
  const body = (await c.req.json()) as Json;
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (body.cc != null) {
    fields.push("cc = ?");
    vals.push(body.cc);
  }
  if (body.subject != null) {
    fields.push("subject = ?");
    vals.push(body.subject);
  }
  if (body.body_en != null) {
    fields.push("body_en = ?");
    vals.push(body.body_en);
  }
  if (body.amount_usd != null) {
    fields.push("amount_usd = ?");
    vals.push(body.amount_usd);
  }
  if (body.from_addr != null) {
    const extra = typeof existing.extra === "object" && existing.extra ? (existing.extra as Json) : {};
    const resolved = resolveAuthorizedFrom(String(body.from_addr), currentUser(), String(extra.brand || ""));
    if (!resolved.brand) throw new HttpFail(400, "From 必须是品牌邮箱");
    fields.push("from_addr = ?");
    vals.push(resolved.email);
  }
  if (body.to_addr != null) {
    fields.push("to_addr = ?");
    vals.push(String(body.to_addr).trim());
  }
  if (body.template_id != null) {
    fields.push("template_id = ?");
    vals.push(body.template_id);
  }
  if (!fields.length) return c.json(getDraft(did));
  tx((db) => {
    const current = getDraft(did);
    assertDraftEditable(current);
    const extra = typeof current.extra === "object" && current.extra ? current.extra as Json : {};
    const revisedExtra = { ...extra, confirmation_revision: Number(extra.confirmation_revision || 0) + 1 };
    db.prepare(`UPDATE drafts SET ${fields.join(", ")}, extra = ? WHERE id = ?`).run(...vals, JSON.stringify(revisedExtra), did);
  });
  let d = getDraft(did);
  const fp = currentFingerprint(d);
  tx((db) => {
    db.prepare("UPDATE drafts SET fingerprint = ? WHERE id = ?").run(fp, did);
  });
  syncDraftArtifacts(did);
  return c.json(getDraft(did));
});

host.post("/drafts/:did/confirm-stage", async (c) => {
  requireSkill("confirm_stage");
  const d = getDraft(c.req.param("did"));
  const body = (await c.req.json().catch(() => ({}))) as Json;
  if (!body.stage_code) throw new HttpFail(400, "必须指定具体目标阶段，不能用「下一阶段」");
  const result = hostConfirmStage(
    null,
    String(body.stage_code),
    d.collaboration_id as string | undefined,
    parseExpectedVersion(body.expected_version),
    body.reason as string | undefined,
    { ...body, session_id: d.session_id },
  );
  if (!result.waiting_approval && result.collaboration_id) {
    const col = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(String(result.collaboration_id)) as Row | undefined;
    if (col) {
      result.mcp_sync = await syncConfirmedStageToMcp(
        col,
        String(body.stage_code),
        body.reason as string | undefined,
        confirmedFromStage(result),
      );
    }
  }
  const waiting = Boolean(result.waiting_approval);
  const msg = result.already_there
    ? null
    : addMsg(String(d.session_id), "assistant", "assistant", {
      text: waiting
        ? `已提交阶段审批（${result.target_label}）。正式阶段仍是 ${result.stage_label}。请到「工作审批」。`
        : `正式阶段已按你的确认更新：${result.stage_label}。未发信。`,
      approval_id: result.approval_id || undefined,
      waiting_approval: waiting,
    });
  return c.json({ ...result, sent: false, message: msg });
});

host.put("/collaborations/:id/follow-style-tags", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const col = resolveFollowStyleCollaboration(c.req.param("id"), body.handle as string | undefined);
  const sessionId = String(body.session_id || "").trim();
  const mode = body.mode === "add" ? "add" : "replace";
  const result = await commitFollowStyleTags({
    collaborationId: String(col.id),
    tags: body.tags,
    mode,
    sessionId: sessionId || undefined,
    announce: Boolean(sessionId),
  });
  return c.json(result);
});

host.post("/collaborations/:cid/confirm-stage", async (c) => {
  requireSkill("confirm_stage");
  const body = (await c.req.json().catch(() => ({}))) as Json;
  if (!body.stage_code) throw new HttpFail(400, "必须指定具体目标阶段，不能用「下一阶段」");
  const result = hostConfirmStage(
    null,
    String(body.stage_code),
    c.req.param("cid"),
    parseExpectedVersion(body.expected_version),
    body.reason as string | undefined,
    body,
  );
  if (!result.waiting_approval && result.collaboration_id) {
    const col = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(String(result.collaboration_id)) as Row | undefined;
    if (col) {
      result.mcp_sync = await syncConfirmedStageToMcp(
        col,
        String(body.stage_code),
        body.reason as string | undefined,
        confirmedFromStage(result),
      );
    }
  }
  return c.json(result);
});

host.post("/sessions/:sid/confirm-stage", async (c) => {
  requireSkill("confirm_stage");
  const sid = c.req.param("sid");
  sessionRow(sid);
  const body = (await c.req.json()) as Json;
  if (body.rejected || body.action === "reject") {
    return c.json(hostRejectStage(sid, body.reason as string | undefined, body.collaboration_id as string | undefined));
  }
  if (!body.stage_code) throw new HttpFail(400, "必须指定具体目标阶段，不能用「下一阶段」");
  const result = hostConfirmStage(
    body.handle as string | undefined,
    String(body.stage_code),
    body.collaboration_id as string | undefined,
    parseExpectedVersion(body.expected_version),
    body.reason as string | undefined,
    { ...body, session_id: sid },
  );
  if (!result.waiting_approval && result.collaboration_id) {
    const col = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(String(result.collaboration_id)) as Row | undefined;
    if (col) {
      result.mcp_sync = await syncConfirmedStageToMcp(
        col,
        String(body.stage_code),
        body.reason as string | undefined,
        confirmedFromStage(result),
      );
    }
  }
  const waiting = Boolean(result.waiting_approval);
  const mcp = result.mcp_sync && typeof result.mcp_sync === "object" ? result.mcp_sync as Json : null;
  const mcpNote = mcpSyncAssistantNote(mcp);
  const msg = result.already_there
    ? null
    : addMsg(sid, "assistant", "assistant", {
      text: waiting
        ? `已提交阶段审批（${result.target_label}）。正式阶段仍是 ${result.stage_label}。请到「工作审批」。`
        : `正式阶段已按你的确认更新：${result.stage_label}。本次不起箱、未发信。${mcpNote}`,
      approval_id: result.approval_id || undefined,
      waiting_approval: waiting,
      mcp_sync: mcp || undefined,
    });
  return c.json({ ...result, worker: null, sent: false, message: msg });
});

function inboundRow(iid: string): Row {
  const inbound = getConn().prepare("SELECT * FROM inbound WHERE id = ?").get(iid) as Row | undefined;
  if (!inbound) throw new HttpFail(404, "Not Found");
  return inbound;
}

function encodeInboundCursor(row: { ts?: unknown; id?: unknown }): string {
  return Buffer.from(`${String(row.ts || "")}|${String(row.id || "")}`, "utf8").toString("base64url");
}

function decodeInboundCursor(raw: string): { ts: string; id: string } | null {
  if (!raw) return null;
  try {
    const text = Buffer.from(raw, "base64url").toString("utf8");
    const sep = text.lastIndexOf("|");
    if (sep < 0) return null;
    return { ts: text.slice(0, sep), id: text.slice(sep + 1) };
  } catch {
    return null;
  }
}

host.get("/inbound", (c) => {
  const limitRaw = Number(c.req.query("limit"));
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const deferred = String(c.req.query("deferred") || "");
  const cursor = decodeInboundCursor(String(c.req.query("cursor") || "").trim());
  const scope = inboundVisibleSql();
  const where = [scope.sql];
  const params: unknown[] = [...scope.params];
  if (deferred === "1" || deferred === "true") where.push("IFNULL(deferred,0) = 1");
  else if (deferred === "0" || deferred === "false") where.push("IFNULL(deferred,0) = 0");
  if (cursor?.ts && cursor.id) {
    where.push("(ts < ? OR (ts = ? AND id < ?))");
    params.push(cursor.ts, cursor.ts, cursor.id);
  }
  const rows = getConn()
    .prepare(
      `SELECT * FROM inbound WHERE ${where.join(" AND ")} ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .all(...params, limit + 1) as Row[];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return c.json({
    items,
    next_cursor: hasMore && last ? encodeInboundCursor(last) : null,
    table: "inbound",
  });
});

host.post("/inbound/:iid/defer", (c) => {
  inboundRow(c.req.param("iid"));
  tx((db) => {
    db.prepare("UPDATE inbound SET deferred = 1 WHERE id = ?").run(c.req.param("iid"));
  });
  return c.json({ ok: true, deferred: true, resumed: false, resumed_other_thread: false });
});

host.post("/inbound/:iid/resume", (c) => {
  inboundRow(c.req.param("iid"));
  tx((db) => {
    db.prepare("UPDATE inbound SET deferred = 0 WHERE id = ?").run(c.req.param("iid"));
  });
  return c.json({ ok: true, deferred: false, resumed: true, resumed_other_thread: false });
});

host.post("/inbound/:iid/bind", async (c) => {
  const iid = c.req.param("iid");
  const inbound = inboundRow(iid);
  const body = (await c.req.json()) as Json;
  const col = assertCollaborationInScope(String(body.collaboration_id || ""));
  const sid = inbound.session_id as string | undefined;
  tx((db) => {
    db.prepare("UPDATE inbound SET bound = 1, collaboration_id = ?, brand = COALESCE(brand, ?) WHERE id = ?")
      .run(col.id, col.brand, iid);
  });
  if (sid) {
    addMsg(sid, "assistant", "assistant", {
      text: `已由人选绑定到 ${collabDisplay(col.id)}。未自动记入、未恢复其它会话。`,
      auto_filed: false,
      resumed_other_thread: false,
    });
  }
  return c.json({ ok: true, bound: true, session_id: sid, resumed_other_thread: false });
});

host.post("/inbound/:iid/create", async (c) => {
  const iid = c.req.param("iid");
  const body = (await c.req.json()) as Json;
  const handle = String(body.handle || "新来信达人");
  const cid = nid("col");
  tx((db) => {
    db.prepare(
      `INSERT INTO collaborations
       (id, handle, display_name, brand, platform, followers, email, mailbox_from,
        lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue, stage_version, locked)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      cid,
      handle,
      handle,
      "LT",
      "inbound",
      "",
      "",
      BRAND_MAILBOXES.LT,
      `lc_${cid}`,
      `conv_${cid}`,
      "INITIAL_CONTACT",
      0,
      "from inbound",
      0,
      0,
      0,
    );
  });
  const inbound = getConn().prepare("SELECT * FROM inbound WHERE id = ?").get(iid) as Row | undefined;
  if (!inbound) throw new HttpFail(404, "Not Found");
  const sid = inbound.session_id as string | undefined;
  tx((db) => {
    db.prepare("UPDATE inbound SET bound = 1, collaboration_id = ? WHERE id = ?").run(cid, iid);
  });
  if (sid) {
    addMsg(sid, "assistant", "assistant", {
      text: `已由人选绑定到 ${collabDisplay(cid)}。未自动记入、未恢复其它会话。`,
      auto_filed: false,
      resumed_other_thread: false,
    });
  }
  return c.json({ ok: true, bound: true, session_id: sid, resumed_other_thread: false });
});

host.get("/inbound/:iid/search", (c) => {
  inboundRow(c.req.param("iid"));
  const q = c.req.query("q") || "";
  const kols = scopedCollaborationSearch(q);
  return c.json({ inbound_id: c.req.param("iid"), kols, resumed_other_thread: false });
});
