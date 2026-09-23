/**
 * Admin-published skills: write SKILL.md into the data-dir pack, refresh catalog,
 * copy into the Codex extraRoots runtime, then grant so the next turn can load it.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, publishedSkillsDir } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
import { nid } from "../ids.js";
import {
  ALLOWED_TASK_MCP,
  TASK_FUNNELS,
  TASK_OUTPUTS,
  TASK_PROFILES,
  clearTaskRegistryCache,
  taskDefinition,
  validateDeclaredTaskContract,
  type TaskFunnel,
  type TaskInputField,
  type TaskMemoryPolicy,
  type TaskNextAction,
  type TaskOutput,
  type TaskProfileId,
  type TaskSupports,
} from "../tasks/registry.js";
import { HttpFail } from "./errors.js";
import { setSkillGrants } from "./grants.js";
import { currentUser } from "./persona.js";
import { clearSkillCatalogCache, skillFunnelId, type FunnelId, type SkillEntry } from "./skills-catalog.js";
import {
  catalogSkill,
  getSkillSop,
  isBundledSkill,
  runtimeSkillsRoot,
  writeRuntimeSkill,
} from "./skill-sop.js";

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
  next_actions?: TaskNextAction[] | string;
  memory_policy?: TaskMemoryPolicy | string;
  supports?: TaskSupports | string;
  permissions?: string[] | string;
  actions?: string[] | string;
  aliases?: string[] | string;
  in_market?: boolean;
  body?: string;
  grant_org?: boolean;
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
  "next_actions",
  "memory_policy",
  "supports",
  "permissions",
  "actions",
  "aliases",
  "body",
] as const;

function hasPackPatch(input: UpdateSkillInput): boolean {
  return PACK_FIELDS.some((key) => input[key] !== undefined);
}

function asList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function asJsonValue<T>(value: T | string | undefined, field: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new HttpFail(400, `${field} must be valid JSON`);
  }
}

function yamlScalar(value: string): string {
  return JSON.stringify(String(value).trim());
}

function ensureForbidden(body: string): string {
  const text = body.trim();
  if (/禁止/.test(text)) return text;
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
  next_actions?: TaskNextAction[];
  memory_policy?: TaskMemoryPolicy;
  supports?: TaskSupports;
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
    ...(input.next_actions ? [`next_actions: ${JSON.stringify(input.next_actions)}`] : []),
    ...(input.memory_policy ? [`memory_policy: ${JSON.stringify(input.memory_policy)}`] : []),
    ...(input.supports ? [`supports: ${JSON.stringify(input.supports)}`] : []),
    `in_market: ${input.in_market ? "true" : "false"}`,
  ];
  if (input.funnel) lines.push(`funnel: ${input.funnel}`);
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
  next_actions?: TaskNextAction[];
  memory_policy?: TaskMemoryPolicy;
  supports?: TaskSupports;
  in_market: boolean;
  body: string;
} {
  const id = String(input.id || "").trim();
  if (!ID_RE.test(id)) throw new HttpFail(400, "id must be snake_case, 2-40 chars");
  if (id === "inbound") throw new HttpFail(400, "reserved skill id");
  const title = String(input.title || "").trim();
  if (!title) throw new HttpFail(400, "title required");
  if (title.length > MAX_TITLE) throw new HttpFail(400, "title too long");
  const description = String(input.description || title).trim();
  if (description.length > MAX_DESCRIPTION) throw new HttpFail(400, "description too long");
  const category = String(input.category || "管理").trim() || "管理";
  const profile = String(input.profile || "commander") as TaskProfileId;
  if (!TASK_PROFILES.includes(profile)) throw new HttpFail(400, "unknown profile");
  const output = String(input.output || "task_result") as TaskOutput;
  if (!TASK_OUTPUTS.includes(output)) throw new HttpFail(400, "unknown output");
  const funnelRaw = String(input.funnel || skillFunnelId(id, category)).trim();
  if (!TASK_FUNNELS.includes(funnelRaw as TaskFunnel)) throw new HttpFail(400, "unknown funnel");
  const mcp = asList(input.mcp);
  for (const tool of mcp) {
    if (!ALLOWED_TASK_MCP.has(tool)) throw new HttpFail(400, `unapproved MCP tool ${tool}`);
  }
  const body = String(input.body || "").trim();
  if (!body) throw new HttpFail(400, "skill body required");
  if (body.length > MAX_BODY) throw new HttpFail(400, "skill body too long");
  const inputSchema = asJsonValue<TaskInputField[]>(input.input_schema, "input_schema");
  const nextActions = asJsonValue<TaskNextAction[]>(input.next_actions, "next_actions");
  const memoryPolicy = asJsonValue<TaskMemoryPolicy>(input.memory_policy, "memory_policy");
  const supports = asJsonValue<TaskSupports>(input.supports, "supports");
  const resultType = input.result_type === undefined ? undefined : String(input.result_type).trim();
  const actions = asList(input.actions).length ? asList(input.actions) : ["analyze"];
  try {
    validateDeclaredTaskContract({
      required_inputs: asList(input.required_inputs),
      ...(inputSchema ? { input_schema: inputSchema } : {}),
      ...(resultType ? { result_type: resultType } : {}),
      ...(nextActions ? { next_actions: nextActions } : {}),
      ...(memoryPolicy ? { memory_policy: memoryPolicy } : {}),
      ...(supports ? { supports } : {}),
      actions,
    });
  } catch (error) {
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
    next_actions: nextActions,
    memory_policy: memoryPolicy,
    supports,
    in_market: input.in_market !== false,
    body,
  };
}

function setMarketFlag(id: string, inMarket: boolean): void {
  getConn()
    .prepare(
      "INSERT INTO skill_flags (id, in_market, updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET in_market=excluded.in_market, updated_at=excluded.updated_at",
    )
    .run(id, inMarket ? 1 : 0, nowIso());
}

function grantDefaultOrg(id: string): void {
  const org = getConn().prepare("SELECT id FROM orgs WHERE id = ?").get("org_litime") as { id: string } | undefined;
  if (!org) return;
  setSkillGrants(id, { org: ["org_litime"], team: [], user: [] });
}

export function activateSkillForHarness(id: string): string {
  clearTaskRegistryCache();
  if (!catalogSkill(id)) throw new HttpFail(404, "unknown skill");
  return writeRuntimeSkill(id);
}

export function createPublishedSkill(input: CreateSkillInput): SkillEntry {
  const spec = normalizeCreate(input);
  if (catalogSkill(spec.id) || isBundledSkill(spec.id)) {
    throw new HttpFail(409, "skill already exists");
  }
  const dir = path.join(publishedSkillsDir(), spec.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), formatSkillMarkdown(spec), "utf8");
  getConn()
    .prepare("INSERT INTO skill_stage_history (id, skill_id, from_stage, to_stage, operator, reason, at) VALUES (?,?,?,?,?,?,?)")
    .run(nid("ssh"), spec.id, null, "draft", currentUser().handle, "created", nowIso());
  setMarketFlag(spec.id, spec.in_market);
  const runtimePath = activateSkillForHarness(spec.id);
  if (input.grant_org !== false) grantDefaultOrg(spec.id);
  audit(currentUser().handle, "skill.create", {
    skill: spec.id,
    in_market: spec.in_market,
    runtime: runtimePath,
    extra_roots: runtimeSkillsRoot(),
  });
  const created = catalogSkill(spec.id);
  if (!created) throw new HttpFail(500, "skill catalog did not pick up the new skill");
  return created;
}

export function setSkillInMarket(id: string, inMarket: boolean): SkillEntry {
  if (!catalogSkill(id)) throw new HttpFail(404, "unknown skill");
  setMarketFlag(id, inMarket);
  clearSkillCatalogCache();
  activateSkillForHarness(id);
  audit(currentUser().handle, "skill.market", { skill: id, in_market: inMarket });
  return catalogSkill(id)!;
}

export function updatePublishedSkill(id: string, input: UpdateSkillInput): SkillEntry {
  const current = catalogSkill(id);
  if (!current) throw new HttpFail(404, "unknown skill");
  if (!hasPackPatch(input)) {
    if (typeof input.in_market !== "boolean") throw new HttpFail(400, "in_market required");
    return setSkillInMarket(id, input.in_market);
  }
  if (isBundledSkill(id)) throw new HttpFail(400, "bundled skills cannot rewrite pack; use SOP overlay");
  const def = taskDefinition(id);
  const sop = getSkillSop(id);
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
    next_actions: input.next_actions ?? def?.next_actions,
    memory_policy: input.memory_policy ?? def?.memory_policy,
    supports: input.supports ?? def?.supports,
    in_market: typeof input.in_market === "boolean" ? input.in_market : current.in_market,
    body: input.body ?? sop.body,
  });
  const dir = path.join(publishedSkillsDir(), spec.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), formatSkillMarkdown(spec), "utf8");
  if (input.body !== undefined) {
    getConn().prepare("DELETE FROM skill_sops WHERE id = ?").run(id);
  }
  setMarketFlag(spec.id, spec.in_market);
  clearSkillCatalogCache();
  const runtimePath = activateSkillForHarness(spec.id);
  audit(currentUser().handle, "skill.update", {
    skill: spec.id,
    in_market: spec.in_market,
    runtime: runtimePath,
  });
  return catalogSkill(spec.id)!;
}

export function deletePublishedSkill(id: string): { ok: true; id: string } {
  if (!catalogSkill(id)) throw new HttpFail(404, "unknown skill");
  if (isBundledSkill(id)) throw new HttpFail(400, "bundled skills cannot be deleted");
  getConn().prepare("DELETE FROM skill_sops WHERE id = ?").run(id);
  getConn().prepare("DELETE FROM skill_flags WHERE id = ?").run(id);
  getConn().prepare("DELETE FROM skill_grants WHERE skill_id = ?").run(id);
  getConn().prepare("DELETE FROM skill_lifecycle WHERE skill_id = ?").run(id);
  getConn().prepare("DELETE FROM skill_versions WHERE skill_id = ?").run(id);
  getConn().prepare("DELETE FROM skill_tests WHERE skill_id = ?").run(id);
  getConn().prepare("DELETE FROM skill_test_runs WHERE skill_id = ?").run(id);
  getConn().prepare("DELETE FROM skill_stage_history WHERE skill_id = ?").run(id);
  fs.rmSync(path.join(publishedSkillsDir(), id), { recursive: true, force: true });
  fs.rmSync(path.join(runtimeSkillsRoot(), id), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir(), "skill-versions", id), { recursive: true, force: true });
  clearTaskRegistryCache();
  clearSkillCatalogCache();
  audit(currentUser().handle, "skill.delete", { skill: id });
  return { ok: true, id };
}

export function skillAdminMeta(): {
  profiles: readonly string[];
  outputs: readonly string[];
  funnels: readonly string[];
  mcp: string[];
} {
  return {
    profiles: TASK_PROFILES,
    outputs: TASK_OUTPUTS,
    funnels: TASK_FUNNELS,
    mcp: [...ALLOWED_TASK_MCP].sort(),
  };
}
