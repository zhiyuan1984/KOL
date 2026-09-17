import type { Task } from "../api";
import MemoryWorkRow from "./MemoryWorkRow";
import {
  isTodayActionableTodo,
  sortTodayTodos,
  todayBucket,
} from "./homeModel";

export default function TodayPane({
  todayTodos,
  busy,
  onAct,
}: {
  todayTodos: Task[];
  busy: boolean;
  onAct: (task: Task) => void;
}) {
  const official = sortTodayTodos(todayTodos.filter(isTodayActionableTodo));
  return (
    <section className="home-mode-pane" data-home-pane="today">
      <section
        className="today-todo-list"
        data-today-list
        data-today-formal
        data-list-total={official.length}
        aria-label="今日任务"
      >
        {official.length ? (
          <ol className="today-todo-ol">
            {official.map((task) => {
              const bucket = todayBucket(task);
              if (!bucket) return null;
              return (
                <MemoryWorkRow
                  key={task.id}
                  task={task}
                  bucket={bucket}
                  busy={busy}
                  onAct={onAct}
                  pane="today"
                />
              );
            })}
          </ol>
        ) : (
          <div className="task-empty" data-today-list-empty="no-data">
            <strong>今天没有待处理事项</strong>
            <p>高风险、已逾期、今天到期、进行中和审批中的事项会出现在这里。</p>
          </div>
        )}
      </section>
    </section>
  );
}
