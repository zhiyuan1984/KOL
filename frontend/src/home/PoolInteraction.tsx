import type { ReactNode } from "react";

export type PoolAnalysisKind = "potential" | "risk" | "completeness";

const ANALYSIS_ACTIONS: Array<{ kind: PoolAnalysisKind; label: string; testId: string }> = [
  { kind: "potential", label: "高潜KOL分析", testId: "potential" },
  { kind: "risk", label: "高风险KOL分析", testId: "risk" },
  { kind: "completeness", label: "检查资料完整度", testId: "completeness" },
];

export default function PoolInteraction({
  totalCount,
  selectedCount,
  maintenanceBusy,
  maintenanceNotice,
  maintenanceError,
  interaction,
  onAnalyze,
  onAssessWithJev,
}: {
  totalCount: number;
  selectedCount: number;
  maintenanceBusy?: "avatars" | "jev" | "cleanup" | null;
  maintenanceNotice?: string | null;
  maintenanceError?: string | null;
  interaction?: ReactNode;
  onAnalyze: (kind: PoolAnalysisKind) => void;
  onAssessWithJev?: () => void;
}) {
  const hasSelection = selectedCount > 0;
  const isScoring = maintenanceBusy === "jev";

  return <section className="object-interaction pool-interaction" data-object-interaction="pool" data-pool-interaction>
    <h1 className="pool-overview" data-home-title="pool">公海对象 <span className="pool-total" data-pool-total>{totalCount}</span></h1>
    <div className="pool-analysis-actions" data-pool-analysis-actions aria-label="公海 KOL 分析">
      {ANALYSIS_ACTIONS.map((action) => <button key={action.kind} type="button" data-pool-analysis={action.testId}
        disabled={!hasSelection} title={hasSelection ? undefined : "请先在右栏选择 KOL"} onClick={() => onAnalyze(action.kind)}>{action.label}</button>)}
      <button type="button" data-pool-jev-assess data-home-entry="assess-pool-jev" disabled={Boolean(maintenanceBusy)}
        onClick={onAssessWithJev}>{isScoring ? "KOL评分中…" : "KOL评分"}</button>
    </div>
    {(maintenanceNotice || maintenanceError) && <p className={maintenanceError ? "pool-score-feedback is-error" : "pool-score-feedback"} role={maintenanceError ? "alert" : "status"}>
      {maintenanceError || maintenanceNotice}
    </p>}
    {interaction}
  </section>;
}
