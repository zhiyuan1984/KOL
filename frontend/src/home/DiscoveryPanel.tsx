import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { presentDiscoveryError, type DiscoveryErrorView } from "./discovery-error";
import { DiscoveryIngestConfirm } from "./DiscoveryIngestConfirm";
import {
  presentDiscoveryEvents,
  type DiscoveryProcessStep,
} from "./discoveryEvents";
import {
  displayMetric,
  displayText,
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
  runCountsLabel,
  runFailureReason,
  runHeadline,
  runInFlight,
  type HomeDiscoveryCandidate,
  type HomeDiscoveryConnection,
  type HomeDiscoveryEmptyKind,
  type HomeDiscoveryRun,
} from "./discoveryHome";
import { platformLabel } from "./discoveryTemplate";

const DISCOVERY_FAILED_FALLBACK = "检索没有完成。可稍后重试。";

type DiscoveryPanelProps = {
  templateOpen?: boolean;
  activeTaskId?: string | null;
  activeRunId?: string | null;
  onOpenTemplate: () => void;
  onRetryRun?: () => void;
};

// 条件卡与提问框正文已接管发现条件与提交（AI 提问框的发送按钮是唯一提交入口）；
// 面板内不再需要 templateOpen / onOpenTemplate，两者保留在 prop 签名里，Home 的调用点不必改。
export default function DiscoveryPanel({
  templateOpen = false,
  activeTaskId = null,
  activeRunId = null,
  onOpenTemplate,
  onRetryRun,
}: DiscoveryPanelProps) {
  const [emptyKind, setEmptyKind] = useState<HomeDiscoveryEmptyKind>("idle");
  const [emptyMessage, setEmptyMessage] = useState("还没有搜索过红人线索。");
  const [candidates, setCandidates] = useState<HomeDiscoveryCandidate[]>([]);
  const [activeRun, setActiveRun] = useState<HomeDiscoveryRun | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ignoredIds, setIgnoredIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<DiscoveryProcessStep[]>([]);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<DiscoveryErrorView | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [connection, setConnection] = useState<HomeDiscoveryConnection | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [approvalState, setApprovalState] = useState<string | null>(null);
  const [ingestMissing, setIngestMissing] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const visible = useMemo(
    () => candidates.filter((row) => !ignoredIds.includes(row.id) && row.status !== "dismissed"),
    [candidates, ignoredIds],
  );
  const selected = useMemo(
    () => visible.filter((row) => selectedIds.includes(row.id)),
    [visible, selectedIds],
  );
  const runId = activeRun?.id || activeRunId || "";
  const inFlight = running || runInFlight(activeRun);
  const failed = Boolean(failure);

  const loadExisting = async (preferRunId?: string | null) => {
    setFailure(null);
    const listed = await loadDiscoveryRuns();
    if (listed.down) {
      setEmptyKind("down");
      setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
      setCandidates([]);
      setActiveRun(null);
      return;
    }
    const rows = listed.data;
    const chosen = rows.find((row) => row.id === preferRunId)
      || rows.find((row) => row.work_item_id && row.work_item_id === activeTaskId)
      || rows[0]
      || null;
    if (!chosen) {
      setActiveRun(null);
      setCandidates([]);
      setEmptyKind("idle");
      setEmptyMessage("还没有搜索过红人线索。");
      return;
    }
    const detail = await loadDiscoveryRun(chosen.id);
    if (detail.down) {
      setEmptyKind("down");
      setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
      setCandidates([]);
      setActiveRun(chosen);
      return;
    }
    const current = detail.data || chosen;
    setActiveRun(current);
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
      onRetryRun?.();
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
      if (!cancelled) {
        setEmptyKind("down");
        setEmptyMessage("发现服务不可用。已有输入会保留，可稍后重试。");
      }
    });
    return () => {
      cancelled = true;
    };
    // Tab switch: GET runs / runs/:id / candidates only. Never /discovery/batches. Never create a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeRunId) void loadExisting(activeRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId]);

  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;
    setRunning(true);
    setFailure(null);
    setToast(null);
    const poll = async () => {
      try {
        const events = await loadTaskEvents(activeTaskId);
        if (cancelled) return;
        const next = presentDiscoveryEvents(events);
        setSteps(next);
        const failedStep = next.find((step) => step.kind === "failed");
        const ranked = next.some((step) => step.kind === "ranked");
        if (failedStep) {
          setFailure(presentDiscoveryError(failedStep.label, DISCOVERY_FAILED_FALLBACK));
          setRunning(false);
          return true;
        }
        if (ranked) {
          setRunning(false);
          await loadExisting(activeRunId);
          return true;
        }
      } catch (error) {
        if (cancelled) return true;
        if (isMissingEndpoint(error)) {
          setSteps([]);
          setRunning(false);
          setFailure(presentDiscoveryError(
            "过程订阅不可用，后端尚未提供 GET /api/tasks/:id/events。",
            DISCOVERY_FAILED_FALLBACK,
          ));
          return true;
        }
        setFailure(presentDiscoveryError(error, "过程读取失败。"));
        setRunning(false);
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
  }, [activeTaskId]);

  const toggleSelected = (id: string, on: boolean) => {
    setSelectedIds((current) => {
      if (on) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });
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

  const platforms = Array.from(new Set(selected.map((row) => row.platform).filter(Boolean))) as string[];
  const showResults = visible.length > 0 && !running;

  return (
    <section
      className="home-mode-pane discovery-pane"
      data-home-pane="discovery"
      data-discovery-panel
      data-discovery-live="false"
      data-discovery-running={inFlight ? "true" : undefined}
    >
      {steps.length ? (
        <ol className="discovery-process" data-discovery-process role="status" aria-busy={running || undefined}>
          {steps.map((step) => (
            <li key={step.id} data-discovery-event={step.kind}>{step.label}</li>
          ))}
        </ol>
      ) : null}

      {inFlight && !visible.length ? (
        <section className="task-empty" data-discovery-loading role="status" aria-busy="true">
          <strong>{steps.length ? steps[steps.length - 1].label : runInFlight(activeRun) ? "排队" : ""}</strong>
          <p>正在按已确认的条件检索红人线索。不会发信、不会改阶段、不会编造结果。</p>
        </section>
      ) : null}

      {failure ? (
        <section className="task-empty discovery-error" data-discovery-error role="alert">
          <strong>{failure.title}</strong>
          <p data-discovery-error-message>{failure.message}</p>
          {failure.detail ? <p data-discovery-error-detail>{failure.detail}</p> : null}
          {runId || onRetryRun ? (
            <div className="discovery-error-actions">
              <button
                type="button"
                className="btn work sm"
                data-discovery-retry
                data-home-entry="retry-discovery-run"
                disabled={retryBusy || (!runId && failure.retryDisabled)}
                onClick={() => void retryRun()}
              >
                {failure.retryLabel}
              </button>
              {failure.checkConnection ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  data-discovery-check-connection
                  onClick={() => void checkCollector()}
                >
                  检查采集服务
                </button>
              ) : null}
            </div>
          ) : null}
          {connection ? (
            <p data-discovery-connection={connection.status}>
              {`采集服务：${connection.label}${connection.message && connection.message !== connection.label ? ` · ${connection.message}` : ""}`}
            </p>
          ) : null}
        </section>
      ) : null}

      {approvalState === "brief_mismatch" ? (
        <section className="task-empty" data-discovery-brief-mismatch role="alert">
          <strong>确认已作废</strong>
          <p>发现 Brief 已变化，原确认作废。请按当前 Brief 重新确认入库。不会建联，也不会领取跟进。</p>
        </section>
      ) : approvalState === "cancelled" ? (
        <section className="task-empty" data-discovery-ingest-cancelled role="status">
          <strong>已取消入库</strong>
          <p>该确认已取消，未写入达人库。不会建联，也不会领取跟进。</p>
        </section>
      ) : approvalState ? (
        <section className="task-empty" data-discovery-approval={approvalState} role="status">
          <strong>待审批</strong>
          <p>入库已提交，正在等待审批。审批链由服务端返回，前端不自行推算。</p>
        </section>
      ) : null}

      {ingestMissing ? (
        <div className="task-empty" data-discovery-empty="ingest-missing">
          <strong>入库接口尚未提供</strong>
          <p>不会建联，不会发信，也不会领取跟进。可稍后重试。</p>
        </div>
      ) : null}

      {toast ? (
        <p className="discovery-toast" data-discovery-toast role="status">
          <Link to="/?tab=pool" data-discovery-pool-link>{toast}</Link>
        </p>
      ) : null}

      {showResults ? (
        <>
          <header className="discovery-result-head">
            <h2 data-discovery-headline>{runHeadline(activeRun)}</h2>
            <p data-discovery-counts>{runCountsLabel(activeRun, visible.length)}</p>
          </header>
          <div
            className={"discovery-run-bar" + (selected.length ? " is-selecting" : "")}
            data-discovery-run-bar
          >
            <label className="discovery-candidate-select">
              <input
                type="checkbox"
                data-discovery-select-all
                checked={visible.length > 0 && selected.length === visible.length}
                onChange={(event) => setSelectedIds(event.target.checked ? visible.map((row) => row.id) : [])}
              />
              <span>已选 {selected.length} 人</span>
            </label>
            {selected.length ? (
              <button
                type="button"
                className="btn work sm"
                data-discovery-ingest
                data-home-entry="discovery-ingest"
                onClick={() => {
                  setIngestError(null);
                  setIngestMissing(false);
                  setApprovalState((current) => (
                    current === "brief_mismatch" || current === "cancelled" ? null : current
                  ));
                  setPendingConfirm(false);
                  setIngestOpen(true);
                }}
              >
                {`入库公海（${selected.length}）`}
              </button>
            ) : null}
          </div>
          <ol className="discovery-candidate-list" data-discovery-candidates>
            {visible.map((candidate) => (
              <li key={candidate.id}>
                <article
                  className="discovery-candidate"
                  data-discovery-candidate={candidate.handle || candidate.id}
                  data-candidate-id={candidate.id}
                  data-discovery-origin="discovery"
                >
                  <label className="discovery-candidate-select">
                    <input
                      type="checkbox"
                      data-discovery-select={candidate.id}
                      checked={selectedIds.includes(candidate.id)}
                      onChange={(event) => toggleSelected(candidate.id, event.target.checked)}
                    />
                    <span className="sr-only">选择 {candidate.handle || candidate.nickname || "线索"}</span>
                  </label>
                  <div className="discovery-candidate-copy">
                    <strong className="discovery-candidate-identity" data-discovery-candidate-identity>
                      <span className="discovery-candidate-nickname">{displayText(candidate.nickname)}</span>
                      {candidate.platform ? (
                        <span className="discovery-chip discovery-chip-soft">{platformLabel(candidate.platform)}</span>
                      ) : (
                        <span className="discovery-chip discovery-chip-soft">无</span>
                      )}
                      {candidate.in_library ? (
                        <span className="discovery-chip discovery-chip-soft" data-discovery-in-library>已在库</span>
                      ) : null}
                    </strong>
                    <p className="discovery-candidate-meta" data-discovery-candidate-meta>
                      {`账号 ${displayText(candidate.handle)} · 粉丝 ${displayMetric(candidate.followers)} · 均播 ${displayMetric(candidate.avg_plays_10)} · 档位 ${displayText(candidate.band)}`}
                    </p>
                    <p className="discovery-candidate-reason" data-discovery-candidate-reason>
                      {`匹配：${displayText(candidate.why)}`}
                    </p>
                  </div>
                  <div className="discovery-candidate-actions">
                    {candidate.source_url ? (
                      <a
                        className="discovery-follow-quiet"
                        data-discovery-source={candidate.id}
                        href={candidate.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        看来源
                      </a>
                    ) : (
                      <span className="discovery-follow-quiet" data-discovery-source-missing>看来源 · 无</span>
                    )}
                    <button
                      type="button"
                      className="discovery-follow-quiet"
                      data-discovery-ignore={candidate.id}
                      onClick={() => setIgnoredIds((current) => (
                        current.includes(candidate.id) ? current : [...current, candidate.id]
                      ))}
                    >
                      忽略
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {/* 没有 run 时这块留空：进入 AI发现 不再出现「尚未搜索」占位。 */}
      {!inFlight && !showResults && !failure && emptyKind !== "idle" ? (
        <div className="task-empty" data-discovery-empty={emptyKind}>
          <strong>{emptyKind === "down" ? "服务不可用" : "筛选无结果"}</strong>
          <p>{emptyMessage}</p>
        </div>
      ) : null}

      <DiscoveryIngestConfirm
        open={ingestOpen}
        busy={ingestBusy}
        error={ingestError}
        confirmDisabled={!selected.length}
        onConfirm={() => void confirmIngest()}
        onCancel={() => void cancelIngest()}
      >
        <p data-discovery-ingest-summary>
          {`将把 ${selected.length} 条线索写入 Starry 并进入公海。`}
          {` 平台：${platforms.length ? platforms.map((code) => platformLabel(code)).join("、") : "无"}。`}
          {` 来源运行：${activeRun?.id || activeRunId || "无"}。`}
          不会建联，不会发信，也不会改阶段或认领跟进。
        </p>
      </DiscoveryIngestConfirm>
    </section>
  );
}
