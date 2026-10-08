import { useEffect, useRef, useState, type ReactNode } from "react";
import PanelToggleIcon from "../components/PanelToggleIcon";
import StreamScrollJump from "../components/StreamScrollJump";
import { useStreamScroll } from "../hooks/useStreamScroll";
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
  resultIdle = false,
  focusResults = false,
  streamStick = false,
  preserveRailPosition = false,
  railScrollJump = false,
  resultView,
  scrollAnchorEvent,
  centerHeader,
  centerScroll,
  centerFooter,
  railHeader,
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
  /** No result or history yet: keep the rail visible at its documented minimum width. */
  resultIdle?: boolean;
  /** Results are the primary working surface; render them in the full center column. */
  focusResults?: boolean;
  /** 中栏正在流式产出（发现运行中 / 计划生成中）：新内容贴底跟随。 */
  streamStick?: boolean;
  /** 今日/待办切换或重新渲染时保留右栏阅读位置。 */
  preserveRailPosition?: boolean;
  /** 右栏是持续更新的结果面：回看时保持位置，提供「回到最新」入口。 */
  railScrollJump?: boolean;
  /** Optional normalized metadata/history/action slots; domain children remain mode-specific. */
  resultView?: ResultRailViewModel;
  /** 可选：该事件触发时把中栏滚动锚点带回顶部（今日/待办的计划刷新）。 */
  scrollAnchorEvent?: string;
  centerHeader?: ReactNode;
  centerScroll: ReactNode;
  centerFooter?: ReactNode;
  /** 可选固定结果头；提供时只有右栏内容区滚动，头部与批量控件保持可用。 */
  railHeader?: ReactNode;
  rail: ReactNode;
}) {
  const [railCollapsed, setRailCollapsed] = useState(() =>
    localStorage.getItem(railStorageKey) === "true"
  );
  const railRef = useRef<HTMLElement | null>(null);
  const railStickBottom = useRef(true);
  const [railJump, setRailJump] = useState(false);
  // 中栏：与会话页同一套时间流滚动规则；进入模式从顶部开始，只在流式产出时贴底跟随。
  const stream = useStreamScroll({ resetKey: pane, start: "top", follow: streamStick });
  useEffect(() => {
    if (!scrollAnchorEvent) return;
    const onRefresh = () => stream.scrollTo("top");
    window.addEventListener(scrollAnchorEvent, onRefresh);
    return () => window.removeEventListener(scrollAnchorEvent, onRefresh);
  }, [scrollAnchorEvent, stream.scrollTo]);
  useEffect(() => {
    const railEl = railRef.current;
    if (railEl) {
      let savedPosition = 0;
      if (preserveRailPosition) {
        try { savedPosition = Number(sessionStorage.getItem(`ui:home-${pane}-rail-scroll`) || 0) || 0; } catch { /* Storage is optional. */ }
      }
      railEl.scrollTop = savedPosition;
    }
    railStickBottom.current = true;
    setRailJump(false);
  }, [pane, preserveRailPosition]);
  // 右栏：结果原位更新时不强制跳转，只在自己就在底部时跟随；回看历史时给「回到最新」。
  useEffect(() => {
    if (!railScrollJump) return;
    const el = railRef.current;
    if (!el) return;
    const follow = () => {
      if (railStickBottom.current) {
        el.scrollTop = el.scrollHeight;
      } else {
        setRailJump(el.scrollHeight > el.clientHeight + 1);
      }
    };
    const observer = new MutationObserver(follow);
    observer.observe(el, { subtree: true, childList: true, characterData: true });
    const body = el.matches(".scope-task-rail-body")
      ? el.querySelector<HTMLElement>(".result-rail")
      : el.querySelector<HTMLElement>(".scope-task-rail-body");
    const resizeObserver = typeof ResizeObserver === "undefined" || !body
      ? null
      : new ResizeObserver(follow);
    if (resizeObserver && body) resizeObserver.observe(body);
    follow();
    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
    };
  }, [railScrollJump, pane]);
  const onRailScroll = () => {
    const el = railRef.current;
    if (!el) return;
    if (preserveRailPosition) {
      try { sessionStorage.setItem(`ui:home-${pane}-rail-scroll`, String(el.scrollTop)); } catch { /* Storage is optional. */ }
    }
    railStickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
    setRailJump(el.scrollHeight > el.clientHeight + 1);
  };
  const jumpRailToLatest = () => {
    const el = railRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    railStickBottom.current = true;
    setRailJump(false);
  };
  const toggleRail = () => {
    setRailCollapsed((current) => {
      const next = !current;
      localStorage.setItem(railStorageKey, String(next));
      return next;
    });
  };
  return (
    <section
      className={"home-mode-pane scope-workspace" + (railCollapsed ? " is-task-rail-collapsed" : "") + (resultIdle ? " is-result-idle" : "") + (focusResults ? " is-result-focus" : "")}
      data-home-pane={pane}
      data-scope-workspace={pane}
    >
      <div className="scope-workspace-center" data-scope-ai-workspace>
        <div className="scope-workspace-center-content">
          {centerHeader}
          <div className="scope-workspace-center-scroll-wrap">
            <div
              ref={stream.ref}
              className="scope-plan-anchor scope-workspace-center-scroll"
              onScroll={stream.onScroll}
            >
              <div className="scope-workspace-center-scroll-content">
                {centerScroll}
              </div>
            </div>
            {stream.canJump ? (
              <StreamScrollJump atBottom={stream.atBottom} onClick={stream.toggle} data-scope-scroll-jump />
            ) : null}
          </div>
          {centerFooter}
        </div>
      </div>

      {!focusResults ? <aside
        ref={(node) => { if (!railHeader) railRef.current = node; }}
        className={"scope-task-rail" + (railCollapsed ? " is-collapsed" : "") + (railHeader ? " has-fixed-header" : "")}
        data-scope-task-rail
        aria-label={railLabel}
        onScroll={!railHeader && (railScrollJump || preserveRailPosition) ? onRailScroll : undefined}
      >
        <button
          type="button"
          className="scope-task-rail-toggle"
          aria-expanded={!railCollapsed}
          aria-label={`${railCollapsed ? "展开" : "收起"}${railLabel}`}
          title={`${railCollapsed ? "展开" : "收起"}${railLabel}`}
          onClick={toggleRail}
        >
          {/* 箭头（›/‹）换成「侧栏面板」图标：状态由 aria-expanded 与折叠档的竖排文字表达。 */}
          <PanelToggleIcon className="scope-task-rail-toggle-icon" />
          {railCollapsed && railBadge != null ? <em aria-label={`${railToggleLabel}${railBadge}`}>{railBadge}</em> : null}
        </button>
        {railHeader ? <div className="scope-task-rail-fixed-header" data-scope-rail-header>{railHeader}</div> : null}
        <div className="scope-task-rail-body" data-scope-rail-body
          ref={(node) => { if (railHeader) railRef.current = node; }}
          onScroll={railHeader && (railScrollJump || preserveRailPosition) ? onRailScroll : undefined}>
          <ResultRail pane={pane} view={resultView}>{rail}</ResultRail>
        </div>
        {railScrollJump && railJump ? (
          <div className="scope-rail-jump-wrap">
            <button
              type="button"
              className="scope-scroll-jump"
              data-scope-rail-jump
              data-tooltip="回到最新"
              aria-label="回到最新"
              onClick={jumpRailToLatest}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 4v15" />
                <path d="m5.5 12.5 6.5 6.5 6.5-6.5" />
              </svg>
            </button>
          </div>
        ) : null}
      </aside> : null}
    </section>
  );
}
