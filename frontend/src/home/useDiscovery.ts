import { useEffect, useMemo, useRef, useState } from "react";
import { api, type RuntimeActionView, type TaskEvent } from "../api";
import { presentDiscoveryError, type DiscoveryErrorView } from "./discovery-error";
import { discoveryCardMode, discoveryStage, type DiscoveryStage } from "./discoveryPhase";
import { discoveryParamsStale } from "./discoveryParams";
import {
  discoveryCrawlPhase,
  discoveryStartAction,
  discoveryStartPhase,
  type DiscoveryStartPhase,
} from "./discoveryStart";
import {
  presentDiscoveryEvents,
  presentDiscoveryNarrative,
  presentDiscoveryThink,
  type DiscoveryProcessStep,
  type DiscoveryThink,
} from "./discoveryEvents";
import {
  followHomeDiscoveryCandidate,
  ingestHomeDiscoveryCandidate,
  ingestFailureBriefVersion,
  ingestFailureKind,
  ingestHomeDiscovery,
  isMissingEndpoint,
  loadDiscoveryCandidates,
  loadSessionDiscovery,
  loadDiscoveryConnection,
  loadDiscoveryRun,
  loadDiscoveryRuns,
  loadTaskEvents,
  retryHomeDiscoveryRun,
  runFailureReason,
  runInFlight,
  type HomeDiscoveryCandidate,
  type HomeDiscoveryConnection,
  type HomeDiscoveryEmptyKind,
  type HomeDiscoveryIngestResult,
  type HomeDiscoveryRun,
} from "./discoveryHome";
import { isIngestSelectable } from "./discoveryLeadFields";
import { useSessionMessages } from "../components/ChatBlocks";

const DISCOVERY_FAILED_FALLBACK = "检索没有完成。可稍后重试。";

export type DiscoveryIngestState = "brief_mismatch" | "cancelled" | "pending" | null;
export type DiscoveryResultFilter = "all" | "ready" | "review" | "blocked" | "existing";

/** 采集没有终态前保持轮询；取得终态后停止（避免空转）。 */
const START_DONE: DiscoveryStartPhase[] = ["succeeded", "failed", "rejected", "cancelled", "uncertain"];
const CRAWL_DONE = ["succeeded", "failed", "cancelled", "partial", "uncertain"];
/** 这些相位必须在确认卡上给出服务端的真实原因，而不是只有「执行失败」四个字。 */
const START_REASON_PHASES = new Set<DiscoveryStartPhase>(["failed", "rejected", "uncertain", "cancelled"]);

/**
 * 交付任务（harness）自己是否已经收尾：`run.completed` / `run.failed` 之后不会再有
 * 新的 `run.*` 行（采集事件仍可能到，由调用方用 crawlPending 兜住）。早先过程流只在
 * 出现失败步骤或「已排出候选」时停表，于是采集从未发起时前端一直轮询、阶段一直是
 * running，⑥ 采集执行永远写着「正在采集 / 进行中」。
 */
function lifecycleSettled(rows: TaskEvent[]): boolean {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const type = String(rows[i].type || rows[i].event_type || "").toLowerCase();
    if (type === "run.completed" || type === "run.failed") return true;
    if (/^run\./.test(type)) return false;
  }
  return false;
}

/**
 * AI发现的全部状态与副作用。视图被拆成中栏（有序事件流）与右栏（结果区）
 * 两块，请求只在这里发一次，两栏不各自取数。
 *
 * `activeTaskId` / `activeRunId` / `sessionId` 由提交方（Home）传入：切换页签只做
 * memory GET，不建会话、不调模型；首次提交由 Home 唤起 pending 回合。
 */
export default function useDiscovery({
  activeTaskId = null,
  activeRunId = null,
  sessionId = null,
  lastSubmit = null,
  onRetrySubmit,
}: {
  activeTaskId?: string | null;
  activeRunId?: string | null;
  /** 正在协作的发现会话：实际采集参数与确认动作都按它读取。 */
  sessionId?: string | null;
  /** 每次提交都换一个身份（提交方传同一个 state 对象）：用来把条件卡转回只读。 */
  lastSubmit?: unknown;
  /** 没有 run 可重试时（提交就没成功），交回提交方重发。 */
  onRetrySubmit?: () => void;
}) {
  const session = useSessionMessages(sessionId || undefined);
  const [emptyKind, setEmptyKind] = useState<HomeDiscoveryEmptyKind>("idle");
  const [emptyMessage, setEmptyMessage] = useState("还没有搜索过红人线索。");
  const [candidates, setCandidates] = useState<HomeDiscoveryCandidate[]>([]);
  const [activeRun, setActiveRun] = useState<HomeDiscoveryRun | null>(null);
  const [runHistory, setRunHistory] = useState<HomeDiscoveryRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ignoredIds, setIgnoredIds] = useState<string[]>([]);
  /**
   * 行内「跟进」标记的候选：分拣意图（这条我要跟），不是排他认领。
   * 新模型后端禁止从发现路径直接创建 Collaboration（403），真正的认领
   * 发生在公海；标记会同时把该行加入入库选择，入库后去公海认领。
   */
  const [followUpIds, setFollowUpIds] = useState<string[]>([]);
  const [resultFilter, setResultFilter] = useState<DiscoveryResultFilter>("all");
  /** 「查看详情」展开的行；只影响本地展示，不发请求。 */
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [polling, setPolling] = useState(false);
  const [failure, setFailure] = useState<DiscoveryErrorView | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [connection, setConnection] = useState<HomeDiscoveryConnection | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const ingestSubmitting = useRef(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [approvalState, setApprovalState] = useState<DiscoveryIngestState>(null);
  const [ingestMissing, setIngestMissing] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [ingestReceipt, setIngestReceipt] = useState<HomeDiscoveryIngestResult | null>(null);
  /** 「修改条件」把条件卡调回可编辑；重新提交后再回只读。 */
  const [editingCard, setEditingCard] = useState(false);
  /** 会话内的受控动作（start_crawl / stop_crawl）：实际参数、确认与回执的权威来源。 */
  const [actions, setActions] = useState<RuntimeActionView[]>([]);
  const [actionsError, setActionsError] = useState("");
  /** 员工点击确认到服务端回执之间：立即显示「已确认，正在启动」，不重复提交。 */
  const [confirmingStart, setConfirmingStart] = useState(false);
  const [startError, setStartError] = useState("");
  const [startBusy, setStartBusy] = useState(false);
  const startSubmittingRef = useRef(false);
  const analyzingRef = useRef(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  /** 发现页首屏会同时触发两次只读恢复；只有最后一次读取允许回写状态。 */
  const loadSequenceRef = useRef(0);

  const available = useMemo(
    () => candidates.filter((row) => !ignoredIds.includes(row.id) && row.status !== "dismissed"),
    [candidates, ignoredIds],
  );
  const visible = useMemo(() => available.filter((row) => {
    if (resultFilter === "ready") return row.ingestReadiness === "ready";
    if (resultFilter === "review") return row.ingestReadiness === "needs_review";
    if (resultFilter === "blocked") return row.ingestReadiness === "needs_contact";
    if (resultFilter === "existing") {
      return row.ingestReadiness === "already_in_library" || row.ingestReadiness === "already_followed";
    }
    return true;
  }), [available, resultFilter]);
  const selected = useMemo(
    () => available.filter((row) => selectedIds.includes(row.id)),
    [available, selectedIds],
  );
  const followUpCount = useMemo(
    () => available.filter((row) => followUpIds.includes(row.id)).length,
    [available, followUpIds],
  );
  const selectableVisible = useMemo(() => visible.filter(isIngestSelectable), [visible]);
  const steps = useMemo(() => presentDiscoveryEvents(events), [events]);
  const think = useMemo(() => presentDiscoveryThink(events), [events]);
  const narrative = useMemo(() => presentDiscoveryNarrative(events), [events]);
  const runId = activeRun?.id || activeRunId || "";
  // Failure is terminal even when a stale run detail still says `running`.
  // The process stream must not keep its active treatment after its own event
  // feed has already reported an error.
  const inFlight = !failure && (polling || runInFlight(activeRun));
  const stage = discoveryStage({
    polling,
    runInFlight: runInFlight(activeRun),
    failure: Boolean(failure),
    visibleCount: visible.length,
    hasRun: Boolean(activeRun),
  });

  const startAction = useMemo(() => discoveryStartAction(actions), [actions]);
  const startPhase = discoveryStartPhase(startAction, confirmingStart);
  const crawlPhase = discoveryCrawlPhase(startAction);
  /** 采集作业仍在推进：服务端 runtime.crawl.stop 只接受 running / stopping，前端按同一口径给入口。 */
  const crawlRunning = ["running", "stopping"].includes(String(crawlPhase || ""));
  /** 还在等回执：确认已提交但没落定，或采集作业没到终态。这期间过程流还会增长。 */
  const crawlPending = ["dispatching", "starting", "running"].includes(startPhase)
    || (Boolean(startAction?.crawl) && !CRAWL_DONE.includes(String(crawlPhase || "")));
  /**
   * 服务端给出的执行结论（`progress`）。执行失败／未执行时把它显示出来：
   * 只写「执行失败」而把「已有任务占用采集服务、本次并未启动」留在服务端，等于让员工猜。
   */
  const startReason = START_REASON_PHASES.has(startPhase)
    ? String(startAction?.progress?.summary || "").trim()
    : "";
  /** 这一页已经提交过（提交身份或本任务已有运行）。 */
  const submitted = Boolean(lastSubmit) || Boolean(sessionId && activeTaskId)
    || Boolean(activeRun && activeTaskId && activeRun.work_item_id === activeTaskId);
  const cardMode = discoveryCardMode({ submitted, editing: editingCard });
  const paramsStale = discoveryParamsStale({ submitted, editing: editingCard });
  /** 右栏里的结果是否来自上一次运行（新运行尚未产出时不清空旧回执）。 */
  const runFromAnotherTask = Boolean(
    activeRun && activeTaskId && activeRun.work_item_id && activeRun.work_item_id !== activeTaskId,
  );
  const scoresPending = actions.some(action => action.crawl?.result_json?.candidates.some(candidate => candidate.assessment?.state === "scoring"));
  const resultReadPending = ["pending", "running"].includes(String(startAction?.crawl?.result_state || ""));
  const actionsSettled = START_DONE.includes(startPhase) && CRAWL_DONE.includes(String(crawlPhase)) && !scoresPending && !resultReadPending;

  // 提交（哪怕后端复用了同一个任务）就把卡片收回只读：那之后中栏是过程流的地盘。
  useEffect(() => {
    if (lastSubmit) setEditingCard(false);
  }, [lastSubmit]);

  const loadExisting = async (preferRunId?: string | null) => {
    const sequence = ++loadSequenceRef.current;
    const isCurrent = () => sequence === loadSequenceRef.current;
    setFailure(null);
    // 线索智能体会话是新结果链路的唯一事实源。只有没有 session_id 的
    // 历史入口才继续读取 legacy home discovery runs。
    if (sessionId) {
      const sessionResult = await loadSessionDiscovery(sessionId);
      if (!isCurrent()) return;
      setRunHistory([]);
      if (sessionResult.down) {
        setPolling(false);
        setEmptyKind("down");
        setEmptyMessage("线索智能体结果暂时不可用。已有输入会保留，可稍后重试。");
        setCandidates([]);
        setActiveRun(null);
        setEvents([]);
        return;
      }
      const current = sessionResult.run;
      setActiveRun(current);
      setCandidates(sessionResult.candidates);
      if (activeTaskId) {
        const nextEvents = await loadTaskEvents(activeTaskId).catch(() => []);
        if (!isCurrent()) return;
        setEvents(nextEvents);
      }
      if (current && sessionResult.candidates.length) {
        setEmptyKind("idle");
        return;
      }
      if (current && runInFlight(current)) {
        setEmptyKind("idle");
        setEmptyMessage("线索智能体正在读取候选资料。");
        return;
      }
      if (current?.error) {
        setFailure(presentDiscoveryError(current.error, DISCOVERY_FAILED_FALLBACK));
        setEmptyKind("idle");
        return;
      }
      // No action, an unconfirmed proposal or a missing/partial result is not
      // evidence of an empty search. Only a complete task snapshot can say zero.
      const crawl = sessionResult.action?.crawl;
      const snapshot = crawl?.result_json;
      if (crawl?.result_state !== "ready" || snapshot?.complete !== true || !Array.isArray(snapshot.candidates)) {
        setEmptyKind("idle");
        return;
      }
      setEmptyKind("filtered");
      setEmptyMessage("本任务的完整采集快照为 0 条候选；这不是筛选条件排除后的结论。可核对采集回执后再决定是否调整条件。");
      return;
    }
    const listed = await loadDiscoveryRuns();
    if (!isCurrent()) return;
    if (listed.down) {
      setPolling(false);
      setRunHistory([]);
      setEmptyKind("down");
      setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
      setCandidates([]);
      setActiveRun(null);
      setEvents([]);
      return;
    }
    const rows = listed.data;
    setRunHistory(rows);
    const chosen = rows.find((row) => row.id === preferRunId)
      || rows.find((row) => row.work_item_id && row.work_item_id === activeTaskId)
      || null;
    if (!chosen) {
      setActiveRun(null);
      setCandidates([]);
      setEvents([]);
      setEmptyKind("idle");
      setEmptyMessage("还没有搜索过红人线索。");
      return;
    }
    if (activeRun?.id !== chosen.id) {
      setSelectedIds([]);
      setIgnoredIds([]);
      setFollowUpIds([]);
      setResultFilter("all");
      setExpandedIds([]);
      setApprovalState(null);
      setPendingConfirm(false);
      setIngestError(null);
      setIngestOpen(false);
      setIngestReceipt(null);
    }
    const detail = await loadDiscoveryRun(chosen.id);
    if (!isCurrent()) return;
    if (detail.down) {
      setPolling(false);
      setEmptyKind("down");
      setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
      setCandidates([]);
      setActiveRun(null);
      setEvents([]);
      return;
    }
    const current = detail.data || chosen;
    setActiveRun(current);
    const selectedEvents = current.work_item_id ? await loadTaskEvents(current.work_item_id).catch(() => []) : [];
    if (!isCurrent()) return;
    setEvents(selectedEvents);
    const reason = runFailureReason(current);
    const next = await loadDiscoveryCandidates(chosen.id);
    if (!isCurrent()) return;
    if (next.down) {
      setPolling(false);
      setEmptyKind("down");
      setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
      setCandidates([]);
      setActiveRun(null);
      setEvents([]);
      return;
    }
    setCandidates(next.data);
    if (next.data.length) {
      // The Host keeps raw candidates when only the brief/ranking step failed
      // (rank_failed). Listing them beats hiding a usable shortlist behind an
      // error, so the reason becomes a banner above the results.
      if (reason !== null) setFailure(presentDiscoveryError(reason, DISCOVERY_FAILED_FALLBACK));
      return;
    }
    // A run that never produced a shortlist (collector down, ranking failed) has
    // its own reason. Reporting「筛选无结果」here would blame the filters for a
    // retrieval that never ran — the reason has to reach the employee.
    if (reason !== null) {
      setFailure(presentDiscoveryError(reason, DISCOVERY_FAILED_FALLBACK));
      setEmptyKind("idle");
      return;
    }
    if (runInFlight(current)) {
      setEmptyKind("idle");
      return;
    }
    setEmptyKind("filtered");
    setEmptyMessage("按当前条件没有入围线索。");
  };

  const retryRun = async () => {
    setFailure(null);
    if (!runId) {
      onRetrySubmit?.();
      return;
    }
    setRetryBusy(true);
    try {
      await retryHomeDiscoveryRun(runId);
      await loadExisting(runId);
    } catch (error) {
      setFailure(presentDiscoveryError(error, DISCOVERY_FAILED_FALLBACK));
    } finally {
      setRetryBusy(false);
    }
  };

  const selectHistoryRun = async (id: string) => {
    if (!id || id === activeRun?.id || historyLoading) return;
    setHistoryLoading(true);
    try {
      await loadExisting(id);
    } catch (error) {
      setFailure(presentDiscoveryError(error, DISCOVERY_FAILED_FALLBACK));
    } finally {
      setHistoryLoading(false);
    }
  };

  /** Employee-facing collector state — where a「采集服务未配置」run reason becomes actionable. */
  const checkCollector = async () => {
    if (checkingConnection) return;
    setCheckingConnection(true);
    try {
      setConnection(await loadDiscoveryConnection());
    } catch (error) {
      setConnection({
        status: "unreachable",
        label: "连接失败",
        message: presentDiscoveryError(error, "无法读取采集服务状态。").message,
        connected: false,
      });
    } finally {
      setCheckingConnection(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadExisting(activeRunId).catch(() => {
      if (cancelled) return;
      setEmptyKind("down");
      setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
    });
    // Tab switch: GET runs / runs/:id / candidates only. Never /discovery/batches. Never create a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (activeRunId) void loadExisting(activeRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId]);

  // 任务身份在挂载之后才到（?resume= 恢复现场、任务记录点进来）：按 work_item_id 认领本次运行。
  useEffect(() => {
    if (activeRunId || !activeTaskId) return;
    void loadExisting(null).catch(() => {
      setEmptyKind("down");
      setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskId]);

  // 采集与候选评分都有独立终态；评分仍在进行时继续读取回执，不能随采集一起停表。
  useEffect(() => {
    if (!sessionId) {
      setActions([]);
      return;
    }
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const data = await api.runtimeActions(sessionId);
        if (cancelled) return;
        setActions(data.actions);
        setActionsError("");
        // runtime action 可能先于远端 crawl 结束：start_crawl 会在 13:48:45
        // 先变为 succeeded，但 crawl.result_json 要到远端终态后才出现。
        // 轮询一旦看到结果快照 ready，必须重新读取 session projection，
        // 否则右栏会永久停在「等待候选结果」。
        const start = data.actions.find((item) => item.operation === "start_crawl");
        const crawl = start?.crawl;
        if (crawl && (crawl.result_state === "ready" || Boolean(crawl.result_json?.candidates))) {
          void loadExisting(null);
        }
      } catch (error) {
        if (cancelled) return;
        setActionsError(presentDiscoveryError(error, "读取采集动作失败，可稍后重试。").message);
      }
    };
    const refresh = () => void poll();
    window.addEventListener("discovery:candidates-refresh", refresh);
    if (!actionsSettled) {
      void poll();
      timer = window.setInterval(refresh, 2000);
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("discovery:candidates-refresh", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, actionsSettled]);

  useEffect(() => {
    const eventsReady = Boolean(activeTaskId)
      && (Boolean(activeRun) || startPhase !== "waiting_proposal")
      && (!activeRun || !activeRun.work_item_id || activeRun.work_item_id === activeTaskId);
    if (!eventsReady) {
      setPolling(false);
      return;
    }
    let cancelled = false;
    setPolling(true);
    setFailure(null);
    setToast(null);
    const poll = async () => {
      try {
        const rows = await loadTaskEvents(activeTaskId!);
        if (cancelled) return true;
        setEvents(rows);
        const next = presentDiscoveryEvents(rows);
        const failedStep = next.find((step) => step.kind === "failed");
        const ranked = next.some((step) => step.kind === "ranked");
        if (failedStep) {
          setFailure(presentDiscoveryError(failedStep.label, DISCOVERY_FAILED_FALLBACK));
          setPolling(false);
          return true;
        }
        if (ranked) {
          setPolling(false);
          await loadExisting(activeRunId);
          return true;
        }
        // 交付任务收尾且没有待落定的确认或采集：过程流不会再增长。
        if (!crawlPending && lifecycleSettled(rows)) {
          setPolling(false);
          return true;
        }
      } catch (error) {
        if (cancelled) return true;
        if (isMissingEndpoint(error)) {
          setEvents([]);
          setPolling(false);
          setFailure(presentDiscoveryError(
            "过程订阅不可用，后端尚未提供 GET /api/tasks/:id/events。",
            DISCOVERY_FAILED_FALLBACK,
          ));
          return true;
        }
        setFailure(presentDiscoveryError(error, "过程读取失败。"));
        setPolling(false);
        return true;
      }
      return false;
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll().then((done) => {
        if (done) window.clearInterval(timer);
      });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskId, activeRun?.id, startPhase, crawlPhase]);

  const toggleSelected = (id: string, on: boolean) => {
    setSelectedIds((current) => {
      if (on) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });
  };

  /**
   * 二期「跟进」：创建线索 + 更新 Starry 库表（真实动作，替代原来的本地分拣标记）。
   * 成功后该行标「已跟进」；失败抛错由卡片行内展示。
   */
  const followUpCandidate = async (id: string, runId?: string): Promise<void> => {
    const result = await followHomeDiscoveryCandidate(id, runId);
    if (!result.ok) throw new Error("跟进没有完成。");
    setFollowUpIds((current) => (current.includes(id) ? current : [...current, id]));
    setCandidates((current) => current.map((row) => (
      row.id === id
        ? {
            ...row,
            status: "followed",
            ...(result.starry_imported
              ? {
                  in_library: true,
                  libraryStatus: "pool",
                  ingestReadiness: "already_in_library",
                  ingestBlockReason: "跟进时已写入 Starry 公海，不重复导入。",
                }
              : {}),
          }
        : row
    )));
    // 跟进顺带写 Starry：失败不破坏跟进（上面已标已跟进），但必须如实告知。
    if (result.starry_imported === false && result.starry_error) {
      throw new Error(`已跟进，但 Starry 入库未完成：${result.starry_error}`);
    }
  };

  /**
   * 二期「加入公海」：单候选 Starry 入库。成功后该行标已在库并取消选中。
   */
  const ingestCandidate = async (id: string, runId?: string): Promise<void> => {
    const result = await ingestHomeDiscoveryCandidate(id, runId);
    if (!result.ok) throw new Error("入库没有完成。");
    setCandidates((current) => current.map((row) => (
      row.id === id
        ? {
            ...row,
            in_library: true,
            libraryStatus: "pool",
            ingestReadiness: "already_in_library",
            ingestBlockReason: "该红人已写入 Starry 公海，不重复导入。",
          }
        : row
    )));
    setSelectedIds((current) => current.filter((item) => item !== id));
  };

  const selectAll = (on: boolean) => {
    const ids = new Set(selectableVisible.map((row) => row.id));
    setSelectedIds((current) => on
      ? [...new Set([...current, ...ids])]
      : current.filter((id) => !ids.has(id)));
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  const ignoreCandidate = (id: string) => {
    setIgnoredIds((current) => (current.includes(id) ? current : [...current, id]));
  };

  const openIngest = () => {
    setIngestError(null);
    setIngestMissing(false);
    setApprovalState((current) => (current === "brief_mismatch" || current === "cancelled" ? null : current));
    setPendingConfirm(false);
    setIngestOpen(true);
  };

  const confirmIngest = async () => {
    if (!selected.length || ingestBusy || ingestSubmitting.current) return;
    if (!runId) {
      setIngestError("没有可入库的发现运行。");
      return;
    }
    ingestSubmitting.current = true;
    setIngestBusy(true);
    setIngestError(null);
    try {
      if (sessionId) {
        let completed = 0;
        for (const candidate of selected) {
          const action = actions.find(row => row.crawl?.result_json?.candidates.some(item => item.id === candidate.id));
          const snapshot = action?.crawl?.result_json?.candidates.find(item => item.id === candidate.id)?.snapshot_version;
          if (!action || !snapshot) throw new Error("候选资料版本缺失，请刷新核对后入库。");
          const receipt = await api.discoveryCandidateCommand(action.id, candidate.id, "ingest", snapshot);
          if (!receipt.ok) throw new Error("操作结果尚未确认，请刷新核对。");
          completed += 1;
          setSelectedIds(current => current.filter(id => id !== candidate.id));
          setToast(`本次已取得 ${completed} 位候选的入库回执。`);
        }
        await refreshActions();
        window.dispatchEvent(new Event("discovery:candidates-refresh"));
        setIngestOpen(false);
        return;
      }
      const result = await ingestHomeDiscovery({
        run_id: runId,
        candidate_ids: selected.map((row) => row.id),
        expected_brief_version: activeRun?.brief_version || 1,
        confirmed: true,
      });
      if (result.pending_approval || result.approval_status === "needs_confirmation") {
        setPendingConfirm(true);
        setIngestError("需要确认后才能入库公海。不会建联，也不会领取跟进。");
        return;
      }
      const ingestedIds = new Set(result.ingested.map((row) => row.id));
      setCandidates((current) => current.map((row) => (
        ingestedIds.has(row.id)
          ? {
              ...row,
              in_library: true,
              libraryStatus: "pool",
              ingestReadiness: "already_in_library",
              ingestBlockReason: "该红人已写入 Starry 公海，不重复导入。",
            }
          : row
      )));
      setSelectedIds((current) => current.filter((id) => !ingestedIds.has(id)));
      setFollowUpIds((current) => current.filter((id) => !ingestedIds.has(id)));
      setIngestReceipt(result);
      if (result.failed.length) {
        setIngestError(
          `已入库 ${result.ingested.length} 人，未入库 ${result.failed.length} 人。未成功的条目不会标成已在库。`,
        );
        return;
      }
      setPendingConfirm(false);
      setIngestOpen(false);
      setToast("去公海看这批");
    } catch (error) {
      const kind = ingestFailureKind(error);
      if (kind === "missing") {
        setPendingConfirm(false);
        setIngestOpen(false);
        setIngestMissing(true);
        setIngestError(null);
        return;
      }
      if (kind === "needs_confirmation") {
        setPendingConfirm(true);
        setIngestError("需要确认后才能入库公海。不会建联，也不会领取跟进。");
        return;
      }
      if (kind === "brief_mismatch" || kind === "voided") {
        const nextVersion = ingestFailureBriefVersion(error);
        if (nextVersion) {
          setActiveRun((current) => current ? { ...current, brief_version: nextVersion } : current);
        }
        setPendingConfirm(false);
        setIngestOpen(false);
        setIngestError(null);
        setFailure(null);
        setToast(null);
        setApprovalState("brief_mismatch");
        void loadExisting(runId);
        return;
      }
      if (kind === "cancelled") {
        setPendingConfirm(false);
        setIngestOpen(false);
        setIngestError(null);
        setToast(null);
        setApprovalState("cancelled");
        return;
      }
      setIngestError(presentDiscoveryError(error, "入库没有完成，未建联也未发信。").message);
    } finally {
      if (sessionId) { await refreshActions(); window.dispatchEvent(new Event("discovery:candidates-refresh")); }
      ingestSubmitting.current = false;
      setIngestBusy(false);
    }
  };

  const cancelIngest = async () => {
    const shouldCancel = pendingConfirm && Boolean(runId) && selected.length;
    setIngestOpen(false);
    setIngestError(null);
    if (!shouldCancel || !runId) {
      setPendingConfirm(false);
      return;
    }
    try {
      await ingestHomeDiscovery({
        run_id: runId,
        candidate_ids: selected.map((row) => row.id),
        expected_brief_version: activeRun?.brief_version || 1,
        cancel: true,
      });
    } catch (error) {
      if (!isMissingEndpoint(error)) {
        setIngestError(presentDiscoveryError(error, "取消没有完成。未入库，也未领取跟进。").message);
      }
    } finally {
      setPendingConfirm(false);
    }
  };

  const refreshActions = async () => {
    if (!sessionId) return;
    try {
      const data = await api.runtimeActions(sessionId);
      setActions(data.actions);
      setActionsError("");
    } catch (error) {
      setActionsError(presentDiscoveryError(error, "读取采集动作失败，可稍后重试。").message);
    }
  };

  /**
   * 确认开始采集：服务端待确认动作。点击后立即显示「已确认，正在启动」并移除确认
   * 按钮（禁止重复提交）；失败只报告原因，不自动重试。
   */
  const confirmStart = async () => {
    const action = startAction;
    if (!action || action.state !== "pending" || action.execution || !action.confirmation_version || startSubmittingRef.current) return;
    startSubmittingRef.current = true;
    setStartError("");
    setConfirmingStart(true);
    setStartBusy(true);
    try {
      await api.confirmRuntimeAction(action.id, action.confirmation_version);
    } catch (error) {
      setStartError(presentDiscoveryError(error, "确认没有完成，未发起采集。可稍后重试。").message);
    } finally {
      await refreshActions();
      startSubmittingRef.current = false;
      setConfirmingStart(false);
      setStartBusy(false);
    }
  };

  /** 取消未确认的提案（不执行任何外部动作）。 */
  const cancelStart = async () => {
    const action = startAction;
    if (!action || action.state !== "pending" || action.execution || startSubmittingRef.current) return;
    startSubmittingRef.current = true;
    setStartError("");
    setStartBusy(true);
    try {
      await api.cancelRuntimeAction(action.id);
    } catch (error) {
      setStartError(presentDiscoveryError(error, "取消没有完成。未发起采集。").message);
    } finally {
      await refreshActions();
      startSubmittingRef.current = false;
      setStartBusy(false);
    }
  };

  /** 失败或结果不确定后重新核对并重试（服务端受限动作）。 */
  const retryStart = async () => {
    const action = startAction;
    if (!action || startSubmittingRef.current) return;
    startSubmittingRef.current = true;
    setStartError("");
    setStartBusy(true);
    try {
      await api.proposeCrawlRetry(action.id);
    } catch (error) {
      setStartError(presentDiscoveryError(error, "重试没有提出，请核对任务状态。").message);
    } finally {
      await refreshActions();
      startSubmittingRef.current = false;
      setStartBusy(false);
    }
  };

  /** 停止采集（独立动作与回执，不覆盖已取得候选）。 */
  const stopStart = async () => {
    const action = startAction;
    if (!action || startSubmittingRef.current) return;
    startSubmittingRef.current = true;
    setStartError("");
    setStartBusy(true);
    try {
      await api.proposeCrawlStop(action.id);
    } catch (error) {
      setStartError(presentDiscoveryError(error, "停止申请没有提出，请核对任务状态。").message);
    } finally {
      await refreshActions();
      startSubmittingRef.current = false;
      setStartBusy(false);
    }
  };

  /** Cancel the saved queue slot through the existing server command. */
  const dequeueStart = async () => {
    const action = startAction;
    if (!action || !["queued", "uncertain"].includes(action.crawl?.state || "") || startSubmittingRef.current) return;
    startSubmittingRef.current = true;
    setStartBusy(true);
    setStartError("");
    try { await api.dequeueCrawl(action.id); }
    catch (error) { setStartError(presentDiscoveryError(error, "无法取消排队，请刷新核对任务状态。").message); }
    finally {
      await refreshActions();
      startSubmittingRef.current = false;
      setStartBusy(false);
    }
  };

  const analyzeCandidates = async (remoteTaskId: string) => {
    if (!sessionId || !activeTaskId || analyzingRef.current || session.agentStatus === "running") return;
    // Only a task-scoped receipt may supply the candidate snapshot for analysis.
    if (!actions.some(action => action.crawl?.result_json?.task_id === remoteTaskId)) return;
    analyzingRef.current = true;
    setAnalyzing(true);
    setAnalysisError("");
    try {
      const response = await api.postMessage(sessionId, {
        text: `请基于本任务已保存的发现条件与采集 ${remoteTaskId} 的候选快照，整理可复核简报：候选证据、符合与不符合的条件、无法核验项和下一步。区分采集样本均播与真实最近10条均播；不要重新采集、导入或发信。`,
        intent: "crawler_collect", work_item_id: activeTaskId,
      });
      session.setMessages(response.messages || []);
      session.setAgentStatus(String(response.agent_status || (response.accepted ? "running" : "listening")));
      await loadExisting();
    } catch (error) {
      setAnalysisError(presentDiscoveryError(error, "候选分析没有提交，可重试；原候选与回执仍保留。").message);
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
      await refreshActions();
    }
  };

  /**
   * 修改条件：条件卡回到可编辑（原位，不新建第二张卡）。上一次参数核对随之失效；
   * 尚未确认的提案一并取消 —— 取消不执行任何外部动作。
   */
  const editConditions = () => {
    setEditingCard(true);
    if (startAction?.state === "pending" && !startAction.execution) void cancelStart();
  };

  const selectedPlatforms = Array.from(
    new Set(selected.map((row) => row.platform).filter(Boolean)),
  ) as string[];
  // The persisted request identifies this report after reload as well as live.
  let analysisRequest = -1;
  session.messages.forEach((message, index) => {
    // An earlier analysis request must not relabel a later, unrelated turn.
    if (message.kind === "me") analysisRequest = String((message.payload as Record<string, unknown>).text || "")
      .startsWith("请基于本任务已保存的发现条件与采集 ") ? index : -1;
  });
  const analysisMessages = !session.err && session.sessionLoaded && analysisRequest >= 0
    ? session.messages.slice(analysisRequest + 1).filter(message => !["me", "operation", "process", "system"].includes(message.kind)) : [];

  return {
    sessionId,
    stage,
    cardMode,
    editConditions,
    submitted,
    paramsStale,
    inFlight,
    run: activeRun,
    runFromAnotherTask,
    runHistory,
    historyLoading,
    selectRun: selectHistoryRun,
    runId,
    candidates,
    available,
    visible,
    resultFilter,
    setResultFilter,
    selected,
    selectableVisible,
    selectedIds,
    selectedPlatforms,
    steps,
    think,
    narrative,
    failure,
    emptyKind,
    emptyMessage,
    connection,
    checkingConnection,
    retryBusy,
    retryRun,
    checkCollector,
    actions,
    receiveActions: setActions,
    actionsError,
    reloadActions: refreshActions,
    startAction,
    startPhase,
    crawlPhase,
    crawlRunning,
    crawlPending,
    startReason,
    startError,
    startBusy,
    confirmStart: () => void confirmStart(),
    cancelStart: () => void cancelStart(),
    retryStart: () => void retryStart(),
    stopStart: () => void stopStart(),
    dequeueStart: () => void dequeueStart(),
    analyzeCandidates: (taskId: string) => void analyzeCandidates(taskId),
    analyzing: analyzing || (!session.err && session.sessionLoaded && analysisRequest >= 0 && session.agentStatus === "running"),
    analysisMessages,
    analysisReadError: session.err,
    refreshAnalysis: session.reload,
    analysisError,
    toggleSelected,
    selectAll,
    expandedIds,
    toggleExpanded,
    ignoreCandidate,
    followUpIds,
    followUpCandidate,
    ingestCandidate,
    followUpCount,
    ingestOpen,
    ingestBusy,
    ingestError,
    pendingConfirm,
    approvalState,
    ingestMissing,
    toast,
    ingestReceipt,
    openIngest,
    confirmIngest,
    cancelIngest,
  };
}

export type DiscoveryState = ReturnType<typeof useDiscovery>;
export type { DiscoveryStage, DiscoveryThink, DiscoveryProcessStep };
