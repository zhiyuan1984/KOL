import type { DiscoveryProcessStep, DiscoveryThink } from "./discoveryEvents";
import { discoveryBusinessSteps } from "./discoveryBusinessSteps";
import type { HomeDiscoveryRun } from "./discoveryHome";
import type { DiscoveryStage } from "./discoveryPhase";

/** Business milestones use persisted run facts; engine traces remain available on demand. */
export default function DiscoveryProcessPanel({
  run,
  stage,
  steps,
  think,
  reviewCount,
  inFlight,
  hasResults,
  cardVisible,
  onEditConditions,
}: {
  run: HomeDiscoveryRun | null;
  stage: DiscoveryStage;
  steps: DiscoveryProcessStep[];
  think: DiscoveryThink | null;
  reviewCount: number;
  inFlight: boolean;
  hasResults: boolean;
  cardVisible: boolean;
  onEditConditions: () => void;
}) {
  const business = discoveryBusinessSteps(run, steps, inFlight, reviewCount);
  const lastIndex = steps.length - 1;
  const failed = steps.some((step) => step.kind === "failed");
  const technical = (
    <>
      {steps.length ? (
        <ol className="discovery-stream" data-discovery-process role="status" aria-busy={inFlight || undefined}>
          {steps.map((step, index) => {
            const state = step.kind === "failed" ? "failed"
              : inFlight && !failed && index === lastIndex ? "running" : "done";
            return (
              <li key={step.id} className={`discovery-stream-step is-${state}`}
                data-discovery-event={step.kind} data-discovery-state={state}>
                <span className="discovery-stream-mark" aria-hidden>
                  {state === "failed" ? "✗" : state === "running" ? <span className="discovery-stream-spinner" /> : "✓"}
                </span>
                <span className="discovery-stream-label">{step.label}</span>
                {step.time ? <time className="discovery-stream-time" data-discovery-step-time>{step.time}</time> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {think ? (
        <div className={"discovery-think" + (think.state === "running" ? " is-streaming" : "")}
          data-discovery-think data-discovery-think-state={think.state}>
          <span className="discovery-think-label">
            <span>Codex 推理{think.folded > 0 ? ` · 已折叠 ${think.folded} 段更早的推理` : ""}</span>
            {think.time ? <time className="discovery-think-time" data-discovery-think-time>{think.time}</time> : null}
          </span>
          <p className="discovery-think-body">{think.truncated ? "…" : ""}{think.body}</p>
        </div>
      ) : null}
    </>
  );
  return (
    <section className="discovery-stream-panel" data-discovery-stream={stage}>
      <header className="discovery-stream-head">
        <h2 className="discovery-stream-title">{inFlight ? "发现进度" : "发现过程"}</h2>
        {!cardVisible ? (
          <button type="button" className="btn ghost sm" data-discovery-edit-conditions
            data-home-entry="discovery-edit-conditions" onClick={onEditConditions}>改条件再搜</button>
        ) : null}
      </header>

      {business.length ? (
        <ol className="discovery-business-timeline" data-discovery-business-process
          aria-label="业务过程" aria-live="polite" aria-relevant="additions text">
          {business.map((step) => (
            <li key={step.id} className={`is-${step.state}`} data-business-step={step.id}>
              <span className="discovery-business-mark" aria-hidden>
                {step.state === "running" ? "·" : step.state === "failed" ? "!" : step.state === "stopped" ? "–" : "✓"}
              </span>
              <div className="discovery-business-copy">
                <div className="discovery-business-heading">
                  <strong>{step.title}</strong>
                  {step.time ? <time>{step.time}</time> : null}
                </div>
                <span className="sr-only">{step.state === "running" ? "进行中" : step.state === "failed" ? "失败"
                  : step.state === "stopped" ? "已停止" : "已完成"}</span>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {business.length && (steps.length || think) ? (
        <details className="discovery-technical-trace" data-discovery-technical-trace>
          <summary>技术执行记录 · {steps.length} 条</summary>
          {technical}
        </details>
      ) : !business.length ? technical : null}

      {!business.length && !steps.length && !inFlight ? (
        <p className="discovery-stream-empty" data-discovery-stream-empty>这次运行没有留下过程记录。</p>
      ) : null}
      {inFlight && !hasResults ? (
        <section className="task-empty" data-discovery-loading role="status" aria-busy="true">
          <strong>{business.at(-1)?.title || (steps.length ? steps[lastIndex].label : "排队")}</strong>
          <p>正在按已提交的条件检索红人线索；采集和筛选数量只采用已返回的数据。</p>
        </section>
      ) : null}
    </section>
  );
}
