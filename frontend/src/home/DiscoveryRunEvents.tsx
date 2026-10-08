import type { DiscoveryNarrative, DiscoveryProcessStep, RuntimeCrawlSnapshot } from "./discoveryEvents";
import { BIZ_PHASES, discoveryBizPhaseIndex } from "./discoveryBizPhase";
import { discoveryRemoteCrawlView } from "./discoveryEvents";
import DiscoveryAvatar from "./DiscoveryAvatar";

const RUN_STATE_LABEL: Record<string, string> = {
  compose: "尚未开始",
  running: "正在采集",
  success: "已完成",
  failure: "失败",
};

/** 采集作业仍在推进的远端状态（`runtime_crawl_jobs.state`）。 */
const CRAWL_ACTIVE = new Set(["queued", "starting", "running", "stopping", "crawling", "uploading", "analyzing"]);
/** 过程行里能证明「这次真的采过」的步骤。 */
const COLLECTION_KINDS = new Set([
  "queued", "search", "collecting", "received", "deduped", "analyzing", "collect_done", "scoring", "briefing", "ranked",
]);

/**
 * ⑥ 采集执行：中栏保留过程事件（排队、搜索、接收、去重、打分、排出候选、
 * 失败、停止），右栏持续更新结果。事件来自 Host 的真实进度，不伪造完成。
 *
 * 挂载即代表已确认：父级（DiscoveryWorkspace）只在员工点确认之后才渲染这一段，
 * 未确认前连空壳都不展示。`confirmed` 属性作为组件级兜底契约保留：即使被无条件
 * 挂载，也不得声称正在采集（CONST-03 等待诚实；单测覆盖）。
 *
 * 状态以采集作业本身为准：交付任务（harness）还在跑，不等于远端在采集。
 * 没有采集作业、也没有采集步骤时，这里只能说「尚未开始」——不能因为前端的
 * 轮询标志就说「进行中」（否则会出现上面写执行失败、下面写进行中的矛盾）。
 */
export default function DiscoveryRunEvents({
  stage,
  steps,
  narrative = null,
  inFlight,
  confirmed = true,
  crawlState = null,
  canStop = false,
  onStop,
  stopping,
  foundCount,
  runtimeCrawl = null,
}: {
  stage: string;
  steps: DiscoveryProcessStep[];
  /** 智能体逐字写给员工看的说明。 */
  narrative?: DiscoveryNarrative | null;
  inFlight: boolean;
  /** 员工已确认开始采集：未确认前这一段不得声称正在采集（父级已做挂载门控，此为兜底契约）。 */
  confirmed?: boolean;
  /** 采集作业自己的状态（`runtime_crawl_jobs.state`），没有作业时为 null。 */
  crawlState?: string | null;
  /** 采集真的在跑：只有这时才给「申请停止采集」。 */
  canStop?: boolean;
  onStop?: () => void;
  stopping?: boolean;
  /** 搜索中找到的候选数（随轮询增长），用于"搜索中（已找到 N 个）"。 */
  foundCount?: number;
  /**
   * runtime 采集作业快照（`startAction.crawl`）：展示远端真实进展
   * （远端状态 + 最后更新时间 + 停滞告警），不再让 UI 静默冻住。
   */
  runtimeCrawl?: RuntimeCrawlSnapshot;
}) {
  const failed = steps.some((step) => step.kind === "failed");
  const stopped = steps.some((step) => step.kind === "stopped");
  const crawl = String(crawlState || "").toLowerCase();
  const crawlActive = CRAWL_ACTIVE.has(crawl);
  /** 这次真的发生过采集：有采集作业，或有采集步骤。 */
  const collected = Boolean(crawl) || stage === "success" || stage === "failure"
    || steps.some((step) => COLLECTION_KINDS.has(step.kind));
  const title = !confirmed ? "等待确认"
    : failed || crawl === "failed" ? RUN_STATE_LABEL.failure
      : stopped || crawl === "cancelled" ? "已停止"
        : crawl === "succeeded" ? RUN_STATE_LABEL.success
          : crawlActive ? RUN_STATE_LABEL.running
            : !collected ? RUN_STATE_LABEL.compose
              : stage === "running" ? RUN_STATE_LABEL.running
                : stage === "success" ? RUN_STATE_LABEL.success : RUN_STATE_LABEL.compose;
  const status = !confirmed ? "待确认"
    : failed ? "失败"
      : stopped || crawl === "cancelled" ? "已停止"
        : crawl === "failed" ? "失败"
          : crawl === "succeeded" ? RUN_STATE_LABEL.success
            : crawlActive ? "进行中"
              : !collected ? "未开始"
                : inFlight ? "进行中" : "已结束";
  const tone = !confirmed ? "idle"
    : failed || crawl === "failed" ? "danger"
      : crawlActive || stage === "running" ? "running"
        : crawl === "succeeded" || stage === "success" ? "ready" : "idle";
  return (
    <section
      className="discovery-event"
      data-discovery-event="run"
      data-discovery-event-index="6"
      data-discovery-event-state={stage}
      aria-label="采集执行"
    >
      <header className="discovery-event-head">
        {crawlActive || stage === "running" ? <DiscoveryAvatar active size="sm" /> : null}
        <span className="discovery-event-kicker">采集执行</span>
        <strong data-discovery-run-title>{title}</strong>
        <span className="discovery-event-status" data-tone={tone} data-discovery-run-status>
          {status}
        </span>
      </header>

      {!confirmed ? (
        <p className="muted" role="status" data-discovery-run-unconfirmed>
          还没有开始采集：确认开始采集后才会发起。下面是提交与准备阶段的记录。
        </p>
      ) : null}

      {(() => {
        if (!confirmed) return null;
        const bizIndex = discoveryBizPhaseIndex({ steps, crawlState, stage });
        // 远端真实进展：后端 monitor 每次轮询刷新 status_json/updated_at，
        // 前端经 runtime action 视图拿到。这里展示"远端：X · N 秒前更新"，
        // 停滞（超过阈值未更新）时给告警——不再静默冻住。
        const remote = discoveryRemoteCrawlView(runtimeCrawl, Date.now());
        return (
          <>
            <ol className="discovery-run-steps" data-discovery-biz-phases role="status" aria-busy={inFlight || undefined}>
              {BIZ_PHASES.map((phase, i) => {
                const done = i < bizIndex || (bizIndex === 3 && i === 3 && !failed);
                const state = failed && i === bizIndex ? "failed" : done ? "done" : i === bizIndex ? "running" : undefined;
                const label = phase.id === "searching" && typeof foundCount === "number"
                  ? `搜索中（已找到 ${foundCount} 个）`
                  : phase.label;
                return (
                  <li
                    key={phase.id}
                    className="discovery-run-step"
                    data-discovery-biz-phase={phase.id}
                    data-state={state}
                  >
                    <span className="discovery-run-mark" aria-hidden="true" />
                    <span className="discovery-run-step-label">{i + 1}、{label}</span>
                  </li>
                );
              })}
            </ol>
            {remote ? (
              <p
                className="discovery-remote-line"
                data-discovery-remote-line
                data-tone={remote.stale ? "warning" : undefined}
                role="status"
              >
                远端：{remote.label}
                {remote.resultCount != null ? ` · 候选 ${remote.resultCount} 条` : ""}
                {remote.ago ? ` · ${remote.ago}` : ""}
                {remote.stale ? "（远端状态长时间未更新，采集可能停滞，可尝试停止后重试）" : ""}
              </p>
            ) : null}
            {steps.length ? (
              <details className="discovery-run-details" data-discovery-run-details>
                <summary>详情</summary>
                <ol className="discovery-run-steps" data-discovery-run-steps>
                  {steps.map((step) => (
                    <li
                      key={step.id}
                      className="discovery-run-step"
                      data-discovery-step={step.kind}
                      data-state={step.kind === "failed" ? "failed" : "done"}
                    >
                      <span className="discovery-run-mark" aria-hidden="true" />
                      <span className="discovery-run-step-label">{step.label}</span>
                      {step.time ? <span className="discovery-run-time" data-discovery-step-time>{step.time}</span> : null}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </>
        );
      })()}

      {narrative ? (
        <p className={"discovery-run-say" + (narrative.running ? " is-streaming" : "")} data-discovery-run-say>{narrative.body}</p>
      ) : null}

      {canStop && onStop ? (
        <div className="discovery-confirm-actions">
          <button type="button" className="btn text" data-discovery-run-stop disabled={Boolean(stopping)} onClick={onStop}>
            {stopping ? "正在申请停止…" : "申请停止采集"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
