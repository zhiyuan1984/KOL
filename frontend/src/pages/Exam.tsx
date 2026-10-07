import { useEffect, useMemo, useState, type ReactNode } from "react";
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

type ExamOption = { id?: string; label?: string } | string;

type ExamQuestion = {
  id: string;
  prompt: string;
  kind?: string;
  options?: ExamOption[];
};

type ExamBreakdownRow = {
  id?: string;
  prompt?: string;
  kind?: string;
  options?: ExamOption[];
  answer?: string;
  chosen?: string;
  correct?: boolean;
};

type ExamResult = {
  status?: string;
  passed?: boolean;
  score?: number;
  total?: number;
  paper_version?: number;
  submitted_at?: string;
  breakdown?: ExamBreakdownRow[];
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

function optionId(option: ExamOption, index: number): string {
  if (typeof option === "string") return option;
  return String(option.id || option.label || index);
}

function optionLabel(option: ExamOption): string {
  if (typeof option === "string") return option;
  return String(option.label || option.id || "");
}

function answerText(kind: string | undefined, options: ExamOption[] | undefined, value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "未作答";
  const list = Array.isArray(options) ? options : [];
  for (const option of list) {
    if (typeof option === "string") {
      if (option === raw) return option;
    } else if (String(option.id || option.label || "") === raw) {
      return String(option.label || option.id || raw);
    }
  }
  if (kind !== "choice") {
    if (raw === "yes") return "是";
    if (raw === "no") return "否";
  }
  return raw;
}

function ExamChip({ tone, children }: { tone: "quiet" | "accent" | "success" | "danger"; children: ReactNode }) {
  return (
    <span className="exam-chip" data-tone={tone}>
      {children}
    </span>
  );
}

function ExamList() {
  const [assignments, setAssignments] = useState<ExamAssignment[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api.examAssignments()
      .then((rows) => {
        if (cancelled) return;
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
  const required = rows.filter((row) => Boolean(row.required));
  const passedCount = rows.filter(isPassed).length;
  const todoCount = required.filter((row) => !isPassed(row)).length;

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
        <div className="exam-empty-compact" data-exam-empty="unready">
          <p className="muted">还没有分配给你的考试。需要开通请联系管理员。</p>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <p className="exam-summary" data-exam-summary>
            必修 {required.length} 门 · 已通过 {passedCount} 门 · 待作答 {todoCount} 门
          </p>
          <ul className="exam-rows" data-exam-assignments>
            {rows.map((assignment) => {
              const passed = isPassed(assignment);
              const open = Boolean(assignment.open) && !passed;
              return (
                <li
                  className="exam-row"
                  key={assignment.id}
                  data-exam-assignment={assignment.id}
                  data-exam-passed={passed ? "true" : "false"}
                >
                  <div className="exam-row-main">
                    <span className="exam-row-title">{assignment.title || "必修考试"}</span>
                    <span className="exam-row-meta muted">
                      {[
                        assignment.due_at ? `截止 ${assignment.due_at.slice(0, 10)}` : "",
                        assignment.required ? "必修" : "选修",
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {passed ? (
                    <ExamChip tone="success">已通过</ExamChip>
                  ) : open ? (
                    <ExamChip tone="accent">待作答</ExamChip>
                  ) : (
                    <ExamChip tone="quiet">未开放</ExamChip>
                  )}
                  {open && (
                    <Link className="btn text" to={`/exam/${assignment.id}`} data-exam-take={assignment.id}>
                      开始作答
                    </Link>
                  )}
                  {passed && (
                    <Link className="btn text" to={`/exam/${assignment.id}`} data-exam-result={assignment.id}>
                      查看结果
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </>
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
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  const answered = useMemo(
    () => (questions || []).filter((question) => Boolean(answers[question.id])).length,
    [answers, questions],
  );
  const total = questions?.length || 0;
  const ready = total > 0 && answered === total;
  const progress = total ? Math.round((answered / total) * 100) : 0;

  const submit = async () => {
    if (!questions?.length || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api.submitExam(assignmentId, { answers });
      const next = await api.examResult(assignmentId);
      setResult(next as ExamResult);
      setConfirmOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  const graded = result?.status === "graded";
  const percent = graded && result.total ? Math.round(((result.score || 0) / result.total) * 100) : 0;

  return (
    <div className="list-page exam-page" data-exam-page data-exam-take={assignmentId}>
      <div className="exam-take-head">
        <div>
          <div className="page-kicker">考试</div>
          <h1 style={{ marginTop: 0 }}>{title}</h1>
          <p className="muted">只提交选项。分数和是否合格由服务端按已发布快照计算。</p>
        </div>
        {total > 0 && !graded && (
          <div className="exam-progress" role="status" aria-label={`已作答 ${answered} / ${total} 题`}>
            <div className="exam-progress-bar">
              <span style={{ width: `${progress}%` }} />
            </div>
            <span className="muted">已答 {answered} / {total}</span>
          </div>
        )}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {questions === null && !err && <p className="muted">正在打开题卷…</p>}
      {graded && (
        <section className="panel exam-result" data-exam-result>
          <h2>
            {result.passed ? "已通过" : "未通过"}
          </h2>
          <p className="muted">
            {Number(result.score || 0)} / {Number(result.total || 0)}
            {result.total ? ` · ${percent}%` : ""}
            {result.paper_version ? ` · 第 ${result.paper_version} 版` : ""}
            {result.submitted_at ? ` · ${String(result.submitted_at).slice(0, 16).replace("T", " ")} 提交` : ""}
          </p>
          <p className="muted" role="status">已提交，服务端已按已发布快照判分。</p>
          {Array.isArray(result.breakdown) && result.breakdown.length > 0 && (
            <>
              <h3>逐题复盘</h3>
              <ol className="exam-review">
                {result.breakdown.map((row, index) => {
                  const correct = Boolean(row.correct);
                  return (
                    <li key={String(row.id || index)} className="exam-review-row" data-correct={correct ? "true" : "false"}>
                      <p className="exam-review-prompt">
                        <span className="muted">第 {index + 1} 题 · </span>
                        {String(row.prompt || "")}
                      </p>
                      <p className="muted">
                        你的答案：{answerText(row.kind, row.options, String(row.chosen || ""))}
                        {" "}
                        {correct
                          ? <ExamChip tone="success">答对</ExamChip>
                          : <ExamChip tone="danger">答错</ExamChip>}
                      </p>
                      {!correct && (
                        <p className="muted">
                          正确答案：{answerText(row.kind, row.options, String(row.answer || ""))}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          <div className="exam-actions">
            <Link className="btn text" to="/exam">返回考试列表</Link>
          </div>
        </section>
      )}
      {questions && questions.length > 0 && !graded && (
        <form
          className="exam-take"
          data-exam-form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) setConfirmOpen(true);
          }}
        >
          {questions.map((question, index) => (
            <fieldset className="panel exam-question" key={question.id}>
              <legend>第 {index + 1} 题</legend>
              <p>{question.prompt}</p>
              <div className="exam-options">
                {(question.options || [{ id: "yes", label: "是" }, { id: "no", label: "否" }]).map((option, optionIndex) => {
                  const value = optionId(option, optionIndex);
                  const checked = answers[question.id] === value;
                  return (
                    <label key={value} className="exam-option" data-checked={checked ? "true" : "false"}>
                      <input
                        type="radio"
                        name={question.id}
                        value={value}
                        checked={checked}
                        onChange={() => setAnswers((cur) => ({ ...cur, [question.id]: value }))}
                      />
                      <span>{optionLabel(option)}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <div className="exam-submit-bar">
            <span className="muted">
              {ready ? `共 ${total} 题，已全部作答` : `已答 ${answered} / ${total} 题，还剩 ${total - answered} 题`}
            </span>
            <button className="btn work" type="submit" disabled={!ready || busy} data-exam-submit>
              {busy ? "正在判分…" : "提交答卷"}
            </button>
          </div>
        </form>
      )}
      {questions && questions.length === 0 && !graded && !err && (
        <div className="exam-empty-compact" data-exam-empty="unready">
          <p className="muted">这张题卷尚未开放作答。不会在本页假装通过。</p>
          <div className="exam-actions">
            <button className="btn text" type="button" onClick={() => navigate("/exam")}>返回列表</button>
          </div>
        </div>
      )}
      {confirmOpen && (
        <div className="admin-confirm-layer" data-exam-submit-layer>
          <div className="admin-confirm-backdrop" onClick={() => setConfirmOpen(false)} />
          <div className="admin-confirm" role="dialog" aria-modal="true" aria-label="确认提交答卷">
            <h2>提交答卷</h2>
            <p className="muted">
              共 {total} 题，已作答 {answered} 题。提交后由服务端按已发布快照判分，提交后不可修改。
            </p>
            <div className="admin-confirm-actions exam-actions">
              <button className="btn" type="button" onClick={() => setConfirmOpen(false)}>
                取消
              </button>
              <button className="btn work" type="button" disabled={busy} onClick={() => void submit()}>
                {busy ? "正在判分…" : "确认提交"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Exam() {
  const { assignmentId } = useParams();
  return assignmentId ? <ExamTake /> : <ExamList />;
}
