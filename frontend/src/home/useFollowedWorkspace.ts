import { useCallback, useMemo, useState } from "react";
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
  type FollowedKolCardModel,
  type FollowedKolRecord,
} from "../followedKolCard";
import { canOpenExistingTaskFlow } from "./homeModel";
import { followKolToRecord, type FollowKol } from "./kolContract";
import { loadHomeFollowing, releaseFollowedKol } from "./kolSurfaceApi";
import { matchesFollowedSituation, type FollowedSituation } from "./FollowedBrief";
import type { HomeSurface } from "./surfaceError";

export type FollowedKol = FollowedKolRecord;

export function useFollowedWorkspace(options: {
  /** 共享 board 管线：带首入缓存与 force 刷新，错误按 surface 路由。 */
  loadBoard: (surface: HomeSurface, force?: boolean) => Promise<void>;
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
  onFillComposer: (text: string, intent?: string, label?: string) => void;
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
  const [query, setQuery] = useState("");
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
  const [releaseTarget, setReleaseTarget] = useState<FollowedKol | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

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
    return sortFollowedKolCards(filtered, "need");
  }, [cards, query, stageFilter, situation]);

  const selectedCards = useMemo(
    () => visibleCards.filter((card) => selectedIds.includes(card.id)),
    [visibleCards, selectedIds],
  );

  const selectedStageEnterCards = useMemo(
    () => followedStageEnterCards(selectedCards),
    [selectedCards],
  );

  const followEmptyKind = useMemo(() => {
    if (followScope?.required && !followScope.bound) return "unbound";
    if (followScope?.status === "expired") return "expired";
    if (rows.length) return cards.length ? "filtered" : "filtered";
    if (followScope?.bound) return "mailbox";
    return "none";
  }, [followScope, rows.length, cards.length]);

  const loadSurface = useCallback(async () => {
    const activeScope = followScope || latestFollowScope.current;
    const loaded = await loadHomeFollowing({
      kols: boardKols(),
      follow_scope: activeScope || undefined,
    });
    if (loaded.follow_scope) {
      latestFollowScope.current = loaded.follow_scope;
      setFollowScope(loaded.follow_scope);
    }
    if (loaded.down) {
      setError(loaded.error || "跟进列表读取失败");
      setRows([]);
      return;
    }
    setError("");
    setRows(loaded.items.map(followKolToRecord) as FollowedKol[]);
  }, [boardKols, followScope, latestFollowScope, setFollowScope]);

  const ensureLoaded = useCallback(async () => {
    // B/C is the authoritative local memory projection. Read it first so the
    // result rail has data as soon as the user enters "我的红人"; the board is
    // only a compatibility/scope enrichment and must not delay that first view.
    await loadSurface();
    void loadBoard("following").then(() => loadSurface()).catch(() => undefined);
  }, [loadBoard, loadSurface]);

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
      if (kol.unbound) {
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
      onFillComposer(`写合作邮件 @${kol.handle}`, "email_compose", "写合作邮件");
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

  const requestRelease = useCallback((kol: FollowedKol) => {
    setReleaseError(null);
    setReleaseTarget(kol);
  }, []);

  const cancelRelease = useCallback(() => {
    if (releaseBusy) return;
    setReleaseTarget(null);
    setReleaseError(null);
  }, [releaseBusy]);

  const confirmRelease = useCallback(async () => {
    const target = releaseTarget;
    const followId = String(target?.follow_id || "").trim();
    if (!target || !followId) return;
    const kolId = target.id;
    setReleaseBusy(true);
    setReleaseError(null);
    try {
      await releaseFollowedKol(followId);
      setRows((current) => current.filter((row) => row.follow_id !== followId && row.id !== kolId));
      setReleaseTarget(null);
      await onReleased(kolId);
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : "释放失败");
    } finally {
      setReleaseBusy(false);
    }
  }, [releaseTarget, onReleased]);

  return {
    rows,
    cards,
    visibleCards,
    selectedCards,
    selectedStageEnterCards,
    query,
    setQuery,
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
    followEmptyKind,
    confirmStageBusyId,
    confirmStageFeedback,
    batchPending,
    runBatch,
    confirmBatch,
    cancelBatch,
    releaseTarget,
    releaseBusy,
    releaseError,
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
