import { getConn } from "../../src/db.js";

/**
 * Bind the shared demo employee (usr_sriphy / 赵良玉) to the Larry Zhao mailbox.
 * Tests that seed brand/site data can pass overrides; defaults match the
 * empty-profile fixtures used by mail-memory tests.
 */
export function bindStarryUser(options: { brands?: string[]; site?: string } = {}): void {
  const now = new Date().toISOString();
  const brands = JSON.stringify(options.brands ?? []);
  const site = options.site ?? "";
  getConn().prepare(
    `INSERT OR IGNORE INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run("usr_sriphy", "sriphy", "鄢棽", "x", JSON.stringify(["employee", "admin"]), brands, site, 1, now, now);
  getConn().prepare(
    `INSERT INTO user_starry_bindings (user_id, mailbox_email, mailbox_id, owner_name, bearer_token, status, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET mailbox_email=excluded.mailbox_email, status=excluded.status, updated_at=excluded.updated_at`,
  ).run("usr_sriphy", "larry.zhao@amperetime.com", "mbx_larry", "赵良玉", "", "connected", now);
}
