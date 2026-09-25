import type { ReactNode } from "react";
import WorkspaceShell, { type WorkspacePane } from "./WorkspaceShell";

type ObjectWorkspacePane = Extract<WorkspacePane, "pool" | "lifecycle">;

/**
 * 公海 / 我的红人共享的对象工作台组合层。
 * 两个对象面始终保持「中栏人机交互 + 右栏受控对象动作」的工作台结构。
 */
export default function ObjectWorkspace({
  pane,
  title,
  description,
  selectedCount,
  resultCount,
  railLabel,
  railToggleLabel,
  railStorageKey,
  centerHeader,
  centerFooter,
  interaction,
  rail,
}: {
  pane: ObjectWorkspacePane;
  title: string;
  description: string;
  selectedCount: number;
  resultCount: number;
  railLabel: string;
  railToggleLabel: string;
  railStorageKey: string;
  centerHeader?: ReactNode;
  centerFooter?: ReactNode;
  interaction?: ReactNode;
  rail: ReactNode;
}) {
  const hasSelection = selectedCount > 0;
  const interactionView = (
    <>
      <section className="object-interaction" data-object-interaction={pane}>
        <div className="object-interaction-status" role="status">
          <span aria-hidden>{hasSelection ? "✓" : "○"}</span>
          <strong>{hasSelection ? `已选择 ${selectedCount} 位` : "等待选择对象"}</strong>
        </div>
        <h1 data-home-title={pane}>{title}</h1>
        <p>{description}</p>
        <div className="object-interaction-guide">
          <strong>{hasSelection ? "现在可以继续提问" : "从右栏开始"}</strong>
          <p>
            {hasSelection
              ? "已选对象会作为当前问题的明确范围。Agent 分析不会自动领取、发信或修改阶段。"
              : "选择对象后，可在下方提问框要求 Agent 比较、分析风险或建议下一步。明确业务动作仍在右栏独立确认。"}
          </p>
        </div>
      </section>
      {interaction}
    </>
  );
  return (
    <WorkspaceShell
      pane={pane}
      railLabel={railLabel}
      railToggleLabel={railToggleLabel}
      railStorageKey={railStorageKey}
      railBadge={resultCount}
      resultView={{
        resultType: pane === "pool" ? "kol_pool_objects" : "followed_kol_objects",
        status: resultCount > 0 ? "ready" : "idle",
        sourceLabel: pane === "pool" ? undefined : "我的跟进对象",
        freshness: "unknown",
      }}
      centerHeader={centerHeader}
      centerScroll={interactionView}
      centerFooter={centerFooter}
      rail={rail}
    />
  );
}
