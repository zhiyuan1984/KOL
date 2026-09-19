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

const RISK_LABEL: Record<string, string> = {
  high: "高",
  medium: "中",
  mid: "中",
  low: "低",
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
  const risk = String(task.risk_level || "").trim();
  const riskLabel = RISK_LABEL[risk];
  const actionLabel = label || (verb === "approve" ? "去审批" : verb === "edit" ? "编辑" : verb === "open-mail" ? "查看邮件任务" : "打开");
  const editable = Boolean(onEdit) && !task.id.startsWith("display:");
  return (
    <li
      className="today-display-row"
      data-today-todo={task.id}
      data-open-item={task.id}
      data-today-display="host"
      data-today-verb={verb}
    >
      <span className="today-display-icon" data-today-icon={icon} aria-hidden="true">{icon}</span>
      <div className="today-display-copy">
        <strong className="today-display-title">{task.title}</strong>
        {why ? <p className="today-display-why">{why}</p> : null}
        {priority || statusLabel || riskLabel ? (
          <span className="today-display-meta">
            {status && statusLabel ? (
              <span
                className={"today-display-chip" + (statusAccent ? " is-accent" : "")}
                data-display-status={status.code}
              >
                {statusAccent ? <span aria-hidden="true">{status.code === "overdue" ? "! " : "⚠ "}</span> : null}
                {statusLabel}
              </span>
            ) : null}
            {priority ? (
              <span className="today-display-chip" data-priority-label={priority}>{priority}</span>
            ) : null}
            {riskLabel && risk !== "none" ? (
              <span className="today-display-chip" data-risk-level={risk}>风险{riskLabel}</span>
            ) : null}
          </span>
        ) : null}
      </div>
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
    </li>
  );
}
