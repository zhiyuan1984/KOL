import { useEffect, useRef } from "react";
import { DISCOVERY_START_COPY, type DiscoveryStartPhase } from "./discoveryStart";

/**
 * ⑤ 确认开始采集：紧接实际参数清单。点击后原地变成「已确认，正在启动」并移除
 * 按钮（禁止重复提交）。确认本身是服务端 R3 待确认动作，前端只呈现与提交。
 */
export default function DiscoveryConfirmCard({
  phase,
  error,
  blockedReason,
  sessionHref,
  onConfirm,
  onCancel,
  onRetry,
  onStop,
  busy,
}: {
  phase: DiscoveryStartPhase;
  /** 读取或确认失败时的可读原因。 */
  error: string;
  /** 例如「条件已修改，重新核对后才能确认采集」。 */
  blockedReason: string;
  sessionHref?: string | null;
  onConfirm?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onStop?: () => void;
  busy?: boolean;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  // R3 确认卡必达视口（docs/DESIGN.md §10.3）：首次出现待确认时滚到可见处，
  // 减少动效偏好下不滚动。
  useEffect(() => {
    if (phase !== "pending") return;
    const node = cardRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const visible = rect.top >= 0 && rect.bottom <= (window.innerHeight || 0);
    if (visible) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [phase]);

  const copy = DISCOVERY_START_COPY[phase];
  const tone = phase === "pending" ? "warning"
    : phase === "failed" || phase === "uncertain" ? "danger"
      : phase === "running" || phase === "dispatching" || phase === "starting" ? "running"
        : phase === "succeeded" ? "ready" : "idle";

  return (
    <section
      ref={cardRef}
      className="discovery-event"
      data-discovery-event="confirm"
      data-discovery-event-index="5"
      data-discovery-event-state={phase}
      aria-label="确认开始采集"
    >
      <header className="discovery-event-head">
        <span className="discovery-event-kicker">R3 · 确认开始采集</span>
        <strong>{copy.label}</strong>
        <span className="discovery-event-status" data-tone={tone} data-discovery-start-status>
          {phase === "pending" ? "等待你确认" : phase === "dispatching" || phase === "starting" ? "已确认" : ""}
        </span>
      </header>

      <p
        className="discovery-confirm-state"
        data-phase={phase}
        role="status"
        data-discovery-start-detail
      >
        {copy.detail}
      </p>

      {blockedReason ? (
        <p className="discovery-flow-note" role="status" data-discovery-start-blocked>{blockedReason}</p>
      ) : null}

      {error ? <p role="alert" data-discovery-start-error>{error}</p> : null}

      {phase === "pending" ? (
        <div className="discovery-confirm-actions">
          <button
            type="button"
            className="btn work sm"
            data-discovery-start-confirm
            disabled={Boolean(blockedReason) || Boolean(busy)}
            onClick={onConfirm}
          >
            {busy ? "正在确认…" : "确认开始采集"}
          </button>
          <button
            type="button"
            className="btn text"
            data-discovery-start-cancel
            disabled={Boolean(busy)}
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      ) : null}

      {phase === "running" && onStop ? (
        <div className="discovery-confirm-actions">
          <button type="button" className="btn text" data-discovery-start-stop disabled={Boolean(busy)} onClick={onStop}>
            申请停止采集
          </button>
          {sessionHref ? <a className="link-button" href={sessionHref} data-discovery-open-session>在任务会话中打开</a> : null}
        </div>
      ) : null}

      {(phase === "failed" || phase === "uncertain" || phase === "cancelled" || phase === "rejected") ? (
        <div className="discovery-confirm-actions">
          {onRetry ? (
            <button type="button" className="btn text" data-discovery-start-retry disabled={Boolean(busy)} onClick={onRetry}>
              核对后重试
            </button>
          ) : null}
          {sessionHref ? <a className="link-button" href={sessionHref} data-discovery-open-session>在任务会话中打开</a> : null}
        </div>
      ) : null}
    </section>
  );
}
