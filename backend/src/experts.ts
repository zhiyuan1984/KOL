import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopedUser } from "./auth.js";
import { getConn, nowIso, tx } from "./db.js";
import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import type { Json } from "./types.js";

export type ExpertKind = "business" | "collector" | "governance";
export type ExpertPrimaryEntry = "think" | "job_console" | "approval_queue";

export type ExpertManifest = {
  id: string;
  version: string;
  status: string;
  display_name: string;
  profession: string;
  description: string;
  avatar: string;
  category: string;
  tags: string[];
  mission: string;
  quick_prompts: string[];
  entry_skill: string;
  kind: ExpertKind;
  primary_entry: ExpertPrimaryEntry;
  skill_ids: string[];
  tool_ids: string[];
};

const PUBLIC_FIELDS = [
  "id",
  "version",
  "status",
  "display_name",
  "profession",
  "description",
  "avatar",
  "category",
  "tags",
  "mission",
  "quick_prompts",
  "entry_skill",
  "kind",
  "primary_entry",
  "skill_ids",
  "tool_ids",
] as const;

const LIST_ORDER = ["expert:kol", "expert:crawler", "expert:approver"];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const expertsDir = path.join(repoRoot, "experts");

let cached: ExpertManifest[] | null = null;
const publishOverrides = new Map<string, boolean>();

function readJsonYaml<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function loadExperts(): ExpertManifest[] {
  if (cached) return cached;
  if (!fs.existsSync(expertsDir)) {
    cached = [];
    return cached;
  }
  const out: ExpertManifest[] = [];
  for (const name of fs.readdirSync(expertsDir)) {
    const file = path.join(expertsDir, name, "manifest.yaml");
    if (!fs.existsSync(file)) continue;
    out.push(readJsonYaml<ExpertManifest>(file));
  }
  cached = out;
  return out;
}

function sortExperts(items: ExpertManifest[]): ExpertManifest[] {
  return [...items].sort((a, b) => {
    const ai = LIST_ORDER.indexOf(a.id);
    const bi = LIST_ORDER.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

export function clearExpertCache(): void {
  cached = null;
}

/** Tests only. Temporarily stub published status without rewriting the manifest. */
export function setExpertPublishOverride(id: string, published?: boolean | null): void {
  if (published === undefined || published === null) publishOverrides.delete(id);
  else publishOverrides.set(id, published);
}

export function clearExpertPublishOverrides(): void {
  publishOverrides.clear();
}

export function expertPublished(manifest: ExpertManifest): boolean {
  const override = publishOverrides.get(manifest.id);
  if (override !== undefined) return override;
  return String(manifest.status || "") === "published";
}

export function findExpertManifest(id: string): ExpertManifest | undefined {
  const canonical = decodeURIComponent(String(id || "")).trim();
  return loadExperts().find((item) => item.id === canonical);
}

export function requireExpertManifest(id: string): ExpertManifest {
  const found = findExpertManifest(id);
  if (!found) throw new HttpFail(404, { code: "expert_not_found", message: "未找到该专家" });
  return found;
}

export function expertPublic(manifest: ExpertManifest): Json {
  const published = expertPublished(manifest);
  return {
    id: manifest.id,
    version: manifest.version,
    status: published ? "published" : (manifest.status || "unpublished"),
    display_name: manifest.display_name,
    profession: manifest.profession,
    description: manifest.description,
    avatar: manifest.avatar,
    category: manifest.category,
    tags: Array.isArray(manifest.tags) ? [...manifest.tags] : [],
    mission: manifest.mission,
    quick_prompts: Array.isArray(manifest.quick_prompts) ? [...manifest.quick_prompts] : [],
    entry_skill: manifest.entry_skill,
    kind: manifest.kind,
    primary_entry: manifest.primary_entry,
    skill_ids: Array.isArray(manifest.skill_ids) ? [...manifest.skill_ids] : [],
    tool_ids: Array.isArray(manifest.tool_ids) ? [...manifest.tool_ids] : [],
  };
}

export function listPublishedExperts(): Json[] {
  return sortExperts(loadExperts().filter(expertPublished)).map(expertPublic);
}

export function getPublishedExpert(id: string): Json {
  const manifest = requireExpertManifest(id);
  if (!expertPublished(manifest)) {
    throw new HttpFail(404, { code: "expert_not_found", message: "未找到该专家" });
  }
  return expertPublic(manifest);
}

function summonRejectDetail(manifest: ExpertManifest): Json {
  if (manifest.primary_entry === "job_console") {
    return {
      code: "expert_summon_not_allowed",
      message: "该数字员工不通过思考会话召唤，请使用任务控制台。",
      primary_entry: "job_console",
      next_action: "open_job_console",
    };
  }
  if (manifest.primary_entry === "approval_queue") {
    return {
      code: "expert_summon_not_allowed",
      message: "该数字员工不通过思考会话召唤，请使用审批队列。模型不得代人批准。",
      primary_entry: "approval_queue",
      next_action: "open_approval_queue",
    };
  }
  return {
    code: "expert_summon_not_allowed",
    message: "该数字员工不通过思考会话召唤。",
    primary_entry: manifest.primary_entry,
    next_action: "use_primary_entry",
  };
}

export function assertExpertSummonable(id: string): ExpertManifest {
  const manifest = requireExpertManifest(id);
  if (!expertPublished(manifest)) {
    throw new HttpFail(409, {
      code: "expert_not_published",
      message: "该专家尚未发布，员工端暂不可召唤",
      next_action: "等待管理员发布专家",
    });
  }
  if (manifest.primary_entry !== "think") {
    throw new HttpFail(409, summonRejectDetail(manifest));
  }
  return manifest;
}

export function expertIntro(manifest: ExpertManifest): string {
  return `你好，我是 ${manifest.display_name}。告诉我要跟进哪位红人或哪段合作，我来帮你看阶段、准备沟通。发信和改阶段需要你确认，我不会自己做。`;
}

export function expertAvatarPath(id: string): string {
  const manifest = requireExpertManifest(id);
  const slug = manifest.id.includes(":") ? manifest.id.split(":")[1] : manifest.id;
  return path.join(expertsDir, slug, "avatar.svg");
}

/**
 * Open a bound work session for a published expert whose primary entry is think.
 * Persists expert_id + expert_version. Does not send mail, write stage, or run LIVE.
 */
export function summonExpert(id: string): Json {
  const manifest = assertExpertSummonable(id);
  const sid = nid("ses");
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "INSERT INTO sessions (id, title, created_at, updated_at, kind, disabled, owner_user_id, expert_id, expert_version) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      sid,
      manifest.display_name,
      now,
      now,
      "work",
      0,
      scopedUser()?.id || null,
      manifest.id,
      manifest.version,
    );
  });
  return {
    session_id: sid,
    expert_id: manifest.id,
    expert_version: manifest.version,
    intro: expertIntro(manifest),
  };
}

export const EXPERT_PUBLIC_FIELDS = PUBLIC_FIELDS;
