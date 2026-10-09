import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

type DetailTab = "paper" | "assign" | "scores";
type ScoreFilter = "all" | "passed" | "failed";
type ChipTone = "quiet" | "accent" | "success" | "warning" | "danger";

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

function str(row: AdminRow, key: string): string {
  const value = row[key];
  return value == null ? "" : String(value);
}

function num(row: AdminRow, key: string): number {
  return Number(row[key] || 0);
}

function isPublishedExam(row: AdminRow): boolean {
  return str(row, "status") === "published" && num(row, "version") > 0;
}

function fmtTime(value: string): string {
  if (!value) return "—";
  return value.length >= 16 ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : value;
}

function ExamChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span className="exam-chip" data-tone={tone}>
      {children}
    </span>
  );
}

function ExamStatusChip({ row }: { row: AdminRow }) {
  return isPublishedExam(row)
    ? <ExamChip tone="accent">已发布</ExamChip>
    : <ExamChip tone="quiet">草稿</ExamChip>;
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
  const [tab, setTab] = useState<DetailTab>("paper");
  const [items, setItems] = useState<Item[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [acceptSel, setAcceptSel] = useState<string[]>([]);
  const [scores, setScores] = useState<AdminRow[]>([]);
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [manualKind, setManualKind] = useState("true_false");
  const [manualOptions, setManualOptions] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const exam = exams.find((row) => String(row.id) === examId);
  const publishedKnowledge = useMemo(
    () => knowledge.filter((row) => row.status === "published"),
    [knowledge],
  );
  const knowledgeFiltered = useMemo(() => {
    const query = knowledgeQuery.trim();
    if (!query) return publishedKnowledge;
    return publishedKnowledge.filter((row) => row.title.includes(query));
  }, [publishedKnowledge, knowledgeQuery]);
  const useKnowledgeSearch = publishedKnowledge.length > 8;

  const pendingItems = useMemo(() => items.filter((item) => !item.accepted), [items]);
  const acceptedItems = useMemo(() => items.filter((item) => item.accepted), [items]);

  const examScores = useMemo(
    () => scores.filter((row) => str(row, "exam_id") === examId),
    [scores, examId],
  );
  const examAssignments = useMemo(
    () => assignments.filter((row) => str(row, "exam_id") === examId),
    [assignments, examId],
  );

  const kpi = useMemo(() => {
    const takers = new Set(scores.map((row) => str(row, "user_id")).filter(Boolean));
    const passed = scores.filter((row) => Boolean(row.passed)).length;
    return {
      total: exams.length,
      published: exams.filter(isPublishedExam).length,
      takers: takers.size,
      passRate: scores.length ? Math.round((passed / scores.length) * 100) : 0,
      attempts: scores.length,
    };
  }, [exams, scores]);

  const filteredScores = useMemo(() => {
    if (scoreFilter === "passed") return examScores.filter((row) => Boolean(row.passed));
    if (scoreFilter === "failed") return examScores.filter((row) => !Boolean(row.passed));
    return examScores;
  }, [examScores, scoreFilter]);
  const scorePassed = examScores.filter((row) => Boolean(row.passed)).length;
  const scoreFailed = examScores.length - scorePassed;

  const publishBlockReason = useMemo(() => {
    if (!exam) return "请先在左侧选择一张考试";
    if (!items.length) return "还没有试题：先从已发布知识生成候选，或手工出题";
    if (pendingItems.length) return `还有 ${pendingItems.length} 道候选未采纳，全部采纳后才能发布`;
    return "";
  }, [exam, items, pendingItems]);

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
    setAcceptSel([]);
    setPicked([]);
    setScoreFilter("all");
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

  const togglePicked = (id: string) => {
    setPicked((cur) => (cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]));
  };

  const toggleAcceptSel = (id: string) => {
    setAcceptSel((cur) => (cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]));
  };

  const acceptMany = async (ids: string[]) => {
    if (!ids.length) return;
    setError("");
    let done = 0;
    for (const id of ids) {
      try {
        await api.acceptExamItem(id);
        done += 1;
      } catch (e) {
        setError(`采纳中断：已采纳 ${done}/${ids.length}，${e instanceof Error ? e.message : "操作失败"}`);
        break;
      }
    }
    if (done) {
      setNotice(`已采纳 ${done} 道`);
      setAcceptSel([]);
      onReload();
      await loadSide(examId);
    }
  };

  const gotoScores = (filter: ScoreFilter) => {
    setScoreFilter(filter);
    setTab("scores");
  };

  const manualOptionList = useMemo(
    () => manualOptions.split("\n").map((line) => line.trim()).filter(Boolean),
    [manualOptions],
  );

  return (
    <section className="admin-govern admin-exams" data-admin-exams>
      {dialog}
      {notice && <p className="admin-receipt status-ok" data-admin-receipt role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <header className="admin-section-head exam-page-head">
        <div>
          <h2>考试治理</h2>
          <p className="muted">生产 → 审核 → 发布 → 分发 → 复盘。左侧选一张考试，右侧按阶段推进；合格只按服务端对已发布快照的判分。</p>
        </div>
        <button className="btn work" type="button" onClick={() => setCreateOpen(true)}>
          创建考试
        </button>
      </header>

      <div className="exam-kpi" data-exam-kpi>
        <button type="button" className="exam-kpi-card" onClick={() => gotoScores("all")}>
          <span className="exam-kpi-value">{kpi.total}</span>
          <span className="exam-kpi-label">考试总数</span>
        </button>
        <button type="button" className="exam-kpi-card" onClick={() => gotoScores("all")}>
          <span className="exam-kpi-value">{kpi.published}</span>
          <span className="exam-kpi-label">已发布</span>
        </button>
        <button type="button" className="exam-kpi-card" onClick={() => gotoScores("all")}>
          <span className="exam-kpi-value">{kpi.takers}</span>
          <span className="exam-kpi-label">参考人次</span>
        </button>
        <button type="button" className="exam-kpi-card" onClick={() => gotoScores("all")}>
          <span className="exam-kpi-value">{kpi.attempts ? `${kpi.passRate}%` : "—"}</span>
          <span className="exam-kpi-label">总体通过率</span>
        </button>
      </div>

      <div className="exam-manage">
        <aside className="panel exam-side" aria-label="考试列表">
          <div className="exam-side-head">
            <h2>考试</h2>
            <span className="muted">共 {exams.length}</span>
          </div>
          {exams.length === 0 && (
            <div className="exam-empty-compact">
              <p className="muted">还没有考试。</p>
              <button className="btn text" type="button" onClick={() => setCreateOpen(true)}>
                创建第一张考试
              </button>
            </div>
          )}
          <ul className="exam-side-list">
            {exams.map((row) => {
              const id = String(row.id);
              const selected = id === examId;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="exam-side-row"
                    data-selected={selected ? "true" : "false"}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => setExamId(id)}
                  >
                    <span className="exam-side-title">{rowTitle(row)}</span>
                    <span className="exam-side-meta">
                      <ExamStatusChip row={row} />
                      <span className="muted">
                        {num(row, "version") > 0 ? `第 ${num(row, "version")} 版` : "未发布"}
                        {` · 及格 ${num(row, "pass_score") || 80}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="panel exam-detail" aria-label="考试详情">
          {!exam && (
            <div className="exam-empty-compact">
              <p className="muted">在左侧选择一张考试，开始出题、发布与分配。</p>
            </div>
          )}
          {exam && (
            <>
              <div className="exam-detail-head">
                <div>
                  <h2>{rowTitle(exam)}</h2>
                  <p className="muted">
                    <ExamStatusChip row={exam} />
                    <span>
                      {num(exam, "version") > 0 ? `第 ${num(exam, "version")} 版` : "未发布"}
                      {` · 及格 ${num(exam, "pass_score") || 80} 分`}
                      {` · 已采纳 ${acceptedItems.length} 道`}
                      {pendingItems.length ? ` · 待采纳 ${pendingItems.length} 道` : ""}
                    </span>
                  </p>
                </div>
              </div>
              <nav className="exam-tabs" aria-label="考试阶段">
                {(
                  [
                    ["paper", `题卷${pendingItems.length ? ` · ${pendingItems.length} 待采纳` : ""}`],
                    ["assign", `分配 · ${examAssignments.length}`],
                    ["scores", `成绩 · ${examScores.length}`],
                  ] as Array<[DetailTab, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="exam-tab"
                    data-selected={tab === key ? "true" : "false"}
                    aria-selected={tab === key}
                    role="tab"
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              {tab === "paper" && (
                <div className="exam-tabpane" role="tabpanel">
                  <section className="exam-block" data-admin-exam-generate>
                    <h3>从已发布知识生成候选</h3>
                    <p className="muted">只读已发布知识。生成结果是候选，不会变成现行题卷。</p>
                    {useKnowledgeSearch && (
                      <label className="field exam-search">
                        <WorkspaceSearchInput
                          placeholder="搜索已发布知识…"
                          value={knowledgeQuery}
                          onChange={(e) => setKnowledgeQuery(e.target.value)}
                        />
                      </label>
                    )}
                    {!useKnowledgeSearch && (
                      <div className="chip-row">
                        {publishedKnowledge.map((row) => (
                          <label key={row.id} className="check">
                            <input
                              type="checkbox"
                              checked={picked.includes(row.id)}
                              onChange={() => togglePicked(row.id)}
                            />
                            {row.title}
                            <span className="muted"> · {statusLabel(row.status)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {useKnowledgeSearch && (
                      <div className="exam-knowledge-list">
                        {knowledgeFiltered.map((row) => (
                          <label key={row.id} className="check">
                            <input
                              type="checkbox"
                              checked={picked.includes(row.id)}
                              onChange={() => togglePicked(row.id)}
                            />
                            {row.title}
                          </label>
                        ))}
                        {!knowledgeFiltered.length && (
                          <p className="muted">没有匹配的已发布知识。</p>
                        )}
                      </div>
                    )}
                    {!publishedKnowledge.length && (
                      <p className="muted">没有已发布知识，不能生成试题。</p>
                    )}
                    <div className="exam-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={!picked.length}
                        onClick={() =>
                          run(
                            () => api.generateExamItems(examId, picked).then(() => setPicked([])),
                            "已生成候选，尚未发布",
                          )
                        }
                      >
                        生成候选{picked.length ? `（${picked.length}）` : ""}
                      </button>
                    </div>
                  </section>

                  <section className="exam-block" data-admin-exam-items>
                    <div className="exam-block-head">
                      <h3>待采纳候选</h3>
                      {pendingItems.length > 0 && (
                        <div className="exam-batch">
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={acceptSel.length === pendingItems.length}
                              onChange={() =>
                                setAcceptSel(
                                  acceptSel.length === pendingItems.length
                                    ? []
                                    : pendingItems.map((item) => item.id),
                                )
                              }
                            />
                            全选
                          </label>
                          <button
                            className="btn text"
                            type="button"
                            disabled={!acceptSel.length}
                            onClick={() => void acceptMany(acceptSel)}
                          >
                            采纳已选（{acceptSel.length}）
                          </button>
                          <button
                            className="btn text"
                            type="button"
                            onClick={() => void acceptMany(pendingItems.map((item) => item.id))}
                          >
                            全部采纳
                          </button>
                        </div>
                      )}
                    </div>
                    {!pendingItems.length && (
                      <p className="muted">没有待采纳候选。可以从已发布知识生成，或在下方手工出题。</p>
                    )}
                    {pendingItems.map((item) => (
                      <article
                        className="admin-row exam-item-row"
                        key={item.id}
                        data-exam-item={item.id}
                        data-accepted="false"
                      >
                        <label className="check exam-item-check">
                          <input
                            type="checkbox"
                            checked={acceptSel.includes(item.id)}
                            onChange={() => toggleAcceptSel(item.id)}
                            aria-label={`选中候选：${item.prompt.slice(0, 24)}`}
                          />
                        </label>
                        <div className="exam-item-main">
                          <p className="exam-item-prompt">{item.prompt}</p>
                          <p className="muted">
                            <ExamChip tone="warning">待采纳</ExamChip>
                            <span>{item.source === "generated" ? "知识候选" : "手工"}</span>
                          </p>
                        </div>
                        <button
                          className="btn text"
                          type="button"
                          onClick={() => void acceptMany([item.id])}
                        >
                          采纳
                        </button>
                      </article>
                    ))}
                  </section>

                  <section className="exam-block">
                    <h3>已采纳题卷{num(exam, "version") > 0 ? `（第 ${num(exam, "version")} 版快照）` : ""}</h3>
                    {!acceptedItems.length && <p className="muted">还没有已采纳试题。</p>}
                    {acceptedItems.map((item, index) => (
                      <article className="admin-row exam-item-row" key={item.id} data-accepted="true">
                        <span className="exam-item-index muted">{index + 1}</span>
                        <div className="exam-item-main">
                          <p className="exam-item-prompt">{item.prompt}</p>
                          <p className="muted">
                            <ExamChip tone="success">已采纳</ExamChip>
                            <span>{item.kind === "choice" ? "单选题" : "判断题"}</span>
                          </p>
                        </div>
                      </article>
                    ))}
                  </section>

                  <section className="exam-block">
                    <h3>手工出题</h3>
                    <form
                      className="settings-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        const kind = String(d.get("kind") || "true_false");
                        const prompt = String(d.get("prompt") || "").trim();
                        if (!prompt) return;
                        const body: Record<string, unknown> = { prompt, kind };
                        if (kind === "choice") {
                          body.options = manualOptionList.map((label) => ({ id: label, label }));
                          body.answer = String(d.get("choice_answer") || "").trim();
                        } else {
                          body.answer = String(d.get("tf_answer") || "yes");
                        }
                        const form = e.currentTarget;
                        void run(
                          () => api.addExamItem(examId, body).then(() => {
                            setManualOptions("");
                            form.reset();
                            setManualKind("true_false");
                          }),
                          "已加入候选",
                        );
                      }}
                    >
                      <label className="field">
                        题干
                        <textarea name="prompt" rows={2} required disabled={!examId} />
                      </label>
                      <label className="field">
                        题型
                        <select
                          name="kind"
                          value={manualKind}
                          onChange={(e) => setManualKind(e.target.value)}
                        >
                          <option value="true_false">判断题</option>
                          <option value="choice">单选题</option>
                        </select>
                      </label>
                      {manualKind === "true_false" && (
                        <label className="field">
                          答案
                          <select name="tf_answer" defaultValue="yes">
                            <option value="yes">是</option>
                            <option value="no">否</option>
                          </select>
                        </label>
                      )}
                      {manualKind === "choice" && (
                        <>
                          <label className="field">
                            选项（每行一个）
                            <textarea
                              rows={3}
                              value={manualOptions}
                              onChange={(e) => setManualOptions(e.target.value)}
                              placeholder={"选项 A\n选项 B\n选项 C"}
                            />
                          </label>
                          <label className="field">
                            答案
                            <select name="choice_answer" required disabled={!manualOptionList.length}>
                              <option value="">选择正确选项</option>
                              {manualOptionList.map((label) => (
                                <option key={label} value={label}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                      <div className="exam-actions">
                        <button className="btn text" type="submit" disabled={!examId}>
                          加入候选
                        </button>
                      </div>
                    </form>
                  </section>

                  <section className="exam-block exam-publish">
                    <h3>发布题卷</h3>
                    <p className="muted">
                      发布后冻结为第 {num(exam, "version") + 1} 版快照：员工作答与判分按此版本，草稿不能分配。
                    </p>
                    {publishBlockReason && (
                      <p className="exam-block-reason" role="note">
                        {publishBlockReason}
                      </p>
                    )}
                    <div className="exam-actions">
                      <button
                        className="btn work"
                        type="button"
                        data-admin-exam-publish
                        disabled={Boolean(publishBlockReason)}
                        onClick={() =>
                          ask(
                            examPublishConfirm(rowTitle(exam), num(exam, "version")),
                            () => run(() => api.publishExam(examId), "题卷已发布"),
                          )
                        }
                      >
                        发布题卷
                      </button>
                    </div>
                  </section>
                </div>
              )}

              {tab === "assign" && (
                <div className="exam-tabpane" role="tabpanel">
                  {!isPublishedExam(exam) ? (
                    <p className="muted">草稿不能分配。先在「题卷」页发布快照。</p>
                  ) : (
                    <form
                      className="settings-form exam-assign-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        const selectedUser = users.find(
                          (row) => String(row.id) === String(d.get("user_id") || ""),
                        );
                        if (!selectedUser) return;
                        const form = e.currentTarget;
                        ask(
                          examAssignConfirm(rowTitle(exam), rowTitle(selectedUser)),
                          () =>
                            run(
                              () =>
                                api.assignExam(examId, {
                                  user_id: String(selectedUser.id),
                                  required: true,
                                }).then(() => form.reset()),
                              "考试已分配",
                            ),
                        );
                      }}
                    >
                      <label className="field">
                        员工
                        <select name="user_id" required defaultValue="">
                          <option value="">选择员工</option>
                          {users.map((row) => (
                            <option key={String(row.id)} value={String(row.id)}>
                              {rowTitle(row)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="exam-actions">
                        <button className="btn work" type="submit" data-admin-exam-assign>
                          分配
                        </button>
                      </div>
                    </form>
                  )}
                  <h3>分配记录</h3>
                  {!examAssignments.length && <p className="muted">暂无分配。</p>}
                  {examAssignments.map((row) => (
                    <article className="admin-row exam-assign-row" key={String(row.id)}>
                      <div>
                        <p className="exam-item-prompt">{str(row, "user_name") || str(row, "user_id")}</p>
                        <p className="muted">
                          {row.passed ? (
                            <ExamChip tone="success">已通过</ExamChip>
                          ) : (
                            <ExamChip tone="quiet">待完成</ExamChip>
                          )}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {tab === "scores" && (
                <div className="exam-tabpane" role="tabpanel" data-admin-exam-scores>
                  <div className="exam-dist">
                    <div
                      className="exam-dist-bar"
                      role="group"
                      aria-label={`通过 ${scorePassed}，未通过 ${scoreFailed}`}
                    >
                      <button
                        type="button"
                        className="exam-dist-seg"
                        data-tone="success"
                        style={{ flexGrow: Math.max(scorePassed, 0.001) }}
                        onClick={() => setScoreFilter("passed")}
                        aria-pressed={scoreFilter === "passed"}
                      >
                        <span>通过 {scorePassed}</span>
                      </button>
                      <button
                        type="button"
                        className="exam-dist-seg"
                        data-tone="danger"
                        style={{ flexGrow: Math.max(scoreFailed, 0.001) }}
                        onClick={() => setScoreFilter("failed")}
                        aria-pressed={scoreFilter === "failed"}
                      >
                        <span>未通过 {scoreFailed}</span>
                      </button>
                    </div>
                    <div className="chip-row exam-score-filters">
                      {(
                        [
                          ["all", `全部 ${examScores.length}`],
                          ["passed", `通过 ${scorePassed}`],
                          ["failed", `未通过 ${scoreFailed}`],
                        ] as Array<[ScoreFilter, string]>
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          className="btn text"
                          data-selected={scoreFilter === key ? "true" : "false"}
                          aria-pressed={scoreFilter === key}
                          onClick={() => setScoreFilter(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>员工</th>
                          <th>分数</th>
                          <th>百分比</th>
                          <th>结果</th>
                          <th>版本</th>
                          <th>提交时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredScores.map((row) => {
                          const score = num(row, "score");
                          const total = num(row, "total");
                          const percent = total ? Math.round((score / total) * 100) : 0;
                          return (
                            <tr key={String(row.id)}>
                              <td>{str(row, "user_name") || str(row, "user_id")}</td>
                              <td>
                                {str(row, "score") || "—"} / {str(row, "total") || "—"}
                              </td>
                              <td>{total ? `${percent}%` : "—"}</td>
                              <td>
                                {row.passed ? (
                                  <ExamChip tone="success">通过</ExamChip>
                                ) : (
                                  <ExamChip tone="danger">未通过</ExamChip>
                                )}
                              </td>
                              <td>{num(row, "paper_version") || "—"}</td>
                              <td className="muted">{fmtTime(str(row, "submitted_at"))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!filteredScores.length && <p className="muted">暂无已判分成绩。</p>}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {createOpen && (
        <div className="admin-confirm-layer" data-exam-create-layer>
          <div className="admin-confirm-backdrop" onClick={() => setCreateOpen(false)} />
          <div className="admin-confirm" role="dialog" aria-modal="true" aria-label="创建考试">
            <h2>创建考试</h2>
            <p className="muted">新建为草稿：出题、采纳、发布后再分配。</p>
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                const passScore = Number(d.get("pass_score") || 80);
                if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100) {
                  setError("及格分须在 0–100 之间");
                  return;
                }
                setCreateOpen(false);
                void run(
                  () =>
                    api.createExam({
                      title: String(d.get("title") || ""),
                      description: String(d.get("description") || ""),
                      pass_score: passScore,
                    }),
                  "考试已创建（草稿）",
                );
              }}
            >
              <label className="field">
                名称
                <input name="title" required />
              </label>
              <label className="field">
                说明
                <textarea name="description" rows={3} />
              </label>
              <label className="field">
                及格分（0–100）
                <input name="pass_score" type="number" min={0} max={100} defaultValue={80} required />
              </label>
              <div className="admin-confirm-actions exam-actions">
                <button className="btn" type="button" onClick={() => setCreateOpen(false)}>
                  取消
                </button>
                <button className="btn work" type="submit">
                  创建草稿
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
