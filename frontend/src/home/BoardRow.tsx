import type { Task } from "../api";
import {
  isDisplayOnlyTask,
  taskActionLabel,
  taskDisplayStatus,
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

type BoardStatus = { label: "待处理" | "进行中" | "已完成"; tone: "pending" | "running" | "completed" };

export function boardStatus(task: Task): BoardStatus {
  const direct = String(task.status || "").trim().toLowerCase();
  const status = direct || String(taskDisplayStatus(task)?.code || "").toLowerCase();
  if (["completed", "done"].includes(status)) return { label: "已完成", tone: "completed" };
  if (["running", "in_progress", "queued", "waiting", "waiting_approval"].includes(status)) return { label: "进行中", tone: "running" };
  return { label: "待处理", tone: "pending" };
}

export function riskChip(task: Task): "R1" | "R2" | "R3" | "" {
  const risk = String(task.risk_level || "").trim().toLowerCase();
  if (risk === "high") return "R1";
  if (risk === "medium") return "R2";
  if (risk === "low") return "R3";
  return "";
}

/**
 * 统一任务行：今日任务表格和待办分组列表都渲染这一份。
 * 序号/标题/状态/操作 —— 每件事只说一次。
 */
export default function BoardRow({
  task,
  index,
  busy,
  onAct,
  onOpen,
  onEdit,
}: {
  task: Task;
  index: number;
  busy: boolean;
  onAct: (task: Task) => void;
  /** 标题只打开右栏任务明细；执行仍由显式操作触发。 */
  onOpen?: (task: Task) => void;
  onEdit?: (task: Task) => void;
}) {
  const why = String(task.layout_why || task.display_why || "").trim();
  const verb = String(task.display_verb || task.next_action_code || "open");
  const actionLabel = taskActionLabel(task);
  const opensTask = Boolean(onOpen) && ["open", "open_task", "view", "view_task"].includes(verb);
  const risk = riskChip(task);
  const status = boardStatus(task);
  const editable = Boolean(onEdit) && verb !== "edit" && !isDisplayOnlyTask(task);
  return (
    <tr
      className="task-board-row"
      data-today-todo={task.id}
      data-open-item={task.id}
      data-today-display="host"
      data-today-verb={verb}
      data-board-status={status.tone}
    >
      <td className="task-board-cell-index">{index + 1}</td>
      <td className="task-board-cell-title">
        <div className="task-board-title-wrap">
          <div className="task-board-title-row">
            <span className="task-board-icon"><BoardTaskIcon task={task} /></span>
            <button
              type="button"
              className="task-board-title"
              disabled={busy}
              onClick={() => (onOpen || onAct)(task)}
              title={task.title}
            >
              {task.title}
            </button>
          </div>
          {(why || risk) ? (
            <div className="task-board-meta">
              {why ? <p className="task-board-why" title={why}>{why}</p> : null}
              {risk ? <span className={`task-board-chip is-${risk.toLowerCase()}`} data-risk-level={task.risk_level}>{risk}</span> : null}
            </div>
          ) : null}
        </div>
      </td>
      <td className="task-board-cell-status">
        <span className={`task-board-status is-${status.tone}`}><i aria-hidden />{status.label}</span>
      </td>
      <td className="task-board-cell-actions">
        <div className="task-board-actions">
          <button
            type="button"
            className="task-board-open"
            data-today-todo-act
            data-today-act={verb}
            data-home-entry={opensTask ? "open-task" : "acknowledge-task"}
            disabled={busy}
            onClick={() => (opensTask ? onOpen?.(task) : onAct(task))}
          >
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
