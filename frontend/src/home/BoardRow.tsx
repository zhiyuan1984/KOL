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

function BoardTaskIcon({ task }: { task: Task }) {
  const type = String(task.task_type || task.skill || "");
  const risk = type === "risk_scan" || taskPriorityRank(task) <= 1;
  const search = /discovery|analyze|library_query/.test(type);
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      {risk ? (
        <><path d="M12 3 3.5 19h17L12 3Z" /><path d="M12 9v4.5M12 17h.01" /></>
      ) : search ? (
        <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></>
      ) : (
        <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></>
      )}
    </svg>
  );
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
  const verb = String(task.display_verb || task.next_action_code || "open");
  const actionLabel = taskActionLabel(task);
  const risk = String(task.risk_level || "").trim();
  const riskLabel = risk !== "none" ? riskLevelLabel(task) : "";
  const editable = Boolean(onEdit) && !isDisplayOnlyTask(task);
  return (
    <tr
      className="task-board-row"
      data-today-todo={task.id}
      data-open-item={task.id}
      data-today-display="host"
      data-today-verb={verb}
    >
      <td className="task-board-cell-index">{index + 1}</td>
      <td>
        <span className={`board-priority is-${priority.tone}`}>{priority.label}</span>
      </td>
      <td className="task-board-cell-title">
        <div className="task-board-title-wrap">
          <div className="task-board-title-row">
            <span className="task-board-icon"><BoardTaskIcon task={task} /></span>
            <button
              type="button"
              className="task-board-title"
              disabled={busy}
              onClick={() => onAct(task)}
              title={task.title}
            >
              {task.title}
            </button>
          </div>
          {(why || statusLabel || riskLabel) ? (
            <div className="task-board-meta">
              {why ? <p className="task-board-why">{why}</p> : null}
              <span className="task-board-chips">
                {statusLabel ? (
                  <span className={"task-board-chip" + (statusAccent ? " is-accent" : "")} data-board-status={status?.code}>
                    {statusLabel}
                  </span>
                ) : null}
                {riskLabel ? (
                  <span className="task-board-chip" data-risk-level={task.risk_level}>风险{riskLabel}</span>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
      </td>
      <td className="task-board-cell-actions">
        <div className="task-board-actions">
          <button
            type="button"
            className="task-board-open"
            data-today-todo-act
            data-today-act={verb}
            data-home-entry="acknowledge-task"
            disabled={busy}
            onClick={() => onAct(task)}
          >
            <svg className="task-board-action-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M7 5h8v8M15 5l-9 9" />
            </svg>
            {actionLabel}
          </button>
          {editable ? (
            <button
              type="button"
              className="task-board-edit"
              data-today-todo-edit
              data-home-entry="edit-task"
              disabled={busy}
              onClick={() => onEdit?.(task)}
            >
              编辑
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
