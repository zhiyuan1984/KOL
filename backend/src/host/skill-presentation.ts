/**
 * 内置技能展示字段覆盖（图标、来源徽章、填空模板、分类、漏斗、常见说法、下一步动作）。
 * 只经「草稿 → 发布」写入；运行契约字段不在此列，仍随代码发布。
 */
import { postgresDb, nowIso, onDatabaseReset, pgTransaction } from "../postgres/access.js";
import { PRESENTATION_OVERLAY_FIELDS, TASK_FUNNELS, clearTaskRegistryCache, setPresentationOverlaySource, validateDeclaredTaskContract, validatePresentationValue, type PresentationOverlay, type TaskFunnel, type TaskNextAction, } from "../tasks/registry.js";
import { HttpFail } from "./errors.js";
let overlaySnapshot: ReadonlyMap<string, PresentationOverlay> = new Map();
function sameOverlaySnapshot(left: ReadonlyMap<string, PresentationOverlay>, right: ReadonlyMap<string, PresentationOverlay>): boolean {
  if (left.size !== right.size)
    return false;
  for (const [skillId, overlay] of left)
    if (JSON.stringify(overlay) !== JSON.stringify(right.get(skillId)))
      return false;
  return true;
}
function publishOverlaySnapshot(next: ReadonlyMap<string, PresentationOverlay>): void {
  const changed = !sameOverlaySnapshot(overlaySnapshot, next);
  overlaySnapshot = next;
  // Registry definitions include the overlay while parsing.  Rebuild only when
  // the immutable snapshot truly changed, not on every catalog read.
  if (changed)
    clearTaskRegistryCache();
}
/**
 * Load the versioned PostgreSQL table and replace the immutable in-memory snapshot.
 * The task registry reads only presentationOverlaySnapshot synchronously; it never
 * performs database I/O while parsing a skill pack.
 */
export async function readPresentationOverlays(): Promise<ReadonlyMap<string, PresentationOverlay>> {
  const rows = (await postgresDb().many("SELECT skill_id,payload FROM skill_presentation_overlays")) as {
    skill_id: string;
    payload: string;
  }[];
  const out = new Map<string, PresentationOverlay>();
  for (const row of rows) {
    try {
      out.set(String(row.skill_id), JSON.parse(row.payload) as PresentationOverlay);
  }
    catch { /* malformed rows are ignored, never half-applied */ }
  }
  publishOverlaySnapshot(out);
  return overlaySnapshot;
}
export function presentationOverlaySnapshot(): ReadonlyMap<string, PresentationOverlay> {
  return overlaySnapshot;
}
function asAliases(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[,，]/);
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}

/** 校验并规整一份展示覆盖；非法值整体拒绝，不部分写入。 */
export function normalizePresentationPatch(skillId: string, patch: Record<string, unknown>, actions?: readonly string[]): PresentationOverlay {
  const out: PresentationOverlay = {};
  try {
    for (const key of ["icon", "badge", "starter", "result_title"] as const) {
      if (patch[key] !== undefined)
        out[key] = validatePresentationValue(key, patch[key], skillId);
    }
  }
  catch (error) {
    throw new HttpFail(400, error instanceof Error ? error.message : String(error));
  }
  if (patch.category !== undefined) {
    const category = String(patch.category || "").trim();
    if (!category || category.length > 20)
      throw new HttpFail(400, "category must be 1-20 characters");
    out.category = category;
  }
  if (patch.funnel !== undefined) {
    if (!TASK_FUNNELS.includes(patch.funnel as TaskFunnel))
      throw new HttpFail(400, "unknown funnel");
    out.funnel = patch.funnel as TaskFunnel;
  }
  if (patch.aliases !== undefined)
    out.aliases = asAliases(patch.aliases);
  if (patch.next_actions !== undefined) {
    let nextActions = patch.next_actions;
    if (typeof nextActions === "string") {
      try {
        nextActions = JSON.parse(nextActions);
      }
      catch {
        throw new HttpFail(400, "next_actions must be valid JSON");
      }
    }
    let parsed: TaskNextAction[] | undefined;
    try {
      parsed = validateDeclaredTaskContract({
        id: skillId, required_inputs: [], ...(actions ? { actions: [...actions] } : {}), next_actions: nextActions,
      }).next_actions;
    }
    catch (error) {
      throw new HttpFail(400, error instanceof Error ? error.message : String(error));
    }
    out.next_actions = parsed ? parsed.map((row) => ({ ...row })) : [];
  }
  return out;
}
export async function savePresentationOverlay(skillId: string, overlay: PresentationOverlay): Promise<void> {
  const next = await pgTransaction(async (db) => {
    const stored = await db.one("SELECT payload FROM skill_presentation_overlays WHERE skill_id=$1 FOR UPDATE", skillId) as {
      payload?: string;
    } | undefined;
    let current: PresentationOverlay = {};
    try {
      current = stored?.payload ? JSON.parse(stored.payload) as PresentationOverlay : {};
    }
    catch { /* corrupted historical payload is replaced only by validated publication */ }
  const next = { ...current, ...overlay };
    await db.execute(`INSERT INTO skill_presentation_overlays (skill_id,payload,updated_at) VALUES ($1,$2,$3)
     ON CONFLICT(skill_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`, skillId, JSON.stringify(next), nowIso());
    return next;
  });
  // Publish an immutable replacement only after the database write commits.
  // Synchronous task-registry reads therefore never issue database I/O.
  publishOverlaySnapshot(new Map(overlaySnapshot).set(skillId, next));
}
export function pickPresentationFields(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => (PRESENTATION_OVERLAY_FIELDS as readonly string[]).includes(key)));
}
setPresentationOverlaySource(presentationOverlaySnapshot);
onDatabaseReset(() => publishOverlaySnapshot(new Map()));
