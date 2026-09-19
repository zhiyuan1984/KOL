import type { Task } from "../api";
import { displayStatusLabel, taskDisplayStatus, taskPriorityLabel, taskPriorityRank } from "./homeModel";

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

export default function DisplayWorkRow({
  task,
  busy,
  onAct,
  onEdit,
}: {
  task: Task;
  busy: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
}) {
  const why = String(task.layout_why || task.display_why || "").trim();
  const label = String(task.display_label || "").trim();
  const verb = String(task.display_verb || task.next_action_code || "open");
  const icon = displayRowIcon(task);
  const priority = taskPriorityLabel(task);
  const status = taskDisplayStatus(task);
  const statusLabel = displayStatusLabel(task);
  const statusAccent = status?.code === "overdue" || status?.code === "due_soon";
  const actionLabel = label || (verb === "approve" ? "去审批" : verb === "edit" ? "编辑" : "处理");
  const editable = Boolean(onEdit) && !task.id.startsWith("display:");
  return (
    <li
      className="today-display-row"
      data-today-todo={task.id}
      data-open-item={task.id}
      data-today-display="host"
      data-today-verb={verb}
    >
      <div className="today-display-line">
        <span className="today-display-icon" data-today-icon={icon} aria-hidden="true">{icon}</span>
        <strong className="today-display-title">{task.title}</strong>
        {why ? (
          <>
            <span className="today-display-divider" aria-hidden="true">·</span>
            <span className="today-display-why">{why}</span>
          </>
        ) : null}
        {priority || statusLabel ? (
          <span className="today-display-meta">
            {priority ? (
              <span className="today-display-chip" data-priority-label={priority}>{priority}</span>
            ) : null}
            {status && statusLabel ? (
              <span
                className={"today-display-chip" + (statusAccent ? " is-accent" : "")}
                data-display-status={status.code}
              >
                {statusAccent ? <span aria-hidden="true">{status.code === "overdue" ? "! " : "⚠ "}</span> : null}
                {statusLabel}
              </span>
            ) : null}
          </span>
        ) : null}
        <div className="today-display-actions">
          <button
            type="button"
            className="today-display-go"
            data-today-todo-act
            data-today-act={verb}
            data-home-entry="acknowledge-task"
            aria-label={actionLabel}
            title={actionLabel}
            disabled={busy}
            onClick={() => onAct(task)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h12M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="today-display-act-label">{actionLabel}</span>
          </button>
          {editable ? (
            <button
              type="button"
              className="today-display-edit"
              data-today-todo-edit
              data-home-entry="edit-task"
              aria-label={`编辑 ${task.title}`}
              title="编辑"
              disabled={busy}
              onClick={() => onEdit?.(task)}
            >
              编辑
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
