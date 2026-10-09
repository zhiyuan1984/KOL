import { useCallback, useMemo, useRef, useState } from "react";
import { api, type StarryBinding, type Task } from "../api";
import { storePending } from "../components/ChatBlocks";
import { rememberJourney } from "../journey";
import { mailHref } from "../mail/fallback";
import {
  HOME_CONFIRM_STAGE_BLOCKED_COPY,
  HOME_OPENED_EXISTING_SESSION_COPY,
  HOME_OPENED_EXISTING_SESSION_LANDED_COPY,
} from "../confirmStageFeedback";
import {
  matchesKolSearch,
  matchesStageFilter,
  followedStageEnterCards,
  projectFollowedKolCard,
  sortFollowedKolCards,
  type KolSortMode,
  type FollowedKolCardModel,
  type FollowedKolRecord,
} from "../followedKolCard";
import { canOpenExistingTaskFlow } from "./homeModel";
import { followKolToRecord, type FollowKol } from "./kolContract";
import { loadHomeFollowing, releaseFollowedKol } from "./kolSurfaceApi";
import { sharedRead } from "./sharedRead";
import { matchesFollowedSituation, type FollowedSituation } from "./FollowedBrief";
import type { HomeSurface } from "./surfaceError";
import type { ComposerObjectRef } from "../composer/types";

export type FollowedKol = FollowedKolRecord;

type FollowReleaseStatus =
  | { state: "active"; followId: string }
  | { state: "released" }
  | { state: "uncertain" };

/**
 * A follow-list "empty" result is only conclusive after the B.active index and
 * the mailbox-scoped legacy projection have both been reconciled. The latter
 * remains necessary while older collaborations have not yet been backfilled.
 */
export type FollowListCompleteness =
  | "loading-local"
  | "reconciling-legacy"
  | "complete"
  | "incomplete-error";

export function useFollowedWorkspace(options: {
  /** 共享 board 管线：带首入缓存与 force 刷新，错误按 surface 路由。 */
  loadBoard: (surface: HomeSurface, force?: boolean) => Promise<boolean>;
  /** board 成功后拿到的跟进索引原始行。 */
  boardKols: () => Array<Record<string, unknown>>;
  /** 当前绑定的 Starry 邮箱范围。 */
  followScope: StarryBinding | null;
  /** board 刚返回时的最新邮箱范围；避免首次进页仍捕获到上一帧的空 state。 */
  latestFollowScope: { current: StarryBinding | null };
  /** board 返回新范围时更新。 */
  setFollowScope: (scope: StarryBinding | null) => void;
  /** 跨模式选择状态（留在 Home）。 */
  selectedIds: string[];
  /** 用于投影卡片动作的任务列表。 */
  todoItems: Task[];
  /** 打开已有任务会话（由 Home 实现，避免 hook 依赖 Composer 状态）。 */
  openTask: (task: Task) => Promise<void>;
  /** 填充 Composer 提问框（由 Home 实现）。 */
  onFillComposer: (
    text: string,
    intent?: string,
    label?: string,
    refs?: ComposerObjectRef[],
  ) => void;
  /** 路由跳转（由 Home 的 react-router navigate 传入）。 */
  navigate: (to: string, options?: { state?: Record<string, unknown> }) => void;
  /** 非 surface 错误的兜底提示（映射到 Home 的 setErr）。 */
  onError: (message: string) => void;
  /** 释放成功后：清理选择并刷新公海面。 */
  onReleased: (kolId: string) => Promise<void>;
}) {
  const {
    loadBoard,
    boardKols,
    followScope,
    latestFollowScope,
    setFollowScope,
    selectedIds,
    todoItems,
    openTask,
    onFillComposer,
    navigate,
    onError,
    onReleased,
  } = options;

  const [rows, setRows] = useState<FollowedKol[]>([]);
  // 读取计数只解决请求竞态；空结论还要等完整性状态确认。
  const [readsInFlight, setReadsInFlight] = useState(0);
  const [readsDone, setReadsDone] = useState(0);
  const readSeq = useRef(0);
  const reconcileSeq = useRef(0);
  /** 最近一次跟进读取的来源：board-adapter 表示端点缺失、行来自 board 投影。 */
  const lastSourceRef = useRef<string>("following");
  const [completeness, setCompleteness] = useState<FollowListCompleteness>("loading-local");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<KolSortMode>("time");
  const [stageFilter, setStageFilter] = useState("");
  const [situation, setSituation] = useState<FollowedSituation | "">("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmStageBusyId, setConfirmStageBusyId] = useState<string | null>(null);
  const [confirmStageFeedback, setConfirmStageFeedback] = useState<{
    id: string;
    text: string;
    tone: "info" | "error";
  } | null>(null);
  const [batchPending, setBatchPending] = useState<FollowedKolCardModel[] | null>(null);
  /** Kept null by the click-is-confirmed flow; retained only for the current Home prop shape. */
  const [releaseTarget] = useState<FollowedKol | null>(null);
  const [releaseBusyId, setReleaseBusyId] = useState<string | null>(null);
  const releaseBusyRef = useRef<string | null>(null);
  /** Lets the row retain its failure feedback after finally clears releaseBusyId. */
  const [releaseErrorId, setReleaseErrorId] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  /** A failed/unknown release must read B.active before a subsequent write. */
  const releaseCheckRequired = useRef(new Set<string>());
  const verifiedFollowIds = useRef(new Map<string, string>());

  const cards = useMemo(
    () => rows.map((kol) => projectFollowedKolCard(kol, todoItems)),
    [rows, todoItems],
  );

  const visibleCards = useMemo(() => {
    const filtered = cards.filter(
      (card) =>
        matchesKolSearch(card, query)
        && matchesStageFilter(card, stageFilter)
        && matchesFollowedSituation(card, situation),
    );
    return sortFollowedKolCards(filtered, sort);
  }, [cards, query, sort, stageFilter, situation]);

  const selectedCards = useMemo(
    () => visibleCards.filter((card) => selectedIds.includes(card.id)),
    [visibleCards, selectedIds],
  );

  const selectedStageEnterCards = useMemo(
    () => followedStageEnterCards(selectedCards),
    [selectedCards],
  );

  // 只有完整合并确认过，空数组才是空名单。读取计数保留用于请求尚未发出/完成的首帧兜底。
  const loading = completeness === "loading-local"
    || completeness === "reconciling-legacy"
    || (!rows.length && (readsInFlight > 0 || readsDone === 0));

  const followEmptyKind = useMemo(() => {
    if (completeness === "loading-local") return "loading";
    if (completeness === "reconciling-legacy") return "reconciling";
    if (completeness === "incomplete-error") return "incomplete";
    if (loading) return "loading";
    if (followScope?.required && !followScope.bound) return "unbound";
    if (followScope?.status === "expired") return "expired";
    if (rows.length) return "filtered";
    if (followScope?.bound) return "mailbox";
    return "none";
  }, [completeness, followScope, loading, rows.length]);

  const readSurface = useCallback(async (): Promise<FollowedKol[] | null> => {
    // 进页会读取本地索引和合并后的兼容投影。两次可能落在同一屏，只有最后一份可以改 rows。
    readSeq.current += 1;
    const seq = readSeq.current;
    setReadsInFlight((count) => count + 1);
    try {
      const activeScope = followScope || latestFollowScope.current;
      const loaded = await sharedRead("home:following", () => loadHomeFollowing({
        kols: boardKols(),
        follow_scope: activeScope || undefined,
      }));
      if (seq !== readSeq.current) return null;
      lastSourceRef.current = loaded.source;
      if (loaded.follow_scope) {
        latestFollowScope.current = loaded.follow_scope;
        setFollowScope(loaded.follow_scope);
      }
      if (loaded.down) {
        // 读取失败不清空已经写在屏幕上的名单；空名单时才交给 down 视图。
        setError(loaded.error || "跟进列表读取失败");
        return null;
      }
      const nextRows = loaded.items.map(followKolToRecord) as FollowedKol[];
      setRows(nextRows);
      return nextRows;
    } finally {
      setReadsInFlight((count) => Math.max(0, count - 1));
      setReadsDone((count) => count + 1);
    }
  }, [boardKols, followScope, latestFollowScope, setFollowScope]);

  /** A direct refresh reads the current, already-known board scope as one complete snapshot. */
  const loadSurface = useCallback(async () => {
    reconcileSeq.current += 1;
    const seq = reconcileSeq.current;
    setCompleteness("loading-local");
    const loaded = await readSurface();
    if (seq !== reconcileSeq.current) return;
    if (loaded) setError("");
    setCompleteness(loaded ? "complete" : "incomplete-error");
  }, [readSurface]);

  const ensureLoaded = useCallback(async () => {
    // A non-empty B.active response may be displayed immediately, but its count
    // and an empty conclusion remain provisional until legacy mailbox rows are
    // merged. This prevents a false "暂无" flash for existing collaborations.
    reconcileSeq.current += 1;
    const seq = reconcileSeq.current;
    // Do not paint the previous visit's result page while this entry is being
    // refreshed. The fresh local/board snapshot will repopulate rows below.
    setRows([]);
    setReadsDone(0);
    setError("");
    setCompleteness("loading-local");
    const board = loadBoard("following");
    const localRows = await readSurface();
    if (seq !== reconcileSeq.current) return;
    if (!localRows) {
      setCompleteness("incomplete-error");
      return;
    }
    // 只有「确定不可能有旧协作」时才跳过对齐：范围未绑定时 B.active 索引即完整答案。
    // 范围未知（旧后端）或已绑定/过期时仍等 board 合并旧协作，也不闪一次假空；
    // 端点缺失的 board-adapter 模式必须先有 board 才能投影出名单。
    const scope = latestFollowScope.current;
    const legacyPossible = !scope || Boolean(scope.required && scope.bound && scope.status !== "expired");
    if (lastSourceRef.current !== "board-adapter" && !legacyPossible) {
      setCompleteness("complete");
      return;
    }
    setCompleteness("reconciling-legacy");
    const boardReady = await board;
    if (seq !== reconcileSeq.current) return;
    if (!boardReady) {
      setCompleteness("incomplete-error");
      return;
    }
    const mergedRows = await readSurface();
    if (seq !== reconcileSeq.current) return;
    if (mergedRows) {
      setError("");
    }
    setCompleteness(mergedRows ? "complete" : "incomplete-error");
  }, [loadBoard, readSurface]);

  const openDetails = useCallback(
    (card: FollowedKolCardModel, focusThread?: string) => {
      const kol = card.source;
      rememberJourney({
        kind: "kol",
        handle: kol.handle,
        stageCode: kol.stage_code,
        skillId: kol.unbound ? "creator_profile" : undefined,
        skillLabel: kol.unbound ? "达人画像" : undefined,
      });
      if (kol.unbound || (kol.follow_id && !kol.collaboration_id)) {
        onFillComposer(`达人画像 ${kol.handle}`, "creator_profile", "达人画像");
        return;
      }
      void api.openKolSession(kol.id).then((session) => {
        if (!session?.id) throw new Error("未能打开会话，请稍后重试。");
        sessionStorage.setItem(`kol-session:${session.id}`, "1");
        navigate(`/s/${session.id}`, { state: { kolSession: true, focusThread: focusThread || undefined } });
      }).catch((err) => {
        onError(err instanceof Error && err.message ? err.message : "未能打开会话，请稍后重试。");
      });
    },
    [navigate, onFillComposer, onError],
  );

  const compose = useCallback(
    (card: FollowedKolCardModel) => {
      const kol = card.source;
      onFillComposer(
        `写合作邮件 @${kol.handle}`,
        "email_compose",
        "写合作邮件",
        [{ kind: "kol", id: kol.handle, label: `@${kol.handle}` }],
      );
      rememberJourney({
        kind: "kol",
        handle: kol.handle,
        stageCode: kol.stage_code,
        skillId: "email_compose",
        skillLabel: "写合作邮件",
      });
    },
    [onFillComposer],
  );

  const confirmStage = useCallback(
    (card: FollowedKolCardModel) => {
      const kol = card.source;
      if (!card.recommended_action.can_write_stage || !card.recommended_action.target_stage_code) {
        setConfirmStageFeedback({
          id: card.id,
          text: HOME_CONFIRM_STAGE_BLOCKED_COPY,
          tone: "error",
        });
        return;
      }

      if (card.task && canOpenExistingTaskFlow(card.task)) {
        setConfirmStageBusyId(card.id);
        setConfirmStageFeedback({
          id: card.id,
          text: HOME_OPENED_EXISTING_SESSION_COPY,
          tone: "info",
        });
        rememberJourney({
          kind: "task",
          skillId: String(card.task.skill_id || card.task.skill || card.task.task_type || ""),
          skillLabel: card.task.title,
          handle: card.task.kol_name || kol.handle,
        });
        const goExisting = (sessionId: string, kolSession: boolean) => {
          sessionStorage.setItem(`task:${sessionId}`, card.task!.id);
          if (kolSession) sessionStorage.setItem(`kol-session:${sessionId}`, "1");
          navigate(`/s/${sessionId}`, {
            state: {
              kolSession,
              confirmStageOpenedExisting: true,
              confirmStageNotice: HOME_OPENED_EXISTING_SESSION_LANDED_COPY,
            },
          });
        };
        void (async () => {
          try {
            await new Promise((resolve) => window.setTimeout(resolve, 400));
            if (card.task!.session_id) {
              goExisting(card.task!.session_id, Boolean(card.task!.collaboration_id || card.task!.project_id));
              return;
            }
            const collabId = String(card.task!.collaboration_id || card.task!.project_id || "");
            if (collabId) {
              const session = await api.openKolSession(collabId);
              goExisting(session.id, true);
              return;
            }
            await openTask(card.task!);
          } catch (err) {
            setConfirmStageFeedback({
              id: card.id,
              text: err instanceof Error ? err.message : "未能打开已有会话",
              tone: "error",
            });
          } finally {
            setConfirmStageBusyId(null);
          }
        })();
        return;
      }

      rememberJourney({
        kind: "kol",
        handle: kol.handle,
        stageCode: kol.stage_code,
        skillId: "confirm_stage",
        skillLabel: "提出阶段变更",
      });
      setConfirmStageBusyId(card.id);
      setConfirmStageFeedback({
        id: card.id,
        text: "正在打开会话，尚未改正式阶段。",
        tone: "info",
      });
      void api.openKolSession(kol.id).then((session) => {
        if (!session?.id) throw new Error("未能打开会话，请稍后重试。");
        storePending(session.id, {
          text: `提出阶段变更 @${kol.handle} 到 ${card.recommended_action.target_stage_label}`,
          collaboration_id: kol.id,
          intent: "confirm_stage",
          entities: {
            handle: kol.handle,
            stage_code: card.recommended_action.target_stage_code,
          },
        });
        sessionStorage.setItem(`kol-session:${session.id}`, "1");
        navigate(`/s/${session.id}`, { state: { kolSession: true } });
      }).catch((err) => {
        setConfirmStageBusyId(null);
        const text = err instanceof Error && err.message ? err.message : "未能打开会话，请稍后重试。";
        setConfirmStageFeedback({
          id: card.id,
          text,
          tone: "error",
        });
        onError(text);
      });
    },
    [navigate, onError, openTask],
  );

  const runCardAction = useCallback(
    (card: FollowedKolCardModel) => {
      const kind = card.recommended_action.kind;
      if (kind === "profile") {
        openDetails(card);
        return;
      }
      if (kind === "confirm-stage") {
        confirmStage(card);
        return;
      }
      if ((kind === "confirm-send" || kind === "approval") && card.task && canOpenExistingTaskFlow(card.task)) {
        void openTask(card.task);
        return;
      }
      if (kind === "compose") {
        if (card.task && canOpenExistingTaskFlow(card.task)) {
          void openTask(card.task);
          return;
        }
        compose(card);
        return;
      }
      openDetails(card, card.focus_thread);
    },
    [compose, confirmStage, openDetails, openTask],
  );

  const openMail = useCallback(
    (card: FollowedKolCardModel) => {
      const conversationId = card.latest_fact.thread_id || card.focus_thread;
      navigate(mailHref(followScope?.mailbox_email || "", conversationId));
    },
    [followScope?.mailbox_email, navigate],
  );

  const runBatch = useCallback(() => {
    const targets = selectedStageEnterCards;
    if (!targets.length) return;
    if (targets.length === 1) {
      confirmStage(targets[0]);
      return;
    }
    setBatchPending(targets);
  }, [confirmStage, selectedStageEnterCards]);

  const confirmBatch = useCallback(() => {
    const first = batchPending?.[0];
    setBatchPending(null);
    if (first) confirmStage(first);
  }, [batchPending, confirmStage]);

  const cancelBatch = useCallback(() => {
    setBatchPending(null);
  }, []);

  /** B.active is the ownership authority used to reconcile a lost/failed release response. */
  const readReleaseStatus = useCallback(async (target: FollowedKol): Promise<FollowReleaseStatus> => {
    try {
      const following = await loadHomeFollowing();
      // Without B.active, a board-adapter empty list cannot prove that it was released.
      if (following.down || following.source !== "following") return { state: "uncertain" };
      const followId = String(following.items.find((item) => item.kol_uid === target.kol_uid)?.follow_id || "").trim();
      return followId ? { state: "active", followId } : { state: "released" };
    } catch {
      return { state: "uncertain" };
    }
  }, []);

  const commitReleasedFollow = useCallback(async (target: FollowedKol, followId: string) => {
    const kolId = target.id;
    const ownershipKey = String(target.kol_uid || kolId);
    setRows((current) => current.filter((row) => row.follow_id !== followId && row.id !== kolId && row.kol_uid !== target.kol_uid));
    verifiedFollowIds.current.delete(ownershipKey);
    releaseCheckRequired.current.delete(ownershipKey);
    setReleaseError(null);
    setReleaseErrorId(null);
    try {
      await onReleased(kolId);
    } catch (err) {
      // The release committed; only the cross-surface refresh failed.
      setError(err instanceof Error ? `已放回公海，但刷新公海失败：${err.message}` : "已放回公海，但刷新公海失败");
    }
  }, [onReleased]);

  const reconcileReleaseFailure = useCallback(async (target: FollowedKol, attemptedFollowId: string, failedMessage: string) => {
    const ownershipKey = String(target.kol_uid || target.id);
    const status = await readReleaseStatus(target);
    if (status.state === "released") {
      await commitReleasedFollow(target, attemptedFollowId);
      return;
    }
    setReleaseErrorId(target.id);
    if (status.state === "active") {
      verifiedFollowIds.current.set(ownershipKey, status.followId);
      releaseCheckRequired.current.delete(ownershipKey);
      setReleaseError(`${failedMessage}；已核对仍在我的跟进，可再次放回公海。`);
      return;
    }
    releaseCheckRequired.current.add(ownershipKey);
    setReleaseError(`${failedMessage}；当前无法核对放回状态，下次操作会先核对，未确认前不会重复放回。`);
  }, [commitReleasedFollow, readReleaseStatus]);

  /** “回公海” is the user's explicit confirmation; the controlled API still sends confirm=true. */
  const requestRelease = useCallback(async (target: FollowedKol) => {
    const kolId = target.id;
    const ownershipKey = String(target.kol_uid || kolId);
    let followId = verifiedFollowIds.current.get(ownershipKey) || String(target.follow_id || "").trim();
    if (!followId || releaseBusyRef.current) return;
    releaseBusyRef.current = kolId;
    setReleaseBusyId(kolId);
    setReleaseError(null);
    setReleaseErrorId(null);
    try {
      if (releaseCheckRequired.current.has(ownershipKey)) {
        const status = await readReleaseStatus(target);
        if (status.state === "released") {
          await commitReleasedFollow(target, followId);
          return;
        }
        if (status.state === "uncertain") {
          setReleaseErrorId(kolId);
          setReleaseError("当前无法核对放回状态，尚未重复放回；请稍后再试。");
          return;
        }
        releaseCheckRequired.current.delete(ownershipKey);
        verifiedFollowIds.current.set(ownershipKey, status.followId);
        followId = status.followId;
      }
      const released = await releaseFollowedKol(followId);
      if (!released.ok) {
        await reconcileReleaseFailure(target, followId, "放回公海未成功");
        return;
      }
      await commitReleasedFollow(target, followId);
    } catch (err) {
      // Do not remove the followed row or blindly issue a second release after a failed request.
      await reconcileReleaseFailure(target, followId, err instanceof Error ? err.message : "放回公海失败");
    } finally {
      releaseBusyRef.current = null;
      setReleaseBusyId(null);
    }
  }, [commitReleasedFollow, readReleaseStatus, reconcileReleaseFailure]);

  // Compatibility exports keep Home compiling until it removes ReleaseFollowConfirm.
  const cancelRelease = useCallback(() => {
    if (!releaseBusyRef.current) {
      setReleaseError(null);
      setReleaseErrorId(null);
    }
  }, []);
  const confirmRelease = useCallback(() => undefined, []);

  return {
    rows,
    cards,
    visibleCards,
    selectedCards,
    selectedStageEnterCards,
    query,
    setQuery,
    sort,
    setSort,
    stageFilter,
    setStageFilter,
    situation,
    setSituation,
    hoveredId,
    setHoveredId,
    focusedId,
    setFocusedId,
    error,
    setError,
    loading,
    completeness,
    followEmptyKind,
    confirmStageBusyId,
    confirmStageFeedback,
    batchPending,
    runBatch,
    confirmBatch,
    cancelBatch,
    releaseTarget,
    releaseBusy: Boolean(releaseBusyId),
    releaseBusyId,
    releaseError,
    releaseErrorId,
    requestRelease,
    confirmRelease,
    cancelRelease,
    loadSurface,
    ensureLoaded,
    openDetails,
    compose,
    confirmStage,
    openMail,
    runCardAction,
  };
}
