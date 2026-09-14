import { useEffect, useState } from "react";
import { api } from "../api";

type ExamAssignment = {
  id: string;
  title?: string;
  description?: string;
  due_at?: string | null;
  passed?: boolean | number;
  required?: boolean | number;
};

function isPassed(row: ExamAssignment): boolean {
  return Boolean(row.passed);
}

export default function Exam() {
  const [assignments, setAssignments] = useState<ExamAssignment[] | null>(null);
  const [gateBlocked, setGateBlocked] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.me().catch(() => null),
      api.examAssignments().catch(() => [] as ExamAssignment[]),
    ])
      .then(([me, rows]) => {
        if (cancelled) return;
        setGateBlocked(me?.exam_passed === false);
        setAssignments(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setAssignments([]);
        setErr(e instanceof Error ? e.message : "无法读取考试");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = assignments || [];
  const pending = rows.filter((row) => !isPassed(row));

  return (
    <div className="list-page exam-page" data-exam-page data-visual="docs20">
      <div>
        <div className="page-kicker">考试</div>
        <h1 style={{ marginTop: 0 }}>学习考试</h1>
        <p className="muted">
          应试与发信闸门。题卷由管理员分配并开放后才能作答。本页不会一键记为通过，也不提供演示身份切换。
        </p>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {assignments === null && !err && <p className="muted">正在读取考试…</p>}
      {assignments && rows.length === 0 && (
        <div className="exam-empty" data-exam-empty="unready">
          <h2>考试未就绪</h2>
          <p className="muted">
            还没有开放作答的题卷。需要开通请联系管理员。不会在本页假装通过。
          </p>
          {gateBlocked && (
            <p className="muted" data-exam-gate="blocked">
              发信仍会被考试闸门拦住。题卷开放前无法在这里完成。
            </p>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <div className="exam-list" data-exam-assignments>
          {pending.length > 0 && (
            <p className="muted" data-exam-unready-note>
              已分配的题卷尚未开放作答，不能在本页提交成绩。
            </p>
          )}
          {rows.map((assignment) => {
            const passed = isPassed(assignment);
            return (
              <article
                className="panel exam-card"
                key={assignment.id}
                data-exam-assignment={assignment.id}
                data-exam-passed={passed ? "true" : "false"}
              >
                <h3>{assignment.title || "必修考试"}</h3>
                {assignment.description ? <p className="muted">{assignment.description}</p> : null}
                <p data-exam-status={passed ? "passed" : "unready"}>
                  {passed
                    ? "已通过"
                    : `考试未就绪${assignment.due_at ? ` · 截止 ${assignment.due_at}` : ""}`}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
