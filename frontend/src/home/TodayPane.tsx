import { useState } from "react";
import type { RecommendedTask, Task } from "../api";
import { recIcon } from "../recommendedTasks";
import { recommendationSourceLabel } from "./modes";
import { findDuplicateTodo, recommendationIdentity } from "./todoDedupe";
import {
  canOpenExistingTaskFlow,
  handleLine,
  isHighValueInsight,
  nextStepLine,
  todoBucket,
  urgencyLabel,
  dueLabel,
  whyLine,
} from "./homeModel";
import "./today-rec-row.css";

const TODAY_FOLD_LIMIT = 3;

function GoArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FoldMore({
  total,
  limit = TODAY_FOLD_LIMIT,
  expanded,
  onToggle,
}: {
  total: number;
  limit?: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (total <= limit) return null;
  const hidden = total - limit;
  return (
    <button type="button" className="home-fold-more" data-fold-more data-fold-expanded={expanded ? "true" : "false"} onClick={onToggle}>
      {expanded ? "收起" : `展开更多（${hidden}）`}
    </button>
  );
}

function useFoldedItems<T>(items: T[], limit = TODAY_FOLD_LIMIT) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded || items.length <= limit ? items : items.slice(0, limit);
  return {
    expanded,
    visible,
    toggle: () => setExpanded((value) => !value),
    total: items.length,
    limit,
  };
}

function isExceptionTask(task: Task) {
  if (task.risk || String(task.status || "") === "failed") return true;
  const blob = `${task.title || ""} ${task.current_stage || ""} ${task.history_summary || ""}`;
  return /异常|拒绝|暂缓/.test(blob);
}

function statusIcon(task: Task) {
  if (isExceptionTask(task)) return "⚠";
  const bucket = todoBucket(task);
  if (bucket === "overdue") return "⏰";
  if (bucket === "today") return "📅";
  if (bucket === "approval" || bucket === "waiting") return "⏸";
  if (bucket === "running") return "⟳";
  return "○";
}

function pickPrimary(tasks: Task[]): Task | null {
  if (!tasks.length) return null;
  return (
    tasks.find(isExceptionTask) ||
    tasks.find((task) => todoBucket(task) === "overdue") ||
    tasks.find((task) => todoBucket(task) === "today") ||
    tasks.find((task) => todoBucket(task) === "approval") ||
    tasks[0]
  );
}

function primaryCta(task: Task) {
  if (isExceptionTask(task)) return { icon: "⚠", label: "去处理这条异常" };
  const bucket = todoBucket(task);
  if (bucket === "overdue") return { icon: "⏰", label: "先补上这条逾期" };
  if (bucket === "today") return { icon: "📅", label: "今天先做完这条" };
  if (bucket === "approval") return { icon: "⏸", label: "去审批" };
  if (canOpenExistingTaskFlow(task)) return { icon: "▶", label: "打开这条继续" };
  return { icon: "▶", label: "打开这条看看" };
}

function briefingCopy(tasks: Task[]) {
  const todayCount = tasks.length;
  const overdue = tasks.filter((task) => todoBucket(task) === "overdue").length;
  const dueToday = tasks.filter((task) => todoBucket(task) === "today").length;
  const exceptions = tasks.filter(isExceptionTask).length;
  const stats = exceptions
    ? `${todayCount}项今天待处理 · ${overdue}逾期 · ${dueToday}今天到期 · ${exceptions}条异常`
    : `${todayCount}项今天待处理 · ${overdue}逾期 · ${dueToday}今天到期`;
  if (exceptions) return { lead: "今天先处理异常。", stats };
  if (overdue) return { lead: "今天先补逾期。", stats };
  if (dueToday) return { lead: "今天没有异常，按到期顺序做。", stats };
  return { lead: "今天没有火烧事项，下面 1、2、3 按顺序做。", stats };
}

function duplicateIndex(todos: Task[], item: RecommendedTask, official: Task[]) {
  const hit = findDuplicateTodo(todos, recommendationIdentity(item));
  if (!hit) return 0;
  const idx = official.findIndex((task) => task.id === hit.id);
  if (idx >= 0) return idx + 1;
  const byTitle = official.findIndex((task) => task.title === item.title);
  return byTitle >= 0 ? byTitle + 1 : 0;
}
