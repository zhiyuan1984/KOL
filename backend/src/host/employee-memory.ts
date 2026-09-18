import { createHash } from "node:crypto";
import { getConn, nowIso, onConnReset, tx } from "../db.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";
import { mergeMemoryItems, type MemoryFamily, type MemoryLayer } from "./memory-increment.js";

export type EmployeeMemoryKind =
  | "task_raw"
  | "task_display"
  | "summary_raw"
  | "summary_display";

export function memoryKindOf(family: MemoryFamily, layer: MemoryLayer): EmployeeMemoryKind {
  return `${family}_${layer}` as EmployeeMemoryKind;
}

export type StoredMemoryItem = {
  id: string;
  owner_user_id: string;
  memory_kind: EmployeeMemoryKind;
  item_key: string;
  payload: Json;
  content_hash: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

let ensured = false;

onConnReset(() => {
  ensured = false;
});

export function ensureEmployeeMemoriesTable(): void {
  if (ensured) return;
  getConn().exec(`
    CREATE TABLE IF NOT EXISTS employee_memory_items (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      memory_kind TEXT NOT NULL,
      item_key TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_user_id, memory_kind, item_key)
    );
    CREATE INDEX IF NOT EXISTS idx_employee_memory_items_kind
      ON employee_memory_items(owner_user_id, memory_kind);
  `);
  ensured = true;
}

function hashPayload(payload: Json): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null), "utf8").digest("hex");
}

function parsePayload(raw: string): Json {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Json : {};
  } catch {
    return {};
  }
}

function mapRow(row: {
  id: string;
  owner_user_id: string;
  memory_kind: string;
  item_key: string;
  payload: string;
  content_hash: string;
  revision: number;
  created_at: string;
  updated_at: string;
}): StoredMemoryItem {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    memory_kind: row.memory_kind as EmployeeMemoryKind,
    item_key: row.item_key,
    payload: parsePayload(row.payload),
    content_hash: row.content_hash,
    revision: Number(row.revision || 1),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listMemories(input: {
  owner: string;
  memory_kind: EmployeeMemoryKind;
  q?: string;
  limit?: number;
}): StoredMemoryItem[] {
  ensureEmployeeMemoriesTable();
  const limit = Math.min(Math.max(Number(input.limit || 200), 1), 500);
  const rows = getConn().prepare(
    `SELECT * FROM employee_memory_items
      WHERE owner_user_id=? AND memory_kind=?
      ORDER BY updated_at DESC, item_key ASC
      LIMIT ?`,
  ).all(input.owner, input.memory_kind, limit) as Array<{
    id: string;
    owner_user_id: string;
    memory_kind: string;
    item_key: string;
    payload: string;
    content_hash: string;
    revision: number;
    created_at: string;
    updated_at: string;
  }>;
  const mapped = rows.map(mapRow);
  const needle = String(input.q || "").trim().toLowerCase();
  if (!needle) return mapped;
  return mapped.filter((row) => `${row.item_key} ${JSON.stringify(row.payload)}`.toLowerCase().includes(needle));
}

export function persistIncrement(input: {
  owner: string;
  family: MemoryFamily;
  layer: MemoryLayer;
  incoming: Array<{ item_key: string; payload: Json }>;
  removedKeys?: string[];
}): {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
} {
  ensureEmployeeMemoriesTable();
  const kind = memoryKindOf(input.family, input.layer);
  const previous = listMemories({ owner: input.owner, memory_kind: kind }).map((row) => ({
    item_key: row.item_key,
    payload: row.payload,
  }));
  const merged = mergeMemoryItems(previous, input.incoming, input.removedKeys || []);
  const now = nowIso();
  tx((db) => {
    const read = db.prepare(
      `SELECT id, content_hash, revision FROM employee_memory_items
        WHERE owner_user_id=? AND memory_kind=? AND item_key=?`,
    );
    const insert = db.prepare(
      `INSERT INTO employee_memory_items
       (id, owner_user_id, memory_kind, item_key, payload, content_hash, revision, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    const update = db.prepare(
      `UPDATE employee_memory_items
          SET payload=?, content_hash=?, revision=?, updated_at=?
        WHERE id=?`,
    );
    const remove = db.prepare(
      `DELETE FROM employee_memory_items
        WHERE owner_user_id=? AND memory_kind=? AND item_key=?`,
    );
    for (const key of merged.increment.removed) {
      remove.run(input.owner, kind, key);
    }
    for (const item of merged.items) {
      if (merged.increment.unchanged.includes(item.item_key)) continue;
      const hash = hashPayload(item.payload as Json);
      const existing = read.get(input.owner, kind, item.item_key) as
        | { id: string; content_hash: string; revision: number }
        | undefined;
      if (!existing) {
        insert.run(nid("mem"), input.owner, kind, item.item_key, JSON.stringify(item.payload), hash, 1, now, now);
        continue;
      }
      if (existing.content_hash === hash) continue;
      update.run(JSON.stringify(item.payload), hash, Number(existing.revision || 1) + 1, now, existing.id);
    }
  });
  return merged.increment;
}
