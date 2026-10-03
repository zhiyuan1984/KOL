import { Worker } from "node:worker_threads";
import type { SqliteConn, SqliteStmt } from "../db.js";

const STATUS = 0;
const LENGTH = 1;
const HEADER_BYTES = 16;
const DEFAULT_BUFFER_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export type PgSyncError = Error & { code?: string; detail?: string; constraint?: string };

type QueryResponse = {
  ok: boolean;
  rows?: unknown[];
  rowCount?: number;
  error?: { message: string; code?: string; detail?: string; constraint?: string };
};

function bufferBytes(): number {
  const configured = Number(process.env.PG_SYNC_BUFFER_BYTES || DEFAULT_BUFFER_BYTES);
  return Math.max(1024 * 1024, Math.min(64 * 1024 * 1024, Math.floor(configured)));
}

function timeoutMs(): number {
  const configured = Number(process.env.PG_SYNC_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Math.max(1_000, Math.min(120_000, Math.floor(configured)));
}

function appendConflict(sql: string, suffix: string): string {
  const trimmed = sql.trim().replace(/;$/, "");
  const returning = trimmed.match(/\s+(RETURNING\s+[\s\S]+)$/i);
  const body = returning ? trimmed.slice(0, -returning[0].length) : trimmed;
  return `${body} ${suffix}${returning ? returning[0] : ""}`;
}

function replaceQuestionMarks(sql: string): string {
  let index = 0;
  let quote: "'" | '"' | null = null;
  let result = "";
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (quote) {
      result += char;
      if (char === quote) {
        if (sql[i + 1] === quote && quote === "'") {
          result += sql[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      result += char;
      continue;
    }
    if (char === "?") {
      index += 1;
      result += `$${index}`;
      continue;
    }
    result += char;
  }
  return result;
}

function rewriteInsertOrReplace(
  sql: string,
  resolveKeys?: (table: string, columns: string[]) => string[] | null,
): string {
  const match = sql.match(/^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+([A-Za-z_][\w.]*)\s*\(([^)]+)\)/i);
  if (!match) return sql.replace(/INSERT\s+OR\s+REPLACE/gi, "INSERT");
  const table = match[1];
  const columns = match[2]
    .split(",")
    .map((column) => column.trim())
    .filter((column) => /^[A-Za-z_][\w]*$/.test(column));
  const assignments = columns.map((column) => `${column}=EXCLUDED.${column}`).join(",");
  // 冲突键优先取目标表的真实主键；解析不到时退回旧的候选表启发式。
  const resolved = resolveKeys?.(table, columns);
  const keys = resolved && resolved.length && resolved.every((column) => columns.includes(column))
    ? resolved
    : [
      ["id"],
      ["key"],
      ["user_id", "connector_id"],
      ["user_id", "skill_id"],
      ["user_id", "mailbox_email"],
      ["owner_user_id"],
      ["scope", "scope_ref"],
      ["skill_id", "version"],
    ].find((candidate) => candidate.every((column) => columns.includes(column))) || [columns[0]];
  return appendConflict(
    sql.replace(/INSERT\s+OR\s+REPLACE/gi, "INSERT"),
    `ON CONFLICT (${keys.join(",")}) DO UPDATE SET ${assignments}`,
  );
}

function rewriteJsonExtract(sql: string): string {
  return sql.replace(
    /json_extract\(\s*([A-Za-z_][\w.]*)\s*,\s*'\$\.([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)'\s*\)/gi,
    (_match, column: string, jsonPath: string) => {
      const segments = jsonPath.split(".");
      if (segments.length === 1) return `${column}::jsonb ->> '${segments[0]}'`;
      return `${column}::jsonb #>> '{${segments.join(",")}}'`;
    },
  );
}

function rewriteNoCaseCollation(sql: string): string {
  // SQLite's built-in NOCASE collation is not installed in PostgreSQL.
  // LIKE … COLLATE NOCASE 的语义是「大小写不敏感匹配」→ 对应 PostgreSQL 的 ILIKE；
  // 其余表达式级用法（ORDER BY 等）用 LOWER 保持原排序意图。
  return sql
    .replace(
      /([A-Za-z_][\w.]*)\s+LIKE\s+(\?\d*|\$\d+)\s+COLLATE\s+NOCASE\b/gi,
      "$1 ILIKE $2",
    )
    .replace(/([A-Za-z_][\w.]*)\s+COLLATE\s+NOCASE\b/gi, "LOWER($1)");
}

function rewriteSqliteMaster(sql: string): string {
  if (!/sqlite_master/i.test(sql)) return sql;
  // 覆盖现有代码实际使用的存在性/列举探针形状；键支持 ?/$n/字面量（原实现只匹配 $ 导致 name=? 死分支）。
  const column = (name: string) => (name === "1" ? "1" : "table_name AS name");
  const base = "FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'";
  return sql
    .replace(
      /SELECT\s+(name|1)\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*(\?|\$\d+|'[^']*')/gi,
      (_match, col: string, key: string) => `SELECT ${column(col)} ${base} AND table_name=${key}`,
    )
    .replace(
      /SELECT\s+(name|1)\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'/gi,
      (_match, col: string) => `SELECT ${column(col)} ${base}`,
    );
}

/**
 * Converts the narrow SQLite dialect used by existing repositories to PostgreSQL.
 * It deliberately fails closed for unsupported PRAGMA schema mutations instead of
 * silently yielding a second persistence truth.
 */
export function translateSqliteSql(
  sql: string,
  resolveKeys?: (table: string, columns: string[]) => string[] | null,
): string {
  const source = sql.trim();
  if (!source) return source;
  if (/^PRAGMA\s+foreign_keys/i.test(source) || /^PRAGMA\s+journal_mode/i.test(source)) return "SELECT 1";
  let output = source;
  output = rewriteSqliteMaster(output);
  output = output.replace(/\bIFNULL\s*\(/gi, "COALESCE(");
  output = rewriteNoCaseCollation(output);
  output = output.replace(/([A-Za-z_][\w.]*)\s+NOT\s+GLOB\s+'\*\[\^([^\]]+)\]\*'/gi, "$1 !~ '[^$2]'");
  output = rewriteJsonExtract(output);
  output = output.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT");
  if (/^\s*INSERT\s+OR\s+IGNORE\b/i.test(source)) output = appendConflict(output, "ON CONFLICT DO NOTHING");
  if (/^\s*INSERT\s+OR\s+REPLACE\b/i.test(source)) output = rewriteInsertOrReplace(output, resolveKeys);
  output = output.replace(/\bUPDATE\s+OR\s+IGNORE\b/gi, "UPDATE");
  output = output.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY");
  output = output.replace(/\bAUTOINCREMENT\b/gi, "");
  output = output.replace(/\bBEGIN\s+IMMEDIATE\b/gi, "BEGIN ISOLATION LEVEL SERIALIZABLE");
  return replaceQuestionMarks(output);
}

function pragmaSql(src: string): string | null {
  const normalized = src.trim().replace(/^PRAGMA\s+/i, "");
  const tableInfo = normalized.match(/^table_info\(([^)]+)\)$/i);
  if (tableInfo) {
    const table = tableInfo[1].replace(/["']/g, "");
    if (!/^[A-Za-z_][\w]*$/.test(table)) throw new Error("invalid table name in PRAGMA table_info");
    return `SELECT column_name AS name, CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END AS notnull, 0 AS pk FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='${table}' ORDER BY ordinal_position`;
  }
  if (/^foreign_keys\s*=\s*ON$/i.test(normalized) || /^journal_mode\s*=\s*WAL$/i.test(normalized)) return "SELECT 1";
  return null;
}

export class PostgresSyncConn implements SqliteConn {
  private readonly worker: Worker;
  private stopped = false;
  // Requests are serialized by the Atomics.wait below, so one response buffer
  // serves the whole connection. Allocating a fresh buffer per query left
  // large shared allocations unreclaimed under sustained load.
  private shared: SharedArrayBuffer | null = null;
  private sharedBytes = 0;
  private readonly primaryKeys = new Map<string, string[]>();

  constructor(connectionString: string) {
    this.worker = new Worker(new URL("./sync-worker.mjs", import.meta.url), {
      workerData: { connectionString },
    });
    this.worker.unref();
  }

  private dropBuffer(shared: SharedArrayBuffer): void {
    // A timed-out worker call can still write into this buffer later; never
    // let that late response be read as the next request's answer.
    if (this.shared === shared) this.shared = null;
  }

  /**
   * 载入各表主键，供 INSERT OR REPLACE 生成 ON CONFLICT；失败则退回候选表启发式。
   * 由 connect() 在 schema 检查后显式调用——不在构造函数里发查询：测试会直接构造本类。
   */
  loadPrimaryKeys(): void {
    try {
      const rows = this.request(
        `SELECT c.relname AS table_name, a.attname AS column_name
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indrelid AND c.relkind = 'r' AND pg_table_is_visible(c.oid)
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indisprimary
          ORDER BY c.relname, array_position(i.indkey, a.attnum)`,
      ).rows as { table_name: string; column_name: string }[];
      for (const row of rows) {
        const table = String(row.table_name);
        const existing = this.primaryKeys.get(table) || [];
        existing.push(String(row.column_name));
        this.primaryKeys.set(table, existing);
      }
    } catch {
      /* 保持空表：走候选表启发式 */
    }
  }

  private conflictKeys(table: string): string[] | null {
    return this.primaryKeys.get(table) || null;
  }

  private request(sql: string, params: unknown[] = []): QueryResponse {
    if (this.stopped) throw new Error("PostgreSQL connection is not open");
    if (!this.shared) {
      this.sharedBytes = bufferBytes();
      this.shared = new SharedArrayBuffer(HEADER_BYTES + this.sharedBytes);
    }
    const shared = this.shared;
    const header = new Int32Array(shared, 0, 4);
    Atomics.store(header, STATUS, 0);
    this.worker.postMessage({ sql: translateSqliteSql(sql, (table) => this.conflictKeys(table)), params, shared });
    const wait = Atomics.wait(header, STATUS, 0, timeoutMs());
    if (wait === "timed-out") {
      this.dropBuffer(shared);
      throw new Error(`PostgreSQL query timed out after ${timeoutMs()}ms`);
    }
    const length = Atomics.load(header, LENGTH);
    if (length < 0 || length > this.sharedBytes) {
      this.dropBuffer(shared);
      throw new Error("PostgreSQL bridge returned an invalid response length");
    }
    const bytes = new Uint8Array(shared, HEADER_BYTES, length);
    const response = JSON.parse(new TextDecoder().decode(bytes)) as QueryResponse;
    if (!response.ok) {
      const error = new Error(response.error?.message || "PostgreSQL query failed") as PgSyncError;
      error.code = response.error?.code;
      error.detail = response.error?.detail;
      error.constraint = response.error?.constraint;
      throw error;
    }
    return response;
  }

  exec(sql: string): unknown {
    return this.request(sql).rows || [];
  }

  prepare(sql: string): SqliteStmt {
    return {
      all: (...args: unknown[]) => this.request(sql, args).rows || [],
      get: (...args: unknown[]) => (this.request(sql, args).rows || [])[0],
      run: (...args: unknown[]) => {
        const response = this.request(sql, args);
        return { changes: Number(response.rowCount || 0), lastInsertRowid: 0 };
      },
    };
  }

  pragma(src: string): unknown {
    const sql = pragmaSql(src);
    if (!sql) throw new Error(`Unsupported PostgreSQL compatibility PRAGMA: ${src}`);
    return this.request(sql).rows || [];
  }

  transaction<T>(fn: (db: SqliteConn) => T): (db?: SqliteConn) => T {
    return () => {
      this.exec("BEGIN");
      try {
        const result = fn(this);
        this.exec("COMMIT");
        return result;
      } catch (error) {
        try { this.exec("ROLLBACK"); } catch { /* retain original error */ }
        throw error;
      }
    };
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    void this.worker.terminate();
  }
}
