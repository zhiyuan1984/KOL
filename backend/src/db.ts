import { createRequire } from "node:module";
import fs from "node:fs";
import { boxDir, dataDir, dbPath } from "./config.js";
import type { Json, Row } from "./types.js";

const require = createRequire(import.meta.url);

export type SqliteStmt = {
  all: (...args: unknown[]) => unknown[];
  get: (...args: unknown[]) => unknown;
  run: (...args: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
};

export type SqliteConn = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqliteStmt;
  pragma: (src: string) => unknown;
  transaction: <T>(fn: (db: SqliteConn) => T) => (db?: SqliteConn) => T;
  close: () => void;
};

let conn: SqliteConn | null = null;
const resetHooks: Array<() => void> = [];

export function onConnReset(hook: () => void): void {
  resetHooks.push(hook);
}

function wrapBetter(db: { exec: Function; prepare: Function; pragma: Function; transaction: Function; close: Function }): SqliteConn {
  const self: SqliteConn = {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql) as SqliteStmt,
    pragma: (src) => db.pragma(src),
    transaction: (fn) => {
      const run = db.transaction(() => fn(self));
      return () => run() as ReturnType<typeof fn>;
    },
    close: () => db.close(),
  };
  return self;
}

function wrapNode(raw: { exec: Function; prepare: Function; close: Function }): SqliteConn {
  const self: SqliteConn = {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const stmt = raw.prepare(sql);
      return {
        all: (...args) => (stmt.all(...args) as unknown[]) || [],
        get: (...args) => stmt.get(...args),
        run: (...args) => {
          const r = stmt.run(...args) as { changes?: number; lastInsertRowid?: number | bigint };
          return { changes: Number(r?.changes ?? 0), lastInsertRowid: r?.lastInsertRowid ?? 0 };
        },
      };
    },
    pragma: (src) => raw.exec(`PRAGMA ${src.replace(/^PRAGMA\s+/i, "")}`),
    transaction: (fn) => () => {
      raw.exec("BEGIN");
      try {
        const out = fn(self);
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        try {
          raw.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      }
    },
    close: () => raw.close(),
  };
  return self;
}

function openSqlite(file: string): SqliteConn {
  try {
    const Database = require("better-sqlite3") as new (p: string) => {
      exec: Function;
      prepare: Function;
      pragma: Function;
      transaction: Function;
      close: Function;
    };
    return wrapBetter(new Database(file));
  } catch (nativeErr) {
    try {
      const { DatabaseSync } = require("node:sqlite") as {
        DatabaseSync: new (p: string) => { exec: Function; prepare: Function; close: Function };
      };
      console.warn(
        "better-sqlite3 原生绑定不可用，已改用 node:sqlite（仍是同一 SQLite 文件）。编译链：yum install -y gcc-c++ make python3",
      );
      return wrapNode(new DatabaseSync(file));
    } catch {
      throw nativeErr;
    }
  }
}

export function connect(): SqliteConn {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(boxDir(), { recursive: true });
  const db = openSqlite(dbPath());
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}

export function getConn(): SqliteConn {
  if (!conn) {
    conn = connect();
  }
  return conn;
}

export function resetConn(): SqliteConn {
  if (conn) {
    // Test suites and short-lived worker paths may already have closed the
    // handle. Always clear the singleton even when the underlying driver
    // reports "database is not open", otherwise the next isolated test keeps
    // reusing a dead connection.
    try {
      conn.close();
    } catch {
      /* already closed */
    } finally {
      conn = null;
    }
  }
  for (const hook of resetHooks) hook();
  return getConn();
}

export function tx<T>(fn: (db: SqliteConn) => T): T {
  const db = getConn();
  return db.transaction(fn)(db);
}

/** True when SQLite rejected an insert/update because a parent row is gone. */
export function isSqliteForeignKeyError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const message = error instanceof Error ? error.message : String(error || "");
  return /SQLITE_CONSTRAINT_FOREIGNKEY/i.test(code)
    || /FOREIGN KEY constraint failed/i.test(message);
}

/** True when a test reset or process teardown already closed the handle. */
export function isSqliteClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /database is not open|SQLITE_MISUSE|The database connection is not open/i.test(message);
}

export function asRow(row: unknown): Row {
  return { ...(row as Row) };
}

export function asRows(rows: unknown[]): Row[] {
  return rows.map(asRow);
}

function initSchema(db: SqliteConn): void {
  db.exec(`
        CREATE TABLE IF NOT EXISTS collaborations (
            id TEXT PRIMARY KEY,
            handle TEXT NOT NULL,
            display_name TEXT NOT NULL,
            brand TEXT NOT NULL,
            platform TEXT,
            followers TEXT,
            email TEXT NOT NULL,
            mailbox_from TEXT NOT NULL,
            lifecycle_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            stage_code TEXT NOT NULL,
            days_in_stage INTEGER DEFAULT 0,
            notes TEXT,
            overdue INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS drafts (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            collaboration_id TEXT,
            skill TEXT NOT NULL,
            from_addr TEXT NOT NULL,
            to_addr TEXT NOT NULL,
            cc TEXT DEFAULT '',
            subject TEXT NOT NULL,
            body_en TEXT NOT NULL,
            body_zh_internal TEXT NOT NULL,
            lang_label TEXT NOT NULL,
            amount_usd REAL,
            keep_stage INTEGER NOT NULL DEFAULT 1,
            proposed_stage TEXT,
            official_stage TEXT,
            approval_id TEXT,
            fingerprint TEXT,
            template_id TEXT,
            sent_at TEXT,
            status TEXT NOT NULL DEFAULT 'draft'
        );

        CREATE TABLE IF NOT EXISTS approvals (
            id TEXT PRIMARY KEY,
            draft_id TEXT NOT NULL,
            brand TEXT NOT NULL,
            amount_usd REAL NOT NULL,
            status TEXT NOT NULL,
            chain TEXT NOT NULL,
            current_index INTEGER NOT NULL DEFAULT 0,
            uses_left INTEGER NOT NULL DEFAULT 1,
            fingerprint TEXT NOT NULL,
            need_manual_band INTEGER NOT NULL DEFAULT 0,
            wecom_card_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workers (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            skill TEXT NOT NULL,
            profile_id TEXT,
            status TEXT NOT NULL,
            contract_log TEXT NOT NULL,
            items TEXT NOT NULL,
            box_path TEXT,
            killed_reason TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            actor TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS starry_sends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            from_addr TEXT,
            to_addr TEXT,
            cc TEXT,
            subject TEXT,
            body TEXT,
            ts TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS starry_stage_writes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lifecycle_id TEXT NOT NULL,
            stage_code TEXT NOT NULL,
            actor TEXT,
            ts TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stage_transitions (
            id TEXT PRIMARY KEY,
            collaboration_id TEXT NOT NULL,
            lifecycle_id TEXT NOT NULL,
            from_stage TEXT NOT NULL,
            to_stage TEXT NOT NULL,
            reason_code TEXT NOT NULL,
            evidence TEXT NOT NULL,
            recommender TEXT NOT NULL,
            approver TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            data_version_before INTEGER NOT NULL,
            data_version_after INTEGER NOT NULL,
            capability_profile TEXT NOT NULL,
            advancement_mode TEXT NOT NULL
        );

        CREATE TRIGGER IF NOT EXISTS stage_transitions_no_update
        BEFORE UPDATE ON stage_transitions
        BEGIN
          SELECT RAISE(ABORT, 'stage_transitions are immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS stage_transitions_no_delete
        BEFORE DELETE ON stage_transitions
        BEGIN
          SELECT RAISE(ABORT, 'stage_transitions are immutable');
        END;

        CREATE TABLE IF NOT EXISTS wecom_cards (
            id TEXT PRIMARY KEY,
            approval_id TEXT NOT NULL,
            title TEXT,
            body TEXT,
            status TEXT NOT NULL,
            assignee TEXT,
            payload TEXT NOT NULL,
            ts TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS claw_creators (
            id TEXT PRIMARY KEY,
            handle TEXT,
            name TEXT,
            platform TEXT,
            platform_creator_id TEXT,
            followers INTEGER,
            score REAL,
            status TEXT,
            outreach_script TEXT,
            payload TEXT
        );

        CREATE TABLE IF NOT EXISTS crawl_jobs (
            id TEXT PRIMARY KEY,
            idempotency_key TEXT NOT NULL UNIQUE,
            owner_user_id TEXT NOT NULL,
            work_item_id TEXT NOT NULL,
            session_id TEXT,
            platform TEXT NOT NULL,
            mode TEXT NOT NULL,
            parameters TEXT NOT NULL,
            remote_task_id TEXT,
            status TEXT NOT NULL,
            upload_error TEXT,
            error TEXT,
            data_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            started_at TEXT,
            last_checked_at TEXT,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS crawl_job_events (
            id TEXT PRIMARY KEY,
            crawl_job_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT,
            payload TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            UNIQUE(crawl_job_id, sequence),
            FOREIGN KEY(crawl_job_id) REFERENCES crawl_jobs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS creator_snapshots (
            id TEXT PRIMARY KEY,
            creator_id TEXT NOT NULL,
            ingestion_batch_id TEXT,
            crawl_job_id TEXT,
            platform TEXT NOT NULL,
            platform_creator_id TEXT NOT NULL,
            nickname TEXT NOT NULL,
            followers INTEGER NOT NULL DEFAULT 0,
            recent_views TEXT NOT NULL DEFAULT '[]',
            score REAL NOT NULL DEFAULT 0,
            score_details TEXT NOT NULL DEFAULT '{}',
            source TEXT,
            task_id TEXT,
            collected_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(creator_id) REFERENCES claw_creators(id) ON DELETE CASCADE,
            FOREIGN KEY(crawl_job_id) REFERENCES crawl_jobs(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS ingestion_batches (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            task_id TEXT,
            crawl_job_id TEXT,
            accepted INTEGER NOT NULL,
            inserted INTEGER NOT NULL,
            updated INTEGER NOT NULL,
            rejected INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(crawl_job_id) REFERENCES crawl_jobs(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            tags TEXT,
            in_market INTEGER NOT NULL DEFAULT 1,
            kind TEXT NOT NULL DEFAULT 'policy',
            skill_id TEXT,
            brand TEXT NOT NULL DEFAULT '*',
            lang TEXT NOT NULL DEFAULT 'en',
            subject TEXT,
            body_en TEXT,
            placeholders TEXT,
            stage_codes TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            current_version INTEGER NOT NULL DEFAULT 1,
            created_by TEXT,
            approved_by TEXT,
            approved_at TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS knowledge_versions (
            id TEXT PRIMARY KEY,
            knowledge_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            title TEXT,
            body TEXT,
            subject TEXT,
            body_en TEXT,
            placeholders TEXT,
            stage_codes TEXT,
            skill_id TEXT,
            brand TEXT,
            lang TEXT,
            kind TEXT,
            status TEXT,
            created_by TEXT,
            created_at TEXT,
            note TEXT
        );
        CREATE TABLE IF NOT EXISTS knowledge_citations (
            user_id TEXT NOT NULL,
            knowledge_id TEXT NOT NULL,
            cited_at TEXT NOT NULL,
            PRIMARY KEY (user_id, knowledge_id)
        );
        CREATE TABLE IF NOT EXISTS knowledge_deprecations (
            user_id TEXT NOT NULL,
            knowledge_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            reason_note TEXT,
            deprecated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, knowledge_id)
        );
        CREATE TABLE IF NOT EXISTS knowledge_raw (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            filename TEXT,
            content_type TEXT,
            body TEXT,
            path TEXT,
            uploaded_by TEXT,
            created_at TEXT NOT NULL,
            session_id TEXT,
            task_id TEXT,
            meta TEXT
        );
        CREATE TABLE IF NOT EXISTS knowledge_extract_jobs (
            id TEXT PRIMARY KEY,
            raw_id TEXT NOT NULL,
            status TEXT NOT NULL,
            result_knowledge_id TEXT,
            error TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL,
            finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS knowledge_proposals (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            skill_id TEXT,
            knowledge_id TEXT,
            from_brand TEXT,
            to_brand TEXT,
            proposed_diff TEXT,
            status TEXT NOT NULL,
            profile TEXT NOT NULL DEFAULT 'shadow',
            created_by TEXT,
            created_at TEXT NOT NULL,
            reviewed_by TEXT,
            reviewed_at TEXT,
            reject_reason TEXT
        );

        CREATE TABLE IF NOT EXISTS inbound (
            id TEXT PRIMARY KEY,
            from_addr TEXT,
            from_name TEXT,
            subject TEXT,
            snippet TEXT,
            summary TEXT,
            bound INTEGER NOT NULL DEFAULT 0,
            deferred INTEGER NOT NULL DEFAULT 0,
            collaboration_id TEXT,
            session_id TEXT,
            confidence TEXT,
            candidates TEXT,
            ts TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            roles TEXT NOT NULL DEFAULT '["employee"]',
            brands TEXT NOT NULL DEFAULT '[]',
            site TEXT,
            manager_user_id TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(manager_user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS auth_sessions (
            id_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_skill_grants (
            user_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(user_id, skill_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS connectors (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'configured',
            credential_ref TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_connector_grants (
            user_id TEXT NOT NULL,
            connector_id TEXT NOT NULL,
            access TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(user_id, connector_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(connector_id) REFERENCES connectors(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS approval_role_bindings (
            user_id TEXT NOT NULL,
            approval_role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(user_id, approval_role),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS exams (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS exam_assignments (
            id TEXT PRIMARY KEY,
            exam_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            required INTEGER NOT NULL DEFAULT 1,
            due_at TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(exam_id, user_id),
            FOREIGN KEY(exam_id) REFERENCES exams(id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS exam_attempts (
            id TEXT PRIMARY KEY,
            assignment_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            answers TEXT NOT NULL,
            passed INTEGER NOT NULL,
            submitted_at TEXT NOT NULL,
            FOREIGN KEY(assignment_id) REFERENCES exam_assignments(id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id TEXT PRIMARY KEY,
            analytics_cookies INTEGER NOT NULL DEFAULT 0,
            preferences TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memory_entries (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '记忆',
            body_md TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'private',
            enabled INTEGER NOT NULL DEFAULT 1,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS work_items (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            task_type TEXT NOT NULL,
            title TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            status TEXT NOT NULL DEFAULT 'pending',
            priority TEXT NOT NULL DEFAULT 'normal',
            skill TEXT NOT NULL,
            profile TEXT NOT NULL,
            project_id TEXT,
            collaboration_id TEXT,
            session_id TEXT,
            due_at TEXT,
            promoted_at TEXT,
            dismissed_at TEXT,
            started_at TEXT,
            completed_at TEXT,
            input TEXT NOT NULL DEFAULT '{}',
            entities TEXT NOT NULL DEFAULT '{}',
            data_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS task_runs (
            id TEXT PRIMARY KEY,
            work_item_id TEXT NOT NULL,
            session_id TEXT,
            thread_id TEXT,
            turn_id TEXT,
            worker_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            input TEXT NOT NULL DEFAULT '{}',
            entities TEXT NOT NULL DEFAULT '{}',
            error TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS task_events (
            id TEXT PRIMARY KEY,
            work_item_id TEXT NOT NULL,
            run_id TEXT,
            sequence INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            label TEXT NOT NULL,
            status TEXT NOT NULL,
            safe_summary TEXT,
            time TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(work_item_id, sequence),
            FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
            FOREIGN KEY(run_id) REFERENCES task_runs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS task_artifacts (
            id TEXT PRIMARY KEY,
            work_item_id TEXT NOT NULL,
            run_id TEXT,
            artifact_type TEXT NOT NULL,
            message_id TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            payload TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
            FOREIGN KEY(run_id) REFERENCES task_runs(id) ON DELETE SET NULL,
            FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS work_items_owner_status
            ON work_items(owner_user_id, status, updated_at);
        CREATE INDEX IF NOT EXISTS task_runs_work_item
            ON task_runs(work_item_id, created_at);
        CREATE INDEX IF NOT EXISTS task_events_work_item
            ON task_events(work_item_id, sequence);
        DROP INDEX IF EXISTS crawl_jobs_one_active;
        CREATE UNIQUE INDEX crawl_jobs_one_active
            ON crawl_jobs((1))
            WHERE status IN ('queued','crawling','uploading','analyzing','starting','running','stopping');
        CREATE INDEX IF NOT EXISTS crawl_job_events_job
            ON crawl_job_events(crawl_job_id, sequence);
        CREATE INDEX IF NOT EXISTS creator_snapshots_creator
            ON creator_snapshots(creator_id, created_at);

        CREATE TABLE IF NOT EXISTS user_uploads (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            size_bytes INTEGER NOT NULL,
            mime_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS session_shares (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            include_internal INTEGER NOT NULL DEFAULT 0,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS retention_policy (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            session_days INTEGER NOT NULL DEFAULT 365,
            audit_days INTEGER NOT NULL DEFAULT 730,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skill_sops (
            id TEXT PRIMARY KEY,
            summary TEXT NOT NULL,
            body TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS orgs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS teams (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            name TEXT NOT NULL,
            FOREIGN KEY(org_id) REFERENCES orgs(id)
        );
        CREATE TABLE IF NOT EXISTS directory_users (
            id TEXT PRIMARY KEY,
            handle TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            role TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memberships (
            id TEXT PRIMARY KEY,
            user_handle TEXT NOT NULL,
            scope TEXT NOT NULL,
            scope_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS skill_grants (
            id TEXT PRIMARY KEY,
            skill_id TEXT NOT NULL,
            scope TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            granted_by TEXT NOT NULL,
            granted_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS skill_flags (
            id TEXT PRIMARY KEY,
            in_market INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );
  `);
  migrateSchema(db);
}

function cols(db: SqliteConn, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function add(db: SqliteConn, table: string, name: string, ddl: string): void {
  if (!cols(db, table).has(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

function migrateSchema(db: SqliteConn): void {
  add(db, "collaborations", "stage_version", "INTEGER NOT NULL DEFAULT 0");
  add(db, "collaborations", "recipient_name", "TEXT");
  add(db, "collaborations", "phone", "TEXT");
  add(db, "collaborations", "address_line", "TEXT");
  add(db, "collaborations", "country", "TEXT");
  add(db, "collaborations", "postal", "TEXT");
  add(db, "collaborations", "sku", "TEXT");
  add(db, "collaborations", "qty", "TEXT");
  add(db, "collaborations", "locked", "INTEGER NOT NULL DEFAULT 0");
  add(db, "collaborations", "owner_name", "TEXT");
  add(db, "collaborations", "avg_views_10", "TEXT");
  add(db, "collaborations", "engagement_rate", "TEXT");
  add(db, "collaborations", "audience_geo", "TEXT");
  add(db, "collaborations", "duplicate_checked", "INTEGER NOT NULL DEFAULT 0");
  add(db, "collaborations", "group_brand_overlap", "TEXT");
  add(db, "collaborations", "kol_uid", "TEXT");
  add(db, "collaborations", "source", "TEXT");
  add(db, "collaborations", "follow_style_tags", "TEXT");
  add(db, "collaborations", "niche", "TEXT");
  add(db, "collaborations", "risk_tag", "TEXT");
  add(db, "collaborations", "wechat", "TEXT");
  add(db, "collaborations", "kol_id", "TEXT");
  add(db, "collaborations", "last_conversation_id", "TEXT");
  add(db, "collaborations", "last_lifecycle_id", "TEXT");
  add(db, "collaborations", "last_skip_kind", "TEXT");
  add(db, "collaborations", "last_skip_reason", "TEXT");
  add(db, "collaborations", "last_skipped_stages", "TEXT");
  add(db, "collaborations", "contact_email_masked", "TEXT");
  add(db, "sessions", "collaboration_id", "TEXT");
  db.exec(`
        CREATE TABLE IF NOT EXISTS kol_mail_seen (
            fingerprint TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            collaboration_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
  `);
  db.exec(`
        CREATE TABLE IF NOT EXISTS mailbox_owners (
            email TEXT PRIMARY KEY,
            brand TEXT NOT NULL,
            owner_name TEXT NOT NULL,
            dept TEXT,
            account_type TEXT,
            status TEXT,
            shared_with TEXT,
            permission_scope TEXT,
            notes TEXT
        );
  `);
  add(db, "drafts", "extra", "TEXT");
  add(db, "drafts", "send_error", "TEXT");
  add(db, "drafts", "currency", "TEXT");
  add(db, "approvals", "chain_id", "TEXT");
  add(db, "approvals", "kind", "TEXT NOT NULL DEFAULT 'quote'");
  add(db, "approvals", "payload", "TEXT");
  add(db, "approvals", "title", "TEXT");
  add(db, "approvals", "submitted_by", "TEXT");
  add(db, "sessions", "kind", "TEXT");
  add(db, "sessions", "disabled", "INTEGER NOT NULL DEFAULT 0");
  add(db, "sessions", "thread_ref", "TEXT");
  add(db, "sessions", "owner_user_id", "TEXT");
  add(db, "sessions", "archived_at", "TEXT");
  add(db, "sessions", "deleted_at", "TEXT");
  add(db, "inbound", "from_name", "TEXT");
  add(db, "inbound", "summary", "TEXT");
  add(db, "inbound", "deferred", "INTEGER NOT NULL DEFAULT 0");
  add(db, "inbound", "session_id", "TEXT");
  add(db, "inbound", "confidence", "TEXT");
  add(db, "inbound", "candidates", "TEXT");
  add(db, "inbound", "provider_message_id", "TEXT");
  add(db, "inbound", "identity_hash", "TEXT");
  add(db, "inbound", "brand", "TEXT");
  add(db, "inbound", "mailbox", "TEXT");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS inbound_provider_message_id
    ON inbound(provider_message_id) WHERE provider_message_id IS NOT NULL AND provider_message_id != ''`);
  db.exec(`CREATE INDEX IF NOT EXISTS inbound_identity_hash ON inbound(identity_hash)`);
  db.exec(`
        CREATE TABLE IF NOT EXISTS kol_mail_threads (
            id TEXT PRIMARY KEY,
            collaboration_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT '',
            mailbox TEXT,
            last_direction TEXT,
            last_snippet TEXT,
            unread_count INTEGER NOT NULL DEFAULT 0,
            last_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
  `);
  add(db, "kol_mail_threads", "last_from", "TEXT");
  add(db, "kol_mail_threads", "last_from_name", "TEXT");
  db.exec("DROP INDEX IF EXISTS kol_mail_threads_key");
  const threadDupes = db.prepare(
    `SELECT collaboration_id, conversation_id FROM kol_mail_threads
     GROUP BY collaboration_id, conversation_id HAVING COUNT(*) > 1`,
  ).all() as { collaboration_id: string; conversation_id: string }[];
  for (const dupe of threadDupes) {
    const extras = db.prepare(
      `SELECT id FROM kol_mail_threads WHERE collaboration_id=? AND conversation_id=? ORDER BY updated_at DESC`,
    ).all(dupe.collaboration_id, dupe.conversation_id) as { id: string }[];
    for (const extra of extras.slice(1)) {
      db.prepare("DELETE FROM kol_mail_threads WHERE id=?").run(extra.id);
    }
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS kol_mail_threads_conv
    ON kol_mail_threads(collaboration_id, conversation_id)`);
  db.exec(`
        CREATE TABLE IF NOT EXISTS kol_mail_items (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            collaboration_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            provider_message_id TEXT,
            direction TEXT,
            subject TEXT,
            snippet TEXT,
            unread INTEGER NOT NULL DEFAULT 1,
            occurred_at TEXT,
            created_at TEXT NOT NULL
        );
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS kol_mail_items_mid
    ON kol_mail_items(provider_message_id) WHERE provider_message_id IS NOT NULL AND provider_message_id != ''`);
  db.exec(`CREATE INDEX IF NOT EXISTS kol_mail_items_collab ON kol_mail_items(collaboration_id)`);
  add(db, "workers", "profile_id", "TEXT");
  add(db, "work_items", "promoted_at", "TEXT");
  add(db, "work_items", "dismissed_at", "TEXT");
  add(db, "claw_creators", "platform_creator_id", "TEXT");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS claw_creators_platform_identity
    ON claw_creators(platform, platform_creator_id) WHERE platform_creator_id IS NOT NULL`);
  add(db, "task_events", "time", "TEXT");
  db.prepare("UPDATE task_events SET time=created_at WHERE time IS NULL").run();
  add(db, "memory_entries", "title", "TEXT NOT NULL DEFAULT '记忆'");
  add(db, "crawl_jobs", "last_checked_at", "TEXT");
  add(db, "knowledge", "kind", "TEXT NOT NULL DEFAULT 'policy'");
  add(db, "knowledge", "skill_id", "TEXT");
  add(db, "knowledge", "brand", "TEXT NOT NULL DEFAULT '*'");
  add(db, "knowledge", "lang", "TEXT NOT NULL DEFAULT 'en'");
  add(db, "knowledge", "subject", "TEXT");
  add(db, "knowledge", "body_en", "TEXT");
  add(db, "knowledge", "placeholders", "TEXT");
  add(db, "knowledge", "stage_codes", "TEXT");
  add(db, "knowledge", "status", "TEXT NOT NULL DEFAULT 'draft'");
  add(db, "knowledge", "current_version", "INTEGER NOT NULL DEFAULT 1");
  add(db, "knowledge", "created_by", "TEXT");
  add(db, "knowledge", "approved_by", "TEXT");
  add(db, "knowledge", "approved_at", "TEXT");
  add(db, "knowledge", "created_at", "TEXT");
  add(db, "knowledge", "updated_at", "TEXT");
  add(db, "users", "email", "TEXT");
  add(db, "users", "phone", "TEXT");
  add(db, "collaborations", "owner_mailbox", "TEXT");
  db.exec(`
        CREATE TABLE IF NOT EXISTS user_starry_bindings (
            user_id TEXT PRIMARY KEY,
            mailbox_email TEXT NOT NULL,
            mailbox_id TEXT,
            owner_name TEXT,
            bearer_token TEXT,
            status TEXT NOT NULL DEFAULT 'connected',
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
  `);
  db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_versions (
            id TEXT PRIMARY KEY,
            knowledge_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            title TEXT,
            body TEXT,
            subject TEXT,
            body_en TEXT,
            placeholders TEXT,
            stage_codes TEXT,
            skill_id TEXT,
            brand TEXT,
            lang TEXT,
            kind TEXT,
            status TEXT,
            created_by TEXT,
            created_at TEXT,
            note TEXT
        );
        CREATE TABLE IF NOT EXISTS knowledge_citations (
            user_id TEXT NOT NULL,
            knowledge_id TEXT NOT NULL,
            cited_at TEXT NOT NULL,
            PRIMARY KEY (user_id, knowledge_id)
        );
        CREATE TABLE IF NOT EXISTS knowledge_deprecations (
            user_id TEXT NOT NULL,
            knowledge_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            reason_note TEXT,
            deprecated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, knowledge_id)
        );
        CREATE TABLE IF NOT EXISTS knowledge_raw (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            filename TEXT,
            content_type TEXT,
            body TEXT,
            path TEXT,
            uploaded_by TEXT,
            created_at TEXT NOT NULL,
            session_id TEXT,
            task_id TEXT,
            meta TEXT
        );
        CREATE TABLE IF NOT EXISTS knowledge_extract_jobs (
            id TEXT PRIMARY KEY,
            raw_id TEXT NOT NULL,
            status TEXT NOT NULL,
            result_knowledge_id TEXT,
            error TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL,
            finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS knowledge_proposals (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            skill_id TEXT,
            knowledge_id TEXT,
            from_brand TEXT,
            to_brand TEXT,
            proposed_diff TEXT,
            status TEXT NOT NULL,
            profile TEXT NOT NULL DEFAULT 'shadow',
            created_by TEXT,
            created_at TEXT NOT NULL,
            reviewed_by TEXT,
            reviewed_at TEXT,
            reject_reason TEXT
        );
  `);
  const aliases: Record<string, string> = {
    INTEREST_CONFIRMED: "INTERESTED",
    COOPERATION_EVALUATION: "EVALUATING",
    BUSINESS_NEGOTIATION: "NEGOTIATING",
    CONTRACT_SIGNING: "CONTRACTING",
    DELIVERED_TESTING: "TESTING",
    PENDING_PUBLISH: "PUBLISH_PENDING",
    SETTLING_PAID: "SETTLING",
    EXCEPTION_HANDLING: "DISPUTED",
  };
  for (const [legacy, current] of Object.entries(aliases)) {
    db.prepare("UPDATE collaborations SET stage_code = ? WHERE stage_code = ?").run(current, legacy);
    db.prepare("UPDATE drafts SET official_stage = ? WHERE official_stage = ?").run(current, legacy);
    db.prepare("UPDATE drafts SET proposed_stage = ? WHERE proposed_stage = ?").run(current, legacy);
    db.prepare("UPDATE starry_stage_writes SET stage_code = ? WHERE stage_code = ?").run(current, legacy);
  }
  db.prepare("INSERT OR IGNORE INTO app_state (key, value) VALUES ('persona', 'sriphy')").run();
  const now = nowIso();
  for (const connector of [
    ["enterprise_mail", "企业邮箱"],
    ["wecom", "企业微信"],
    ["starry", "Starry"],
    ["claw", "Claw"],
    ["kolclaw", "KOL Claw"],
    ["starrykol", "Starry KOL MCP"],
  ]) {
    db.prepare(
      "INSERT OR IGNORE INTO connectors (id, label, enabled, status, credential_ref, updated_at) VALUES (?,?,1,'configured',NULL,?)",
    ).run(connector[0], connector[1], now);
  }
  db.prepare("UPDATE connectors SET label='Starry KOL MCP', enabled=1, status='configured' WHERE id='starrykol'").run();
  db.prepare("UPDATE connectors SET enabled=0, label='Starry KOL MCP (legacy)' WHERE id='emailmcp'").run();
  db.prepare(
    `INSERT OR IGNORE INTO user_connector_grants (user_id,connector_id,access,created_at)
     SELECT user_id,'kolclaw',
            CASE access WHEN 'admin' THEN 'admin' WHEN 'write' THEN 'write' ELSE 'read' END,
            ?
       FROM user_connector_grants
      WHERE connector_id='claw'`,
  ).run(now);
  db.prepare(
    `INSERT OR IGNORE INTO user_connector_grants (user_id,connector_id,access,created_at)
     SELECT user_id,'starrykol',
            CASE access WHEN 'admin' THEN 'admin' WHEN 'write' THEN 'write' ELSE 'read' END,
            ?
       FROM user_connector_grants
      WHERE connector_id IN ('emailmcp','enterprise_mail')`,
  ).run(now);
  db.prepare(
    "INSERT OR IGNORE INTO retention_policy (id, session_days, audit_days, updated_at) VALUES (1,365,730,?)",
  ).run(now);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function audit(actor: string, eventType: string, payload: Json): void {
  getConn()
    .prepare("INSERT INTO audit_events (ts, actor, event_type, payload) VALUES (?,?,?,?)")
    .run(nowIso(), actor, eventType, JSON.stringify(payload));
}

export function listAudit(eventType?: string | null): Row[] {
  const db = getConn();
  const rows = eventType
    ? db.prepare("SELECT * FROM audit_events WHERE event_type = ? ORDER BY id").all(eventType)
    : db.prepare("SELECT * FROM audit_events ORDER BY id").all();
  return (rows as Row[]).map((r) => ({
    ...r,
    payload: JSON.parse(String(r.payload || "{}")),
  }));
}
