/**
 * Exam papers, snapshots, server-side grading, and qualifications.
 * PROD-PLAT-04: generate reads published knowledge only; outputs are candidates.
 * PROD-PLAT-05: exams default to draft; only POST publish writes a snapshot.
 * PROD-PLAT-07: submit ignores client passed/score/pass_score.
 */
import { Hono } from "hono";
import { authDisabled, requireAdmin, scopedUser } from "./auth.js";
import { audit, getConn, nowIso, tx } from "./db.js";
import { HttpFail } from "./host/errors.js";
import { currentUser } from "./host/persona.js";
import { nid } from "./ids.js";
import type { Json, Row } from "./types.js";

export const examRouter = new Hono();

const TRUE_FALSE_OPTIONS = [
  { id: "yes", label: "是" },
  { id: "no", label: "否" },
];

function parseJson(value: unknown, fallback: unknown): unknown {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function asRow(row: Row | undefined, message: string): Row {
  if (!row) throw new HttpFail(404, message);
  return { ...row };
}

function userById(id: string): Row {
  return asRow(getConn().prepare("SELECT * FROM users WHERE id=?").get(id) as Row | undefined, "user not found");
}

function examRow(id: string): Row {
  return asRow(getConn().prepare("SELECT * FROM exams WHERE id=?").get(id) as Row | undefined, "exam not found");
}

function itemRow(id: string): Row {
  return asRow(getConn().prepare("SELECT * FROM exam_items WHERE id=?").get(id) as Row | undefined, "exam item not found");
}

function examActor(): { id: string } {
  if (authDisabled()) return currentUser();
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  return user;
}

function isPublishedPaper(exam: Row): boolean {
  return String(exam.status || "") === "published" && Number(exam.version || 0) > 0;
}

const MISSING_REQUIRED_SQL = `
  SELECT COUNT(*) AS missing
    FROM exam_assignments a
    JOIN exams e ON e.id = a.exam_id
   WHERE a.user_id = ? AND a.required = 1
     AND e.status = 'published' AND e.version > 0
     AND NOT EXISTS (
       SELECT 1 FROM exam_attempts t
        WHERE t.assignment_id = a.id AND t.user_id = a.user_id
          AND t.passed = 1 AND t.status = 'graded'
     )
`;

export function examTodoCount(userId: string): number {
  const row = getConn().prepare(MISSING_REQUIRED_SQL).get(userId) as { missing: number };
  return Number(row?.missing || 0);
}

export function examPassed(userId: string): boolean {
  return examTodoCount(userId) === 0;
}

function publicExam(row: Row): Json {
  return {
    ...row,
    active: Boolean(row.active),
    pass_score: Number(row.pass_score || 80),
    version: Number(row.version || 0),
    effects: parseJson(row.effects, {}),
    published: isPublishedPaper(row),
  };
}

function publicItem(row: Row, includeAnswer = false): Json {
  const out: Json = {
    id: row.id,
    exam_id: row.exam_id,
    knowledge_id: row.knowledge_id || "",
    prompt: row.prompt,
    kind: row.kind || "true_false",
    options: parseJson(row.options_json, TRUE_FALSE_OPTIONS),
    accepted: Boolean(row.accepted),
    source: row.source || "manual",
    created_at: row.created_at,
  };
  if (includeAnswer) out.answer = row.answer;
  return out;
}

function snapshotItems(examId: string): Json[] {
  const rows = getConn().prepare(
    "SELECT * FROM exam_items WHERE exam_id=? AND accepted=1 ORDER BY created_at, id",
  ).all(examId) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    knowledge_id: row.knowledge_id || "",
    prompt: String(row.prompt),
    kind: String(row.kind || "true_false"),
    options: parseJson(row.options_json, TRUE_FALSE_OPTIONS),
    answer: String(row.answer),
  }));
}

function loadSnapshot(examId: string, version: number): { pass_score: number; items: Json[] } {
  const row = getConn().prepare(
    "SELECT * FROM exam_snapshots WHERE exam_id=? AND version=?",
  ).get(examId, version) as Row | undefined;
  if (!row) throw new HttpFail(409, "published snapshot not found");
  const items = parseJson(row.items_json, []) as Json[];
  if (!Array.isArray(items) || !items.length) throw new HttpFail(409, "published snapshot not found");
  return { pass_score: Number(row.pass_score || 80), items };
}

function normalizeChoice(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1", "y", "是", "对"].includes(raw)) return "yes";
  if (["no", "false", "0", "n", "否", "错"].includes(raw)) return "no";
  return String(value ?? "").trim();
}

function answerMap(body: Json): Record<string, string> {
  const raw = body.answers ?? body.options ?? {};
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Json;
      const id = String(rec.id || rec.item_id || rec.question_id || "");
      if (!id) continue;
      out[id] = normalizeChoice(rec.answer ?? rec.value ?? rec.option ?? rec.choice);
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, normalizeChoice(value)]),
    );
  }
  return {};
}

function sentencesFromKnowledge(title: string, body: string): string[] {
  const text = [title, body].filter(Boolean).join("。");
  const parts = text
    .split(/(?<=[。．.!?？\n;；])\s*/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 4);
  const unique = [...new Set(parts)];
  return unique.slice(0, 8);
}

function gradeSnapshot(items: Json[], answers: Record<string, string>, passScore: number) {
  const breakdown = items.map((item) => {
    const id = String(item.id);
    const expected = normalizeChoice(item.answer);
    const chosen = answers[id] || "";
    const correct = Boolean(chosen) && chosen === expected;
    return {
      id,
      prompt: String(item.prompt || ""),
      kind: String(item.kind || "true_false"),
      chosen,
      correct,
    };
  });
  const score = breakdown.filter((row) => row.correct).length;
  const total = breakdown.length;
  const percent = total ? Math.round((score / total) * 100) : 0;
  const passed = total > 0 && percent >= passScore;
  return { score, total, percent, passed, breakdown };
}

function assignmentForUser(assignmentId: string, userId: string): Row {
  return asRow(
    getConn().prepare("SELECT * FROM exam_assignments WHERE id=? AND user_id=?").get(assignmentId, userId) as Row | undefined,
    "assignment not found",
  );
}

function employeeAssignmentView(row: Row): Json {
  const passed = Boolean(row.passed);
  const examStatus = String(row.exam_status || "");
  const version = Number(row.paper_version || 0);
  const open = examStatus === "published" && version > 0;
  return {
    ...row,
    passed,
    required: Boolean(Number(row.required)),
    open,
    status: passed ? "passed" : open ? "pending" : "unready",
  };
}

function listEmployeeAssignments(userId: string): Json[] {
  const rows = getConn().prepare(
    `SELECT a.*, e.title, e.description, e.status AS exam_status, e.version AS paper_version, e.pass_score,
            EXISTS(
              SELECT 1 FROM exam_attempts t
               WHERE t.assignment_id=a.id AND t.user_id=a.user_id
                 AND t.passed=1 AND t.status='graded'
            ) AS passed
       FROM exam_assignments a
       JOIN exams e ON e.id=a.exam_id
      WHERE a.user_id=?
      ORDER BY a.created_at`,
  ).all(userId) as Row[];
  return rows.map(employeeAssignmentView);
}

function latestAttempt(assignmentId: string, userId: string, status?: string): Row | undefined {
  if (status) {
    return getConn().prepare(
      "SELECT * FROM exam_attempts WHERE assignment_id=? AND user_id=? AND status=? ORDER BY started_at DESC, submitted_at DESC LIMIT 1",
    ).get(assignmentId, userId, status) as Row | undefined;
  }
  return getConn().prepare(
    "SELECT * FROM exam_attempts WHERE assignment_id=? AND user_id=? ORDER BY submitted_at DESC, started_at DESC LIMIT 1",
  ).get(assignmentId, userId) as Row | undefined;
}

function questionsFromSnapshot(items: Json[]): Json[] {
  return items.map((item) => ({
    id: item.id,
    prompt: item.prompt,
    kind: item.kind || "true_false",
    options: Array.isArray(item.options) && item.options.length ? item.options : TRUE_FALSE_OPTIONS,
  }));
}

function createExam(body: Json): Json {
  const id = nid("exm");
  const now = nowIso();
  const passScore = body.pass_score == null ? 80 : Number(body.pass_score);
  if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100) throw new HttpFail(400, "invalid pass_score");
  getConn().prepare(
    `INSERT INTO exams (id,title,description,active,status,pass_score,version,effects,published_at,created_at)
     VALUES (?,?,?,?, 'draft', ?, 0, ?, NULL, ?)`,
  ).run(
    id,
    String(body.title || "Exam"),
    String(body.description || ""),
    body.active === false ? 0 : 1,
    passScore,
    JSON.stringify(body.effects && typeof body.effects === "object" ? body.effects : {}),
    now,
  );
  return publicExam(examRow(id));
}

function addManualItem(examId: string, body: Json): Json {
  examRow(examId);
  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new HttpFail(400, "prompt required");
  const kind = String(body.kind || "true_false");
  if (kind !== "true_false" && kind !== "choice") throw new HttpFail(400, "invalid item kind");
  const options = kind === "true_false"
    ? TRUE_FALSE_OPTIONS
    : (Array.isArray(body.options) ? body.options : parseJson(body.options, []));
  if (!Array.isArray(options) || !options.length) throw new HttpFail(400, "options required");
  const answer = kind === "true_false"
    ? normalizeChoice(body.answer == null || body.answer === "" ? "yes" : body.answer)
    : String(body.answer || "").trim();
  if (!answer) throw new HttpFail(400, "answer required");
  const id = nid("exi");
  getConn().prepare(
    `INSERT INTO exam_items (id,exam_id,knowledge_id,prompt,kind,options_json,answer,accepted,source,created_at)
     VALUES (?,?,?,?,?,?,?,0,'manual',?)`,
  ).run(id, examId, body.knowledge_id ? String(body.knowledge_id) : null, prompt, kind, JSON.stringify(options), answer, nowIso());
  return publicItem(itemRow(id), true);
}

function generateCandidates(examId: string, knowledgeIds: string[]): Json {
  examRow(examId);
  const ids = [...new Set(knowledgeIds.map(String).filter(Boolean))];
  if (!ids.length) throw new HttpFail(400, "knowledge_ids required");
  const published: Row[] = [];
  for (const id of ids) {
    const row = getConn().prepare("SELECT * FROM knowledge WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new HttpFail(404, "knowledge not found");
    if (String(row.status) !== "published") {
      throw new HttpFail(409, "unpublished knowledge cannot generate");
    }
    published.push(row);
  }
  const created: Json[] = [];
  tx((db) => {
    for (const knowledge of published) {
      const lines = sentencesFromKnowledge(String(knowledge.title || ""), String(knowledge.body || knowledge.body_en || ""));
      const prompts = lines.length ? lines : [String(knowledge.title || "已发布知识")];
      for (const line of prompts) {
        const id = nid("exi");
        const prompt = `根据已发布知识「${knowledge.title}」：${line} 该陈述是否符合现行制度？`;
        db.prepare(
          `INSERT INTO exam_items (id,exam_id,knowledge_id,prompt,kind,options_json,answer,accepted,source,created_at)
           VALUES (?,?,?,?, 'true_false', ?, 'yes', 0, 'generated', ?)`,
        ).run(id, examId, knowledge.id, prompt, JSON.stringify(TRUE_FALSE_OPTIONS), nowIso());
        created.push(publicItem(itemRow(id), true));
      }
    }
  });
  return { exam_id: examId, candidates: created, live: false };
}

function acceptItem(id: string): Json {
  const row = itemRow(id);
  getConn().prepare("UPDATE exam_items SET accepted=1 WHERE id=?").run(id);
  return publicItem(itemRow(String(row.id)), true);
}

function publishExam(examId: string): Json {
  const exam = examRow(examId);
  const items = getConn().prepare("SELECT * FROM exam_items WHERE exam_id=?").all(examId) as Row[];
  if (!items.length) throw new HttpFail(409, "unaccepted items cannot publish");
  if (items.some((row) => !Number(row.accepted))) throw new HttpFail(409, "unaccepted items cannot publish");
  const frozen = snapshotItems(examId);
  if (!frozen.length) throw new HttpFail(409, "unaccepted items cannot publish");
  const version = Number(exam.version || 0) + 1;
  const now = nowIso();
  const passScore = Number(exam.pass_score || 80);
  tx((db) => {
    db.prepare(
      `INSERT INTO exam_snapshots (id,exam_id,version,pass_score,items_json,created_at) VALUES (?,?,?,?,?,?)`,
    ).run(nid("exs"), examId, version, passScore, JSON.stringify(frozen), now);
    db.prepare(
      "UPDATE exams SET status='published', version=?, published_at=? WHERE id=?",
    ).run(version, now, examId);
  });
  return publicExam(examRow(examId));
}

function assignExam(examId: string, body: Json): Json {
  const exam = examRow(examId);
  if (!isPublishedPaper(exam)) throw new HttpFail(409, "draft papers cannot assign");
  const userId = String(body.user_id || "");
  userById(userId);
  const existing = getConn().prepare(
    "SELECT * FROM exam_assignments WHERE exam_id=? AND user_id=?",
  ).get(examId, userId) as Row | undefined;
  if (existing) return { ...existing, required: Boolean(Number(existing.required)) };
  const id = nid("exa");
  getConn().prepare(
    "INSERT INTO exam_assignments (id,exam_id,user_id,required,due_at,created_at) VALUES (?,?,?,?,?,?)",
  ).run(id, examId, userId, body.required === false ? 0 : 1, body.due_at || null, nowIso());
  return getConn().prepare("SELECT * FROM exam_assignments WHERE id=?").get(id) as Row;
}

function startAttempt(assignmentId: string, userId: string): Json {
  const assignment = assignmentForUser(assignmentId, userId);
  const exam = examRow(String(assignment.exam_id));
  if (!isPublishedPaper(exam)) throw new HttpFail(409, "draft papers cannot assign");
  const version = Number(exam.version);
  const snapshot = loadSnapshot(String(exam.id), version);
  const open = latestAttempt(assignmentId, userId, "started");
  if (open && Number(open.paper_version) === version) {
    return {
      id: open.id,
      assignment_id: assignmentId,
      paper_version: version,
      pass_score: snapshot.pass_score,
      questions: questionsFromSnapshot(snapshot.items),
    };
  }
  const id = nid("ext");
  const now = nowIso();
  getConn().prepare(
    `INSERT INTO exam_attempts
     (id,assignment_id,user_id,answers,passed,submitted_at,status,score,total,paper_version,idempotency_key,started_at,breakdown_json)
     VALUES (?,?,?,'{}',0,?,?,NULL,NULL,?,NULL,?,NULL)`,
  ).run(id, assignmentId, userId, now, "started", version, now);
  return {
    id,
    assignment_id: assignmentId,
    paper_version: version,
    pass_score: snapshot.pass_score,
    questions: questionsFromSnapshot(snapshot.items),
  };
}

function submitAttempt(assignmentId: string, userId: string, body: Json): Json {
  const assignment = assignmentForUser(assignmentId, userId);
  const exam = examRow(String(assignment.exam_id));
  if (!isPublishedPaper(exam)) throw new HttpFail(409, "draft papers cannot assign");
  const idempotency = String(body.idempotency_key || "").trim();
  if (idempotency) {
    const prior = getConn().prepare(
      "SELECT * FROM exam_attempts WHERE user_id=? AND idempotency_key=? AND status='graded'",
    ).get(userId, idempotency) as Row | undefined;
    if (prior) {
      return {
        id: prior.id,
        assignment_id: assignmentId,
        passed: Boolean(prior.passed),
        score: Number(prior.score || 0),
        total: Number(prior.total || 0),
        paper_version: Number(prior.paper_version || 0),
        exam_passed: examPassed(userId),
      };
    }
  }
  const started = latestAttempt(assignmentId, userId, "started");
  const version = started ? Number(started.paper_version || exam.version) : Number(exam.version);
  const snapshot = loadSnapshot(String(exam.id), version);
  const graded = gradeSnapshot(snapshot.items, answerMap(body), snapshot.pass_score);
  const now = nowIso();
  const id = started ? String(started.id) : nid("ext");
  tx((db) => {
    if (started) {
      db.prepare(
        `UPDATE exam_attempts
            SET answers=?, passed=?, submitted_at=?, status='graded', score=?, total=?,
                paper_version=?, idempotency_key=?, breakdown_json=?
          WHERE id=?`,
      ).run(
        JSON.stringify(answerMap(body)),
        graded.passed ? 1 : 0,
        now,
        graded.score,
        graded.total,
        version,
        idempotency || null,
        JSON.stringify(graded.breakdown),
        id,
      );
    } else {
      db.prepare(
        `INSERT INTO exam_attempts
         (id,assignment_id,user_id,answers,passed,submitted_at,status,score,total,paper_version,idempotency_key,started_at,breakdown_json)
         VALUES (?,?,?,?,?,?, 'graded', ?,?,?,?,?,?)`,
      ).run(
        id,
        assignmentId,
        userId,
        JSON.stringify(answerMap(body)),
        graded.passed ? 1 : 0,
        now,
        graded.score,
        graded.total,
        version,
        idempotency || null,
        now,
        JSON.stringify(graded.breakdown),
      );
    }
    if (graded.passed) {
      db.prepare(
        `INSERT INTO exam_qualifications
         (id,user_id,exam_id,assignment_id,attempt_id,paper_version,passed,score,total,awarded_at)
         VALUES (?,?,?,?,?,?,1,?,?,?)
         ON CONFLICT(user_id, exam_id, paper_version) DO UPDATE SET
           attempt_id=excluded.attempt_id, passed=1, score=excluded.score, total=excluded.total, awarded_at=excluded.awarded_at`,
      ).run(nid("exq"), userId, exam.id, assignmentId, id, version, graded.score, graded.total, now);
    }
  });
  return {
    id,
    assignment_id: assignmentId,
    passed: graded.passed,
    score: graded.score,
    total: graded.total,
    percent: graded.percent,
    paper_version: version,
    exam_passed: examPassed(userId),
  };
}

function attemptResult(assignmentId: string, userId: string): Json {
  assignmentForUser(assignmentId, userId);
  const attempt = latestAttempt(assignmentId, userId, "graded") || latestAttempt(assignmentId, userId);
  if (!attempt || String(attempt.status) !== "graded") {
    return { assignment_id: assignmentId, status: "pending", passed: false };
  }
  return {
    id: attempt.id,
    assignment_id: assignmentId,
    status: "graded",
    passed: Boolean(attempt.passed),
    score: Number(attempt.score || 0),
    total: Number(attempt.total || 0),
    paper_version: Number(attempt.paper_version || 0),
    submitted_at: attempt.submitted_at,
    breakdown: parseJson(attempt.breakdown_json, []),
    exam_passed: examPassed(userId),
  };
}

function listScores(): Json[] {
  return getConn().prepare(
    `SELECT t.id, t.assignment_id, t.user_id, u.name AS user_name, e.id AS exam_id, e.title,
            t.score, t.total, t.passed, t.paper_version, t.submitted_at
       FROM exam_attempts t
       JOIN exam_assignments a ON a.id=t.assignment_id
       JOIN exams e ON e.id=a.exam_id
       JOIN users u ON u.id=t.user_id
      WHERE t.status='graded'
      ORDER BY t.submitted_at DESC`,
  ).all() as Row[];
}

function listAdminAssignments(): Json[] {
  return getConn().prepare(
    `SELECT a.*, e.title, e.status AS exam_status, e.version AS paper_version, u.name AS user_name,
            EXISTS(
              SELECT 1 FROM exam_attempts t
               WHERE t.assignment_id=a.id AND t.passed=1 AND t.status='graded'
            ) AS passed
       FROM exam_assignments a
       JOIN exams e ON e.id=a.exam_id
       JOIN users u ON u.id=a.user_id
      ORDER BY a.created_at DESC`,
  ).all() as Row[];
}

examRouter.get("/admin/exams", (c) => {
  requireAdmin();
  return c.json((getConn().prepare("SELECT * FROM exams ORDER BY created_at DESC").all() as Row[]).map(publicExam));
});

examRouter.get("/admin/exams/:id/items", (c) => {
  requireAdmin();
  examRow(c.req.param("id"));
  const rows = getConn().prepare("SELECT * FROM exam_items WHERE exam_id=? ORDER BY created_at, id").all(c.req.param("id")) as Row[];
  return c.json(rows.map((row) => publicItem(row, true)));
});

examRouter.post("/admin/exams", async (c) => {
  const admin = requireAdmin();
  const created = createExam((await c.req.json()) as Json);
  audit(admin.id, "admin.exam.create", { exam_id: created.id, status: "draft" });
  return c.json(created, 201);
});

examRouter.post("/admin/exams/:id/items", async (c) => {
  const admin = requireAdmin();
  const item = addManualItem(c.req.param("id"), (await c.req.json()) as Json);
  audit(admin.id, "admin.exam.item.create", { exam_id: c.req.param("id"), item_id: item.id, live: false });
  return c.json(item, 201);
});

examRouter.post("/admin/exams/:id/generate", async (c) => {
  const admin = requireAdmin();
  const body = (await c.req.json()) as Json;
  const ids = Array.isArray(body.knowledge_ids) ? body.knowledge_ids.map(String) : [];
  const result = generateCandidates(c.req.param("id"), ids);
  audit(admin.id, "admin.exam.generate", { exam_id: c.req.param("id"), knowledge_ids: ids, live: false });
  return c.json(result, 201);
});

examRouter.post("/admin/exam-items/:id/accept", (c) => {
  const admin = requireAdmin();
  const item = acceptItem(c.req.param("id"));
  audit(admin.id, "admin.exam.item.accept", { item_id: item.id, exam_id: item.exam_id });
  return c.json(item);
});

examRouter.post("/admin/exams/:id/publish", (c) => {
  const admin = requireAdmin();
  const published = publishExam(c.req.param("id"));
  audit(admin.id, "admin.exam.publish", { exam_id: published.id, version: published.version });
  return c.json(published);
});

examRouter.post("/admin/exams/:id/assign", async (c) => {
  const admin = requireAdmin();
  const assigned = assignExam(c.req.param("id"), (await c.req.json()) as Json);
  audit(admin.id, "admin.exam.assign", { assignment_id: assigned.id, user_id: assigned.user_id, exam_id: c.req.param("id") });
  return c.json(assigned, 201);
});

examRouter.get("/admin/exam-assignments", (c) => {
  requireAdmin();
  return c.json(listAdminAssignments());
});

examRouter.post("/admin/exam-assignments", async (c) => {
  const admin = requireAdmin();
  const body = (await c.req.json()) as Json;
  const assigned = assignExam(String(body.exam_id || ""), body);
  audit(admin.id, "admin.exam.assign", { assignment_id: assigned.id, user_id: assigned.user_id, exam_id: body.exam_id });
  return c.json(assigned, 201);
});

examRouter.get("/admin/exam-scores", (c) => {
  requireAdmin();
  return c.json(listScores());
});

examRouter.get("/exams", (c) => c.json(listEmployeeAssignments(examActor().id)));

examRouter.post("/exams/:id/start", (c) => c.json(startAttempt(c.req.param("id"), examActor().id)));

examRouter.post("/exams/:id/submit", async (c) => {
  const user = examActor();
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const result = submitAttempt(c.req.param("id"), user.id, body);
  audit(user.id, "exam.submit", { assignment_id: c.req.param("id"), passed: result.passed, ignored_client_pass: true });
  return c.json(result);
});

examRouter.get("/exams/:id/result", (c) => c.json(attemptResult(c.req.param("id"), examActor().id)));

export function examDemoStatus(userId: string, name: string, brands: string[]): Json {
  return {
    user: name,
    passed: examPassed(userId),
    exam_todo_count: examTodoCount(userId),
    brands,
    modules: ["品牌邮箱", "阶段 ≠ 发送", "费用审批", "数据安全与最小权限"],
    note: "合格由服务端按已发布题卷计算。本接口不按演示身份假装通过。",
  };
}
