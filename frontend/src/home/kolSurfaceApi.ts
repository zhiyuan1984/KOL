import { api, type Task, type HomePoolPage, type HomePoolOptions } from "../api";
import {
  ANALYZE_QUEUED_COPY,
  KOL_ANALYZE_TASK_TYPE,
  isActiveFollowRow,
  isKolAnalyzeInFlight,
  isOpenPoolRow,
  toFollowKol,
  toPoolKol,
  type FollowKol,
  type KolAnalyzeEnqueueResult,
  type KolClaimResult,
  type KolReleaseResult,
  type KolSurface,
  type PoolKol,
} from "./kolContract";

const FOLLOWING_AUTHORITY = "kol_follow_index+verified_starry_binding";
const FOLLOWING_COMPLETENESS = "complete";

export type PoolLoad = {
  items: PoolKol[];
  source: "pool" | "board-adapter";
  creates_session: false;
  /** 公海读自带的红人库状态；404 回退（board-adapter）时为 null，由 board 兜底。 */
  libraryCount: number | null;
  page?: HomePoolPage;
  down?: boolean;
  error?: string;
};

export type FollowingLoad = {
  items: FollowKol[];
  raw: Array<Record<string, unknown>>;
  /** `/api/home/following` is the only rendered follow-list source. */
  source: "following";
  contract: "B.active+verified_starry_binding";
  authority: typeof FOLLOWING_AUTHORITY;
  completeness: typeof FOLLOWING_COMPLETENESS;
  creates_session: false;
  follow_scope: import("../api").StarryBinding | null;
  partial?: boolean;
  down?: boolean;
  error?: string;
};

export type AnalyzeWorkItem = {
  id: string;
  title?: string;
  status: string;
  session_id?: string | null;
  task_type?: string;
};

function asRows(payload: {
  items?: Array<Record<string, unknown>>;
  kols?: Array<Record<string, unknown>>;
  pool?: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.pool)) return payload.pool;
  if (Array.isArray(payload.kols)) return payload.kols;
  return [];
}

function isMissingEndpoint(error: unknown): boolean {
  const status = error && typeof error === "object" ? Number((error as { status?: number }).status || 0) : 0;
  return status === 404 || status === 405;
}

function hasCompleteFollowingAuthority(payload: { authority?: unknown; completeness?: unknown }): boolean {
  return payload.authority === FOLLOWING_AUTHORITY && payload.completeness === FOLLOWING_COMPLETENESS;
}

function poolRow(row: Record<string, unknown>, followed: Set<string>): boolean {
  if (!isOpenPoolRow(row)) return false;
  const uid = String(row.kol_uid || row.creator_id || row.id || "").trim();
  const handle = String(row.handle || row.name || "").replace(/^@/, "").trim();
  if ((uid && followed.has(uid)) || (handle && followed.has(handle))) return false;
  if (row.unbound) return true;
  return isOpenPoolRow(row);
}

/** 无主优先是界面保证，不依赖后端排序：无主的红人最该被领取，先看到。 */
function unownedFirst(rows: PoolKol[]): PoolKol[] {
  return [...rows].sort((a, b) => Number(Boolean(b.unowned)) - Number(Boolean(a.unowned)));
}

export async function loadHomePool(board?: { kols?: Array<Record<string, unknown>>; creators?: Array<Record<string, unknown>> }, options: HomePoolOptions = {}): Promise<PoolLoad> {
  try {
    const payload = await api.homePool(options);
    const items = asRows(payload).filter(isOpenPoolRow).map(toPoolKol).filter((row): row is PoolKol => Boolean(row));
    const library = payload.library;
    return {
      items: payload.page ? items : unownedFirst(items),
      source: "pool",
      creates_session: false,
      libraryCount: typeof library?.count === "number" ? library.count : null,
      page: payload.page,
    };
  } catch (error) {
    if (!isMissingEndpoint(error)) {
      return { items: [], source: "pool", creates_session: false, libraryCount: null, down: true, error: error instanceof Error ? error.message : "公海读取失败" };
    }
  }
  const followed = new Set<string>();
  for (const row of board?.kols || []) {
    if (!isActiveFollowRow(row)) continue;
    const uid = String(row.kol_uid || "").trim();
    const handle = String(row.handle || "").replace(/^@/, "").trim();
    if (uid) followed.add(uid);
    if (handle) followed.add(handle);
  }
  const candidates = [...(board?.creators || []), ...(board?.kols || []).filter((row) => poolRow(row, followed))];
  const items = candidates.filter((row) => poolRow(row, followed)).map(toPoolKol).filter((row): row is PoolKol => Boolean(row));
  return { items: unownedFirst(items), source: "board-adapter", creates_session: false, libraryCount: null };
}

const POOL_SYNC_POLL_MS = 1_000;
const POOL_SYNC_WAIT_ATTEMPTS = 45;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Explicit command: start a local-index refresh, then wait only on its local receipt. */
export async function syncHomePoolIndex(): Promise<{ items: PoolKol[]; count: number; message: string; missingMetrics: number }> {
  await api.syncHomePool();
  for (let attempt = 0; attempt < POOL_SYNC_WAIT_ATTEMPTS; attempt += 1) {
    if (attempt) await wait(POOL_SYNC_POLL_MS);
    const payload = await api.homePoolSyncStatus();
    if (payload.status === "failed" || payload.ok === false) {
      throw new Error(payload.message || "红人库同步失败，请稍后重试");
    }
    if (payload.status !== "succeeded" || payload.ok !== true) continue;
    const items = asRows(payload).filter(isOpenPoolRow).map(toPoolKol).filter((row): row is PoolKol => Boolean(row));
    return {
      items: unownedFirst(items),
      count: Number(payload.count || items.length),
      message: payload.message || `已同步 ${Number(payload.count || items.length)} 个红人档案`,
      missingMetrics: Number(payload.missing_metrics || 0),
    };
  }
  throw new Error("同步仍在后台进行，请稍后重新打开公海查看更新。");
}

type PoolCommandReceipt = {
  started?: boolean;
  status?: "idle" | "running" | "succeeded" | "failed";
  ok?: boolean;
  message?: string;
  items?: Array<Record<string, unknown>>;
  kols?: Array<Record<string, unknown>>;
};

export class PoolMaintenancePendingError extends Error {}

async function waitPoolMaintenance(
  start: () => Promise<PoolCommandReceipt>,
  status: () => Promise<PoolCommandReceipt>,
  pendingCopy: string,
): Promise<{ items: PoolKol[]; message: string }> {
  const accepted = await start();
  if (accepted.started === false) throw new Error("已有评分任务正在运行，本次评分未启动，请稍后重试。");
  for (let attempt = 0; attempt < POOL_SYNC_WAIT_ATTEMPTS; attempt += 1) {
    if (attempt) await wait(POOL_SYNC_POLL_MS);
    const payload = await status();
    if (payload.status === "failed" || payload.ok === false) {
      throw new Error(payload.message || "公海维护命令失败，请稍后重试");
    }
    if (payload.status !== "succeeded" || payload.ok !== true) continue;
    const items = asRows(payload).filter(isOpenPoolRow).map(toPoolKol).filter((row): row is PoolKol => Boolean(row));
    return { items: unownedFirst(items), message: payload.message || "已完成" };
  }
  throw new PoolMaintenancePendingError(`${pendingCopy}仍在后台进行，请重新读取评分状态。`);
}

/** Explicit public homepage metadata crawl; no stored cookies or account session are used. */
export function enrichPoolAvatars(): Promise<{ items: PoolKol[]; message: string }> {
  return waitPoolMaintenance(() => api.enrichPoolAvatars(), () => api.poolAvatarEnrichmentStatus(), "头像补全");
}

/** Explicit bounded Jev assessment; returned values remain advisory public-index metadata. */
export function assessPoolWithJev(
  kolUids?: string[],
  criteria?: Record<string, unknown> | null,
): Promise<{ items: PoolKol[]; message: string }> {
  return waitPoolMaintenance(
    () => api.assessPoolWithJev(kolUids, criteria),
    () => api.poolJevAssessmentStatus(),
    "Jev 评分",
  );
}

/** 等待中的评分只读取原任务回执，不再次启动评分。 */
export function resumePoolJevAssessment(): Promise<{ items: PoolKol[]; message: string }> {
  return waitPoolMaintenance(() => Promise.resolve({}), () => api.poolJevAssessmentStatus(), "红人评分");
}

export async function previewPoolCleanup(): Promise<{ candidateCount: number; protectedActiveFollows: number }> {
  const payload = await api.poolCleanupPreview();
  return {
    candidateCount: Math.max(0, Number(payload.candidate_count || 0)),
    protectedActiveFollows: Math.max(0, Number(payload.protected_active_follows || 0)),
  };
}

export async function cleanupPoolMissingHomepage(expectedCount: number): Promise<{ items: PoolKol[]; deleted: number }> {
  const payload = await api.cleanupPoolMissingHomepage(expectedCount);
  const items = asRows(payload).filter(isOpenPoolRow).map(toPoolKol).filter((row): row is PoolKol => Boolean(row));
  return { items: unownedFirst(items), deleted: Math.max(0, Number(payload.deleted || 0)) };
}

/**
 * The service has already combined local active follows with verified Starry
 * binding history and applied the caller's authorization. Never supplement a
 * successful or failed response with `/api/home/board` profile projections.
 */
export async function loadHomeFollowing(): Promise<FollowingLoad> {
  try {
    const payload = await api.homeFollowing() as Awaited<ReturnType<typeof api.homeFollowing>> & {completeness?:string;source_error_code?:string};
    const partial=payload.authority===FOLLOWING_AUTHORITY && payload.completeness==='incomplete-source';
    if (!partial && !hasCompleteFollowingAuthority(payload)) {
      throw new Error("跟进名单未返回完整的服务端授权标记");
    }
    const raw = asRows(payload).filter(isActiveFollowRow);
    return {
      items: raw.map(toFollowKol).filter((row): row is FollowKol => Boolean(row)),
      ...(partial ? {partial:true,down:true,error:payload.source_error_code === "starry_authorization_timeout"
        ? "Starry 授权核验超时，本次读取已结束；仅展示本地有效跟进，可重试核对。"
        : "Starry 归属来源尚未完整核验；仅展示本地有效跟进"} : {}),
      raw,
      source: "following",
      contract: "B.active+verified_starry_binding",
      authority: FOLLOWING_AUTHORITY,
      completeness: FOLLOWING_COMPLETENESS,
      creates_session: false,
      follow_scope: payload.follow_scope || null,
    };
  } catch (error) {
    return {
      items: [],
      raw: [],
      source: "following",
      contract: "B.active+verified_starry_binding",
      authority: FOLLOWING_AUTHORITY,
      completeness: FOLLOWING_COMPLETENESS,
      creates_session: false,
      follow_scope: null,
      down: true,
      error: error instanceof Error ? error.message : "跟进列表读取失败",
    };
  }
}

export const ANALYZE_WORK_EVENT = "kol:analyze-work";

export function publishAnalyzeWork(item: AnalyzeWorkItem): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ANALYZE_WORK_EVENT, { detail: item }));
}

export function unwrapTaskRows(payload: Task[] | { tasks?: Task[] } | unknown): Task[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray((payload as { tasks?: Task[] }).tasks)) {
    return (payload as { tasks: Task[] }).tasks;
  }
  return [];
}

export function kolAnalyzeInFlight(tasks: Task[]): AnalyzeWorkItem[] {
  return tasks.filter((task) => {
    const type = String(task.task_type || task.skill || "");
    return type === KOL_ANALYZE_TASK_TYPE && isKolAnalyzeInFlight(String(task.status || ""));
  }).map((task) => ({
    id: task.id,
    title: task.title,
    status: String(task.status || "queued"),
    session_id: task.session_id || null,
    task_type: KOL_ANALYZE_TASK_TYPE,
  }));
}

export async function enqueueKolAnalyze(body: {
  kol_uids: string[];
  prompt: string;
  surface: KolSurface;
}): Promise<KolAnalyzeEnqueueResult> {
  const result = await api.enqueueKolAnalyze({
    kol_uids: body.kol_uids,
    title: (body.prompt || "分析已选红人").slice(0, 200),
  });
  const workItemId = String(result.work_item_id || "");
  if (!workItemId) {
    throw new Error("入队未返回 work_item_id");
  }
  const queued: KolAnalyzeEnqueueResult = {
    work_item_id: workItemId,
    session_id: result.session_id || null,
    status: isKolAnalyzeInFlight(result.status) ? result.status as KolAnalyzeEnqueueResult["status"] : "queued",
    queued_copy: result.queued_copy || ANALYZE_QUEUED_COPY,
    entry: result.entry || "kol-analyze-enqueue",
    creates_session: false,
    people: result.people,
    task_type: result.task_type || KOL_ANALYZE_TASK_TYPE,
  };
  publishAnalyzeWork({
    id: workItemId,
    title: body.prompt.slice(0, 40) || "分析已选红人",
    status: queued.status,
    session_id: queued.session_id,
    task_type: KOL_ANALYZE_TASK_TYPE,
  });
  return queued;
}

export async function claimPoolKol(kolUid: string): Promise<KolClaimResult> {
  const result = await api.claimKol(kolUid, { confirm: true });
  const follow = result.follow && typeof result.follow === "object" ? result.follow : undefined;
  return {
    ok: result.ok !== false,
    reused: Boolean(result.reused),
    created: Boolean(result.created),
    kol_uid: String(follow?.kol_uid || result.kol_uid || kolUid),
    follow_id: follow?.follow_id ? String(follow.follow_id) : (result.follow_id ? String(result.follow_id) : undefined),
    follow,
    collaboration_id: follow?.collaboration_id
      ? String(follow.collaboration_id)
      : (result.collaboration_id ? String(result.collaboration_id) : undefined),
    stage_unchanged: true,
    sent: false,
  };
}

export async function releaseFollowedKol(followId: string, reason = "manual_release"): Promise<KolReleaseResult> {
  const result = await api.releaseFollow(followId, { confirm: true, reason });
  return {
    ok: result.ok !== false,
    follow_id: result.follow_id ? String(result.follow_id) : followId,
    kol_uid: result.kol_uid ? String(result.kol_uid) : undefined,
    stage_unchanged: result.stage_unchanged ?? null,
  };
}
