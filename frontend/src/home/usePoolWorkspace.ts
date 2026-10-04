import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HomeSurface } from "./surfaceError";
import {
  assessPoolWithJev,
  claimPoolKol,
  cleanupPoolMissingHomepage,
  enrichPoolAvatars,
  loadHomePool,
  previewPoolCleanup,
  releaseFollowedKol,
  syncHomePoolIndex,
} from "./kolSurfaceApi";
import type { PoolKol } from "./kolContract";
import { filterPoolCards, type PoolFilter, type PoolSort } from "./poolView";
import { sharedRead } from "./sharedRead";
import type { HomePoolPage } from "../api";
import { announcePoolReadStarted } from "./firstPaint";

function canonicalProfileKey(card: PoolKol): string {
  const url = (card.identity.profile_url || "").trim().toLowerCase().replace(/\/+$/, "");
  if (url) return `url:${url}`;
  return `identity:${card.identity.platform.trim().toLowerCase()}:${card.identity.display.trim().toLowerCase()}`;
}

function publicProfileCompleteness(card: PoolKol): number {
  return [
    card.identity.avatar_url,
    card.identity.profile_url,
    card.metrics.followers,
    card.metrics.avg_plays,
    card.metrics.engagement,
    card.direction,
    card.region,
    card.style,
  ].filter(Boolean).length;
}

/** The index is UID-authoritative, but legacy and remote UIDs can point to one public profile. */
function dedupePoolCards(cards: PoolKol[]): PoolKol[] {
  const byProfile = new Map<string, PoolKol>();
  for (const card of cards) {
    const key = canonicalProfileKey(card);
    const existing = byProfile.get(key);
    if (!existing || publicProfileCompleteness(card) > publicProfileCompleteness(existing)) byProfile.set(key, card);
  }
  return [...byProfile.values()];
}

export function usePoolWorkspace(options: {
  active: boolean;
  selectedIds: string[];
  /** 共享 board 管线：带首入缓存与 force 刷新，错误按 surface 路由。 */
  loadBoard: (surface: HomeSurface, force?: boolean) => Promise<boolean>;
  /** board 成功后拿到的公海索引原始行。 */
  boardKols: () => Array<Record<string, unknown>>;
  /** 领取成功后：清理选择并刷新「我的红人」面。 */
  onClaimed: (kolUid: string) => Promise<void>;
  /** 撤销领取后：清理选择并刷新「我的红人」面。 */
  onClaimUndone: (kolUid: string) => Promise<void>;
}) {
  const { loadBoard, boardKols, onClaimed, onClaimUndone } = options;

  const [cards, setCards] = useState<PoolKol[]>([]);
  // Keep only selected off-page objects, so filtering/paging does not silently change an analysis scope.
  const selectedCards = useRef(new Map<string, PoolKol>());
  for (const id of selectedCards.current.keys()) {
    if (!options.selectedIds.includes(id)) selectedCards.current.delete(id);
  }
  for (const card of cards) {
    if (options.selectedIds.includes(card.kol_uid)) selectedCards.current.set(card.kol_uid, card);
  }
  const analysisCards = [...new Map([...selectedCards.current.values(), ...cards].map((card) => [card.kol_uid, card])).values()];
  /** 首轮公海读取（含 404 回退）是否已走完；空态据此区分「还没读到」与「读到了 0 条」。 */
  const [poolLoaded, setPoolLoaded] = useState(false);
  /** 红人库条数：正常路径来自公海读自带的事实；404 回退时为 null，由 board 兜底。 */
  const [poolLibraryCount, setPoolLibraryCount] = useState<number | null>(null);
  const [query, updateQuery] = useState("");
  const [filter, updateFilter] = useState<PoolFilter>("all");
  // 公海右栏首次进入时默认按评分从高到低，帮助优先查看高潜对象。
  const [sort, updateSort] = useState<PoolSort>("score-desc");
  const [offset, updateOffset] = useState(0);
  const [page, setPage] = useState<HomePoolPage | null>(null);
  const requestVersion = useRef(0);
  const readGeneration = useRef(0);
  const readOptions = useRef({ query, filter, sort, offset, limit: 50 });
  readOptions.current = { query, filter, sort, offset, limit: 50 };
  const resetRead = () => { requestVersion.current += 1; setPoolLoaded(false); setCards([]); };
  const setQuery = (value: string) => { if (value === query) return; resetRead(); updateOffset(0); updateQuery(value); };
  const setFilter = (value: PoolFilter) => { if (value === filter) return; resetRead(); updateOffset(0); updateFilter(value); };
  const setSort = (value: PoolSort) => { if (value === sort) return; resetRead(); updateOffset(0); updateSort(value); };
  const setOffset = (value: number) => { if (value === offset) return; resetRead(); updateOffset(value); };
  const [error, setError] = useState("");
  const [claimTarget, setClaimTarget] = useState<PoolKol | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedId, setClaimedId] = useState<string | null>(null);
  const [undoClaim, setUndoClaim] = useState<{ card: PoolKol; followId: string } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  /** 同步完成后的如实回执（含「其中 N 条缺公开指标」），只在员工点了同步后出现。 */
  const [syncNotice, setSyncNotice] = useState("");
  const [maintenanceBusy, setMaintenanceBusy] = useState<"avatars" | "jev" | "cleanup" | null>(null);
  const [maintenanceNotice, setMaintenanceNotice] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<{ candidateCount: number; protectedActiveFollows: number } | null>(null);
  const removalTimerRef = useRef<number | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (removalTimerRef.current !== null) window.clearTimeout(removalTimerRef.current);
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
  }, []);

  const visibleCards = useMemo(() => {
    return page ? cards : filterPoolCards(cards, query, filter, sort);
  }, [cards, filter, query, sort, page]);

  const loadSurface = useCallback(async (force = false) => {
    announcePoolReadStarted();
    if (force) readGeneration.current += 1;
    const version = ++requestVersion.current;
    const params = { ...readOptions.current };
    const loaded = await sharedRead(`home:pool:${readGeneration.current}:${JSON.stringify(params)}`, () => loadHomePool({ kols: boardKols() }, params));
    if (version !== requestVersion.current) return loaded.source;
    setPoolLoaded(true);
    if (loaded.down) {
      setError(loaded.error || "公海读取失败");
      setCards([]);
      return loaded.source;
    }
    setError("");
    setCards(dedupePoolCards(loaded.items));
    setPage(loaded.page || null);
    if (loaded.libraryCount != null) setPoolLibraryCount(loaded.libraryCount);
    // A claim/delete can remove the final row of the final page.
    if (loaded.page && !loaded.items.length && params.offset > 0 && !loaded.down) {
      const lastOffset = Math.max(0, Math.ceil(loaded.page.matched / loaded.page.limit) - 1) * loaded.page.limit;
      if (lastOffset < params.offset) updateOffset(lastOffset);
    }
    return loaded.source;
  }, [boardKols]);

  const ensureLoaded = useCallback(async () => {
    // 公海读取（记忆读）是权威：公海页不再拉整个 board（库条数随这次读返回）。
    // 只有 404 回退（board-adapter）才需要 board 先到位，再投影一次。
    const source = await loadSurface();
    if (source !== "board-adapter") return;
    const boardReady = await loadBoard("pool");
    if (boardReady) await loadSurface();
  }, [loadBoard, loadSurface]);

  const ensureLoadedRef = useRef(ensureLoaded);
  ensureLoadedRef.current = ensureLoaded;
  const previousQuery = useRef(query);
  useEffect(() => {
    const searchChanged = previousQuery.current !== query;
    previousQuery.current = query;
    if (!options.active) return;
    setPoolLoaded(false);
    const timer = searchChanged ? window.setTimeout(() => { void ensureLoadedRef.current(); }, 250) : null;
    if (!searchChanged) void ensureLoadedRef.current();
    return () => { if (timer != null) window.clearTimeout(timer); requestVersion.current += 1; };
  }, [options.active, query, filter, sort, offset]);

  const syncLibrary = useCallback(async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncError(null);
    setSyncNotice("");
    try {
      const refreshed = await syncHomePoolIndex();
      await loadSurface(true);
      setSyncNotice(refreshed.message);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "红人库同步失败，请稍后重试");
    } finally {
      setSyncBusy(false);
    }
  }, [syncBusy, loadSurface]);

  const enrichAvatars = useCallback(async () => {
    if (maintenanceBusy) return;
    setMaintenanceBusy("avatars");
    setMaintenanceError(null);
    setMaintenanceNotice(null);
    try {
      const result = await enrichPoolAvatars();
      await loadSurface(true);
      setMaintenanceNotice(result.message);
    } catch (err) {
      setMaintenanceError(err instanceof Error ? err.message : "公开头像补全失败，请稍后重试");
    } finally {
      setMaintenanceBusy(null);
    }
  }, [maintenanceBusy, loadSurface]);

  const assessWithJev = useCallback(async (kolUids?: string[], criteria?: Record<string, unknown> | null) => {
    if (maintenanceBusy) throw new Error("已有评分或维护任务正在进行，请稍后重试");
    setMaintenanceBusy("jev");
    setMaintenanceError(null);
    setMaintenanceNotice(null);
    try {
      const result = await assessPoolWithJev(kolUids, criteria);
      // The command response is a receipt; re-read the memory endpoint so the
      // rail reflects the committed assessment columns after every batch.
      await loadSurface(true);
      setMaintenanceNotice(result.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Jev 评分失败，请稍后重试";
      setMaintenanceError(message);
      throw new Error(message);
    } finally {
      setMaintenanceBusy(null);
    }
  }, [loadSurface, maintenanceBusy]);

  const requestCleanupPreview = useCallback(async () => {
    if (maintenanceBusy) return;
    setMaintenanceBusy("cleanup");
    setMaintenanceError(null);
    setMaintenanceNotice(null);
    try {
      const preview = await previewPoolCleanup();
      setCleanupPreview(preview);
      setMaintenanceNotice(preview.candidateCount
        ? `检测到 ${preview.candidateCount} 条无主页公海档案，待确认删除。`
        : "没有可清理的无主页公海档案。");
    } catch (err) {
      setMaintenanceError(err instanceof Error ? err.message : "无主页档案预览失败");
    } finally {
      setMaintenanceBusy(null);
    }
  }, [maintenanceBusy]);

  const confirmCleanup = useCallback(async () => {
    if (!cleanupPreview || maintenanceBusy) return;
    setMaintenanceBusy("cleanup");
    setMaintenanceError(null);
    try {
      const result = await cleanupPoolMissingHomepage(cleanupPreview.candidateCount);
      await loadSurface(true);
      setCleanupPreview(null);
      setMaintenanceNotice(`已删除 ${result.deleted} 条无主页公海档案。`);
    } catch (err) {
      setMaintenanceError(err instanceof Error ? err.message : "无主页档案清理失败，请重新预览");
      setCleanupPreview(null);
    } finally {
      setMaintenanceBusy(null);
    }
  }, [cleanupPreview, maintenanceBusy, loadSurface]);

  const cancelCleanup = useCallback(() => {
    if (maintenanceBusy) return;
    setCleanupPreview(null);
    setMaintenanceNotice(null);
  }, [maintenanceBusy]);

  const requestClaim = useCallback((card: PoolKol) => {
    setClaimError(null);
    setClaimTarget(card);
  }, []);

  const cancelClaim = useCallback(() => {
    if (claimBusy) return;
    setClaimTarget(null);
    setClaimError(null);
  }, [claimBusy]);

  const confirmClaim = useCallback(async () => {
    if (!claimTarget) return;
    const claimedCard = claimTarget;
    const kolUid = claimedCard.kol_uid;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const receipt = await claimPoolKol(kolUid);
      if (!receipt.ok) throw new Error("领取未成功，请重试");
      setClaimTarget(null);
      setClaimedId(kolUid);
      if (removalTimerRef.current !== null) window.clearTimeout(removalTimerRef.current);
      removalTimerRef.current = window.setTimeout(() => {
        setCards((current) => current.filter((card) => card.kol_uid !== kolUid));
        setClaimedId(null);
        removalTimerRef.current = null;
        void loadSurface(true);
      }, 650);
      if (receipt.follow_id) {
        setUndoError(null);
        setUndoClaim({ card: claimedCard, followId: receipt.follow_id });
        if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
        undoTimerRef.current = window.setTimeout(() => {
          setUndoClaim(null);
          undoTimerRef.current = null;
        }, 4_000);
      }
      await onClaimed(kolUid);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "领取失败");
    } finally {
      setClaimBusy(false);
    }
  }, [claimTarget, onClaimed, loadSurface]);

  const undoLatestClaim = useCallback(async () => {
    if (!undoClaim || undoBusy) return;
    setUndoBusy(true);
    setUndoError(null);
    try {
      await releaseFollowedKol(undoClaim.followId, "claim_undo");
      if (removalTimerRef.current !== null) window.clearTimeout(removalTimerRef.current);
      removalTimerRef.current = null;
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
      setCards((current) => dedupePoolCards(current.some((card) => card.kol_uid === undoClaim.card.kol_uid)
        ? current
        : [undoClaim.card, ...current]));
      setClaimedId(null);
      setUndoClaim(null);
      await onClaimUndone(undoClaim.card.kol_uid);
      await loadSurface(true);
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : "撤销领取失败");
    } finally {
      setUndoBusy(false);
    }
  }, [onClaimUndone, undoBusy, undoClaim, loadSurface]);

  return {
    cards,
    analysisCards,
    page,
    offset,
    setOffset,
    totalCount: page?.total ?? cards.length,
    matchedCount: page?.matched ?? visibleCards.length,
    newCount: page?.new_count ?? cards.filter((card) => card.public_stage?.label === "未首次建联").length,
    poolLoaded,
    poolLibraryCount,
    visibleCards,
    query,
    setQuery,
    filter,
    setFilter,
    sort,
    setSort,
    error,
    setError,
    loadSurface,
    ensureLoaded,
    syncLibrary,
    syncBusy,
    syncError,
    syncNotice,
    maintenanceBusy,
    maintenanceNotice,
    maintenanceError,
    cleanupPreview,
    enrichAvatars,
    assessWithJev,
    requestCleanupPreview,
    confirmCleanup,
    cancelCleanup,
    claimTarget,
    claimBusy,
    claimError,
    claimedId,
    undoAvailable: Boolean(undoClaim),
    undoBusy,
    undoError,
    requestClaim,
    confirmClaim,
    cancelClaim,
    undoLatestClaim,
  };
}
