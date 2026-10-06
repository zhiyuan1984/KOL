import type { DiscoveryParamItem } from "./discoveryParams";
import type { DiscoveryStartPhase } from "./discoveryStart";

/**
 * ④ 核对实际参数：本次真正提交给采集服务的参数（来自待确认动作 arguments），
 * 以及只能在候选到达后核对的地区、粉丝、均播与期望人数。需要修改时回到上方
 * 条件卡编辑 —— 那会让这一次核对标记为已失效。
 */
export default function DiscoveryParamsCheck({
  phase,
  executed,
  checkedAfter,
  stale,
  error,
  sessionHref,
  onRetry,
}: {
  phase: DiscoveryStartPhase;
  executed: DiscoveryParamItem[];
  checkedAfter: DiscoveryParamItem[];
  stale: boolean;
  error: string;
  /** 会话页地址：参数读取失败时的唯一恢复入口之一。 */
  sessionHref?: string | null;
  onRetry?: () => void;
}) {
  const waiting = phase === "waiting_proposal" && !error;
  const tone = stale ? "warning" : phase === "failed" || error ? "danger" : waiting ? "running" : "ready";
  const statusLabel = stale ? "已失效" : waiting ? "整理中" : error ? "读取失败" : "已核对";
  return (
    <section
      className="discovery-event"
      data-discovery-event="params"
      data-discovery-event-index="4"
      data-discovery-event-state={stale ? "stale" : waiting ? "waiting" : error ? "failed" : "ready"}
      aria-label="实际采集参数"
    >
      <header className="discovery-event-head">
        <span className="discovery-event-kicker">实际采集参数</span>
        <strong>本次执行参数与采集后核对项</strong>
        <span className="discovery-event-status" data-tone={tone} data-discovery-params-status>
          {statusLabel}
        </span>
      </header>

      {error ? (
        <p role="alert" data-discovery-params-error>{error}</p>
      ) : null}

      {waiting ? (
        <p className="muted" role="status" aria-busy="true" data-discovery-params-waiting>
          正在按已提交的条件整理本次采集范围；参数齐备后才会出现确认动作。不会在确认前发起采集。
        </p>
      ) : null}

      {executed.length ? (
        <>
          <h3 className="discovery-params-group-title">进入本次采集调用的参数</h3>
          <dl className="discovery-params-list" data-discovery-params-executed>
            {executed.map((item) => (
              <div key={item.key} data-discovery-param={item.key}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      {!waiting && !error ? (
        <>
          <h3 className="discovery-params-group-title">采集后核对（不是远端数量限制）</h3>
          <dl className="discovery-params-list" data-discovery-params-checked-after>
            {checkedAfter.map((item) => (
              <div key={item.key} data-discovery-param={item.key}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
          <p className="discovery-flow-note" data-discovery-params-note>
            采集后核对项在候选到达后按记录比对；缺失或无法核验的指标会逐条标出，不会被写成已匹配。
          </p>
        </>
      ) : null}

      {stale ? (
        <p className="discovery-flow-note" role="status" data-discovery-params-stale>
          条件已修改，本次核对已失效；重新提交后才能确认采集。
        </p>
      ) : null}

      {sessionHref && !error ? (
        <div className="discovery-confirm-actions">
          <a className="btn ghost sm" href={sessionHref} data-discovery-open-session>在任务会话中打开</a>
        </div>
      ) : null}

      {error && (sessionHref || onRetry) ? (
        <div className="discovery-confirm-actions">
          {onRetry ? (
            <button type="button" className="btn row-action sm" data-discovery-params-retry onClick={onRetry}>
              重新读取参数
            </button>
          ) : null}
          {sessionHref ? (
            <a className="btn ghost sm" href={sessionHref} data-discovery-open-session>在任务会话中打开</a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
