/**
 * P0 employee workbench contract — aligned to PR #172 (A/B/C memory).
 * Pool cards: publicProfileFields only.
 * Follow cards: B.active ∩ self + followClock. No C thread on the list.
 */

export const KOL_SELECT_MAX = 8;
export const KOL_ANALYZE_MAX_IN_FLIGHT = 3;
export const KOL_ANALYZE_TASK_TYPE = "kol_analyze";
export const ANALYZE_QUEUED_COPY = "已入队，等待 Codex";
export const ANALYZE_PREFILL_PREFIX = "分析已选";
export const CLOCK_NONE_COPY = "尚未有效往来";
export const ANALYZE_IN_FLIGHT_STATUSES = ["queued", "running", "pending", "waiting"] as const;

export const POOL_BANNED_FIELDS = [
  "unread",
  "unread_count",
  "mail_digest",
  "mail_threads",
  "last_snippet",
  "quote",
  "notes",
  "release_due_at",
  "days_since_interaction",
  "clock_14d",
] as const;

export const FOLLOW_BANNED_DISCOVERY_FIELDS = [
  "followers",
  "avg_plays",
  "avg_views_10",
  "engagement",
  "engagement_rate",
  "match_score",
  "score",
  "direction",
  "style",
  "ingested_at",
] as const;

export type KolSurface = "pool" | "following";

export type PoolKol = {
  kol_uid: string;
  identity: {
    display: string;
    platform: string;
    profile_url?: string;
  };
  metrics: {
    followers?: string;
    avg_plays?: string;
    engagement?: string;
  };
  direction?: string;
  region?: string;
  style?: string;
  ingested_at?: string | null;
  idle?: { days?: number | null; idle?: boolean; label: string };
  public_stage?: { code?: string; label: string };
};

export type FollowCorrespondence = {
  valid: boolean;
  summary: string;
  at?: string | null;
  thread_id?: string;
  refused?: boolean;
};

export type FollowClock14d = {
  last_interaction_at?: string | null;
  last_effective_mail_at?: string | null;
  days_since_interaction?: number | null;
  days_remaining?: number | null;
  release_due_at?: string | null;
  countdown?: boolean;
  cron_eligible?: boolean;
  release_scheduler: false;
  label: string;
  near?: boolean;
};

export type FollowBriefPriority = "refused" | "near_14d" | "interested" | "other";

export type FollowKol = {
  kol_uid: string;
  follow_id?: string;
  collaboration_id?: string;
  identity: { display: string; platform: string };
  stage: { code: string; label: string };
  dwell?: { days?: number | null };
  latest_correspondence: FollowCorrespondence;
  clock_14d: FollowClock14d;
  risk: {
    chips: { id: string; label: string }[];
    refused?: boolean;
    exception?: boolean;
    high_risk?: boolean;
  };
  brief_priority: FollowBriefPriority;
};

export type KolAnalyzeEnqueueBody = {
  kol_uids: string[];
  title?: string;
  prompt?: string;
  surface?: KolSurface;
};

export type KolAnalyzeEnqueueResult = {
  work_item_id: string;
  session_id?: string | null;
  status: "queued" | "running" | "pending" | "waiting";
  queued_copy: string;
  entry?: string;
  creates_session: false;
  people?: string[];
  task_type?: string;
};

export type KolClaimResult = {
  ok?: boolean;
  reused?: boolean;
  created?: boolean;
  kol_uid: string;
  follow_id?: string;
  follow?: Record<string, unknown>;
  collaboration_id?: string;
  stage_unchanged?: boolean;
  sent?: false;
};

export type KolReleaseResult = {
  ok?: boolean;
  follow_id?: string;
  kol_uid?: string;
  stage_unchanged?: string | null;
};

function bare(value: unknown): string {
  return String(value || "").replace(/^@/, "").trim();
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function timeMs(value?: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? 0 : ms;
}

function flag(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0" || value == null || value === "") return false;
  return Boolean(value);
}

export function formatMetric(value: unknown): string {
  if (value == null || value === "") return "";
  const raw = String(value);
  if (/[万kK%]/.test(raw)) return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (n > 0 && n <= 1) return `${(n * 100).toFixed(1)}%`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}万`;
  return String(n);
}

export function profileUrlOf(row: Record<string, unknown>): string {
  const explicit = text(row.homepage_url || row.profile_url || row.platform_url || row.url);
  if (explicit) return explicit;
  const platform = text(row.platform).toLowerCase();
  const handle = bare(row.handle || row.kol_name || row.display_name || row.name);
  if (!handle) return "";
  if (platform === "youtube") return `https://www.youtube.com/@${handle}`;
  if (platform === "instagram") return `https://www.instagram.com/${handle}/`;
  if (platform === "facebook") return `https://www.facebook.com/${handle}`;
  return "";
}

export function isRefusedFollow(row: Record<string, unknown>): boolean {
  const stage = `${row.stage_code || ""} ${row.stage_label || ""} ${row.public_stage || ""}`;
  const notes = `${row.notes || ""} ${row.risk || ""}`;
  return /拒绝|拒信|REJECTED/i.test(`${stage} ${notes}`);
}

export function isInterestedFollow(row: Record<string, unknown>): boolean {
  const stage = `${row.stage_code || ""} ${row.stage_label || ""} ${row.public_stage || ""}`;
  return /INTERESTED|有兴趣|有意向/i.test(stage);
}

export function clockFromRow(row: Record<string, unknown>): FollowClock14d {
  const last = text(row.last_effective_mail_at || row.last_interaction_at) || null;
  const countdown = row.countdown == null ? Boolean(last) : flag(row.countdown);
  if (!countdown || !last) {
    return {
      last_interaction_at: null,
      last_effective_mail_at: null,
      days_since_interaction: null,
      days_remaining: null,
      release_due_at: null,
      countdown: false,
      cron_eligible: false,
      release_scheduler: false,
      label: CLOCK_NONE_COPY,
      near: false,
    };
  }
  const daysRaw = row.days_since_interaction;
  const days = daysRaw == null || daysRaw === ""
    ? Math.max(0, Math.floor((Date.now() - timeMs(last)) / 86_400_000))
    : Number(daysRaw);
  const due = text(row.release_due_at) || (Number.isFinite(Number(days))
    ? new Date(timeMs(last) + 14 * 86_400_000).toISOString()
    : "");
  const remaining = Number.isFinite(days) ? Math.max(0, 14 - days) : null;
  const near = remaining != null && remaining <= 3;
  return {
    last_interaction_at: last,
    last_effective_mail_at: last,
    days_since_interaction: Number.isFinite(Number(days)) ? Number(days) : null,
    days_remaining: remaining,
    release_due_at: due || null,
    countdown: true,
    cron_eligible: row.cron_eligible == null ? true : flag(row.cron_eligible),
    release_scheduler: false,
    label: remaining != null ? `14 日计时（只读）· 剩 ${remaining} 天` : "14 日计时（只读）",
    near,
  };
}

export function correspondenceFromRow(row: Record<string, unknown>, clock: FollowClock14d): FollowCorrespondence {
  const threads = Array.isArray(row.mail_threads) ? row.mail_threads as Array<Record<string, unknown>> : [];
  const thread = threads.find((item) => text(item.last_snippet) || text(item.subject)) || threads[0];
  const snippet = text(thread?.last_snippet || row.recent_followup || row.latest_correspondence);
  const refused = /拒绝|拒信|not interested|no longer/i.test(snippet) || isRefusedFollow(row);
  if (snippet) {
    return {
      valid: true,
      summary: snippet,
      at: text(thread?.last_at || clock.last_effective_mail_at) || null,
      thread_id: text(thread?.conversation_id),
      refused,
    };
  }
  if (clock.countdown) {
    return {
      valid: true,
      summary: "已有有效往来",
      at: clock.last_effective_mail_at || null,
      thread_id: "",
      refused,
    };
  }
  return { valid: false, summary: CLOCK_NONE_COPY, at: null, thread_id: "", refused };
}

export function briefPriorityOf(input: {
  refused?: boolean;
  near?: boolean;
  interested?: boolean;
}): FollowBriefPriority {
  if (input.refused) return "refused";
  if (input.near) return "near_14d";
  if (input.interested) return "interested";
  return "other";
}

export function sortByFollowedBriefPriority<T extends { brief_priority: FollowBriefPriority }>(rows: T[]): T[] {
  const rank: Record<FollowBriefPriority, number> = {
    refused: 0,
    near_14d: 1,
    interested: 2,
    other: 3,
  };
  return [...rows].sort((a, b) => rank[a.brief_priority] - rank[b.brief_priority]);
}

export function toPoolKol(row: Record<string, unknown>): PoolKol | null {
  const kolUid = text(row.kol_uid || row.creator_id || row.id);
  const handle = bare(row.handle || row.display_name || row.kol_name || row.name || row.identity);
  if (!kolUid && !handle) return null;
  const idleRaw = row.idle;
  const idleIsFlag = idleRaw === true || idleRaw === false || idleRaw === 0 || idleRaw === 1 || idleRaw === "0" || idleRaw === "1";
  const idleDays = row.idle_days == null || row.idle_days === ""
    ? (idleIsFlag || row.days_in_stage == null ? null : Number(row.days_in_stage))
    : Number(row.idle_days);
  const idleOn = idleIsFlag ? flag(idleRaw) : idleDays != null && Number.isFinite(idleDays) && idleDays > 0;
  const publicStage = text(row.public_stage_label || row.public_stage || row.stage_label) || "公海";
  return {
    kol_uid: kolUid || handle,
    identity: {
      display: handle ? `@${handle}` : text(row.display_name || row.name) || "未指定红人",
      platform: text(row.platform),
      profile_url: profileUrlOf(row),
    },
    metrics: {
      followers: formatMetric(row.followers ?? (row.metrics && (row.metrics as Record<string, unknown>).followers)),
      avg_plays: formatMetric(row.avg_plays || row.avg_views_10 || row.recent_views),
      engagement: formatMetric(row.engagement || row.engagement_rate),
    },
    direction: text(row.direction || row.niche),
    region: text(row.region || row.audience_geo),
    style: text(row.style),
    ingested_at: text(row.ingested_at || row.created_at || row.updated_at) || null,
    idle: {
      days: idleDays != null && Number.isFinite(idleDays) ? idleDays : null,
      idle: idleOn,
      label: idleDays != null && Number.isFinite(idleDays) ? `闲置 ${idleDays} 天` : (idleOn ? "闲置" : "在库"),
    },
    public_stage: {
      code: text(row.public_stage_code || row.stage_code) || "PUBLIC_POOL",
      label: publicStage,
    },
  };
}

export function toFollowKol(row: Record<string, unknown>): FollowKol | null {
  const identity = row.identity && typeof row.identity === "object" ? row.identity as Record<string, unknown> : null;
  const stage = row.stage && typeof row.stage === "object" ? row.stage as Record<string, unknown> : null;
  const handle = bare(row.handle || row.display_name || row.kol_name || identity?.display);
  const kolUid = text(row.kol_uid || row.id);
  if (!kolUid && !handle) return null;
  if (identity && stage && row.latest_correspondence && row.clock_14d && row.brief_priority) {
    return {
      kol_uid: kolUid || handle,
      follow_id: text(row.follow_id) || undefined,
      collaboration_id: text(row.collaboration_id) || undefined,
      identity: { display: text(identity.display) || (handle ? `@${handle}` : "未指定红人"), platform: text(identity.platform) },
      stage: { code: text(stage.code), label: text(stage.label) || "阶段未知" },
      dwell: row.dwell && typeof row.dwell === "object"
        ? { days: (row.dwell as { days?: number | null }).days ?? null }
        : { days: null },
      latest_correspondence: row.latest_correspondence as FollowCorrespondence,
      clock_14d: row.clock_14d as FollowClock14d,
      risk: (row.risk || { chips: [] }) as FollowKol["risk"],
      brief_priority: row.brief_priority as FollowBriefPriority,
    };
  }
  const clock = clockFromRow(row);
  const correspondence = correspondenceFromRow(row, clock);
  const refused = correspondence.refused || isRefusedFollow(row);
  const interested = isInterestedFollow(row);
  const exception = Boolean(row.exception) || /异常|争议/.test(`${row.stage_label || ""} ${row.public_stage || ""} ${row.notes || ""}`);
  const chips: { id: string; label: string }[] = [];
  if (refused) chips.push({ id: "refused", label: "拒信" });
  if (exception && !refused) chips.push({ id: "exception", label: "异常" });
  if (clock.near) chips.push({ id: "near-14d", label: "临近14日" });
  if (interested) chips.push({ id: "interested", label: "有兴趣" });
  const dwell = row.days_in_stage == null || row.days_in_stage === "" ? null : Number(row.days_in_stage);
  const publicStage = text(row.public_stage || row.stage_label);
  return {
    kol_uid: kolUid || handle,
    follow_id: text(row.follow_id) || undefined,
    collaboration_id: text(row.collaboration_id) || undefined,
    identity: {
      display: handle ? `@${handle}` : "未指定红人",
      platform: text(row.platform),
    },
    stage: {
      code: text(row.stage_code),
      label: publicStage || text(row.stage_label) || "跟进中",
    },
    dwell: { days: dwell != null && Number.isFinite(dwell) ? dwell : null },
    latest_correspondence: correspondence,
    clock_14d: clock,
    risk: {
      chips,
      refused,
      exception,
      high_risk: exception || refused,
    },
    brief_priority: briefPriorityOf({ refused, near: clock.near, interested }),
  };
}

export function poolHasBannedField(card: PoolKol): string | null {
  const raw = card as unknown as Record<string, unknown>;
  for (const key of POOL_BANNED_FIELDS) {
    if (raw[key] != null && raw[key] !== "") return key;
  }
  return null;
}

export function followHasDiscoveryField(card: FollowKol): string | null {
  const raw = card as unknown as Record<string, unknown>;
  for (const key of FOLLOW_BANNED_DISCOVERY_FIELDS) {
    if (raw[key] != null && raw[key] !== "") return key;
  }
  return null;
}

export function toggleSelectMax8(current: string[], id: string, on: boolean, max = KOL_SELECT_MAX): string[] {
  if (!on) return current.filter((item) => item !== id);
  if (current.includes(id)) return current;
  if (current.length >= max) return current;
  return [...current, id];
}

export function selectAllMax8(ids: string[], on: boolean, max = KOL_SELECT_MAX): string[] {
  if (!on) return [];
  return ids.slice(0, max);
}

export function analyzePrefillPrompt(cards: Array<{ identity: { display: string } }>, surface: KolSurface): string {
  const names = cards.map((card) => card.identity.display).filter(Boolean);
  const who = names.length ? names.join("、") : "已选红人";
  const scope = surface === "pool" ? "公海公开资料" : "跟进对象事实";
  return `${ANALYZE_PREFILL_PREFIX}：${who}\n请根据${scope}分析下一步，不要发信、不要改阶段。`;
}

export function isAnalyzePrefill(text: string): boolean {
  return text.trim().startsWith(ANALYZE_PREFILL_PREFIX);
}

export function isKolAnalyzeInFlight(status?: string | null): boolean {
  return ANALYZE_IN_FLIGHT_STATUSES.includes(String(status || "") as (typeof ANALYZE_IN_FLIGHT_STATUSES)[number]);
}

/** Map B.active follow contract onto the existing followed-kol-card model. */
export function followKolToRecord(item: FollowKol): {
  id: string;
  handle: string;
  kol_uid: string;
  follow_id?: string;
  platform: string;
  stage_code: string;
  stage_label: string;
  public_stage?: string;
  days_in_stage: number | null;
  exception: boolean;
  last_interaction_at: string | null;
  last_effective_mail_at: string | null;
  days_since_interaction: number | null;
  release_due_at: string | null;
  countdown: boolean;
  release_scheduler: false;
  mail_threads: Array<{
    conversation_id: string;
    last_snippet: string;
    last_at: string | null;
  }>;
} {
  return {
    id: item.collaboration_id || item.follow_id || item.kol_uid,
    handle: item.identity.display.replace(/^@/, ""),
    kol_uid: item.kol_uid,
    follow_id: item.follow_id,
    platform: item.identity.platform,
    stage_code: item.stage.code,
    stage_label: item.stage.label,
    public_stage: item.stage.label,
    days_in_stage: item.dwell?.days ?? null,
    exception: Boolean(item.risk.exception),
    last_interaction_at: item.clock_14d.countdown ? (item.clock_14d.last_interaction_at || null) : null,
    last_effective_mail_at: item.clock_14d.last_effective_mail_at || null,
    days_since_interaction: item.clock_14d.countdown ? (item.clock_14d.days_since_interaction ?? null) : null,
    release_due_at: item.clock_14d.countdown ? (item.clock_14d.release_due_at || null) : null,
    countdown: Boolean(item.clock_14d.countdown),
    release_scheduler: false,
    mail_threads: item.latest_correspondence.valid && item.latest_correspondence.thread_id
      ? [{
          conversation_id: item.latest_correspondence.thread_id,
          last_snippet: item.latest_correspondence.summary,
          last_at: item.latest_correspondence.at || null,
        }]
      : [],
  };
}
