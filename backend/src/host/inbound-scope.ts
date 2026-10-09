import { authDisabled, isAdmin, scopedUser, type AppUser } from "../auth.js";
import { getConn } from "../db.js";
import type { Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { departmentHeadAccessForUser } from "../contract-scope.js";
import { leaderScopeForUser } from "../runtime/organization-tree.js";

export function inboundActor(): AppUser | undefined {
  if (authDisabled()) return undefined;
  return scopedUser();
}

export function brandScope(user = inboundActor()): string[] | null {
  if (!user || isAdmin(user)) return null;
  const departmentHead = departmentHeadAccessForUser(user);
  if (departmentHead?.company_wide && departmentHead.brand_scope === "all") return null;
  return [...(user.brands || [])];
}

/**
 * 推广组组长判定（2026-10-08 用户规则）：可以看到所有公海 KOL 与全部跟进线索。
 * machine-readable 口径：平台管理员，或公司级部门负责人中的推广部负责人
 *（`config/org-registry.yaml` → org:promotion_department；现行法下部门负责人
 * 自动拥有全品牌数据范围）。组一级的组长（如 LT组组长）暂无 machine-readable
 * 角色登记，需扩展时在此补。
 */
/**
 * 组长判定（2026-10-08 用户纠正后）：department_head 即组长，不限层级
 * （一级/二级/三级/四级部门的 head 都是组长），以组织树
 * `organization_units.head_person_ref` 为准。
 * 组长可以看到所有公海 KOL（不受品牌锁限制）与本单元及下级单元的全部跟进线索；
 * 组长的上级（父单元 head）范围更大（父子树为超集），权限更多。
 */
export function isGroupLeader(user = inboundActor()): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return leaderScopeForUser(user.id).isLeader;
}

/** @deprecated 用 isGroupLeader 替代（组长不限于推广部）。 */
export const isPromotionGroupLeader = isGroupLeader;

/**
 * 组长直管成员 user id（含组长本人），用于线索列表的范围过滤；
 * 非组长返回空数组（调用方回落到仅看自己）。
 */
export function leaderMemberUserIds(user = inboundActor()): string[] {
  if (!user) return [];
  return leaderScopeForUser(user.id).memberUserIds;
}

/**
 * 公海品牌可见性：返回查看者品牌（string[]），null 表示全品牌（组长/管理员/
 * 公司级部门负责人），此时不做品牌排除；undefined 表示无法判定查看者，
 * 调用方应按失败开放（不过滤）处理，保持现有行为。
 */
export function poolViewerBrands(user = inboundActor()): string[] | null | undefined {
  if (!user) return undefined;
  if (isGroupLeader(user)) return null;
  return brandScope(user);
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
