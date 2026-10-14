import { DEMO_USER } from "../../src/config.js";
import { postgresDb } from "../../src/postgres/access.js";
/**
 * Bind the shared demo employee (DEMO_USER / 赵良玉) to the Larry Zhao mailbox.
 * Tests that seed brand/site data can pass overrides; defaults match the
 * empty-profile fixtures used by mail-memory tests.
 *
 * Use `DEMO_USER.id` rather than a literal: the seeded fixtures and the
 * request-scoped actor both resolve to it, so a rename cannot silently bind
 * a mailbox for a user no endpoint will ever look up.
 */
export async function bindStarryUser(options: {
  brands?: string[];
  site?: string;
} = {}): Promise<void> {
  const now = new Date().toISOString();
  const brands = JSON.stringify(options.brands ?? []);
  const site = options.site ?? "";
  (await postgresDb().execute(`INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, DEMO_USER.id, DEMO_USER.handle, DEMO_USER.name, "x", JSON.stringify(["employee", "admin"]), brands, site, 1, now, now));
  (await postgresDb().execute(`INSERT INTO user_starry_bindings (user_id, mailbox_email, is_default, mailbox_id, owner_name, bearer_token, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(user_id, mailbox_email) DO UPDATE SET mailbox_id=excluded.mailbox_id, owner_name=excluded.owner_name, status=excluded.status, updated_at=excluded.updated_at`, DEMO_USER.id, "larry.zhao@amperetime.com", 1, "mbx_larry", "赵良玉", "", "connected", now));
}
