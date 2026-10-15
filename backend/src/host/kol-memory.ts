/**
 * KOL follow / pool memory (A/B/C).
 * BIZ-01/05/06/07/18 · PROD-AGENT-01/08 · TECH-BE-01/03/05/06
 *
 * A kol_profile_index — public-sea formal profile
 * B kol_follow_index — exclusive follow (authoritative read)
 * C kol_thread_summary — correspondence summary (effective=0/1)
 *
 * Claim moment is NOT effective correspondence.
 * Missing last_effective_mail_at → cron skip + no card countdown.
 * First outbound mail only renews the clock; it does not create B.
 */
import { authDisabled, scopedUser } from "../auth.js";
import { DEMO_USER } from "../config.js";
import { audit, getConn, nowIso, tx, type DatabaseConnection } from "../db.js";
import { publicProfileFields } from "./public-profile.js";
export { publicProfileFields } from "./public-profile.js";
import { nid } from "../ids.js";
import { codeFromLabel, label as stageLabel } from "../stages.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { mailPreview } from "./mail-preview.js";
import { currentUser } from "./persona.js";

export const DEFAULT_COMPANY_ID = "company:amperetime";
export const FOLLOW_IDLE_DAYS = 14;
export const KOL_ANALYZE_MAX_IN_FLIGHT = 3;
export const KOL_ANALYZE_TASK_TYPE = "kol_analyze";
export const KOL_ANALYZE_VERBS = [
  "claim_follow",
  "compose_draft",
  "confirm_send",
  "confirm_stage",
  "open_thread",
  "release_follow",
  "handoff",
  "retry_sync",
  "none",
] as const;

export type KolAnalyzeVerb = (typeof KOL_ANALYZE_VERBS)[number];

export type MemoryEmployee = {
  id: string;
  name: string;
  brands: string[];
};

export type FollowClock = {
  last_effective_mail_at: string | null;
  days_since_interaction: number | null;
  release_due_at: string | null;
  countdown: boolean;
  cron_eligible: boolean;
};

export type EffectiveKind = "human" | "bounce" | "auto_reply" | "delivery_fail" | "unknown";

const PRIVATE_KEYS = new Set([
  "email", "contact_email", "contactEmail", "quote", "contract", "notes",
  "phone", "wechat", "address_line", "postal", "sku", "qty",
]);

const BOUNCE_RE = /mailer-daemon|postmaster|undeliverable|delivery.?fail|delivery status notification|\bbounce\b|returned mail|mailbox unavailable/i;
const AUTO_REPLY_RE = /auto[- ]?reply|automatic reply|out of office|vacation reply|不在办公室|自动回复|ooo\b/i;

export function memoryCompanyId(): string {
  return DEFAULT_COMPANY_ID;
}

export async function currentMemoryEmployee(): Promise<Awaited<MemoryEmployee>> {
  const user = scopedUser();
  if (user) {
    return { id: user.id, name: user.name, brands: [...(user.brands || [])] };
  }
  if (authDisabled()) {
    try {
      const persona = (await currentUser());
      return { id: persona.id, name: persona.name, brands: [...(persona.brands || [])] };
    } catch {
      return { id: DEMO_USER.id, name: DEMO_USER.name, brands: [...DEMO_USER.brands] };
    }
  }
  throw new HttpFail(401, "authentication required");
}

export async function resolveScopeBrand(requested?: string, employee?: Awaited<ReturnType<typeof currentMemoryEmployee>>): Promise<Awaited<string>> {
if (employee === undefined) employee = (await currentMemoryEmployee());

  const brand = String(requested || "").trim();
  if (brand) return brand;
  return employee.brands[0] || "LT";
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function trimPrivate<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (PRIVATE_KEYS.has(key)) delete out[key];
  }
  return out;
}

export function followClock(lastEffectiveMailAt?: string | null, now = Date.now()): FollowClock {
  const raw = text(lastEffectiveMailAt);
  if (!raw) {
    return {
      last_effective_mail_at: null,
      days_since_interaction: null,
      release_due_at: null,
      countdown: false,
      cron_eligible: false,
    };
  }
  const start = Date.parse(raw);
  if (!Number.isFinite(start)) {
    return {
      last_effective_mail_at: raw,
      days_since_interaction: null,
      release_due_at: null,
      countdown: false,
      cron_eligible: false,
    };
  }
  const days = Math.max(0, Math.floor((now - start) / 86_400_000));
  return {
    last_effective_mail_at: new Date(start).toISOString(),
    days_since_interaction: days,
    release_due_at: new Date(start + FOLLOW_IDLE_DAYS * 86_400_000).toISOString(),
    countdown: true,
    cron_eligible: true,
  };
}

export function classifyCorrespondenceKind(input: {
  kind?: string;
  subject?: string;
  body?: string;
  from?: string;
  status?: string;
}): EffectiveKind {
  const declared = text(input.kind).toLowerCase();
  if (declared === "bounce" || declared === "auto_reply" || declared === "delivery_fail" || declared === "human") {
    return declared as EffectiveKind;
  }
  const blob = [input.subject, input.body, input.from, input.status].map(text).join(" ");
  if (BOUNCE_RE.test(blob) || /delivery.?fail/i.test(blob)) return "delivery_fail";
  if (AUTO_REPLY_RE.test(blob)) return "auto_reply";
  return "human";
}

export function isEffectiveCorrespondence(input: {
  gatewaySuccess?: boolean;
  direction?: string;
  kind?: string;
  subject?: string;
  body?: string;
  from?: string;
  status?: string;
}): boolean {
  if (!input.gatewaySuccess) return false;
  const direction = text(input.direction).toLowerCase();
  if (direction !== "inbound" && direction !== "outbound") return false;
  const kind = classifyCorrespondenceKind(input);
  return kind === "human";
}

export async function getProfile(kolUid: string, companyId = memoryCompanyId(), db: DatabaseConnection = getConn()): Promise<Awaited<Row | undefined>> {
  return (await db.query("SELECT * FROM kol_profile_index WHERE company_id=$1 AND kol_uid=$2",[companyId,text(kolUid)])).rows[0] as Row | undefined;
}

export async function upsertPublicProfile(input: {
 company_id?: string;
 kol_uid: string;
 handle?: string;
 display_name?: string;
 platform?: string;
 homepage_url?: string;
 avatar_url?: string;
 followers?: string;
 avg_plays?: string;
 engagement?: string;
  engagement_source?: string;
 direction?: string;
  region?: string;
  style?: string;
  ingest_source?: string;
  ingested_at?: string;
  public_stage?: string;
  pool_status?: string;
  idle?: number;
  source_version?: string;
  source_batch?: string;
  platform_creator_id?: string;
}, db: DatabaseConnection = getConn()): Promise<Awaited<Row>> {
  const companyId = text(input.company_id) || memoryCompanyId();
  const kolUid = text(input.kol_uid);
  if (!kolUid) throw new HttpFail(400, { code: "kol_uid_required", message: "需要正式红人编号" });
  const now = nowIso();
  const existing = (await getProfile(kolUid, companyId, db));
  const id = String(existing?.id || nid("kpi"));
  (await db.query("INSERT INTO kol_profile_index\n     (id,company_id,kol_uid,handle,display_name,platform,homepage_url,avatar_url,followers,avg_plays,\n      engagement,engagement_source,direction,region,style,ingest_source,ingested_at,public_stage,pool_status,\n      idle,source_version,source_batch,platform_creator_id,created_at,updated_at)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)\n     ON CONFLICT(company_id, kol_uid) DO UPDATE SET\n       handle=COALESCE(NULLIF(excluded.handle,''), kol_profile_index.handle),\n       display_name=COALESCE(NULLIF(excluded.display_name,''), kol_profile_index.display_name),\n       platform=COALESCE(NULLIF(excluded.platform,''), kol_profile_index.platform),\n       homepage_url=COALESCE(NULLIF(excluded.homepage_url,''), kol_profile_index.homepage_url),\n       avatar_url=COALESCE(NULLIF(excluded.avatar_url,''), kol_profile_index.avatar_url),\n       followers=COALESCE(NULLIF(excluded.followers,''), kol_profile_index.followers),\n       avg_plays=COALESCE(NULLIF(excluded.avg_plays,''), kol_profile_index.avg_plays),\n       engagement=COALESCE(NULLIF(excluded.engagement,''), kol_profile_index.engagement),\n       engagement_source=COALESCE(NULLIF(excluded.engagement_source,''), kol_profile_index.engagement_source),\n       direction=COALESCE(NULLIF(excluded.direction,''), kol_profile_index.direction),\n       region=COALESCE(NULLIF(excluded.region,''), kol_profile_index.region),\n       style=COALESCE(NULLIF(excluded.style,''), kol_profile_index.style),\n       ingest_source=COALESCE(NULLIF(excluded.ingest_source,''), kol_profile_index.ingest_source),\n       ingested_at=COALESCE(kol_profile_index.ingested_at, excluded.ingested_at),\n       public_stage=COALESCE(NULLIF(excluded.public_stage,''), kol_profile_index.public_stage),\n       source_version=COALESCE(excluded.source_version, kol_profile_index.source_version),\n       source_batch=COALESCE(NULLIF(excluded.source_batch,''), kol_profile_index.source_batch),\n       platform_creator_id=COALESCE(NULLIF(excluded.platform_creator_id,''), kol_profile_index.platform_creator_id),\n       updated_at=excluded.updated_at",[id,companyId,kolUid,text(input.handle),text(input.display_name) || text(input.handle),text(input.platform),text(input.homepage_url),text(input.avatar_url),text(input.followers),text(input.avg_plays),text(input.engagement),text(input.engagement_source),text(input.direction),text(input.region),text(input.style),text(input.ingest_source) || "starry",existing?.ingested_at || input.ingested_at || now,text(input.public_stage),text(input.pool_status) || existing?.pool_status || "open",Number(input.idle ?? existing?.idle ?? 0),text(input.source_version),text(input.source_batch),text(input.platform_creator_id),existing?.created_at || now,now]));
  const saved = await getProfile(kolUid, companyId, db);
  if (!saved) throw new HttpFail(409, { code: "profile_write_not_visible" });
  return saved;
}

export async function ingestFormalProfile(input: {
  kol_uid: string;
  handle?: string;
  display_name?: string;
  platform?: string;
  homepage_url?: string;
  avatar_url?: string;
  followers?: string;
  avg_plays?: string;
  engagement?: string;
  direction?: string;
  region?: string;
  style?: string;
  public_stage?: string;
  ingest_source?: string;
  company_id?: string;
  source_batch?: string;
  platform_creator_id?: string;
  pool_status?: string;
}): Promise<Awaited<Row | null>> {
  const kolUid = text(input.kol_uid);
  if (!kolUid) return null;
  return (await upsertPublicProfile({
    ...input,
    ingest_source: input.ingest_source || "ingest",
    ingested_at: nowIso(),
  }));
}

export async function activeFollow(input: {
  company_id?: string;
  kol_uid: string;
  scope_brand: string;
}, db: DatabaseConnection = getConn()): Promise<Awaited<Row | undefined>> {
  return (await db.query("SELECT * FROM kol_follow_index\n      WHERE company_id=$1 AND kol_uid=$2 AND scope_brand=$3 AND status='active'",[text(input.company_id) || memoryCompanyId(),text(input.kol_uid),text(input.scope_brand)])).rows[0] as Row | undefined;
}

export async function followById(followId: string, db: DatabaseConnection = getConn()): Promise<Awaited<Row | undefined>> {
  return (await db.query("SELECT * FROM kol_follow_index WHERE id=$1",[followId])).rows[0] as Row | undefined;
}

export async function listOpenPool(companyId = memoryCompanyId(), db: DatabaseConnection = getConn()): Promise<Awaited<Json[]>> {
  const rows = (await db.query("SELECT p.*,\n       (SELECT f.release_reason FROM kol_follow_index f\n         WHERE f.company_id=p.company_id AND f.kol_uid=p.kol_uid AND f.status='released'\n         ORDER BY f.released_at DESC, f.id DESC LIMIT 1) AS latest_release_reason\n      FROM kol_profile_index p\n      WHERE p.company_id=$1 AND p.pool_status='open'\n        AND p.ingest_source IS DISTINCT FROM 'discovery-candidate'\n        AND NOT EXISTS (SELECT 1 FROM kol_follow_index f JOIN kol_profile_index owned\n          ON owned.company_id=f.company_id AND owned.kol_uid=f.kol_uid\n          WHERE f.company_id=p.company_id AND f.status='active' AND\n            (f.kol_uid=p.kol_uid OR (lower(owned.platform)=lower(p.platform)\n              AND NULLIF(owned.platform_creator_id,'')=NULLIF(p.platform_creator_id,''))))\n      ORDER BY p.ingested_at DESC, p.display_name",[companyId])).rows as Row[];
  return rows.map((row) => trimPrivate(publicProfileFields({
    ...row,
    public_stage: row.latest_release_reason === "ownership-release" ? "14天无回复" : row.public_stage,
  })));
}

/** Counts only unclaimed public-pool rows. Active follows are not cleanup candidates. */
export async function previewProfilesWithoutHomepage(companyId = memoryCompanyId(), db: DatabaseConnection = getConn()): Promise<Awaited<Json>> {
  const candidate = (await db.query("SELECT COUNT(*) AS count\n       FROM kol_profile_index p\n      WHERE p.company_id=$1\n        AND p.pool_status='open'\n        AND trim(COALESCE(p.homepage_url,''))=''\n        AND NOT EXISTS (\n          SELECT 1 FROM kol_follow_index f\n           WHERE f.company_id=p.company_id AND f.kol_uid=p.kol_uid AND f.status='active'\n        )",[companyId])).rows[0] as { count?: number } | undefined;
  const protectedRows = (await db.query("SELECT COUNT(*) AS count\n       FROM kol_profile_index p\n      WHERE p.company_id=$1\n        AND trim(COALESCE(p.homepage_url,''))=''\n        AND EXISTS (\n          SELECT 1 FROM kol_follow_index f\n           WHERE f.company_id=p.company_id AND f.kol_uid=p.kol_uid AND f.status='active'\n        )",[companyId])).rows[0] as { count?: number } | undefined;
  return {
    scope: "public_pool_only",
    candidate_count: Number(candidate?.count || 0),
    protected_active_follows: Number(protectedRows?.count || 0),
  };
}

/**
 * Irreversibly removes only unclaimed public-pool profiles with no homepage.
 * The caller must re-submit the preview count so a stale preview cannot delete
 * a different set of records.
 */
export async function deleteProfilesWithoutHomepage(input: {
  expectedCount: number;
  confirm: boolean;
  companyId?: string;
  actor?: string;
}): Promise<Awaited<Json>> {
  if (!input.confirm) {
    throw new HttpFail(422, { code: "cleanup_confirmation_required", message: "清理无主页档案需要明确确认。" });
  }
  const expected = Number(input.expectedCount);
  if (!Number.isInteger(expected) || expected < 0) {
    throw new HttpFail(400, { code: "cleanup_expected_count_required", message: "需要有效的 expected_count。" });
  }
  const companyId = input.companyId || memoryCompanyId();
  const deleted = (await tx(async (db) => {
    const current = (await db.query("SELECT COUNT(*) AS count\n         FROM kol_profile_index p\n        WHERE p.company_id=$1\n          AND p.pool_status='open'\n          AND trim(COALESCE(p.homepage_url,''))=''\n          AND NOT EXISTS (\n            SELECT 1 FROM kol_follow_index f\n             WHERE f.company_id=p.company_id AND f.kol_uid=p.kol_uid AND f.status='active'\n          )",[companyId])).rows[0] as { count?: number } | undefined;
    const actual = Number(current?.count || 0);
    if (actual !== expected) {
      throw new HttpFail(409, {
        code: "cleanup_preview_changed",
        message: "无主页档案数量已变化，请重新预览后确认。",
        expected_count: expected,
        actual_count: actual,
      });
    }
    return Number(((await db.query("DELETE FROM kol_profile_index\n        WHERE company_id=$1\n          AND pool_status='open'\n          AND trim(COALESCE(homepage_url,''))=''\n          AND NOT EXISTS (\n            SELECT 1 FROM kol_follow_index f\n             WHERE f.company_id=kol_profile_index.company_id\n               AND f.kol_uid=kol_profile_index.kol_uid\n               AND f.status='active'\n          )",[companyId])).rowCount ?? 0) || 0);
  }));
  (await audit(input.actor || "system", "kol.memory.cleanup_missing_homepage", {
    scope: "public_pool_only",
    expected_count: expected,
    deleted,
  }));
  return { ok: true, scope: "public_pool_only", deleted, ...(previewProfilesWithoutHomepage(companyId)) };
}

/** 一条 IN 查询最多绑多少个 id：远低于 SQLite 的变量上限，只是给超长名单留安全余量。 */
const THREAD_ID_BATCH = 400;

function idBatches(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += THREAD_ID_BATCH) {
    batches.push(ids.slice(index, index + THREAD_ID_BATCH));
  }
  return batches;
}

/**
 * 跟进名单的线程记忆按批取回。逐人查（每人 2 条 SQL）在 200+ 人在跟时要跑 400+ 次查询，
 * 把首屏读取窗口拖长；这里最多查两次再分组。合并口径与逐人版本逐字一致。
 */
function followedThreadMemoryByFollow(follows: Row[], db: DatabaseConnection): Map<string, Json[]> {
  const summariesByFollow = new Map<string, Row[]>();
  const threadsByCollaboration = new Map<string, Row[]>();
  const followIds = [...new Set(follows.map((follow) => text(follow.id)).filter(Boolean))];
  const collaborationIds = [...new Set(follows.map((follow) => text(follow.collaboration_id)).filter(Boolean))];
  for (const batch of idBatches(followIds)) {
    const rows = db.prepare(
      `SELECT follow_id, conversation_id, subject, last_at, effective, key_agreements, open_questions, next_step, updated_at
         FROM kol_thread_summary
        WHERE follow_id IN (${batch.map(() => "?").join(",")})
        ORDER BY CASE WHEN last_at IS NULL OR last_at='' THEN 1 ELSE 0 END, last_at DESC, updated_at DESC`,
    ).all(...batch) as Row[];
    for (const row of rows) {
      const key = text(row.follow_id);
      summariesByFollow.set(key, [...(summariesByFollow.get(key) || []), row]);
    }
  }
  for (const batch of idBatches(collaborationIds)) {
    const rows = db.prepare(
      `SELECT collaboration_id, conversation_id, subject, last_direction, last_snippet, last_preview, last_at, unread_count
         FROM kol_mail_threads
        WHERE collaboration_id IN (${batch.map(() => "?").join(",")})
        ORDER BY CASE WHEN last_at IS NULL OR last_at='' THEN 1 ELSE 0 END, last_at DESC, updated_at DESC`,
    ).all(...batch) as Row[];
    for (const row of rows) {
      const key = text(row.collaboration_id);
      threadsByCollaboration.set(key, [...(threadsByCollaboration.get(key) || []), row]);
    }
  }
  return new Map(follows.map((follow) => [
    text(follow.id),
    mergeFollowThreadMemory(
      summariesByFollow.get(text(follow.id)) || [],
      threadsByCollaboration.get(text(follow.collaboration_id)) || [],
    ),
  ]));
}

function mergeFollowThreadMemory(summaries: Row[], threadRows: Row[]): Json[] {
  const byConversation = new Map<string, Json>();
  for (const row of summaries) {
    const conversationId = text(row.conversation_id);
    if (!conversationId) continue;
    const summary = mailPreview(text(row.key_agreements) || text(row.next_step) || text(row.open_questions) || text(row.subject));
    byConversation.set(conversationId, {
      conversation_id: conversationId,
      subject: text(row.subject),
      last_direction: "",
      last_snippet: summary,
      last_at: text(row.last_at) || null,
      unread_count: 0,
      effective: Number(row.effective || 0),
    });
  }
  for (const row of threadRows) {
    const conversationId = text(row.conversation_id);
    if (!conversationId) continue;
    const existing = byConversation.get(conversationId) || {};
    byConversation.set(conversationId, {
      ...existing,
      conversation_id: conversationId,
      subject: text(row.subject) || text(existing.subject),
      last_direction: text(row.last_direction),
      last_snippet: mailPreview(text(row.last_preview) || text(row.last_snippet)) || text(existing.last_snippet),
      last_at: text(row.last_at) || existing.last_at || null,
      unread_count: Number(row.unread_count || 0),
    });
  }
  return [...byConversation.values()].sort((left, right) => {
    const leftAt = Date.parse(String(left.last_at || "")) || 0;
    const rightAt = Date.parse(String(right.last_at || "")) || 0;
    return rightAt - leftAt;
  });
}

function followStage(row: Row): { code: string; label: string; days: number | null } {
  const raw = text(row.collaboration_stage_code) || text(row.public_stage);
  const code = codeFromLabel(raw) || "";
  const days = row.days_in_stage == null || row.days_in_stage === "" ? null : Number(row.days_in_stage);
  return {
    code,
    label: code ? stageLabel(code) : raw || "跟进中",
    days: Number.isFinite(days) ? days : null,
  };
}

function refusalIn(value: string): boolean {
  return /拒绝|拒信|REJECTED|not interested|no longer/i.test(value);
}

/**
 * The following endpoint is the employee's local, read-only history projection.
 * It combines B ownership, the C thread summary index, and locally synchronized
 * mail threads; it never calls Starry, creates a session, or invokes a model.
 */
export async function listEmployeeFollowing(employeeId: string, companyId = memoryCompanyId(), db: DatabaseConnection = getConn()): Promise<Awaited<Json[]>> {
  const rows = (await db.query("SELECT f.*, p.handle, p.display_name, p.platform, p.homepage_url, p.avatar_url, p.followers,\n            p.avg_plays, p.engagement, p.engagement_source, p.direction, p.region, p.style,\n            p.ingest_source, p.ingested_at, p.public_stage, p.idle, p.pool_status,\n            p.potential_score, p.potential_probabilities, p.potential_confidence,\n            p.risk_score, p.risk_probabilities, p.risk_confidence,\n            p.assessment_model, p.assessment_version, p.assessed_at, p.assessment_error, p.assessment_criteria,\n            c.stage_code AS collaboration_stage_code, c.days_in_stage AS days_in_stage\n       FROM kol_follow_index f\n       LEFT JOIN kol_profile_index p\n         ON p.company_id=f.company_id AND p.kol_uid=f.kol_uid\n       LEFT JOIN collaborations c\n         ON c.id=f.collaboration_id\n      WHERE f.company_id=$1 AND f.employee_id=$2 AND f.status='active'\n      ORDER BY f.claimed_at DESC",[companyId,employeeId])).rows as Row[];
  const threadsByFollow = followedThreadMemoryByFollow(rows, db);
  return rows.map((row) => {
    const clock = followClock(row.last_effective_mail_at ? String(row.last_effective_mail_at) : null);
    const stage = followStage(row);
    const mailThreads = threadsByFollow.get(text(row.id)) || [];
    const latest = mailThreads[0] as Row | undefined;
    const summary = text(latest?.last_snippet) || (clock.countdown ? "已有有效往来" : "尚未有效往来");
    const refused = refusalIn(`${stage.code} ${stage.label} ${summary}`);
    const interested = /INTERESTED|有兴趣|有意向/i.test(`${stage.code} ${stage.label}`);
    const near = clock.days_since_interaction != null && clock.days_since_interaction >= 11;
    const riskChips: Json[] = [
      ...(refused ? [{ id: "refused", label: "拒信" }] : []),
      ...(near ? [{ id: "near-14d", label: "临近14日" }] : []),
      ...(interested ? [{ id: "interested", label: "有兴趣" }] : []),
    ];
    return trimPrivate({
      ...publicProfileFields(row),
      follow_id: row.id,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      scope_brand: row.scope_brand,
      status: row.status,
      claimed_at: row.claimed_at,
      collaboration_id: row.collaboration_id || null,
      ...clock,
      last_interaction_at: clock.last_effective_mail_at,
      identity: {
        display: text(row.handle) ? `@${text(row.handle)}` : text(row.display_name) || "未指定红人",
        platform: text(row.platform),
      },
      stage: { code: stage.code, label: stage.label },
      dwell: { days: stage.days },
      product: text(row.product || row.sku || row.product_name) || null,
      latest_correspondence: {
        valid: Boolean(latest) || clock.countdown,
        summary,
        at: text(latest?.last_at) || clock.last_effective_mail_at || null,
        thread_id: text(latest?.conversation_id),
        refused,
      },
      clock_14d: {
        ...clock,
        days_remaining: clock.days_since_interaction == null ? null : Math.max(0, FOLLOW_IDLE_DAYS - clock.days_since_interaction),
        release_scheduler: false,
        label: clock.countdown ? "14 日跟进" : "尚未有效往来",
        near,
      },
      risk: { chips: riskChips, refused, exception: false, high_risk: refused },
      brief_priority: refused ? "refused" : near ? "near_14d" : interested ? "interested" : "other",
      mail_threads: mailThreads,
      unread_count: mailThreads.reduce((total, thread) => total + Number(thread.unread_count || 0), 0),
    });
  });
}

async function dualWriteOwner(db: DatabaseConnection, input: {
  kol_uid: string;
  scope_brand: string;
  owner_name: string | null;
  employee_id?: string;
}): Promise<Awaited<void>> {
  const existing = (await db.query("SELECT id, stage_code FROM collaborations WHERE kol_uid=$1 AND (brand=$2 OR brand='')",[input.kol_uid,input.scope_brand])).rows as Row[];
  const fallback = existing.length
    ? existing
    : (await db.query("SELECT id, stage_code FROM collaborations WHERE kol_uid=$1",[input.kol_uid])).rows as Row[];
  for (const row of fallback) {
    (await db.query("UPDATE collaborations SET owner_name=$1 WHERE id=$2",[input.owner_name,row.id]));
  }
}

async function collaborationIdFor(db: DatabaseConnection, kolUid: string, scopeBrand: string): Promise<Awaited<string | null>> {
  const row = (await db.query("SELECT id FROM collaborations WHERE kol_uid=$1 AND brand=$2 LIMIT 1",[kolUid,scopeBrand])).rows[0] as { id?: string } | undefined;
  if (row?.id) return String(row.id);
  const any = (await db.query("SELECT id FROM collaborations WHERE kol_uid=$1 LIMIT 1",[kolUid])).rows[0] as { id?: string } | undefined;
  return any?.id ? String(any.id) : null;
}

export async function claimFollow(input: {
  kolUid: string;
  scopeBrand?: string;
  confirm?: boolean;
  actor?: MemoryEmployee;
}): Promise<Awaited<Json>> {
  if (!input.confirm) {
    throw new HttpFail(422, {
      code: "l3_confirm_required",
      message: "领取公海正式档案需要 L3 确认",
      risk: "L3",
    });
  }
  const actor = input.actor || (await currentMemoryEmployee());
  const companyId = memoryCompanyId();
  const kolUid = text(input.kolUid);
  const scopeBrand = (await resolveScopeBrand(input.scopeBrand, actor));
  return tx(async (db) => {
    const profile = (await getProfile(kolUid, companyId, db));
    if (!profile) {
      throw new HttpFail(404, {
        code: "profile_not_in_index",
        message: "档案不在公海索引中，不能领取",
        kol_uid: kolUid,
      });
    }
    const existing = (await activeFollow({ company_id: companyId, kol_uid: kolUid, scope_brand: scopeBrand }, db));
    if (existing) {
      if (String(existing.employee_id) === actor.id) {
        return {
          ok: true,
          reused: true,
          created: false,
          follow: (await listEmployeeFollowing(actor.id, companyId, db)).find((row) => row.follow_id === existing.id),
        };
      }
      throw new HttpFail(409, {
        code: "follow_conflict",
        message: "该红人已有有效跟进关系",
        kol_uid: kolUid,
        scope_brand: scopeBrand,
        employee_id: existing.employee_id,
        follow_id: existing.id,
      });
    }
    const now = nowIso();
    const followId = nid("kfi");
    const collaborationId = (await collaborationIdFor(db, kolUid, scopeBrand));
    try {
      (await db.query("INSERT INTO kol_follow_index\n         (id,company_id,kol_uid,scope_brand,employee_id,employee_name,status,claimed_at,\n          last_effective_mail_at,release_due_at,collaboration_id,data_version,created_at,updated_at)\n         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",[followId,companyId,kolUid,scopeBrand,actor.id,actor.name,"active",now,null,null,collaborationId,1,now,now]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|kol_follow_index_active_uniq|discovery_follow_conflict/i.test(message)) {
        throw new HttpFail(409, {
          code: "follow_conflict",
          message: "该红人已有有效跟进关系",
          kol_uid: kolUid,
          scope_brand: scopeBrand,
        });
      }
      throw error;
    }
    (await db.query("UPDATE kol_profile_index SET pool_status='claimed', idle=0, updated_at=$1 WHERE company_id=$2 AND kol_uid=$3",[now,companyId,kolUid]));
    (await dualWriteOwner(db, { kol_uid: kolUid, scope_brand: scopeBrand, owner_name: actor.name, employee_id: actor.id }));
    (await audit(actor.id, "kol.claim", {
      follow_id: followId,
      kol_uid: kolUid,
      scope_brand: scopeBrand,
      claimed_at_not_effective: true,
      last_effective_mail_at: null,
    }));
    return {
      ok: true,
      reused: false,
      created: true,
      follow: (await listEmployeeFollowing(actor.id, companyId, db)).find((row) => row.follow_id === followId),
    };
  });
}

export async function releaseFollow(input: {
  followId: string;
  confirm?: boolean;
  reason?: string;
  actor?: MemoryEmployee;
}): Promise<Awaited<Json>> {
  if (!input.confirm) {
    throw new HttpFail(422, {
      code: "l3_confirm_required",
      message: "释放跟进需要 L3 确认",
      risk: "L3",
    });
  }
  const actor = input.actor || (await currentMemoryEmployee());
  return tx(async (db) => {
    const follow = (await followById(input.followId, db));
    if (!follow || follow.status !== "active") {
      throw new HttpFail(404, { code: "follow_not_found", message: "跟进关系不存在或已释放" });
    }
    if (String(follow.employee_id) !== actor.id && !authDisabled()) {
      const user = scopedUser();
      if (user && !user.roles.includes("admin")) {
        throw new HttpFail(403, { code: "not_follow_owner", message: "只能释放自己的跟进" });
      }
    }
    return applyFollowRelease(db, follow, actor.id, input.reason || "manual_release");
  });
}

export async function applyFollowRelease(
  db: DatabaseConnection,
  follow: Row,
  actor: string,
  reason: string,
): Promise<Awaited<Json>> {
  const now = nowIso();
  const stageBefore = (await db.query("SELECT stage_code FROM collaborations WHERE kol_uid=$1 LIMIT 1",[follow.kol_uid])).rows[0] as { stage_code?: string } | undefined;
  const changed = (await db.query("UPDATE kol_follow_index\n        SET status='released', released_at=$1, release_reason=$2, updated_at=$3, data_version=data_version+1\n      WHERE id=$4 AND status='active'",[now,reason,now,follow.id]));
  if (!(changed.rowCount ?? 0)) {
    return { ok: false, action: "skip", reason: "already_released", follow_id: follow.id };
  }
  (await db.query("UPDATE kol_profile_index\n        SET pool_status='open', idle=1, updated_at=$1\n      WHERE company_id=$2 AND kol_uid=$3",[now,follow.company_id,follow.kol_uid]));
  (await dualWriteOwner(db, {
    kol_uid: String(follow.kol_uid),
    scope_brand: String(follow.scope_brand),
    owner_name: null,
  }));
  const stageAfter = (await db.query("SELECT stage_code FROM collaborations WHERE kol_uid=$1 LIMIT 1",[follow.kol_uid])).rows[0] as { stage_code?: string } | undefined;
  (await audit(actor, "kol.release", {
    follow_id: follow.id,
    kol_uid: follow.kol_uid,
    reason,
    stage_unchanged: stageBefore?.stage_code || stageAfter?.stage_code || null,
  }));
  return {
    ok: true,
    action: "release",
    follow_id: follow.id,
    kol_uid: follow.kol_uid,
    stage_unchanged: stageAfter?.stage_code ?? stageBefore?.stage_code ?? null,
  };
}

export async function recordEffectiveCorrespondence(input: {
  kolUid?: string;
  followId?: string;
  companyId?: string;
  scopeBrand?: string;
  collaborationId?: string;
  direction?: string;
  occurredAt?: string;
  gatewaySuccess?: boolean;
  kind?: string;
  subject?: string;
  body?: string;
  from?: string;
  status?: string;
}): Promise<Awaited<{ renewed: boolean; effective: boolean; reason: string; follow_id?: string }>> {
  const effective = isEffectiveCorrespondence(input);
  if (!effective) {
    return { renewed: false, effective: false, reason: classifyCorrespondenceKind(input) };
  }
  const companyId = text(input.companyId) || memoryCompanyId();
  const db = getConn();
  let follow: Row | undefined;
  if (input.followId) follow = (await followById(input.followId, db));
  if (!follow && input.kolUid) {
    const brand = text(input.scopeBrand);
    follow = brand
      ? (await activeFollow({ company_id: companyId, kol_uid: text(input.kolUid), scope_brand: brand }, db))
      : (await db.query("SELECT * FROM kol_follow_index WHERE company_id=$1 AND kol_uid=$2 AND status='active' ORDER BY claimed_at DESC LIMIT 1",[companyId,text(input.kolUid)])).rows[0] as Row | undefined;
  }
  if (!follow && input.collaborationId) {
    follow = (await db.query("SELECT * FROM kol_follow_index WHERE collaboration_id=$1 AND status='active' LIMIT 1",[input.collaborationId])).rows[0] as Row | undefined;
  }
  if (!follow) {
    return { renewed: false, effective: true, reason: "no_active_follow" };
  }
  const rawOccurredAt = text(input.occurredAt);
  if (!rawOccurredAt) {
    // A synchronized message without an event time is evidence of neither a
    // newer interaction nor inactivity. Gateway sends supply their receipt
    // time explicitly, so do not substitute this process's receive time here.
    return { renewed: false, effective: true, reason: "occurred_at_missing", follow_id: String(follow.id) };
  }
  const occurredAtMs = Date.parse(rawOccurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    return { renewed: false, effective: true, reason: "occurred_at_invalid", follow_id: String(follow.id) };
  }
  const clock = followClock(new Date(occurredAtMs).toISOString());
  const changed = (await db.query("UPDATE kol_follow_index\n        SET last_effective_mail_at=$1, release_due_at=$2, updated_at=$3, data_version=data_version+1\n      WHERE id=$4 AND status='active'\n        AND (last_effective_mail_at IS NULL OR trim(last_effective_mail_at)='' OR last_effective_mail_at<$5)",[clock.last_effective_mail_at,clock.release_due_at,nowIso(),follow.id,clock.last_effective_mail_at]));
  if (!(changed.rowCount ?? 0)) {
    return { renewed: false, effective: true, reason: "out_of_order", follow_id: String(follow.id) };
  }
  return { renewed: true, effective: true, reason: "human", follow_id: String(follow.id) };
}

/**
 * Incrementally persist one already-observed interaction into C. This is used by
 * the gateway send receipt and mailbox synchronizer, so the next GET
 * /api/home/following reads the updated local memory immediately. It is an
 * idempotent upsert keyed by (follow_id, conversation_id), never a remote call.
 */
export async function recordFollowedMailMemory(input: {
  kolUid?: string;
  followId?: string;
  companyId?: string;
  scopeBrand?: string;
  collaborationId?: string;
  conversationId?: string;
  subject?: string;
  summary?: string;
  body?: string;
  participants?: string;
  direction?: "inbound" | "outbound";
  occurredAt?: string;
  gatewaySuccess?: boolean;
  kind?: string;
  sourceVersion?: string;
}): Promise<Awaited<{ recorded: boolean; effective: boolean; follow_id?: string; conversation_id?: string }>> {
  const db = getConn();
  const companyId = text(input.companyId) || memoryCompanyId();
  let follow: Row | undefined;
  if (input.followId) follow = (await followById(input.followId, db));
  if (!follow && input.kolUid) {
    const brand = text(input.scopeBrand);
    follow = brand
      ? (await activeFollow({ company_id: companyId, kol_uid: text(input.kolUid), scope_brand: brand }, db))
      : (await db.query("SELECT * FROM kol_follow_index WHERE company_id=$1 AND kol_uid=$2 AND status='active' ORDER BY claimed_at DESC LIMIT 1",[companyId,text(input.kolUid)])).rows[0] as Row | undefined;
  }
  if (!follow && input.collaborationId) {
    follow = (await db.query("SELECT * FROM kol_follow_index WHERE collaboration_id=$1 AND status='active' LIMIT 1",[input.collaborationId])).rows[0] as Row | undefined;
  }
  if (!follow) return { recorded: false, effective: false };

  const occurredAt = text(input.occurredAt) || nowIso();
  const conversationId = text(input.conversationId) || `local:${text(input.direction) || "mail"}:${occurredAt}`;
  const summary = mailPreview(text(input.summary) || text(input.body) || text(input.subject));
  const effective = isEffectiveCorrespondence({
    gatewaySuccess: input.gatewaySuccess !== false,
    direction: input.direction || "inbound",
    kind: input.kind,
    subject: input.subject,
    body: input.body,
  });
  (await upsertThreadSummary({
    follow_id: String(follow.id),
    company_id: String(follow.company_id),
    kol_uid: String(follow.kol_uid),
    conversation_id: conversationId,
    subject: text(input.subject),
    participants: text(input.participants),
    last_at: occurredAt,
    effective: effective ? 1 : 0,
    key_agreements: summary,
    next_step: "",
    mail_refs: conversationId,
    source_version: text(input.sourceVersion) || "local.increment",
  }, db));
  return {
    recorded: true,
    effective,
    follow_id: String(follow.id),
    conversation_id: conversationId,
  };
}

export async function upsertThreadSummary(input: {
  follow_id: string;
  company_id?: string;
  kol_uid: string;
  conversation_id?: string;
  subject?: string;
  participants?: string;
  time_range?: string;
  last_at?: string;
  effective: 0 | 1;
  key_agreements?: string;
  open_questions?: string;
  next_step?: string;
  mail_refs?: string;
  source_version?: string;
}, db: DatabaseConnection = getConn()): Promise<Awaited<Row>> {
  const now = nowIso();
  const conversationId = text(input.conversation_id) || "unknown";
  const existing = (await db.query("SELECT * FROM kol_thread_summary WHERE follow_id=$1 AND conversation_id=$2",[input.follow_id,conversationId])).rows[0] as Row | undefined;
  const id = String(existing?.id || nid("kts"));
  if (existing) {
    (await db.query("UPDATE kol_thread_summary\n          SET subject=$1, participants=$2, time_range=$3, last_at=$4, effective=$5,\n              key_agreements=$6, open_questions=$7, next_step=$8, mail_refs=$9,\n              source_version=$10, updated_at=$11\n        WHERE id=$12",[text(input.subject),text(input.participants),text(input.time_range),text(input.last_at),input.effective,text(input.key_agreements),text(input.open_questions),text(input.next_step),text(input.mail_refs),text(input.source_version),now,id]));
  } else {
    (await db.query("INSERT INTO kol_thread_summary\n       (id,company_id,follow_id,kol_uid,conversation_id,subject,participants,time_range,\n        last_at,effective,key_agreements,open_questions,next_step,mail_refs,source_version,created_at,updated_at)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",[id,text(input.company_id) || memoryCompanyId(),input.follow_id,input.kol_uid,conversationId,text(input.subject),text(input.participants),text(input.time_range),text(input.last_at),input.effective,text(input.key_agreements),text(input.open_questions),text(input.next_step),text(input.mail_refs),text(input.source_version),now,now]));
  }
  return (await db.query("SELECT * FROM kol_thread_summary WHERE id=$1",[id])).rows[0] as Row;
}

export async function listActiveFollows(db: DatabaseConnection = getConn()): Promise<Awaited<Row[]>> {
  return (await db.query("SELECT * FROM kol_follow_index WHERE status='active' ORDER BY claimed_at",[])).rows as Row[];
}

export async function countKolAnalyzeInFlight(ownerUserId: string, db: DatabaseConnection = getConn()): Promise<Awaited<number>> {
  const row = (await db.query("SELECT COUNT(*) AS n FROM tickets\n      WHERE owner_user_id=$1 AND task_type=$2\n        AND status IN ('queued','running','pending','waiting')",[ownerUserId,KOL_ANALYZE_TASK_TYPE])).rows[0] as { n: number };
  return Number(row?.n || 0);
}

export function parseAnalyzePeople(body: Json): string[] {
  const raw = body.kol_uids ?? body.kolUids ?? body.people ?? body.handles ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return [...new Set(list.map((item) => text(item)).filter(Boolean))];
}

const VERB_TOKEN = /^[a-z][a-z0-9_]*$/;
const VERB_KEYS = [
  "verb", "action", "actions", "recommended_actions", "suggested_actions",
  "next_action", "next_actions",
];

export function isAllowedKolAnalyzeVerb(value: unknown): value is KolAnalyzeVerb {
  return (KOL_ANALYZE_VERBS as readonly string[]).includes(text(value));
}

function verbTokensFrom(value: unknown, into: Set<string>): void {
  if (value == null) return;
  if (typeof value === "string") {
    const token = text(value);
    if (VERB_TOKEN.test(token)) into.add(token);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) verbTokensFrom(entry, into);
    return;
  }
  if (typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  for (const key of VERB_KEYS) {
    if (key in row) verbTokensFrom(row[key], into);
  }
  if (typeof row.type === "string" && VERB_TOKEN.test(row.type) && row.type !== "task_result" && row.type !== "kol_analyze_brief") {
    into.add(row.type);
  }
  if (Array.isArray(row.items)) verbTokensFrom(row.items, into);
}

export function extractKolAnalyzeVerbs(payload: unknown): string[] {
  const into = new Set<string>();
  verbTokensFrom(payload, into);
  return [...into];
}

export function illegalKolAnalyzeVerbs(payload: unknown): string[] {
  return extractKolAnalyzeVerbs(payload).filter((verb) => !isAllowedKolAnalyzeVerb(verb));
}

export async function failKolAnalyzeIllegalVerb(workItemId: string | null | undefined, verbs: string[]): Promise<Awaited<Json>> {
  const now = nowIso();
  const illegal = [...new Set(verbs.map(text).filter(Boolean))];
  if (workItemId) {
    const db = getConn();
    (await db.query("UPDATE tickets SET status='failed',updated_at=$1,data_version=data_version+1 WHERE id=$2",[now,workItemId]));
    (await db.query("UPDATE task_runs\n          SET status='failed', error=$1, completed_at=COALESCE(completed_at,$2)\n        WHERE work_item_id=$3",[JSON.stringify({ code: "illegal_kol_analyze_verb", illegal_verbs: illegal, applied: false }),now,workItemId]));
  }
  (await audit("host", "kol.analyze.illegal_verb", {
    work_item_id: workItemId || null,
    illegal_verbs: illegal,
    applied: false,
  }));
  return {
    ok: false,
    applied: false,
    failed: true,
    code: "illegal_kol_analyze_verb",
    illegal_verbs: illegal,
    work_item_id: workItemId || null,
  };
}

export async function assertKolAnalyzeVerbsSafe(skill: string, payload: unknown, workItemId?: string | null): Promise<Awaited<void>> {
  if (skill !== KOL_ANALYZE_TASK_TYPE) return;
  const illegal = illegalKolAnalyzeVerbs(payload);
  if (!illegal.length) return;
  (await failKolAnalyzeIllegalVerb(workItemId, illegal));
  throw new HttpFail(422, {
    code: "illegal_kol_analyze_verb",
    message: `kol_analyze 不允许动词：${illegal.join(", ")}`,
    illegal_verbs: illegal,
    applied: false,
    work_item_id: workItemId || null,
  });
}

/** Runtime gate for a kol_analyze artifact or action payload. */
export async function enforceKolAnalyzeArtifact(workItemId: string | null | undefined, payload: unknown): Promise<Awaited<void>> {
  (await assertKolAnalyzeVerbsSafe(KOL_ANALYZE_TASK_TYPE, payload, workItemId));
}

/** Legal verbs stay suggestions. Illegal verbs fail the task and are not applied. */
export async function applyKolAnalyzeAction(input: {
  workItemId: string;
  verb?: string;
  action?: string;
  artifact?: Json;
}): Promise<Awaited<Json>> {
  const db = getConn();
  const item = (await db.query("SELECT * FROM tickets WHERE id=$1",[input.workItemId])).rows[0] as Row | undefined;
  if (!item) throw new HttpFail(404, { code: "task_not_found", message: "task not found" });
  if (String(item.task_type) !== KOL_ANALYZE_TASK_TYPE) {
    throw new HttpFail(409, { code: "not_kol_analyze", message: "only kol_analyze tasks enforce this verb whitelist" });
  }
  const payload = {
    verb: input.verb,
    action: input.action || input.verb,
    ...(input.artifact && typeof input.artifact === "object" ? input.artifact : {}),
  };
  const illegal = illegalKolAnalyzeVerbs(payload);
  if (illegal.length) {
    const failed = (await failKolAnalyzeIllegalVerb(String(item.id), illegal));
    throw new HttpFail(422, {
      ...failed,
      message: `kol_analyze 不允许动词：${illegal.join(", ")}`,
    });
  }
  const verb = text(input.verb || input.action) || "none";
  if (verb && !isAllowedKolAnalyzeVerb(verb) && VERB_TOKEN.test(verb)) {
    const failed = (await failKolAnalyzeIllegalVerb(String(item.id), [verb]));
    throw new HttpFail(422, {
      ...failed,
      message: `kol_analyze 不允许动词：${verb}`,
    });
  }
  (await audit("host", "kol.analyze.action.suggested", {
    work_item_id: item.id,
    verb,
    applied: false,
  }));
  return {
    ok: true,
    applied: false,
    failed: false,
    verb,
    work_item_id: item.id,
    status: item.status,
    note: "白名单动词仅可建议，须走独立 L3 命令；本任务未执行副作用",
  };
}
