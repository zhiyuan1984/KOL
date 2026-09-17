import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type KnowledgeRow } from "../api";
import { examAssignConfirm, examPublishConfirm } from "../adminConfirm";
import { useAdminConfirm } from "../components/ConfirmDialog";
import { rowTitle, type AdminRow } from "../adminGovernance";
import { statusLabel } from "../knowledgeCopy";

type Item = {
  id: string;
  prompt: string;
  kind?: string;
  accepted?: boolean;
  source?: string;
  knowledge_id?: string;
  answer?: string;
};

function asItems(rows: unknown): Item[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const rec = row as Record<string, unknown>;
    const id = String(rec.id || "");
    if (!id) return [];
    return [{
      id,
      prompt: String(rec.prompt || ""),
      kind: rec.kind == null ? undefined : String(rec.kind),
      accepted: Boolean(rec.accepted),
      source: rec.source == null ? undefined : String(rec.source),
      knowledge_id: rec.knowledge_id == null ? undefined : String(rec.knowledge_id),
      answer: rec.answer == null ? undefined : String(rec.answer),
    }];
  });
}

export default function AdminExams({
  exams,
  assignments,
  users,
  onReload,
}: {
  exams: AdminRow[];
  assignments: AdminRow[];
  users: AdminRow[];
  onReload: () => void;
}) {
  const { ask, dialog } = useAdminConfirm();
  const [examId, setExamId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [scores, setScores] = useState<AdminRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const exam = exams.find((row) => String(row.id) === examId);
  const publishedKnowledge = useMemo(
    () => knowledge.filter((row) => row.status === "published"),
    [knowledge],
  );

  const loadSide = useCallback(async (id: string) => {
    if (!id) {
      setItems([]);
      return;
    }
    const [nextItems, nextScores, nextKnowledge] = await Promise.all([
      api.adminExamItems(id),
      api.adminExamScores(),
      api.adminKnowledge().catch(() => []),
    ]);
    setItems(asItems(nextItems));
    setScores(nextScores);
    setKnowledge(nextKnowledge);
  }, []);

  useEffect(() => {
    if (!examId && exams.length) setExamId(String(exams[0].id || ""));
  }, [examId, exams]);

  useEffect(() => {
    void loadSide(examId).catch((e) => setError(e instanceof Error ? e.message : "无法读取试题"));
  }, [examId, loadSide]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError("");
    try {
      await fn();
      setNotice(message);
      onReload();
      await loadSide(examId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  };

  const toggleKnowledge = (id: string) => {
    setPicked((cur) => (cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]));
  };

  return (
    <section className="admin-govern admin-exams" data-admin-exams>
      {dialog}
      {notice && <p className="admin-receipt status-ok" data-admin-receipt role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <header className="admin-section-head">
        <div>
          <h2>考试治理</h2>
          <p className="muted">从已发布知识生成候选，采纳后才能发布快照。草稿不能分配。合格只按服务端判分。</p>
        </div>
      </header>

      <div className="admin-grid">
        <form
          className="panel settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void run(
              () => api.createExam({ title: String(d.get("title") || ""), description: String(d.get("description") || "") }),
              "草稿考试已创建",
            );
            e.currentTarget.reset();
          }}
        >
          <h2>创建草稿考试</h2>
          <label className="field">名称<input name="title" required /></label>
          <label className="field">说明<textarea name="description" rows={3} /></label>
          <button className="btn work" type="submit">创建草稿</button>
        </form>

        <section className="panel">
          <h2>题卷</h2>
          <label className="field">
            当前考试
            <select value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">选择考试</option>
              {exams.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>
                  {rowTitle(row)} · {String(row.status || "draft")}
                </option>
              ))}
            </select>
          </label>
          {exam && (
            <p className="muted">
              {String(exam.status || "draft")}
              {Number(exam.version || 0) > 0 ? ` · 第 ${Number(exam.version)} 版` : " · 未发布"}
              {` · 及格 ${Number(exam.pass_score || 80)}`}
            </p>
          )}
          {!exams.length && <p className="muted">暂无考试</p>}
        </section>
      </div>

      <article className="panel" data-admin-exam-generate>
        <div className="admin-section-head">
          <div>
            <h2>从已发布知识生成候选</h2>
            <p className="muted">只读 status=published 的知识。生成结果是候选，不会变成现行题卷。</p>
          </div>
        </div>
        <div className="chip-row">
          {publishedKnowledge.map((row) => (
            <label key={row.id} className="check">
              <input type="checkbox" checked={picked.includes(row.id)} onChange={() => toggleKnowledge(row.id)} />
              {row.title}
              <span className="muted"> · {statusLabel(row.status)}</span>
            </label>
          ))}
        </div>
        {!publishedKnowledge.length && <p className="muted">没有已发布知识，不能生成试题。</p>}
        <button
          className="btn work"
          type="button"
          disabled={!examId || !picked.length}
          onClick={() => run(() => api.generateExamItems(examId, picked), "已生成候选，尚未发布")}
        >
          生成候选
        </button>
      </article>

      <article className="panel" data-admin-exam-items>
        <h2>试题候选</h2>
        {items.map((item) => (
          <article className="admin-row" key={item.id} data-exam-item={item.id} data-accepted={item.accepted ? "true" : "false"}>
            <div>
              <strong>{item.prompt}</strong>
              <p className="muted">{item.source === "generated" ? "知识候选" : "手工"} · {item.accepted ? "已采纳" : "待采纳"}</p>
            </div>
            {!item.accepted && (
              <button className="btn" type="button" onClick={() => run(() => api.acceptExamItem(item.id), "试题已采纳")}>
                采纳
              </button>
            )}
          </article>
        ))}
        {!items.length && <p className="muted">还没有试题。先手工添加或从已发布知识生成。</p>}
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void run(
              () => api.addExamItem(examId, { prompt: String(d.get("prompt") || ""), kind: "true_false" }),
              "已加入候选（判断题默认答案为是）",
            );
            e.currentTarget.reset();
          }}
        >
          <label className="field">手工判断题<input name="prompt" required disabled={!examId} /></label>
          <button className="btn ghost" type="submit" disabled={!examId}>加入候选</button>
        </form>
        <button
          className="btn work"
          type="button"
          data-admin-exam-publish
          disabled={!examId}
          onClick={() => exam && ask(examPublishConfirm(rowTitle(exam), Number(exam.version || 0)), () =>
            run(() => api.publishExam(examId), "题卷已发布"))}
        >
          发布题卷
        </button>
      </article>

      <div className="admin-grid">
        <form
          className="panel settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            const selectedExam = exams.find((row) => String(row.id) === String(d.get("exam_id") || ""));
            const selectedUser = users.find((row) => String(row.id) === String(d.get("user_id") || ""));
            if (!selectedExam || !selectedUser) return;
            ask(examAssignConfirm(rowTitle(selectedExam), rowTitle(selectedUser)), () =>
              run(
                () => api.assignExam(String(selectedExam.id), { user_id: String(selectedUser.id), required: true }),
                "考试已分配",
              ));
          }}
        >
          <h2>分配已发布考试</h2>
          <label className="field">
            考试
            <select name="exam_id" required defaultValue="">
              <option value="">选择考试</option>
              {exams.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>
                  {rowTitle(row)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            员工
            <select name="user_id" required defaultValue="">
              <option value="">选择员工</option>
              {users.map((row) => (
                <option key={String(row.id)} value={String(row.id)}>{rowTitle(row)}</option>
              ))}
            </select>
          </label>
          <button className="btn work" type="submit" data-admin-exam-assign>分配</button>
        </form>

        <section className="panel">
          <h2>分配记录</h2>
          {assignments.map((row) => (
            <article className="admin-row" key={String(row.id)}>
              <div>
                <strong>{String(row.title || row.exam_id)}</strong>
                <p className="muted">
                  {String(row.user_name || row.user_id)} · {row.passed ? "已通过" : "待完成"}
                </p>
              </div>
            </article>
          ))}
          {!assignments.length && <p className="muted">暂无分配</p>}
        </section>
      </div>

      <article className="panel" data-admin-exam-scores>
        <h2>成绩</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>员工</th>
                <th>考试</th>
                <th>分数</th>
                <th>结果</th>
                <th>版本</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((row) => (
                <tr key={String(row.id)}>
                  <td>{String(row.user_name || row.user_id)}</td>
                  <td>{String(row.title || row.exam_id)}</td>
                  <td>{String(row.score ?? "-")} / {String(row.total ?? "-")}</td>
                  <td>{row.passed ? "通过" : "未通过"}</td>
                  <td>{Number(row.paper_version || 0) || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!scores.length && <p className="muted">暂无已判分成绩。</p>}
      </article>
    </section>
  );
}
