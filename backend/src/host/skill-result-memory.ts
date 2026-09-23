import { createHash } from "node:crypto";
import { getConn, nowIso, tx } from "../db.js";
import type { Json } from "../types.js";
import { HttpFail } from "./errors.js";
import { ensureEmployeeMemoriesTable } from "./employee-memory.js";

const SECRET_KEY = /(?:^|[_-])(authorization|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|credential|cookie|session[_-]?key)(?:$|[_-])/i;
const SECRET_VALUE = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/i;
const SECRET_COMPACT_KEY = /^(?:authorization|password|passwd|secret|apikey|accesstoken|refreshtoken|idtoken|credential|cookie|sessionkey)$/i;

/** Fail closed before memory persistence. Skill schemas control shape, not permission to
 * retain credentials; reject the entire summary instead of silently redacting evidence. */
export function isSafeSkillResultForMemory(value: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (typeof value === "string") return !SECRET_VALUE.test(value);
  if (Array.isArray(value)) return value.every((item) => isSafeSkillResultForMemory(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).every(([key, item]) =>
      !SECRET_KEY.test(key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`))
      && !SECRET_COMPACT_KEY.test(key.replace(/[^a-z]/gi, ""))
      && isSafeSkillResultForMemory(item, depth + 1));
  }
  return value === null || typeof value === "number" || typeof value === "boolean";
}

/** Stores a pointer and validated display summary; domain rows remain authoritative. */
export function persistValidatedSkillResult(input: {
  owner: string;
  skillId: string;
  runId: string;
  sourceVersion: string;
  staleRefs?: string[];
  summary: Json;
}): void {
  if (!input.owner || !input.skillId || !input.runId) return;
  if (!isSafeSkillResultForMemory(input.summary)) throw new HttpFail(422, "skill result contains credential-like material");
  ensureEmployeeMemoriesTable();
  const now = nowIso();
  const kind = "skill_result";
  const key = `${input.skillId}:${input.runId}`;
  const payload: Json = {
    skill_id: input.skillId,
    skill_version: input.sourceVersion,
    run_id: input.runId,
    owner_user_id: input.owner,
    visibility: "owner",
    validity: "current",
    stale_refs: input.staleRefs || [],
    summary: input.summary,
  };
  const serialized = JSON.stringify(payload);
  const hash = createHash("sha256").update(serialized, "utf8").digest("hex");
  tx((db) => {
    const prefix = `${input.skillId}:`;
    const prior = db.prepare(
      "SELECT id,payload FROM employee_memory_items WHERE owner_user_id=? AND memory_kind=? AND substr(item_key,1,?)=?",
    ).all(input.owner, kind, prefix.length, prefix) as Array<{ id: string; payload: string }>;
    for (const row of prior) {
      let old: Record<string, unknown> = {};
      try { old = JSON.parse(row.payload) as Record<string, unknown>; } catch { /* malformed legacy row */ }
      if (old.run_id === input.runId || old.validity !== "current") continue;
      const stale: Json = { ...(old as Record<string, Json>), validity: "stale", stale_reason: `superseded_by:${input.runId}`, invalidated_at: now };
      const raw = JSON.stringify(stale);
      const staleHash = createHash("sha256").update(raw, "utf8").digest("hex");
      db.prepare("UPDATE employee_memory_items SET payload=?,content_hash=?,revision=revision+1,updated_at=? WHERE id=?")
        .run(raw, staleHash, now, row.id);
    }
    const existing = db.prepare(
      "SELECT id,content_hash,revision FROM employee_memory_items WHERE owner_user_id=? AND memory_kind=? AND item_key=?",
    ).get(input.owner, kind, key) as { id: string; content_hash: string; revision: number } | undefined;
    if (!existing) {
      db.prepare(
        `INSERT INTO employee_memory_items
         (id,owner_user_id,memory_kind,item_key,payload,content_hash,revision,created_at,updated_at)
         VALUES (?,?,?,?,?,?,1,?,?)`,
      ).run(`mem_${input.runId}`, input.owner, kind, key, serialized, hash, now, now);
    } else if (existing.content_hash !== hash) {
      db.prepare("UPDATE employee_memory_items SET payload=?,content_hash=?,revision=?,updated_at=? WHERE id=?")
        .run(serialized, hash, Number(existing.revision || 1) + 1, now, existing.id);
    }
  });
}

export function skillResultMemoryStatus(owner: string, skillId: string, runId: string): string | null {
  if (!owner || !skillId || !runId) return null;
  ensureEmployeeMemoriesTable();
  const row = getConn().prepare(
    "SELECT payload FROM employee_memory_items WHERE owner_user_id=? AND memory_kind='skill_result' AND item_key=?",
  ).get(owner, `${skillId}:${runId}`) as { payload?: string } | undefined;
  if (!row?.payload) return null;
  try {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    return typeof payload.validity === "string" ? payload.validity : null;
  } catch {
    return null;
  }
}

export type SkillResultMemoryView = {
  id: string;
  skill_id: string;
  skill_version: string;
  run_id: string;
  validity: "current" | "stale";
  summary: Json;
  created_at: string;
  updated_at: string;
};

export function listSkillResultMemories(input: {
  owner: string;
  skillId: string;
  limit?: number;
  cursor?: string;
}): { items: SkillResultMemoryView[]; next_cursor: string | null } {
  if (!input.owner || !input.skillId) return { items: [], next_cursor: null };
  ensureEmployeeMemoriesTable();
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit || 20)), 1), 50);
  let before: { updated_at: string; id: string } | null = null;
  if (input.cursor) {
    if (input.cursor.length > 512) throw new HttpFail(400, "invalid skill memory cursor");
    try {
      const decoded = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as Record<string, unknown>;
      if (typeof decoded.updated_at !== "string" || typeof decoded.id !== "string") throw new Error("invalid cursor");
      before = { updated_at: decoded.updated_at, id: decoded.id };
    } catch {
      throw new HttpFail(400, "invalid skill memory cursor");
    }
  }
  const prefix = `${input.skillId}:`;
  const rows = (before
    ? getConn().prepare(
      `SELECT id,item_key,payload,created_at,updated_at FROM employee_memory_items
        WHERE owner_user_id=? AND memory_kind='skill_result' AND substr(item_key,1,?)=?
          AND (updated_at<? OR (updated_at=? AND id<?))
        ORDER BY updated_at DESC,id DESC LIMIT ?`,
    ).all(input.owner, prefix.length, prefix, before.updated_at, before.updated_at, before.id, limit + 1)
    : getConn().prepare(
      `SELECT id,item_key,payload,created_at,updated_at FROM employee_memory_items
        WHERE owner_user_id=? AND memory_kind='skill_result' AND substr(item_key,1,?)=?
        ORDER BY updated_at DESC,id DESC LIMIT ?`,
    ).all(input.owner, prefix.length, prefix, limit + 1)) as Array<{
      id: string; item_key: string; payload: string; created_at: string; updated_at: string;
    }>;
  const page = rows.slice(0, limit);
  const items = page.flatMap((row): SkillResultMemoryView[] => {
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (payload.skill_id !== input.skillId || (payload.validity !== "current" && payload.validity !== "stale")) return [];
      return [{
        id: row.id,
        skill_id: input.skillId,
        skill_version: String(payload.skill_version || "unversioned"),
        run_id: String(payload.run_id || ""),
        validity: payload.validity,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary as Json : {},
        created_at: row.created_at,
        updated_at: row.updated_at,
      }];
    } catch {
      return [];
    }
  });
  const last = rows.length > limit ? page[page.length - 1] : undefined;
  const nextCursor = last
    ? Buffer.from(JSON.stringify({ updated_at: last.updated_at, id: last.id }), "utf8").toString("base64url")
    : null;
  return { items, next_cursor: nextCursor };
}
