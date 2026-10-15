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

async function userById(id: string): Promise<Row> {
  return asRow((await getConn().query("SELECT * FROM users WHERE id=$1", [id])).rows[0] as Row | undefined, "user not found");
}

async function examRow(id: string): Promise<Row> {
  return asRow((await getConn().query("SELECT * FROM exams WHERE id=$1", [id])).rows[0] as Row | undefined, "exam not found");
}

async function itemRow(id: string): Promise<Row> {
  return asRow((await getConn().query("SELECT * FROM exam_items WHERE id=$1", [id])).rows[0] as Row | undefined, "exam item not found");
}

async function examActor(): Promise<Awaited<{ id: string }>> {
  if (authDisabled()) return (await currentUser());
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

export async function examTodoCount(userId: string): Promise<number> {
  const row = (await getConn().query("\n  SELECT COUNT(*) AS missing\n    FROM exam_assignments a\n    JOIN exams e ON e.id = a.exam_id\n   WHERE a.user_id = $1 AND a.required = 1\n     AND e.status = 'published' AND e.version > 0\n     AND NOT EXISTS (\n       SELECT 1 FROM exam_attempts t\n        WHERE t.assignment_id = a.id AND t.user_id = a.user_id\n          AND t.passed = 1 AND t.status = 'graded'\n     )\n", [userId])).rows[0] as { missing: number };
  return Number(row?.missing || 0);
}

export async function examPassed(userId: string): Promise<boolean> {
  return (await examTodoCount(userId)) === 0;
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

async function snapshotItems(examId: string): Promise<Json[]> {
  const rows = (await getConn().query("SELECT * FROM exam_items WHERE exam_id=$1 AND accepted=1 ORDER BY created_at, id", [examId])).rows as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    knowledge_id: row.knowledge_id || "",
    prompt: String(row.prompt),
    kind: String(row.kind || "true_false"),
    options: parseJson(row.options_json, TRUE_FALSE_OPTIONS),
    answer: String(row.answer),
  }));
}

async function loadSnapshot(examId: string, version: number): Promise<{ pass_score: number; items: Json[] }> {
  const row = (await getConn().query("SELECT * FROM exam_snapshots WHERE exam_id=$1 AND version=$2", [examId,version])).rows[0] as Row | undefined;
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
      options: Array.isArray(item.options) ? item.options : [],
      answer: String(item.answer || ""),
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

async function assignmentForUser(assignmentId: string, userId: string): Promise<Row> {
  return asRow(
    (await getConn().query("SELECT * FROM exam_assignments WHERE id=$1 AND user_id=$2", [assignmentId,userId])).rows[0] as Row | undefined,
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

async function listEmployeeAssignments(userId: string): Promise<Json[]> {
  const rows = (await getConn().query("SELECT a.*, e.title, e.description, e.status AS exam_status, e.version AS paper_version, e.pass_score,\n            EXISTS(\n              SELECT 1 FROM exam_attempts t\n               WHERE t.assignment_id=a.id AND t.user_id=a.user_id\n                 AND t.passed=1 AND t.status='graded'\n            ) AS passed\n       FROM exam_assignments a\n       JOIN exams e ON e.id=a.exam_id\n      WHERE a.user_id=$1\n      ORDER BY a.created_at", [userId])).rows as Row[];
  return rows.map(employeeAssignmentView);
}

async function latestAttempt(assignmentId: string, userId: string, status?: string): Promise<Row | undefined> {
  if (status) {
    return (await getConn().query("SELECT * FROM exam_attempts WHERE assignment_id=$1 AND user_id=$2 AND status=$3 ORDER BY started_at DESC, submitted_at DESC LIMIT 1", [assignmentId,userId,status])).rows[0] as Row | undefined;
  }
  return (await getConn().query("SELECT * FROM exam_attempts WHERE assignment_id=$1 AND user_id=$2 ORDER BY submitted_at DESC, started_at DESC LIMIT 1", [assignmentId,userId])).rows[0] as Row | undefined;
}

function questionsFromSnapshot(items: Json[]): Json[] {
  return items.map((item) => ({
    id: item.id,
    prompt: item.prompt,
    kind: item.kind || "true_false",
    options: Array.isArray(item.options) && item.options.length ? item.options : TRUE_FALSE_OPTIONS,
  }));
}

async function createExam(body: Json): Promise<Json> {
  const id = nid("exm");
  const now = nowIso();
  const passScore = body.pass_score == null ? 80 : Number(body.pass_score);
  if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100) throw new HttpFail(400, "invalid pass_score");
  (await getConn().query("INSERT INTO exams (id,title,description,active,status,pass_score,version,effects,published_at,created_at)\n     VALUES ($1,$2,$3,$4, 'draft', $5, 0, $6, NULL, $7)", [id,String(body.title || "Exam"),String(body.description || ""),body.active === false ? 0 : 1,passScore,JSON.stringify(body.effects && typeof body.effects === "object" ? body.effects : {}),now]));
  return publicExam((await examRow(id)));
}

async function addManualItem(examId: string, body: Json): Promise<Json> {
  (await examRow(examId));
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
  (await getConn().query("INSERT INTO exam_items (id,exam_id,knowledge_id,prompt,kind,options_json,answer,accepted,source,created_at)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,0,'manual',$8)", [id,examId,body.knowledge_id ? String(body.knowledge_id) : null,prompt,kind,JSON.stringify(options),answer,nowIso()]));
  return publicItem((await itemRow(id)), true);
}

async function generateCandidates(examId: string, knowledgeIds: string[]): Promise<Json> {
  (await examRow(examId));
  const ids = [...new Set(knowledgeIds.map(String).filter(Boolean))];
  if (!ids.length) throw new HttpFail(400, "knowledge_ids required");
  const published: Row[] = [];
  for (const id of ids) {
    const row = (await getConn().query("SELECT * FROM knowledge WHERE id=$1", [id])).rows[0] as Row | undefined;
    if (!row) throw new HttpFail(404, "knowledge not found");
    if (String(row.status) !== "published") {
      throw new HttpFail(409, "unpublished knowledge cannot generate");
    }
    published.push(row);
  }
  const created: Json[] = [];
  (await tx(async (db) => {
    for (const knowledge of published) {
      const lines = sentencesFromKnowledge(String(knowledge.title || ""), String(knowledge.body || knowledge.body_en || ""));
      const prompts = lines.length ? lines : [String(knowledge.title || "已发布知识")];
      for (const line of prompts) {
        const id = nid("exi");
        const prompt = `根据已发布知识「${knowledge.title}」：${line} 该陈述是否符合现行制度？`;
        (await db.query("INSERT INTO exam_items (id,exam_id,knowledge_id,prompt,kind,options_json,answer,accepted,source,created_at)\n           VALUES ($1,$2,$3,$4, 'true_false', $5, 'yes', 0, 'generated', $6)", [id,examId,knowledge.id,prompt,JSON.stringify(TRUE_FALSE_OPTIONS),nowIso()]));
        created.push(publicItem((await itemRow(id)), true));
      }
    }
  }));
  return { exam_id: examId, candidates: created, live: false };
}

async function acceptItem(id: string): Promise<Json> {
  const row = (await itemRow(id));
  (await getConn().query("UPDATE exam_items SET accepted=1 WHERE id=$1", [id]));
  return publicItem((await itemRow(String(row.id))), true);
}

async function publishExam(examId: string): Promise<Json> {
  const exam = (await examRow(examId));
  const items = (await getConn().query("SELECT * FROM exam_items WHERE exam_id=$1", [examId])).rows as Row[];
  if (!items.length) throw new HttpFail(409, "unaccepted items cannot publish");
  if (items.some((row) => !Number(row.accepted))) throw new HttpFail(409, "unaccepted items cannot publish");
  const frozen = (await snapshotItems(examId));
  if (!frozen.length) throw new HttpFail(409, "unaccepted items cannot publish");
  const version = Number(exam.version || 0) + 1;
  const now = nowIso();
  const passScore = Number(exam.pass_score || 80);
  (await tx(async (db) => {
    (await db.query("INSERT INTO exam_snapshots (id,exam_id,version,pass_score,items_json,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [nid("exs"),examId,version,passScore,JSON.stringify(frozen),now]));
    (await db.query("UPDATE exams SET status='published', version=$1, published_at=$2 WHERE id=$3", [version,now,examId]));
  }));
  return publicExam((await examRow(examId)));
}

async function assignExam(examId: string, body: Json): Promise<Json> {
  const exam = (await examRow(examId));
  if (!isPublishedPaper(exam)) throw new HttpFail(409, "draft papers cannot assign");
  const userId = String(body.user_id || "");
  (await userById(userId));
  const existing = (await getConn().query("SELECT * FROM exam_assignments WHERE exam_id=$1 AND user_id=$2", [examId,userId])).rows[0] as Row | undefined;
  if (existing) return { ...existing, required: Boolean(Number(existing.required)) };
  const id = nid("exa");
  (await getConn().query("INSERT INTO exam_assignments (id,exam_id,user_id,required,due_at,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [id,examId,userId,body.required === false ? 0 : 1,body.due_at || null,nowIso()]));
  return (await getConn().query("SELECT * FROM exam_assignments WHERE id=$1", [id])).rows[0] as Row;
}

async function startAttempt(assignmentId: string, userId: string): Promise<Json> {
  const assignment = (await assignmentForUser(assignmentId, userId));
  const exam = (await examRow(String(assignment.exam_id)));
  if (!isPublishedPaper(exam)) throw new HttpFail(409, "draft papers cannot assign");
  const version = Number(exam.version);
  const snapshot = (await loadSnapshot(String(exam.id), version));
  const open = (await latestAttempt(assignmentId, userId, "started"));
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
  (await getConn().query("INSERT INTO exam_attempts\n     (id,assignment_id,user_id,answers,passed,submitted_at,status,score,total,paper_version,idempotency_key,started_at,breakdown_json)\n     VALUES ($1,$2,$3,'{}',0,$4,$5,NULL,NULL,$6,NULL,$7,NULL)", [id,assignmentId,userId,now,"started",version,now]));
  return {
    id,
    assignment_id: assignmentId,
    paper_version: version,
    pass_score: snapshot.pass_score,
    questions: questionsFromSnapshot(snapshot.items),
  };
}

async function submitAttempt(assignmentId: string, userId: string, body: Json): Promise<Json> {
  const assignment = (await assignmentForUser(assignmentId, userId));
  const exam = (await examRow(String(assignment.exam_id)));
  if (!isPublishedPaper(exam)) throw new HttpFail(409, "draft papers cannot assign");
  const idempotency = String(body.idempotency_key || "").trim();
  if (idempotency) {
    const prior = (await getConn().query("SELECT * FROM exam_attempts WHERE user_id=$1 AND idempotency_key=$2 AND status='graded'", [userId,idempotency])).rows[0] as Row | undefined;
    if (prior) {
      return {
        id: prior.id,
        assignment_id: assignmentId,
        passed: Boolean(prior.passed),
        score: Number(prior.score || 0),
        total: Number(prior.total || 0),
        paper_version: Number(prior.paper_version || 0),
        exam_passed: (await examPassed(userId)),
      };
    }
  }
  const started = (await latestAttempt(assignmentId, userId, "started"));
  const version = started ? Number(started.paper_version || exam.version) : Number(exam.version);
  const snapshot = (await loadSnapshot(String(exam.id), version));
  const graded = gradeSnapshot(snapshot.items, answerMap(body), snapshot.pass_score);
  const now = nowIso();
  const id = started ? String(started.id) : nid("ext");
  (await tx(async (db) => {
    if (started) {
      (await db.query("UPDATE exam_attempts\n            SET answers=$1, passed=$2, submitted_at=$3, status='graded', score=$4, total=$5,\n                paper_version=$6, idempotency_key=$7, breakdown_json=$8\n          WHERE id=$9", [JSON.stringify(answerMap(body)),graded.passed ? 1 : 0,now,graded.score,graded.total,version,idempotency || null,JSON.stringify(graded.breakdown),id]));
    } else {
      (await db.query("INSERT INTO exam_attempts\n         (id,assignment_id,user_id,answers,passed,submitted_at,status,score,total,paper_version,idempotency_key,started_at,breakdown_json)\n         VALUES ($1,$2,$3,$4,$5,$6, 'graded', $7,$8,$9,$10,$11,$12)", [id,assignmentId,userId,JSON.stringify(answerMap(body)),graded.passed ? 1 : 0,now,graded.score,graded.total,version,idempotency || null,now,JSON.stringify(graded.breakdown)]));
    }
    if (graded.passed) {
      (await db.query("INSERT INTO exam_qualifications\n         (id,user_id,exam_id,assignment_id,attempt_id,paper_version,passed,score,total,awarded_at)\n         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9)\n         ON CONFLICT(user_id, exam_id, paper_version) DO UPDATE SET\n           attempt_id=excluded.attempt_id, passed=1, score=excluded.score, total=excluded.total, awarded_at=excluded.awarded_at", [nid("exq"),userId,exam.id,assignmentId,id,version,graded.score,graded.total,now]));
    }
  }));
  return {
    id,
    assignment_id: assignmentId,
    passed: graded.passed,
    score: graded.score,
    total: graded.total,
    percent: graded.percent,
    paper_version: version,
    exam_passed: (await examPassed(userId)),
  };
}

async function attemptResult(assignmentId: string, userId: string): Promise<Json> {
  (await assignmentForUser(assignmentId, userId));
  const attempt = (await latestAttempt(assignmentId, userId, "graded")) || (await latestAttempt(assignmentId, userId));
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
    exam_passed: (await examPassed(userId)),
  };
}

async function listScores(): Promise<Json[]> {
  return (await getConn().query("SELECT t.id, t.assignment_id, t.user_id, u.name AS user_name, e.id AS exam_id, e.title,\n            t.score, t.total, t.passed, t.paper_version, t.submitted_at\n       FROM exam_attempts t\n       JOIN exam_assignments a ON a.id=t.assignment_id\n       JOIN exams e ON e.id=a.exam_id\n       JOIN users u ON u.id=t.user_id\n      WHERE t.status='graded'\n      ORDER BY t.submitted_at DESC", [])).rows as Row[];
}

async function listAdminAssignments(): Promise<Json[]> {
  return (await getConn().query("SELECT a.*, e.title, e.status AS exam_status, e.version AS paper_version, u.name AS user_name,\n            EXISTS(\n              SELECT 1 FROM exam_attempts t\n               WHERE t.assignment_id=a.id AND t.passed=1 AND t.status='graded'\n            ) AS passed\n       FROM exam_assignments a\n       JOIN exams e ON e.id=a.exam_id\n       JOIN users u ON u.id=a.user_id\n      ORDER BY a.created_at DESC", [])).rows as Row[];
}

examRouter.get("/admin/exams", async (c) => {
  requireAdmin();
  return c.json(((await getConn().query("SELECT * FROM exams ORDER BY created_at DESC", [])).rows as Row[]).map(publicExam));
});

examRouter.get("/admin/exams/:id/items", async (c) => {
  requireAdmin();
  (await examRow(c.req.param("id")));
  const rows = (await getConn().query("SELECT * FROM exam_items WHERE exam_id=$1 ORDER BY created_at, id", [c.req.param("id")])).rows as Row[];
  return c.json(rows.map((row) => publicItem(row, true)));
});

examRouter.post("/admin/exams", async (c) => {
  const admin = requireAdmin();
  const created = (await createExam((await c.req.json()) as Json));
  (await audit(admin.id, "admin.exam.create", { exam_id: created.id, status: "draft" }));
  return c.json(created, 201);
});

examRouter.post("/admin/exams/:id/items", async (c) => {
  const admin = requireAdmin();
  const item = (await addManualItem(c.req.param("id"), (await c.req.json()) as Json));
  (await audit(admin.id, "admin.exam.item.create", { exam_id: c.req.param("id"), item_id: item.id, live: false }));
  return c.json(item, 201);
});

examRouter.post("/admin/exams/:id/generate", async (c) => {
  const admin = requireAdmin();
  const body = (await c.req.json()) as Json;
  const ids = Array.isArray(body.knowledge_ids) ? body.knowledge_ids.map(String) : [];
  const result = (await generateCandidates(c.req.param("id"), ids));
  (await audit(admin.id, "admin.exam.generate", { exam_id: c.req.param("id"), knowledge_ids: ids, live: false }));
  return c.json(result, 201);
});

examRouter.post("/admin/exam-items/:id/accept", async (c) => {
  const admin = requireAdmin();
  const item = (await acceptItem(c.req.param("id")));
  (await audit(admin.id, "admin.exam.item.accept", { item_id: item.id, exam_id: item.exam_id }));
  return c.json(item);
});

examRouter.post("/admin/exams/:id/publish", async (c) => {
  const admin = requireAdmin();
  const published = (await publishExam(c.req.param("id")));
  (await audit(admin.id, "admin.exam.publish", { exam_id: published.id, version: published.version }));
  return c.json(published);
});

examRouter.post("/admin/exams/:id/assign", async (c) => {
  const admin = requireAdmin();
  const assigned = (await assignExam(c.req.param("id"), (await c.req.json()) as Json));
  (await audit(admin.id, "admin.exam.assign", { assignment_id: assigned.id, user_id: assigned.user_id, exam_id: c.req.param("id") }));
  return c.json(assigned, 201);
});

examRouter.get("/admin/exam-assignments", async (c) => {
  requireAdmin();
  return c.json((await listAdminAssignments()));
});

examRouter.post("/admin/exam-assignments", async (c) => {
  const admin = requireAdmin();
  const body = (await c.req.json()) as Json;
  const assigned = (await assignExam(String(body.exam_id || ""), body));
  (await audit(admin.id, "admin.exam.assign", { assignment_id: assigned.id, user_id: assigned.user_id, exam_id: body.exam_id }));
  return c.json(assigned, 201);
});

examRouter.get("/admin/exam-scores", async (c) => {
  requireAdmin();
  return c.json((await listScores()));
});

examRouter.get("/exams", async (c) => c.json((await listEmployeeAssignments((await examActor()).id))));

examRouter.post("/exams/:id/start", async (c) => c.json((await startAttempt(c.req.param("id"), (await examActor()).id))));

examRouter.post("/exams/:id/submit", async (c) => {
  const user = (await examActor());
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const result = (await submitAttempt(c.req.param("id"), user.id, body));
  (await audit(user.id, "exam.submit", { assignment_id: c.req.param("id"), passed: result.passed, ignored_client_pass: true }));
  return c.json(result);
});

examRouter.get("/exams/:id/result", async (c) => c.json((await attemptResult(c.req.param("id"), (await examActor()).id))));

export async function examDemoStatus(userId: string, name: string, brands: string[]): Promise<Json> {
  return {
    user: name,
    passed: (await examPassed(userId)),
    exam_todo_count: (await examTodoCount(userId)),
    brands,
    modules: ["品牌邮箱", "阶段 ≠ 发送", "费用审批", "数据安全与最小权限"],
    note: "合格由服务端按已发布题卷计算。本接口不按演示身份假装通过。",
  };
}
