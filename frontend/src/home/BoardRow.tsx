import type { Task } from "../api";
import {
  displayStatusLabel,
  isDisplayOnlyTask,
  riskLevelLabel,
  taskActionLabel,
  taskDisplayStatus,
  taskPriorityLabel,
  taskPriorityRank,
} from "./homeModel";

const PRIORITY_FALLBACK_ICON = ["🚨", "⭐", "⚡"] as const;

const TASK_TYPE_ICON: Record<string, string> = {
  email_compose: "✉️",
  reply_analysis: "💬",
  creator_profile: "👤",
  confirm_stage: "📍",
  risk_scan: "⚠️",
  deal_memory: "📝",
  creator_budget_report: "📊",
  creator_discovery: "🔎",
  discovery_plan: "🔎",
  creator_daily_tasks: "📋",
  kol_analyze: "🔎",
  creator_outreach: "🤝",
  business_approval: "💰",
  creator_library_all: "📚",
  creator_library_query: "📚",
};

export function displayRowIcon(task: Task): string {
  const icon = String(task.display_icon || "").trim();
  if (icon) return icon;
  const typeIcon = TASK_TYPE_ICON[String(task.task_type || task.skill || "")];
  if (typeIcon) return typeIcon;
  const rank = taskPriorityRank(task);
  return rank <= 2 ? PRIORITY_FALLBACK_ICON[rank] : "○";
}

export function priorityTone(task: Task): { label: string; tone: "high" | "mid" | "low" } {
  const label = taskPriorityLabel(task) || "低";
  const rank = taskPriorityRank(task);
  if (rank <= 1) return { label, tone: "high" };
  if (rank === 2) return { label, tone: "mid" };
  return { label, tone: "low" };
}

/**
 * 统一任务行：今日任务表格和待办分组列表都渲染这一份。
 * 序号/优先级/标题(含 why 与状态/风险 chips)/操作 —— 每件事只说一次。
 */
export default function BoardRow({
  task,
  index,
  busy,
  onAct,
  onEdit,
}: {
  task: Task;
  index: number;
  busy: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
}) {
  const priority = priorityTone(task);
  const status = taskDisplayStatus(task);
  const statusLabel = displayStatusLabel(task);
  const statusAccent = status?.code === "overdue" || status?.code === "due_soon";
  const why = String(task.layout_why || task.display_why || "").trim();
  const icon = displayRowIcon(task);
  const verb = String(task.display_verb || task.next_action_code || "open");
  const actionLabel = taskActionLabel(task);
  const risk = String(task.risk_level || "").trim();
  const riskLabel = risk !== "none" ? riskLevelLabel(task) : "";
  const editable = Boolean(onEdit) && !isDisplayOnlyTask(task);
  return (
    <tr
      className="today-board-row"
      data-today-todo={task.id}
      data-open-item={task.id}
      data-today-display="host"
      data-today-verb={verb}
    >
      <td className="today-board-cell-index">{index + 1}</td>
      <td>
        <span className={`today-board-priority is-${priority.tone}`}>{priority.label}</span>
      </td>
      <td className="today-board-cell-title">
        <div className="today-board-title-wrap">
          <div className="today-board-title-row">
            {icon ? <span className="today-board-icon" aria-hidden="true">{icon}</span> : null}
            <button
              type="button"
              className="today-board-title"
              disabled={busy}
              onClick={() => onAct(task)}
              title={task.title}
            >
              {task.title}
            </button>
          </div>
          {(why || statusLabel || riskLabel) ? (
            <div className="today-board-meta">
              {why ? <p className="today-board-why">{why}</p> : null}
              <span className="today-board-chips">
                {statusLabel ? (
                  <span className={"today-board-chip" + (statusAccent ? " is-accent" : "")} data-board-status={status?.code}>
                    {statusLabel}
                  </span>
                ) : null}
                {riskLabel ? (
                  <span className="today-board-chip" data-risk-level={task.risk_level}>风险{riskLabel}</span>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
      </td>
      <td className="today-board-cell-actions">
        <button
          type="button"
          className="today-board-open"
          data-today-todo-act
          data-today-act={verb}
          data-home-entry="acknowledge-task"
          disabled={busy}
          onClick={() => onAct(task)}
        >
          {actionLabel}
        </button>
        {editable ? (
          <button
            type="button"
            className="today-board-edit"
            data-today-todo-edit
            data-home-entry="edit-task"
            disabled={busy}
            onClick={() => onEdit?.(task)}
          >
            编辑
          </button>
        ) : null}
      </td>
    </tr>
  );
}
