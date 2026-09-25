import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HomeSurface } from "./surfaceError";
import { claimPoolKol, loadHomePool, releaseFollowedKol, syncHomePoolIndex } from "./kolSurfaceApi";
import type { PoolKol } from "./kolContract";

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
  /** 共享 board 管线：带首入缓存与 force 刷新，错误按 surface 路由。 */
  loadBoard: (surface: HomeSurface, force?: boolean) => Promise<void>;
  /** board 成功后拿到的公海索引原始行。 */
  boardKols: () => Array<Record<string, unknown>>;
  /** 领取成功后：清理选择并刷新「我的红人」面。 */
  onClaimed: (kolUid: string) => Promise<void>;
  /** 撤销领取后：清理选择并刷新「我的红人」面。 */
  onClaimUndone: (kolUid: string) => Promise<void>;
}) {
  const { loadBoard, boardKols, onClaimed, onClaimUndone } = options;

  const [cards, setCards] = useState<PoolKol[]>([]);
  const [query, setQuery] = useState("");
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
  const removalTimerRef = useRef<number | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (removalTimerRef.current !== null) window.clearTimeout(removalTimerRef.current);
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
  }, []);

  const visibleCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((card) =>
      [card.identity.display, card.identity.platform, card.direction, card.region, card.style]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [cards, query]);

  const loadSurface = useCallback(async () => {
    const loaded = await loadHomePool({ kols: boardKols() });
    if (loaded.down) {
      setError(loaded.error || "公海读取失败");
      setCards([]);
      return loaded.source;
    }
    setError("");
    setCards(dedupePoolCards(loaded.items));
    return loaded.source;
  }, [boardKols]);

  const ensureLoaded = useCallback(async () => {
    // The pool endpoint is independent of the board. Show its rows while the board refresh runs.
    const board = loadBoard("pool");
    const source = await loadSurface();
    await board;
    if (source === "board-adapter") await loadSurface();
  }, [loadBoard, loadSurface]);

  const syncLibrary = useCallback(async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncError(null);
    try {
      const refreshed = await syncHomePoolIndex();
      setCards(dedupePoolCards(refreshed.items));
      setError("");
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "红人库同步失败，请稍后重试");
    } finally {
      setSyncBusy(false);
    }
  }, [syncBusy]);

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
  }, [claimTarget, onClaimed]);

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
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : "撤销领取失败");
    } finally {
      setUndoBusy(false);
    }
  }, [onClaimUndone, undoBusy, undoClaim]);

  return {
    cards,
    visibleCards,
    query,
    setQuery,
    error,
    setError,
    loadSurface,
    ensureLoaded,
    syncLibrary,
    syncBusy,
    syncError,
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
