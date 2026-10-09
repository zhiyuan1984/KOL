import { Fragment, useState } from "react";
import type { Task } from "../api";
import { lastSafeSummary } from "../waitStatus";
import {
  dueDayDiff,
  isClosedTask,
  isDisplayOnlyTask,
  taskActionLabel,
  taskDisplayStatus,
} from "./homeModel";

function BoardTaskIcon({ task }: { task: Task }) {
  const type = String(task.task_type || task.skill || "");
  // 风险信号只认 risk_level（与 R chip 同源）与任务语义（risk_scan 本身就是风险扫描）：
  // 优先级高低归筛选 pills 与排序管，图标不再用 priority rank 另起一套风险体系，
  // 避免"有图标无 chip / 有 chip 无图标"。
  const risk = type === "risk_scan" || riskChip(task) === "R3";
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

type BoardStatus = { label: "待处理" | "进行中" | "已完成" | "等审批" | "失败" | "已取消"; tone: "pending" | "running" | "completed" | "approval" | "failed" | "cancelled" };

export function boardStatus(task: Task): BoardStatus {
  const direct = String(task.status || "").trim().toLowerCase();
  const status = direct || String(taskDisplayStatus(task)?.code || "").toLowerCase();
  if (status === "failed") return { label: "失败", tone: "failed" };
  if (status === "cancelled") return { label: "已取消", tone: "cancelled" };
  if (["completed", "done"].includes(status)) return { label: "已完成", tone: "completed" };
  // 等审批是独立状态：不要把它吞进"进行中"，用户分不清"在跑"和"在等我批"。
  if (status === "waiting_approval") return { label: "等审批", tone: "approval" };
  if (["running", "in_progress", "queued", "waiting"].includes(status)) return { label: "进行中", tone: "running" };
  return { label: "待处理", tone: "pending" };
}

export function riskChip(task: Task): "R1" | "R2" | "R3" | "" {
  const risk = String(task.risk_level || "").trim().toLowerCase();
  if (risk === "high") return "R3";
  if (risk === "medium") return "R2";
  if (risk === "low") return "R1";
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
  const [expanded, setExpanded] = useState(false);
  const detailsId = `task-board-details-${task.id}`;
  const why = String(task.layout_why || task.display_why || "").trim();
  const verb = String(task.display_verb || task.next_action_code || "open");
  const actionLabel = taskActionLabel(task);
  const opensTask = Boolean(onOpen) && ["open", "open_task", "view", "view_task"].includes(verb);
  const risk = riskChip(task);
  const status = boardStatus(task);
  const executionFailed = task.execution?.status === "failed";
  const executionNote = executionFailed ? lastSafeSummary(task) : "";
  const taskFailed = status.tone === "failed";
  const dueDiff = dueDayDiff(task.due_at);
  const dueTime = task.due_at ? new Date(task.due_at) : null;
  const dueLabel = dueTime && !Number.isNaN(dueTime.getTime())
    ? dueTime.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
    : "";
  // Execution attempts and due dates do not overwrite the formal task status.
  const statusLabel = task.status === "queued" ? "已入队" : task.status === "waiting" ? "待确认" : status.label;
  const deadline = !isClosedTask(task) && dueDiff != null && dueDiff < 0 ? "逾期"
    : !isClosedTask(task) && dueDiff === 0 ? "今天到期" : "到期";
  const editable = Boolean(onEdit) && verb !== "edit" && !isDisplayOnlyTask(task);
  return (
    <Fragment>
    <tr
      className="task-board-row"
      data-today-todo={task.id}
      data-open-item={task.id}
      data-today-display="host"
      data-today-verb={verb}
      data-board-status={status.tone}
      data-row-number={index + 1}
    >
      <td className="task-board-cell-title">
        <div className="task-board-title-wrap">
          <div className="task-board-title-row">
            <button type="button" className="task-board-details-toggle" aria-expanded={expanded}
              aria-controls={detailsId} aria-label={`${expanded ? "收起" : "展开"}任务详情：${task.title}`}
              onClick={() => setExpanded(value => !value)}>
              <span className="task-board-icon"><BoardTaskIcon task={task} /></span>
            </button>
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
        </div>
      </td>
      <td className="task-board-cell-status">
        <div className="task-board-row-signals">
          {risk ? <span className={`task-board-chip is-${risk.toLowerCase()}`} data-risk-level={task.risk_level} title={`任务风险：${risk}`}>{risk}</span> : null}
          <span className="task-board-row-state" data-state={taskFailed ? "failed" : "default"} aria-label={`任务状态：${statusLabel}`}>
            <i className={`task-status-dot is-${status.tone}`} aria-hidden />{statusLabel}
          </span>
          {executionFailed ? <button type="button" className="task-board-execution-failed" onClick={() => setExpanded(true)}
            aria-expanded={expanded} aria-controls={detailsId}>上次执行失败</button> : null}
        </div>
      </td>
      <td className="task-board-cell-due">
        {dueLabel ? <time className="task-board-row-state" dateTime={task.due_at}
          data-state={deadline === "逾期" ? "overdue" : "default"}>{deadline} {dueLabel}</time> : <span className="task-board-row-state" aria-label="未设置截止日期">—</span>}
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
    <tr id={detailsId} className="task-board-details-row" hidden={!expanded}>
      <td colSpan={4}>
        <div className="task-board-expanded-details">
          <strong>{task.title}</strong>
          {why ? <p>{why}</p> : null}
          {task.description && task.description !== why ? <p>{task.description}</p> : null}
          {executionFailed ? <p className="task-board-failure-detail">上次执行失败：{executionNote || "原因待核对"}。任务状态：{statusLabel}。</p> : null}
        </div>
      </td>
    </tr>
    </Fragment>
  );
}
