import { api, type Task } from "../api";
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

export type PoolLoad = {
  items: PoolKol[];
  source: "pool" | "board-adapter";
  creates_session: false;
  down?: boolean;
  error?: string;
};

export type FollowingLoad = {
  items: FollowKol[];
  raw: Array<Record<string, unknown>>;
  source: "following" | "board-adapter";
  contract: "B.active";
  creates_session: false;
  follow_scope: import("../api").StarryBinding | null;
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

/** Stable identity across B.active rows and the legacy mailbox-scoped board projection. */
function followingIdentity(row: Record<string, unknown>): string {
  const uid = String(row.kol_uid || row.creator_id || "").trim();
  if (uid) return `kol:${uid}`;
  const collaborationId = String(row.collaboration_id || row.id || "").trim();
  if (collaborationId) return `collaboration:${collaborationId}`;
  return `handle:${String(row.handle || row.display_name || row.kol_name || "").replace(/^@/, "").trim()}`;
}

/**
 * #172 made B.active (`kol_follow_index`) the follow authority. Existing
 * mailbox-scoped collaborations predate that index, though, and were already
 * filtered to the current employee by GET /api/home/board. Keep those existing
 * follows visible during the migration window without writing a claim from a
 * GET request. `collaboration_id` preserves the old card/session action path.
 */
function legacyBoardFollowing(board?: {
  kols?: Array<Record<string, unknown>>;
  follow_scope?: import("../api").StarryBinding;
}): Array<Record<string, unknown>> {
  // The board only acts as a per-employee compatibility source when its own
  // mailbox filter is active. In auth-disabled/demo mode it contains the
  // shared library, which must never be promoted into someone's follows.
  if (!board?.follow_scope?.required || !board.follow_scope.bound || board.follow_scope.status === "expired") return [];
  return (board?.kols || [])
    .filter(isActiveFollowRow)
    .map((row) => ({
      ...row,
      collaboration_id: String(row.collaboration_id || row.id || "").trim() || undefined,
    }));
}

function mergeFollowingRows(
  indexedRows: Array<Record<string, unknown>>,
  board?: { kols?: Array<Record<string, unknown>>; follow_scope?: import("../api").StarryBinding },
): Array<Record<string, unknown>> {
  const seen = new Set(indexedRows.map(followingIdentity));
  const legacy = legacyBoardFollowing(board).filter((row) => {
    const identity = followingIdentity(row);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return [...indexedRows, ...legacy];
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

export async function loadHomePool(board?: { kols?: Array<Record<string, unknown>>; creators?: Array<Record<string, unknown>> }): Promise<PoolLoad> {
  try {
    const payload = await api.homePool();
    const items = asRows(payload).filter(isOpenPoolRow).map(toPoolKol).filter((row): row is PoolKol => Boolean(row));
    return { items: unownedFirst(items), source: "pool", creates_session: false };
  } catch (error) {
    if (!isMissingEndpoint(error)) {
      return { items: [], source: "pool", creates_session: false, down: true, error: error instanceof Error ? error.message : "公海读取失败" };
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
  return { items: unownedFirst(items), source: "board-adapter", creates_session: false };
}

const POOL_SYNC_POLL_MS = 1_000;
const POOL_SYNC_WAIT_ATTEMPTS = 45;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Explicit command: start a local-index refresh, then wait only on its local receipt. */
export async function syncHomePoolIndex(): Promise<{ items: PoolKol[]; count: number }> {
  await api.syncHomePool();
  for (let attempt = 0; attempt < POOL_SYNC_WAIT_ATTEMPTS; attempt += 1) {
    await wait(POOL_SYNC_POLL_MS);
    const payload = await api.homePoolSyncStatus();
    if (payload.status === "failed" || payload.ok === false) {
      throw new Error(payload.message || "红人库同步失败，请稍后重试");
    }
    if (payload.status !== "succeeded" || payload.ok !== true) continue;
    const items = asRows(payload).filter(isOpenPoolRow).map(toPoolKol).filter((row): row is PoolKol => Boolean(row));
    return { items: unownedFirst(items), count: Number(payload.count || items.length) };
  }
  throw new Error("同步仍在后台进行，请稍后重新打开公海查看更新。");
}

export async function loadHomeFollowing(board?: { kols?: Array<Record<string, unknown>>; follow_scope?: import("../api").StarryBinding }): Promise<FollowingLoad> {
  try {
    const payload = await api.homeFollowing();
    const indexedRows = asRows(payload).filter(isActiveFollowRow);
    const raw = mergeFollowingRows(indexedRows, board);
    return {
      items: raw.map(toFollowKol).filter((row): row is FollowKol => Boolean(row)),
      raw,
      // Old mailbox-bound collaborations remain a read-only compatibility
      // projection until their B.active records are backfilled. The rendered
      // payload is still the public follow contract, not raw board data.
      source: raw.length > indexedRows.length ? "board-adapter" : "following",
      contract: "B.active",
      creates_session: false,
      follow_scope: payload.follow_scope || board?.follow_scope || null,
    };
  } catch (error) {
    if (!isMissingEndpoint(error)) {
      return {
        items: [],
        raw: [],
        source: "following",
        contract: "B.active",
        creates_session: false,
        follow_scope: board?.follow_scope || null,
        down: true,
        error: error instanceof Error ? error.message : "跟进列表读取失败",
      };
    }
  }
  const raw = (board?.kols || []).filter(isActiveFollowRow);
  return {
    items: raw.map(toFollowKol).filter((row): row is FollowKol => Boolean(row)),
    raw,
    source: "board-adapter",
    contract: "B.active",
    creates_session: false,
    follow_scope: board?.follow_scope || null,
  };
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

export async function loadKolAnalyzeInFlight(): Promise<AnalyzeWorkItem[]> {
  try {
    return kolAnalyzeInFlight(unwrapTaskRows(await api.tasks()));
  } catch {
    return [];
  }
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
