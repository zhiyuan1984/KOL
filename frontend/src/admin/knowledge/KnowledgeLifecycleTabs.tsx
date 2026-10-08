import { LifecycleNavigation } from "../../components/LifecycleNavigation";
import "../../components/lifecycle-workspace.css";

export const KNOWLEDGE_TABS = [
  { id: "catalog", label: "知识规划" },
  { id: "create", label: "知识创作" },
  { id: "processing", label: "知识加工" },
  { id: "pending-review", label: "发布审批" },
  { id: "published", label: "知识资产" },
  { id: "bindings", label: "查询技能" },
  { id: "lifecycle", label: "生命周期" },
  { id: "graph", label: "知识关系" },
] as const;
/** Retain legacy stage IDs for direct links; only the five main workflows appear in navigation. */
export const KNOWLEDGE_NAV_TABS = KNOWLEDGE_TABS.filter(tab => !["bindings", "lifecycle", "graph"].includes(tab.id));
export type KnowledgeStage = typeof KNOWLEDGE_TABS[number]["id"];
export function knowledgeStage(value: string | null): KnowledgeStage {
  return KNOWLEDGE_TABS.some(tab => tab.id === value) ? value as KnowledgeStage : "published";
}

/** 一级入口只在右栏；导航不改中栏筛选，也不推进资产状态。 */
export default function KnowledgeLifecycleTabs({ stage, onChange }: {
  stage: KnowledgeStage;
  onChange: (stage: KnowledgeStage) => void;
}) {
  return <nav className="kbv-lifecycle-tabs" data-kb-lifecycle-tabs>
    <LifecycleNavigation label="知识治理流程" mode="views" idPrefix="kb-stage"
      options={KNOWLEDGE_NAV_TABS.map(tab => ({ ...tab, dataAttributes: { "data-kb-stage": tab.id } }))}
      value={stage} onChange={id => onChange(id as KnowledgeStage)} />
  </nav>;
}
