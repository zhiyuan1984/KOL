import { authDisabled, isAdmin, scopedUser, type AppUser } from "../auth.js";
import { getConn } from "../db.js";
import type { Row } from "../types.js";
import { HttpFail } from "./errors.js";

export function inboundActor(): AppUser | undefined {
  if (authDisabled()) return undefined;
  return scopedUser();
}

export function brandScope(user = inboundActor()): string[] | null {
  if (!user || isAdmin(user)) return null;
  return [...(user.brands || [])];
}

export function collaborationInScope(row: { brand?: unknown; mailbox_from?: unknown } | undefined, user = inboundActor()): boolean {
  const brands = brandScope(user);
  if (!brands) return true;
  if (!row) return false;
  const brand = String(row.brand || "").trim();
  if (brand && brands.includes(brand)) return true;
  return false;
}

export function assertCollaborationInScope(collaborationId: string, user = inboundActor()): Row {
  const row = getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(collaborationId) as Row | undefined;
  if (!row) throw new HttpFail(404, "collaboration not found");
  if (!collaborationInScope(row, user)) throw new HttpFail(403, "超出当前品牌范围");
  return row;
}

export function scopedCollaborationSearch(query: string, user = inboundActor()): Row[] {
  const q = `%${query}%`;
  const brands = brandScope(user);
  if (!brands) {
    return getConn()
      .prepare("SELECT id, handle, brand, stage_code, mailbox_from FROM collaborations WHERE handle LIKE ? OR display_name LIKE ?")
      .all(q, q) as Row[];
  }
  if (!brands.length) return [];
  const placeholders = brands.map(() => "?").join(",");
  return getConn()
    .prepare(
      `SELECT id, handle, brand, stage_code, mailbox_from FROM collaborations
       WHERE (handle LIKE ? OR display_name LIKE ?) AND brand IN (${placeholders})`,
    )
    .all(q, q, ...brands) as Row[];
}

export function inboundVisibleSql(user = inboundActor()): { sql: string; params: unknown[] } {
  const brands = brandScope(user);
  if (!brands) return { sql: "1=1", params: [] };
  if (!brands.length) return { sql: "1=0", params: [] };
  const placeholders = brands.map(() => "?").join(",");
  return {
    sql: `(IFNULL(brand,'') = '' OR brand IN (${placeholders}))`,
    params: brands,
  };
}
