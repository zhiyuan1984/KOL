import { createHash } from "node:crypto";
import { postgresDb, nowIso, pgTransaction } from "../postgres/access.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";
import { mergeMemoryItems, type MemoryFamily, type MemoryLayer } from "./memory-increment.js";
export type EmployeeMemoryKind = "task_raw" | "task_display" | "summary_raw" | "summary_display" | "todo_raw" | "todo_display" | "skill_result";
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
export async function ensureEmployeeMemoriesTable(): Promise<void> {
  // `employee_memory_items` belongs to the PostgreSQL baseline/migration set.
  // Keep this exported compatibility hook, but never create application schema
  // lazily during a request.
}
function hashPayload(payload: Json): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null), "utf8").digest("hex");
}

function parsePayload(raw: string): Json {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Json : {};
  }
  catch {
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
export async function listMemories(input: {
  owner: string;
  memory_kind: EmployeeMemoryKind;
  q?: string;
  limit?: number;
}): Promise<StoredMemoryItem[]> {
  (await ensureEmployeeMemoriesTable());
  const limit = Math.min(Math.max(Number(input.limit || 200), 1), 500);
  const rows = (await postgresDb().many(`SELECT * FROM employee_memory_items
      WHERE owner_user_id=$1 AND memory_kind=$2
      ORDER BY updated_at DESC, item_key ASC
      LIMIT $3`, input.owner, input.memory_kind, limit)) as Array<{
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
  if (!needle)
    return mapped;
  return mapped.filter((row) => `${row.item_key} ${JSON.stringify(row.payload)}`.toLowerCase().includes(needle));
}
export async function persistIncrement(input: {
  owner: string;
  family: MemoryFamily;
  layer: MemoryLayer;
  incoming: Array<{
    item_key: string;
    payload: Json;
  }>;
  removedKeys?: string[];
}): Promise<{
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
}> {
  (await ensureEmployeeMemoriesTable());
  const kind = memoryKindOf(input.family, input.layer);
  const previous = (await listMemories({ owner: input.owner, memory_kind: kind })).map((row) => ({
    item_key: row.item_key,
    payload: row.payload,
  }));
  const merged = mergeMemoryItems(previous, input.incoming, input.removedKeys || []);
  const now = nowIso();
  await pgTransaction(async (db) => {
    for (const key of merged.increment.removed) {
      await db.execute(`DELETE FROM employee_memory_items
              WHERE owner_user_id=$1 AND memory_kind=$2 AND item_key=$3`, input.owner, kind, key);
    }
    for (const item of merged.items) {
      if (merged.increment.unchanged.includes(item.item_key))
        continue;
      const hash = hashPayload(item.payload as Json);
      const existing = await db.one(`SELECT id, content_hash, revision FROM employee_memory_items
              WHERE owner_user_id=$1 AND memory_kind=$2 AND item_key=$3`, input.owner, kind, item.item_key) as {
        id: string;
        content_hash: string;
        revision: number;
      } | undefined;
      if (!existing) {
        await db.execute(`INSERT INTO employee_memory_items
                  (id, owner_user_id, memory_kind, item_key, payload, content_hash, revision, created_at, updated_at)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, nid("mem"), input.owner, kind, item.item_key, JSON.stringify(item.payload), hash, 1, now, now);
        continue;
      }
      if (existing.content_hash === hash)
        continue;
      await db.execute(`UPDATE employee_memory_items
              SET payload=$1, content_hash=$2, revision=$3, updated_at=$4
              WHERE id=$5`, JSON.stringify(item.payload), hash, Number(existing.revision || 1) + 1, now, existing.id);
    }
  });
  return merged.increment;
}
