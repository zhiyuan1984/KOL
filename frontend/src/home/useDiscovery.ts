import { useEffect, useMemo, useState } from "react";
import type { TaskEvent } from "../api";
import { presentDiscoveryError, type DiscoveryErrorView } from "./discovery-error";
import { discoveryStage, isCardVisible, type DiscoveryStage } from "./discoveryPhase";
import {
  presentDiscoveryEvents,
  presentDiscoveryThink,
  type DiscoveryProcessStep,
  type DiscoveryThink,
} from "./discoveryEvents";
import {
  ingestFailureBriefVersion,
  ingestFailureKind,
  ingestHomeDiscovery,
  isMissingEndpoint,
  loadDiscoveryCandidates,
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
  type HomeDiscoveryRun,
} from "./discoveryHome";

const DISCOVERY_FAILED_FALLBACK = "检索没有完成。可稍后重试。";

export type DiscoveryIngestState = "brief_mismatch" | "cancelled" | "pending" | null;

/**
 * AI发现的全部状态与副作用。视图被拆成中栏（条件卡 / 过程流）与右栏（结果区）
 * 两块，请求只在这里发一次，两栏不各自取数。
 *
 * `activeTaskId` / `activeRunId` 由提交方（Home）传入：切换页签只做 memory GET，
 * 不建会话、不调模型。
 */
export default function useDiscovery({
  activeTaskId = null,
  activeRunId = null,
  lastSubmit = null,
  onRetrySubmit,
}: {
  activeTaskId?: string | null;
  activeRunId?: string | null;
  /** 每次提交都换一个身份（提交方传同一个 state 对象）：用来把条件卡收起来。 */
  lastSubmit?: unknown;
  /** 没有 run 可重试时（提交就没成功），交回提交方重发。 */
  onRetrySubmit?: () => void;
}) {
  const [emptyKind, setEmptyKind] = useState<HomeDiscoveryEmptyKind>("idle");
  const [emptyMessage, setEmptyMessage] = useState("还没有搜索过红人线索。");
  const [candidates, setCandidates] = useState<HomeDiscoveryCandidate[]>([]);
  const [activeRun, setActiveRun] = useState<HomeDiscoveryRun | null>(null);
  const [runHistory, setRunHistory] = useState<HomeDiscoveryRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ignoredIds, setIgnoredIds] = useState<string[]>([]);
  /** 「查看详情」展开的行；只影响本地展示，不发请求。 */
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [polling, setPolling] = useState(false);
  const [failure, setFailure] = useState<DiscoveryErrorView | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [connection, setConnection] = useState<HomeDiscoveryConnection | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [approvalState, setApprovalState] = useState<DiscoveryIngestState>(null);
  const [ingestMissing, setIngestMissing] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  /** 「改条件再搜」把条件卡调回来；提交成功后再收起。 */
  const [cardPinned, setCardPinned] = useState(false);

  const visible = useMemo(
    () => candidates.filter((row) => !ignoredIds.includes(row.id) && row.status !== "dismissed"),
    [candidates, ignoredIds],
  );
  const selected = useMemo(
    () => visible.filter((row) => selectedIds.includes(row.id)),
    [visible, selectedIds],
  );
  const steps = useMemo(() => presentDiscoveryEvents(events), [events]);
  const think = useMemo(() => presentDiscoveryThink(events), [events]);
  const runId = activeRun?.id || activeRunId || "";
  const inFlight = polling || runInFlight(activeRun);
  const stage = discoveryStage({
    polling,
    runInFlight: runInFlight(activeRun),
    failure: Boolean(failure),
    visibleCount: visible.length,
    hasRun: Boolean(activeRun),
  });
  const cardVisible = isCardVisible(stage, cardPinned);

  // 提交（哪怕后端复用了同一个 run）就把卡片收起来：那之后中栏是过程流的地盘。
  useEffect(() => {
    if (lastSubmit) setCardPinned(false);
  }, [lastSubmit]);

  const loadExisting = async (preferRunId?: string | null) => {
    setFailure(null);
    const listed = await loadDiscoveryRuns();
    if (listed.down) {
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
      || rows[0]
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
      setExpandedIds([]);
      setApprovalState(null);
      setPendingConfirm(false);
      setIngestError(null);
      setIngestOpen(false);
    }
    const detail = await loadDiscoveryRun(chosen.id);
    if (detail.down) {
      setEmptyKind("down");
      setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
      setCandidates([]);
      setActiveRun(chosen);
      setEvents([]);
      return;
    }
    const current = detail.data || chosen;
    setActiveRun(current);
    const selectedEvents = current.work_item_id ? await loadTaskEvents(current.work_item_id).catch(() => []) : [];
    setEvents(selectedEvents);
    const reason = runFailureReason(current);
    const next = await loadDiscoveryCandidates(chosen.id);
    if (next.down) {
      setEmptyKind("down");
      setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
      setCandidates([]);
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
    try {
      setConnection(await loadDiscoveryConnection());
    } catch (error) {
      setConnection({
        status: "unreachable",
        label: "连接失败",
        message: presentDiscoveryError(error, "无法读取采集服务状态。").message,
        connected: false,
      });
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
  }, []);

  useEffect(() => {
    if (activeRunId) void loadExisting(activeRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId]);

  useEffect(() => {
    if (!activeTaskId || (activeRun?.work_item_id && activeRun.work_item_id !== activeTaskId)) {
      setPolling(false);
      return;
    }
    let cancelled = false;
    setPolling(true);
    setFailure(null);
    setToast(null);
    const poll = async () => {
      try {
        const rows = await loadTaskEvents(activeTaskId);
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
  }, [activeTaskId, activeRun?.id]);

  const toggleSelected = (id: string, on: boolean) => {
    setSelectedIds((current) => {
      if (on) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });
  };

  const selectAll = (on: boolean) => {
    setSelectedIds(on ? visible.map((row) => row.id) : []);
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
    if (!selected.length || ingestBusy) return;
    if (!runId) {
      setIngestError("没有可入库的发现运行。");
      return;
    }
    setIngestBusy(true);
    setIngestError(null);
    try {
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
        ingestedIds.has(row.id) ? { ...row, in_library: true } : row
      )));
      setSelectedIds((current) => current.filter((id) => !ingestedIds.has(id)));
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

  /**
   * 重新配条件：卡片回到中栏。提交（lastSubmit 变化）时自动收起。
   * 结果区的状态不动 —— 召回卡片不该改写上一次运行的事实。
   */
  const showCard = () => {
    setCardPinned(true);
  };

  const selectedPlatforms = Array.from(
    new Set(selected.map((row) => row.platform).filter(Boolean)),
  ) as string[];

  return {
    stage,
    cardVisible,
    showCard,
    inFlight,
    run: activeRun,
    runHistory,
    historyLoading,
    selectRun: selectHistoryRun,
    runId,
    candidates,
    visible,
    selected,
    selectedIds,
    selectedPlatforms,
    steps,
    think,
    failure,
    emptyKind,
    emptyMessage,
    connection,
    retryBusy,
    retryRun,
    checkCollector,
    toggleSelected,
    selectAll,
    expandedIds,
    toggleExpanded,
    ignoreCandidate,
    ingestOpen,
    ingestBusy,
    ingestError,
    pendingConfirm,
    approvalState,
    ingestMissing,
    toast,
    openIngest,
    confirmIngest,
    cancelIngest,
  };
}

export type DiscoveryState = ReturnType<typeof useDiscovery>;
export type { DiscoveryStage, DiscoveryThink, DiscoveryProcessStep };
