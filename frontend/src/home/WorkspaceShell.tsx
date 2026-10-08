import { useEffect, useState, type ReactNode } from "react";
import PanelToggleIcon from "../components/PanelToggleIcon";
import { useWorkspaceScroll } from "../hooks/useWorkspaceScroll";
import ResultRail from "./workspace/ResultRail";
import type { ResultRailViewModel } from "./workspace/result-contract";
import "./workspace/workspace-shell.css";
import "./workspace/agent-session.css";

export type WorkspacePane = "today" | "todo" | "discovery" | "pool" | "lifecycle" | "session";
export function revealWorkspace(sessionId: string, region: "center" | "rail", target?: string) {
  window.dispatchEvent(new CustomEvent("workspace:reveal", { detail: { sessionId, region, target } }));
}

/** Shared geometry and reading behavior. The shell never decides permissions. */
export default function WorkspaceShell({ pane, railLabel, railToggleLabel, railStorageKey, railBadge,
  resultIdle = false, focusResults = false, streamStick = false, railScrollJump = false,
  resultView, scrollAnchorEvent, centerHeader, centerScroll, centerFooter, railHeader, rail, preserveRailPosition = false,
  sessionId, scrollReady = true, className = "", pendingTarget,
}: {
  pane: WorkspacePane; railLabel: string; railToggleLabel: string; railStorageKey: string;
  railBadge?: number; resultIdle?: boolean; focusResults?: boolean; streamStick?: boolean;
  railScrollJump?: boolean; resultView?: ResultRailViewModel; scrollAnchorEvent?: string;
  centerHeader?: ReactNode; centerScroll: ReactNode; centerFooter?: ReactNode; railHeader?: ReactNode; rail: ReactNode; preserveRailPosition?: boolean;
  sessionId?: string | null; scrollReady?: boolean; className?: string; pendingTarget?: string | null;
}) {
  const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem(railStorageKey) === "true");
  const readingKey = `ui:workspace-reading:${sessionId || pane}`;
  const center = useWorkspaceScroll(`${readingKey}:center`, scrollReady, streamStick);
  // A late first result starts at its heading; only a reader who reaches the
  // tail opts into following later revisions in this column.
  const result = useWorkspaceScroll(`${readingKey}:rail`, scrollReady, false);
  useEffect(() => { setRailCollapsed(localStorage.getItem(railStorageKey) === "true"); }, [railStorageKey]);
  useEffect(() => {
    if (!scrollAnchorEvent) return;
    const refresh = () => center.jump(true);
    window.addEventListener(scrollAnchorEvent, refresh);
    return () => window.removeEventListener(scrollAnchorEvent, refresh);
  }, [scrollAnchorEvent]);
  useEffect(() => {
    let frame = 0;
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; region: "center" | "rail"; target?: string }>).detail;
      if (detail.sessionId !== sessionId) return;
      if (detail.region === "rail") setRailCollapsed(false);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scroll = detail.region === "rail" ? result : center;
        const target = Array.from(scroll.ref.current?.querySelectorAll<HTMLElement>("[data-tab],[data-runtime-action],[data-result-message]") || [])
          .find(el => [el.dataset.tab, el.dataset.runtimeAction, el.dataset.resultMessage].includes(detail.target));
        scroll.reveal(target);
      });
    };
    window.addEventListener("workspace:reveal", reveal);
    return () => { window.removeEventListener("workspace:reveal", reveal); cancelAnimationFrame(frame); };
  }, [sessionId]);
  useEffect(() => {
    if (!pendingTarget || !scrollReady) return;
    const frame = requestAnimationFrame(() => {
      const target = Array.from(center.ref.current?.querySelectorAll<HTMLElement>("[data-runtime-action]") || [])
        .find(el => el.dataset.runtimeAction === pendingTarget);
      if (target) center.reveal(target.querySelector<HTMLElement>("button.work,[data-discovery-start-confirm]") || target, false);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingTarget, scrollReady]);
  const jumpLabel = center.position.updated ? "回到最新" : center.position.atBottom ? "滚到顶部" : "滚到底部";
  return <section className={`home-mode-pane scope-workspace ${className}${railCollapsed ? " is-task-rail-collapsed" : ""}${resultIdle ? " is-result-idle" : ""}${focusResults ? " is-result-focus" : ""}`}
    data-home-pane={pane} data-scope-workspace={pane} data-workspace-session={sessionId}
    data-agent-visual={pane === "session" || pane === "discovery" ? "session-pre-2e909ebe" : undefined}>
    <div className={`scope-workspace-center${pane === "session" ? " session-center" : ""}`} data-scope-ai-workspace>
      <div className="scope-workspace-center-content">
        {centerHeader}
        <div className="scope-workspace-center-scroll-wrap">
          <div ref={center.ref} className="scope-plan-anchor scope-workspace-center-scroll"
            data-session-stream-pane={pane === "session" ? true : undefined}
            data-ai-conversation={pane === "session" ? true : undefined} role={pane === "session" ? "log" : undefined}>
            <div className="scope-workspace-center-scroll-content">{centerScroll}</div>
          </div>
          {center.position.scrollable ? <button type="button" className="scope-scroll-jump" data-scope-scroll-jump
            data-session-scroll-jump={pane === "session" ? true : undefined} data-tooltip={jumpLabel} aria-label={jumpLabel}
            onClick={() => center.jump(center.position.atBottom && !center.position.updated)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={center.position.atBottom && !center.position.updated ? "M12 20V5m-7 7 7-7 7 7" : "M12 4v15m-7-7 7 7 7-7"} /></svg>
          </button> : null}
        </div>
        {centerFooter}
      </div>
    </div>
    {!focusResults ? <aside className={`scope-task-rail${railCollapsed ? " is-collapsed" : ""}`} data-scope-task-rail
      data-workbench={pane === "session" ? true : undefined} aria-label={railLabel}>
      <button type="button" className="scope-task-rail-toggle" data-workbench-toggle={pane === "session" ? true : undefined}
        aria-expanded={!railCollapsed} aria-label={`${railCollapsed ? "展开" : "收起"}${railLabel}`}
        title={`${railCollapsed ? "展开" : "收起"}${railLabel}`} onClick={() => setRailCollapsed(current => {
          localStorage.setItem(railStorageKey, String(!current)); return !current;
        })}>
        <PanelToggleIcon className="scope-task-rail-toggle-icon" />
        {railCollapsed && railBadge != null ? <em aria-label={`${railToggleLabel}${railBadge}`}>{railBadge}</em> : null}
      </button>
      {!railCollapsed ? railHeader : null}
      <div ref={result.ref} className="scope-task-rail-scroll" data-preserve-position={preserveRailPosition || undefined}>
        <div className="scope-task-rail-body" data-scope-rail-body>
          <ResultRail pane={pane} view={resultView}>{rail}</ResultRail>
        </div>
      </div>
      {railScrollJump && result.position.updated ? <button type="button" className="scope-scroll-jump" data-scope-rail-jump
        data-tooltip="回到最新" aria-label="回到最新" onClick={() => result.jump(false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15m-7-7 7 7 7-7" /></svg>
      </button> : null}
    </aside> : null}
  </section>;
}
