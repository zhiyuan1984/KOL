import DiscoveryProcessPanel from "./DiscoveryProcessPanel";
import DiscoveryResultPane from "./DiscoveryResultPane";
import DiscoverySearchCard from "./DiscoverySearchCard";
import WorkspaceShell from "./WorkspaceShell";
import useDiscovery from "./useDiscovery";
import { type ReactNode } from "react";
import type { DiscoveryBrief, DiscoveryTemplate } from "./discoveryTemplate";
import type { SkillParamField } from "./workspace/SkillParamCard";
import "./discovery-workspace.css";

/**
 * AI发现 = 第三个走同一工作台骨架的页面（WorkspaceShell）：
 * 中栏承接人机交互 —— 红人检索卡片（技能输入参数）与 AI 提问框，条件一改正文即改写；
 * 提交后卡片收起，中栏换成 Codex 过程流；右栏只呈现当前一次运行的状态、转化与结果。
 * 历史运行由任务记录承接，任务点击时带 activeTaskId / activeRunId 回到这张结果页。
 */
export default function DiscoveryWorkspace({
  brief,
  catalog,
  schema,
  onBriefChange,
  activeTaskId = null,
  activeRunId = null,
  lastSubmit = null,
  onRetrySubmit,
  centerHeader,
  centerSupplement,
  centerFooter,
}: {
  brief: DiscoveryBrief;
  catalog?: Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null;
  schema?: SkillParamField[];
  onBriefChange: (brief: DiscoveryBrief) => void;
  activeTaskId?: string | null;
  activeRunId?: string | null;
  /** 提交身份：每次提交都换一个对象，用来把条件卡收起来。 */
  lastSubmit?: unknown;
  onRetrySubmit?: () => void;
  centerHeader?: ReactNode;
  centerSupplement?: ReactNode;
  centerFooter?: ReactNode;
}) {
  const disc = useDiscovery({ activeTaskId, activeRunId, lastSubmit, onRetrySubmit });
  return (
    <WorkspaceShell
      pane="discovery"
      railLabel="红人线索"
      railToggleLabel="红人线索"
      railStorageKey="ui:home-discovery-rail-collapsed"
      railBadge={disc.visible.length}
      resultIdle={!disc.run && !disc.inFlight && !disc.failure}
      streamStick={disc.inFlight}
      resultView={{
        skillId: "creator_discovery",
        resultType: "discovery_candidates",
        status: disc.failure || ["failed", "crawl_failed", "rank_failed", "cancelled"].includes(String(disc.run?.status || ""))
          ? "failed" : disc.inFlight ? "running"
            : ["completed", "succeeded"].includes(String(disc.run?.status || "")) ? "completed" : "idle",
        version: disc.run?.id,
        sourceLabel: disc.run ? "发现运行" : undefined,
        updatedAt: disc.run?.completed_at || disc.run?.created_at || undefined,
        freshness: disc.run?.memory_validity === "stale"
          ? "stale"
          : ["completed", "succeeded"].includes(String(disc.run?.status || ""))
            ? "current"
            : "unknown",
      }}
      centerHeader={centerHeader}
      centerScroll={(
        <>
          {disc.cardVisible ? (
            <DiscoverySearchCard brief={brief} catalog={catalog} schema={schema} onChange={onBriefChange} />
          ) : null}
          {!disc.cardVisible || disc.steps.length ? (
            <DiscoveryProcessPanel
              stage={disc.stage}
              steps={disc.steps}
              think={disc.think}
              inFlight={disc.inFlight}
              hasResults={disc.visible.length > 0}
              cardVisible={disc.cardVisible}
              onEditConditions={disc.showCard}
            />
          ) : null}
          {centerSupplement}
        </>
      )}
      centerFooter={centerFooter}
      rail={<DiscoveryResultPane state={disc} />}
    />
  );
}
