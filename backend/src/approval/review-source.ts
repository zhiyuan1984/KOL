import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { mapUser } from "../auth.js";
import { collaborationInScope } from "../host/inbound-scope.js";
import { HttpFail } from "../host/errors.js";
import type { ReviewSource } from "../../../shared/review.js";

type SourceRow = Record<string, unknown>;

/** Reads and freezes a business source through the current PostgreSQL scope gate. */
export async function collaborationReviewSource(
  db: PoolClient,
  actor: string,
  id: string,
): Promise<ReviewSource> {
  const [userResult, sourceResult] = await Promise.all([
    (await db.query<SourceRow>("SELECT * FROM users WHERE id=$1 AND active=1", [actor])),
    (await db.query<SourceRow>("SELECT id,handle,display_name,brand,stage_code,notes FROM collaborations WHERE id=$1", [id])),
  ]);
  const user = userResult.rows[0];
  const row = sourceResult.rows[0];
  if (!user || !row || !collaborationInScope(row, (await mapUser(user))))
    throw new HttpFail(404, "合作对象不存在或超出当前权限范围");
  const label = String(row.display_name || row.handle);
  const snapshot = {
    handle: String(row.handle),
    brand: String(row.brand),
    stage: String(row.stage_code),
    notes: String(row.notes || ""),
  };
  const version = createHash("sha256").update(JSON.stringify({ id, label, snapshot })).digest("hex");
  return { type: "collaboration", id, version, label, snapshot };
}

/** Re-reads the source at command time so confirmation never covers changed material. */
export async function checkedReviewSource(
  db: PoolClient,
  actor: string,
  source?: ReviewSource,
): Promise<ReviewSource | undefined> {
  if (source === undefined) return undefined;
  if (!source || source.type !== "collaboration" || typeof source.id !== "string" || typeof source.version !== "string")
    throw new HttpFail(422, "申请来源格式错误");
  const current = await collaborationReviewSource(db, actor, source.id);
  if (current.version !== source.version)
    throw new HttpFail(409, "来源对象已变化，请重新打开合作对象并核对材料");
  return current;
}
