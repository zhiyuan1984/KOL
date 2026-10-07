import type { ReactNode } from "react";

export type PoolAnalysisKind = "potential" | "risk" | "completeness" | "score";

/** 三个分析入口；「KOL评分」单独渲染，因为它同时受确认条约束。 */
const ANALYSIS_ACTIONS: Array<{ kind: Exclude<PoolAnalysisKind, "score">; label: string; testId: string }> = [
  { kind: "potential", label: "高潜KOL分析", testId: "potential" },
  { kind: "risk", label: "高风险KOL分析", testId: "risk" },
  { kind: "completeness", label: "检查资料完整度", testId: "completeness" },
];

export const POOL_ANALYSIS_LABELS: Record<PoolAnalysisKind, string> = {
  potential: "高潜KOL分析",
  risk: "高风险KOL分析",
  completeness: "检查资料完整度",
  score: "KOL评分",
};

export const QUESTION_TEMPLATE_MISSING_COPY = "问题模板未在管理端知识库发布，该入口暂不可用。";

export type PoolTemplateState = { ready: boolean; title: string };

export type PoolScoreConfirm = {
  busy: boolean;
  count: number;
  error?: string | null;
};

export default function PoolInteraction({
  totalCount,
  selectedCount,
  maintenanceBusy,
  maintenanceNotice,
  maintenanceError,
  interaction,
  templates,
  templateNotice,
  criteriaNote,
  scoreConfirm,
  onAnalyze,
  onConfirmScore,
  onCancelScore,
}: {
  totalCount: number;
  selectedCount: number;
  maintenanceBusy?: "jev" | null;
  maintenanceNotice?: string | null;
  maintenanceError?: string | null;
  interaction?: ReactNode;
  templates: Record<PoolAnalysisKind, PoolTemplateState>;
  templateNotice?: string | null;
  /** 评分口径说明：当前 AI 发现条件是否参与本次评分。 */
  criteriaNote?: string | null;
  scoreConfirm?: PoolScoreConfirm | null;
  onAnalyze: (kind: PoolAnalysisKind) => void;
  onConfirmScore?: () => void;
  onCancelScore?: () => void;
}) {
  const hasSelection = selectedCount > 0;
  const isScoring = maintenanceBusy === "jev";
  const disabledHint = (kind: PoolAnalysisKind): string | undefined => {
    if (!templates[kind].ready) return QUESTION_TEMPLATE_MISSING_COPY;
    if (kind === "score") return isScoring ? "评分正在进行" : undefined;
    return hasSelection ? undefined : "请先在右栏选择 KOL";
  };

  return <section className="object-interaction pool-interaction" data-object-interaction="pool" data-pool-interaction>
    <h1 className="pool-overview" data-home-title="pool">公海现有KOL共<span className="pool-total" data-pool-total>{totalCount}</span>位供你选择</h1>
    <div className="pool-analysis-actions" data-pool-analysis-actions aria-label="公海 KOL 分析">
      {ANALYSIS_ACTIONS.map((action) => <button key={action.kind} type="button" data-pool-analysis={action.testId}
        disabled={!hasSelection || !templates[action.kind].ready}
        title={disabledHint(action.kind)} onClick={() => onAnalyze(action.kind)}>{action.label}</button>)}
      <button type="button" data-pool-jev-assess data-home-entry="assess-pool-jev"
        disabled={!templates.score.ready || isScoring || Boolean(scoreConfirm?.busy)}
        title={disabledHint("score")} onClick={() => onAnalyze("score")}>{isScoring || scoreConfirm?.busy ? "KOL评分中…" : "KOL评分"}</button>
    </div>
    {scoreConfirm && <div className="pool-score-confirm" role="group" aria-label="执行 KOL 评分确认" data-pool-score-confirm
      data-pool-score-targets={scoreConfirm.count}>
      <p className="pool-score-confirm-text">
        将按知识库的评分问题模板提交，并对 {scoreConfirm.count ? `已选 ${scoreConfirm.count} 位` : "公海未评分"} KOL 调用 Jev 评分；评分写入 KOL 记忆。
        {criteriaNote ? ` ${criteriaNote}` : ""}
      </p>
      <div className="pool-score-confirm-actions">
        <button type="button" className="btn ghost sm" data-pool-score-cancel disabled={scoreConfirm.busy} onClick={onCancelScore}>取消</button>
        <button type="button" className="btn work sm" data-pool-score-execute disabled={scoreConfirm.busy} onClick={onConfirmScore}>{scoreConfirm.busy ? "评分中…" : "执行评分"}</button>
      </div>
      {scoreConfirm.error && <p className="pool-score-feedback is-error" role="alert">{scoreConfirm.error}</p>}
    </div>}
    {templateNotice && <p className="pool-score-feedback" role="status" data-pool-template-notice>{templateNotice}</p>}
    {!scoreConfirm && (maintenanceNotice || maintenanceError) && <p className={maintenanceError ? "pool-score-feedback is-error" : "pool-score-feedback"} role={maintenanceError ? "alert" : "status"}>
      {maintenanceError || maintenanceNotice}
    </p>}
    {interaction}
  </section>;
}
