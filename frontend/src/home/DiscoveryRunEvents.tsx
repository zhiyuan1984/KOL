import type { DiscoveryProcessStep } from "./discoveryEvents";

const RUN_STATE_LABEL: Record<string, string> = {
  compose: "尚未开始",
  running: "正在采集",
  success: "已完成",
  failure: "失败",
};

/**
 * ⑥ 采集执行：中栏保留过程事件（排队、搜索、接收、去重、打分、排出候选、
 * 失败、停止），右栏持续更新结果。事件来自 Host 的真实进度，不伪造完成。
 */
export default function DiscoveryRunEvents({
  stage,
  steps,
  inFlight,
  onStop,
  stopping,
}: {
  stage: string;
  steps: DiscoveryProcessStep[];
  inFlight: boolean;
  onStop?: () => void;
  stopping?: boolean;
}) {
  const failed = steps.some((step) => step.kind === "failed");
  const stopped = steps.some((step) => step.kind === "stopped");
  /** 已提交但还没有任何运行事件：这一步还没开始，不写成「没有过程记录」。 */
  const preRun = stage === "compose" && !inFlight && !steps.length;
  const title = preRun ? "尚未开始"
    : stage === "running" ? RUN_STATE_LABEL.running
      : stage === "failure" ? RUN_STATE_LABEL.failure
        : stage === "success" ? RUN_STATE_LABEL.success
          : RUN_STATE_LABEL.compose;
  const tone = failed ? "danger" : stage === "running" ? "running" : stage === "success" ? "ready" : "idle";
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
          {failed ? "失败" : stopped ? "已停止" : inFlight ? "进行中" : steps.length ? "已结束" : ""}
        </span>
      </header>

      {steps.length ? (
        <ol className="discovery-run-steps" data-discovery-run-steps role="status" aria-busy={inFlight || undefined}>
          {steps.map((step) => (
            <li
              key={step.id}
              className="discovery-run-step"
              data-discovery-step={step.kind}
              data-state={step.kind === "failed" ? "failed" : inFlight && step === steps[steps.length - 1] ? "running" : "done"}
            >
              <span className="discovery-run-mark" aria-hidden="true" />
              <span className="discovery-run-step-label">{step.label}</span>
              {step.time ? <span className="discovery-run-time" data-discovery-step-time>{step.time}</span> : null}
            </li>
          ))}
        </ol>
      ) : inFlight ? (
        <p className="muted" role="status" aria-busy="true" data-discovery-run-waiting>
          正在按已确认的条件检索红人线索。不会发信、不会改阶段、不会编造结果。
        </p>
      ) : preRun ? (
        <p className="muted" data-discovery-run-pending>
          确认开始采集后，这里会按真实事件显示排队、搜索、接收、去重与排序。
        </p>
      ) : (
        <p className="muted" data-discovery-run-empty>
          这次运行没有留下过程记录。
        </p>
      )}

      {inFlight && onStop ? (
        <div className="discovery-confirm-actions">
          <button type="button" className="btn ghost sm" data-discovery-run-stop disabled={Boolean(stopping)} onClick={onStop}>
            {stopping ? "正在申请停止…" : "申请停止采集"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
