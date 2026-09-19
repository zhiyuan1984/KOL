import { useMemo, useState } from "react";
import type { Task, TaskEvent, TodayBrief, TodoLayoutItem } from "../api";
import BoardRow from "./BoardRow";
import PlanBriefCard from "./PlanBriefCard";
import TodayPlanProgress from "./TodayPlanProgress";
import { HOME_TODO_EMPTY } from "./entryRegistry";
import { groupDisplayTasks } from "./displayTasks";
import { isTodayScheduled } from "./schedule";
import { applyTodoLayout, whyLine } from "./homeModel";
import type { TodoListFilter } from "./homeModel";
import type { TodayPlanPhase } from "./todayPlan";
import "./today-display-row.css";
import "./today-plan-board.css";

export default function TodoPane({
  tasks,
  dedupeNotice,
  busy,
  onAct,
  onEdit,
  brief,
  phase = "idle",
  events,
  todoLayout,
  planCollapsed,
  onPlanCollapsedChange,
}: {
  tasks: Task[];
  filter?: TodoListFilter;
  onFilter?: (next: TodoListFilter) => void;
  dedupeNotice: string;
  busy: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
  brief?: TodayBrief | null;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
  todoLayout?: TodoLayoutItem[] | null;
  planCollapsed?: boolean;
  onPlanCollapsedChange?: (collapsed: boolean) => void;
}) {
  // Rows are fixed frontend projections of base work items — todo layout (if any)
  // only stamps Codex's why and ordering on top.
  const rows = useMemo(
    () => applyTodoLayout(
      tasks
        .filter((task) => !isTodayScheduled(task))
        .map((task) => ({
          ...task,
          layout_why: String(task.layout_why || "").trim() || whyLine(task),
        })),
      todoLayout,
    ),
    [tasks, todoLayout],
  );
  const groups = useMemo(() => groupDisplayTasks(rows), [rows]);
  const indexOf = useMemo(() => new Map(rows.map((task, index) => [task.id, index])), [rows]);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const onCheck = (id: string, on: boolean) => {
    setCheckedIds((current) => (on ? [...new Set([...current, id])] : current.filter((row) => row !== id)));
  };
  const loading = phase === "loading-memory" && !rows.length;
  return (
    <section className="home-mode-pane today-work-inline" data-today-work data-home-pane="todo" data-todo-source="work_items">
      <TodayPlanProgress
        phase={phase}
        events={events}
        collapsed={planCollapsed}
        onCollapsedChange={onPlanCollapsedChange}
        scope="todo"
      />
      <PlanBriefCard brief={brief} phase={phase} events={events} busy={busy} onAct={onAct} rows={rows} />
      {dedupeNotice ? (
        <p className="home-dedupe-notice" data-todo-deduped role="status">{dedupeNotice}</p>
      ) : null}
      <section
        className="today-todo-list"
        data-todo-md
        data-todo-list
        data-list-total={rows.length}
        aria-label="待办任务"
      >
        {rows.length ? (
          <table className="today-board-table" data-todo-board-table>
            <thead>
              <tr>
                <th className="today-board-cell-check">
                  <input
                    type="checkbox"
                    className="today-board-check"
                    checked={rows.length > 0 && rows.every((task) => checkedIds.includes(task.id))}
                    aria-label="选择全部任务"
                    onChange={(event) => {
                      const on = event.target.checked;
                      setCheckedIds(on ? rows.map((task) => task.id) : []);
                    }}
                  />
                </th>
                <th className="today-board-cell-index">#</th>
                <th>优先级</th>
                <th>任务标题</th>
                <th>来源</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ group, rows: groupRows }) => (
                <GroupRows
                  key={group}
                  group={group}
                  groupRows={groupRows}
                  indexOf={indexOf}
                  checkedIds={checkedIds}
                  busy={busy}
                  onCheck={onCheck}
                  onAct={onAct}
                  onEdit={onEdit}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="task-empty" data-todo-empty={loading ? "loading" : "none"}>
            <strong>{loading ? "正在读取当前任务" : HOME_TODO_EMPTY}</strong>
            <p>{loading ? "正在读取任务记忆。" : "今日范围之外的未了结任务会出现在这里。"}</p>
          </div>
        )}
      </section>
    </section>
  );
}

function GroupRows({
  group,
  groupRows,
  indexOf,
  checkedIds,
  busy,
  onCheck,
  onAct,
  onEdit,
}: {
  group: string;
  groupRows: Task[];
  indexOf: Map<string, number>;
  checkedIds: string[];
  busy: boolean;
  onCheck: (id: string, on: boolean) => void;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
}) {
  return (
    <>
      <tr className="today-board-group-row" data-todo-group={group}>
        <td colSpan={6}>{group}</td>
      </tr>
      {groupRows.map((task) => (
        <BoardRow
          key={task.id}
          task={task}
          index={indexOf.get(task.id) ?? 0}
          checked={checkedIds.includes(task.id)}
          busy={busy}
          onCheck={onCheck}
          onAct={onAct}
          onEdit={onEdit}
        />
      ))}
    </>
  );
}
