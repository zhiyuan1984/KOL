import type { DiscoveryProcessStep } from "./discoveryEvents";
import type { DiscoveryStage } from "./discoveryPhase";

/**
 * 中栏的过程流。提交后条件卡收起，这里就是中栏唯一的主角：
 * 步骤来自 Host 的真实进度（task_events），推理块来自简报 worker 的 run.think。
 * 真实等待必须有原因、状态与恢复入口（DESIGN §不变量 3）：运行中有当前步与等待说明，
 * 卡片收起后「改条件再搜」把条件放回中栏。
 */
export default function DiscoveryProcessPanel({
  stage,
  steps,
  inFlight,
  hasResults,
  cardVisible,
  onEditConditions,
}: {
  stage: DiscoveryStage;
  steps: DiscoveryProcessStep[];
  inFlight: boolean;
  hasResults: boolean;
  cardVisible: boolean;
  onEditConditions: () => void;
}) {
  const failed = steps.some((step) => step.kind === "failed");
  const businessSteps = steps.filter((step) => [
    "queued", "search", "collecting", "received", "analyzing", "collect_done", "briefing", "ranked", "failed", "stopped",
  ].includes(step.kind));
  const businessSummary = businessSteps
    .map((step) => `${step.label}${step.time ? ` ${step.time}` : ""}`)
    .join(" → ");
  return (
    <section className="discovery-stream-panel" data-discovery-stream={stage}>
      <header className="discovery-stream-head">
        <h2 className="discovery-stream-title">{inFlight ? "检索中" : "检索过程"}</h2>
        {!cardVisible ? (
          <button
            type="button"
            className="btn ghost sm"
            data-discovery-edit-conditions
            data-home-entry="discovery-edit-conditions"
            onClick={onEditConditions}
          >
            改条件再搜
          </button>
        ) : null}
      </header>

      {businessSteps.length ? (
        <p className={`discovery-business-summary${failed ? " is-failed" : ""}`} data-discovery-business-summary role="status" aria-busy={inFlight || undefined}>
          <strong>业务过程</strong>{businessSummary}
        </p>
      ) : null}

      {!businessSteps.length && !inFlight ? (
        <p className="discovery-stream-empty" data-discovery-stream-empty>
          这次运行没有留下过程记录。
        </p>
      ) : null}

      {inFlight && !hasResults ? (
        <section className="task-empty" data-discovery-loading role="status" aria-busy="true">
          <strong>{businessSteps.length ? businessSteps[businessSteps.length - 1].label : "排队"}</strong>
          <p>正在按已确认的条件检索红人线索。不会发信、不会改阶段、不会编造结果。</p>
        </section>
      ) : null}
    </section>
  );
}
