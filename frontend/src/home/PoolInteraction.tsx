import type { PoolKol } from "./kolContract";

export type PoolAnalysisKind = "potential" | "risk" | "completeness" | "score";

export const POOL_ANALYSIS_LABELS: Record<PoolAnalysisKind, string> = {
  potential: "高潜分析", risk: "高风险分析", completeness: "资料完整度", score: "红人评分",
};

export const QUESTION_TEMPLATE_MISSING_COPY = "问题模板未在管理端知识库发布，该入口暂不可用。";

export type PoolTemplateState = { ready: boolean; title: string };

/** 当前范围固定在 feed 顶部；只展示用户已选的公开对象。 */
export default function PoolInteraction({ selected, templates, disabled, templateNotice, scopeExpanded, onToggleScope, onAnalyze }: {
  selected: PoolKol[];
  templates: Record<PoolAnalysisKind, PoolTemplateState>;
  disabled?: boolean;
  templateNotice?: string;
  scopeExpanded: boolean;
  onToggleScope: () => void;
  onAnalyze: (kind: PoolAnalysisKind) => void;
}) {
  return <header className="pool-agent-header" data-pool-interaction>
    <h1 data-home-title="pool">公海分析</h1>
    <div className="pool-selection-scope" data-pool-selection-scope aria-live="polite">
      <span>{selected.length ? `已选 ${selected.length} 位红人 · 当前范围` : "未选择对象"}</span>
      {selected.length ? <p>{selected.slice(0, 3).map((card) => card.identity.display).join("、")}
        {selected.length > 3 ? ` +${selected.length - 3}` : ""}</p> : null}
      {selected.length > 3 || scopeExpanded ? <button className="btn text sm" data-pool-selection-all aria-expanded={scopeExpanded}
        onClick={onToggleScope}>{scopeExpanded ? "收起范围" : `查看全部 ${selected.length} 位`}</button> : null}
    </div>
    <div className="pool-agent-quick-actions" data-pool-analysis-actions aria-label="公海分析快捷意图">
      {(Object.keys(POOL_ANALYSIS_LABELS) as PoolAnalysisKind[]).map((kind) => <button
        key={kind} type="button" className="btn text sm"
        data-pool-analysis={kind === "score" ? undefined : kind}
        data-pool-jev-assess={kind === "score" ? "" : undefined}
        disabled={!selected.length || !templates[kind].ready || disabled}
        title={!templates[kind].ready ? QUESTION_TEMPLATE_MISSING_COPY : !selected.length ? "请先在右栏选择红人" : undefined}
        onClick={() => onAnalyze(kind)}>{POOL_ANALYSIS_LABELS[kind]}</button>)}
    </div>
    {templateNotice ? <p className="pool-score-feedback" role="status">{templateNotice}</p> : null}
  </header>;
}
