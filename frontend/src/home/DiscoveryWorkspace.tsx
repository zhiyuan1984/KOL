import DiscoveryProcessPanel from "./DiscoveryProcessPanel";
import DiscoveryResultPane from "./DiscoveryResultPane";
import DiscoverySearchCard from "./DiscoverySearchCard";
import WorkspaceShell from "./WorkspaceShell";
import useDiscovery from "./useDiscovery";
import type { ReactNode } from "react";
import type { DiscoveryBrief, DiscoveryTemplate } from "./discoveryTemplate";
import "./discovery-workspace.css";

/**
 * AI发现 = 第三个走同一工作台骨架的页面（WorkspaceShell）：
 * 中栏承接人机交互 —— 红人检索卡片（技能输入参数）与 AI 提问框，条件一改正文即改写；
 * 提交后卡片收起，中栏换成 Codex 过程流；右栏是 Codex 结果区（成功页 / 失败页 +
 * 结果摘要 + 线索明细）。
 */
export default function DiscoveryWorkspace({
  brief,
  catalog,
  onBriefChange,
  activeTaskId = null,
  activeRunId = null,
  lastSubmit = null,
  onRetrySubmit,
  centerFooter,
}: {
  brief: DiscoveryBrief;
  catalog?: Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null;
  onBriefChange: (brief: DiscoveryBrief) => void;
  activeTaskId?: string | null;
  activeRunId?: string | null;
  /** 提交身份：每次提交都换一个对象，用来把条件卡收起来。 */
  lastSubmit?: unknown;
  onRetrySubmit?: () => void;
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
      centerScroll={(
        <>
          {disc.cardVisible ? (
            <DiscoverySearchCard brief={brief} catalog={catalog} onChange={onBriefChange} />
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
        </>
      )}
      centerFooter={centerFooter}
      rail={<DiscoveryResultPane state={disc} />}
    />
  );
}
