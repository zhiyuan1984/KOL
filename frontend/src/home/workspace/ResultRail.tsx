import type { ReactNode } from "react";
import type { ResultRailViewModel } from "./result-contract";
import NextActionBar from "./NextActionBar";
import ResultRendererRegistry from "./ResultRendererRegistry";

function displayStamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

/** Common result/history/memory/action protocol; individual modes keep their own domain renderer. */
export default function ResultRail({
  pane,
  view,
  children,
}: {
  pane: string;
  view?: ResultRailViewModel;
  children: ReactNode;
}) {
  return <div className="result-rail" data-result-rail={pane}
    data-result-status={view?.status} data-result-type={view?.resultType}>
    {view?.sourceLabel || view?.updatedAt || view?.freshness ? (
      <div className="result-rail-context" data-result-context>
        {view?.sourceLabel ? <span>{view.sourceLabel}</span> : null}
        {view?.sourceVersion ? <span>{view.sourceVersion}</span> : null}
        {view?.updatedAt ? <time dateTime={view.updatedAt}>{displayStamp(view.updatedAt)}</time> : null}
        {view?.freshness && view.freshness !== "current" && view.freshness !== "unknown" ? <span data-result-freshness={view.freshness}>
          {view.freshness === "historical" ? "历史结果" : view.freshness === "stale" ? "来源已变化" : "新鲜度未知"}
        </span> : null}
      </div>
    ) : null}
    {view?.currentResult}
    {view?.resultValue !== undefined && view.resultType ? <ResultRendererRegistry resultType={view.resultType} value={view.resultValue} /> : null}
    {children}
    {view?.memory ? <section className="result-rail-memory" aria-label="相关记忆">{view.memory}</section> : null}
    {view?.history ? <section className="result-rail-history" aria-label="历史结果">{view.history}</section> : null}
    {view?.recommendations?.length || view?.registeredActions?.length ? <NextActionBar
      recommendations={view.recommendations} actions={view.registeredActions}
      onAdopt={view.onAdoptRecommendation} onAction={view.onRegisteredAction} /> : null}
    {view?.suggestions ? <section className="result-rail-suggestions" aria-label="建议的后续任务">{view.suggestions}</section> : null}
    {view?.actions ? <section className="result-rail-actions" aria-label="可用操作">{view.actions}</section> : null}
  </div>;
}
