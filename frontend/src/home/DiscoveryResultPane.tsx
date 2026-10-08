import { Link } from "react-router-dom";
import { LifecycleNavigation } from "../components/LifecycleNavigation";
import "../components/lifecycle-workspace.css";
import DiscoveryRuntimeResults from "./DiscoveryRuntimeResults";
import AgentAvatar from "../components/AgentAvatar";
import { discoveryTaskStatus, type DiscoveryTaskStatus } from "./discoveryTaskStatus";
import { DiscoveryIngestConfirm } from "./DiscoveryIngestConfirm";
import DiscoveryLeadRow from "./DiscoveryLeadRow";
import { platformLabel, type DiscoveryBrief } from "./discoveryTemplate";
import type { DiscoveryState } from "./useDiscovery";

/**
 * Right rail: 当前任务状态 + 采集回执与候选 + 结果明细与入库确认。
 * 状态与成果只在这里表达一次（中栏只保留过程事件）：中栏事件流里的状态属于事件
 * 本身，右栏顶部固定的是「这个任务现在到哪了」。reads、polling、writes 与 L3
 * 确认仍然都在 hook 和既有确认流程里。
 */
export default function DiscoveryResultPane({ state, brief, region = "all", runStatus }: { state: DiscoveryState; brief: DiscoveryBrief; region?: "all" | "header" | "body"; runStatus?: DiscoveryTaskStatus }) {
  const {
    run,
    runId,
    available,
    visible,
    resultFilter,
    setResultFilter,
    selected,
    selectableVisible,
    selectedIds,
    selectedPlatforms,
    followUpIds,
    followUpCandidate,
    ingestCandidate,
    followUpCount,
    inFlight,
    stage,
    startPhase,
    crawlPhase,
    submitted,
    runFromAnotherTask,
    failure,
    emptyKind,
    emptyMessage,
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
    ingestReceipt,
    openIngest,
    confirmIngest,
    cancelIngest,
    startAction,
  } = state;
  const showResults = available.length > 0;
  // 最终结果已经到达后，结果本身成为页面主信息：隐藏阶段性任务状态和重复的“本次结果”标题。
  // 仅在真实成功态下触发，避免候选提前到达时误把任务进行状态隐藏。
  const hasFinalResults = showResults && (
    startPhase === "succeeded" || crawlPhase === "succeeded" || stage === "success"
  );
  const activeCrawl = ["queued", "starting", "running", "stopping", "crawling", "uploading", "analyzing"].includes(String(crawlPhase || "").toLowerCase())
    || ["dispatching", "starting", "running"].includes(startPhase);
  const selecting = selected.length > 0;
  const readyCount = available.filter((candidate) => candidate.ingestReadiness === "ready").length;
  const reviewCount = available.filter((candidate) => candidate.ingestReadiness === "needs_review").length;
  const existingCount = available.filter((candidate) => (
    candidate.ingestReadiness === "already_in_library" || candidate.ingestReadiness === "already_followed"
  )).length;
  const blockedCount = available.filter((candidate) => candidate.ingestReadiness === "needs_contact").length;
  const reviewSelected = selected.filter((candidate) => candidate.ingestReadiness === "needs_review").length;
  const allSelectableShown = selectableVisible.length > 0
    && selectableVisible.every((candidate) => selectedIds.includes(candidate.id));

  const railStatus = runStatus || discoveryTaskStatus({ failure, startPhase, crawlPhase, submitted, stage });

  const avatarIsActive = ["preparing", "starting", "running"].includes(railStatus.key);
  const statusHeader = (<header className="discovery-run-status" data-discovery-run-status={railStatus.key}>
        <AgentAvatar active={avatarIsActive} failed={railStatus.key === "failed"} completed={railStatus.key === "completed"} />
        <div className="discovery-run-status-copy">
          <span className="discovery-run-status-kicker">当前任务</span>
          <strong data-discovery-run-status-label>
            <span aria-hidden="true" className="discovery-run-status-glyph">{railStatus.glyph}</span>{railStatus.label}
          </strong>
          <span className="discovery-run-status-detail" data-discovery-run-status-detail>{railStatus.detail}</span>
        </div>
      </header>);
  const resultControls = (<div className="discovery-result-controls" data-discovery-result-controls>
      {!hasFinalResults ? <span className="discovery-result-scope">本次结果</span> : null}
      <div className="discovery-result-filters" data-discovery-result-filters>
        <LifecycleNavigation label="按入库准备度筛选本次结果" mode="filter" idPrefix="discovery-results"
          value={resultFilter} onChange={(id) => setResultFilter(id as typeof resultFilter)}
          options={[
            { id: "all", label: "全部", count: available.length },
            { id: "ready", label: "可入库", count: readyCount },
            { id: "review", label: "待复核", count: reviewCount },
            { id: "blocked", label: "待补资料", count: blockedCount },
            { id: "existing", label: "已在库", count: existingCount },
          ].map((option) => ({ ...option, dataAttributes: { "data-discovery-result-filter": option.id } }))} />
      </div>
      <div className={"discovery-run-bar" + (selecting ? " is-selecting" : "")} data-discovery-run-bar>
            <span className="discovery-run-count" data-discovery-selected-count>{`已选 ${selected.length} 人${followUpCount ? ` · 已跟进 ${followUpCount} 人` : ""}`}</span>
            <label className="discovery-candidate-select">
              <input
                type="checkbox"
                data-discovery-select-all
                checked={allSelectableShown}
                disabled={!selectableVisible.length}
                onChange={(event) => selectAll(event.target.checked)}
              />
              <span>全选当前结果</span>
            </label>
            <button
              type="button"
              className="discovery-follow-quiet discovery-ingest-trigger"
              data-discovery-ingest
              data-home-entry="discovery-ingest"
              disabled={!selecting}
              onClick={openIngest}
            >
              {`入库公海（${selected.length}）`}
            </button>
          </div>
    </div>);
  if (region === "header") {
    return <div className="discovery-result-header" data-discovery-result-header>
      {!hasFinalResults ? statusHeader : null}
      {showResults ? resultControls : null}
    </div>;
  }
  return (
    <div
      className="discovery-panel"
      data-discovery-panel
      data-discovery-live="false"
      data-discovery-stage={stage}
      data-discovery-running={inFlight ? "true" : undefined}
    >
      {region === "all" && !hasFinalResults ? statusHeader : null}

      {runFromAnotherTask ? (
        <p className="discovery-flow-note" data-discovery-previous-run>
          下面的结果仍来自上一次运行；本次运行产出后会原位更新，不覆盖旧回执。
        </p>
      ) : null}
      {startAction?.crawl ? (
        <details className="discovery-remote-receipt" data-discovery-remote-receipt open={activeCrawl}>
          <summary><strong>远程采集回执</strong><span data-discovery-remote-state>{String(startAction.crawl.remote_status || startAction.crawl.state || "连接中")}</span></summary>
          <dl>
            <div><dt>远程任务</dt><dd>{startAction.crawl.remote_task_id || "等待分配"}</dd></div>
            <div><dt>结果状态</dt><dd>{startAction.crawl.result_state || "pending"}</dd></div>
            <div><dt>远程更新时间</dt><dd>{startAction.crawl.updated_at || "暂无"}</dd></div>
            <div><dt>候选回执</dt><dd>{Array.isArray(startAction.crawl.result_json?.candidates) ? `${startAction.crawl.result_json.candidates.length} 条` : "尚未返回"}</dd></div>
          </dl>
        </details>
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

      {state.actions.some(action => Boolean(action.crawl?.result_json)) ? <DiscoveryRuntimeResults actions={state.actions} brief={brief} onRefresh={state.reloadActions}
        candidateIds={visible.map(row => row.id)} selectedIds={selectedIds} onSelect={toggleSelected} /> : showResults ? (
        <section className="discovery-result-detail" aria-label="结果明细">
          {region === "all" ? <header className="discovery-result-detail-head">
            <h3>结果明细{!selecting ? <span className="discovery-result-detail-hint"> · 优先复核证据，再选择可入库线索</span> : null}</h3>
          </header> : null}

          {region === "all" ? resultControls : null}

          {visible.length ? (
            <ol className="discovery-candidate-list" data-discovery-candidates>
              {visible.map((candidate) => (
                <li key={candidate.id}>
                  <DiscoveryLeadRow
                    candidate={candidate}
                    brief={brief}
                    selected={selectedIds.includes(candidate.id)}
                    expanded={expandedIds.includes(candidate.id)}
                    followedUp={followUpIds.includes(candidate.id)}
                    onToggleSelect={(on) => toggleSelected(candidate.id, on)}
                    onToggleExpand={() => toggleExpanded(candidate.id)}
                    onIngestCandidate={() => ingestCandidate(candidate.id, candidate.run_id)}
                    onFollowUpCandidate={() => followUpCandidate(candidate.id, candidate.run_id)}
                    onIgnore={() => ignoreCandidate(candidate.id)}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <div className="task-empty discovery-filter-empty" data-discovery-filter-empty={resultFilter}>
              <strong>当前筛选没有线索</strong>
              <p>可切换到“全部”查看本次采集到的其他候选与其转化状态。</p>
            </div>
          )}
        </section>
      ) : null}

      {ingestReceipt ? (
        <section className="discovery-ingest-receipt" data-discovery-ingest-receipt role="status">
          <strong>Starry 入库回执</strong>
          <p>{`本次已写入 ${ingestReceipt.ingested.length} 位${ingestReceipt.failed.length ? `，${ingestReceipt.failed.length} 位未写入` : ""}。`}</p>
          {ingestReceipt.failed.length ? (
            <ul>
              {ingestReceipt.failed.map((item) => <li key={item.id}>{item.message || item.handle || item.id}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}

      {toast ? (
        <p className="discovery-toast" data-discovery-toast role="status">
          <Link to="/?tab=pool" data-discovery-pool-link>{toast}</Link>
        </p>
      ) : null}

      {!showResults && !failure && (activeCrawl || (inFlight && !["waiting_proposal", "pending"].includes(startPhase))) ? (
        <div className="task-empty" data-discovery-empty="waiting-results" role="status">
          <strong>正在等待候选结果</strong>
          <p>远端仍在采集或读取结果；当前没有候选不等于筛选无结果。</p>
        </div>
      ) : null}
      {!inFlight && !activeCrawl && !showResults && !failure && emptyKind !== "idle" && emptyKind !== "down" ? (
        <div className="task-empty" data-discovery-empty={emptyKind}>
          <strong>筛选无结果</strong>
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
          {` 平台：${selectedPlatforms.length ? selectedPlatforms.map((code) => platformLabel(code)).join("、") : "无"}。`}
          {` 来源运行：${run?.id || runId || "无"}。`}
          {reviewSelected ? ` 其中 ${reviewSelected} 条仍需人工复核其评分与来源证据。` : ""}
          不会建联，不会发信，也不会改阶段或认领跟进。
        </p>
      </DiscoveryIngestConfirm>
    </div>
  );
}
