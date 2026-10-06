import type { DiscoveryProcessStep } from "./discoveryEvents";

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
 * 状态以采集作业本身为准：交付任务（harness）还在跑，不等于远端在采集。
 * 没有采集作业、也没有采集步骤时，这里只能说「尚未开始」——不能因为前端的
 * 轮询标志就说「进行中」（否则会出现上面写执行失败、下面写进行中的矛盾）。
 */
export default function DiscoveryRunEvents({
  stage,
  steps,
  inFlight,
  confirmed = true,
  crawlState = null,
  canStop = false,
  onStop,
  stopping,
}: {
  stage: string;
  steps: DiscoveryProcessStep[];
  inFlight: boolean;
  /** 员工已确认开始采集：未确认前这一段不得声称正在采集。 */
  confirmed?: boolean;
  /** 采集作业自己的状态（`runtime_crawl_jobs.state`），没有作业时为 null。 */
  crawlState?: string | null;
  /** 采集真的在跑：只有这时才给「申请停止采集」。 */
  canStop?: boolean;
  onStop?: () => void;
  stopping?: boolean;
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

      {steps.length ? (
        <ol className="discovery-run-steps" data-discovery-run-steps role="status" aria-busy={confirmed && inFlight || undefined}>
          {steps.map((step) => (
            <li
              key={step.id}
              className="discovery-run-step"
              data-discovery-step={step.kind}
              data-state={step.kind === "failed" ? "failed" : confirmed && inFlight && step === steps[steps.length - 1] ? "running" : "done"}
            >
              <span className="discovery-run-mark" aria-hidden="true" />
              <span className="discovery-run-step-label">{step.label}</span>
              {step.time ? <span className="discovery-run-time" data-discovery-step-time>{step.time}</span> : null}
            </li>
          ))}
        </ol>
      ) : !confirmed ? null : !collected ? (
        <p className="muted" data-discovery-run-pending>
          确认开始采集后，这里会按真实事件显示排队、搜索、接收、去重与排序。
        </p>
      ) : inFlight ? (
        <p className="muted" role="status" aria-busy="true" data-discovery-run-waiting>
          正在按已确认的条件检索红人线索。不会发信、不会改阶段、不会编造结果。
        </p>
      ) : (
        <p className="muted" data-discovery-run-empty>
          这次运行没有留下过程记录。
        </p>
      )}

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
