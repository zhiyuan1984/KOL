import { useCallback, useMemo, useState } from "react";
import type { HomeSurface } from "./surfaceError";
import { claimPoolKol, loadHomePool } from "./kolSurfaceApi";
import type { PoolKol } from "./kolContract";

export function usePoolWorkspace(options: {
  /** 共享 board 管线：带首入缓存与 force 刷新，错误按 surface 路由。 */
  loadBoard: (surface: HomeSurface, force?: boolean) => Promise<void>;
  /** board 成功后拿到的公海索引原始行。 */
  boardKols: () => Array<Record<string, unknown>>;
  /** 领取成功后：清理选择并刷新「我的红人」面。 */
  onClaimed: (kolUid: string) => Promise<void>;
}) {
  const { loadBoard, boardKols, onClaimed } = options;

  const [cards, setCards] = useState<PoolKol[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [claimTarget, setClaimTarget] = useState<PoolKol | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedId, setClaimedId] = useState<string | null>(null);

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
    setCards(loaded.items);
    return loaded.source;
  }, [boardKols]);

  const ensureLoaded = useCallback(async () => {
    // The pool endpoint is independent of the board. Show its rows while the board refresh runs.
    const board = loadBoard("pool");
    const source = await loadSurface();
    await board;
    if (source === "board-adapter") await loadSurface();
  }, [loadBoard, loadSurface]);

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
    const kolUid = claimTarget.kol_uid;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const receipt = await claimPoolKol(kolUid);
      if (!receipt.ok) throw new Error("领取未成功，请重试");
      setClaimTarget(null);
      setClaimedId(kolUid);
      window.setTimeout(() => {
        setCards((current) => current.filter((card) => card.kol_uid !== kolUid));
        setClaimedId(null);
      }, 650);
      await onClaimed(kolUid);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "领取失败");
    } finally {
      setClaimBusy(false);
    }
  }, [claimTarget, onClaimed]);

  return {
    cards,
    visibleCards,
    query,
    setQuery,
    error,
    setError,
    loadSurface,
    ensureLoaded,
    claimTarget,
    claimBusy,
    claimError,
    claimedId,
    requestClaim,
    confirmClaim,
    cancelClaim,
  };
}
