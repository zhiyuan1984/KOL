import type { HomeDiscoveryRun } from "./discoveryHome";
import {
  discoveryRunStatusLabel,
  discoveryRunStatusOk,
  discoveryRunStatusRows,
} from "./discoveryLeadFields";

/**
 * Crawl status / Completed：完成时间、耗时、原始数量、入围数量的单行状态卡。
 * `shortlistFallback` 用结果区实际展示的条数，保证同一屏上「入围数量」只有一个口径。
 */
export default function DiscoveryRunStatusCard({
  run,
  shortlistFallback,
}: {
  run: HomeDiscoveryRun | null;
  shortlistFallback?: number;
}) {
  const rows = discoveryRunStatusRows(run, shortlistFallback);
  const ok = discoveryRunStatusOk(run);
  return (
    <section
      className={"discovery-status-card" + (ok ? " is-ok" : "")}
      data-discovery-status-card
      data-discovery-run-status={String(run?.status || "unknown")}
      aria-label="检索状态"
    >
      <span className="discovery-status-state" data-discovery-run-status-label>
        <span className="discovery-status-dot" aria-hidden />
        <span className="discovery-status-copy">{discoveryRunStatusLabel(run)}</span>
      </span>
      <dl className="discovery-status-rows">
        {rows.map((row) => (
          <div className="discovery-status-row" key={row.key} data-discovery-run-status-row={row.key}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
