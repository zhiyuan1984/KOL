import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";

type ExamAssignment = {
  id: string;
  title?: string;
  description?: string;
  due_at?: string | null;
  passed?: boolean | number;
  required?: boolean | number;
  open?: boolean;
  status?: string;
  exam_status?: string;
};

type ExamQuestion = {
  id: string;
  prompt: string;
  kind?: string;
  options?: Array<{ id?: string; label?: string } | string>;
};

type ExamResult = {
  status?: string;
  passed?: boolean;
  score?: number;
  total?: number;
  paper_version?: number;
  submitted_at?: string;
  breakdown?: Array<{ id?: string; prompt?: string; chosen?: string; correct?: boolean }>;
};

function isPassed(row: ExamAssignment): boolean {
  return Boolean(row.passed);
}

function asAssignments(rows: unknown): ExamAssignment[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const rec = row as Record<string, unknown>;
    const id = String(rec.id || "");
    if (!id) return [];
    return [{
      id,
      title: rec.title == null ? undefined : String(rec.title),
      description: rec.description == null ? undefined : String(rec.description),
      due_at: rec.due_at == null ? null : String(rec.due_at),
      passed: rec.passed as ExamAssignment["passed"],
      required: rec.required as ExamAssignment["required"],
      open: rec.open as boolean | undefined,
      status: rec.status == null ? undefined : String(rec.status),
      exam_status: rec.exam_status == null ? undefined : String(rec.exam_status),
    }];
  });
}

function optionId(option: { id?: string; label?: string } | string, index: number): string {
  if (typeof option === "string") return option;
  return String(option.id || option.label || index);
}

function optionLabel(option: { id?: string; label?: string } | string): string {
  if (typeof option === "string") return option;
  return String(option.label || option.id || "");
}

function ExamList() {
  const [assignments, setAssignments] = useState<ExamAssignment[] | null>(null);
  const [gateBlocked, setGateBlocked] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.me().catch(() => null),
      api.examAssignments().catch(() => []),
    ])
      .then(([me, rows]) => {
        if (cancelled) return;
        setGateBlocked(me?.exam_passed === false);
        setAssignments(asAssignments(rows));
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
    <div className="list-page exam-page" data-exam-page>
      <div>
        <div className="page-kicker">考试</div>
        <h1 style={{ marginTop: 0 }}>学习考试</h1>
        <p className="muted">
          合格由服务端按已发布题卷计算。没有开放题卷时，本页不能提交成绩。
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
              开通前不能完成考试。题卷开放前无法在这里完成。
            </p>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <div className="exam-list" data-exam-assignments>
          {pending.length > 0 && pending.every((row) => !row.open) && (
            <p className="muted" data-exam-unready-note>
              已分配的题卷尚未开放作答，不能在本页提交成绩。
            </p>
          )}
          {rows.map((assignment) => {
            const passed = isPassed(assignment);
            const open = Boolean(assignment.open) && !passed;
            return (
              <article
                className="panel exam-card"
                key={assignment.id}
                data-exam-assignment={assignment.id}
                data-exam-passed={passed ? "true" : "false"}
              >
                <h3>{assignment.title || "必修考试"}</h3>
                {assignment.description ? <p className="muted">{assignment.description}</p> : null}
                <p data-exam-status={passed ? "passed" : open ? "open" : "unready"}>
                  {passed
                    ? "已通过"
                    : open
                      ? `待作答${assignment.due_at ? ` · 截止 ${assignment.due_at}` : ""}`
                      : `考试未就绪${assignment.due_at ? ` · 截止 ${assignment.due_at}` : ""}`}
                </p>
                {open && (
                  <Link className="btn work" to={`/exam/${assignment.id}`} data-exam-take={assignment.id}>
                    开始作答
                  </Link>
                )}
                {passed && (
                  <Link className="btn ghost" to={`/exam/${assignment.id}`} data-exam-result={assignment.id}>
                    查看结果
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExamTake() {
  const { assignmentId = "" } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState("学习考试");
  const [questions, setQuestions] = useState<ExamQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.examAssignments().catch(() => []),
      api.examResult(assignmentId).catch(() => ({ status: "pending" })),
    ]).then(async ([rows, existing]) => {
      if (cancelled) return;
      const assignment = asAssignments(rows).find((row) => row.id === assignmentId);
      setTitle(assignment?.title || "学习考试");
      if (existing && existing.status === "graded") {
        setResult(existing as ExamResult);
        setQuestions([]);
        return;
      }
      if (!assignment?.open && !assignment?.passed) {
        setQuestions([]);
        setErr("");
        return;
      }
      const started = await api.startExam(assignmentId);
      if (cancelled) return;
      const list = Array.isArray(started.questions) ? started.questions as ExamQuestion[] : [];
      setQuestions(list);
    }).catch((e) => {
      if (cancelled) return;
      setQuestions([]);
      setErr(e instanceof Error ? e.message : "无法打开题卷");
    });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  const ready = useMemo(
    () => (questions || []).every((question) => Boolean(answers[question.id])),
    [answers, questions],
  );

  const submit = async () => {
    if (!questions?.length || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api.submitExam(assignmentId, { answers });
      const next = await api.examResult(assignmentId);
      setResult(next as ExamResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list-page exam-page" data-exam-page data-exam-take={assignmentId}>
      <div>
        <div className="page-kicker">考试</div>
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        <p className="muted">只提交选项。分数和是否合格由服务端按已发布快照计算。</p>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {questions === null && !err && <p className="muted">正在打开题卷…</p>}
      {result?.status === "graded" && (
        <section className="panel exam-result" data-exam-result>
          <h2>{result.passed ? "已通过" : "未通过"}</h2>
          <p className="muted">
            {Number(result.score || 0)} / {Number(result.total || 0)}
            {result.paper_version ? ` · 第 ${result.paper_version} 版` : ""}
          </p>
          <Link className="btn ghost" to="/exam">返回考试列表</Link>
        </section>
      )}
      {questions && questions.length > 0 && result?.status !== "graded" && (
        <form
          className="exam-take"
          data-exam-form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {questions.map((question, index) => (
            <fieldset className="panel exam-question" key={question.id}>
              <legend>第 {index + 1} 题</legend>
              <p>{question.prompt}</p>
              <div className="chip-row">
                {(question.options || [{ id: "yes", label: "是" }, { id: "no", label: "否" }]).map((option, optionIndex) => {
                  const value = optionId(option, optionIndex);
                  return (
                    <label key={value} className="check">
                      <input
                        type="radio"
                        name={question.id}
                        value={value}
                        checked={answers[question.id] === value}
                        onChange={() => setAnswers((cur) => ({ ...cur, [question.id]: value }))}
                      />
                      {optionLabel(option)}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <button className="btn work" type="submit" disabled={!ready || busy} data-exam-submit>
            {busy ? "正在判分…" : "提交答卷"}
          </button>
        </form>
      )}
      {questions && questions.length === 0 && result?.status !== "graded" && !err && (
        <div className="exam-empty" data-exam-empty="unready">
          <h2>考试未就绪</h2>
          <p className="muted">这张题卷尚未开放作答。不会在本页假装通过。</p>
          <button className="btn ghost" type="button" onClick={() => navigate("/exam")}>返回列表</button>
        </div>
      )}
    </div>
  );
}

export default function Exam() {
  const { assignmentId } = useParams();
  return assignmentId ? <ExamTake /> : <ExamList />;
}
