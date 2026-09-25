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
import { audit, getConn, nowIso, txImmediate, type SqliteConn } from "../db.js";
import { nid } from "../ids.js";
import { codeFromLabel, label as stageLabel } from "../stages.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { mailPreview } from "./mail-preview.js";
import { currentUser } from "./persona.js";

export const DEFAULT_COMPANY_ID = "company:amperetime";
export const FOLLOW_IDLE_DAYS = 14;
export const KOL_ANALYZE_MAX_PEOPLE = 8;
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

export function currentMemoryEmployee(): MemoryEmployee {
  const user = scopedUser();
  if (user) {
    return { id: user.id, name: user.name, brands: [...(user.brands || [])] };
  }
  if (authDisabled()) {
    try {
      const persona = currentUser();
      return { id: persona.id, name: persona.name, brands: [...(persona.brands || [])] };
    } catch {
      return { id: DEMO_USER.id, name: DEMO_USER.name, brands: [...DEMO_USER.brands] };
    }
  }
  throw new HttpFail(401, "authentication required");
}

export function resolveScopeBrand(requested?: string, employee = currentMemoryEmployee()): string {
  const brand = String(requested || "").trim();
  if (brand) return brand;
  return employee.brands[0] || "LT";
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function publicProfileFields(row: Row | Json): Json {
  return {
    id: row.id,
    company_id: row.company_id,
    kol_uid: row.kol_uid,
    handle: row.handle || "",
    display_name: row.display_name || row.handle || "",
    platform: row.platform || "",
    homepage_url: row.homepage_url || "",
    avatar_url: row.avatar_url || "",
    followers: row.followers || "",
    avg_plays: row.avg_plays || "",
    engagement: row.engagement || "",
    direction: row.direction || "",
    region: row.region || "",
    style: row.style || "",
    ingest_source: row.ingest_source || "",
    ingested_at: row.ingested_at || null,
    idle: Boolean(Number(row.idle || 0)),
    public_stage: row.public_stage || "",
    pool_status: row.pool_status || "open",
    source_batch: row.source_batch || "",
    platform_creator_id: row.platform_creator_id || "",
    potential_score: row.potential_score ?? null,
    potential_confidence: row.potential_confidence ?? null,
    risk_score: row.risk_score ?? null,
    risk_confidence: row.risk_confidence ?? null,
    assessment_model: row.assessment_model || "",
    assessment_version: row.assessment_version || "",
    assessed_at: row.assessed_at || null,
  };
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

export function getProfile(kolUid: string, companyId = memoryCompanyId(), db: SqliteConn = getConn()): Row | undefined {
  return db.prepare(
    "SELECT * FROM kol_profile_index WHERE company_id=? AND kol_uid=?",
  ).get(companyId, text(kolUid)) as Row | undefined;
}

export function upsertPublicProfile(input: {
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
}, db: SqliteConn = getConn()): Row {
  const companyId = text(input.company_id) || memoryCompanyId();
  const kolUid = text(input.kol_uid);
  if (!kolUid) throw new HttpFail(400, { code: "kol_uid_required", message: "需要正式红人编号" });
  const now = nowIso();
  const existing = getProfile(kolUid, companyId, db);
  const id = String(existing?.id || nid("kpi"));
  db.prepare(
    `INSERT INTO kol_profile_index
     (id,company_id,kol_uid,handle,display_name,platform,homepage_url,avatar_url,followers,avg_plays,
      engagement,direction,region,style,ingest_source,ingested_at,public_stage,pool_status,
      idle,source_version,source_batch,platform_creator_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(company_id, kol_uid) DO UPDATE SET
       handle=COALESCE(NULLIF(excluded.handle,''), kol_profile_index.handle),
       display_name=COALESCE(NULLIF(excluded.display_name,''), kol_profile_index.display_name),
       platform=COALESCE(NULLIF(excluded.platform,''), kol_profile_index.platform),
       homepage_url=COALESCE(NULLIF(excluded.homepage_url,''), kol_profile_index.homepage_url),
       avatar_url=COALESCE(NULLIF(excluded.avatar_url,''), kol_profile_index.avatar_url),
       followers=COALESCE(NULLIF(excluded.followers,''), kol_profile_index.followers),
       avg_plays=COALESCE(NULLIF(excluded.avg_plays,''), kol_profile_index.avg_plays),
       engagement=COALESCE(NULLIF(excluded.engagement,''), kol_profile_index.engagement),
       direction=COALESCE(NULLIF(excluded.direction,''), kol_profile_index.direction),
       region=COALESCE(NULLIF(excluded.region,''), kol_profile_index.region),
       style=COALESCE(NULLIF(excluded.style,''), kol_profile_index.style),
       ingest_source=COALESCE(NULLIF(excluded.ingest_source,''), kol_profile_index.ingest_source),
       ingested_at=COALESCE(kol_profile_index.ingested_at, excluded.ingested_at),
       public_stage=COALESCE(NULLIF(excluded.public_stage,''), kol_profile_index.public_stage),
       source_version=COALESCE(excluded.source_version, kol_profile_index.source_version),
       source_batch=COALESCE(NULLIF(excluded.source_batch,''), kol_profile_index.source_batch),
       platform_creator_id=COALESCE(NULLIF(excluded.platform_creator_id,''), kol_profile_index.platform_creator_id),
       updated_at=excluded.updated_at`,
  ).run(
    id, companyId, kolUid,
    text(input.handle),
    text(input.display_name) || text(input.handle),
    text(input.platform),
    text(input.homepage_url),
    text(input.avatar_url),
    text(input.followers),
    text(input.avg_plays),
    text(input.engagement),
    text(input.direction),
    text(input.region),
    text(input.style),
    text(input.ingest_source) || "starry",
    existing?.ingested_at || input.ingested_at || now,
    text(input.public_stage),
    text(input.pool_status) || existing?.pool_status || "open",
    Number(input.idle ?? existing?.idle ?? 0),
    text(input.source_version),
    text(input.source_batch),
    text(input.platform_creator_id),
    existing?.created_at || now,
    now,
  );
  return getProfile(kolUid, companyId, db)!;
}

export function ingestFormalProfile(input: {
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
}): Row | null {
  const kolUid = text(input.kol_uid);
  if (!kolUid) return null;
  return upsertPublicProfile({
    ...input,
    ingest_source: input.ingest_source || "ingest",
    ingested_at: nowIso(),
  });
}

export function activeFollow(input: {
  company_id?: string;
  kol_uid: string;
  scope_brand: string;
}, db: SqliteConn = getConn()): Row | undefined {
  return db.prepare(
    `SELECT * FROM kol_follow_index
      WHERE company_id=? AND kol_uid=? AND scope_brand=? AND status='active'`,
  ).get(text(input.company_id) || memoryCompanyId(), text(input.kol_uid), text(input.scope_brand)) as Row | undefined;
}

export function followById(followId: string, db: SqliteConn = getConn()): Row | undefined {
  return db.prepare("SELECT * FROM kol_follow_index WHERE id=?").get(followId) as Row | undefined;
}

export function listOpenPool(companyId = memoryCompanyId(), db: SqliteConn = getConn()): Json[] {
  const rows = db.prepare(
    `SELECT * FROM kol_profile_index
      WHERE company_id=? AND pool_status='open'
      ORDER BY ingested_at DESC, display_name`,
  ).all(companyId) as Row[];
  return rows.map((row) => trimPrivate(publicProfileFields(row)));
}

/** Counts only unclaimed public-pool rows. Active follows are not cleanup candidates. */
export function previewProfilesWithoutHomepage(companyId = memoryCompanyId(), db: SqliteConn = getConn()): Json {
  const candidate = db.prepare(
    `SELECT COUNT(*) AS count
       FROM kol_profile_index p
      WHERE p.company_id=?
        AND p.pool_status='open'
        AND trim(COALESCE(p.homepage_url,''))=''
        AND NOT EXISTS (
          SELECT 1 FROM kol_follow_index f
           WHERE f.company_id=p.company_id AND f.kol_uid=p.kol_uid AND f.status='active'
        )`,
  ).get(companyId) as { count?: number } | undefined;
  const protectedRows = db.prepare(
    `SELECT COUNT(*) AS count
       FROM kol_profile_index p
      WHERE p.company_id=?
        AND trim(COALESCE(p.homepage_url,''))=''
        AND EXISTS (
          SELECT 1 FROM kol_follow_index f
           WHERE f.company_id=p.company_id AND f.kol_uid=p.kol_uid AND f.status='active'
        )`,
  ).get(companyId) as { count?: number } | undefined;
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
export function deleteProfilesWithoutHomepage(input: {
  expectedCount: number;
  confirm: boolean;
  companyId?: string;
  actor?: string;
}): Json {
  if (!input.confirm) {
    throw new HttpFail(422, { code: "cleanup_confirmation_required", message: "清理无主页档案需要明确确认。" });
  }
  const expected = Number(input.expectedCount);
  if (!Number.isInteger(expected) || expected < 0) {
    throw new HttpFail(400, { code: "cleanup_expected_count_required", message: "需要有效的 expected_count。" });
  }
  const companyId = input.companyId || memoryCompanyId();
  const deleted = txImmediate((db) => {
    const current = db.prepare(
      `SELECT COUNT(*) AS count
         FROM kol_profile_index p
        WHERE p.company_id=?
          AND p.pool_status='open'
          AND trim(COALESCE(p.homepage_url,''))=''
          AND NOT EXISTS (
            SELECT 1 FROM kol_follow_index f
             WHERE f.company_id=p.company_id AND f.kol_uid=p.kol_uid AND f.status='active'
          )`,
    ).get(companyId) as { count?: number } | undefined;
    const actual = Number(current?.count || 0);
    if (actual !== expected) {
      throw new HttpFail(409, {
        code: "cleanup_preview_changed",
        message: "无主页档案数量已变化，请重新预览后确认。",
        expected_count: expected,
        actual_count: actual,
      });
    }
    return Number(db.prepare(
      `DELETE FROM kol_profile_index
        WHERE company_id=?
          AND pool_status='open'
          AND trim(COALESCE(homepage_url,''))=''
          AND NOT EXISTS (
            SELECT 1 FROM kol_follow_index f
             WHERE f.company_id=kol_profile_index.company_id
               AND f.kol_uid=kol_profile_index.kol_uid
               AND f.status='active'
          )`,
    ).run(companyId).changes || 0);
  });
  audit(input.actor || "system", "kol.memory.cleanup_missing_homepage", {
    scope: "public_pool_only",
    expected_count: expected,
    deleted,
  });
  return { ok: true, scope: "public_pool_only", deleted, ...previewProfilesWithoutHomepage(companyId) };
}

function followedThreadMemory(follow: Row, db: SqliteConn): Json[] {
  const summaries = db.prepare(
    `SELECT conversation_id, subject, last_at, effective, key_agreements, open_questions, next_step, mail_refs, updated_at
       FROM kol_thread_summary
      WHERE follow_id=?
      ORDER BY CASE WHEN last_at IS NULL OR last_at='' THEN 1 ELSE 0 END, last_at DESC, updated_at DESC`,
  ).all(follow.id) as Row[];
  const threadRows = follow.collaboration_id
    ? db.prepare(
      `SELECT conversation_id, subject, last_direction, last_snippet, last_preview, last_at, unread_count
         FROM kol_mail_threads
        WHERE collaboration_id=?
        ORDER BY CASE WHEN last_at IS NULL OR last_at='' THEN 1 ELSE 0 END, last_at DESC, updated_at DESC`,
    ).all(follow.collaboration_id) as Row[]
    : [];
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
export function listEmployeeFollowing(employeeId: string, companyId = memoryCompanyId(), db: SqliteConn = getConn()): Json[] {
  const rows = db.prepare(
    `SELECT f.*, p.handle, p.display_name, p.platform, p.homepage_url, p.followers,
            p.avg_plays, p.engagement, p.direction, p.region, p.style,
            p.ingest_source, p.ingested_at, p.public_stage, p.idle, p.pool_status,
            c.stage_code AS collaboration_stage_code, c.days_in_stage AS days_in_stage
       FROM kol_follow_index f
       LEFT JOIN kol_profile_index p
         ON p.company_id=f.company_id AND p.kol_uid=f.kol_uid
       LEFT JOIN collaborations c
         ON c.id=f.collaboration_id
      WHERE f.company_id=? AND f.employee_id=? AND f.status='active'
      ORDER BY f.claimed_at DESC`,
  ).all(companyId, employeeId) as Row[];
  return rows.map((row) => {
    const clock = followClock(row.last_effective_mail_at ? String(row.last_effective_mail_at) : null);
    const stage = followStage(row);
    const mailThreads = followedThreadMemory(row, db);
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
        label: clock.countdown ? "14 日计时（只读）" : "尚未有效往来",
        near,
      },
      risk: { chips: riskChips, refused, exception: false, high_risk: refused },
      brief_priority: refused ? "refused" : near ? "near_14d" : interested ? "interested" : "other",
      mail_threads: mailThreads,
      unread_count: mailThreads.reduce((total, thread) => total + Number(thread.unread_count || 0), 0),
    });
  });
}

function dualWriteOwner(db: SqliteConn, input: {
  kol_uid: string;
  scope_brand: string;
  owner_name: string | null;
  employee_id?: string;
}): void {
  const existing = db.prepare(
    "SELECT id, stage_code FROM collaborations WHERE kol_uid=? AND (brand=? OR brand='')",
  ).all(input.kol_uid, input.scope_brand) as Row[];
  const fallback = existing.length
    ? existing
    : db.prepare("SELECT id, stage_code FROM collaborations WHERE kol_uid=?").all(input.kol_uid) as Row[];
  for (const row of fallback) {
    db.prepare("UPDATE collaborations SET owner_name=? WHERE id=?").run(input.owner_name, row.id);
  }
}

function collaborationIdFor(db: SqliteConn, kolUid: string, scopeBrand: string): string | null {
  const row = db.prepare(
    "SELECT id FROM collaborations WHERE kol_uid=? AND brand=? LIMIT 1",
  ).get(kolUid, scopeBrand) as { id?: string } | undefined;
  if (row?.id) return String(row.id);
  const any = db.prepare("SELECT id FROM collaborations WHERE kol_uid=? LIMIT 1").get(kolUid) as { id?: string } | undefined;
  return any?.id ? String(any.id) : null;
}

export function claimFollow(input: {
  kolUid: string;
  scopeBrand?: string;
  confirm?: boolean;
  actor?: MemoryEmployee;
}): Json {
  if (!input.confirm) {
    throw new HttpFail(422, {
      code: "l3_confirm_required",
      message: "领取公海正式档案需要 L3 确认",
      risk: "L3",
    });
  }
  const actor = input.actor || currentMemoryEmployee();
  const companyId = memoryCompanyId();
  const kolUid = text(input.kolUid);
  const scopeBrand = resolveScopeBrand(input.scopeBrand, actor);
  return txImmediate((db) => {
    const profile = getProfile(kolUid, companyId, db);
    if (!profile) {
      throw new HttpFail(404, {
        code: "profile_not_in_index",
        message: "档案不在公海索引中，不能领取",
        kol_uid: kolUid,
      });
    }
    const existing = activeFollow({ company_id: companyId, kol_uid: kolUid, scope_brand: scopeBrand }, db);
    if (existing) {
      if (String(existing.employee_id) === actor.id) {
        return {
          ok: true,
          reused: true,
          created: false,
          follow: listEmployeeFollowing(actor.id, companyId, db).find((row) => row.follow_id === existing.id),
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
    const collaborationId = collaborationIdFor(db, kolUid, scopeBrand);
    try {
      db.prepare(
        `INSERT INTO kol_follow_index
         (id,company_id,kol_uid,scope_brand,employee_id,employee_name,status,claimed_at,
          last_effective_mail_at,release_due_at,collaboration_id,data_version,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        followId, companyId, kolUid, scopeBrand, actor.id, actor.name, "active", now,
        null, null, collaborationId, 1, now, now,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|kol_follow_index_active_uniq/i.test(message)) {
        throw new HttpFail(409, {
          code: "follow_conflict",
          message: "该红人已有有效跟进关系",
          kol_uid: kolUid,
          scope_brand: scopeBrand,
        });
      }
      throw error;
    }
    db.prepare(
      "UPDATE kol_profile_index SET pool_status='claimed', idle=0, updated_at=? WHERE company_id=? AND kol_uid=?",
    ).run(now, companyId, kolUid);
    dualWriteOwner(db, { kol_uid: kolUid, scope_brand: scopeBrand, owner_name: actor.name, employee_id: actor.id });
    audit(actor.id, "kol.claim", {
      follow_id: followId,
      kol_uid: kolUid,
      scope_brand: scopeBrand,
      claimed_at_not_effective: true,
      last_effective_mail_at: null,
    });
    return {
      ok: true,
      reused: false,
      created: true,
      follow: listEmployeeFollowing(actor.id, companyId, db).find((row) => row.follow_id === followId),
    };
  });
}

export function releaseFollow(input: {
  followId: string;
  confirm?: boolean;
  reason?: string;
  actor?: MemoryEmployee;
}): Json {
  if (!input.confirm) {
    throw new HttpFail(422, {
      code: "l3_confirm_required",
      message: "释放跟进需要 L3 确认",
      risk: "L3",
    });
  }
  const actor = input.actor || currentMemoryEmployee();
  return txImmediate((db) => {
    const follow = followById(input.followId, db);
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

export function applyFollowRelease(
  db: SqliteConn,
  follow: Row,
  actor: string,
  reason: string,
): Json {
  const now = nowIso();
  const stageBefore = db.prepare(
    "SELECT stage_code FROM collaborations WHERE kol_uid=? LIMIT 1",
  ).get(follow.kol_uid) as { stage_code?: string } | undefined;
  const changed = db.prepare(
    `UPDATE kol_follow_index
        SET status='released', released_at=?, release_reason=?, updated_at=?, data_version=data_version+1
      WHERE id=? AND status='active'`,
  ).run(now, reason, now, follow.id);
  if (!changed.changes) {
    return { ok: false, action: "skip", reason: "already_released", follow_id: follow.id };
  }
  db.prepare(
    `UPDATE kol_profile_index
        SET pool_status='open', idle=1, updated_at=?
      WHERE company_id=? AND kol_uid=?`,
  ).run(now, follow.company_id, follow.kol_uid);
  dualWriteOwner(db, {
    kol_uid: String(follow.kol_uid),
    scope_brand: String(follow.scope_brand),
    owner_name: null,
  });
  const stageAfter = db.prepare(
    "SELECT stage_code FROM collaborations WHERE kol_uid=? LIMIT 1",
  ).get(follow.kol_uid) as { stage_code?: string } | undefined;
  audit(actor, "kol.release", {
    follow_id: follow.id,
    kol_uid: follow.kol_uid,
    reason,
    stage_unchanged: stageBefore?.stage_code || stageAfter?.stage_code || null,
  });
  return {
    ok: true,
    action: "release",
    follow_id: follow.id,
    kol_uid: follow.kol_uid,
    stage_unchanged: stageAfter?.stage_code ?? stageBefore?.stage_code ?? null,
  };
}

export function recordEffectiveCorrespondence(input: {
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
}): { renewed: boolean; effective: boolean; reason: string; follow_id?: string } {
  const effective = isEffectiveCorrespondence(input);
  if (!effective) {
    return { renewed: false, effective: false, reason: classifyCorrespondenceKind(input) };
  }
  const companyId = text(input.companyId) || memoryCompanyId();
  const db = getConn();
  let follow: Row | undefined;
  if (input.followId) follow = followById(input.followId, db);
  if (!follow && input.kolUid) {
    const brand = text(input.scopeBrand);
    follow = brand
      ? activeFollow({ company_id: companyId, kol_uid: text(input.kolUid), scope_brand: brand }, db)
      : db.prepare(
        `SELECT * FROM kol_follow_index WHERE company_id=? AND kol_uid=? AND status='active' ORDER BY claimed_at DESC LIMIT 1`,
      ).get(companyId, text(input.kolUid)) as Row | undefined;
  }
  if (!follow && input.collaborationId) {
    follow = db.prepare(
      "SELECT * FROM kol_follow_index WHERE collaboration_id=? AND status='active' LIMIT 1",
    ).get(input.collaborationId) as Row | undefined;
  }
  if (!follow) {
    return { renewed: false, effective: true, reason: "no_active_follow" };
  }
  const occurredAt = text(input.occurredAt) || nowIso();
  const clock = followClock(occurredAt);
  db.prepare(
    `UPDATE kol_follow_index
        SET last_effective_mail_at=?, release_due_at=?, updated_at=?, data_version=data_version+1
      WHERE id=? AND status='active'`,
  ).run(clock.last_effective_mail_at, clock.release_due_at, nowIso(), follow.id);
  return { renewed: true, effective: true, reason: "human", follow_id: String(follow.id) };
}

/**
 * Incrementally persist one already-observed interaction into C. This is used by
 * the gateway send receipt and mailbox synchronizer, so the next GET
 * /api/home/following reads the updated local memory immediately. It is an
 * idempotent upsert keyed by (follow_id, conversation_id), never a remote call.
 */
export function recordFollowedMailMemory(input: {
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
}): { recorded: boolean; effective: boolean; follow_id?: string; conversation_id?: string } {
  const db = getConn();
  const companyId = text(input.companyId) || memoryCompanyId();
  let follow: Row | undefined;
  if (input.followId) follow = followById(input.followId, db);
  if (!follow && input.kolUid) {
    const brand = text(input.scopeBrand);
    follow = brand
      ? activeFollow({ company_id: companyId, kol_uid: text(input.kolUid), scope_brand: brand }, db)
      : db.prepare(
        `SELECT * FROM kol_follow_index WHERE company_id=? AND kol_uid=? AND status='active' ORDER BY claimed_at DESC LIMIT 1`,
      ).get(companyId, text(input.kolUid)) as Row | undefined;
  }
  if (!follow && input.collaborationId) {
    follow = db.prepare(
      "SELECT * FROM kol_follow_index WHERE collaboration_id=? AND status='active' LIMIT 1",
    ).get(input.collaborationId) as Row | undefined;
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
  upsertThreadSummary({
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
  }, db);
  return {
    recorded: true,
    effective,
    follow_id: String(follow.id),
    conversation_id: conversationId,
  };
}

export function upsertThreadSummary(input: {
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
}, db: SqliteConn = getConn()): Row {
  const now = nowIso();
  const conversationId = text(input.conversation_id) || "unknown";
  const existing = db.prepare(
    "SELECT * FROM kol_thread_summary WHERE follow_id=? AND conversation_id=?",
  ).get(input.follow_id, conversationId) as Row | undefined;
  const id = String(existing?.id || nid("kts"));
  if (existing) {
    db.prepare(
      `UPDATE kol_thread_summary
          SET subject=?, participants=?, time_range=?, last_at=?, effective=?,
              key_agreements=?, open_questions=?, next_step=?, mail_refs=?,
              source_version=?, updated_at=?
        WHERE id=?`,
    ).run(
      text(input.subject), text(input.participants), text(input.time_range),
      text(input.last_at), input.effective, text(input.key_agreements),
      text(input.open_questions), text(input.next_step), text(input.mail_refs),
      text(input.source_version), now, id,
    );
  } else {
    db.prepare(
      `INSERT INTO kol_thread_summary
       (id,company_id,follow_id,kol_uid,conversation_id,subject,participants,time_range,
        last_at,effective,key_agreements,open_questions,next_step,mail_refs,source_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, text(input.company_id) || memoryCompanyId(), input.follow_id, input.kol_uid,
      conversationId, text(input.subject), text(input.participants), text(input.time_range),
      text(input.last_at), input.effective, text(input.key_agreements),
      text(input.open_questions), text(input.next_step), text(input.mail_refs),
      text(input.source_version), now, now,
    );
  }
  return db.prepare("SELECT * FROM kol_thread_summary WHERE id=?").get(id) as Row;
}

export function listActiveFollows(db: SqliteConn = getConn()): Row[] {
  return db.prepare(
    "SELECT * FROM kol_follow_index WHERE status='active' ORDER BY claimed_at",
  ).all() as Row[];
}

export function countKolAnalyzeInFlight(ownerUserId: string, db: SqliteConn = getConn()): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM work_items
      WHERE owner_user_id=? AND task_type=?
        AND status IN ('queued','running','pending','waiting')`,
  ).get(ownerUserId, KOL_ANALYZE_TASK_TYPE) as { n: number };
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

export function failKolAnalyzeIllegalVerb(workItemId: string | null | undefined, verbs: string[]): Json {
  const now = nowIso();
  const illegal = [...new Set(verbs.map(text).filter(Boolean))];
  if (workItemId) {
    const db = getConn();
    db.prepare(
      "UPDATE work_items SET status='failed',updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, workItemId);
    db.prepare(
      `UPDATE task_runs
          SET status='failed', error=?, completed_at=COALESCE(completed_at,?)
        WHERE work_item_id=?`,
    ).run(JSON.stringify({ code: "illegal_kol_analyze_verb", illegal_verbs: illegal, applied: false }), now, workItemId);
  }
  audit("host", "kol.analyze.illegal_verb", {
    work_item_id: workItemId || null,
    illegal_verbs: illegal,
    applied: false,
  });
  return {
    ok: false,
    applied: false,
    failed: true,
    code: "illegal_kol_analyze_verb",
    illegal_verbs: illegal,
    work_item_id: workItemId || null,
  };
}

export function assertKolAnalyzeVerbsSafe(skill: string, payload: unknown, workItemId?: string | null): void {
  if (skill !== KOL_ANALYZE_TASK_TYPE) return;
  const illegal = illegalKolAnalyzeVerbs(payload);
  if (!illegal.length) return;
  failKolAnalyzeIllegalVerb(workItemId, illegal);
  throw new HttpFail(422, {
    code: "illegal_kol_analyze_verb",
    message: `kol_analyze 不允许动词：${illegal.join(", ")}`,
    illegal_verbs: illegal,
    applied: false,
    work_item_id: workItemId || null,
  });
}

/** Runtime gate for a kol_analyze artifact or action payload. */
export function enforceKolAnalyzeArtifact(workItemId: string | null | undefined, payload: unknown): void {
  assertKolAnalyzeVerbsSafe(KOL_ANALYZE_TASK_TYPE, payload, workItemId);
}

/** Legal verbs stay suggestions. Illegal verbs fail the task and are not applied. */
export function applyKolAnalyzeAction(input: {
  workItemId: string;
  verb?: string;
  action?: string;
  artifact?: Json;
}): Json {
  const db = getConn();
  const item = db.prepare("SELECT * FROM work_items WHERE id=?").get(input.workItemId) as Row | undefined;
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
    const failed = failKolAnalyzeIllegalVerb(String(item.id), illegal);
    throw new HttpFail(422, {
      ...failed,
      message: `kol_analyze 不允许动词：${illegal.join(", ")}`,
    });
  }
  const verb = text(input.verb || input.action) || "none";
  if (verb && !isAllowedKolAnalyzeVerb(verb) && VERB_TOKEN.test(verb)) {
    const failed = failKolAnalyzeIllegalVerb(String(item.id), [verb]);
    throw new HttpFail(422, {
      ...failed,
      message: `kol_analyze 不允许动词：${verb}`,
    });
  }
  audit("host", "kol.analyze.action.suggested", {
    work_item_id: item.id,
    verb,
    applied: false,
  });
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
