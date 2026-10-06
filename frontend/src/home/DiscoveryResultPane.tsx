import { Link } from "react-router-dom";
import { DiscoveryIngestConfirm } from "./DiscoveryIngestConfirm";
import DiscoveryLeadRow from "./DiscoveryLeadRow";
import DiscoveryRuntimeResults from "./DiscoveryRuntimeResults";
import { platformLabel, type DiscoveryBrief } from "./discoveryTemplate";
import type { DiscoveryState } from "./useDiscovery";

/**
 * Right rail: 当前任务状态 + 采集回执与候选 + 结果明细与入库确认。
 * 状态与成果只在这里表达一次（中栏只保留过程事件）：中栏事件流里的状态属于事件
 * 本身，右栏顶部固定的是「这个任务现在到哪了」。reads、polling、writes 与 L3
 * 确认仍然都在 hook 和既有确认流程里。
 */
export default function DiscoveryResultPane({ state, brief }: { state: DiscoveryState; brief: DiscoveryBrief }) {
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
    inFlight,
    stage,
    startPhase,
    crawlPhase,
    submitted,
    runFromAnotherTask,
    actions,
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
  } = state;
  const showResults = available.length > 0;
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

  // 右栏顶部固定的当前任务状态：文案 + 图形 + 字重，不只靠颜色（DESIGN §1 不变量 4）。
  // 以会话动作的相位为准；`stage === "running"` 只表示「任务在动」（可能只是在等确认），
  // 所以它只作兜底，不能盖掉「待确认」。
  const railStatus = failure || startPhase === "failed"
    ? { key: "failed", glyph: "⚠", label: "失败", detail: "保留已取得的结果；可核对原因后重试。" }
    : startPhase === "uncertain"
      ? { key: "uncertain", glyph: "⚠", label: "结果待核实", detail: "不重复提交；先核对任务状态。" }
      : crawlPhase === "running" || startPhase === "running"
        ? { key: "running", glyph: "▶", label: "采集中", detail: "候选到达后原位更新，不打断阅读。" }
        : startPhase === "dispatching" || startPhase === "starting"
          ? { key: "starting", glyph: "▶", label: "启动中", detail: "已确认，正在启动采集。" }
          : startPhase === "succeeded" || crawlPhase === "succeeded"
            ? { key: "completed", glyph: "✓", label: "已完成", detail: "候选与来源已就绪；入库是独立动作。" }
            : startPhase === "cancelled" || crawlPhase === "cancelled" || startPhase === "rejected"
              ? { key: "stopped", glyph: "■", label: "已停止", detail: "只保留已取得的候选。" }
              : startPhase === "pending"
                ? { key: "waiting", glyph: "·", label: "待确认", detail: "确认前不会发起采集。" }
                : startPhase === "waiting_proposal"
                  ? (submitted
                    ? { key: "preparing", glyph: "·", label: "准备中", detail: "正在整理本次采集范围。" }
                    : { key: "idle", glyph: "·", label: "未开始", detail: "提交条件后，结果会保存在这里。" })
                  : stage === "running"
                    ? { key: "running", glyph: "▶", label: "采集中", detail: "候选到达后原位更新，不打断阅读。" }
                    : stage === "success"
                      ? { key: "completed", glyph: "✓", label: "已完成", detail: "候选与来源已就绪；入库是独立动作。" }
                      : { key: "idle", glyph: "·", label: "未开始", detail: "提交条件后，结果会保存在这里。" };

  return (
    <div
      className="discovery-panel"
      data-discovery-panel
      data-discovery-live="false"
      data-discovery-stage={stage}
      data-discovery-running={inFlight ? "true" : undefined}
    >
      <header className="discovery-run-status" data-discovery-run-status={railStatus.key}>
        <span className="discovery-run-status-kicker">当前任务</span>
        <strong data-discovery-run-status-label>
          <span aria-hidden="true" className="discovery-run-status-glyph">{railStatus.glyph}</span>{railStatus.label}
        </strong>
        <span className="discovery-run-status-detail" data-discovery-run-status-detail>{railStatus.detail}</span>
      </header>

      {runFromAnotherTask ? (
        <p className="discovery-flow-note" data-discovery-previous-run>
          下面的结果仍来自上一次运行；本次运行产出后会原位更新，不覆盖旧回执。
        </p>
      ) : null}

      <DiscoveryRuntimeResults actions={actions} brief={brief} />

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

      {showResults ? (
        <section className="discovery-result-detail" aria-label="结果明细">
          <header className="discovery-result-detail-head">
            <h3>结果明细{!selecting ? <span className="discovery-result-detail-hint"> · 优先复核证据，再选择可入库线索</span> : null}</h3>
          </header>

          <div className={"discovery-result-filters" + (resultFilter !== "all" ? " is-filtered" : "")} data-discovery-result-filters>
            {[
              ["all", `全部 ${available.length}`],
              ["ready", `可入库 ${readyCount}`],
              ["review", `待复核 ${reviewCount}`],
              ["blocked", `待补资料 ${blockedCount}`],
              ["existing", `已在库 ${existingCount}`],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="discovery-filter-chip"
                aria-pressed={resultFilter === key}
                data-discovery-result-filter={key}
                onClick={() => setResultFilter(key as typeof resultFilter)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={"discovery-run-bar" + (selecting ? " is-selecting" : "")} data-discovery-run-bar>
            <span className="discovery-run-count" data-discovery-selected-count>{`已选 ${selected.length} 人`}</span>
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
              className="btn work sm"
              data-discovery-ingest
              data-home-entry="discovery-ingest"
              disabled={!selecting}
              onClick={openIngest}
            >
              {`入库公海（${selected.length}）`}
            </button>
          </div>

          {visible.length ? (
            <ol className="discovery-candidate-list" data-discovery-candidates>
              {visible.map((candidate) => (
                <li key={candidate.id}>
                  <DiscoveryLeadRow
                    candidate={candidate}
                    selected={selectedIds.includes(candidate.id)}
                    expanded={expandedIds.includes(candidate.id)}
                    onToggleSelect={(on) => toggleSelected(candidate.id, on)}
                    onToggleExpand={() => toggleExpanded(candidate.id)}
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

      {!inFlight && !showResults && !failure && emptyKind !== "idle" && emptyKind !== "down" ? (
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
