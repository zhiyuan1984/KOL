import { createHash } from "node:crypto";
import type { PgRepository } from "../postgres/access.js";
import { mapUser } from "../auth.js";
import { collaborationInScope } from "../host/inbound-scope.js";
import { HttpFail } from "../host/errors.js";
import type { Row } from "../types.js";
import type { ReviewSource } from "../../../shared/review.js";
/** Read the source through the existing business scope gate and freeze its facts. */
export async function collaborationReviewSource(db: PgRepository, actor: string, id: string): Promise<ReviewSource> {
  const user = (await db.one("SELECT * FROM users WHERE id=$1 AND active=1", actor)) as Row | undefined;
  const row = (await db.one("SELECT id,handle,display_name,brand,stage_code,notes FROM collaborations WHERE id=$1", id)) as Row | undefined;
  if (!user || !row || !collaborationInScope(row, (await mapUser(user))))
    throw new HttpFail(404, "合作对象不存在或超出当前权限范围");
  const label = String(row.display_name || row.handle);
  const snapshot = { handle: String(row.handle), brand: String(row.brand), stage: String(row.stage_code), notes: String(row.notes || "") };
  const version = createHash("sha256").update(JSON.stringify({ id, label, snapshot })).digest("hex");
  return { type: "collaboration", id, version, label, snapshot };
}
export async function checkedReviewSource(db: PgRepository, actor: string, source?: ReviewSource) {
  if (source === undefined)
    return undefined;
  if (!source || source.type !== "collaboration" || typeof source.id !== "string" || typeof source.version !== "string")
    throw new HttpFail(422, "申请来源格式错误");
  const current = (await collaborationReviewSource(db, actor, source.id));
  if (current.version !== source.version)
    throw new HttpFail(409, "来源对象已变化，请重新打开合作对象并核对材料");
  return current;
}
