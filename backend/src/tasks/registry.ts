import fs from "node:fs";
import path from "node:path";
import { publishedSkillsDir, skillsDir } from "../config.js";

export const TASK_PROFILES = [
  "commander",
  "lead",
  "opportunity",
  "negotiation",
  "execution",
  "settlement-growth",
] as const;

export type TaskProfileId = (typeof TASK_PROFILES)[number];
export const TASK_OUTPUTS = ["crawl_plan", "task_result", "propose_stage", "kol_analyze_brief", "today_brief"] as const;
export const TASK_SIDE_EFFECTS = ["none", "write"] as const;
export type TaskSideEffects = (typeof TASK_SIDE_EFFECTS)[number];
export type TaskOutput = (typeof TASK_OUTPUTS)[number];
export const TASK_FUNNELS = ["reach", "intent", "biz", "sample", "content", "settle", "exception"] as const;
export type TaskFunnel = (typeof TASK_FUNNELS)[number];
export type TaskSource = "bundled" | "published";

export type TaskDefinition = {
  id: string;
  title: string;
  description: string;
  category: string;
  profile: TaskProfileId;
  output: TaskOutput;
  mcp: string[];
  required_inputs: string[];
  permissions: string[];
  actions: string[];
  aliases: string[];
  in_market: boolean;
  funnel?: TaskFunnel;
  side_effects: TaskSideEffects;
  creates_session: boolean;
  auto_ok: boolean;
  source: TaskSource;
  path: string;
};

export const ALLOWED_TASK_MCP = new Set([
  "starry.get_collaboration",
  "starry.list_collaborations",
  "starry.deal_memory",
  "starrykol.pageMailboxes",
  "starrykol.listNylasAccounts",
  "starrykol.pageEmailConversations",
  "starrykol.getMailboxDetail",
  "starrykol.getEmailConversation",
  "starrykol.previewEmailDraft",
  "starrykol.pageKolProfiles",
  "starrykol.listAllKolProfiles",
  "starrykol.getKolProfileDetail",
  "starrykol.updateKolProfile",
  "starrykol.addKolProfile",
  "starrykol.listKolPlatformData",
  "starrykol.getKolProfileSidebarMetrics",
  "starrykol.decryptKolContact",
  "starrykol.pageLifecycleKanban",
  "starrykol.pageRiskConversations",
  "starrykol.summarizeRiskConversations",
  "starrykol.listDictionaryOptions",
  "starrykol.listCooperationStageOptions",
  "starrykol.listRiskTagOptions",
  "starrykol.pageAppEmailConversations",
  "starrykol.translateEmailToChinese",
  "starrykol.getStageRiskMatrix",
  "starrykol.getEmailConversationSubjectGroups",
  "kolclaw.analyze_creator",
  "kolclaw.analyze_creators",
  "kolclaw.generate_outreach_script",
  "kolclaw.get_daily_tasks",
  "kolclaw.get_budget_report",
  "kolclaw.list_creators",
]);

const REQUIRED = [
  "id",
  "title",
  "description",
  "category",
  "profile",
  "output",
  "mcp",
  "required_inputs",
  "permissions",
  "actions",
] as const;

let cached: { signature: string; definitions: readonly TaskDefinition[] } | null = null;

function parseValue(raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      return parsed;
    } catch (error) {
      throw new Error(`invalid manifest array ${value}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

function frontmatter(file: string): Record<string, unknown> {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new Error(`skill manifest missing frontmatter: ${file}`);
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) throw new Error(`skill manifest frontmatter is not closed: ${file}`);
  const values: Record<string, unknown> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`invalid manifest line in ${file}: ${line}`);
    const key = line.slice(0, separator).trim();
    if (key in values) throw new Error(`duplicate manifest field ${key}: ${file}`);
    values[key] = parseValue(line.slice(separator + 1));
  }
  return values;
}

function stringArray(value: unknown, field: string, file: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`manifest ${field} must be a string array: ${file}`);
  }
  return value.map(String);
}

function parseDefinition(file: string, folder: string, source: TaskSource): TaskDefinition {
  const values = frontmatter(file);
  for (const field of REQUIRED) {
    if (!(field in values)) throw new Error(`manifest missing ${field}: ${file}`);
  }
  for (const field of ["id", "title", "description", "category", "profile", "output"] as const) {
    if (typeof values[field] !== "string" || !String(values[field]).trim()) {
      throw new Error(`manifest ${field} must be a non-empty string: ${file}`);
    }
  }
  const id = String(values.id);
  if (!/^[a-z][a-z0-9_]*$/.test(id) || id !== folder) {
    throw new Error(`manifest id must match its skill directory: ${file}`);
  }
  if (!TASK_PROFILES.includes(values.profile as TaskProfileId)) {
    throw new Error(`manifest has unknown profile ${String(values.profile)}: ${file}`);
  }
  if (!TASK_OUTPUTS.includes(values.output as TaskOutput)) {
    throw new Error(`manifest has unknown output ${String(values.output)}: ${file}`);
  }
  let sideEffects: TaskSideEffects = "none";
  if (values.side_effects !== undefined) {
    if (!TASK_SIDE_EFFECTS.includes(values.side_effects as TaskSideEffects)) {
      throw new Error(`manifest has unknown side_effects ${String(values.side_effects)}: ${file}`);
    }
    sideEffects = values.side_effects as TaskSideEffects;
  }
  if (values.creates_session !== undefined && typeof values.creates_session !== "boolean") {
    throw new Error(`manifest creates_session must be a boolean: ${file}`);
  }
  if (values.auto_ok !== undefined && typeof values.auto_ok !== "boolean") {
    throw new Error(`manifest auto_ok must be a boolean: ${file}`);
  }
  let funnel: TaskFunnel | undefined;
  if (values.funnel !== undefined) {
    if (!TASK_FUNNELS.includes(values.funnel as TaskFunnel)) {
      throw new Error(`manifest has unknown funnel ${String(values.funnel)}: ${file}`);
    }
    funnel = values.funnel as TaskFunnel;
  }
  const mcp = stringArray(values.mcp, "mcp", file);
  for (const tool of mcp) {
    if (!ALLOWED_TASK_MCP.has(tool)) throw new Error(`manifest exposes unapproved MCP tool ${tool}: ${file}`);
  }
  return Object.freeze({
    id,
    title: String(values.title),
    description: String(values.description),
    category: String(values.category),
    profile: values.profile as TaskProfileId,
    output: values.output as TaskOutput,
    mcp: Object.freeze([...new Set(mcp)]) as unknown as string[],
    required_inputs: Object.freeze(stringArray(values.required_inputs, "required_inputs", file)) as unknown as string[],
    permissions: Object.freeze(stringArray(values.permissions, "permissions", file)) as unknown as string[],
    actions: Object.freeze(stringArray(values.actions, "actions", file)) as unknown as string[],
    aliases: Object.freeze(
      values.aliases === undefined ? [] : stringArray(values.aliases, "aliases", file),
    ) as unknown as string[],
    in_market: values.in_market === undefined ? true : values.in_market === true,
    funnel,
    side_effects: sideEffects,
    creates_session: values.creates_session === true,
    auto_ok: values.auto_ok === true,
    source,
    path: path.resolve(file),
  });
}

function skillFiles(root: string): { folder: string; file: string; stamp: string }[] {
  if (!fs.existsSync(root)) return [];
  const resolvedRoot = path.resolve(root);
  const realRoot = fs.realpathSync(resolvedRoot);
  return fs.readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const file = path.resolve(resolvedRoot, entry.name, "SKILL.md");
      if (!file.startsWith(`${resolvedRoot}${path.sep}`) || !fs.existsSync(file)) {
        throw new Error(`skill directory must contain SKILL.md: ${entry.name}`);
      }
      const realFile = fs.realpathSync(file);
      if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
        throw new Error(`skill manifest escapes the skills root: ${file}`);
      }
      const stat = fs.statSync(file);
      return {
        folder: entry.name,
        file,
        stamp: `${realFile}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`,
      };
    })
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

function combinedSkillFiles(): { folder: string; file: string; stamp: string; source: TaskSource }[] {
  const bundled = skillFiles(skillsDir()).map((entry) => ({ ...entry, source: "bundled" as const }));
  const bundledIds = new Set(bundled.map((entry) => entry.folder));
  const published = skillFiles(publishedSkillsDir())
    .filter((entry) => !bundledIds.has(entry.folder))
    .map((entry) => ({ ...entry, source: "published" as const }));
  return [...bundled, ...published].sort((a, b) => a.folder.localeCompare(b.folder));
}

export function taskDefinitions(root?: string): readonly TaskDefinition[] {
  const usingDefault = root === undefined || root === skillsDir();
  const files = usingDefault
    ? combinedSkillFiles()
    : skillFiles(root).map((entry) => ({ ...entry, source: "bundled" as const }));
  const signature = files.map((entry) => `${entry.source}:${entry.stamp}`).join("|");
  if (usingDefault && cached?.signature === signature) return cached.definitions;
  const definitions = files.map((entry) => parseDefinition(entry.file, entry.folder, entry.source));
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`duplicate task definition id: ${definition.id}`);
    ids.add(definition.id);
  }
  const frozen = Object.freeze(definitions);
  if (usingDefault) cached = { signature, definitions: frozen };
  return frozen;
}

export function taskDefinition(id: string): TaskDefinition | undefined {
  return taskDefinitions().find((definition) => definition.id === id);
}

export function requireTaskDefinition(id: string): TaskDefinition {
  const definition = taskDefinition(id);
  if (!definition) throw new Error(`unknown task type: ${id}`);
  return definition;
}

export function clearTaskRegistryCache(): void {
  cached = null;
}
