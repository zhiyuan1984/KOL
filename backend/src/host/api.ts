import type { PoolClient } from "pg";
import type { Operation } from "../runtime/operations.js";
import { traceEventPayload } from "../worker/trace-events.js";
import { starryKolMcpConfigured } from "../starrykol/connection.js";
/**
 * Host = Dify「应用后端」。
 * 职责：意图分类、选 Skill、起/杀 box、落 session、把 Item 映成 UI Markdown。
 * 确定性分支（阶段门、报价矩阵、From、考试、Cc、fingerprint）在 Host + PEP。
 * 发信 / 企微 / confirm-stage 只调 Gateway，不自己打带 secret 的 HTTP。
 */
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
} from "../config.js";
import { audit, nowIso } from "../db.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { isPostgresClosedError, isPostgresForeignKeyError } from "./postgres-errors.js";
import { sendDraft } from "../gateway/send.js";
import { mailSendAction, claimMailSend, assertDraftEditable, validateMailSend, markMailSendUnknown } from "./mail-send-confirmation.js";
import { replySendView, bindReplySend } from "../mail/reply-send.js";
import { confirmStarryStage } from "../gateway/starry.js";
import { createWorkApproval, listApprovals } from "../gateway/wecom.js";
import { nid } from "../ids.js";
import { saveAssistantReviewDraft } from "../approval/review-assistant.js";
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
import { BudgetBlocked } from "../costs.js";
import { runWorker, type WorkerProgress } from "../worker/runner.js";
import {
  applyProgress,
  finishProcessItems,
  finishOperationItems,
  preferHostOperations,
  reasoningSummariesOf,
  statusTextForProgress,
  upsertOperationItem,
  REMOTE_MCP_TITLE,
  type WorkerTraceItem,
} from "../worker/progress.js";
import { sanitizeAttachments } from "./attachments.js";
import { contextKeyLabel, contextVersion as composeContextVersion, openContext, resolveContext, type ContextResolution } from "./context-resolve.js";
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
  listQueue,
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
import { allowedFromMailboxes, authorizedSenderBrand, brandOfMailbox, enforceSend, PepFail, resolveAuthorizedFrom } from "./pep.js";
import { collaborationBrand, composeSenderFor, type ComposeSender } from "./compose-sender.js";
import { composeRecipientFor } from "./compose-recipient.js";
import { mailboxBindings } from "./mail-memory.js";
import { readPersonDigest } from "./mail-memory-job.js";
import { normalizeEmail } from "./identity.js";
import { currentUser } from "./persona.js";
import { boundMailboxEmail } from "./starry-bind.js";
import { assertSessionAccess } from "../routers/enterprise.js";
import { appendTaskEvent } from "../task-events.js";
import {
  assertKolAnalyzeVerbsSafe,
  failKolAnalyzeIllegalVerb,
  illegalKolAnalyzeVerbs,
  KOL_ANALYZE_TASK_TYPE,
} from "./kol-memory.js";
import { taskDefinition, validateTaskResultSchema } from "../tasks/registry.js";
import { isSkillTemplateSnapshot } from "../tasks/skill-template.js";
import { effectiveSkillTemplate } from "./skill-sop.js";
import { isSafeSkillResultForMemory, persistValidatedSkillResult } from "./skill-result-memory.js";
import { recognizeTaskIntent } from "../tasks/recognize.js";
import { insertSessionMessage, isSessionNotFound } from "./session-messages.js";
import { publishSession, subscribeSession } from "./session-events.js";
import { assertRuntimeSkill, runtimeAgentCandidates, runtimeAgentForSkill } from "../runtime/execution.js";
import { skillConnectorGaps } from "../runtime/skill-connector-gate.js";
import { agentForExpert, employeeExpert } from "../runtime/employee-agents.js";
import { managedAgent } from "../runtime/managed-agents.js";
import { isTestRuntime } from "../codex-runtime.js";
import { extractTaskEntities, mergeExtractedOntoIntent } from "../tasks/resolver.js";
import { fieldLabel } from "../labels.js";
import { assertCollaborationInScope, nativeInboundVisibleSql, scopedCollaborationSearch } from "./inbound-scope.js";
import { parseExpectedVersion } from "./version.js";
import { cachedPollAsync, pollEpoch } from "./response-cache.js";
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
  resolveMailTemplate,
  workerSafeExtra,
  type UsableTemplate,
} from "./knowledge.js";

export const host = new Hono();
// A business-task workspace inherits current Task authorization for every
// session surface, including messages, actions and recovered thread content.
host.use("/sessions/:sid", async (c,next) => {
  const { authorizedTaskSession } = await import("../ticket-domain/task-collaboration-session.js");
  await authorizedTaskSession(scopedUser()?.id || "", c.req.param("sid"));
  await next();
});
host.use("/sessions/:sid/*", async (c,next) => {
  const { authorizedTaskSession } = await import("../ticket-domain/task-collaboration-session.js");
  const workspace = await authorizedTaskSession(scopedUser()?.id || "", c.req.param("sid"),c.req.path.endsWith("/unarchive"));
  if (workspace && ["compose-preview","confirm-stage"].includes(c.req.path.split("/").at(-1) || "")) {
    throw new HttpFail(409,{code:"task_workspace_analysis_only"});
  }
  await next();
});
const progressBySession = new Map<string, (progress: WorkerProgress) => void>();
// Worker emits synchronous notifications. Persist their async facts in order,
// then drain before results/terminal events so no write or rejection is detached.
const progressWrites = new Map<string, Promise<void>>();
const progressErrors = new Map<string, unknown>();
function registerProgress(sid: string, sink: (progress: WorkerProgress) => Promise<void>): void {
  progressBySession.set(sid, (progress) => {
    const next = (progressWrites.get(sid) || Promise.resolve()).then(() => sink(progress));
    progressWrites.set(sid, next.catch((error: unknown) => { if (!progressErrors.has(sid)) progressErrors.set(sid, error); }));
  });
}
async function drainProgress(sid: string): Promise<void> {
  await progressWrites.get(sid);
  progressWrites.delete(sid);
  if (progressErrors.has(sid)) {
    const error = progressErrors.get(sid); progressErrors.delete(sid); throw error;
  }
}

/** 同步执行路径（自管进度）的流式回答收尾：结束时把同一条消息的 streaming 关掉。 */
const minimalStreamClose = new Map<string, () => Promise<void>>();

/** 只读的上下文解析入口沿用提交侧同一套技能授权：未授权就连上下文也不解析。 */
export async function requireTaskAccess(skill: string, agentId?: string): Promise<void> {
  const definition = taskDefinition(skill);
  if (!definition) throw new HttpFail(400, { code: "unknown_task_type", task_type: skill });
  if (codexMode() !== "stub") {
    (await assertRuntimeSkill({ agentId: agentId || (await runtimeAgentForSkill(skill, scopedUser()?.id || "")), skillId: skill,
      userId: scopedUser()?.id || "", runId: "submission" }));
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

/** 会话绑定（来源链第 3 级）读的那一行；入口自行校验访问权。 */
export async function sessionRow(sid: string): Promise<Row> {
  return { ...(await assertSessionAccess(sid)) };
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
  /** 最近往来摘要（来自 composeContextForCollaboration），仅在已有合作时填充 */
  digest?: string;
  /** 最近往来条目数 */
  mail_count?: number;
  /** 收发件来源的人话标签（ADR-2026-10-07）：如「你挂载的默认邮箱」「最近往来 · 10-06」 */
  sources?: { from?: string; to?: string };
  /** 发件箱候选：挂了多只又没有默认时让人选 */
  sender_candidates?: Array<{ email: string; label: string }>;
  /** 收件人候选：最近往来最多 5 个 */
  recipient_candidates?: Array<{ email: string; label: string; last_at?: string | null }>;
};

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

/** 本人挂载的邮箱集合（小写归一）：通讯页选中的邮箱必须在其中。 */
async function isOwnMailbox(email: string): Promise<boolean> {
  const target = normalizeEmail(email);
  if (!target) return false;
  try {
    return (await mailboxBindings()).some((binding) => normalizeEmail(String(binding.mailbox || "")) === target);
  } catch {
    return false;
  }
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

/** 发件箱来源的人话标签，前端直接展示。 */
function senderSourceLabel(sender: ComposeSender): string {
  switch (sender.source) {
    case "explicit": return "口令里指定的";
    case "selected": return "通讯页选中的邮箱";
    case "user_binding": return "你挂载的默认邮箱";
    case "collaboration": return "合作记录里的发件箱";
    case "brand_unique": return "品牌唯一授权邮箱";
    default: return "暂无发件箱";
  }
}

/**
 * 未指定发件箱时的默认发件箱：当前用户挂载的 Starry 邮箱 → 合作记录 mailbox_from
 * → 当前品牌唯一授权箱；核对不过就留空，交给岗位补。规则只此一处（compose-sender）。
 */
async function preparedSender(row: Row): Promise<string> {
  return (await composeSenderFor({ collaboration: row })).from;
}

async function mailComposeContextVersion(row: Row, template: UsableTemplate): Promise<string> {
  return composeContextVersion({
    collaboration_id: row.id, stage: String(row.stage_code || ""), stage_version: row.stage_version || 0,
    brand: String(row.brand || ""), from: (await preparedSender(row)), to: firstEmail(row.email),
    knowledge_id: template.id, published_version: template.version,
  });
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

async function validateComposeInput(intent: Intent, col: Row | null): Promise<ComposeInput | null> {
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
  (await assertCollaborationInScope(String(col.id)));
  if (composeInput.context_version && composeInput.context_version !== (await mailComposeContextVersion(col, template))) {
    throw new HttpFail(409, { code: "compose_context_stale", message: "合作阶段、收发件信息或模板版本已变化，请保留草稿并重新核对上下文。" });
  }
  if (!(await preparedSender(col)) || !firstEmail(col.email)) {
    throw new HttpFail(422, { code: "compose_addresses_required", message: "请补充授权发件邮箱和当前合作的收件邮箱。" });
  }
  if (leftoverPlaceholders(`${composeInput.subject}\n${composeInput.body}`).length) {
    throw new HttpFail(422, { code: "compose_fields_required", message: "请补齐草稿中的模板变量后再提交。" });
  }
  if (composeInput.source_draft_id) {
    const source = (await getDraft(composeInput.source_draft_id));
    (await assertDraftEditable(source));
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

export const prepareMail: Operation["handle"] = async (c, input) => {
  const body = input as Json;
  if (String(body.skill_id || "") !== "email_compose") {
    throw new HttpFail(400, { code: "invalid_skill", message: "skill_id 必须是 email_compose" });
  }
  (await requireTaskAccess("email_compose"));
  const sessionId = String(body.session_id || "").trim();
  const session = sessionId ? (await sessionRow(sessionId)) : null;
  // 上下文一律走解析层（合作对象/阶段/模板/发件箱/往来摘要）；邮件自己的状态与文案仍由本动作判定。
  let resolved = openContext({ skillId: "email_compose", body, session, text: String(body.text || "") });
  const selected = (await resolved.collaboration());
  if (selected.conflict) {
    throw new HttpFail(409, { code: "collaboration_conflict", message: "会话已绑定其他合作对象，不能由请求覆盖" });
  }

  // 收发件不依赖合作对象（ADR-2026-10-07）：先解析发件箱与收件人。
  const requestedMailbox = String(body.mailbox || "").trim();
  if (requestedMailbox && !(await isOwnMailbox(requestedMailbox))) {
    throw new HttpFail(400, { code: "mailbox_not_mounted", message: "选中的邮箱不是本人挂载的邮箱" });
  }
  const sender = (await composeSenderFor({
    collaboration: selected.row,
    requested: String(body.from || ""),
    selectedMailbox: requestedMailbox || null,
  }));
  const extracted = extractTaskEntities(String(body.text || ""));
  const toList = Array.isArray(extracted.to) ? extracted.to : [];
  const explicitTo = firstNonEmpty(
    body.to, body.recipient,
    toList[0], typeof extracted.email === "string" ? extracted.email : "",
  );
  const conversationId = String(body.conversation_id || body.thread_id || "").trim();
  let recipient = (await composeRecipientFor({
    mailbox: sender.from,
    collaboration: selected.row,
    conversationId: conversationId || null,
    explicitTo: explicitTo || null,
  }));
  if (recipient.error) {
    throw new HttpFail(400, { code: recipient.error.code, message: recipient.error.message });
  }

  // 往来匹配采用合作：收件人来自选中会话或最近往来，且该收件邮箱在权限范围内
  // 只匹配到唯一合作时，采用这个合作来套阶段模板和往来摘要；多个候选不猜，
  // 匹配不到就不猜阶段（ADR-2026-10-07）。
  let row = selected.row;
  let adoptedFromMemory = false;
  if (!row && (recipient.source === "conversation" || recipient.source === "memory") && recipient.to) {
    const scope = nativeInboundVisibleSql(2);
    const matches = (await postgresPool().query(
      `SELECT * FROM collaborations WHERE lower(email) = lower($1) AND ${scope.sql}`,
    [recipient.to, ...scope.params])).rows as Row[];
    if (matches.length === 1) {
      const adopted = { ...(matches[0] as Row) };
      row = adopted;
      adoptedFromMemory = true;
      // 采用后按显式合作对象重新走解析层，阶段/模板/往来摘要都按该合作取。
      resolved = openContext({
        skillId: "email_compose",
        body: { ...body, collaboration_id: String(adopted.id) },
        session,
        text: String(body.text || ""),
      });
      recipient = (await composeRecipientFor({
        mailbox: sender.from,
        collaboration: row,
        conversationId: conversationId || null,
        explicitTo: explicitTo || null,
      }));
    }
  }

  const from = sender.from;
  const resolvedTo = recipient.to;
  const sources = { from: senderSourceLabel(sender), to: recipient.label };
  const senderCandidates = sender.candidates;
  const recipientCandidates = recipient.candidates;

  if (!row) {
    const sceneHint = String(body.scene_hint || "").trim();
    let digest: string | undefined;
    let mailCount: number | undefined;
    if (from && resolvedTo) {
      const personDigest = readPersonDigest(from, resolvedTo);
      if (personDigest) {
        digest = personDigest.text || undefined;
        mailCount = personDigest.mail_count || undefined;
      }
    }
    return c.json(prepareReply({
      status: "needs_context",
      message: selected.ambiguous
        ? "请选择单个红人或合作对象。"
        : !from && !resolvedTo
          ? "暂无发件箱，请先绑定邮箱；收件人请补充收件信息。"
          : !from
            ? "暂无发件箱，请先绑定邮箱。"
            : !resolvedTo
              ? "已带出发件箱；暂无该发件箱的收件人，请补充收件信息。"
              : "已带出收发件；该收件人尚无正式合作阶段，未套阶段模板。",
      context: sceneHint === "first_touch" ? { scene: "first_touch", stage_source: "scene_hint" } : {},
      editor: { from, to: resolvedTo ? [resolvedTo] : [], subject: "", body: "" },
      sources,
      sender_candidates: senderCandidates,
      recipient_candidates: recipientCandidates,
      missing_fields: ["collaboration_id"],
      candidates: [],
      digest,
      mail_count: mailCount,
    }));
  }
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
    ...(adoptedFromMemory ? { collaboration_source: "memory_match" } : {}),
    scene: stageMailSpec(stage).kind,
    brand,
  };
  const templateFacts = (await resolved.mailTemplate());
  const templates = templateFacts?.templates || [];
  // 无模板时也要带回 editor/sources/候选：首封可提交草稿，前端可编辑主题正文。
  const noTemplateEditor = {
    from,
    to: resolvedTo ? [resolvedTo] : [],
    subject: "",
    body: "",
  };
  if (!templates.length) {
    return c.json(prepareReply({
      status: "needs_template",
      message: "暂无已启用的适用模板。",
      context,
      editor: noTemplateEditor,
      sources,
      sender_candidates: senderCandidates,
      recipient_candidates: recipientCandidates,
      missing_fields: [],
      candidates: [],
      context_version: composeContextVersion({ collaboration_id: row.id, stage, brand }),
    }));
  }
  const choices = templateFacts?.choices || [];
  if (choices.length !== 1) {
    return c.json(prepareReply({
      status: "needs_template",
      message: "有多个同等适用的模板，请选择其一。",
      context,
      editor: noTemplateEditor,
      sources,
      sender_candidates: senderCandidates,
      recipient_candidates: recipientCandidates,
      missing_fields: [],
      candidates: choices.map(templateCandidate),
      context_version: composeContextVersion({ collaboration_id: row.id, stage, brand, candidates: choices.map((item) => [item.id, item.version]) }),
    }));
  }
  const template = choices[0];
  // 有合作时：收件人优先走来源链（该红人最近往来 > 合作记录邮箱），发件箱沿用上面的解析。
  const to = recipient.to || firstEmail(row.email);
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
  const contextVersion = (await mailComposeContextVersion(row, template));
  const mailContext = (await resolved.mailThread());
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
    sources: { from: senderSourceLabel(sender), to: recipient.label },
    sender_candidates: senderCandidates,
    recipient_candidates: recipientCandidates,
    missing_fields: missingFields,
    candidates: [],
    context_version: contextVersion,
    digest: mailContext?.text || undefined,
    mail_count: mailContext?.mail_count || undefined,
  }));
};

async function collabDisplay(id: unknown): Promise<string> {
  const cid = String(id || "");
  if (!cid) return "该合作";
  const row = (await postgresPool().query("SELECT handle, display_name FROM collaborations WHERE id=$1", [cid])).rows[0] as
    | { handle?: string; display_name?: string }
    | undefined;
  const handle = String(row?.handle || "").trim();
  if (handle) return `@${handle}`;
  const name = String(row?.display_name || "").trim();
  return name || "该合作";
}

/**
 * 当前会话最近一次使用的智能体：若它仍可让此人运行该技能，就沿用它，不重新询问。
 */
async function sessionAgentDefault(sid: string, skillId: string, userId: string): Promise<string | undefined> {
  if (!userId || !skillId) return undefined;
  const row = (await postgresPool().query("SELECT payload FROM messages WHERE session_id=$1 AND kind='agent_identity' ORDER BY created_at DESC, id DESC LIMIT 1", [sid])).rows[0] as { payload?: string } | undefined;
  let agentId = "";
  try { agentId = String((JSON.parse(String(row?.payload || "{}")) as Json).agent_id || ""); } catch { agentId = ""; }
  if (!agentId) return undefined;
  try { return (await runtimeAgentCandidates(skillId, userId)).includes(agentId) ? agentId : undefined; } catch { return undefined; }
}

async function addMsg(sid: string, role: string, kind: string, payload: Json): Promise<Json> {
  if (kind === "process_trace" || kind === "operation_trace") payload = traceEventPayload(null, payload, nowIso());
  if (kind === "me") {
    const last = (await postgresPool().query("SELECT id, payload, created_at FROM messages WHERE session_id=$1 AND kind='me' ORDER BY created_at DESC, id DESC LIMIT 1", [sid])).rows[0] as { id: string; payload: string; created_at: string } | undefined;
    if (last) {
      let prev: Json = {};
      try { prev = JSON.parse(String(last.payload || "{}")); } catch { prev = {}; }
      const age = Date.now() - Date.parse(String(last.created_at));
      if (String(prev.text || "") === String(payload.text || "") && Number.isFinite(age) && age >= 0 && age < 8000) {
        return { id: last.id, session_id: sid, role, kind, payload: prev, created_at: last.created_at };
      }
    }
  }
  return (await insertSessionMessage(sid, role, kind, payload));
}

/**
 * 原地更新的文字条目（流式回答、状态行）按「最后一次有新内容」排在时间流里：
 * 文字变了才刷新 updated_at，只是收尾（关掉 streaming、改状态）不挪位置。
 */
const STREAM_TIMED_KINDS = new Set(["assistant", "job_status"]);

async function updateMsg(mid: string, payload: Json): Promise<void> {
  const row = (await postgresPool().query("SELECT session_id, role, kind, created_at, payload FROM messages WHERE id=$1", [mid])).rows[0] as
    | { session_id: string; role: string; kind: string; created_at: string; payload: string }
    | undefined;
  if (row && (row.kind === "process_trace" || row.kind === "operation_trace")) {
    payload = traceEventPayload(JSON.parse(row.payload), payload, nowIso());
  } else if (row && STREAM_TIMED_KINDS.has(row.kind) && typeof payload.text === "string") {
    let prev: Json = {};
    try { prev = JSON.parse(String(row.payload || "{}")) as Json; } catch { prev = {}; }
    const updatedAt = payload.text !== prev.text ? nowIso() : prev.updated_at;
    if (updatedAt) payload = { ...payload, updated_at: updatedAt };
  }
  (await postgresTransaction(async (c) => {
    (await c.query("UPDATE messages SET payload = $1 WHERE id = $2", [JSON.stringify(payload), mid]));
  }));
  if (row) {
    publishSession(row.session_id, {
      type: "upsert",
      message: { id: mid, session_id: row.session_id, role: row.role, kind: row.kind, payload, created_at: row.created_at },
    });
  }
}

async function messages(sid: string): Promise<Json[]> {
  const rows = (await postgresPool().query("SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at, id", [sid])).rows as Row[];
  return rows.map((r) => ({ ...r, payload: JSON.parse(String(r.payload)) }));
}

type BoundTask = { workItemId: string; runId: string; taskType: string; agentId?: string };

/**
 * Validation only: the run may queue, but nothing has started yet. The state
 * writes live in `startBoundTask`, so a rejected or queued ask can never look
 * like it is already running, and no branch can strand the task in `running`.
 */
async function resolveBoundTask(sid: string, body: Json): Promise<BoundTask | null> {
  if (!body.work_item_id) {
    if (body.run_id || body.task_type) throw new HttpFail(400, "work_item_id required for task message");
    return null;
  }
  const item = (await postgresPool().query("SELECT * FROM tickets WHERE id=$1", [body.work_item_id])).rows[0] as Row | undefined;
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
    ? (await postgresPool().query("SELECT * FROM task_runs WHERE id=$1 AND work_item_id=$2 AND session_id=$3", [body.run_id, item.id, sid])).rows[0]
    : (await postgresPool().query("SELECT * FROM task_runs WHERE work_item_id=$1 AND session_id=$2 AND status='pending' ORDER BY created_at DESC LIMIT 1", [item.id, sid])).rows[0]) as Row | undefined;
  if (!run) throw new HttpFail(409, "pending task run not found");
  if (!["pending", "failed"].includes(String(run.status))) throw new HttpFail(409, `task run is ${run.status}`);
  const runInput = JSON.parse(String(run.input || "{}")) as Json;
  const storedTemplate = runInput._skill_template;
  if (isSkillTemplateSnapshot(storedTemplate, taskType)
    && storedTemplate.version !== effectiveSkillTemplate(taskDefinition(taskType)!).version) {
    const detail = { code: "skill_template_version_conflict", message: "技能模板在排队期间已更新，请重新选用模板并检查参数后创建任务。" };
    (await postgresTransaction(async (db) => {
      (await db.query("UPDATE task_runs SET status='failed',error=$1,completed_at=$2 WHERE id=$3", [JSON.stringify(detail), nowIso(), run.id]));
      (await db.query("UPDATE tickets SET status='needs_clarification',updated_at=$1 WHERE id=$2", [nowIso(), item.id]));
    }));
    (await appendTaskEvent(String(item.id), String(run.id), "run.template_changed", "技能模板已更新", "needs_clarification", detail.message));
    throw new HttpFail(409, detail);
  }
  return { workItemId: String(item.id), runId: String(run.id), taskType,
    ...(runInput.agent_id ? { agentId: String(runInput.agent_id) } : {}) };
}

function boundFromIntent(intent: Intent): BoundTask | null {
  return intent.extras?.work_item_id && intent.extras?.task_run_id
    ? {
        workItemId: String(intent.extras.work_item_id),
        runId: String(intent.extras.task_run_id),
        taskType: intent.type,
      }
    : null;
}

/** Execution really begins: mark the run running and record the start event. */
async function startBoundTask(bound: BoundTask | null): Promise<boolean> {
  if (!bound) return false;
  const now = nowIso();
  const changed = (await postgresTransaction(async (db) => {
    const run = (await db.query("UPDATE task_runs SET status='running',started_at=COALESCE(started_at,$1),error=NULL WHERE id=$2 AND work_item_id=$3 AND status IN ('pending','queued','failed')", [now, bound.runId, bound.workItemId]));
    (await db.query("UPDATE tickets SET status='running',started_at=COALESCE(started_at,$1),updated_at=$2,data_version=data_version+1 WHERE id=$3", [now, now, bound.workItemId]));
    return Number(run.rowCount) > 0;
  }));
  if (!changed) return false;
  (await appendTaskEvent(bound.workItemId, bound.runId, "run.started", "任务开始处理", "running", bound.taskType));
  (await audit(scopedUser()?.id || "demo", "task.run.started", { work_item_id: bound.workItemId, run_id: bound.runId, task_type: bound.taskType }));
  return true;
}

/** The ask waits behind another run: keep the task open and say so. */
async function queueBoundTask(bound: BoundTask | null): Promise<void> {
  if (!bound) return;
  const now = nowIso();
  const changed = (await postgresTransaction(async (db) => {
    const run = (await db.query("UPDATE task_runs SET status='queued',error=NULL WHERE id=$1 AND work_item_id=$2 AND status IN ('pending','failed')", [bound.runId, bound.workItemId]));
    (await db.query("UPDATE tickets SET status='queued',updated_at=$1,data_version=data_version+1 WHERE id=$2 AND status NOT IN ('completed','cancelled','stopped')", [now, bound.workItemId]));
    return Number(run.rowCount) > 0;
  }));
  if (!changed) return;
  (await appendTaskEvent(bound.workItemId, bound.runId, "run.queued", "已排队", "queued", "前面还有一项工作正在处理，轮到时自动开始。"));
}

function employeeFailReason(error: unknown): string {
  if (error instanceof HostReject) {
    const nested = error.payload.error as Json | undefined;
    return String(nested?.message || error.message || "需要补充信息");
  }
  if (error instanceof HttpFail) return error.message || "请求未通过校验";
  if (error instanceof Error) return error.message || "执行未开始";
  if (error && typeof error === "object") {
    const nested = error as Json;
    const message = String(nested.message || nested.detail || "").trim();
    if (message) return message;
  }
  const text = String(error ?? "").trim();
  return text && text !== "[object Object]" ? text : "执行未开始";
}

/** The run never reached execution: close it honestly instead of leaving it running. */
async function failBoundTask(bound: BoundTask | null, error: unknown): Promise<void> {
  if (!bound) return;
  const message = employeeFailReason(error);
  const needsInput = error instanceof HostReject && Number(error.statusCode) === 422;
  const status = needsInput ? "needs_clarification" : "failed";
  const now = nowIso();
  const changed = (await postgresTransaction(async (db) => {
    const run = (await db.query("UPDATE task_runs SET status='failed',error=$1,completed_at=$2 WHERE id=$3 AND work_item_id=$4 AND status IN ('pending','queued','running')", [JSON.stringify({ code: needsInput ? "needs_clarification" : "not_started", message }), now, bound.runId, bound.workItemId]));
    (await db.query("UPDATE tickets SET status=$1,updated_at=$2,data_version=data_version+1 WHERE id=$3 AND status NOT IN ('completed','cancelled','stopped')", [status, now, bound.workItemId]));
    return Number(run.rowCount) > 0;
  }));
  if (!changed) return;
  const summaryMessage = message.replace(/[。．.!！?？；;]+$/u, "");
  (await appendTaskEvent(
    bound.workItemId,
    bound.runId,
    needsInput ? "task.clarification" : "run.failed",
    needsInput ? "还需要补充信息" : "未能开始",
    status,
    needsInput ? summaryMessage : `${summaryMessage}。未产生结果；可重新执行。`,
  ));
  (await audit(scopedUser()?.id || "demo", "task.run.not_started", { work_item_id: bound.workItemId, run_id: bound.runId, message }));
}

/** Cancelled before any execution: the ask left the queue. */
async function cancelBoundTask(bound: BoundTask | null, summary: string): Promise<void> {
  if (!bound) return;
  const now = nowIso();
  const changed = (await postgresTransaction(async (db) => {
    const run = (await db.query("UPDATE task_runs SET status='cancelled',error=NULL,completed_at=$1 WHERE id=$2 AND work_item_id=$3 AND status IN ('pending','queued','running')", [now, bound.runId, bound.workItemId]));
    (await db.query("UPDATE tickets SET status='waiting',completed_at=NULL,updated_at=$1,data_version=data_version+1 WHERE id=$2 AND status NOT IN ('completed','cancelled')", [now, bound.workItemId]));
    return Number(run.rowCount) > 0;
  }));
  if (!changed) return;
  (await appendTaskEvent(bound.workItemId, bound.runId, "run.cancelled", "运行已取消", "cancelled", summary));
  (await audit(scopedUser()?.id || "demo", "task.run.cancelled", { work_item_id: bound.workItemId, run_id: bound.runId }));
}

/** The employee stopped the run mid-flight: keep what was produced. */
async function stoppedBoundTask(bound: BoundTask | null): Promise<void> {
  if (!bound) return;
  const now = nowIso();
  const changed = (await postgresTransaction(async (db) => {
    const run = (await db.query("UPDATE task_runs SET status='cancelled',error=$1,completed_at=$2 WHERE id=$3 AND work_item_id=$4 AND status='running'", [JSON.stringify({ code: "worker_stopped", message: "已停止生成" }), now, bound.runId, bound.workItemId]));
    (await db.query("UPDATE tickets SET status='waiting',completed_at=NULL,updated_at=$1,data_version=data_version+1 WHERE id=$2 AND status IN ('running','in_progress','starting')", [now, bound.workItemId]));
    return Number(run.rowCount) > 0;
  }));
  if (!changed) return;
  (await appendTaskEvent(bound.workItemId, bound.runId, "run.stopped", "已停止生成", "cancelled", "已保留已产生内容；可重新执行。"));
  (await audit(scopedUser()?.id || "demo", "task.run.stopped", { work_item_id: bound.workItemId, run_id: bound.runId }));
}

async function finishBoundTask(bound: BoundTask | null, sid: string, result?: Json, error?: unknown): Promise<void> {
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
    (await postgresTransaction(async (db) => {
      (await db.query("UPDATE task_runs SET status=$1,worker_id=$2,thread_id=$3,turn_id=$4,error=$5,completed_at=$6 WHERE id=$7 AND work_item_id=$8", [runStatus, worker.id || null, worker.thread_id || null, worker.turn_id || null, failed ? JSON.stringify(result?.error || { message: error instanceof Error ? error.message : String(error) }) : null, now, bound.runId, bound.workItemId]));
      (await db.query("UPDATE tickets SET status=$1,completed_at=NULL,updated_at=$2,data_version=data_version+1 WHERE id=$3", [taskStatus, now, bound.workItemId]));
      const run = (await db.query("SELECT created_at FROM task_runs WHERE id=$1", [bound.runId])).rows[0] as
        | { created_at: string }
        | undefined;
      if (!run) return;
      const rows = (await db.query(`SELECT id,kind,payload FROM messages
          WHERE session_id=$1 AND created_at>=$2
            AND kind IN ('task_result_card','email_card','confirm_stage_card','inbound_card','error_card')
          ORDER BY created_at,id`, [sid, run.created_at])).rows as Row[];
      for (const message of rows) {
        (await db.query(`INSERT INTO task_artifacts
           (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [nid("art"), bound.workItemId, bound.runId, message.kind, message.id, 1, message.payload || "{}", now]));
      }
    }));
  } catch (error) {
    if (isPostgresForeignKeyError(error) || isPostgresClosedError(error)) return;
    throw error;
  }
  const failureReason = failed
    ? employeeFailReason(result?.error || error).replace(/[。．.!！?？；;]+$/u, "")
    : "";
  (await appendTaskEvent(
    bound.workItemId,
    bound.runId,
    `run.${runStatus}`,
    failed ? "执行失败" : "结果已生成",
    runStatus,
    failed
      ? `未生成结果：${failureReason || "执行未完成"}。可重新执行。`
      : taskDefinition(bound.taskType)?.side_effects === "none"
        ? "本轮只读查询已结束。结果已生成，可查看资料来源；正式任务仍可验收。"
        : "本轮结果已生成，任务待验收；正式操作仍需单独确认。",
  ));
  (await audit(scopedUser()?.id || "demo", `task.run.${runStatus}`, {
    work_item_id: bound.workItemId,
    run_id: bound.runId,
  }));
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
    const owner = (await postgresPool().query("SELECT owner_user_id FROM tickets WHERE id=$1", [bound.workItemId])).rows[0] as
      | { owner_user_id?: string }
      | undefined;
    if (issues.length || !owner?.owner_user_id || !workerItems.length) {
      (await audit(scopedUser()?.id || "host", "skill_result_memory.skipped", {
        work_item_id: bound.workItemId,
        run_id: bound.runId,
        skill_id: bound.taskType,
        reason: issues.length ? (issues.some((issue) => issue.includes("credential-like")) ? "unsafe_result" : "result_schema_invalid")
          : !workerItems.length ? "empty_result" : "owner_missing",
        issue_count: issues.length,
      }));
      (await appendTaskEvent(bound.workItemId, bound.runId, "memory.write_skipped", "结果记忆未保存", "completed",
        issues.length ? "结果不符合技能声明的保存结构。" : "缺少可保存的结果或任务归属。"));
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
        (await audit(scopedUser()?.id || "host", "skill_result_memory.failed", {
          work_item_id: bound.workItemId,
          run_id: bound.runId,
          skill_id: bound.taskType,
          reason: "memory_write_failed",
        }));
        (await appendTaskEvent(bound.workItemId, bound.runId, "memory.write_failed", "结果记忆写入失败", "completed",
          "本次运行结果已保留；记忆索引未更新，可稍后重试。"));
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
      if (isPostgresForeignKeyError(error) || isPostgresClosedError(error) || isSessionNotFound(error)) return;
    });
  }
}

async function autoStartBoundCrawl(bound: BoundTask, sid: string, plan: Json): Promise<void> {
  try {
    const item = (await postgresPool().query("SELECT owner_user_id FROM tickets WHERE id=$1", [bound.workItemId])).rows[0] as
      | { owner_user_id: string }
      | undefined;
    if (!item) return;
    const run = (await postgresPool().query("SELECT id FROM task_runs WHERE id=$1 AND work_item_id=$2", [bound.runId, bound.workItemId])).rows[0];
    if (!run) return;
    const mode = String(plan.mode || "search");
    const platform = String(plan.platform || "").trim();
    if (!CRAWL_PLATFORM_SET.has(platform)) {
      const message = platform
        ? `不支持的采集平台：${platform}。可用平台：${CRAWL_PLATFORMS.join(" / ")}。`
        : "启动采集前需要补充平台。";
      (await postgresPool().query("UPDATE tickets SET status='needs_clarification',updated_at=$1 WHERE id=$2", [nowIso(), bound.workItemId]));
      (await appendTaskEvent(
        bound.workItemId,
        bound.runId,
        "crawl.clarification",
        "请补充可用采集平台",
        "needs_clarification",
        message,
      ));
      (await addMsg(sid, "assistant", "error_card", {
        code: "crawl_platform_unsupported",
        message,
        next_action: "请改用 MediaCrawler 支持的平台后重试。",
        persistent: true,
      }));
      return;
    }
    const required = mode === "detail" ? "specified_ids" : mode === "creator" ? "creator_ids" : "keywords";
    const value = plan[required];
    if (!Array.isArray(value) || !value.length) {
      (await postgresPool().query("UPDATE tickets SET status='needs_clarification',updated_at=$1 WHERE id=$2", [nowIso(), bound.workItemId]));
      (await appendTaskEvent(
        bound.workItemId,
        bound.runId,
        "crawl.clarification",
        `请补充${fieldLabel(required)}`,
        "needs_clarification",
        "未启动远程采集。",
      ));
      (await addMsg(sid, "assistant", "error_card", {
        code: "crawl_input_required",
        message: `启动采集前需要补充${fieldLabel(required)}。`,
        persistent: true,
      }));
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
      if (!(await postgresPool().query("SELECT id FROM tickets WHERE id=$1", [bound.workItemId])).rows[0]) return;
      (await addMsg(sid, "assistant", "assistant", {
        text: "远程创作者采集已自动启动，进度会持续更新。",
      }));
    } catch (error) {
      if (isPostgresForeignKeyError(error) || isPostgresClosedError(error) || isSessionNotFound(error)) return;
      if (!(await postgresPool().query("SELECT id FROM tickets WHERE id=$1", [bound.workItemId])).rows[0]) return;
      const detail = error instanceof HttpFail && error.detail && typeof error.detail === "object"
        ? error.detail as Json
        : {};
      if (detail.code === "work_item_not_found") return;
      const message = String(detail.message || (error instanceof Error ? error.message : error));
      const nextAction = String(
        detail.next_action || "检查远程 Claw 配置或等待当前采集任务完成后重试。",
      );
      (await postgresPool().query("UPDATE tickets SET status='failed',updated_at=$1 WHERE id=$2", [nowIso(), bound.workItemId]));
      (await appendTaskEvent(bound.workItemId, bound.runId, "crawl.start_failed", "远程采集启动失败", "failed", message));
      (await addMsg(sid, "assistant", "error_card", {
        code: "crawl_start_failed",
        message: `远程采集启动失败：${message}`,
        next_action: nextAction,
        persistent: true,
      }));
    }
  } catch (error) {
    if (isPostgresForeignKeyError(error) || isPostgresClosedError(error) || isSessionNotFound(error)) return;
    throw error;
  }
}

async function sessionStatus(sid: string): Promise<SessionStatus> {
  return (await sessionStatusMap([sid])).get(sid) || "listening";
}

/**
 * Batched `sessionStatus` for the session list: two indexed queries for the
 * whole page instead of two per session. The per-session branch order is
 * preserved exactly.
 */
async function sessionStatusMap(sids: string[]): Promise<Map<string, SessionStatus>> {
  const out = new Map<string, SessionStatus>();
  if (!sids.length) return out;
  const placeholders = sids.map((_, i) => `$${i + 1}`).join(",");
  const workerStatus = new Map<string, string>();
  for (const row of (await postgresPool().query(`SELECT session_id, status FROM workers
     WHERE session_id IN (${placeholders})
       AND created_at = (SELECT MAX(w2.created_at) FROM workers w2 WHERE w2.session_id = workers.session_id)`, [...sids])).rows as Row[]) {
    const key = String(row.session_id);
    if (!workerStatus.has(key)) workerStatus.set(key, String(row.status));
  }
  const draftStatus = new Map<string, string>();
  for (const row of (await postgresPool().query(`SELECT session_id, status FROM drafts
     WHERE session_id IN (${placeholders})
       AND id = (SELECT MAX(d2.id) FROM drafts d2 WHERE d2.session_id = drafts.session_id)`, [...sids])).rows as Row[]) {
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
async function sessionsEpoch(): Promise<string> {
  const row = (await postgresPool().query(`SELECT (SELECT COUNT(*) FROM sessions) AS session_count,
            (SELECT MAX(updated_at) FROM sessions) AS updated_at,
            (SELECT COALESCE(MAX(archived_at), '') FROM sessions) AS archived_at,
            (SELECT COUNT(*) FROM sessions WHERE deleted_at IS NOT NULL) AS deleted,
            (SELECT COUNT(*) FROM workers) AS worker_count,
            (SELECT COALESCE(MAX(created_at), '') FROM workers) AS worker_created_at,
            (SELECT COUNT(*) FROM drafts) AS draft_count,
            (SELECT COALESCE(MAX(sent_at), '') FROM drafts) AS draft_sent_at`, [])).rows[0] as {
    session_count: number;
    updated_at: string | null;
    archived_at: string;
    deleted: number;
    worker_count: number;
    worker_created_at: string;
    draft_count: number;
    draft_sent_at: string;
  };
  return pollEpoch([
    row.session_count, row.updated_at, row.archived_at, row.deleted,
    row.worker_count, row.worker_created_at, row.draft_count, row.draft_sent_at, runControlRevision(),
  ]);
}

async function runInBackground(sid: string, me: Json, intent: Intent, col: Row | null, text: string): Promise<void> {
  const bound = boundFromIntent(intent);
  if (!markSessionRunning(sid)) {
    // The session was claimed (or stopped) between the route check and now:
    // queue the ask so its bound task keeps an honest「已排队」state.
    if (bound) {
      if (wasSessionStopped(sid)) (await cancelBoundTask(bound, "会话已停止，未执行。"));
      else (await queueBoundTask(bound));
    }
    if (!wasSessionStopped(sid)) enqueueAsk(sid, { text, intent, me });
    publishSession(sid, { type: "status", agent_status: (await sessionStatus(sid)) });
    publishQueue(sid);
    return;
  }
  (await startBoundTask(bound));
  let progress: Json;
  let trace: Json;
  let operations: Json;
  try {
    progress = (await addMsg(sid, "assistant", "job_status", {
      status: "running",
      text: "正在准备任务…",
    }));
    trace = (await addMsg(sid, "assistant", "process_trace", {
      title: "处理过程",
      items: [{ id: "host:preparing", label: "正在核对任务条件", status: "running", kind: "host", observed_at: nowIso() }],
    }));
    operations = (await addMsg(sid, "assistant", "operation_trace", {
      title: REMOTE_MCP_TITLE,
      persistent: true,
      active: true,
      items: [],
    }));
  } catch (error) {
    clearSessionRunning(sid);
    (await finishBoundTask(bound, sid, undefined, error));
    if (isSessionNotFound(error)) return;
    throw error;
  }
  const progressId = String(progress.id);
  const traceId = String(trace.id);
  const operationId = String(operations.id);
  let operationItems: { id: string; name: string; label: string; status: string }[] = [];
  let processItems: WorkerTraceItem[] = [
    { id: "host:preparing", label: "正在核对任务条件", status: "running", kind: "host", observed_at: String((trace.payload as Json)?.items && ((trace.payload as Json).items as Json[])[0]?.observed_at || trace.created_at) },
  ];
  let latestPhase: WorkerProgress["phase"] = "preparing";
  let latestSummary = "";
  let streamId = "";
  let streamText = "";
  let streamFlushAt = 0;
  let traceFlushAt = 0;
  const publishTrace = async (force = false) => {
    const now = Date.now();
    const streaming = processItems.some((item) => item.kind === "reasoning" && item.status === "running");
    if (!force && streaming && now - traceFlushAt < 80) return;
    traceFlushAt = now;
    (await updateMsg(traceId, {
      title: "处理过程",
      items: processItems,
      summaries: reasoningSummariesOf(processItems),
    }));
  };
  const publishOperations = async (active: boolean) => {
    (await updateMsg(operationId, {
      title: REMOTE_MCP_TITLE,
      persistent: true,
      active,
      items: operationItems,
    }));
  };
  const flushStream = async (force = false) => {
    if (!streamText) return;
    const now = Date.now();
    if (!force && streamId && now - streamFlushAt < 80) return;
    streamFlushAt = now;
    if (!streamId) {
      streamId = String((await addMsg(sid, "assistant", "assistant", { text: streamText, streaming: true })).id);
      return;
    }
    (await updateMsg(streamId, { text: streamText, streaming: true }));
  };
  publishSession(sid, { type: "status", agent_status: "running" });
  registerProgress(sid, async (progressEvent) => {
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
      (await appendTaskEvent(bound.workItemId, bound.runId, "run.progress", taskEventLabels[phase] || phase, "running", summary));
    }
    if (delta) {
      streamText += delta;
      (await flushStream());
    }
    if (summary) latestSummary = summary;
    if (operation) {
      operationItems = upsertOperationItem(operationItems, operation);
      (await publishOperations(true));
    }
    processItems = applyProgress(processItems, progressEvent);
    const reasoningDelta = progressEvent.trace?.kind === "reasoning" && progressEvent.trace.status === "running";
    (await publishTrace(!reasoningDelta));
    const statusText = statusTextForProgress(phase, latestSummary);
    if (intent.type === "email_compose" && phase === "generating" && !latestSummary) {
      (await updateMsg(progressId, { status: "running", text: "正在拟定邮件主题和正文…" }));
      return;
    }
    (await updateMsg(progressId, { status: "running", text: statusText }));
  });
  void dispatch(sid, me, intent, col, text)
    .then(async (result) => {
      (await finishBoundTask(bound, sid, result));
      const error = result.error as Json | undefined;
      processItems = finishProcessItems(processItems, Boolean(error));
      (await publishTrace(true));
      (await publishOperations(false));
      (await updateMsg(progressId, error
        ? {
            status: "failed",
            text: "未能生成结果，请查看下方提示。",
          }
        : {
            status: "done",
            text: "结果已生成。",
          }));
    })
    .catch(async (e: unknown) => {
      if (isSessionNotFound(e)) {
        (await finishBoundTask(bound, sid, undefined, e));
        return;
      }
      const stopped = wasSessionStopped(sid) || (e instanceof Error && e.name === "WorkerStopped");
      if (stopped) {
        (await stoppedBoundTask(bound));
        processItems = finishProcessItems(processItems, false);
        (await publishTrace(true));
        (await publishOperations(false));
        (await updateMsg(progressId, { status: "done", text: "已停止生成。已保留已产生的内容。" }));
        return;
      }
      (await finishBoundTask(bound, sid, undefined, e));
      processItems = finishProcessItems(processItems, true);
      (await publishTrace(true));
      (await publishOperations(false));
      if (e instanceof BudgetBlocked) {
        (await updateMsg(progressId, { status: "failed", text: e.message }));
        return;
      }
      if (e instanceof CodexUnavailable) {
        (await updateMsg(progressId, {
          status: "failed",
          text: "未能生成结果，请查看下方提示。",
        }));
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      (await updateMsg(progressId, {
        status: "failed",
        text: "处理失败，请查看下方提示。",
      }));
      if (!isEmailMcpTask(intent.type) && !isKolClawTask(intent.type)) {
        try {
          (await addMsg(sid, "assistant", "error_card", {
            code: "worker_failed",
            status: "worker_failed",
            message: "任务生成失败。",
            next_action: message,
            persistent: true,
          }));
        } catch (writeError) {
          if (!isSessionNotFound(writeError)) throw writeError;
        }
      }
      (await audit("host", "worker.failed", { message }));
    })
    .finally(async () => {
      if (streamId) (await updateMsg(streamId, { text: streamText, streaming: false }));
      progressBySession.delete(sid);
      (await afterRun(sid));
    }).catch((error: unknown) => {
      if (!isSessionNotFound(error)) console.error("[host-background] persistence failed", error instanceof Error ? error.message : "unknown error");
    });
}

async function afterRun(sid: string): Promise<void> {
  clearSessionRunning(sid);
  if (!wasSessionStopped(sid)) {
    const next = shiftQueue(sid);
    if (next) {
      publishQueue(sid);
      (await launchQueuedAsk(sid, next));
      return;
    }
  }
  publishSession(sid, { type: "status", agent_status: (await sessionStatus(sid)) });
  publishQueue(sid);
}

function publishQueue(sid: string): void {
  publishSession(sid, { type: "queue", queue: publicQueue(sid) });
}

async function launchQueuedAsk(sid: string, item: QueuedAsk): Promise<void> {
  try {
    const col = resolveCollab(item.intent);
    (await runInBackground(sid, item.me, item.intent, col, item.text));
  } catch (error) {
    if (isSessionNotFound(error)) return;
    throw error;
  }
}

async function ok(sid: string, me: Json, intent: Intent, extra: Json = {}): Promise<Json> {
  const { worker, draft, approval, ...rest } = extra;
  return {
    me,
    intent: { ...intent },
    worker: worker ?? null,
    draft: draft ?? null,
    approval: approval ?? null,
    messages: (await messages(sid)),
    ...rest,
  };
}

async function patchDraftFromSnapshot(did: string, snapshot: ResultSnapshot): Promise<Row> {
  const d = (await getDraft(did));
  (await assertDraftEditable(d));
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
  (await postgresTransaction(async (db) => {
    (await db.query(`UPDATE drafts SET from_addr=$1, to_addr=$2, subject=$3, body_en=$4, body_zh_internal=$5,
       amount_usd=$6, extra=$7, currency=$8, fingerprint=$9 WHERE id=$10`, [next.from_addr, next.to_addr, next.subject, next.body_en, next.body_zh_internal, next.amount_usd, JSON.stringify(extra), next.currency, next.fingerprint, did]));
  }));
  return (await getDraft(did));
}

async function applyResultRevision(sid: string, me: Json, intent: Intent, text: string): Promise<Json> {
  const last = lastUnsentResult((await messages(sid)).filter((row) => String(row.id) !== String(me.id)));
  if (!last) {
    (await addMsg(sid, "assistant", "assistant", { text: "当前没有可修订的本轮结果。可以说「写合作邮件」或点芯片开新任务。" }));
    return (await ok(sid, me, intent));
  }
  const { fields, thread_id } = await collectReviseFields(last.snapshot, text);
  const { next, changed } = mergeReviseFields(last.snapshot, fields);
  next.thread_id = thread_id || last.thread_id || next.thread_id;
  let draftRow: Row | null = null;
  if (last.draft_id) {
    try {
      draftRow = (await patchDraftFromSnapshot(String(last.draft_id), next));
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
  (await addMsg(sid, "assistant", "assistant", { text: note }));
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
    const rebuilt = (await emailMcpResultCard("email_compose", data));
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
    (await addMsg(sid, "assistant", "task_result_card", card));
    if (draftRow) (await addMsg(sid, "assistant", "email_card", (await emailCardPayload(draftRow))));
    return (await ok(sid, me, intent, { draft: draftRow }));
  }
  const card = stampResultRevise({
    ...last.card,
    title: next.title || last.card.title,
    summary: `${note} ${next.summary || last.card.summary || ""}`.trim(),
    sections: next.sections,
    skill: last.skill,
    persistent: true,
  }, { skill: last.skill, snapshot: next, thread_id: next.thread_id, changed });
  (await addMsg(sid, "assistant", "task_result_card", card));
  return (await ok(sid, me, intent));
}

async function resolveFollowStyleCollaboration(collaborationId?: string | null, handle?: string | null): Promise<Row> {
  if (collaborationId) {
    const row = (await postgresPool().query("SELECT * FROM collaborations WHERE id=$1", [collaborationId])).rows[0] as Row | undefined;
    if (row) return row;
  }
  if (handle) {
    const row = (await postgresPool().query("SELECT * FROM collaborations WHERE handle=$1 OR display_name=$2", [handle, handle])).rows[0] as
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
  if (kolUid && (await starryKolMcpConfigured()) && codexMode() !== "stub") {
    try {
      await executeStarryKolTask("creator_status_update", {
        kolUid,
        followStyleTags: saved.tags,
      }, "host");
    } catch (error) {
      (await audit("host", "host.follow_style.mcp_failed", {
        kolUid,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  if (input.sessionId && input.announce !== false) {
    (await addMsg(input.sessionId, "assistant", "task_result_card", followStyleCardPayload(saved.collaboration, saved.tags, saved.previous)));
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
  const col = (await resolveFollowStyleCollaboration(
    String(session.collaboration_id || body.collaboration_id || ""),
    parsed.handle,
  ));
  if (!parsed.labels.length) {
    (await addMsg(sid, "assistant", "task_result_card", followStyleCardPayload(col, readFollowStyleTags(col), readFollowStyleTags(col))));
    return {
      me,
      messages: (await messages(sid)),
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
    messages: (await messages(sid)),
    accepted: true,
    agent_status: "listening",
    worker: null,
    draft: null,
    ...result,
  };
}

export async function getDraft(did: string, client: Pick<PoolClient, "query"> = postgresPool()): Promise<Row> {
  const row = (await client.query("SELECT * FROM drafts WHERE id = $1", [did])).rows[0] as Row | undefined;
  if (!row) throw new HttpFail(404, "draft not found");
  (await assertSessionAccess(String(row.session_id)));
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

async function preferredDraftBrand(item: Json): Promise<string | null> {
  const direct = String(item.brand || item.brandCode || item.brand_code || "").trim();
  if (direct) return direct;
  if (!item.collaboration_id) return null;
  const col = (await postgresPool().query("SELECT brand FROM collaborations WHERE id = $1", [String(item.collaboration_id)])).rows[0] as
    | { brand?: string }
    | undefined;
  return col?.brand ? String(col.brand) : null;
}

async function applyAuthorizedFrom(did: string, fromAddr: string, preferredBrand?: string | null): Promise<Row> {
  const resolved = resolveAuthorizedFrom(fromAddr, currentUser(), preferredBrand);
  if (resolved.email && resolved.email !== fromAddr) {
    (await postgresTransaction(async (db) => {
      (await db.query("UPDATE drafts SET from_addr = $1 WHERE id = $2", [resolved.email, did]));
    }));
  }
  let d = (await getDraft(did));
  const fp = currentFingerprint(d);
  if (d.fingerprint !== fp) {
    (await postgresTransaction(async (db) => {
      (await db.query("UPDATE drafts SET fingerprint = $1 WHERE id = $2", [fp, did]));
    }));
    d = (await getDraft(did));
  }
  return d;
}

export async function persistDraft(sid: string, item: Json): Promise<Row> {
  const did = nid("dft");
  const requestedFrom = String(item.from || item.mailboxEmail || "").trim();
  const preferredBrand = (await preferredDraftBrand(item));
  // 本人挂载的邮箱就是实际发件箱，不再映射到品牌箱（BIZ-04 品牌范围已在 PEP 核对）。
  const ownedFrom = authorizedSenderBrand(requestedFrom, currentUser(), preferredBrand);
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
    reply_context_version: item.reply_context_version || null,
    reply_drafts_version: item.reply_drafts_version || null,
    reply_context_stale: Boolean(item.reply_context_stale),
    reply_evidence: item.reply_evidence || [],
    source_draft_id: item.source_draft_id ?? null,
    ...(item.from_source ? { from_source: item.from_source } : {}),
    ...(!ownedFrom && resolved.email && resolved.email !== requestedFrom ? { send_from: resolved.email } : {}),
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
  (await postgresTransaction(async (c) => {
    (await c.query(`INSERT INTO drafts (
        id, session_id, collaboration_id, skill, from_addr, to_addr, cc, subject,
        body_en, body_zh_internal, lang_label, amount_usd, keep_stage, proposed_stage,
        official_stage, approval_id, fingerprint, template_id, sent_at, status, extra, currency
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, [row.id, row.session_id, row.collaboration_id, row.skill, row.from_addr, row.to_addr, row.cc, row.subject, row.body_en, row.body_zh_internal, row.lang_label, row.amount_usd, row.keep_stage, row.proposed_stage, row.official_stage, row.approval_id, row.fingerprint, row.template_id, row.sent_at, row.status, row.extra, row.currency]));
  }));
  return (await getDraft(did));
}

export async function emailCardPayload(d: Row): Promise<Json> {
  const extra = typeof d.extra === "object" && d.extra ? (d.extra as Json) : {};
  const user = currentUser();
  const preferredBrand = String(extra.brand || "") || collaborationBrand(d.collaboration_id ? String(d.collaboration_id) : null);
  // 本人挂载的邮箱（品牌范围核对通过）同时是发件人、可选项与真实外发箱；
  // 否则沿用品牌白名单映射（多候选仍要求显式选择）。
  const owned = authorizedSenderBrand(String(d.from_addr), user, preferredBrand);
  const resolved = resolveAuthorizedFrom(String(d.from_addr), user, preferredBrand);
  const allowed = resolved.allowed.length ? resolved.allowed : allowedFromMailboxes(user, null);
  const fromOptions = owned && !allowed.some((row) => row.email.toLowerCase() === owned.email.toLowerCase())
    ? [{ brand: owned.brand, email: owned.email, authorized: true }, ...allowed]
    : allowed;
  const brand = owned?.brand || resolved.brand;
  const official = d.official_stage as string | null;
  const lockedFrom = fromOptions.length <= 1;
  const buttons = ["一键翻译中文（内部）"];
  const st = d.status as string;
  if (st === "waiting_approval") buttons.push("提交审批");
  else buttons.push("校验并发送原文");
  let colVer = 0;
  if (d.collaboration_id) {
    const r = (await postgresPool().query("SELECT stage_version FROM collaborations WHERE id = $1", [d.collaboration_id])).rows[0] as
      | { stage_version: number }
      | undefined;
    colVer = r ? Number(r.stage_version || 0) : 0;
  }
  if (String(d.skill) === "email_compose") {
    buttons.push("确认推进阶段");
  }
  const knowledgeId = String(extra.knowledge_id || "").trim();
  const knowledgeVersion = Number(extra.knowledge_version);
  const knowledgeTitle = knowledgeId
    ? ((await postgresPool().query("SELECT title FROM knowledge WHERE id=$1", [knowledgeId])).rows[0] as { title?: string } | undefined)?.title
    : null;
  return {
    knowledge_id: knowledgeId || null,
    knowledge_version: knowledgeId && Number.isFinite(knowledgeVersion) ? knowledgeVersion : null,
    knowledge_title: knowledgeTitle ? String(knowledgeTitle) : null,
    draft_id: d.id,
    reply_context_version: extra.reply_context_version || null,
    reply_context_stale: Boolean(extra.reply_context_stale),
    reply_evidence: extra.reply_evidence || [],
    collaboration_id: d.collaboration_id,
    expected_version: colVer,
    from: d.from_addr,
    send_from: owned?.email || resolved.email || d.from_addr,
    allowed_from_mailboxes: fromOptions,
    from_source: owned ? owned.source : (String(extra.from_source || "") || null),
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
    buttons,
    send_disabled: ["waiting_approval", "sent", "sending", "send_unknown"].includes(st),
    footer: extra.footer || (d.skill === "ship_notice" ? "已发货" : null),
    skill: d.skill,
  };
}

async function setDraftStatus(did: string, status: string, sendError: string | null = null): Promise<void> {
  (await postgresTransaction(async (c) => {
    (await c.query("UPDATE drafts SET status = $1, send_error = $2 WHERE id = $3", [status, sendError, did]));
  }));
}

async function syncEmailCard(did: string): Promise<void> {
  const d = (await getDraft(did));
  const card = (await emailCardPayload(d));
  const rows = (await postgresPool().query("SELECT id, payload FROM messages WHERE session_id = $1 AND kind = 'email_card'", [d.session_id])).rows as { id: string; payload: string }[];
  for (const r of rows) {
    try {
      const payload = JSON.parse(r.payload) as Json;
      if (payload.draft_id === did) {
        (await postgresTransaction(async (c) => {
          (await c.query("UPDATE messages SET payload = $1 WHERE id = $2", [JSON.stringify(card), r.id]));
        }));
      }
    } catch {
      /* skip */
    }
  }
}

async function syncComposeResultCard(d: Row): Promise<void> {
  const rows = (await postgresPool().query("SELECT id, payload FROM messages WHERE session_id = $1 AND kind = 'task_result_card' ORDER BY created_at DESC", [String(d.session_id)])).rows as { id: string; payload: string }[];
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
    const rebuilt = (await emailMcpResultCard("email_compose", data));
    const next = {
      ...payload,
      title: rebuilt.title,
      summary: rebuilt.summary,
      sections: rebuilt.sections,
      recommended_actions: rebuilt.recommended_actions,
      starrykol_data: data,
      emailmcp_data: data,
    };
    (await postgresTransaction(async (c) => {
      (await c.query("UPDATE messages SET payload = $1 WHERE id = $2", [JSON.stringify(next), r.id]));
    }));
    break;
  }
}

async function syncDraftArtifacts(did: string): Promise<void> {
  (await syncEmailCard(did));
  (await syncComposeResultCard((await getDraft(did))));
}

async function attachMinimalProgress(sid: string): Promise<void> {
  if (progressBySession.has(sid)) return;
  let processItems: WorkerTraceItem[] = [];
  let operationItems: { id: string; name: string; label: string; status: string }[] = [];
  const trace = (await addMsg(sid, "assistant", "process_trace", {
    title: "处理过程",
    items: [],
  }));
  const operations = (await addMsg(sid, "assistant", "operation_trace", {
    title: REMOTE_MCP_TITLE,
    persistent: true,
    active: true,
    items: [],
  }));
  let streamText = "";
  let streamId = "";
  let streamFlushAt = 0;
  const flushStream = async (force = false) => {
    if (!streamText) return;
    const now = Date.now();
    if (!force && streamId && now - streamFlushAt < 80) return;
    streamFlushAt = now;
    if (!streamId) {
      streamId = String((await addMsg(sid, "assistant", "assistant", { text: streamText, streaming: true })).id);
      return;
    }
    (await updateMsg(streamId, { text: streamText, streaming: true }));
  };
  minimalStreamClose.set(sid, async () => {
    (await flushStream(true));
    if (streamId) (await updateMsg(streamId, { text: streamText, streaming: false }));
  });
  registerProgress(sid, async (progress) => {
    if (progress.delta) {
      streamText += progress.delta;
      (await flushStream());
    }
    if (progress.operation) {
      operationItems = upsertOperationItem(operationItems, progress.operation);
      (await updateMsg(String(operations.id), {
        title: REMOTE_MCP_TITLE,
        persistent: true,
        active: true,
        items: operationItems,
      }));
    }
    processItems = applyProgress(processItems, progress);
    (await updateMsg(String(trace.id), {
      title: "处理过程",
      items: processItems,
      summaries: reasoningSummariesOf(processItems),
    }));
  });
}

async function finishWorkerTrace(sid: string, failed: boolean): Promise<void> {
  const row = (await postgresPool().query("SELECT id, payload FROM messages WHERE session_id=$1 AND kind='process_trace' ORDER BY created_at DESC, id DESC LIMIT 1", [sid])).rows[0] as { id: string; payload: string } | undefined;
  if (row) {
    let payload: { title?: string; items?: WorkerTraceItem[] } = {};
    try { payload = JSON.parse(String(row.payload || "{}")); } catch { payload = {}; }
    const items = finishProcessItems((payload.items || []) as WorkerTraceItem[], failed);
    (await updateMsg(row.id, {
      title: payload.title || "处理过程",
      items,
      summaries: reasoningSummariesOf(items),
    }));
  }
  const op = (await postgresPool().query("SELECT id, payload FROM messages WHERE session_id=$1 AND kind='operation_trace' ORDER BY created_at DESC, id DESC LIMIT 1", [sid])).rows[0] as { id: string; payload: string } | undefined;
  if (op) {
    let payload: { title?: string; items?: Json[]; persistent?: boolean } = {};
    try { payload = JSON.parse(String(op.payload || "{}")); } catch { payload = {}; }
    (await updateMsg(op.id, {
      title: "系统能力调用记录",
      persistent: true,
      active: false,
      items: finishOperationItems(payload.items || []),
    }));
  }
}

async function execWorker(sid: string, skill: string, text: string, extra: Json): Promise<WorkerResult> {
  const definition = taskDefinition(skill);
  if (!definition) throw new HttpFail(400, { code: "unknown_task_type", task_type: skill });
  (await requireTaskAccess(skill, extra.agent_id ? String(extra.agent_id) : undefined));
  const sec = hostWorkerTimeout();
  const controller = new AbortController();
  attachRunAbort(sid, controller);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ownedSink = !progressBySession.has(sid);
  if (ownedSink) (await attachMinimalProgress(sid));
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
    await drainProgress(sid);
    if (wasSessionStopped(sid)) {
      if (ownedSink) (await finishWorkerTrace(sid, false));
      throw Object.assign(new Error("已停止生成"), { name: "WorkerStopped" });
    }
    return result;
  } catch (e) {
    await drainProgress(sid);
    if (wasSessionStopped(sid) || (e instanceof Error && e.name === "WorkerStopped")) {
      if (ownedSink) (await finishWorkerTrace(sid, false));
      throw Object.assign(new Error("已停止生成"), { name: "WorkerStopped" });
    }
    if (ownedSink) (await finishWorkerTrace(sid, true));
    if (e instanceof BudgetBlocked) {
      (await addMsg(sid, "assistant", "error_card", { ...e.asDict(), persistent: true }));
    }
    if (e instanceof CodexUnavailable) {
      (await addMsg(sid, "assistant", "error_card", { ...e.asDict(), persistent: true }));
      (await audit("host", "codex.unavailable", {
        skill,
        synthesized: false,
        detail: e.message,
        next_action: e.next_action,
      }));
    }
    throw e;
  } finally {
    if (ownedSink) {
      await minimalStreamClose.get(sid)?.();
      minimalStreamClose.delete(sid);
      progressBySession.delete(sid);
    }
    if (timer) clearTimeout(timer);
  }
}

async function unavailableOk(sid: string, me: Json, intent: Intent, e: { asDict(): Json }): Promise<Json> {
  return (await ok(sid, me, intent, { worker: null, draft: null, error: e.asDict() }));
}

async function ensureCompletedWorkerTrace(sid: string, wr: WorkerResult): Promise<void> {
  const existing = (await postgresPool().query("SELECT id FROM messages WHERE session_id=$1 AND kind='process_trace' LIMIT 1", [sid])).rows[0];
  if (existing) {
    (await finishWorkerTrace(sid, wr.status === "failed"));
    return;
  }
  (await addMsg(sid, "assistant", "process_trace", {
    title: "处理过程",
    items: finishProcessItems([], wr.status === "failed"),
    summaries: [],
  }));
}

/** Dify 节点输出 → Host Item → 会话 Markdown / 邮件卡 / 黄条 / 清单 */
async function mapWorker(sid: string, me: Json, intent: Intent, wr: WorkerResult): Promise<Json> {
  const workItemId = intent.extras?.work_item_id ? String(intent.extras.work_item_id) : null;
  if (wr.skill === KOL_ANALYZE_TASK_TYPE || intent.type === KOL_ANALYZE_TASK_TYPE) {
    assertKolAnalyzeVerbsSafe(KOL_ANALYZE_TASK_TYPE, { items: wr.items }, workItemId);
  }
  (await ensureCompletedWorkerTrace(sid, wr));
  const worker: Json = {
    id: wr.worker_id,
    status: wr.status,
    skill: wr.skill,
    profile_id: wr.profile_id,
    thread_id: wr.thread_id || null,
    turn_id: wr.turn_id || null,
    contract_log: wr.contract_log,
  };
  (await addMsg(sid, "assistant", "steps", {
    title: "箱内步骤（Codex app-server）",
    items: wr.contract_log.map((e) => ({ title: e.method, meta: "" })),
  }));
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
          skill: "email_compose", from: (await preparedSender(col)), to: firstEmail(col.email),
          collaboration_id: col.id, official_stage: col.stage_code,
          knowledge_id: intent.extras?.knowledge_id, knowledge_version: composeInput.knowledge_version,
        });
      }
      item.to = (await assertDraftTo(sid, me, intent, col, item, intent.raw));
      if (col && !item.collaboration_id) item.collaboration_id = col.id;
      if (intent.extras?.knowledge_id && !item.knowledge_id) {
        item.knowledge_id = intent.extras.knowledge_id;
        item.knowledge_version = intent.extras.knowledge_version ?? null;
      }
      const lockedTemplate = intent.extras?.mail_template && typeof intent.extras.mail_template === "object"
        ? intent.extras.mail_template as Json
        : null;
      if (lockedTemplate?.template_id) item.template_id = lockedTemplate.template_id;
      draftRow = (await persistDraft(sid, item));
      (await addMsg(sid, "assistant", "email_card", (await emailCardPayload(draftRow))));
    } else if (item.type === "create_approval") {
      continue;
    } else if (item.type === "list_overdue") {
      (await addMsg(sid, "assistant", "steps", {
        title: "T8 失联与延期",
        items: ((item.items as Json[]) || []).map((i) => ({
          title: `@${i.handle}`,
          meta: `${i.stage_label} · ${i.days} 天`,
        })),
      }));
    } else if (item.type === "crawl_plan") {
      crawlPlan = {
        platform: item.platform,
        mode: item.mode,
        ...(Array.isArray(item.keywords) ? { keywords: item.keywords } : {}),
        ...(Array.isArray(item.specified_ids) ? { specified_ids: item.specified_ids } : {}),
        ...(Array.isArray(item.creator_ids) ? { creator_ids: item.creator_ids } : {}),
        requires_confirmation: false,
      };
      (await addMsg(sid, "assistant", "crawl_plan", {
        text: `已识别远程采集参数：${item.platform || "待选择平台"} / ${item.mode || "search"}。正在自动启动采集。`,
        crawl_plan: crawlPlan,
      }));
    } else if (item.type === "task_result") {
      if (intent.type === "business_approval" || wr.skill === "business_approval") continue;
      if (Array.isArray(item.operations) && item.operations.length) {
        const existing = (await postgresPool().query("SELECT id, payload FROM messages WHERE session_id=$1 AND kind='operation_trace' ORDER BY created_at DESC, id DESC LIMIT 1", [sid])).rows[0] as { id: string; payload: string } | undefined;
        let live: Json[] = [];
        if (existing) {
          try { live = (JSON.parse(String(existing.payload || "{}")).items as Json[]) || []; } catch { live = []; }
        }
        const items = preferHostOperations(live, item.operations as Json[]);
        if (existing) {
          (await updateMsg(existing.id, {
            title: REMOTE_MCP_TITLE,
            persistent: true,
            active: false,
            items,
          }));
        } else {
          (await addMsg(sid, "assistant", "operation_trace", {
            title: REMOTE_MCP_TITLE,
            items,
            persistent: true,
            active: false,
          }));
        }
      }
      const col = resolveCollab(intent);
      const starry = item.starrykol_data && typeof item.starrykol_data === "object"
        ? item.starrykol_data as Json
        : (item.emailmcp_data && typeof item.emailmcp_data === "object" ? item.emailmcp_data as Json : null);
      let card: Json = {
        type: "task_result",
        title: String(item.title || "任务结果"),
        summary: `${item.task_context_stale ? "生成期间任务依赖已变化，此分析已过期；请基于当前任务重新分析。 " : ""}${item.reply_context_stale ? "生成期间相关依据已变化，此结果已过期；请基于最新邮件重新分析。 " : ""}${String(item.summary || "")}`,
        task_context_id: item.task_context_id || null,
        task_context_version: item.task_context_version || null,
        task_context_stale: Boolean(item.task_context_stale),
        reply_context_version: item.reply_context_version || null,
        reply_context_stale: Boolean(item.reply_context_stale),
        reply_evidence: item.reply_evidence || [],
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
          boundMailbox: (await boundMailboxEmail()),
        }))
        : null;
      if (composePayload) {
        if (composeInput) Object.assign(composePayload, {
          subject: composeInput.subject, body: composeInput.body, bodyText: composeInput.body,
          sent: false, status: "draft", knowledge_id: intent.extras?.knowledge_id, knowledge_version: composeInput.knowledge_version,
        });
        const rebuilt = (await emailMcpResultCard("email_compose", composePayload));
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
      const snap = snapshotFromCards(card, draftRow ? (await emailCardPayload(draftRow)) : null);
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
      (await addMsg(sid, "assistant", "task_result_card", card));
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
        ? (await postgresPool().query("SELECT * FROM collaborations WHERE id=$1", [cid])).rows[0] as Row | undefined
        : resolveCollab(intent) || undefined;
      if (!row) {
        (await addMsg(sid, "assistant", "supplement_card", {
          intent: "confirm_stage",
          title: "补全记状态对象",
          handle: intent.handle,
          collaboration_id: intent.collaboration_id,
          fields: [{ key: "handle", label: "红人 / 合作", required: true, value: intent.handle || "" }],
          message: "提出阶段变更需要指定红人或合作。本次未写入阶段。",
        }));
        continue;
      }
      const current = normalizeStage(String(row.stage_code));
      const proposed = normalizeStage(String(item.proposed_stage || ""));
      const tracks = groupedStageTracks(current, proposed || null);
      const targets = confirmTargetViews(current, proposed || null);
      if (!targets.some((item) => item.code === proposed)) {
        (await addMsg(sid, "assistant", "error_card", {
          code: "proposal_illegal_target",
          message: "Skill 提出的阶段不在当前可确认目标中，已阻止展示为可确认建议。",
          current_stage: current,
          proposed_stage: proposed,
          allowed: targets.map((item) => item.code),
          persistent: true,
        }));
        continue;
      }
      (await addMsg(sid, "assistant", "confirm_stage_card", {
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
        locked: Number(row.locked || 0) !== 0 || LOCKED_PROMISE.has(current),
        requires_human_confirmation: true,
        persistent: true,
      }));
      (await addMsg(sid, "system", "sys_msg", {
        text: "这是 Skill 的候选阶段与证据。只有你在确认卡提交后才会写入正式阶段。",
        tone: "yellow",
        has_confirm: false,
      }));
    }
  }
  (await postgresTransaction(async (c) => {
    (await c.query("UPDATE sessions SET title = $1 WHERE id = $2", [intent.raw.slice(0, 24), sid]));
  }));
  if (intent.type === "business_approval" || wr.skill === "business_approval") {
    const proposal = wr.items.find(row => row.type === "review_draft");
    if (proposal) {
      const actor = scopedUser();
      if (!actor || wr.skill !== "business_approval") throw new HttpFail(403, "当前身份不可保存审批草稿");
      const company = (intent.extras?.entities as Json | undefined)?.review_company;
      const saved = await saveAssistantReviewDraft(actor.id, proposal, `worker:${wr.worker_id}`, typeof company === "string" ? company : undefined);
      const href = `/approvals?draft=${encodeURIComponent(saved.draft.id)}&reviewCompany=${encodeURIComponent(saved.company)}&session=${encodeURIComponent(sid)}`;
      (await addMsg(sid, "assistant", "task_result_card", { type: "task_result", artifact_type: "review_draft", review_draft_id: saved.draft.id, review_company: saved.company, source_session_id: sid, title: "审批申请草稿", summary: "R2 草稿已保存，尚未提交。请打开核对材料、审批人和通过后的后果。",
        sections: [{ title: "待补充与核对", items: Array.isArray(proposal.needs) ? proposal.needs.map(String) : [] }], recommended_actions: [{ label: "核对申请草稿", href }], skill: "business_approval", persistent: true }));
      return (await ok(sid, me, intent, { worker, review_draft: saved.draft }));
    }
    if ((intent.extras?.entities as Json | undefined)?.review_draft_only) {
      const result = wr.items.find(row => row.type === "task_result");
      (await addMsg(sid, "assistant", "task_result_card", result || { type: "task_result", title: "申请草稿尚未形成", summary: "未匹配可用的已发布流程。请在审批中心选择流程并补齐材料。", recommended_actions: [{ label: "打开审批中心", href: "/approvals" }] }));
      return (await ok(sid, me, intent, { worker }));
    }
    const created = wr.items.find((row) => row.type === "create_approval") || {};
    const result = wr.items.find((row) => row.type === "task_result") || {};
    const item = { ...result, ...created };
    const expense = (await handleExpenseApproval(sid, me, intent, intent.raw, item, "worker"));
    return { ...expense, worker };
  }
  if (wr.skill === "creator_lifecycle_kanban" || intent.type === "creator_lifecycle_kanban") {
    (await attachUnboundInbound(sid));
  }
  return (await ok(sid, me, intent, {
    worker: { ...worker, items: wr.items },
    draft: draftRow,
    approval,
    items: wr.items,
    ...(crawlPlan ? { crawl_plan: crawlPlan } : {}),
  }));
}

async function attachUnboundInbound(sid: string): Promise<void> {
  const rows = (await postgresPool().query("SELECT * FROM inbound WHERE bound = 0 AND COALESCE(deferred, 0) = 0 ORDER BY ts DESC, id DESC", [])).rows as Row[];
  for (const row of rows) {
    let candidates: { id?: string; handle?: string; score?: number }[] = [];
    try {
      const parsed = JSON.parse(String(row.candidates || "[]"));
      if (Array.isArray(parsed)) candidates = parsed as { id?: string; handle?: string; score?: number }[];
    } catch {
      candidates = [];
    }
    (await addMsg(sid, "assistant", "inbound_card", {
      inbound_id: row.id,
      from_name: row.from_name,
      from: row.from_addr,
      email: row.from_addr,
      subject: row.subject,
      time: row.ts,
      summary: row.summary,
      candidates,
    }));
    (await addMsg(sid, "system", "sys_msg", {
      text: "无法判断，请人选阶段。不会「已自动记入」。",
      tone: "yellow",
      has_confirm: false,
    }));
  }
}

async function throwMailToSupplement(sid: string, me: Json, intent: Intent, col: Row | null): Promise<never> {
  const handle = String(col?.handle || intent.handle || "").trim();
  (await addMsg(sid, "assistant", "supplement_card", {
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
  }));
  (await audit("host", "mail.to_missing", { handle, collaboration_id: col?.id || intent.collaboration_id }));
  throw new HostReject(422, {
    ...(await ok(sid, me, intent)),
    worker: null,
    draft: null,
    error: { code: "mail_to_missing", message: "To 为空。未发送。" },
  });
}

async function assertDraftTo(sid: string, me: Json, intent: Intent, col: Row | null, item?: Json, text?: string): Promise<string> {
  const to = resolveMailTo(col, intent, item, text || intent.raw);
  if (!to) (await throwMailToSupplement(sid, me, intent, col));
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

async function composePriorCards(sid: string, col: Row | null): Promise<Json[]> {
  const items = col?.id
    ? itemsForCollaboration(String(col.id))
      .slice()
      .sort((left, right) => mailOccurredMs(left.occurred_at || left.created_at) - mailOccurredMs(right.occurred_at || right.created_at))
      .map((item) => ({ kind: "kol_mail_card", payload: item }))
    : [];
  return [...items, ...(await messages(sid))];
}

function namedMailHandleReady(intent: Intent, col: Row | null, text: string): boolean {
  const leftover = leftoverPlaceholders(text).some((token) => /红人或合作/.test(token));
  if (leftover) return false;
  const handle = String(col?.handle || intent.handle || "").trim();
  return Boolean(handle) && !/红人或合作/.test(handle);
}

async function applyNamedMailGates(
  sid: string,
  me: Json,
  intent: Intent,
  col: Row | null,
  text: string,
  composeFacts: ComposeFacts,
): Promise<Json | null> {
  const named = requestedMailKind(text);
  if (named === "testing" && /催大纲/.test(text)) {
    if (!namedMailHandleReady(intent, col, text)) {
      (await addMsg(sid, "assistant", "supplement_card", {
        intent: "content_nudge",
        title: "补全催大纲对象",
        handle: intent.handle,
        collaboration_id: col?.id || intent.collaboration_id,
        fields: [{ key: "handle", label: "红人或合作", required: true, value: "" }],
        message: "催大纲需要指定红人或合作。未替换「[红人或合作]」时不会默认代发。本次未起箱。",
      }));
      return (await ok(sid, me, intent, { worker: null }));
    }
    const stage = normalizeStage(String(col?.stage_code || ""));
    if (!templateAllowedForStage("content_nudge.outline", stage)) {
      (await addMsg(sid, "assistant", "error_card", {
        code: "nudge_stage_gate",
        message: "仅测试中或内容策划阶段可催大纲。当前阶段不能催大纲，请到已签收-测试中后再试。",
        next_action: "等红人进入已签收-测试中或内容策划后，再催大纲。",
        persistent: true,
      }));
      return (await ok(sid, me, intent, { worker: null }));
    }
  }
  if (named === "ship" && !composeFacts.tracking) {
    (await addMsg(sid, "assistant", "supplement_card", {
      intent: "email_compose",
      title: "补全发货运单",
      handle: intent.handle,
      collaboration_id: col?.id || intent.collaboration_id,
      fields: [{ key: "tracking", label: "运单号", required: true, value: "" }],
      message: "发货通知需要运单号。未填写运单号时不会默认代发。本次未起箱。",
    }));
    return (await ok(sid, me, intent, { worker: null }));
  }
  if (named === "address" && !composeFacts.items.some((item) => /寄样资料未齐/.test(item))) {
    const card = attachComposeLoopCard({
      title: "寄样地址核对",
      summary: "可以进入人工确认后的出库流程",
      sections: composeLoopSections(composeFacts),
      recommended_actions: ["联系仓储人工确认出库"],
    }, composeFacts, { handle: String(col?.handle || intent.handle || "") });
    (await addMsg(sid, "assistant", "task_result_card", card));
    return (await ok(sid, me, intent, { worker: null }));
  }
  return null;
}

/**
 * 只给声明过 `context` 的技能解析当前世界；未声明者保持现状，不解析也不拦。
 * `requires` 未满足即不出结果（与 mail.prepare 的 needs_context 同口径），`prefers` 未满足不阻塞。
 */
export async function workerRunContext(skill: string, extra: Json, text: string): Promise<ContextResolution | null> {
  if (!taskDefinition(skill)?.context) return null;
  return (await resolveContext({ skillId: skill, body: extra, text }));
}

export async function contextGapResponse(sid: string, me: Json, intent: Intent, gap: ContextResolution): Promise<Json> {
  const contextGap = {
    status: gap.status,
    skill_id: gap.skill_id,
    missing: gap.missing,
    candidates: gap.candidates,
    context_version: gap.context_version,
  };
  // 缺口卡只列拦下来的 requires；prefers 未满足不算缺口。
  const required = gap.missing.filter((entry) => entry.tier === "requires");
  const missing = required.length ? required : gap.missing;
  const fields = missing.map((entry) => ({
    key: entry.key,
    label: contextKeyLabel(entry.key),
    required: entry.tier === "requires",
    value: "",
  }));
  (await addMsg(sid, "assistant", "supplement_card", {
    intent: intent.skill || intent.type || "",
    title: `补全${fields.map((field) => field.label).join("、")}`,
    handle: intent.handle || "",
    collaboration_id: intent.collaboration_id || null,
    fields,
    message: `${missing.map((entry) => `${entry.reason}（${entry.key}）`).join("；")}。本次未起箱。`,
    context_gap: contextGap,
  }));
  return (await ok(sid, me, intent, { worker: null, context_gap: contextGap }));
}

const CONNECTOR_GAP_CODE = "runtime_connector_unmounted";

/**
 * 员工面文案只讲业务事实与恢复入口：数据连接没接通 ≠ 缺少输入，也 ≠ 没有结果
 * （DESIGN §16）。标题走 error_card 的 `status` 字段（前端 errorTitle 直接用可读文案，
 * 不会把机器码渲染给员工），技能名取登记标题，不出现 MCP、连接器 id、工具别名或技能 id（§15）。
 */
function connectorGapCopy(skill: string, kind: "unmounted" | "unavailable"): { status: string; message: string; next_action: string } {
  const title = taskDefinition(skill)?.title || "该技能";
  return kind === "unmounted"
    ? {
        status: "数据连接尚未接通",
        message: `“${title}”所需的数据连接尚未接通，本次没有开始处理，也没有使用缓存或虚构数据。`,
        next_action: "请联系管理员在连接管理中为该技能完成挂载。",
      }
    : {
        status: "数据连接暂不可用",
        message: `“${title}”所需的数据连接暂时不可用，本次没有开始处理，也没有使用缓存或虚构数据。`,
        next_action: "请联系管理员在连接管理中核对该技能的连接状态，或稍后重试。",
      };
}

async function connectorGapResult(sid: string, me: Json, intent: Intent, skill: string,
  input: { code: string; connectorIds: string[]; kind: "unmounted" | "unavailable" }): Promise<Json> {
  const copy = connectorGapCopy(skill, input.kind);
  const connectorGap = { code: input.code, skill_id: skill, connectors: input.connectorIds };
  (await addMsg(sid, "assistant", "error_card", {
    code: input.code,
    status: copy.status,
    message: copy.message,
    next_action: copy.next_action,
    persistent: true,
  }));
  return (await ok(sid, me, intent, {
    worker: null,
    connector_gap: connectorGap,
    // 带上 error：绑定任务/运行按失败收尾，不记成已完成（run 与任务都到终态）。
    error: { ...connectorGap, ...copy, ok: false },
  }));
}

/**
 * 声明了已登记连接器、但该连接器一个可用工具都没有时，起箱与 turn 都没有意义：
 * 模型只能拿散文报错，员工看到的是引擎词和无来源结论（DESIGN §15、§16）。
 * 判定只读本地治理库，不发远端请求；stub 不调真实工具，也不该被这道检查打断。
 */
export async function connectorGapResponse(sid: string, me: Json, intent: Intent, skill: string): Promise<Json | null> {
  if (codexMode() === "stub") return null;
  // 任务协作分析按契约不挂载任何业务工具（worker 以空目录起 turn），声明工具不代表本轮能力。
  if (skill === KOL_ANALYZE_TASK_TYPE) return null;
  const gaps = (await skillConnectorGaps(skill));
  if (!gaps.length) return null;
  for (const gap of gaps) {
    (await audit(scopedUser()?.id || "demo", "runtime.connector_gap", {
      skill_id: skill,
      connector_id: gap.connector_id,
      reason: gap.reason,
    }));
  }
  return (await connectorGapResult(sid, me, intent, skill, {
    code: CONNECTOR_GAP_CODE,
    connectorIds: gaps.map((gap) => gap.connector_id),
    kind: "unmounted",
  }));
}

async function runWorkerFlow(sid: string, me: Json, intent: Intent, col: Row | null, text: string): Promise<Json> {
  if (intent.type === "business_approval" && !(intent.extras?.entities as Json | undefined)?.review_draft_only && isApprovalPathLookup(text)) {
    const entities = intent.extras?.entities && typeof intent.extras.entities === "object"
      ? intent.extras.entities as Json
      : {};
    const amount = expenseFactsFromWorkerItem(entities).amount;
    if (!Number.isFinite(amount) || Number(amount) <= 0) {
      return (await handleExpenseApproval(sid, me, intent, text));
    }
  }
  const extracted = extractTaskEntities(text);
  mergeExtractedOntoIntent(intent, extracted);
  const sessionCards = (await messages(sid));
  const priorCompose = {
    ...lastKolMailReply((await composePriorCards(sid, col))),
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
    boundMailbox: (await boundMailboxEmail()),
  });
  const extra: Json = {
    handle: col?.handle || intent.handle,
    review_company: (intent.extras?.entities as Json | undefined)?.review_company,
    review_draft_only: (intent.extras?.entities as Json | undefined)?.review_draft_only,
    agent_id: intent.extras?.agent_id,
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
  const skill = String(intent.skill || intent.type || "creator_discovery");
  const context = (await workerRunContext(skill, extra, text));
  if (context && context.status !== "ready") return (await contextGapResponse(sid, me, intent, context));
  if (context) extra.context_resolution = context;
  const connectorGap = (await connectorGapResponse(sid, me, intent, skill));
  if (connectorGap) return connectorGap;
  const namedGate = (await applyNamedMailGates(sid, me, intent, col, text, composeFacts));
  if (namedGate) return namedGate;
  try {
    const wr = await execWorker(sid, skill, text, workerSafeExtra(extra));
    const mapped = await mapWorker(sid, me, intent, wr);
    if (!mapped.draft && composeInput && mailTemplate) {
      const route = composeRouteFacts({ col, extra, boundMailbox: (await boundMailboxEmail()) });
      // 未指定发件箱时默认当前用户挂载的邮箱（compose-sender 单点规则）。
      const sender = (await composeSenderFor({ collaboration: col, requested: col ? undefined : route.from }));
      const item: Json = {
        type: "create_draft",
        skill: "email_compose",
        template_id: mailTemplate.template_id,
        from: sender.from,
        to: col ? firstEmail(col.email) : route.to,
        context_version: composeInput.context_version || null,
        source_draft_id: composeInput.source_draft_id || null,
        subject: composeInput.subject,
        body: composeInput.body,
        collaboration_id: col?.id || null,
        official_stage: col?.stage_code || null,
        knowledge_id: mailTemplate.id,
        knowledge_version: mailTemplate.version,
        from_source: sender.source,
      };
      const draft = (await persistDraft(sid, item));
      (await addMsg(sid, "assistant", "email_card", (await emailCardPayload(draft))));
      (await syncDraftArtifacts(String(draft.id)));
      return { ...(await ok(sid, me, intent, { worker: mapped.worker, draft, items: mapped.items })), worker: mapped.worker };
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
        return { ...(await persistKnowledgeDraft(sid, me, intent, col, mailTemplate)), worker: mapped.worker };
      }
    }
    return mapped;
  } catch (e) {
    if (e instanceof BudgetBlocked) {
      if (intent.type === "business_approval" && !(intent.extras?.entities as Json | undefined)?.review_draft_only) return (await handleExpenseApproval(sid, me, intent, text));
      return (await unavailableOk(sid, me, intent, e));
    }
    if (e instanceof CodexUnavailable) {
      if (intent.type === "business_approval" && !(intent.extras?.entities as Json | undefined)?.review_draft_only) return (await handleExpenseApproval(sid, me, intent, text));
      return (await unavailableOk(sid, me, intent, e));
    }
    if (e instanceof HttpFail) {
      const detail = e.detail && typeof e.detail === "object" ? e.detail as Json : {};
      if (detail.connector_gap === true) {
        // 运行期兜底：绑定存在、远端发现却没有给出任何工具，turn 未启动；与前置拦截同一类卡。
        const code = String(detail.code || CONNECTOR_GAP_CODE);
        const connectorId = String(detail.connector_id || "");
        (await audit(scopedUser()?.id || "demo", "runtime.connector_gap", {
          skill_id: skill,
          connector_id: connectorId || null,
          reason: code,
        }));
        return (await connectorGapResult(sid, me, intent, skill, {
          code,
          connectorIds: connectorId ? [connectorId] : [],
          kind: "unavailable",
        }));
      }
      (await addMsg(sid, "assistant", "error_card", {
        code: String(detail.code || (isEmailMcpTask(intent.type) ? "starrykol_failed" : isKolClawTask(intent.type) ? "kolclaw_failed" : "worker_failed")),
        message: String(detail.message || e.message),
        next_action: String(detail.next_action || "请稍后重试。"),
        persistent: true,
      }));
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

async function throwKnowledgeSupplement(sid: string, me: Json, intent: Intent, missing: string[]): Promise<never> {
  (await addMsg(sid, "assistant", "supplement_card", {
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
  }));
  throw new HostReject(422, {
    ...(await ok(sid, me, intent)),
    worker: null,
    error: { code: "knowledge_incomplete", message: "知识模板占位未填", missing },
  });
}

async function persistKnowledgeDraft(
  sid: string,
  me: Json,
  intent: Intent,
  col: Row | null,
  template: UsableTemplate,
): Promise<Json> {
  const compiled = compileMailDraft(template, knowledgeFillValues(intent, col));
  const leftover = [...new Set([...compiled.missing, ...leftoverPlaceholders(intent.raw)])];
  if (leftover.length) (await throwKnowledgeSupplement(sid, me, intent, leftover));
  // 未指定发件箱时默认当前用户挂载的邮箱；没有可用默认再退品牌箱（仍是同一处规则）。
  const sender = (await composeSenderFor({ collaboration: col }));
  const item: Json = {
    type: "create_draft",
    skill: template.skill_id || intent.skill || intent.type,
    template_id: template.template_id,
    from: sender.from || BRAND_MAILBOXES[template.brand === "*" ? "" : template.brand] || "",
    from_source: sender.source,
    to: (await assertDraftTo(sid, me, intent, col, { to: col?.email }, intent.raw)),
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
  const draft = (await persistDraft(sid, item));
  (await addMsg(sid, "assistant", "email_card", (await emailCardPayload(draft))));
  return (await ok(sid, me, intent, { worker: null, draft }));
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

async function presentExpenseApproval(sid: string, me: Json, intent: Intent, approval: Row, reused: boolean): Promise<Json> {
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
  (await addMsg(sid, "assistant", "task_result_card", {
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
  }));
  (await addMsg(sid, "assistant", "assistant", {
    text: `${reused ? "已打开上一笔费用审批。" : "已提交。"}${fxLine ? `${fxLine}，适用 ${rule}。` : ""}${sourceLine ? `${sourceLine}。` : ""}${chainLine}当前等待 ${waiting}。`,
    approval_id: approval.id,
    chain_id: approval.chain_id,
  }));
  return (await ok(sid, me, intent, { worker: null, approval, approval_plan: payload }));
}

async function handleExpenseApproval(
  sid: string,
  me: Json,
  intent: Intent,
  text: string,
  workerItem: Json = {},
  source: "worker" | "host" = "host",
): Promise<Json> {
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
      if (stored) return (await presentExpenseApproval(sid, me, intent, stored, true));
      (await addMsg(sid, "assistant", "assistant", {
        text: "还没有已提交的费用审批。请先说明申请人、金额和币种。",
      }));
      return (await ok(sid, me, intent, { worker: null }));
    }
    (await addMsg(sid, "assistant", "supplement_card", {
      intent: "business_approval",
      title: "还需要金额和币种",
      fields: [
        { key: "amount", label: "金额", required: true, value: "" },
        { key: "currency", label: "币种（人民币、美元等）", required: true, value: "" },
      ],
      message: "请补上这次申请的金额和币种，例如 50000 美元。审批人不用填，系统按规则计算。",
    }));
    return (await ok(sid, me, intent, { worker: null }));
  }
  const cited = tryCitedApprovalPlan({ ...entities, ...workerItem }, parsed);
  const requireCitations = source === "worker" && codexMode() !== "stub";
  if (requireCitations && !cited) {
    (await addMsg(sid, "assistant", "supplement_card", {
      intent: "business_approval",
      title: "还需要可引用的汇率或费用档",
      fields: [
        { key: "policy_url", label: "费用审批制度公布页", required: false, value: "" },
        { key: "fx_url", label: "汇率来源（央行中间价页）", required: false, value: "" },
      ],
      message: "没有查到可引用的现行中间价或费用档。请补上制度公布页，或让我用网络搜索再查一次。审批人不用填。",
    }));
    return (await ok(sid, me, intent, { worker: null, approval_plan: { blocked: { code: "missing_search_citation" } } }));
  }
  const plan = cited || calculateApprovalPlan(parsed);
  if (plan.blocked) {
    (await addMsg(sid, "assistant", "error_card", {
      code: plan.blocked.code,
      message: plan.explanation,
      policy_id: plan.policy_id,
    }));
    return (await ok(sid, me, intent, { worker: null, approval_plan: plan }));
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
    (await addMsg(sid, "assistant", "error_card", {
      code: "empty_approval_chain",
      message: plan.explanation || "规则引擎没有算出可执行的审批链。",
      policy_id: plan.policy_id,
    }));
    return (await ok(sid, me, intent, { worker: null, approval_plan: plan }));
  }
  (await audit("host", "expense.approval.created", {
    approval_id: approval.id,
    policy_id: plan.policy_id,
    rule_id: plan.rule_id,
    requester_id: plan.requester_id,
  }));
  return (await presentExpenseApproval(sid, me, intent, approval, false));
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
    return (await runWorkerFlow(sid, me, intent, col, text));
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
  if (leftover.length) (await throwKnowledgeSupplement(sid, me, intent, leftover));
  const wr = await runWorkerFlow(sid, me, intent, col, text);
  if (wr.draft) return wr;
  const filled = compileMailDraft(template, knowledgeFillValues(intent, col));
  if (
    filled.subject
    && filled.body
    && filled.missing.length === 0
    && !unfilledComposeSlots(template, knowledgeFillValues(intent, col))
  ) {
    return { ...(await persistKnowledgeDraft(sid, me, intent, col, template)), worker: wr.worker };
  }
  return wr;
}

async function dispatch(sid: string, me: Json, intent: Intent, col: Row | null, text: string): Promise<Json> {
  if (intent.extras?.result_revise) {
    return (await applyResultRevision(sid, me, intent, text));
  }
  if (intent.extras?.knowledge_id) {
    const templated = await applyKnowledge(sid, me, intent, col, text);
    if (templated) return templated;
  }
  if (!intent.needs_worker || intent.type === "chat") {
    (await addMsg(sid, "assistant", "assistant", {
      text: "可以说「写合作邮件」「记状态」「回复分析」或「发现达人」。",
    }));
    return (await ok(sid, me, intent));
  }
  return (await runWorkerFlow(sid, me, intent, col, text));
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

async function persistHumanSkip(collaborationId: string, skip: HumanSkipRecord | null, clearIfAbsent: boolean): Promise<void> {
  if (skip) {
    (await postgresPool().query("UPDATE collaborations SET last_skip_kind=$1, last_skip_reason=$2, last_skipped_stages=$3 WHERE id=$4", [skip.skip_kind, skip.skip_reason, JSON.stringify(skip.skipped_stages), collaborationId]));
    return;
  }
  if (!clearIfAbsent) return;
  (await postgresPool().query("UPDATE collaborations SET last_skip_kind=NULL, last_skip_reason=NULL, last_skipped_stages=NULL WHERE id=$1", [collaborationId]));
}

export async function hostConfirmStage(
  handle: string | null | undefined,
  stageCode: string | null | undefined,
  collaborationId?: string | null,
  expectedVersion?: number | null,
  reason?: string | null,
  metadata: Json = {},
): Promise<Json> {
  requireStageWrite();
  const db = postgresPool();
  let row: Row | undefined;
  if (collaborationId) {
    row = (await db.query("SELECT * FROM collaborations WHERE id = $1", [collaborationId])).rows[0] as Row | undefined;
  }
  if (!row && handle) {
    row = (await db.query("SELECT * FROM collaborations WHERE handle = $1 OR display_name = $2", [handle, handle])).rows[0] as
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
    (await syncSessionStageCopy(String(col.id), current));
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
  if (LOCKED_PROMISE.has(current) || Number(col.locked || 0) !== 0) {
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
    (await audit("host", "host.confirm_stage.queued", {
      collaboration_id: col.id,
      from_stage: current,
      to_stage: target,
      approval_id: approval.id,
      kind: approvalKind,
      sent: false,
    }));
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
  (await persistHumanSkip(String(col.id), skip, !autoWrite));
  (await audit("host", "host.confirm_stage", {
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
  }));
  (await syncSessionStageCopy(String(col.id), target, String(metadata.session_id || ""), skip));
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

export async function syncSessionStageCopy(
  collaborationId: string,
  stageCode: string,
  extraSessionId = "",
  skip: HumanSkipRecord | null = null,
): Promise<void> {
  const col = (await postgresPool().query("SELECT handle, display_name FROM collaborations WHERE id=$1", [collaborationId])).rows[0] as Row | undefined;
  if (!col) return;
  const official = label(stageCode);
  const headline = stageHeadline(stageCode);
  const title = `${col.display_name || col.handle} · ${official}`;
  const now = nowIso();
  const sessions = (await postgresPool().query("SELECT id FROM sessions WHERE collaboration_id=$1 AND deleted_at IS NULL AND archived_at IS NULL", [collaborationId])).rows as { id: string }[];
  const extra = String(extraSessionId || "").trim();
  if (extra && !sessions.some((session) => session.id === extra)) {
    (await postgresPool().query("UPDATE sessions SET collaboration_id=$1, title=$2, updated_at=$3 WHERE id=$4", [collaborationId, title, now, extra]));
    sessions.push({ id: extra });
  }
  for (const session of sessions) {
    (await postgresPool().query("UPDATE sessions SET title=$1, updated_at=$2 WHERE id=$3", [title, now, session.id]));
    const rows = (await postgresPool().query("SELECT id, payload FROM messages WHERE session_id=$1 AND kind='assistant'", [session.id])).rows as { id: string; payload: string }[];
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
      (await postgresPool().query("UPDATE messages SET payload=$1 WHERE id=$2", [JSON.stringify(payload), row.id]));
    }
    const cards = (await postgresPool().query("SELECT id, payload FROM messages WHERE session_id=$1 AND kind='confirm_stage_card'", [session.id])).rows as { id: string; payload: string }[];
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
      (await postgresPool().query("UPDATE messages SET payload=$1 WHERE id=$2", [JSON.stringify(payload), row.id]));
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
  if (!(await starryKolMcpConfigured()) && codexMode() !== "stub") {
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
      (await audit("host", "host.confirm_stage.mcp", {
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
      }));
    }
    if (data.error) {
      (await audit("host", "host.confirm_stage.mcp_failed", {
        kolUid,
        target,
        from_stage: from,
        failed_hop: data.failed_hop,
        failed_native: data.failed_native,
        hops,
        error: data.message,
      }));
    } else if (data.skipped) {
      (await audit("host", "host.confirm_stage.mcp", {
        kolUid,
        target,
        from_stage: from,
        skipped: true,
        reason: data.reason,
      }));
    }
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (await audit("host", "host.confirm_stage.mcp_failed", { kolUid, target, from_stage: from, error: message }));
    return { error: true, message };
  }
}

export async function hostRejectStage(
  sessionId: string,
  reason?: string | null,
  collaborationId?: string | null,
): Promise<Json> {
  requireSkill("confirm_stage");
  const note = String(reason || "").trim();
  if (!note) throw new HttpFail(400, "驳回必须填写备注");
  const sid = String((await sessionRow(sessionId)).id);
  const cards = (await postgresPool().query("SELECT id, payload FROM messages WHERE session_id=$1 AND kind='confirm_stage_card' ORDER BY created_at DESC", [sid])).rows as { id: string; payload: string }[];
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
    (await postgresPool().query("UPDATE messages SET payload=$1 WHERE id=$2", [JSON.stringify(payload), row.id]));
    touched += 1;
  }
  const msg = (await addMsg(sid, "assistant", "assistant", {
    text: `已驳回阶段建议：${note}。正式阶段未改，也未写远程。`,
    rejected: true,
  }));
  if (colId) {
    void import("./kol-journey.js").then((mod) => mod.publishJourneyForCollaboration(colId));
  }
  (await audit("host", "host.confirm_stage.rejected", { session_id: sid, collaboration_id: colId || null, reason: note }));
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
  const result = (await hostConfirmStage(
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
  ));
  if (!result.waiting_approval && result.collaboration_id) {
    const col = (await postgresPool().query("SELECT * FROM collaborations WHERE id=$1", [String(result.collaboration_id)])).rows[0] as Row | undefined;
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
  (await postgresTransaction(async (db) => {
    (await db.query("INSERT INTO sessions (id, title, created_at, updated_at, kind, disabled, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [sid, title, now, now, body.kind || "work", 0, scopedUser()?.id || null]));
  }));
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

host.get("/sessions", async (c) => {
  const user = scopedUser();
  const all = c.req.query("scope") === "all" && user && isAdmin(user);
  const includeArchived = c.req.query("include_archived") === "1";
  // Every open tab polls this endpoint; a 4s cache of the same data window
  // replaces ~800 rows-worth of per-session queries with one projection.
  const cacheKey = `sessions:${all ? "all" : user?.id || "anon"}:${includeArchived ? 1 : 0}`;
  const payload = await cachedPollAsync(cacheKey, (await sessionsEpoch()), async () => {
    const archivedClause = " AND COALESCE(kind,'') <> 'task_collaboration'" + (includeArchived ? "" : " AND archived_at IS NULL");
    // Only `id`, `title`, `archived_at` (shell title list + 账号设置归档开关) leave
    // this endpoint; `disabled`/`kind` are read here and never serialized. Column
    // order matches the output projection so the two can be read together.
    const select = "SELECT id, title, archived_at, kind, disabled FROM sessions";
    const rows = (!authDisabled() && user && !all
      ? (await postgresPool().query(`${select} WHERE owner_user_id=$1 AND deleted_at IS NULL${archivedClause} ORDER BY updated_at DESC`, [user.id])).rows
      : (await postgresPool().query(`${select} WHERE deleted_at IS NULL${archivedClause} ORDER BY updated_at DESC`, [])).rows) as Row[];
    const visible = rows.filter((r) => {
      const title = String(r.title || "");
      return !(
        (PLATFORM_EXAMPLE_TITLES as readonly string[]).includes(title) ||
        r.disabled ||
        r.kind === "platform_example"
      );
    });
    const statusBySession = (await sessionStatusMap(visible.map((r) => String(r.id))));
    return Promise.all(visible.map(async (r) => ({
      id: String(r.id),
      title: String(r.title || ""),
      archived_at: r.archived_at || null,
      agent_status: statusBySession.get(String(r.id)) || (await sessionStatus(String(r.id))),
    })));
  });
  const { listTaskCollaborationSessions } = await import("../ticket-domain/task-collaboration-session.js");
  const workspaces = await listTaskCollaborationSessions(user?.id || "",includeArchived);
  return c.json([...(await Promise.all(workspaces.map(async row=>({...row,agent_status:(await sessionStatus(String(row.id)))})))),...payload]);
});

host.get("/sessions/:sid", async (c) => {
  const s = (await sessionRow(c.req.param("sid")));
  if (s.collaboration_id) {
    const col = (await postgresPool().query("SELECT * FROM collaborations WHERE id=$1", [String(s.collaboration_id)])).rows[0] as Row | undefined;
    if (col) {
      const { restoreOfficialCollaborationStage } = await import("../starrykol/library-sync.js");
      restoreOfficialCollaborationStage(col);
    }
    if (c.req.query("sync") === "1") {
      const { syncKolSessionMail } = await import("./kol-journey.js");
      void syncKolSessionMail(String(s.id), String(s.collaboration_id), {
        force: c.req.query("force") === "1",
      }).catch(() => 0);
      const stage = (await postgresPool().query("SELECT stage_code FROM collaborations WHERE id=$1", [String(s.collaboration_id)])).rows[0] as Row | undefined;
      (await syncSessionStageCopy(String(s.collaboration_id), normalizeStage(String(stage?.stage_code || col?.stage_code || ""))));
    }
  }
  s.messages = (await messages(String(s.id)));
  s.agent_status = (await sessionStatus(String(s.id)));
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
  const row = (await sessionRow(sid));
  const snapshot = async () => {
    const { authorizedTaskSession } = await import("../ticket-domain/task-collaboration-session.js");
    await authorizedTaskSession(scopedUser()?.id || "",sid);
    await sessionRow(sid);
    const { journeyPayloadWithMailMemory } = await import("./kol-journey.js");
    return {
      messages: (await messages(sid)),
      agent_status: (await sessionStatus(sid)),
      collaboration_id: row.collaboration_id ? String(row.collaboration_id) : null,
      journey: await journeyPayloadWithMailMemory(
        row.collaboration_id ? String(row.collaboration_id) : null,
      ),
    };
  };
  const first = await snapshot();
  let dispose = () => {};
  return new Response(new ReadableStream({
    start(controller) {
      let ended = false;
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (!ended) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("snapshot", { ...first, run_queue: publicQueue(sid) });
      const actorId = scopedUser()?.id || "";
      const guardedSend = async (event: string, data: unknown) => {
        try {
          const { authorizedTaskSession } = await import("../ticket-domain/task-collaboration-session.js");
          await authorizedTaskSession(actorId,sid); await assertSessionAccess(sid); send(event,data);
        } catch { abort(); }
      };
      const unsub = subscribeSession(sid, (ev) => { void guardedSend(ev.type,ev); });
      const ping = setInterval(() => { void guardedSend("ping",{t:Date.now()}); }, 15000);
      const abort = () => {
        if (ended) return;
        ended = true;
        clearInterval(ping);
        unsub();
        c.req.raw.signal.removeEventListener("abort", abort);
        try { controller.close(); } catch { /* already closed */ }
      };
      dispose = abort;
      c.req.raw.signal.addEventListener("abort", abort);
      if (c.req.raw.signal.aborted) abort();
    },
    cancel() {
      dispose();
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
  const row = (await sessionRow(c.req.param("sid")));
  const body = (await c.req.json()) as Json;
  const title = String(body.title || "").trim();
  if (!title) throw new HttpFail(400, "title required");
  (await postgresPool().query("UPDATE sessions SET title=$1,updated_at=$2 WHERE id=$3", [title.slice(0, 120), nowIso(), row.id]));
  (await audit(scopedUser()?.id || "demo", "session.rename", { session_id: row.id }));
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
    agent_id: body.agent_id ? String(body.agent_id) : undefined,
    task_type: locked,
    entities: body.entities && typeof body.entities === "object" ? body.entities as Record<string, unknown> : undefined,
    input: {
      ...(body.knowledge_id ? { knowledge_id: String(body.knowledge_id) } : {}),
      ...(body.collaboration_id ? { collaboration_id: String(body.collaboration_id) } : {}),
    },
  });
  if (resolution.error || resolution.source === "none") {
    (await addMsg(sid, "assistant", "error_card", {
      code: "intent_unavailable",
      message: resolution.error || "识别服务未就绪，请再试一次。",
      next_action: resolution.next_action || "检查 OPENAI_API_KEY 是否已被 Host 加载后，在箱内重试。",
      persistent: true,
    }));
    return null;
  }
  if (!resolution.task_type || resolution.clarification_kind === "direction") {
    (await addMsg(sid, "assistant", "supplement_card", {
      intent: "",
      title: "需要确认任务方向",
      clarification_kind: "direction",
      alternatives: resolution.alternatives,
      fields: [],
      message: resolution.next_action || "请选择最符合你意图的任务，或补充说明后再发。",
    }));
    return null;
  }
  const intent = classify(text, resolution.task_type, body.collaboration_id as string | undefined);
  intent.type = resolution.task_type;
  intent.skill = resolution.task_type;
  intent.needs_worker = true;
  intent.extras = {
    ...intent.extras,
    agent_id: resolution.agent_id,
    agent_name: resolution.agent_name,
    entities: resolution.entities,
    derive_child: !locked,
  };
  return intent;
}

host.post("/sessions/:sid/compose-preview", async (c) => {
  const sid = c.req.param("sid");
  const session = (await sessionRow(sid));
  (await requireTaskAccess("email_compose"));
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
      if (e instanceof BudgetBlocked) throw new HttpFail(429, e.asDict());
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
  const { authorizedTaskSession } = await import("../ticket-domain/task-collaboration-session.js");
  const workspace = await authorizedTaskSession(scopedUser()?.id || "",sid);
  const session = (await sessionRow(sid));
  if (!isSessionRunning(sid)) beginSessionAsk(sid);
  const body = (await c.req.json()) as Json;
  // Explicit task selection is authorized before recognition can return a clarification.
  // An unavailable task must not receive an accepted=true early-return receipt.
  const explicitSkill = typeof body.intent === "string" && taskDefinition(body.intent) ? body.intent : null;
  const explicitActor = scopedUser();
  if (explicitSkill && !authDisabled() && explicitActor && !isAdmin(explicitActor)
    && !explicitActor.authority_skills?.includes(explicitSkill)) {
    throw new HttpFail(400, "未授权该技能");
  }

  if (workspace && ((body.intent && body.intent !== "kol_analyze") || body.collaboration_id || body.work_item_id || body.task_id || body.compose_input)) {
    throw new HttpFail(409,{code:"task_workspace_analysis_only"});
  }
  if (session.collaboration_id && !body.collaboration_id) {
    body.collaboration_id = session.collaboration_id;
  }
  if (body.act && body.act !== "ask") {
    throw new HttpFail(400, "go 只改路由，禁止 POST /messages、禁止起箱");
  }
  if (session.expert_id) {
    (await employeeExpert(String(session.expert_id)));
    const agentId = agentForExpert(String(session.expert_id));
    if (body.agent_id && body.agent_id !== agentId) throw new HttpFail(409, "当前会话已绑定其他智能体");
    body.agent_id = agentId;
  }
  const boundTask = workspace ? null : (await resolveBoundTask(sid, body));
  if (boundTask?.agentId) {
    if (body.agent_id && body.agent_id !== boundTask.agentId) throw new HttpFail(409, "任务已绑定其他智能体");
    body.agent_id = boundTask.agentId;
  }
  const text = String(body.text || body.content || "").trim();
  const attachments = sanitizeAttachments(body.attachments);
  const pendingResult = lastUnsentResult((await messages(sid)));
  const lockedIntent = boundTask?.taskType
    || (body.intent && taskDefinition(String(body.intent)) ? String(body.intent) : undefined);
  const me = (await addMsg(sid, "me", "me", { text, grey: true, attachments }));
  if (!workspace && !boundTask && !body.compose_input && /^(?:确认发送(?:原文|邮件)?|发送这封(?:邮件)?|confirm\s+send)[。.!！\s]*$/i.test(text)) {
    (await addMsg(sid, "assistant", "assistant", {
      text: "请在右栏草稿点击「确认发送」，核对收件人、发件人、抄送、主题及完整正文后确认。聊天中的这句话不会发送邮件。",
      needs_confirmation: true, sent: false,
    }));
    return c.json({ messages: (await messages(sid)), agent_status: "listening", needs_confirmation: true, sent: false, worker: null, draft: null });
  }
  if (!workspace && !boundTask && isFollowStyleTagCommand(text)) {
    return c.json(await handleFollowStyleTagMessage(sid, me, session, text, body));
  }
  const intent = workspace ? {...classify(text,"kol_analyze"),type:"kol_analyze",skill:"kol_analyze",needs_worker:true,handle:null,collaboration_id:null}
    : boundTask
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
      messages: (await messages(sid)),
      accepted: true,
      agent_status: "listening",
      needs_clarification: true,
      worker: null,
      draft: null,
    });
  }
  // Submit-time PEP: a named intent may not silently bypass an unavailable
  // Agent. `authority_skills` is refreshed from native PostgreSQL in the auth
  // middleware for every request, so binding revoke/expiry takes effect now.
  const requestedSkill = String(intent.skill || intent.type || "");
  const submittingUser = scopedUser();
  if (!authDisabled() && submittingUser && !isAdmin(submittingUser)
    && (!requestedSkill || !submittingUser.authority_skills?.includes(requestedSkill))) {
    throw new HttpFail(400, "未授权该技能");
  }
  // Historical unauthenticated stub fixtures do not execute a harness. Real or identified runs always validate the selected pair.
  const unscopedFixture = isTestRuntime() && codexMode() === "stub" && !submittingUser && !body.agent_id;
  let selectedAgent: string | undefined;
  let agent: Awaited<ReturnType<typeof managedAgent>> | null = null;
  try {
    const skillForAgent = intent.skill || intent.type;
    selectedAgent = unscopedFixture ? undefined : String(body.agent_id || intent.extras?.agent_id
      || (await sessionAgentDefault(sid, skillForAgent, scopedUser()?.id || ""))
      || (await runtimeAgentForSkill(skillForAgent, scopedUser()?.id || "", { employeeChoice: true })));
    if (selectedAgent) (await assertRuntimeSkill({ agentId: selectedAgent, skillId: intent.skill || intent.type,
      userId: scopedUser()?.id || "", runId: "submission", sessionId: sid }));
    agent = selectedAgent ? (await managedAgent(selectedAgent)) : null;
  } catch (error) {
    (await failBoundTask(boundTask, error));
    throw error;
  }
  intent.extras = {
    ...intent.extras,
    ...(agent ? { agent_id: agent.id, agent_name: agent.name } : {}),
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
  // Real Codex / Starry KOL MCP may take tens of seconds. Never hold the
  // browser/proxy request open: acknowledge immediately and let GET /sessions/:sid poll.
  const startsWorker = Boolean(intent.needs_worker && intent.type !== "chat");
  const skill = intent.skill || intent.type || "creator_discovery";
  let col: Row | null = null;
  try {
    if (!workspace) mergeExtractedOntoIntent(intent, {
      ...extractTaskEntities(text),
      ...(intent.extras.entities && typeof intent.extras.entities === "object" ? intent.extras.entities as Json : {}),
    });
    if (intent.skill && !(await isSkillGranted(intent.skill))) {
      throw new HttpFail(400, "未授权该技能");
    }
    col = workspace ? null : resolveCollab(intent) || null;
    // Internal stub runs may receive the generic exception template before the
    // async library sync has exposed its exception row on the home board. Use
    // one seeded exception only in that test profile; production requires an
    // explicit collaboration selected by the user.
    const exceptionTemplate = intent.extras?.entities
      && typeof intent.extras.entities === "object"
      && String((intent.extras.entities as Json).exception_template || "");
    if (!col && exceptionTemplate && codexMode() === "stub" && authDisabled()) {
      col = (await postgresPool().query("SELECT * FROM collaborations WHERE stage_code IN ('PAUSED','DISPUTED','LOST','REJECTED','CANCELLED') ORDER BY id LIMIT 1", [])).rows[0] as Row | undefined || null;
    }
    if (col) {
      intent.collaboration_id = String(col.id);
      if (!intent.handle) intent.handle = String(col.handle || "");
    }
    (await validateComposeInput(intent, col));
    if (col && isMailDraftIntent(intent) && !isEmailMcpTask(intent.type) && !intent.extras?.result_revise && !resolveMailTo(col, intent, {}, text)) {
      (await throwMailToSupplement(sid, me, intent, col));
    }
    if (startsWorker) (await requireTaskAccess(skill, selectedAgent));
    if (isWriteSkill(skill) && isSessionRunning(sid)) {
      (await dropOwnMe(me));
      throw new HttpFail(409, "请先停止当前生成，再确认阶段。");
    }
  } catch (e) {
    // A bound task must never keep looking "running" after its ask was refused.
    (await failBoundTask(boundTask, e));
    throw e;
  }
  if (agent) (await addMsg(sid, "assistant", "agent_identity", { agent_id: agent.id, agent_name: agent.name, skill_id: skill }));
  if (startsWorker && isSessionRunning(sid)) {
    enqueueAsk(sid, { text, intent, me });
    (await queueBoundTask(boundTask));
    publishQueue(sid);
    return c.json({
      ...(await ok(sid, me, intent)),
      accepted: true,
      queued: true,
      agent_status: "running",
      run_queue: publicQueue(sid),
    }, 202);
  }
  if (startsWorker && wasSessionStopped(sid)) {
    (await cancelBoundTask(boundTask, "会话已停止，未执行。"));
    return c.json({
      ...(await ok(sid, me, intent)),
      accepted: true,
      stopped: true,
      agent_status: (await sessionStatus(sid)),
      run_queue: publicQueue(sid),
    });
  }
  if (codexMode() !== "stub" && startsWorker) {
    (await runInBackground(sid, me, intent, col, text));
    return c.json({
      ...(await ok(sid, me, intent)),
      accepted: true,
      agent_status: (await sessionStatus(sid)),
      run_queue: publicQueue(sid),
    }, 202);
  }
  try {
    if (startsWorker && !markSessionRunning(sid)) {
      if (wasSessionStopped(sid)) (await cancelBoundTask(boundTask, "会话已停止，未执行。"));
      else (await failBoundTask(boundTask, "会话正在执行其他工作，未能开始；请稍后重试"));
      return c.json({
        ...(await ok(sid, me, intent)),
        accepted: true,
        stopped: true,
        agent_status: (await sessionStatus(sid)),
        run_queue: publicQueue(sid),
      });
    }
    (await startBoundTask(boundTask));
    const result = await dispatch(sid, me, intent, col, text);
    (await finishBoundTask(boundTask, sid, result));
    return c.json(result);
  } catch (e) {
    if (e instanceof Error && e.name === "WorkerStopped") {
      (await stoppedBoundTask(boundTask));
      return c.json({
        ...(await ok(sid, me, intent)),
        accepted: true,
        stopped: true,
        agent_status: (await sessionStatus(sid)),
        run_queue: publicQueue(sid),
      });
    }
    if (e instanceof BudgetBlocked || e instanceof CodexUnavailable) {
      const result = (await unavailableOk(sid, me, intent, e));
      (await finishBoundTask(boundTask, sid, result));
      return c.json(result);
    }
    (await finishBoundTask(boundTask, sid, undefined, e));
    throw e;
  } finally {
    if (startsWorker) (await afterRun(sid));
  }
});

async function dropOwnMe(me: Json): Promise<void> {
  const age = Date.now() - Date.parse(String(me.created_at || ""));
  if (!Number.isFinite(age) || age > 2000) return;
  (await postgresPool().query("DELETE FROM messages WHERE id=$1", [me.id]));
}

host.post("/sessions/:sid/stop", async (c) => {
  const sid = c.req.param("sid");
  (await sessionRow(sid));
  const wasRunning = isSessionRunning(sid);
  const attached = hasRunAbort(sid);
  abortSessionRun(sid);
  if (wasRunning && !attached) {
    (await afterRun(sid));
  } else {
    publishSession(sid, { type: "status", agent_status: (await sessionStatus(sid)) });
    publishQueue(sid);
  }
  return c.json({
    stopped: wasRunning,
    run_queue: publicQueue(sid),
    agent_status: (await sessionStatus(sid)),
  });
});

host.delete("/sessions/:sid/queue/:qid", async (c) => {
  const sid = c.req.param("sid");
  (await sessionRow(sid));
  const qid = c.req.param("qid");
  const queued = listQueue(sid).find((item) => item.id === qid);
  if (!queued || !removeQueued(sid, qid)) throw new HttpFail(404, "队列中没有这条任务");
  (await cancelBoundTask(boundFromIntent(queued.intent), "已从队列移出，未执行。"));
  publishQueue(sid);
  return c.json({ ok: true, run_queue: publicQueue(sid) });
});

export const mailDraftActions: Operation["handle"] = async (c, input) => {
  const draft = (await getDraft(String(input.draft_id || "")));
  return c.json(await replySendView(draft, (await mailSendAction(draft))));
};

export const sendMailDraft: Operation["handle"] = async (c, payload) => {
  const did = String(payload.draft_id || "");
  const d = (await getDraft(did));
  const body = payload as Json;
  if (["cc", "from_addr", "to_addr", "subject", "body", "body_en", "template_id"].some((key) => body[key] !== undefined)) {
    throw new HttpFail(409, { code: "mail_edits_require_reconfirmation", message: "请先保存修改，再核对当前草稿并确认发送。" });
  }
  try {
    (await validateMailSend(d));
  } catch (error) {
    if (error instanceof PepFail) {
      // Preserve the existing persistent, actionable policy feedback, but do not send.
      if (!d.sent_at && !["sent", "sending", "send_unknown"].includes(String(d.status))) {
        (await setDraftStatus(did, error.status, error.message));
      }
      const msg = (await addMsg(String(d.session_id), "assistant", "error_card", { ...error.asDict(), draft_id: did, persistent: true }));
      (await audit("host", "host.send.fail", { draft_id: did, status: error.status, called_stage: false }));
      recordFailedSession({ reason: error.status, code: error.status, draft_id: did, message: error.message }, String(d.session_id));
      (await syncEmailCard(did));
      throw new HttpFail(error.http, { ...error.asDict(), toast_success: false, draft: (await emailCardPayload((await getDraft(did)))), message_id: msg.id });
    }
    throw error;
  }
  const input = await bindReplySend(d, (await mailSendAction(d)), { confirmation_version: String(body.confirmation_version || ""), request_id: String(body.request_id || "") });
  const claimed = await claimMailSend(did, input);
  if (claimed.replay) {
    return c.json({ ok: true, status: "sent", replayed: true, result: claimed.replay, stage_changed: false, keep_stage: true });
  }
  (await syncEmailCard(did));
  let result: Json;
  try {
    result = await sendDraft(did, "operator", input.request_id);
  } catch (error) {
    if (error instanceof HttpFail && typeof error.detail === "object" && error.detail && (error.detail as Json).code === "mail_reply_context_changed") {
      (await syncEmailCard(did));
      throw error;
    }
    // A successful provider receipt must not be turned into a false failure by ancillary work.
    if ((await getDraft(did)).status === "sent") {
      const replay = (await claimMailSend(did, input)).replay;
      return c.json({ ok: true, status: "sent", replayed: true, result: replay, stage_changed: false, keep_stage: true });
    }
    await markMailSendUnknown(did, String(input.request_id));
    const msg = (await addMsg(String(d.session_id), "assistant", "error_card", {
      status: "send_unknown", message: "邮件发送回执暂未确认；请核对邮件服务结果，勿重复发送。",
      next_action: "核对邮件回执后再处理。正式阶段未改。", persistent: true,
    }));
    (await syncEmailCard(did));
    return c.json({ ok: false, status: "send_unknown", stage_changed: false, toast_success: false, message: msg }, 502);
  }
  (await syncEmailCard(did));
  const sentExtra = typeof d.extra === "object" && d.extra ? d.extra as Json : {};
  (await audit("host", "host.send", { draft_id: did, request_id: input.request_id, called_stage: false, knowledge_id: sentExtra.knowledge_id || null, knowledge_version: sentExtra.knowledge_version || null }));
  const col = d.collaboration_id ? (await postgresPool().query("SELECT * FROM collaborations WHERE id=$1", [d.collaboration_id])).rows[0] as Row | undefined : undefined;
  const stageNow = col?.stage_code as string | undefined;
  const msg = (await addMsg(String(d.session_id), "assistant", "assistant", {
    text: `已发送原文。正式阶段仍是 ${stageNow ? label(stageNow) : "不变"}（发送 ≠ 改阶段）。`,
    sent: true, status: "sent", draft_id: did, request_id: input.request_id,
  }));
  if (col) {
    void rememberOutboundAndRefreshDigest({
      collaborationId: String(col.id), sessionId: String(d.session_id), subject: String(d.subject || ""), body: String(d.body_en || ""),
      from: String(d.from_addr || ""), to: String(d.to_addr || ""), conversationId: String(col.conversation_id || ""), providerMessageId: String(d.id),
    }).catch(async () => (await audit("host", "host.send.digest_pending", { draft_id: did })));
  }
  return c.json({ ok: true, status: "sent", result, official_stage: stageNow, stage_changed: false, toast_success: false, message: msg, keep_stage: true });
};

export const translateMailDraft: Operation["handle"] = async (c, input) => {
  requireConnector("starry", "read");
  const did = String(input.draft_id || "");
  const d = (await getDraft(did));
  const cached = String(d.body_zh_internal || "").trim();
  const zh = await translateDraftInternal(String(d.body_en || ""), cached);
  if (!zh) throw new HttpFail(409, { message: "暂时无法生成中文译稿" });
  if (zh !== cached) {
    (await postgresTransaction(async (db) => {
      (await db.query("UPDATE drafts SET body_zh_internal = $1 WHERE id = $2", [zh, did]));
    }));
    (await syncEmailCard(did));
  }
  return c.json({ ok: true, zh, internal_only: true, smtp: false });
};

export const exportMailDraft: Operation["handle"] = async (c, input) => {
  const d = (await getDraft(String(input.draft_id || "")));
  if ((String(input.format || "") || "eml") !== "eml") throw new HttpFail(400, "format must be eml");
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
};

host.patch("/drafts/:did", async (c) => {
  const did = c.req.param("did");
  const existing = (await getDraft(did));
  (await assertDraftEditable(existing));
  const body = (await c.req.json()) as Json;
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (body.cc != null) {
    fields.push(`cc = $${vals.length + 1}`);
    vals.push(body.cc);
  }
  if (body.subject != null) {
    fields.push(`subject = $${vals.length + 1}`);
    vals.push(body.subject);
  }
  if (body.body_en != null) {
    fields.push(`body_en = $${vals.length + 1}`);
    vals.push(body.body_en);
  }
  if (body.amount_usd != null) {
    fields.push(`amount_usd = $${vals.length + 1}`);
    vals.push(body.amount_usd);
  }
  if (body.from_addr != null) {
    const extra = typeof existing.extra === "object" && existing.extra ? (existing.extra as Json) : {};
    const preferredBrand = String(extra.brand || "") || collaborationBrand(existing.collaboration_id ? String(existing.collaboration_id) : null);
    const requested = String(body.from_addr).trim();
    // 本人挂载的邮箱（品牌范围核对通过）按原地址保留；其余仍映射到品牌授权箱。
    const owned = authorizedSenderBrand(requested, currentUser(), preferredBrand);
    if (owned) {
      fields.push(`from_addr = $${vals.length + 1}`);
      vals.push(owned.email);
    } else {
      const resolved = resolveAuthorizedFrom(requested, currentUser(), preferredBrand);
      if (!resolved.brand) throw new HttpFail(400, "From 必须是品牌邮箱");
      fields.push(`from_addr = $${vals.length + 1}`);
      vals.push(resolved.email);
    }
  }
  if (body.to_addr != null) {
    fields.push(`to_addr = $${vals.length + 1}`);
    vals.push(String(body.to_addr).trim());
  }
  if (body.template_id != null) {
    fields.push(`template_id = $${vals.length + 1}`);
    vals.push(body.template_id);
  }
  if (!fields.length) return c.json((await getDraft(did)));
  (await postgresTransaction(async (db) => {
    const current = (await getDraft(did, db));
    await db.query("SELECT id FROM drafts WHERE id=$1 FOR UPDATE", [did]);
    (await assertDraftEditable(current, db));
    const extra = typeof current.extra === "object" && current.extra ? current.extra as Json : {};
    const revisedExtra = { ...extra, confirmation_revision: Number(extra.confirmation_revision || 0) + 1 };
    await db.query(`UPDATE drafts SET ${fields.join(", ")}, extra = $${vals.length + 1} WHERE id = $${vals.length + 2}`, [...vals, JSON.stringify(revisedExtra), did]);
  }));
  let d = (await getDraft(did));
  const fp = currentFingerprint(d);
  (await postgresTransaction(async (db) => {
    (await db.query("UPDATE drafts SET fingerprint = $1 WHERE id = $2", [fp, did]));
  }));
  (await syncDraftArtifacts(did));
  return c.json((await getDraft(did)));
});

host.post("/drafts/:did/confirm-stage", async (c) => {
  requireSkill("confirm_stage");
  const d = (await getDraft(c.req.param("did")));
  const body = (await c.req.json().catch(() => ({}))) as Json;
  if (!body.stage_code) throw new HttpFail(400, "必须指定具体目标阶段，不能用「下一阶段」");
  const result = (await hostConfirmStage(
    null,
    String(body.stage_code),
    d.collaboration_id as string | undefined,
    parseExpectedVersion(body.expected_version),
    body.reason as string | undefined,
    { ...body, session_id: d.session_id },
  ));
  if (!result.waiting_approval && result.collaboration_id) {
    const col = (await postgresPool().query("SELECT * FROM collaborations WHERE id=$1", [String(result.collaboration_id)])).rows[0] as Row | undefined;
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
    : (await addMsg(String(d.session_id), "assistant", "assistant", {
      text: waiting
        ? `已提交阶段审批（${result.target_label}）。正式阶段仍是 ${result.stage_label}。请到「工作审批」。`
        : `正式阶段已按你的确认更新：${result.stage_label}。未发信。`,
      approval_id: result.approval_id || undefined,
      waiting_approval: waiting,
    }));
  return c.json({ ...result, sent: false, message: msg });
});

host.put("/collaborations/:id/follow-style-tags", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const col = (await resolveFollowStyleCollaboration(c.req.param("id"), body.handle as string | undefined));
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
  const result = (await hostConfirmStage(
    null,
    String(body.stage_code),
    c.req.param("cid"),
    parseExpectedVersion(body.expected_version),
    body.reason as string | undefined,
    body,
  ));
  if (!result.waiting_approval && result.collaboration_id) {
    const col = (await postgresPool().query("SELECT * FROM collaborations WHERE id=$1", [String(result.collaboration_id)])).rows[0] as Row | undefined;
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
  (await sessionRow(sid));
  const body = (await c.req.json()) as Json;
  if (body.rejected || body.action === "reject") {
    return c.json((await hostRejectStage(sid, body.reason as string | undefined, body.collaboration_id as string | undefined)));
  }
  if (!body.stage_code) throw new HttpFail(400, "必须指定具体目标阶段，不能用「下一阶段」");
  const result = (await hostConfirmStage(
    body.handle as string | undefined,
    String(body.stage_code),
    body.collaboration_id as string | undefined,
    parseExpectedVersion(body.expected_version),
    body.reason as string | undefined,
    { ...body, session_id: sid },
  ));
  if (!result.waiting_approval && result.collaboration_id) {
    const col = (await postgresPool().query("SELECT * FROM collaborations WHERE id=$1", [String(result.collaboration_id)])).rows[0] as Row | undefined;
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
    : (await addMsg(sid, "assistant", "assistant", {
      text: waiting
        ? `已提交阶段审批（${result.target_label}）。正式阶段仍是 ${result.stage_label}。请到「工作审批」。`
        : `正式阶段已按你的确认更新：${result.stage_label}。本次不起箱、未发信。${mcpNote}`,
      approval_id: result.approval_id || undefined,
      waiting_approval: waiting,
      mcp_sync: mcp || undefined,
    }));
  return c.json({ ...result, worker: null, sent: false, message: msg });
});

async function inboundRow(iid: string): Promise<Row> {
  const inbound = (await postgresPool().query("SELECT * FROM inbound WHERE id = $1", [iid])).rows[0] as Row | undefined;
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

host.get("/inbound", async (c) => {
  const limitRaw = Number(c.req.query("limit"));
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const deferred = String(c.req.query("deferred") || "");
  const cursor = decodeInboundCursor(String(c.req.query("cursor") || "").trim());
  const scope = nativeInboundVisibleSql();
  const where = [scope.sql];
  const params: unknown[] = [...scope.params];
  if (deferred === "1" || deferred === "true") where.push("COALESCE(deferred,0) = 1");
  else if (deferred === "0" || deferred === "false") where.push("COALESCE(deferred,0) = 0");
  if (cursor?.ts && cursor.id) {
    where.push(`(ts < $${params.length + 1} OR (ts = $${params.length + 2} AND id < $${params.length + 3}))`);
    params.push(cursor.ts, cursor.ts, cursor.id);
  }
  const rows = (await postgresPool().query(`SELECT * FROM inbound WHERE ${where.join(" AND ")} ORDER BY ts DESC, id DESC LIMIT $${params.length + 1}`, [...params, limit + 1])).rows as Row[];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return c.json({
    items,
    next_cursor: hasMore && last ? encodeInboundCursor(last) : null,
    table: "inbound",
  });
});

host.post("/inbound/:iid/defer", async (c) => {
  (await inboundRow(c.req.param("iid")));
  (await postgresTransaction(async (db) => {
    (await db.query("UPDATE inbound SET deferred = 1 WHERE id = $1", [c.req.param("iid")]));
  }));
  return c.json({ ok: true, deferred: true, resumed: false, resumed_other_thread: false });
});

host.post("/inbound/:iid/resume", async (c) => {
  (await inboundRow(c.req.param("iid")));
  (await postgresTransaction(async (db) => {
    (await db.query("UPDATE inbound SET deferred = 0 WHERE id = $1", [c.req.param("iid")]));
  }));
  return c.json({ ok: true, deferred: false, resumed: true, resumed_other_thread: false });
});

host.post("/inbound/:iid/bind", async (c) => {
  const iid = c.req.param("iid");
  const inbound = (await inboundRow(iid));
  const body = (await c.req.json()) as Json;
  const col = (await assertCollaborationInScope(String(body.collaboration_id || "")));
  const sid = inbound.session_id as string | undefined;
  (await postgresTransaction(async (db) => {
    (await db.query("UPDATE inbound SET bound = 1, collaboration_id = $1, brand = COALESCE(brand, $2) WHERE id = $3", [col.id, col.brand, iid]));
  }));
  if (sid) {
    (await addMsg(sid, "assistant", "assistant", {
      text: `已由人选绑定到 ${(await collabDisplay(col.id))}。未自动记入、未恢复其它会话。`,
      auto_filed: false,
      resumed_other_thread: false,
    }));
  }
  return c.json({ ok: true, bound: true, session_id: sid, resumed_other_thread: false });
});

host.post("/inbound/:iid/create", async (c) => {
  const iid = c.req.param("iid");
  const body = (await c.req.json()) as Json;
  const handle = String(body.handle || "新来信达人");
  const cid = nid("col");
  (await postgresTransaction(async (db) => {
    (await db.query(`INSERT INTO collaborations
       (id, handle, display_name, brand, platform, followers, email, mailbox_from,
        lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue, stage_version, locked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [cid, handle, handle, "LT", "inbound", "", "", BRAND_MAILBOXES.LT, `lc_${cid}`, `conv_${cid}`, "INITIAL_CONTACT", 0, "from inbound", 0, 0, 0]));
  }));
  const inbound = (await postgresPool().query("SELECT * FROM inbound WHERE id = $1", [iid])).rows[0] as Row | undefined;
  if (!inbound) throw new HttpFail(404, "Not Found");
  const sid = inbound.session_id as string | undefined;
  (await postgresTransaction(async (db) => {
    (await db.query("UPDATE inbound SET bound = 1, collaboration_id = $1 WHERE id = $2", [cid, iid]));
  }));
  if (sid) {
    (await addMsg(sid, "assistant", "assistant", {
      text: `已由人选绑定到 ${(await collabDisplay(cid))}。未自动记入、未恢复其它会话。`,
      auto_filed: false,
      resumed_other_thread: false,
    }));
  }
  return c.json({ ok: true, bound: true, session_id: sid, resumed_other_thread: false });
});

host.get("/inbound/:iid/search", async (c) => {
  (await inboundRow(c.req.param("iid")));
  const q = c.req.query("q") || "";
  const kols = (await scopedCollaborationSearch(q));
  return c.json({ inbound_id: c.req.param("iid"), kols, resumed_other_thread: false });
});
