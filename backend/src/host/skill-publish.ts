/**
 * Admin-published skills: write SKILL.md into the data-dir pack, refresh catalog,
 * copy into the Codex extraRoots runtime. People gain access only through an Agent.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, publishedSkillsDir } from "../config.js";
import { audit, postgresDb, nowIso } from "../postgres/access.js";
import { nid } from "../ids.js";
import { MCP_TOOL_REFERENCE, PRESENTATION_OVERLAY_FIELDS, validatePresentationValue, TASK_FUNNELS, TASK_OUTPUTS, TASK_PROFILES, clearTaskRegistryCache, taskDefinition, validateDeclaredTaskContract, type TaskFunnel, type TaskInputField, type TaskMemoryPolicy, type TaskNextAction, type TaskOutput, type TaskProfileId, type TaskResultSchema, type TaskSupports, } from "../tasks/registry.js";
import { HttpFail } from "./errors.js";
import { registeredToolCatalog } from "../runtime/skill-coverage.js";
import { normalizePresentationPatch, pickPresentationFields, savePresentationOverlay } from "./skill-presentation.js";
import { currentUser } from "./persona.js";
import { clearSkillCatalogCache, skillCatalog, skillFunnelId, type FunnelId, type SkillEntry } from "./skills-catalog.js";
import { catalogSkill, getSkillSop, isBundledSkill, runtimeSkillsRoot, saveSkillSop, writeRuntimeSkill, } from "./skill-sop.js";
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 200;
const MAX_BODY = 32000;
const ID_RE = /^[a-z][a-z0-9_]{1,39}$/;

export type CreateSkillInput = {
  id?: string;
  title?: string;
  description?: string;
  category?: string;
  profile?: string;
  output?: string;
  funnel?: string;
  mcp?: string[] | string;
  required_inputs?: string[] | string;
  input_schema?: TaskInputField[] | string;
  result_type?: string;
  result_schema?: TaskResultSchema | string;
  next_actions?: TaskNextAction[] | string;
  memory_policy?: TaskMemoryPolicy | string;
  supports?: TaskSupports | string;
  permissions?: string[] | string;
  actions?: string[] | string;
  aliases?: string[] | string;
  icon?: string;
  badge?: string;
  starter?: string;
  result_title?: string;
  in_market?: boolean;
  body?: string;
  grant_org?: boolean; // accepted for older callers; no longer creates personnel grants
};

export type UpdateSkillInput = Omit<CreateSkillInput, "id" | "grant_org">;

const PACK_FIELDS = [
  "title",
  "description",
  "category",
  "profile",
  "output",
  "funnel",
  "mcp",
  "required_inputs",
  "input_schema",
  "result_type",
  "result_schema",
  "next_actions",
  "memory_policy",
  "supports",
  "permissions",
  "actions",
  "aliases",
  "icon",
  "badge",
  "starter",
  "result_title",
  "body",
] as const;

function hasPackPatch(input: UpdateSkillInput): boolean {
  return PACK_FIELDS.some((key) => input[key] !== undefined);
}
function asList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value))
    return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function asJsonValue<T>(value: T | string | undefined, field: string): T | undefined {
  if (value === undefined)
    return undefined;
  if (typeof value !== "string")
    return value;
  try {
    return JSON.parse(value) as T;
  }
  catch {
    throw new HttpFail(400, `${field} must be valid JSON`);
  }
}

function yamlScalar(value: string): string {
  return JSON.stringify(String(value).trim());
}
function ensureForbidden(body: string): string {
  const text = body.trim();
  if (/禁止/.test(text))
    return text;
  return `${text}\n\n## 禁止事项\n\n- 禁止发送消息。\n- 禁止修改阶段。\n`;
}
export function formatSkillMarkdown(input: {
  id: string;
  title: string;
  description: string;
  category: string;
  profile: string;
  output: string;
  funnel?: string;
  mcp: string[];
  required_inputs: string[];
  permissions: string[];
  actions: string[];
  aliases: string[];
  input_schema?: TaskInputField[];
  result_type?: string;
  result_schema?: TaskResultSchema;
  next_actions?: TaskNextAction[];
  memory_policy?: TaskMemoryPolicy;
  supports?: TaskSupports;
  icon?: string;
  badge?: string;
  starter?: string;
  result_title?: string;
  in_market: boolean;
  body: string;
}): string {
  const lines = [
    "---",
    `id: ${input.id}`,
    `title: ${yamlScalar(input.title)}`,
    `description: ${yamlScalar(input.description)}`,
    `category: ${yamlScalar(input.category)}`,
    `profile: ${input.profile}`,
    `output: ${input.output}`,
    `mcp: ${JSON.stringify(input.mcp)}`,
    `required_inputs: ${JSON.stringify(input.required_inputs)}`,
    `permissions: ${JSON.stringify(input.permissions)}`,
    `actions: ${JSON.stringify(input.actions)}`,
    `aliases: ${JSON.stringify(input.aliases)}`,
    ...(input.input_schema ? [`input_schema: ${JSON.stringify(input.input_schema)}`] : []),
    ...(input.result_type ? [`result_type: ${input.result_type}`] : []),
    ...(input.result_schema ? [`result_schema: ${JSON.stringify(input.result_schema)}`] : []),
    ...(input.next_actions ? [`next_actions: ${JSON.stringify(input.next_actions)}`] : []),
    ...(input.memory_policy ? [`memory_policy: ${JSON.stringify(input.memory_policy)}`] : []),
    ...(input.supports ? [`supports: ${JSON.stringify(input.supports)}`] : []),
    ...(input.icon ? [`icon: ${input.icon}`] : []),
    ...(input.badge ? [`badge: ${yamlScalar(input.badge)}`] : []),
    ...(input.starter ? [`starter: ${yamlScalar(input.starter)}`] : []),
    ...(input.result_title ? [`result_title: ${yamlScalar(input.result_title)}`] : []),
    `in_market: ${input.in_market ? "true" : "false"}`,
  ];
  if (input.funnel)
    lines.push(`funnel: ${input.funnel}`);
  lines.push("---", "", ensureForbidden(input.body).trim(), "");
  return lines.join("\n");
}

function normalizeCreate(input: CreateSkillInput): {
  id: string;
  title: string;
  description: string;
  category: string;
  profile: TaskProfileId;
  output: TaskOutput;
  funnel: FunnelId;
  mcp: string[];
  required_inputs: string[];
  permissions: string[];
  actions: string[];
  aliases: string[];
  input_schema?: TaskInputField[];
  result_type?: string;
  result_schema?: TaskResultSchema;
  next_actions?: TaskNextAction[];
  memory_policy?: TaskMemoryPolicy;
  supports?: TaskSupports;
  icon?: string;
  badge?: string;
  starter?: string;
  result_title?: string;
  in_market: boolean;
  body: string;
} {
  const id = String(input.id || "").trim();
  if (!ID_RE.test(id))
    throw new HttpFail(400, "id must be snake_case, 2-40 chars");
  if (id === "inbound")
    throw new HttpFail(400, "reserved skill id");
  const title = String(input.title || "").trim();
  if (!title)
    throw new HttpFail(400, "title required");
  if (title.length > MAX_TITLE)
    throw new HttpFail(400, "title too long");
  const description = String(input.description || title).trim();
  if (description.length > MAX_DESCRIPTION)
    throw new HttpFail(400, "description too long");
  const category = String(input.category || "管理").trim() || "管理";
  const profile = String(input.profile || "commander") as TaskProfileId;
  if (!TASK_PROFILES.includes(profile))
    throw new HttpFail(400, "unknown profile");
  const output = String(input.output || "task_result") as TaskOutput;
  if (!TASK_OUTPUTS.includes(output))
    throw new HttpFail(400, "unknown output");
  const funnelRaw = String(input.funnel || skillFunnelId(id, category)).trim();
  if (!TASK_FUNNELS.includes(funnelRaw as TaskFunnel))
    throw new HttpFail(400, "unknown funnel");
  const mcp = asList(input.mcp);
  for (const tool of mcp) {
    if (!MCP_TOOL_REFERENCE.test(tool))
      throw new HttpFail(400, `invalid MCP tool reference ${tool}`);
  }
  const body = String(input.body || "").trim();
  if (!body)
    throw new HttpFail(400, "skill body required");
  if (body.length > MAX_BODY)
    throw new HttpFail(400, "skill body too long");
  const inputSchema = asJsonValue<TaskInputField[]>(input.input_schema, "input_schema");
  const nextActions = asJsonValue<TaskNextAction[]>(input.next_actions, "next_actions");
  const memoryPolicy = asJsonValue<TaskMemoryPolicy>(input.memory_policy, "memory_policy");
  const supports = asJsonValue<TaskSupports>(input.supports, "supports");
  const resultType = input.result_type === undefined ? undefined : String(input.result_type).trim();
  const resultSchema = asJsonValue<TaskResultSchema>(input.result_schema, "result_schema");
  const actions = asList(input.actions).length ? asList(input.actions) : ["analyze"];
  const presentation: {
    icon?: string;
    badge?: string;
    starter?: string;
    result_title?: string;
  } = {};
  for (const key of ["icon", "badge", "starter", "result_title"] as const) {
    const value = input[key];
    if (value === undefined || value === null || String(value).trim() === "")
      continue;
    try {
      presentation[key] = validatePresentationValue(key, value, id);
    }
    catch (error) {
      throw new HttpFail(400, error instanceof Error ? error.message : `invalid ${key}`);
    }
  }
  try {
    validateDeclaredTaskContract({
      id,
      required_inputs: asList(input.required_inputs),
      ...(inputSchema ? { input_schema: inputSchema } : {}),
      ...(resultType ? { result_type: resultType } : {}),
      ...(resultSchema ? { result_schema: resultSchema } : {}),
      ...(nextActions ? { next_actions: nextActions } : {}),
      ...(memoryPolicy ? { memory_policy: memoryPolicy } : {}),
      ...(supports ? { supports } : {}),
      actions,
    });
  }
  catch (error) {
    throw new HttpFail(400, error instanceof Error ? error.message : "invalid skill contract");
  }
  return {
    id,
    title,
    description,
    category,
    profile,
    output,
    funnel: funnelRaw as FunnelId,
    mcp,
    required_inputs: asList(input.required_inputs),
    permissions: asList(input.permissions),
    actions,
    aliases: asList(input.aliases),
    input_schema: inputSchema,
    result_type: resultType,
    result_schema: resultSchema,
    next_actions: nextActions,
    memory_policy: memoryPolicy,
    supports,
    ...presentation,
    in_market: input.in_market !== false,
    body,
  };
}
async function setMarketFlag(id: string, inMarket: boolean): Promise<void> {
  (await postgresDb().execute("INSERT INTO skill_flags (id, in_market, updated_at) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET in_market=excluded.in_market, updated_at=excluded.updated_at", id, inMarket ? 1 : 0, nowIso()));
}
export async function activateSkillForHarness(id: string): Promise<string> {
  clearTaskRegistryCache();
  clearSkillCatalogCache();
  await skillCatalog();
  if (!catalogSkill(id))
    throw new HttpFail(404, "unknown skill");
  return (await writeRuntimeSkill(id));
}
export async function createPublishedSkill(input: CreateSkillInput): Promise<SkillEntry> {
  const spec = normalizeCreate(input);
  if (catalogSkill(spec.id) || isBundledSkill(spec.id)) {
    throw new HttpFail(409, "skill already exists");
  }
  const dir = path.join(publishedSkillsDir(), spec.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), formatSkillMarkdown(spec), "utf8");
  (await postgresDb().execute("INSERT INTO skill_stage_history (id, skill_id, from_stage, to_stage, operator, reason, at) VALUES ($1,$2,$3,$4,$5,$6,$7)", nid("ssh"), spec.id, null, "draft", (await currentUser()).handle, "created", nowIso()));
  (await setMarketFlag(spec.id, spec.in_market));
  const runtimePath = await activateSkillForHarness(spec.id);
  (await audit((await currentUser()).handle, "skill.create", {
    skill: spec.id,
    in_market: spec.in_market,
    runtime: runtimePath,
    extra_roots: runtimeSkillsRoot(),
  }));
  const created = catalogSkill(spec.id);
  if (!created)
    throw new HttpFail(500, "skill catalog did not pick up the new skill");
  return created;
}
export async function setSkillInMarket(id: string, inMarket: boolean): Promise<SkillEntry> {
  if (!catalogSkill(id))
    throw new HttpFail(404, "unknown skill");
  (await setMarketFlag(id, inMarket));
  clearSkillCatalogCache();
  await activateSkillForHarness(id);
  (await audit((await currentUser()).handle, "skill.market", { skill: id, in_market: inMarket }));
  return catalogSkill(id)!;
}
export async function updatePublishedSkill(id: string, input: UpdateSkillInput): Promise<SkillEntry> {
  const current = catalogSkill(id);
  if (!current)
    throw new HttpFail(404, "unknown skill");
  if (!hasPackPatch(input)) {
    if (typeof input.in_market !== "boolean")
      throw new HttpFail(400, "in_market required");
    return (await setSkillInMarket(id, input.in_market));
  }
  if (isBundledSkill(id))
    throw new HttpFail(400, "bundled skills cannot rewrite pack; use SOP overlay");
  const def = taskDefinition(id);
  const sop = (await getSkillSop(id));
  const spec = normalizeCreate({
    id,
    title: input.title ?? current.label,
    description: input.description ?? current.summary,
    category: input.category ?? current.category,
    profile: input.profile ?? current.profile,
    output: input.output ?? def?.output,
    funnel: input.funnel ?? current.funnel,
    mcp: input.mcp ?? def?.mcp,
    required_inputs: input.required_inputs ?? def?.required_inputs,
    permissions: input.permissions ?? def?.permissions,
    actions: input.actions ?? def?.actions,
    aliases: input.aliases ?? current.aliases,
    input_schema: input.input_schema ?? def?.input_schema,
    result_type: input.result_type ?? def?.result_type,
    result_schema: input.result_schema ?? def?.result_schema,
    next_actions: input.next_actions ?? def?.next_actions,
    memory_policy: input.memory_policy ?? def?.memory_policy,
    supports: input.supports ?? def?.supports,
    icon: input.icon ?? def?.icon,
    badge: input.badge ?? def?.badge,
    starter: input.starter ?? def?.starter,
    result_title: input.result_title ?? def?.result_title,
    in_market: typeof input.in_market === "boolean" ? input.in_market : current.in_market,
    body: input.body ?? sop.body,
  });
  const dir = path.join(publishedSkillsDir(), spec.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), formatSkillMarkdown(spec), "utf8");
  if (input.body !== undefined) {
    (await postgresDb().execute("DELETE FROM skill_sops WHERE id = $1", id));
  }
  (await setMarketFlag(spec.id, spec.in_market));
  clearSkillCatalogCache();
  const runtimePath = await activateSkillForHarness(spec.id);
  (await audit((await currentUser()).handle, "skill.update", {
    skill: spec.id,
    in_market: spec.in_market,
    runtime: runtimePath,
  }));
  return catalogSkill(spec.id)!;
}
export type SkillDraft = {
  id: string;
  patch: Record<string, unknown>;
  updated_at: string | null;
};
const SOP_DRAFT_FIELDS = ["_sop_summary", "_sop_body"] as const;
export async function getSkillDraft(id: string): Promise<SkillDraft> {
  if (!catalogSkill(id))
    throw new HttpFail(404, "unknown skill");
  const row = (await postgresDb().one("SELECT payload, updated_at FROM skill_drafts WHERE skill_id=$1", id)) as {
    payload: string;
    updated_at: string;
  } | undefined;
  return { id, patch: row ? JSON.parse(row.payload) as Record<string, unknown> : {}, updated_at: row?.updated_at || null };
}
/** Persist candidate edits without changing the catalog, runtime pack, or employee-visible version. */
export async function saveSkillDraft(id: string, patch: Record<string, unknown>): Promise<SkillDraft> {
  if (!catalogSkill(id))
    throw new HttpFail(404, "unknown skill");
  const bundled = isBundledSkill(id);
  const allowed = new Set<string>(bundled ? [...SOP_DRAFT_FIELDS, ...PRESENTATION_OVERLAY_FIELDS] : PACK_FIELDS);
  const clean = Object.fromEntries(Object.entries(patch).filter(([key, value]) => allowed.has(key) && value !== undefined));
  if (!Object.keys(clean).length)
    throw new HttpFail(400, "no editable skill fields supplied");
  if (bundled)
    normalizePresentationPatch(id, pickPresentationFields(clean), taskDefinition(id)?.actions);
  const previous = (await getSkillDraft(id));
  const payload = { ...previous.patch, ...clean };
  const updatedAt = nowIso();
  (await postgresDb().execute("INSERT INTO skill_drafts (skill_id,payload,updated_at) VALUES ($1,$2,$3) ON CONFLICT(skill_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at", id, JSON.stringify(payload), updatedAt));
  (await audit((await currentUser()).handle, "skill.draft.save", { skill: id, fields: Object.keys(clean) }));
  return { id, patch: payload, updated_at: updatedAt };
}
/** Apply an already-saved candidate only from the release path. */
export async function applySkillDraft(id: string): Promise<{
  applied: boolean;
}> {
  const draft = (await getSkillDraft(id));
  if (!Object.keys(draft.patch).length)
    return { applied: false };
  if (isBundledSkill(id)) {
    const current = (await getSkillSop(id));
    if (draft.patch._sop_summary !== undefined || draft.patch._sop_body !== undefined) {
      (await saveSkillSop(id, {
        summary: String(draft.patch._sop_summary ?? current.summary),
        body: String(draft.patch._sop_body ?? current.body),
      }));
    }
    const presentation = pickPresentationFields(draft.patch);
    if (Object.keys(presentation).length) {
      (await savePresentationOverlay(id, normalizePresentationPatch(id, presentation, taskDefinition(id)?.actions)));
      clearSkillCatalogCache();
      await activateSkillForHarness(id);
    }
    }
  else {
    const packPatch = Object.fromEntries(Object.entries(draft.patch).filter(([key]) => !SOP_DRAFT_FIELDS.includes(key as typeof SOP_DRAFT_FIELDS[number])));
    if (Object.keys(packPatch).length)
      (await updatePublishedSkill(id, packPatch as UpdateSkillInput));
  }
  (await postgresDb().execute("DELETE FROM skill_drafts WHERE skill_id=$1", id));
  (await audit((await currentUser()).handle, "skill.draft.apply", { skill: id }));
  return { applied: true };
}
export async function deletePublishedSkill(id: string): Promise<{
  ok: true;
  id: string;
}> {
  if (!catalogSkill(id))
    throw new HttpFail(404, "unknown skill");
  if (isBundledSkill(id))
    throw new HttpFail(400, "bundled skills cannot be deleted");
  (await postgresDb().execute("DELETE FROM skill_sops WHERE id = $1", id));
  (await postgresDb().execute("DELETE FROM skill_flags WHERE id = $1", id));
  (await postgresDb().execute("DELETE FROM skill_grants WHERE skill_id = $1", id));
  (await postgresDb().execute("DELETE FROM skill_lifecycle WHERE skill_id = $1", id));
  (await postgresDb().execute("DELETE FROM skill_drafts WHERE skill_id = $1", id));
  (await postgresDb().execute("DELETE FROM skill_versions WHERE skill_id = $1", id));
  (await postgresDb().execute("DELETE FROM skill_tests WHERE skill_id = $1", id));
  (await postgresDb().execute("DELETE FROM skill_test_runs WHERE skill_id = $1", id));
  (await postgresDb().execute("DELETE FROM skill_stage_history WHERE skill_id = $1", id));
  fs.rmSync(path.join(publishedSkillsDir(), id), { recursive: true, force: true });
  fs.rmSync(path.join(runtimeSkillsRoot(), id), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir(), "skill-versions", id), { recursive: true, force: true });
  clearTaskRegistryCache();
  clearSkillCatalogCache();
  await skillCatalog();
  (await audit((await currentUser()).handle, "skill.delete", { skill: id }));
  return { ok: true, id };
}
export async function skillAdminMeta(): Promise<{
  profiles: readonly string[];
  outputs: readonly string[];
  funnels: readonly string[];
  mcp: string[];
}> {
  return {
    profiles: TASK_PROFILES,
    outputs: TASK_OUTPUTS,
    funnels: TASK_FUNNELS,
    mcp: (await registeredToolCatalog()),
  };
}
