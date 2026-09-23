import DiscoveryProcessPanel from "./DiscoveryProcessPanel";
import DiscoveryResultPane from "./DiscoveryResultPane";
import DiscoverySearchCard from "./DiscoverySearchCard";
import { api, type SkillResultMemory, type SkillResultMemoryPage } from "../api";
import WorkspaceShell from "./WorkspaceShell";
import useDiscovery from "./useDiscovery";
import { useEffect, useState, type ReactNode } from "react";
import type { DiscoveryBrief, DiscoveryTemplate } from "./discoveryTemplate";
import type { SkillParamField } from "./workspace/SkillParamCard";
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
  const [memoryPage, setMemoryPage] = useState<SkillResultMemoryPage | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  useEffect(() => {
    let alive = true;
    setMemoryBusy(true);
    api.skillResultMemories("creator_discovery")
      .then((page) => { if (alive) setMemoryPage(page); })
      .catch(() => { if (alive) setMemoryError("暂时无法读取此前结果。"); })
      .finally(() => { if (alive) setMemoryBusy(false); });
    return () => { alive = false; };
  }, []);
  const loadMoreMemory = () => {
    const cursor = memoryPage?.next_cursor;
    if (!cursor || memoryBusy) return;
    setMemoryBusy(true);
    setMemoryError("");
    api.skillResultMemories("creator_discovery", cursor)
      .then((page) => setMemoryPage((current) => current
        ? { items: [...current.items, ...page.items], next_cursor: page.next_cursor }
        : page))
      .catch(() => setMemoryError("暂时无法读取更多历史结果。"))
      .finally(() => setMemoryBusy(false));
  };
  const priorMemories = (memoryPage?.items || []).filter((memory) => memory.run_id !== disc.run?.id);
  const memoryView = (
    <section className="discovery-memory-list" aria-label="此前发现结果" data-skill-memory-list>
      <h3>此前结果记忆</h3>
      {memoryBusy && !priorMemories.length ? <p role="status">正在读取此前结果…</p> : null}
      {priorMemories.map((memory: SkillResultMemory) => {
        const summary = memory.summary;
        const headline = typeof summary.headline === "string" ? summary.headline : "发现任务已完成";
        const counts = summary.counts && typeof summary.counts === "object" ? summary.counts as Record<string, unknown> : {};
        const countLabels: Record<string, string> = { candidates: "线索", qualified: "符合条件", raw: "采集到", dropped: "已过滤" };
        const countText = Object.entries(countLabels).flatMap(([key, label]) => {
          const value = counts[key];
          return typeof value === "number" && Number.isFinite(value) ? [`${label} ${value}`] : [];
        }).join(" · ");
        return <article key={memory.id} data-memory-validity={memory.validity}>
          <strong>{headline}</strong>
          {countText ? <span>{countText}</span> : null}
          <small>{memory.validity === "stale" ? "来源已变化 · " : "当前有效 · "}{new Date(memory.updated_at).toLocaleString("zh-CN")}</small>
        </article>;
      })}
      {!memoryBusy && !memoryError && !priorMemories.length ? <p>暂无此前结果。完成一次发现后，可在这里回看已保存的结果摘要。</p> : null}
      {memoryError ? <p role="status">{memoryError}</p> : null}
      {memoryError && !memoryPage ? <button type="button" className="btn ghost sm" onClick={() => {
        setMemoryBusy(true);
        setMemoryError("");
        api.skillResultMemories("creator_discovery")
          .then((page) => setMemoryPage(page))
          .catch(() => setMemoryError("暂时无法读取此前结果。"))
          .finally(() => setMemoryBusy(false));
      }}>重试</button> : null}
      {memoryPage?.next_cursor ? <button type="button" className="btn ghost sm" disabled={memoryBusy} onClick={loadMoreMemory}>
        {memoryBusy ? "读取中…" : "更多历史结果"}
      </button> : null}
    </section>
  ) : undefined;
  return (
    <WorkspaceShell
      pane="discovery"
      railLabel="红人线索"
      railToggleLabel="红人线索"
      railStorageKey="ui:home-discovery-rail-collapsed"
      railBadge={disc.visible.length}
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
            ? (disc.runHistory[0]?.id === disc.run.id ? "current" : "historical")
            : "unknown",
        memory: memoryView,
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
