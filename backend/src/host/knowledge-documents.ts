/**
 * 非结构化资料流水线（P1，2026-10-02）：上传 → 规整 → 索引 → 待审 → 发布 → 试算。
 * 设计：docs/superpowers/specs/2026-10-02-knowledge-unstructured-pageindex-design.md
 * 引擎：PageIndex 本地（Node 内桥接 knowledge-bridge.ts）；单并发；审核后生效；
 * 真实进度与终态，不伪造成完成或进度（CONST-10）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "../auth.js";
import { dataDir } from "../config.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { knowledgeActorId } from "./knowledge.js";
import { bridgeMode, chatModel, indexModel, mediaModel, runBridge, type BridgeOutcome } from "../knowledge-bridge.js";
import { recordCostEvent } from "../costs.js";
import { recordCapabilityCall } from "../capability/registry.js";
import { intentLlmApiKey, intentLlmFetch } from "../tasks/openai-intent.js";
import { postgresQuery } from "../postgres/pool.js";

export const DOCUMENT_STATUSES = [
  "draft",
  "uploaded",
  "normalizing",
  "indexing",
  "pending_review",
  "published",
  "archived",
  "failed",
  "cancelled",
] as const;

export const DOCUMENT_MEDIA_TYPES = ["pdf", "pptx", "image", "audio", "video"] as const;

/** P1 接入：PDF / 图片 / 音视频；PPTX 仍在后续批次（上传即拒绝，页面文案写明）。 */
const ACCEPTED_MEDIA: Record<string, { media: "pdf" | "image" | "audio" | "video"; mime: string }> = {
  ".pdf": { media: "pdf", mime: "application/pdf" },
  ".png": { media: "image", mime: "image/png" },
  ".jpg": { media: "image", mime: "image/jpeg" },
  ".jpeg": { media: "image", mime: "image/jpeg" },
  ".gif": { media: "image", mime: "image/gif" },
  ".webp": { media: "image", mime: "image/webp" },
  ".mp3": { media: "audio", mime: "audio/mpeg" },
  ".wav": { media: "audio", mime: "audio/wav" },
  ".m4a": { media: "audio", mime: "audio/mp4" },
  ".aac": { media: "audio", mime: "audio/aac" },
  ".flac": { media: "audio", mime: "audio/flac" },
  ".ogg": { media: "audio", mime: "audio/ogg" },
  ".opus": { media: "audio", mime: "audio/opus" },
  ".mp4": { media: "video", mime: "video/mp4" },
  ".mov": { media: "video", mime: "video/quicktime" },
  ".webm": { media: "video", mime: "video/webm" },
  ".mkv": { media: "video", mime: "video/x-matroska" },
};

/** 按类型做魔数校验；音视频容器格式多，仅校验扩展名，ffmpeg 在转写时做真实校验。 */
function validateMediaMagic(buf: Buffer, media: "pdf" | "image" | "audio" | "video"): void {
  const head = buf.subarray(0, 16);
  if (media === "pdf") {
    if (!buf.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
      throw new HttpFail(400, { code: "knowledge_invalid_pdf", message: "文件不是有效的 PDF" });
    }
    return;
  }
  if (media === "image") {
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
    const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
      && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    if (!(isPng || isJpeg || isGif || isWebp)) {
      throw new HttpFail(400, { code: "knowledge_invalid_image", message: "文件不是有效的图片" });
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpFail) {
    const detail = (error as unknown as { detail?: unknown }).detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const message = (detail as Json).message;
      if (message) return String(message);
    }
    return String((error as unknown as { message?: string }).message || "作业失败");
  }
  return error instanceof Error ? error.message : "作业失败";
}

function errorCode(error: unknown): string {
  if (error instanceof HttpFail) {
    const detail = (error as unknown as { detail?: unknown }).detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail) && (detail as Json).code) {
      return String((detail as Json).code);
    }
  }
  return "knowledge_job_failed";
}

/* ---- 目录与路径 ---- */

function docsRoot(): string {
  const configured = String(process.env.KNOWLEDGE_DOCS_DIR || "").trim();
  return configured || path.join(dataDir(), "knowledge");
}

function baseDir(baseId: string): string {
  return path.join(docsRoot(), "bases", baseId);
}

function libraryDir(baseId: string): string {
  return path.join(baseDir(baseId), "library");
}

function documentDir(id: string, baseId: string): string {
  return path.join(baseDir(baseId), "documents", id);
}

function docDirOf(doc: Row): string {
  return documentDir(String(doc.id), String(doc.base_id));
}

/** 落库存相对 data 根路径（便于整目录搬迁）；越出 data 根时保留绝对路径。 */
function storePath(abs: string): string {
  const root = dataDir();
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith("..") ? rel.split(path.sep).join("/") : abs;
}

function resolveStorePath(stored: string): string {
  return path.isAbsolute(stored) ? stored : path.join(dataDir(), stored);
}

function normalizedPathOf(doc: Row): string {
  return path.join(docDirOf(doc), "normalized.pdf");
}

function artifactsOf(doc: Row): Json {
  try {
    const parsed = doc.artifacts ? JSON.parse(String(doc.artifacts)) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

function engineDocIdOf(doc: Row): string {
  const index = artifactsOf(doc).index as Json | undefined;
  return index?.doc_id ? String(index.doc_id) : "";
}

function mergeArtifacts(id: string, patch: Json): void {
  const doc = docRow(id);
  const merged = { ...artifactsOf(doc), ...patch };
  getConn().prepare("UPDATE knowledge_documents SET artifacts=?, updated_at=? WHERE id=?")
    .run(JSON.stringify(merged), nowIso(), id);
}

/* ---- 视图 ---- */

function docRow(id: string): Row {
  const row = getConn().prepare("SELECT * FROM knowledge_documents WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new HttpFail(404, "资料不存在");
  return { ...row };
}

function jobView(row: Row): Json {
  let detail: Json | null = null;
  try {
    detail = row.detail ? (JSON.parse(String(row.detail)) as Json) : null;
  } catch {
    detail = null;
  }
  return {
    id: String(row.id),
    document_id: String(row.document_id),
    kind: String(row.kind),
    status: String(row.status),
    progress_done: Number(row.progress_done || 0),
    progress_total: Number(row.progress_total || 0),
    detail,
    error: row.error == null ? "" : String(row.error),
    attempt: Number(row.attempt || 1),
    created_at: String(row.created_at || ""),
    started_at: row.started_at == null ? null : String(row.started_at),
    finished_at: row.finished_at == null ? null : String(row.finished_at),
  };
}

export function documentView(row: Row, opts: { latestJob?: Row | null } = {}): Json {
  return {
    id: String(row.id),
    base_id: String(row.base_id),
    base_name: row.base_name == null ? undefined : String(row.base_name),
    title: String(row.title || ""),
    filename: String(row.filename || ""),
    media_type: String(row.media_type || ""),
    mime: row.mime == null ? "" : String(row.mime),
    size_bytes: Number(row.size_bytes || 0),
    status: String(row.status || "uploaded"),
    error: row.error == null ? "" : String(row.error),
    retry_count: Number(row.retry_count || 0),
    artifacts: artifactsOf(row),
    created_by: row.created_by == null ? "" : String(row.created_by),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    published_at: row.published_at == null ? null : String(row.published_at),
    latest_job: opts.latestJob ? jobView(opts.latestJob) : null,
  };
}

function latestJobOf(documentId: string): Row | null {
  return (getConn().prepare(
    "SELECT * FROM knowledge_document_jobs WHERE document_id=? ORDER BY created_at DESC, id DESC LIMIT 1",
  ).get(documentId) as Row | undefined) || null;
}

/* ---- 查询 ---- */

export function listDocuments(opts: { base?: string | null; status?: string | null } = {}): Json[] {
  requireAdmin();
  const clauses: string[] = [];
  const args: unknown[] = [];
  const baseId = String(opts.base || "").trim();
  if (baseId) {
    clauses.push("d.base_id=?");
    args.push(baseId);
  }
  const status = String(opts.status || "").trim();
  if (status) {
    clauses.push("d.status=?");
    args.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = getConn().prepare(
    `SELECT d.*, b.name AS base_name FROM knowledge_documents d
       LEFT JOIN knowledge_bases b ON b.id=d.base_id${where}
      ORDER BY d.updated_at DESC, d.id DESC`,
  ).all(...args) as Row[];
  return rows.map((row) => documentView(row, { latestJob: latestJobOf(String(row.id)) }));
}

export function getDocumentDetail(id: string): Json {
  requireAdmin();
  const doc = docRow(id);
  const base = getConn().prepare(
    `SELECT b.id, b.name, b.kind, b.status, d.name AS domain_name, f.name AS family_name
       FROM knowledge_bases b
       LEFT JOIN knowledge_domains d ON d.id=b.domain_id
       LEFT JOIN knowledge_domains f ON f.id=d.parent_id
      WHERE b.id=?`,
  ).get(String(doc.base_id)) as Row | undefined;
  const jobs = getConn()
    .prepare("SELECT * FROM knowledge_document_jobs WHERE document_id=? ORDER BY created_at DESC, id DESC")
    .all(id) as Row[];
  const preview = textPreviewOf(doc);
  return {
    document: { ...documentView(doc, { latestJob: latestJobOf(id) }), base_name: base ? String(base.name) : "" },
    base: base ? {
      id: String(base.id),
      name: String(base.name),
      kind: String(base.kind),
      status: String(base.status),
      domain_name: base.domain_name == null ? "" : String(base.domain_name),
      family_name: base.family_name == null ? "" : String(base.family_name),
    } : null,
    jobs: jobs.map(jobView),
    text_preview: preview,
  };
}

/** 留档稿预览（转写稿 / 抽取稿），最多 20000 字符；无留档返回 null。 */
function textPreviewOf(doc: Row): Json | null {
  const dir = docDirOf(doc);
  for (const name of ["transcript.md", "extracted.md"]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8").slice(0, 20000);
    return { name, text };
  }
  return null;
}

/* ---- 上传 ---- */

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "upload.pdf";
}

export function uploadDocument(
  file: { name: string; type: string; buf: Buffer },
  baseId: string,
  actor = knowledgeActorId(),
  options: { draft?: boolean } = {},
): Json {
  requireAdmin();
  const base = getConn().prepare("SELECT * FROM knowledge_bases WHERE id=?").get(String(baseId || "")) as Row | undefined;
  if (!base) throw new HttpFail(400, { code: "knowledge_base_missing", message: "知识库不存在" });
  if (String(base.kind) !== "unstructured") {
    throw new HttpFail(400, { code: "knowledge_base_not_unstructured", message: "该库不是非结构化库，不能上传资料" });
  }
  if (String(base.status) !== "active") {
    throw new HttpFail(400, { code: "knowledge_base_archived", message: "知识库已归档，不能上传资料" });
  }
  const filename = sanitizeName(file.name || "upload.pdf");
  const ext = path.extname(filename).toLowerCase();
  const spec = ACCEPTED_MEDIA[ext];
  if (!spec) {
    throw new HttpFail(400, {
      code: "knowledge_format_not_implemented",
      message: "本阶段先接入 PDF / 图片 / 音视频；PPTX 将在后续批次开放",
    });
  }
  validateMediaMagic(file.buf, spec.media);
  const maxBytes = Number(process.env.KNOWLEDGE_DOC_MAX_BYTES || 536870912);
  if (file.buf.length > maxBytes) {
    throw new HttpFail(413, { code: "knowledge_document_too_large", message: `单个文件不得超过 ${Math.floor(maxBytes / 1048576)} MiB` });
  }
  const id = nid("kdoc");
  const now = nowIso();
  const dir = documentDir(id, String(base.id));
  fs.mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(dir, `source${ext}`);
  fs.writeFileSync(sourcePath, file.buf);
  const title = filename.replace(/\.[^.]+$/, "") || filename;
  tx((db) => {
    db.prepare(
      `INSERT INTO knowledge_documents
       (id,base_id,title,filename,media_type,mime,size_bytes,source_path,status,error,retry_count,artifacts,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, String(base.id), title, filename, spec.media, file.type || spec.mime, file.buf.length,
      storePath(sourcePath), options.draft ? "draft" : "uploaded", null, 0, null, actor, now, now,
    );
    if (!options.draft) insertQueuedJob(db, id, "normalize", actor);
  });
  audit(actor, "knowledge.document.upload", { document_id: id, base_id: String(base.id), filename, media_type: spec.media });
  if (!options.draft) enqueueDocument(id, "normalize");
  return { document: documentView(docRow(id), { latestJob: latestJobOf(id) }) };
}

export function startDocument(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const doc = docRow(id);
  const base = getConn().prepare("SELECT status FROM knowledge_bases WHERE id=?").get(doc.base_id) as Row | undefined;
  if (base?.status !== "active") throw new HttpFail(409, "知识库已归档");
  tx((db) => {
    const changed = db.prepare("UPDATE knowledge_documents SET status='uploaded',updated_at=? WHERE id=? AND status='draft'").run(nowIso(), id);
    if (!changed.changes) throw new HttpFail(409, "只有草稿可以开始解析");
    insertQueuedJob(db, id, "normalize", actor);
  });
  audit(actor, "knowledge.document.start", { document_id: id, base_id: doc.base_id });
  enqueueDocument(id, "normalize");
  return { document: documentView(docRow(id), { latestJob: latestJobOf(id) }) };
}

function insertQueuedJob(db: ReturnType<typeof getConn>, documentId: string, kind: "normalize" | "index", actor: string): Row {
  const prior = db.prepare(
    "SELECT MAX(attempt) AS attempt FROM knowledge_document_jobs WHERE document_id=? AND kind=?",
  ).get(documentId, kind) as { attempt: number | null } | undefined;
  const row: Row = {
    id: nid("kdjob"),
    document_id: documentId,
    kind,
    status: "queued",
    attempt: Number(prior?.attempt || 0) + 1,
    created_by: actor,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO knowledge_document_jobs
     (id,document_id,kind,status,progress_done,progress_total,detail,error,attempt,created_by,created_at,started_at,finished_at)
     VALUES (?,?,?,?,0,0,NULL,NULL,?,?,?,NULL,NULL)`,
  ).run(row.id, row.document_id, row.kind, row.status, row.attempt, row.created_by, row.created_at);
  return row;
}

/* ---- 单并发执行器 ---- */

type QueueItem = { documentId: string; startStage: "normalize" | "index" };
const queue: QueueItem[] = [];
const activeControllers = new Map<string, AbortController>();
let draining = false;

export function enqueueDocument(documentId: string, startStage: "normalize" | "index"): void {
  if (!queue.some((item) => item.documentId === documentId)) queue.push({ documentId, startStage });
  if (draining) return;
  draining = true;
  void drain().finally(() => { draining = false; });
}

async function drain(): Promise<void> {
  for (;;) {
    const next = queue.shift();
    if (!next) return;
    await executeDocument(next.documentId, next.startStage).catch(() => undefined);
  }
}

function removeFromQueue(documentId: string): boolean {
  const index = queue.findIndex((item) => item.documentId === documentId);
  if (index < 0) return false;
  queue.splice(index, 1);
  return true;
}

function setStatus(id: string, status: string, error?: string | null): void {
  getConn().prepare("UPDATE knowledge_documents SET status=?, error=?, updated_at=? WHERE id=?")
    .run(status, error == null ? null : String(error).slice(0, 500), nowIso(), id);
}

function finishJob(jobId: string, status: "done" | "failed" | "cancelled", error?: string | null, detail?: Json | null): void {
  getConn().prepare(
    "UPDATE knowledge_document_jobs SET status=?, error=?, detail=?, finished_at=? WHERE id=?",
  ).run(status, error == null ? null : String(error).slice(0, 500), detail ? JSON.stringify(detail) : null, nowIso(), jobId);
}

function updateJobProgress(jobId: string, done: number, total: number, detail?: Json | null): void {
  getConn().prepare(
    "UPDATE knowledge_document_jobs SET progress_done=?, progress_total=?, detail=? WHERE id=?",
  ).run(done, total, detail ? JSON.stringify(detail) : null, jobId);
}

async function executeDocument(documentId: string, startStage: "normalize" | "index"): Promise<void> {
  const initial = docRow(documentId);
  if (["cancelled", "published", "archived"].includes(String(initial.status))) return;
  if (startStage === "normalize") {
    const stage = await runStage(documentId, "normalize");
    if (!stage) return;
  }
  const mid = docRow(documentId);
  if (["cancelled", "published", "archived", "failed"].includes(String(mid.status))) return;
  await runStage(documentId, "index");
}

async function runStage(documentId: string, kind: "normalize" | "index"): Promise<boolean> {
  const conn = getConn();
  const doc = docRow(documentId);
  const actor = String(doc.created_by || "system");
  // 复用入队时已建的 queued 作业行（上传时预建）；重试/对账路径没有预建行，则现建。
  const queued = conn.prepare(
    "SELECT * FROM knowledge_document_jobs WHERE document_id=? AND kind=? AND status='queued' ORDER BY created_at DESC, id DESC LIMIT 1",
  ).get(documentId, kind) as Row | undefined;
  const job = queued ? { ...queued } : insertQueuedJob(conn, documentId, kind, actor);
  const controller = new AbortController();
  activeControllers.set(documentId, controller);
  setStatus(documentId, kind === "normalize" ? "normalizing" : "indexing", null);
  conn.prepare("UPDATE knowledge_document_jobs SET status='running', started_at=? WHERE id=?").run(nowIso(), job.id);
  audit(actor, kind === "normalize" ? "knowledge.document.normalize" : "knowledge.document.index", {
    document_id: documentId, base_id: String(doc.base_id), attempt: Number(job.attempt || 1),
  });
  try {
    if (kind === "normalize") {
      await normalizeStage(doc, String(job.id), controller.signal);
    } else {
      await indexStage(doc, String(job.id), controller.signal);
    }
    if (controller.signal.aborted) throw new HttpFail(409, { code: "knowledge_job_cancelled", message: "作业已取消" });
    finishJob(String(job.id), "done");
    if (kind === "index") {
      setStatus(documentId, "pending_review", null);
      // Scope has its own durable job and failure status; an unavailable model does not undo indexing.
      try {
        const scope=(await postgresQuery('SELECT revision,tenant FROM knowledge_document_scopes WHERE document_id=$1',[documentId]))[0];
        if(scope){const {enqueueScope}=await import('../knowledge/scopes.js');await enqueueScope(actor,String(scope.tenant),documentId,Number(scope.revision));}
      } catch { console.error('[knowledge-scope] scope enqueue failed; indexing complete, retry from document detail'); }
    }
    return true;
  } catch (error) {
    if (controller.signal.aborted || errorCode(error) === "knowledge_job_cancelled") {
      finishJob(String(job.id), "cancelled");
      setStatus(documentId, "cancelled", null);
      return false;
    }
    const message = errorMessage(error);
    finishJob(String(job.id), "failed", message);
    setStatus(documentId, "failed", message);
    return false;
  } finally {
    activeControllers.delete(documentId);
  }
}

/* ---- 规整层 ---- */

function tryExec(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** 文本层检测：优先 pdftotext；工具缺失时用与既有 extractPdfText 同源的粗检。 */
function pdfHasTextLayer(filePath: string, buf: Buffer): boolean {
  const text = tryExec("pdftotext", ["-layout", "-nopgbrk", filePath, "-"]);
  if (text != null && text.replace(/\s+/g, "").length >= 40) return true;
  if (text == null) {
    const latin = buf.toString("latin1");
    const chunks = [...latin.matchAll(/\(([^)]{4,})\)/g)];
    return chunks.length >= 10;
  }
  return false;
}

type VisionRow = { text: string; inputTokens: number | null; outputTokens: number | null };

async function ocrImageWithVision(imagePath: string, pageNo: number, mime = "image/png"): Promise<VisionRow> {
  const key = intentLlmApiKey();
  if (!key) throw new HttpFail(503, { code: "knowledge_index_unavailable", message: "缺少模型凭据：无法进行扫描件 OCR" });
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const data = fs.readFileSync(imagePath).toString("base64");
  const response = await intentLlmFetch()(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: mediaModel(),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `第 ${pageNo} 页。请逐字转写本页文本，保留标题与列表结构；不要总结、不要编造；识别不到文本时只回复「本页无可识别文本」。` },
          { type: "image_url", image_url: { url: `data:${mime};base64,${data}` } },
        ],
      }],
    }),
  });
  if (!response.ok) throw new HttpFail(502, { code: "knowledge_normalize_failed", message: `OCR 调用失败（HTTP ${response.status}）` });
  const payload = (await response.json()) as Json;
  const choices = Array.isArray(payload.choices) ? payload.choices as Json[] : [];
  const message = (choices[0]?.message || {}) as Json;
  const content = typeof message.content === "string" ? message.content : "";
  const usage = (payload.usage || {}) as Json;
  return {
    text: content.trim(),
    inputTokens: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null,
    outputTokens: Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : null,
  };
}

type NormalizeCtx = { dir: string; sourcePath: string; normalized: string; started: string };

function fmtHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** stub 引擎的规整：沿用直拷；音视频可用 STUB_MEDIA_SEGMENTS=N 模拟分段进度。 */
async function stubNormalizeStage(doc: Row, jobId: string, signal: AbortSignal, ctx: NormalizeCtx, buf: Buffer): Promise<void> {
  const { dir, sourcePath, normalized, started } = ctx;
  const delay = Number(process.env.KNOWLEDGE_STUB_NORMALIZE_MS || 0);
  const sleep = async () => {
    if (Number.isFinite(delay) && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  };
  const mediaType = String(doc.media_type || "");
  const segMatch = /STUB_MEDIA_SEGMENTS=(\d+)/.exec(buf.toString("latin1"));
  if ((mediaType === "audio" || mediaType === "video") && segMatch) {
    const total = Math.max(1, parseInt(segMatch[1], 10));
    updateJobProgress(jobId, 0, total, { mode: "media-transcribe" });
    for (let i = 1; i <= total; i += 1) {
      if (signal.aborted) throw new HttpFail(409, { code: "knowledge_job_cancelled", message: "作业已取消" });
      await sleep();
      updateJobProgress(jobId, i, total, { mode: "media-transcribe" });
    }
    const transcriptPath = path.join(dir, "transcript.md");
    fs.writeFileSync(transcriptPath, `# ${doc.title} · 全文转写稿（stub）\n\n共 ${total} 段。\n`);
    const extractedPath = path.join(dir, "extracted.md");
    fs.writeFileSync(extractedPath, `# ${doc.title} · 转写摘要（stub）\n\n共 ${total} 段。\n`);
    const make = await runBridge({ cmd: "make-pdf", args: ["--text", extractedPath, "--out", normalized], signal });
    if (!make.ok) throw new HttpFail(502, { code: String(make.code || "knowledge_normalize_failed"), message: String(make.message || "规整稿生成失败") });
    mergeArtifacts(String(doc.id), {
      normalize: {
        mode: "media-transcribe", model: "stub", segments: total,
        transcript_path: storePath(transcriptPath), extracted_path: storePath(extractedPath),
        normalized_path: storePath(normalized), finished_at: started,
      },
    });
    return;
  }
  await sleep();
  if (signal.aborted) throw new HttpFail(409, { code: "knowledge_job_cancelled", message: "作业已取消" });
  updateJobProgress(jobId, 1, 1, { mode: "stub" });
  fs.copyFileSync(sourcePath, normalized);
  mergeArtifacts(String(doc.id), {
    normalize: { mode: "stub", normalized_path: storePath(normalized), finished_at: started },
  });
}

/** 单图：视觉模型直接 OCR → 文本型 PDF（= scanned-ocr 的单页特例）。 */
async function ocrSingleImageStage(doc: Row, jobId: string, signal: AbortSignal, ctx: NormalizeCtx): Promise<void> {
  const { dir, sourcePath, normalized, started } = ctx;
  updateJobProgress(jobId, 0, 1, { mode: "image-ocr" });
  if (signal.aborted) throw new HttpFail(409, { code: "knowledge_job_cancelled", message: "作业已取消" });
  const mime = String(doc.mime || "");
  const row = await ocrImageWithVision(sourcePath, 1, mime.startsWith("image/") ? mime : "image/png");
  const markdown = `## 图片内容\n\n${row.text || "（本页无可识别文本）"}\n`;
  const extractedPath = path.join(dir, "extracted.md");
  fs.writeFileSync(extractedPath, markdown);
  const make = await runBridge({ cmd: "make-pdf", args: ["--text", extractedPath, "--out", normalized], signal });
  if (!make.ok) throw new HttpFail(502, { code: String(make.code || "knowledge_normalize_failed"), message: String(make.message || "规整稿生成失败") });
  updateJobProgress(jobId, 1, 1, { mode: "image-ocr" });
  const inputTokens = row.inputTokens ?? 0;
  const outputTokens = row.outputTokens ?? 0;
  if (row.inputTokens != null || row.outputTokens != null) {
    recordCostEvent({
      source: "knowledge_normalize",
      userId: String(doc.created_by || "") || undefined,
      model: mediaModel(),
      inputTokens,
      outputTokens,
      raw: JSON.stringify({ mode: "image-ocr" }).slice(0, 500),
    });
  }
  recordCapabilityCall({ kind: "model", ref_id: mediaModel(), ok: true, inputTokens, outputTokens });
  mergeArtifacts(String(doc.id), {
    normalize: {
      mode: "image-ocr", model: mediaModel(), pages: 1,
      extracted_path: storePath(extractedPath),
      normalized_path: storePath(normalized), finished_at: started,
    },
  });
}

type SegmentTranscript = { text: string; summary: string; inputTokens: number | null; outputTokens: number | null };

/** 单段音频转写：转写文本 + 一句话摘要；模型不支持音频输入时给稳定错误码。 */
async function transcribeAudioSegment(segPath: string, segIndex: number, total: number, segmentSeconds: number): Promise<SegmentTranscript> {
  const key = intentLlmApiKey();
  if (!key) throw new HttpFail(503, { code: "knowledge_index_unavailable", message: "缺少模型凭据：无法转写音视频" });
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const data = fs.readFileSync(segPath).toString("base64");
  const response = await intentLlmFetch()(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: mediaModel(),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `这是第 ${segIndex}/${total} 段音频（约 ${segmentSeconds} 秒）。请做两件事：1）逐字转写全部语音内容，不总结、不编造；无语音内容只回复【静音】。2）最后另起一行，以"摘要："开头给出本段一句话摘要。` },
          { type: "input_audio", input_audio: { data, format: "mp3" } },
        ],
      }],
    }),
  });
  if (!response.ok) {
    throw new HttpFail(502, { code: "knowledge_transcribe_unsupported", message: `转写调用失败（HTTP ${response.status}）：模型或网关可能不支持音频输入` });
  }
  const payload = (await response.json()) as Json;
  const choices = Array.isArray(payload.choices) ? payload.choices as Json[] : [];
  const content = String(((choices[0]?.message || {}) as Json).content || "").trim();
  const usage = (payload.usage || {}) as Json;
  let summary = "";
  const bodyLines: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^摘要：(.*)$/);
    if (m) summary = m[1].trim();
    else bodyLines.push(line);
  }
  const text = bodyLines.join("\n").trim();
  return {
    text: text === "【静音】" ? "" : text,
    summary,
    inputTokens: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null,
    outputTokens: Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : null,
  };
}

type SegmentManifest = { fingerprint: string; segment_seconds: number; files: string[] };

/**
 * 音视频转写：ffmpeg 抽音轨切分 → 逐段转写 → transcript.md 留档 →
 * 摘要+全文进文本型 PDF → 复用 indexStage。
 * 进度 = 真实段数；已完成段落缓存可断点续跑；每段之间检查取消。
 */
async function transcribeMediaStage(doc: Row, jobId: string, signal: AbortSignal, ctx: NormalizeCtx): Promise<void> {
  const { dir, sourcePath, normalized, started } = ctx;
  if (!tryExec("ffmpeg", ["-version"])) {
    throw new HttpFail(503, { code: "knowledge_transcribe_unavailable", message: "缺少 ffmpeg：无法切分音视频，请联系管理员安装后重试" });
  }
  const segmentSeconds = Math.max(60, Math.floor(Number(process.env.KNOWLEDGE_MEDIA_SEGMENT_SECONDS || 600)));
  const segmentsDir = path.join(dir, "segments");
  const manifestPath = path.join(segmentsDir, "manifest.json");
  const stat = fs.statSync(sourcePath);
  const fingerprint = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  let manifest: SegmentManifest | null = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as SegmentManifest;
  } catch {
    manifest = null;
  }
  let segFiles: string[];
  if (manifest && manifest.fingerprint === fingerprint && manifest.segment_seconds === segmentSeconds
      && Array.isArray(manifest.files) && manifest.files.length) {
    segFiles = manifest.files.filter((f) => fs.existsSync(path.join(segmentsDir, f)));
  } else {
    segFiles = [];
  }
  if (!segFiles.length) {
    fs.rmSync(segmentsDir, { recursive: true, force: true });
    fs.mkdirSync(segmentsDir, { recursive: true });
    tryExec("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
      "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k",
      "-f", "segment", "-segment_time", String(segmentSeconds),
      path.join(segmentsDir, "seg-%03d.mp3"),
    ]);
    segFiles = fs.readdirSync(segmentsDir).filter((f) => f.endsWith(".mp3")).sort();
    if (!segFiles.length) {
      throw new HttpFail(502, { code: "knowledge_transcribe_failed", message: "音视频切分失败（ffmpeg 未产出分段）" });
    }
    manifest = { fingerprint, segment_seconds: segmentSeconds, files: segFiles };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  }
  const total = segFiles.length;
  updateJobProgress(jobId, 0, total, { mode: "media-transcribe" });
  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let tokensKnown = false;
  const transcripts: string[] = [];
  const summaries: string[] = [];
  for (let i = 0; i < total; i += 1) {
    if (signal.aborted) throw new HttpFail(409, { code: "knowledge_job_cancelled", message: "作业已取消" });
    const segName = segFiles[i];
    const cachePath = path.join(segmentsDir, `${segName}.json`);
    let cached: SegmentTranscript | null = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8")) as SegmentTranscript;
      if (parsed && typeof parsed.text === "string") cached = parsed;
    } catch {
      cached = null;
    }
    if (!cached) {
      cached = await transcribeAudioSegment(path.join(segmentsDir, segName), i + 1, total, segmentSeconds);
      fs.writeFileSync(cachePath, JSON.stringify(cached));
    }
    if (cached.inputTokens != null) { inputTokens += cached.inputTokens; tokensKnown = true; }
    if (cached.outputTokens != null) { outputTokens += cached.outputTokens; tokensKnown = true; }
    transcripts.push(`## [${fmtHMS(i * segmentSeconds)}–${fmtHMS((i + 1) * segmentSeconds)}] 第 ${i + 1}/${total} 段\n\n${cached.text || "【静音】"}`);
    summaries.push(`- 第 ${i + 1} 段：${cached.summary || "（无摘要）"}`);
    updateJobProgress(jobId, i + 1, total, { mode: "media-transcribe" });
  }
  const title = String(doc.title || doc.filename || "音视频资料");
  const header = `> 来源：${doc.filename}；模型：${mediaModel()}；转写时间：${started}`;
  const transcriptPath = path.join(dir, "transcript.md");
  fs.writeFileSync(transcriptPath, `# ${title} · 全文转写稿\n\n${header}\n\n${transcripts.join("\n\n")}\n`);
  const extractedPath = path.join(dir, "extracted.md");
  fs.writeFileSync(extractedPath, `# ${title} · 转写摘要\n\n${header}\n\n## 总摘要\n\n${summaries.join("\n")}\n\n## 分段转写\n\n${transcripts.join("\n\n")}\n`);
  const make = await runBridge({ cmd: "make-pdf", args: ["--text", extractedPath, "--out", normalized], signal });
  if (!make.ok) throw new HttpFail(502, { code: String(make.code || "knowledge_normalize_failed"), message: String(make.message || "规整稿生成失败") });
  if (tokensKnown) {
    recordCostEvent({
      source: "knowledge_normalize",
      userId: String(doc.created_by || "") || undefined,
      model: mediaModel(),
      inputTokens,
      outputTokens,
      raw: JSON.stringify({ segments: total }).slice(0, 500),
    });
  }
  recordCapabilityCall({
    kind: "model", ref_id: mediaModel(), ok: true,
    latencyMs: Date.now() - startedAt,
    inputTokens: tokensKnown ? inputTokens : null,
    outputTokens: tokensKnown ? outputTokens : null,
  });
  mergeArtifacts(String(doc.id), {
    normalize: {
      mode: "media-transcribe", model: mediaModel(), segments: total, segment_seconds: segmentSeconds,
      transcript_path: storePath(transcriptPath), extracted_path: storePath(extractedPath),
      normalized_path: storePath(normalized), finished_at: started,
    },
  });
}

async function normalizeStage(doc: Row, jobId: string, signal: AbortSignal): Promise<void> {
  const dir = docDirOf(doc);
  const sourcePath = resolveStorePath(String(doc.source_path || ""));
  const normalized = normalizedPathOf(doc);
  const buf = fs.readFileSync(sourcePath);
  if (buf.subarray(0, 4096).includes("STUB_FAIL_NORMALIZE")) {
    throw new HttpFail(502, { code: "knowledge_normalize_failed", message: "stub：规整失败（测试标记）" });
  }
  const started = nowIso();
  const ctx: NormalizeCtx = { dir, sourcePath, normalized, started };
  if (bridgeMode() === "stub") {
    await stubNormalizeStage(doc, jobId, signal, ctx, buf);
    return;
  }
  const mediaType = String(doc.media_type || "");
  if (mediaType === "audio" || mediaType === "video") {
    await transcribeMediaStage(doc, jobId, signal, ctx);
    return;
  }
  if (mediaType === "image") {
    await ocrSingleImageStage(doc, jobId, signal, ctx);
    return;
  }
  if (pdfHasTextLayer(sourcePath, buf)) {
    updateJobProgress(jobId, 1, 1, { mode: "text-passthrough" });
    fs.copyFileSync(sourcePath, normalized);
    mergeArtifacts(String(doc.id), {
      normalize: { mode: "text-passthrough", normalized_path: storePath(normalized), finished_at: started },
    });
    return;
  }
  // 扫描件：逐页渲染 → 视觉模型 OCR → 文本型 PDF（真实进度 = 页数）。
  const pagesDir = path.join(dir, "pages");
  const render = await runBridge({ cmd: "render", args: ["--input", sourcePath, "--out", pagesDir], signal });
  if (!render.ok) throw new HttpFail(502, { code: String(render.code || "knowledge_normalize_failed"), message: String(render.message || "页面渲染失败") });
  const pages = Math.max(1, Number(render.pages || 0));
  updateJobProgress(jobId, 0, pages, { mode: "scanned-ocr" });
  const parts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let tokensKnown = false;
  for (let pageNo = 1; pageNo <= pages; pageNo += 1) {
    if (signal.aborted) throw new HttpFail(409, { code: "knowledge_job_cancelled", message: "作业已取消" });
    const imagePath = path.join(pagesDir, `page-${pageNo}.png`);
    if (!fs.existsSync(imagePath)) continue;
    const row = await ocrImageWithVision(imagePath, pageNo);
    if (row.inputTokens != null) { inputTokens += row.inputTokens; tokensKnown = true; }
    if (row.outputTokens != null) { outputTokens += row.outputTokens; tokensKnown = true; }
    parts.push(`## 第 ${pageNo} 页\n\n${row.text || "（本页无可识别文本）"}`);
    updateJobProgress(jobId, pageNo, pages, { mode: "scanned-ocr" });
  }
  const markdown = parts.join("\n\n");
  const extractedPath = path.join(dir, "extracted.md");
  fs.writeFileSync(extractedPath, markdown);
  const make = await runBridge({ cmd: "make-pdf", args: ["--text", extractedPath, "--out", normalized], signal });
  if (!make.ok) throw new HttpFail(502, { code: String(make.code || "knowledge_normalize_failed"), message: String(make.message || "规整稿生成失败") });
  if (tokensKnown) {
    recordCostEvent({
      source: "knowledge_normalize",
      userId: String(doc.created_by || "") || undefined,
      model: mediaModel(),
      inputTokens,
      outputTokens,
      raw: JSON.stringify({ pages }).slice(0, 500),
    });
  }
  recordCapabilityCall({
    kind: "model", ref_id: mediaModel(), ok: true,
    inputTokens: tokensKnown ? inputTokens : null,
    outputTokens: tokensKnown ? outputTokens : null,
  });
  mergeArtifacts(String(doc.id), {
    normalize: {
      mode: "scanned-ocr",
      page_map: make.page_map,
      model: mediaModel(),
      pages,
      extracted_path: storePath(extractedPath),
      normalized_path: storePath(normalized),
      finished_at: started,
    },
  });
}

/* ---- 索引层 ---- */

async function indexStage(doc: Row, jobId: string, signal: AbortSignal): Promise<void> {
  const normalized = normalizedPathOf(doc);
  if (!fs.existsSync(normalized)) {
    // 规整稿缺失（人工清理/异常）：回到规整阶段重跑。
    throw new HttpFail(409, { code: "knowledge_normalized_missing", message: "规整稿缺失，请重新加工" });
  }
  updateJobProgress(jobId, 0, 0, { note: "建索引（无细分进度）" });
  const library = libraryDir(String(doc.base_id));
  const outcome = await runBridge({
    cmd: "index",
    args: ["--input", normalized, "--library", library, "--index-model", indexModel()],
    signal,
  });
  if (!outcome.ok) {
    throw new HttpFail(502, { code: String(outcome.code || "knowledge_index_failed"), message: String(outcome.message || "索引失败") });
  }
  const indexInfo = {
    engine: "pageindex",
    engine_version: String(outcome.pageindex || process.env.KNOWLEDGE_ENGINE_VERSION || "unknown"),
    doc_id: String(outcome.doc_id || ""),
    library: storePath(library),
    pages: Number(outcome.pages || 0),
    finished_at: nowIso(),
  };
  mergeArtifacts(String(doc.id), { index: indexInfo });
  const usage = outcome.usage as Json | undefined;
  if (usage) {
    recordCostEvent({
      source: "knowledge_index",
      userId: String(doc.created_by || "") || undefined,
      model: indexModel(),
      inputTokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
      outputTokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
      raw: JSON.stringify(usage).slice(0, 500),
    });
  }
  recordCapabilityCall({
    kind: "model",
    ref_id: indexModel(),
    ok: true,
    inputTokens: usage && Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
    outputTokens: usage && Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
  });
  // 库级引擎绑定（external_ref 单值，写入一次）。
  const base = getConn().prepare("SELECT external_ref FROM knowledge_bases WHERE id=?").get(String(doc.base_id)) as Row | undefined;
  const hasRef = base?.external_ref != null && String(base.external_ref) !== "" && String(base.external_ref) !== "null";
  if (!hasRef) {
    getConn().prepare("UPDATE knowledge_bases SET external_ref=?, updated_at=? WHERE id=?")
      .run(JSON.stringify({ provider: "pageindex-local", version: indexInfo.engine_version }), nowIso(), String(doc.base_id));
  }
}

/* ---- 动作 ---- */

function jobCount(documentId: string): number {
  const row = getConn().prepare("SELECT COUNT(*) AS n FROM knowledge_document_jobs WHERE document_id=?").get(documentId) as { n: number };
  return Number(row.n || 0);
}

export function retryDocument(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const doc = docRow(id);
  const status = String(doc.status);
  if (!["failed", "cancelled"].includes(status)) {
    throw new HttpFail(409, { code: "knowledge_document_not_retryable", message: "只有失败或已取消的资料可以重试" });
  }
  const last = latestJobOf(id);
  let startStage: "normalize" | "index" = "normalize";
  if (last && String(last.kind) === "index") startStage = "index";
  if (startStage === "index" && !fs.existsSync(normalizedPathOf(doc))) startStage = "normalize";
  tx((db) => {
    db.prepare("UPDATE knowledge_documents SET status='uploaded', error=NULL, retry_count=retry_count+1, updated_at=? WHERE id=?")
      .run(nowIso(), id);
    db.prepare("UPDATE knowledge_document_jobs SET status='cancelled', finished_at=? WHERE document_id=? AND status='queued'")
      .run(nowIso(), id);
  });
  audit(actor, "knowledge.document.retry", { document_id: id, from_stage: startStage });
  enqueueDocument(id, startStage);
  return { document: documentView(docRow(id), { latestJob: latestJobOf(id) }) };
}

export function cancelDocument(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const doc = docRow(id);
  const status = String(doc.status);
  if (!["uploaded", "normalizing", "indexing"].includes(status)) {
    throw new HttpFail(409, { code: "knowledge_document_not_cancellable", message: "只有排队或加工中的资料可以取消" });
  }
  removeFromQueue(id);
  const controller = activeControllers.get(id);
  if (controller) {
    controller.abort();
  } else {
    tx((db) => {
      db.prepare("UPDATE knowledge_document_jobs SET status='cancelled', finished_at=? WHERE document_id=? AND status='queued'")
        .run(nowIso(), id);
      db.prepare("UPDATE knowledge_documents SET status='cancelled', updated_at=? WHERE id=?").run(nowIso(), id);
    });
  }
  audit(actor, "knowledge.document.cancel", { document_id: id });
  return { document: documentView(docRow(id), { latestJob: latestJobOf(id) }) };
}

export function reprocessDocument(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const doc = docRow(id);
  const status = String(doc.status);
  if(status === "published") throw new HttpFail(409,{code:"knowledge_revision_required",message:"已发布版本保持可检索，请从资料详情创建新版本草稿。"});
  if (!["pending_review", "published"].includes(status)) {
    throw new HttpFail(409, { code: "knowledge_document_not_reprocessable", message: "只有待审或已发布的资料可以重新加工" });
  }
  tx((db) => {
    db.prepare("UPDATE knowledge_documents SET status='uploaded', error=NULL, updated_at=? WHERE id=?").run(nowIso(), id);
  });
  audit(actor, "knowledge.document.retry", { document_id: id, from_stage: "normalize", reprocess: true });
  enqueueDocument(id, "normalize");
  return { document: documentView(docRow(id), { latestJob: latestJobOf(id) }) };
}

export function publishDocument(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  docRow(id);
  throw new HttpFail(409, { code: "knowledge_publication_review_required", message: "请从资料详情提交知识发布审批；批准后由发布任务生效。" });
}

export function archiveDocument(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const doc = docRow(id);
  if (String(doc.status) !== "published") {
    throw new HttpFail(409, { code: "knowledge_document_not_archivable", message: "只有已发布资料可以归档" });
  }
  getConn().prepare("UPDATE knowledge_documents SET status='archived', updated_at=? WHERE id=?").run(nowIso(), id);
  audit(actor, "knowledge.document.archive", { document_id: id, base_id: String(doc.base_id) });
  return { document: documentView(docRow(id), { latestJob: latestJobOf(id) }) };
}

export function deleteDocument(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const doc = docRow(id);
  const status = String(doc.status);
  if (["normalizing", "indexing"].includes(status)) {
    throw new HttpFail(409, { code: "knowledge_document_busy", message: "资料正在加工，请先取消再删除" });
  }
  if (["published", "archived"].includes(status)) {
    throw new HttpFail(409, { code: "knowledge_document_published", message: "已发布过的资料只能归档，不能删除" });
  }
  const engineDocId = engineDocIdOf(doc);
  const library = libraryDir(String(doc.base_id));
  removeFromQueue(id);
  tx((db) => {
    db.prepare("DELETE FROM knowledge_document_jobs WHERE document_id=?").run(id);
    db.prepare("DELETE FROM knowledge_documents WHERE id=?").run(id);
  });
  if (engineDocId) {
    void runBridge({ cmd: "remove", args: ["--library", library, "--doc-id", engineDocId], timeoutMs: 60_000 }).catch(() => undefined);
  }
  fs.rmSync(docDirOf(doc), { recursive: true, force: true });
  audit(actor, "knowledge.document.delete", { document_id: id, base_id: String(doc.base_id) });
  return { deleted: true, document_id: id };
}

export function documentSourceFile(id: string): { path: string; name: string; mime: string } {
  requireAdmin();
  return sourceFileRef(docRow(id));
}

export function publishedDocumentSourceFile(id: string, allowedBaseIds: string[]): { path: string; name: string; mime: string } {
  const doc = docRow(id);
  if (doc.status !== "published" || !allowedBaseIds.includes(String(doc.base_id))) throw new HttpFail(403, "资料不在当前技能的已发布范围内");
  return sourceFileRef(doc);
}

function sourceFileRef(doc: Row): { path: string; name: string; mime: string } {
  const file = resolveStorePath(String(doc.source_path || ""));
  if (!fs.existsSync(file)) throw new HttpFail(404, "原文件不存在");
  return {
    path: file,
    name: String(doc.filename || "source.pdf"),
    mime: "application/pdf",
  };
}

/* ---- 检索（管理端试算） ---- */

function skipCountsFromUsage(usage: Json | null): Json | null {
  if (!usage) return null;
  return {
    input_tokens: Number.isFinite(Number(usage.input_tokens ?? usage.prompt_tokens)) ? Number(usage.input_tokens ?? usage.prompt_tokens) : null,
    output_tokens: Number.isFinite(Number(usage.output_tokens ?? usage.completion_tokens)) ? Number(usage.output_tokens ?? usage.completion_tokens) : null,
  };
}

export async function searchDocuments(input: {
  query?: string;
  base_id?: string;
  doc_ids?: unknown;
  include_pending?: unknown;
}): Promise<Json> {
  requireAdmin();
  return queryDocuments(input, knowledgeActorId());
}

/** Internal retrieval service. Callers must authorize scope before dispatch and again before returning. */
export async function queryDocuments(input: {
  query?: string; base_id?: string; doc_ids?: unknown; include_pending?: unknown;
}, actor: string, revalidate: () => void = () => {}): Promise<Json> {
  const query = String(input.query || "").trim();
  if (!query) throw new HttpFail(400, "query required");
  const baseId = String(input.base_id || "").trim();
  const base = getConn().prepare("SELECT * FROM knowledge_bases WHERE id=?").get(baseId) as Row | undefined;
  if (!base) throw new HttpFail(400, { code: "knowledge_base_missing", message: "知识库不存在" });
  if (base.status !== "active") throw new HttpFail(409, { code: "knowledge_base_archived", message: "知识库已归档" });
  if (String(base.kind) !== "unstructured") {
    throw new HttpFail(400, { code: "knowledge_base_not_unstructured", message: "只有非结构化库支持资料检索" });
  }
  const includePending = Boolean(input.include_pending);
  const docIds = Array.isArray(input.doc_ids) ? input.doc_ids.map(String).filter(Boolean) : [];
  let docs: Row[];
  if (includePending) {
    if (docIds.length !== 1) {
      throw new HttpFail(400, { code: "knowledge_pending_scope", message: "审批试算只允许单份资料" });
    }
    docs = getConn().prepare(
      "SELECT * FROM knowledge_documents WHERE id=? AND base_id=? AND status IN ('pending_review','published')",
    ).all(docIds[0], baseId) as Row[];
    if (!docs.length) throw new HttpFail(404, { code: "knowledge_document_missing", message: "待审资料不存在" });
  } else {
    const clauses = ["base_id=?", "status='published'"];
    const args: unknown[] = [baseId];
    if (docIds.length) {
      clauses.push(`id IN (${docIds.map(() => "?").join(",")})`);
      args.push(...docIds);
    }
    docs = getConn().prepare(`SELECT * FROM knowledge_documents WHERE ${clauses.join(" AND ")}`).all(...args) as Row[];
    if (!docs.length) {
      const states=await postgresQuery(`SELECT d.status,p.review_status,p.publication_status FROM knowledge_documents d
        LEFT JOIN knowledge_publications p ON p.document_id=d.id WHERE d.base_id=$1
        AND ($2::text[] IS NULL OR d.id=ANY($2::text[]))`,[baseId,docIds.length ? docIds : null]);
      let reason="这个库还没有已发布的资料，请联系知识库管理员补充资料并提交发布审批。";
      if(states.some(d=>d.review_status==="approved")) reason="资料已通过审批，发布尚未完成，请联系知识库管理员查看发布任务与恢复入口。";
      else if(states.some(d=>["reviewing","awaiting_amendment","blocked"].includes(d.review_status))) reason="资料已解析，正在等待审批完成与发布；未发布资料暂不可用于产品咨询。";
      else if(states.some(d=>d.status==="pending_review")) reason="资料已解析并建立索引，但尚未完成发布审批；请联系知识库管理员从资料详情提交审批。";
      else if(states.some(d=>["uploaded","normalizing","indexing"].includes(d.status))) reason="资料正在解析或建立索引，完成后还需提交审批并发布。";
      else if(states.some(d=>d.status==="draft")) reason="资料仍是未解析草稿，需要管理员解析、提交审批并发布后才能查询。";
      else if(states.some(d=>["failed","cancelled"].includes(d.status))) reason="资料解析失败或已取消，请联系知识库管理员恢复处理，再提交审批与发布。";
      throw new HttpFail(409, { code: "knowledge_no_published_documents", message:reason });
    }
  }
  const engineIds = docs.map(engineDocIdOf).filter(Boolean);
  if (!engineIds.length) {
    throw new HttpFail(409, { code: "knowledge_not_indexed", message: "所选资料还没有完成索引" });
  }
  const args = ["--library", libraryDir(baseId), "--question", query, "--chat-model", chatModel(), "--citations"];
  for (const engineId of engineIds) args.push("--doc-id", engineId);
  const outcome: BridgeOutcome = await runBridge({ cmd: "ask", args, timeoutMs: 10 * 60_000 });
  revalidate();
  for (const doc of docs) {
    const current = docRow(String(doc.id));
    if (current.status !== doc.status || current.updated_at !== doc.updated_at || engineDocIdOf(current) !== engineDocIdOf(doc)) {
      throw new HttpFail(409, { code: "knowledge_document_changed", message: "资料已变更，请重新查询" });
    }
  }
  if (!outcome.ok) {
    throw new HttpFail(outcome.code === "knowledge_ask_failed" ? 502 : 503, {
      code: String(outcome.code || "knowledge_ask_failed"),
      message: String(outcome.message || "试算失败"),
    });
  }
  const byEngineId = new Map(docs.map((doc) => [engineDocIdOf(doc), doc]));
  const rawCitations = Array.isArray(outcome.citations) ? outcome.citations as Json[] : [];
  const citations = rawCitations.map((item) => {
    const engineDocId = String(item.doc_id || "");
    const doc = byEngineId.get(engineDocId);
    const page = Number(item.page || 0);
    if (!doc || !Number.isInteger(page) || page < 1) {
      throw new HttpFail(502, { code: "knowledge_invalid_citation", message: "检索引用不属于本次资料范围" });
    }
    const normalize = artifactsOf(doc).normalize as Json | undefined;
    const pageMap = normalize?.page_map as Json | undefined;
    const sourcePage = normalize?.mode === "scanned-ocr" ? Number(pageMap?.[String(page)]) : page;
    if (!Number.isInteger(sourcePage) || sourcePage < 1) throw new HttpFail(502, { code: "knowledge_invalid_citation", message: "缺少原件页码映射，请重新解析资料" });
    return {
      document: String(item.document || ""),
      engine_doc_id: engineDocId,
      page: sourcePage,
      document_id: doc ? String(doc.id) : null,
      title: doc ? String(doc.title) : "",
    };
  });
  if (!rawCitations.length) throw new HttpFail(502, { code: "knowledge_missing_citations", message: "引擎未返回可验证引用，请重试或检查原文" });
  const usage = (outcome.usage || null) as Json | null;
  audit(actor, "knowledge.search", {
    base_id: baseId,
    doc_ids: docs.map((doc) => String(doc.id)),
    include_pending: includePending,
  });
  if (usage) {
    recordCostEvent({
      source: "knowledge_search",
      userId: actor,
      model: chatModel(),
      inputTokens: skipCountsFromUsage(usage)?.input_tokens as number | null,
      outputTokens: skipCountsFromUsage(usage)?.output_tokens as number | null,
      raw: JSON.stringify(usage).slice(0, 2000),
    });
  }
  recordCapabilityCall({
    kind: "model",
    ref_id: chatModel(),
    ok: true,
    inputTokens: usage ? (skipCountsFromUsage(usage)?.input_tokens as number | null) ?? null : null,
    outputTokens: usage ? (skipCountsFromUsage(usage)?.output_tokens as number | null) ?? null : null,
  });
  return {
    answer: String(outcome.answer || ""),
    citations,
    usage,
    engine: { mode: bridgeMode(), model: chatModel() },
    scope: {
      base_id: baseId,
      include_pending: includePending,
      documents: docs.map((doc) => ({ id: String(doc.id), title: String(doc.title), status: String(doc.status) })),
    },
  };
}

/* ---- 健康与对账 ---- */

export async function documentIndexHealth(): Promise<Json> {
  requireAdmin();
  try {
    const outcome = await runBridge({ cmd: "ping", args: [], timeoutMs: 20_000 });
    if (!outcome.ok) {
      return { ok: false, mode: bridgeMode(), code: String(outcome.code || "knowledge_index_unavailable"), message: String(outcome.message || "侧车不可用") };
    }
    return { ok: true, mode: bridgeMode(), python: String(outcome.python || ""), pageindex: String(outcome.pageindex || "") };
  } catch (error) {
    return { ok: false, mode: bridgeMode(), code: errorCode(error), message: errorMessage(error) };
  }
}

/** 启动对账：running 作业 → failed(interrupted)；queued 作业重新入队。 */
export function reconcileDocumentJobs(): void {
  const conn = getConn();
  const now = nowIso();
  const running = conn.prepare("SELECT * FROM knowledge_document_jobs WHERE status='running'").all() as Row[];
  for (const job of running) {
    conn.prepare("UPDATE knowledge_document_jobs SET status='failed', error='interrupted', finished_at=? WHERE id=?").run(now, job.id);
    conn.prepare("UPDATE knowledge_documents SET status='failed', error='服务重启中断，可重试', updated_at=? WHERE id=?")
      .run(now, job.document_id);
  }
  const queued = conn.prepare("SELECT DISTINCT document_id FROM knowledge_document_jobs WHERE status='queued'").all() as Row[];
  for (const row of queued) {
    const documentId = String(row.document_id);
    const doc = conn.prepare("SELECT status FROM knowledge_documents WHERE id=?").get(documentId) as Row | undefined;
    if (!doc || ["published", "archived"].includes(String(doc.status))) continue;
    enqueueDocument(documentId, "normalize");
  }
}
