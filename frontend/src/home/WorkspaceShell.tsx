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
  resultIdle = false,
  focusResults = false,
  streamStick = false,
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
  /** No result or history yet: keep the rail visible at its documented minimum width. */
  resultIdle?: boolean;
  /** Results are the primary working surface; render them in the full center column. */
  focusResults?: boolean;
  /** 中栏正在流式产出（发现运行中 / 计划生成中）：新内容贴底跟随。 */
  streamStick?: boolean;
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);
  const [scrollJump, setScrollJump] = useState(false);
  useEffect(() => {
    if (!scrollAnchorEvent) return;
    const onRefresh = () => {
      anchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(scrollAnchorEvent, onRefresh);
    return () => window.removeEventListener(scrollAnchorEvent, onRefresh);
  }, [scrollAnchorEvent]);
  // 每次进入一个模式都从流顶部开始；贴底状态从此刻重新计算。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    stickBottom.current = true;
    setScrollJump(false);
  }, [pane]);
  // 只跟随「正在流式产出」的内容：打开历史任务从顶部看，不抢着跳到底。
  // 开始产出时把视口贴到尾部，之后由 MutationObserver 逐段跟随。
  const streamStickRef = useRef(streamStick);
  useEffect(() => {
    streamStickRef.current = streamStick;
    if (streamStick) {
      stickBottom.current = true;
      setScrollJump(false);
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [streamStick]);
  // 贴底自动滚动：流式进行中且用户在底部时，流里追加新内容（步骤/推理）就跟着滑到底；
  // 用户上翻读历史时不抢滚动，只亮「回到底部」。effect 挂在首屏 commit 之后，
  // 所以打开页面时已有的历史内容不算“新内容”，不会一进来就跳到流底。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const overflows = () => el.scrollHeight > el.clientHeight + 24;
    const observer = new MutationObserver(() => {
      if (streamStickRef.current && stickBottom.current) {
        el.scrollTop = el.scrollHeight;
      } else {
        setScrollJump(overflows());
      }
    });
    observer.observe(el, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
    stickBottom.current = atBottom;
    setScrollJump(!atBottom && el.scrollHeight > el.clientHeight + 24);
  };
  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    stickBottom.current = true;
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
              ref={(node) => {
                anchorRef.current = node;
                scrollRef.current = node;
              }}
              className="scope-plan-anchor scope-workspace-center-scroll"
              onScroll={onScroll}
            >
              {centerScroll}
            </div>
            {scrollJump ? (
              <button
                type="button"
                className="scope-scroll-jump"
                data-scope-scroll-jump
                data-tooltip="查看最新"
                aria-label="查看最新"
                onClick={jumpToBottom}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 4v15" />
                  <path d="m5.5 12.5 6.5 6.5 6.5-6.5" />
                </svg>
              </button>
            ) : null}
          </div>
          {centerFooter}
        </div>
      </div>

      {!focusResults ? <aside
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
            {/* 右栏贴右边：收起向右、展开向左。 */}
            <path d={railCollapsed ? "m13 4-6 6 6 6" : "m7 4 6 6-6 6"} />
          </svg>
          {railCollapsed ? <strong>{railToggleLabel}</strong> : null}
          {railCollapsed && railBadge != null ? <em>{railBadge}</em> : null}
        </button>
        <div className="scope-task-rail-body" data-scope-rail-body>
          <ResultRail pane={pane} view={resultView}>{rail}</ResultRail>
        </div>
      </aside> : null}
    </section>
  );
}
