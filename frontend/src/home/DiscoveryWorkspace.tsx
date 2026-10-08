import { useMemo } from "react";
import DiscoveryAiSummary from "./DiscoveryAiSummary";
import DiscoveryConfirmCard from "./DiscoveryConfirmCard";
import DiscoveryNextPlan from "./DiscoveryNextPlan";
import DiscoveryParamsCheck from "./DiscoveryParamsCheck";
import DiscoveryResultPane from "./DiscoveryResultPane";
import DiscoveryRunEvents from "./DiscoveryRunEvents";
import DiscoverySearchCard from "./DiscoverySearchCard";
import DiscoverySkillEvent, { DiscoveryGuidanceEvent } from "./DiscoverySkillEvent";
import WorkspaceShell, { revealWorkspace } from "./WorkspaceShell";
import useDiscovery from "./useDiscovery";
import { discoveryParamCheck } from "./discoveryParams";
import { type ReactNode } from "react";
import type { SkillTemplate } from "../api";
import type { DiscoveryBrief, DiscoveryTemplate } from "./discoveryTemplate";
import type { SkillParamField } from "./workspace/SkillParamCard";
import "./discovery-workspace.css";
import "./discovery-flow.css";
import { discoveryTaskStatus } from "./discoveryTaskStatus";

/**
 * AI发现 = 走同一工作台骨架的页面（WorkspaceShell），中栏是一条有序事件流：
 * ①技能说明 → ②填写引导 → ③条件卡片 → ④实际采集参数 → ⑤确认开始采集 → ⑥采集执行，
 * 提问框与场景芯片固定在底部；右栏只呈现当前任务的进度、回执与候选结果。
 * 提交条件后不再跳转：实际参数、确认与回执都留在本页，历史事件保持顺序。
 */
export default function DiscoveryWorkspace({
  brief,
  catalog,
  schema,
  skillTemplate = null,
  busy = false,
  onBriefChange,
  onSubmitConditions,
  onEditConditions,
  activeTaskId = null,
  activeRunId = null,
  sessionId = null,
  sessionHref = null,
  lastSubmit = null,
  onRetrySubmit,
  centerHeader,
  centerSupplement,
  centerFooter,
}: {
  brief: DiscoveryBrief;
  catalog?: Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null;
  schema?: SkillParamField[];
  /** 采集线索（crawler_collect）的交互模板：中栏第一个事件。 */
  skillTemplate?: SkillTemplate | null;
  /** 提交后的识别等待卡也属于中栏流式输出，尚未有 discovery run 时由 Home 提供忙状态。 */
  busy?: boolean;
  onBriefChange: (brief: DiscoveryBrief) => void;
  /** 条件卡底部的主操作：与提问框发送同一提交路径；入参是并入了未回车关键词草稿的条件。 */
  onSubmitConditions?: (brief?: DiscoveryBrief) => void;
  /** 可选：由 Home 决定「修改条件」的副作用（默认复用页面内状态机）。 */
  onEditConditions?: () => void;
  activeTaskId?: string | null;
  activeRunId?: string | null;
  /** 正在协作的发现会话：实际采集参数与确认动作按它读取。 */
  sessionId?: string | null;
  /** 会话页地址：参数或动作读取失败时的恢复入口。 */
  sessionHref?: string | null;
  /** 提交身份：每次提交都换一个对象，用来把条件卡转回只读。 */
  lastSubmit?: unknown;
  onRetrySubmit?: () => void;
  centerHeader?: ReactNode;
  centerSupplement?: ReactNode;
  centerFooter?: ReactNode;
}) {
  const disc = useDiscovery({ activeTaskId, activeRunId, sessionId, lastSubmit, onRetrySubmit });
  const params = useMemo(() => discoveryParamCheck({
    brief,
    args: disc.startAction?.arguments || null,
    catalog: catalog || undefined,
  }), [brief, disc.startAction, catalog]);
  const editConditions = onEditConditions || disc.editConditions;
  const flowStarted = disc.submitted || Boolean(disc.startAction);
  /** 必填参数缺失检测：方向/关键词/平台任一未选，确认卡不再空转"整理中"，直接给行动指引。 */
  const missingParams = useMemo(() => {
    const missing: string[] = [];
    if (!brief.platforms.length) missing.push("平台");
    if (!brief.directions.length) missing.push("方向");
    if (!brief.keywords.length) missing.push("关键词");
    return missing;
  }, [brief]);
  const gotoParams = () => {
    document.querySelector('[data-discovery-event="conditions"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  // 未确认前不挂载「采集执行」段：没解锁就没有可看的执行内容，空壳占位
  // （标题"等待确认"+正文"还没有开始采集"）只会让人误以为执行已就绪。
  // 员工点确认后该段才出现；CONST-03 等待诚实。
  const startConfirmed = disc.startPhase !== "waiting_proposal" && disc.startPhase !== "pending";
  const status = discoveryTaskStatus({ failure: disc.failure, startPhase: disc.startPhase,
    crawlPhase: disc.crawlPhase, submitted: disc.submitted || busy, stage: disc.stage });
  return (
    <WorkspaceShell
      pane="discovery"
      sessionId={sessionId}
      pendingTarget={disc.startPhase === "pending" ? disc.startAction?.id : undefined}
      railLabel="红人线索"
      railToggleLabel="红人线索"
      railStorageKey="ui:home-discovery-rail-collapsed"
      railBadge={disc.visible.length}
      resultIdle={!disc.run && !disc.inFlight && !disc.failure}
      streamStick={status.live}
      railScrollJump
      resultView={{
        skillId: "creator_discovery",
        resultType: "discovery_candidates",
        // 右栏元数据与摘要、过程流共用同一个阶段机，避免一侧显示运行中、另一侧显示失败。
        status: status.key === "waiting" ? "awaiting_confirm" : status.key,
        version: disc.run?.id,
        freshness: disc.run?.memory_validity === "stale"
          ? "stale"
          : disc.stage === "success"
            ? "current"
            : "unknown",
      }}
      centerHeader={centerHeader}
      centerScroll={(
        <div className="discovery-flow" data-discovery-flow>
          <DiscoverySkillEvent template={skillTemplate} compact={flowStarted} />
          <DiscoveryGuidanceEvent />
          <section
            className="discovery-event"
            data-discovery-event="conditions"
            data-discovery-event-index="3"
            data-discovery-event-state={disc.cardMode}
            aria-label="发现条件"
          >
            <header className="discovery-event-head">
              <strong>{disc.cardMode === "readonly" ? "本次提交的条件" : "发现条件"}</strong>
              {disc.cardMode === "readonly" ? (
                <span className="discovery-event-status">
                  <button
                    type="button"
                    className="btn text"
                    data-discovery-edit-conditions
                    onClick={editConditions}
                  >
                    修改条件
                  </button>
                </span>
              ) : null}
            </header>
            <DiscoverySearchCard
              brief={brief}
              catalog={catalog}
              schema={schema}
              mode={disc.cardMode === "readonly" ? "ready" : "edit"}
              submitting={busy}
              onChange={onBriefChange}
              onSubmit={onSubmitConditions}
            />
          </section>
          {flowStarted ? (
            <DiscoveryParamsCheck
              phase={disc.startPhase}
              executed={params.executed}
              checkedAfter={params.checkedAfter}
              stale={disc.paramsStale}
              error={disc.actionsError}
              sessionHref={sessionHref}
              onRetry={() => void disc.reloadActions()}
            />
          ) : null}
          {flowStarted ? (
            <DiscoveryConfirmCard
              actionId={disc.startAction?.id}
              phase={disc.startPhase}
              error={disc.startError}
              reason={disc.startReason}
              blockedReason={disc.paramsStale ? "条件已修改，重新核对后才能确认采集。"
                : disc.startPhase === "pending" && !disc.startAction?.confirmation_version ? "确认快照尚未就绪，请重新读取参数。" : ""}
              sessionHref={sessionHref}
              busy={disc.startBusy}
              brief={brief}
              missingParams={missingParams}
              onGotoParams={gotoParams}
              onConfirm={disc.confirmStart}
              onCancel={disc.cancelStart}
              onRetry={disc.startAction?.can_retry ? disc.retryStart : undefined}
              onStop={disc.stopStart}
            />
          ) : null}
          {flowStarted && startConfirmed ? (
            <DiscoveryRunEvents
              stage={disc.stage}
              steps={disc.steps}
              narrative={disc.narrative}
              inFlight={disc.inFlight}
              crawlState={disc.crawlPhase}
              foundCount={disc.visible.length}
              runtimeCrawl={disc.startAction?.crawl ?? null}
              canStop={disc.crawlRunning}
              stopping={disc.startBusy}
              onStop={disc.stopStart}
            />
          ) : null}
          {disc.failure || disc.emptyKind === "down" ? (
            <DiscoveryAiSummary
              run={disc.run}
              visibleCount={disc.visible.length}
              inFlight={disc.inFlight}
              failure={disc.failure}
              emptyKind={disc.emptyKind}
              emptyMessage={disc.emptyMessage}
              retryBusy={disc.retryBusy}
              onRetry={() => void disc.retryRun()}
              onCheckConnection={() => void disc.checkCollector()}
              connection={disc.connection}
            />
          ) : null}
          {(!flowStarted || startConfirmed) ? <DiscoveryNextPlan
            run={disc.run}
            visibleCount={disc.visible.length}
            selectedCount={disc.selected.length}
            inFlight={disc.startAction ? disc.crawlPending : disc.inFlight}
            failure={disc.failure}
            emptyKind={disc.emptyKind}
            onEditConditions={editConditions}
            onRetry={() => void disc.retryRun()}
            onCheckConnection={() => void disc.checkCollector()}
            checkingConnection={disc.checkingConnection}
            connection={disc.connection}
            onOpenIngest={disc.openIngest}
          /> : null}
          {centerSupplement}
        </div>
      )}
      centerFooter={<div data-workspace-awaiting-confirm={disc.startPhase === "pending" ? true : undefined}>
        {disc.startPhase === "pending" && sessionId ? <p className="workspace-confirm-hint" role="status">
          ⚠ 请核对采集范围 <button className="btn ghost" type="button" onClick={() => revealWorkspace(sessionId, "center", disc.startAction?.id)}>查看确认卡</button>
        </p> : null}
        {centerFooter}
      </div>}
      railHeader={<DiscoveryResultPane state={disc} brief={brief} runStatus={status} region="header" />}
      rail={<DiscoveryResultPane state={disc} brief={brief} runStatus={status} region="body" />}
    />
  );
}
