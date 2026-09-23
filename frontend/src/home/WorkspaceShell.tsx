import { useEffect, useRef, useState, type ReactNode } from "react";
import ResultRail from "./workspace/ResultRail";
import type { ResultRailViewModel } from "./workspace/result-contract";

/** 走同一套两栏工作台骨架的 Home 一级模式。 */
export type WorkspacePane = "today" | "todo" | "discovery" | "pool" | "lifecycle";

/**
 * Home 两栏工作台的唯一几何来源（固定视口：stage 不滚、中栏与右栏各自滚、
 * 页脚控件钉在中栏底）。内容只通过插槽进来，外壳不认识任何具体业务：
 * 每个模式只把交互内容和结果内容塞进插槽；外壳不认识任务、候选或红人。
 */
export default function WorkspaceShell({
  pane,
  railLabel,
  railToggleLabel,
  railStorageKey,
  railBadge,
  resultView,
  scrollAnchorEvent,
  centerHeader,
  centerScroll,
  centerFooter,
  rail,
}: {
  pane: WorkspacePane;
  /** 右栏无障碍名与折叠按钮的文案来源。 */
  railLabel: string;
  railToggleLabel: string;
  /** 折叠状态按页面记忆，互不串台。 */
  railStorageKey: string;
  /** 折叠后挂在按钮上的计数（今日/待办 = 任务数，发现 = 候选数）。 */
  railBadge?: number;
  /** Optional normalized metadata/history/action slots; domain children remain mode-specific. */
  resultView?: ResultRailViewModel;
  /** 可选：该事件触发时把中栏滚动锚点带回顶部（今日/待办的计划刷新）。 */
  scrollAnchorEvent?: string;
  centerHeader?: ReactNode;
  centerScroll: ReactNode;
  centerFooter?: ReactNode;
  rail: ReactNode;
}) {
  const [railCollapsed, setRailCollapsed] = useState(() =>
    localStorage.getItem(railStorageKey) === "true"
  );
  const anchorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!scrollAnchorEvent) return;
    const onRefresh = () => {
      anchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(scrollAnchorEvent, onRefresh);
    return () => window.removeEventListener(scrollAnchorEvent, onRefresh);
  }, [scrollAnchorEvent]);
  const toggleRail = () => {
    setRailCollapsed((current) => {
      const next = !current;
      localStorage.setItem(railStorageKey, String(next));
      return next;
    });
  };
  return (
    <section
      className={"home-mode-pane scope-workspace" + (railCollapsed ? " is-task-rail-collapsed" : "")}
      data-home-pane={pane}
      data-scope-workspace={pane}
    >
      <div className="scope-workspace-center" data-scope-ai-workspace>
        <div className="scope-workspace-center-content">
          {centerHeader}
          <div ref={anchorRef} className="scope-plan-anchor scope-workspace-center-scroll">
            {centerScroll}
          </div>
          {centerFooter}
        </div>
      </div>

      <aside
        className={"scope-task-rail" + (railCollapsed ? " is-collapsed" : "")}
        data-scope-task-rail
        aria-label={railLabel}
      >
        <button
          type="button"
          className="scope-task-rail-toggle"
          aria-expanded={!railCollapsed}
          aria-label={`${railCollapsed ? "展开" : "收起"}${railLabel}`}
          onClick={toggleRail}
        >
          <svg className="scope-task-rail-toggle-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d={railCollapsed ? "m7 4 6 6-6 6" : "m13 4-6 6 6 6"} />
          </svg>
          {railCollapsed ? <strong>{railToggleLabel}</strong> : null}
          {railCollapsed && railBadge != null ? <em>{railBadge}</em> : null}
        </button>
        <div className="scope-task-rail-body" data-scope-rail-body>
          <ResultRail pane={pane} view={resultView}>{rail}</ResultRail>
        </div>
      </aside>
    </section>
  );
}
