import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { clearStarryBinding, saveStarryBinding, starryBindingRow, starryBindingRows } from "../src/host/starry-bind.js";
import type { Row } from "../src/types.js";

const require = createRequire(import.meta.url);

type RawDb = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
  close: () => void;
};

function openRaw(file: string): RawDb {
  try {
    const Database = require("better-sqlite3") as new (p: string) => RawDb;
    return new Database(file);
  } catch {
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (p: string) => RawDb };
    return new DatabaseSync(file);
  }
}

const OLD_DDL = `
  CREATE TABLE user_starry_bindings (
      user_id TEXT PRIMARY KEY,
      mailbox_email TEXT NOT NULL,
      mailbox_id TEXT,
      owner_name TEXT,
      bearer_token TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      updated_at TEXT NOT NULL,
      sync_cursor_at TEXT,
      sync_cursor_id TEXT,
      sync_page_no INTEGER NOT NULL DEFAULT 1,
      synced_at TEXT,
      last_error TEXT,
      last_tool TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`;

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-bind-migrate-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function pkColumns(): string[] {
  return (getConn().prepare("PRAGMA table_info(user_starry_bindings)").all() as { name: string; pk: number }[])
    .filter((row) => row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name);
}

function seedUser(id: string): void {
  const now = new Date().toISOString();
  getConn().prepare(
    `INSERT OR IGNORE INTO users (id,username,name,password_hash,roles,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(id, id, id, "x", "[]", 1, now, now);
}

describe("user_starry_bindings multi-mailbox migration", () => {
  it("migrates an existing single-mailbox DB: row survives with is_default=1", () => {
    const raw = openRaw(process.env.LINGONG_DB!);
    raw.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT, name TEXT, password_hash TEXT,
        roles TEXT, active INTEGER, created_at TEXT, updated_at TEXT
      );
      ${OLD_DDL}
    `);
    raw.prepare("INSERT INTO users (id, username, name) VALUES ('usr_a', 'a', '甲')").run();
    raw.prepare(
      `INSERT INTO user_starry_bindings
         (user_id, mailbox_email, mailbox_id, owner_name, bearer_token, status, updated_at, synced_at, last_error)
       VALUES ('usr_a', 'first@example.com', 'mbx_1', '甲', 'tok', 'connected', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '')`,
    ).run();
    raw.close();

    // Opening the app connection runs initSchema → rebuildUserStarryBindings.
    getConn();

    expect(pkColumns()).toEqual(["user_id", "mailbox_email"]);
    const rows = starryBindingRows("usr_a");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mailbox_email: "first@example.com",
      owner_name: "甲",
      is_default: 1,
      synced_at: "2026-01-02T00:00:00.000Z",
    });
    expect(starryBindingRow("usr_a")?.mailbox_email).toBe("first@example.com");
  });

  it("binding a second mailbox keeps both and never moves the default", () => {
    getConn();
    seedUser("usr_b");
    const first = saveStarryBinding("usr_b", { mailbox_email: "first@example.com", owner_name: "甲" });
    expect(first).toMatchObject({ bound: true, mailbox_email: "first@example.com" });
    const second = saveStarryBinding("usr_b", { mailbox_email: "second@example.com", owner_name: "乙" });
    expect(second).toMatchObject({ bound: true, mailbox_email: "second@example.com" });

    const rows = starryBindingRows("usr_b");
    expect(rows.map((row: Row) => row.mailbox_email)).toEqual(["first@example.com", "second@example.com"]);
    expect(Number(rows[0].is_default)).toBe(1);
    expect(Number(rows[1].is_default)).toBe(0);
    expect(starryBindingRow("usr_b")?.mailbox_email).toBe("first@example.com");
  });

  it("unbind deletes only the named mailbox and promotes the oldest remaining default", () => {
    getConn();
    seedUser("usr_c");
    saveStarryBinding("usr_c", { mailbox_email: "old@example.com" });
    saveStarryBinding("usr_c", { mailbox_email: "new@example.com" });

    const afterDeleteSecond = clearStarryBinding("usr_c", "new@example.com");
    expect(starryBindingRows("usr_c")).toHaveLength(1);
    expect(afterDeleteSecond.mailbox_email).toBe("old@example.com");

    // Unbind without a mailbox targets the current default.
    const afterDeleteDefault = clearStarryBinding("usr_c", "old@example.com");
    expect(starryBindingRows("usr_c")).toHaveLength(0);
    expect(afterDeleteDefault.bound).toBe(false);

    saveStarryBinding("usr_c", { mailbox_email: "a@example.com" });
    saveStarryBinding("usr_c", { mailbox_email: "b@example.com" });
    clearStarryBinding("usr_c", "a@example.com");
    expect(Number(starryBindingRow("usr_c", "b@example.com")?.is_default)).toBe(1);
  });
});
