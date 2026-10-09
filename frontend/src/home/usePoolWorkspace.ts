import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HomeSurface } from "./surfaceError";
import {
  assessPoolWithJev,
  claimPoolKol,
  loadHomeFollowing,
  loadHomePool,
  releaseFollowedKol,
  syncHomePoolIndex,
} from "./kolSurfaceApi";
import type { PoolKol } from "./kolContract";
import {
  EMPTY_POOL_CLAIM_RECEIPTS,
  canStartPoolMutation,
  filterPoolCards,
  isPoolNew,
  isPoolOverdue,
  poolCandidateCards,
  reducePoolClaimReceipts,
  type PoolClaimReceipts,
  type PoolFilter,
  type PoolSort,
} from "./poolView";
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

/** The page is initially a pre-command snapshot; update it until its next authoritative read. */
function pageAfterOwnershipChange(page: HomePoolPage | null, card: PoolKol, delta: 1 | -1): HomePoolPage | null {
  if (!page) return page;
  return {
    ...page,
    total: Math.max(0, page.total + delta),
    matched: Math.max(0, page.matched + delta),
    new_count: Math.max(0, page.new_count + (isPoolNew(card) ? delta : 0)),
    overdue_count: Math.max(0, page.overdue_count + (isPoolOverdue(card) ? delta : 0)),
  };
}

type PoolOwnershipStatus =
  | { state: "claimed"; followId: string }
  | { state: "available" }
  | { state: "uncertain" };

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
  /** A committed claim remains visible only as a keyed release receipt. */
  const [claimReceipts, setClaimReceipts] = useState<PoolClaimReceipts>(EMPTY_POOL_CLAIM_RECEIPTS);
  const claimReceiptsRef = useRef<PoolClaimReceipts>(claimReceipts);
  claimReceiptsRef.current = claimReceipts;
  const applyClaimReceipt = (event: Parameters<typeof reducePoolClaimReceipts>[1]) => {
    const next = reducePoolClaimReceipts(claimReceiptsRef.current, event);
    claimReceiptsRef.current = next;
    setClaimReceipts(next);
    return next;
  };
  // Keep only selected off-page objects, so filtering/paging does not silently change an analysis scope.
  const selectedCards = useRef(new Map<string, PoolKol>());
  for (const id of selectedCards.current.keys()) {
    if (!options.selectedIds.includes(id) || claimReceipts[id]) selectedCards.current.delete(id);
  }
  for (const card of cards) {
    if (options.selectedIds.includes(card.kol_uid) && !claimReceipts[card.kol_uid]) selectedCards.current.set(card.kol_uid, card);
  }
  const analysisCards = [...new Map([
    ...selectedCards.current.values(),
    ...poolCandidateCards(cards, claimReceipts),
  ].map((card) => [card.kol_uid, card])).values()];
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
  /** Receipt visibility is scoped to one query/filter/page snapshot. */
  const receiptScopeVersion = useRef(0);
  const readGeneration = useRef(0);
  const readOptions = useRef({ query, filter, sort, offset, limit: 50 });
  readOptions.current = { query, filter, sort, offset, limit: 50 };
  const resetRead = () => {
    requestVersion.current += 1;
    receiptScopeVersion.current += 1;
    setPoolLoaded(false);
    setCards([]);
    // A receipt belongs only to the list snapshot where the command was made.
    applyClaimReceipt({ type: "scope-reset" });
    setClaimError(null);
    setClaimErrorId(null);
  };
  const setQuery = (value: string) => { if (value === query) return; resetRead(); updateOffset(0); updateQuery(value); };
  const setFilter = (value: PoolFilter) => { if (value === filter) return; resetRead(); updateOffset(0); updateFilter(value); };
  const setSort = (value: PoolSort) => { if (value === sort) return; resetRead(); updateOffset(0); updateSort(value); };
  const setOffset = (value: number) => { if (value === offset) return; resetRead(); updateOffset(value); };
  const [error, setError] = useState("");
  const [claimTarget, setClaimTarget] = useState<PoolKol | null>(null);
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const claimBusyRef = useRef<string | null>(null);
  /** Keeps failed direct commands attached to their row after the busy state ends. */
  const [claimErrorId, setClaimErrorId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  /** A transport failure must be read-back reconciled before the next write attempt. */
  const ownershipCheckRequired = useRef(new Set<string>());
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  /** 同步完成后的如实回执（含「其中 N 条缺公开指标」），只在员工点了同步后出现。 */
  const [syncNotice, setSyncNotice] = useState("");
  /** 公海员工面只保留 Jev 评分一种维护动作；头像补全/无主页清理是治理面，不在员工面装配（使用≠治理）。 */
  const [maintenanceBusy, setMaintenanceBusy] = useState<"jev" | null>(null);
  const [maintenanceNotice, setMaintenanceNotice] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);

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
    // A command receipt is deliberately retained in its source list until the
    // user changes query/filter/page; a background refresh must not erase it.
    setCards(dedupePoolCards([
      ...Object.values(claimReceiptsRef.current).map((receipt) => receipt.card),
      ...loaded.items,
    ]));
    setPage(loaded.page || null);
    if (loaded.libraryCount != null) setPoolLibraryCount(loaded.libraryCount);
    // A claim/delete can remove the final row of the final page.
    if (loaded.page && !loaded.items.length && params.offset > 0 && !loaded.down) {
      const lastOffset = Math.max(0, Math.ceil(loaded.page.matched / loaded.page.limit) - 1) * loaded.page.limit;
      if (lastOffset < params.offset) {
        receiptScopeVersion.current += 1;
        applyClaimReceipt({ type: "scope-reset" });
        updateOffset(lastOffset);
      }
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
    if (!options.active) {
      receiptScopeVersion.current += 1;
      applyClaimReceipt({ type: "scope-reset" });
      return;
    }
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

  const assessWithJev = useCallback(async (kolUids?: string[], criteria?: Record<string, unknown> | null) => {
    if (maintenanceBusy) throw new Error("评分正在进行，请稍后重试");
    setMaintenanceBusy("jev");
    setMaintenanceError(null);
    setMaintenanceNotice(null);
    try {
      const result = await assessPoolWithJev(kolUids, criteria);
      // The command response is a receipt; re-read the memory endpoint so the
      // rail reflects the committed assessment columns after every batch.
      await loadSurface(true);
      setMaintenanceNotice(result.message);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Jev 评分失败，请稍后重试";
      setMaintenanceError(message);
      throw err;
    } finally {
      setMaintenanceBusy(null);
    }
  }, [loadSurface, maintenanceBusy]);

  const endClaimMutation = useCallback(() => {
    claimBusyRef.current = null;
    setClaimBusyId(null);
    setClaimTarget(null);
  }, []);

  /** B.active is the ownership authority used to reconcile a lost/failed command response. */
  const readOwnershipStatus = useCallback(async (kolUid: string): Promise<PoolOwnershipStatus> => {
    try {
      const following = await loadHomeFollowing();
      // A board adapter without a board snapshot cannot prove absence of a follow.
      if (following.down || following.source !== "following") return { state: "uncertain" };
      const followId = String(following.items.find((item) => item.kol_uid === kolUid)?.follow_id || "").trim();
      return followId ? { state: "claimed", followId } : { state: "available" };
    } catch {
      return { state: "uncertain" };
    }
  }, []);

  const commitClaimReceipt = useCallback(async (card: PoolKol, followId: string, retainReceipt: boolean) => {
    const kolUid = card.kol_uid;
    if (retainReceipt) {
      applyClaimReceipt({ type: "claim-succeeded", receipt: { kolUid, followId, card } });
      setPage((current) => pageAfterOwnershipChange(current, card, -1));
    }
    ownershipCheckRequired.current.delete(kolUid);
    setClaimError(null);
    setClaimErrorId(null);
    try {
      await onClaimed(kolUid);
    } catch (err) {
      // The command is committed. Report only the follow-list refresh failure.
      setClaimErrorId(kolUid);
      setClaimError(err instanceof Error ? `领取已成功，但刷新我的跟进失败：${err.message}` : "领取已成功，但刷新我的跟进失败");
    }
  }, [onClaimed]);

  const commitReleaseReceipt = useCallback(async (receipt: PoolClaimReceipts[string], retainReceipt: boolean) => {
    const { kolUid, card } = receipt;
    if (retainReceipt) {
      applyClaimReceipt({ type: "release-succeeded", kolUid });
      setCards((current) => dedupePoolCards(current.some((item) => item.kol_uid === kolUid)
        ? current
        : [card, ...current]));
      setPage((current) => pageAfterOwnershipChange(current, card, 1));
    }
    ownershipCheckRequired.current.delete(kolUid);
    setClaimError(null);
    setClaimErrorId(null);
    try {
      await onClaimUndone(kolUid);
    } catch (err) {
      setError(err instanceof Error ? `已放回公海，但刷新我的跟进失败：${err.message}` : "已放回公海，但刷新我的跟进失败");
    }
    try {
      await loadSurface(true);
    } catch (err) {
      setError(err instanceof Error ? `已放回公海，但刷新公海失败：${err.message}` : "已放回公海，但刷新公海失败");
    }
  }, [loadSurface, onClaimUndone]);

  const reconcileClaimFailure = useCallback(async (card: PoolKol, failedMessage: string, retainReceipt: boolean) => {
    const scopeBeforeRead = receiptScopeVersion.current;
    const status = await readOwnershipStatus(card.kol_uid);
    if (status.state === "claimed") {
      await commitClaimReceipt(card, status.followId, retainReceipt && scopeBeforeRead === receiptScopeVersion.current);
      return;
    }
    applyClaimReceipt({ type: "claim-failed" });
    setClaimErrorId(card.kol_uid);
    if (status.state === "available") {
      ownershipCheckRequired.current.delete(card.kol_uid);
      setClaimError(`${failedMessage}；未发现本人跟进回执。可刷新核对，重新领取仍由服务端校验归属。`);
      return;
    }
    ownershipCheckRequired.current.add(card.kol_uid);
    setClaimError(`${failedMessage}；当前无法核对领取状态，下次操作会先核对，未确认前不会重复领取。`);
  }, [commitClaimReceipt, readOwnershipStatus]);

  const reconcileReleaseFailure = useCallback(async (receipt: PoolClaimReceipts[string], failedMessage: string, retainReceipt: boolean) => {
    const scopeBeforeRead = receiptScopeVersion.current;
    const status = await readOwnershipStatus(receipt.kolUid);
    if (status.state === "available") {
      await commitReleaseReceipt(receipt, retainReceipt && scopeBeforeRead === receiptScopeVersion.current);
      return;
    }
    applyClaimReceipt({ type: "release-failed" });
    setClaimErrorId(receipt.kolUid);
    if (status.state === "claimed") {
      ownershipCheckRequired.current.delete(receipt.kolUid);
      // A re-created/reused follow may have a new id; retain the authoritative receipt.
      if (retainReceipt && scopeBeforeRead === receiptScopeVersion.current && status.followId !== receipt.followId) {
        applyClaimReceipt({ type: "claim-succeeded", receipt: { ...receipt, followId: status.followId } });
      }
      setClaimError(`${failedMessage}；已核对仍在我的跟进，可再次放回公海。`);
      return;
    }
    ownershipCheckRequired.current.add(receipt.kolUid);
    setClaimError(`${failedMessage}；当前无法核对放回状态，下次操作会先核对，未确认前不会重复放回。`);
  }, [commitReleaseReceipt, readOwnershipStatus]);

  /** The explicit “领取跟进” click is this action's confirmation; API confirmation remains mandatory. */
  const requestClaim = useCallback(async (card: PoolKol) => {
    const kolUid = card.kol_uid;
    if (!canStartPoolMutation(claimBusyRef.current, kolUid) || claimReceiptsRef.current[kolUid]) return;
    const scopeAtStart = receiptScopeVersion.current;
    claimBusyRef.current = kolUid;
    setClaimBusyId(kolUid);
    setClaimTarget(card);
    setClaimError(null);
    setClaimErrorId(null);
    try {
      if (ownershipCheckRequired.current.has(kolUid)) {
        const status = await readOwnershipStatus(kolUid);
        if (status.state === "claimed") {
          await commitClaimReceipt(card, status.followId, receiptScopeVersion.current === scopeAtStart);
          return;
        }
        if (status.state === "uncertain") {
          setClaimErrorId(kolUid);
          setClaimError("当前无法核对领取状态，尚未重复领取；请稍后再试。");
          return;
        }
        ownershipCheckRequired.current.delete(kolUid);
      }
      const receipt = await claimPoolKol(kolUid);
      if (!receipt.ok) {
        await reconcileClaimFailure(card, "领取未成功", receiptScopeVersion.current === scopeAtStart);
        return;
      }
      const followId = String(receipt.follow_id || "").trim();
      if (!followId) {
        await reconcileClaimFailure(card, "领取已提交，但未返回可放回公海的跟进凭据", receiptScopeVersion.current === scopeAtStart);
        return;
      }
      await commitClaimReceipt(card, followId, receiptScopeVersion.current === scopeAtStart);
    } catch (err) {
      // Never blindly retry a write after a transport failure: read B.active first.
      await reconcileClaimFailure(card, err instanceof Error ? err.message : "领取失败", receiptScopeVersion.current === scopeAtStart);
    } finally {
      endClaimMutation();
    }
  }, [commitClaimReceipt, endClaimMutation, readOwnershipStatus, reconcileClaimFailure]);

  /** The retained row is a committed-action receipt; clicking it performs an explicit release. */
  const releaseClaimReceipt = useCallback(async (kolUid: string) => {
    const receipt = claimReceiptsRef.current[kolUid];
    if (!receipt || !canStartPoolMutation(claimBusyRef.current, kolUid)) return;
    const scopeAtStart = receiptScopeVersion.current;
    claimBusyRef.current = kolUid;
    setClaimBusyId(kolUid);
    setClaimTarget(receipt.card);
    setClaimError(null);
    setClaimErrorId(null);
    try {
      if (ownershipCheckRequired.current.has(kolUid)) {
        const status = await readOwnershipStatus(kolUid);
        if (status.state === "available") {
          await commitReleaseReceipt(receipt, receiptScopeVersion.current === scopeAtStart);
          return;
        }
        if (status.state === "uncertain") {
          setClaimErrorId(kolUid);
          setClaimError("当前无法核对放回状态，尚未重复放回；请稍后再试。");
          return;
        }
        ownershipCheckRequired.current.delete(kolUid);
        if (status.followId !== receipt.followId) {
          applyClaimReceipt({ type: "claim-succeeded", receipt: { ...receipt, followId: status.followId } });
          return;
        }
      }
      const released = await releaseFollowedKol(receipt.followId, "manual_release");
      if (!released.ok) {
        await reconcileReleaseFailure(receipt, "放回公海未成功", receiptScopeVersion.current === scopeAtStart);
        return;
      }
      await commitReleaseReceipt(receipt, receiptScopeVersion.current === scopeAtStart);
    } catch (err) {
      // Keep the receipt visible and reconcile B.active before allowing any retry.
      await reconcileReleaseFailure(receipt, err instanceof Error ? err.message : "放回公海失败", receiptScopeVersion.current === scopeAtStart);
    } finally {
      endClaimMutation();
    }
  }, [commitReleaseReceipt, endClaimMutation, readOwnershipStatus, reconcileReleaseFailure]);

  /** Refresh verifies ownership only; it never retries an uncertain mutation. */
  const refreshOwnership = useCallback(async (kolUid: string) => {
    if (claimBusyRef.current) return;
    const card = cards.find((item) => item.kol_uid === kolUid);
    const receipt = claimReceiptsRef.current[kolUid];
    if (!card && !receipt) return;
    const scopeAtStart = receiptScopeVersion.current;
    claimBusyRef.current = kolUid;
    setClaimBusyId(kolUid);
    try {
      const status = await readOwnershipStatus(kolUid);
      if (status.state === "uncertain") {
        ownershipCheckRequired.current.add(kolUid);
        setClaimErrorId(kolUid);
        setClaimError("当前无法核对归属状态，请稍后刷新；未重复执行领取或放回。");
      } else if (status.state === "claimed") {
        if (card) await commitClaimReceipt(card, status.followId, scopeAtStart === receiptScopeVersion.current);
      } else if (receipt) {
        await commitReleaseReceipt(receipt, scopeAtStart === receiptScopeVersion.current);
      } else {
        ownershipCheckRequired.current.delete(kolUid);
        setClaimErrorId(null);
        setClaimError(null);
        await loadSurface(true);
      }
    } finally {
      endClaimMutation();
    }
  }, [cards, commitClaimReceipt, commitReleaseReceipt, endClaimMutation, loadSurface, readOwnershipStatus]);

  // Legacy fields remain stable until Home removes the previous modal props.
  const cancelClaim = useCallback(() => {
    if (claimBusyRef.current) return;
    setClaimTarget(null);
    setClaimError(null);
    setClaimErrorId(null);
  }, []);
  const confirmClaim = useCallback(() => {
    if (claimTarget && !claimReceiptsRef.current[claimTarget.kol_uid]) void requestClaim(claimTarget);
  }, [claimTarget, requestClaim]);

  // Native pages provide query-scoped facets before the stage filter. The
  // board-adapter fallback has no server page, so derive the same semantics.
  const fallbackCandidates = poolCandidateCards(cards, claimReceipts);
  const fallbackQueryCards = filterPoolCards(fallbackCandidates, query, "all", "default");
  const poolCounts = page && Number.isFinite(page.new_count) && Number.isFinite(page.overdue_count)
    ? { newCount: page.new_count, overdueCount: page.overdue_count }
    : {
      newCount: fallbackQueryCards.filter(isPoolNew).length,
      overdueCount: fallbackQueryCards.filter(isPoolOverdue).length,
    };
  const totalCount = page?.total ?? fallbackCandidates.length;
  const matchedCount = page?.matched ?? visibleCards.length;

  return {
    cards,
    analysisCards,
    page,
    offset,
    setOffset,
    totalCount,
    matchedCount,
    newCount: poolCounts.newCount,
    overdueCount: poolCounts.overdueCount,
    poolCounts,
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
    assessWithJev,
    claimReceipts,
    claimTarget,
    claimBusy: Boolean(claimBusyId),
    claimBusyId,
    claimErrorId,
    claimError,
    // Compatibility aliases for the current Home call site; the receipt map is authoritative.
    claimedId: null,
    undoAvailable: false,
    undoBusy: false,
    undoError: null,
    requestClaim,
    releaseClaimReceipt,
    refreshOwnership,
    confirmClaim,
    cancelClaim,
    undoLatestClaim: () => undefined,
  };
}
