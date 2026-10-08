import type { WsStats } from "./shared";

export type KnowledgeStage = "create" | "processing" | "pending-review" | "published" | "lifecycle";

type Props = {
  stage: KnowledgeStage;
  stats?: WsStats;
  onChange: (stage: KnowledgeStage) => void;
};

const TABS: Array<{ id: KnowledgeStage; label: string; hint: string }> = [
  { id: "create", label: "知识创作", hint: "新建与上传" },
  { id: "processing", label: "解析加工", hint: "解析与索引" },
  { id: "pending-review", label: "待审批", hint: "提交与发布前" },
  { id: "published", label: "已发布", hint: "当前生效资产" },
  { id: "lifecycle", label: "生命周期管理", hint: "版本与治理" },
];

function countFor(stage: KnowledgeStage, stats?: WsStats): number | null {
  if (!stats) return null;
  if (stage === "pending-review") return Number(stats.pending_review?.count || 0) + Number(stats.pending_documents?.count || 0);
  if (stage === "published") return Number(stats.status?.published || 0);
  if (stage === "lifecycle") return Number(stats.status?.archived || 0) + Number(stats.expiring?.count || 0);
  if (stage === "create") return Number(stats.status?.draft || 0);
  return null;
}

export default function KnowledgeLifecycleTabs({ stage, stats, onChange }: Props) {
  return (
    <nav className="kbv-lifecycle-tabs" aria-label="知识生命周期阶段" role="tablist" data-kb-lifecycle-tabs>
      {TABS.map((tab) => {
        const count = countFor(tab.id, stats);
        const selected = tab.id === stage;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`kb-stage-panel-${tab.id}`}
            className="kbv-lifecycle-tab"
            data-kb-stage={tab.id}
            onClick={() => onChange(tab.id)}
          >
            <span>{tab.label}</span>
            {count !== null ? <small>{count}</small> : null}
            <em>{tab.hint}</em>
          </button>
        );
      })}
    </nav>
  );
}
