import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAdmin, scopedUser } from "./auth.js";
import { getConn, nowIso, tx } from "./db.js";
import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import type { Json } from "./types.js";

export type ExpertPublishGate = { state?: string };
export type ExpertPermissions = {
  declaration?: string;
  policy_refs?: string[];
};

export type ExpertManifest = {
  id: string;
  version?: string;
  title: string;
  role: string;
  goal: string;
  knowledge_scope?: unknown[];
  permissions?: ExpertPermissions;
  available_agents?: string[];
  publish_gate?: ExpertPublishGate;
  organization_scope?: string[];
  brand_scope?: string[];
  region_scope?: string[];
  domain_object?: string;
  missing_fields?: string[];
};

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

export function clearExpertCache(): void {
  cached = null;
}

/** Tests only. Temporarily stub the expert publish gate without rewriting the manifest. */
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
  return String(manifest.publish_gate?.state || "") === "published";
}

export function listExpertManifests(): ExpertManifest[] {
  return loadExperts();
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

function canViewUnpublished(): boolean {
  return Boolean(scopedUser() && isAdmin());
}

export function expertSummary(manifest: ExpertManifest): Json {
  return {
    id: manifest.id,
    title: manifest.title,
    role: manifest.role,
    goal: manifest.goal,
    publish_gate: { state: expertPublished(manifest) ? "published" : (manifest.publish_gate?.state || "unpublished") },
  };
}

export function expertDetail(manifest: ExpertManifest): Json {
  const missing = Array.isArray(manifest.missing_fields) ? [...manifest.missing_fields] : [];
  const knowledgeScope = Array.isArray(manifest.knowledge_scope) ? [...manifest.knowledge_scope] : [];
  const detail: Json = {
    id: manifest.id,
    title: manifest.title,
    role: manifest.role,
    goal: manifest.goal,
    knowledge_scope: knowledgeScope,
    permissions: manifest.permissions || { declaration: "read-only", policy_refs: [] },
    available_agents: Array.isArray(manifest.available_agents) ? [...manifest.available_agents] : [],
    publish_gate: { state: expertPublished(manifest) ? "published" : (manifest.publish_gate?.state || "unpublished") },
    version: manifest.version || null,
    domain_object: manifest.domain_object || "DigitalEmployee",
  };
  if (Array.isArray(manifest.organization_scope) && manifest.organization_scope.length) {
    detail.organization_scope = [...manifest.organization_scope];
  }
  if (Array.isArray(manifest.brand_scope) && manifest.brand_scope.length) {
    detail.brand_scope = [...manifest.brand_scope];
  }
  if (Array.isArray(manifest.region_scope) && manifest.region_scope.length) {
    detail.region_scope = [...manifest.region_scope];
  }
  if (missing.length) detail.missing_fields = missing;
  return detail;
}

export function listPublishedExperts(): Json[] {
  return loadExperts().filter(expertPublished).map(expertSummary);
}

export function getExpertForViewer(id: string): Json {
  const manifest = requireExpertManifest(id);
  if (!expertPublished(manifest) && !canViewUnpublished()) {
    throw new HttpFail(404, { code: "expert_not_found", message: "未找到该专家" });
  }
  return expertDetail(manifest);
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
  return manifest;
}

function bindExpertId(sessionId: string, expertId: string, title?: string): void {
  const now = nowIso();
  if (title) {
    getConn().prepare("UPDATE sessions SET expert_id=?, title=?, updated_at=? WHERE id=?").run(expertId, title, now, sessionId);
  } else {
    getConn().prepare("UPDATE sessions SET expert_id=?, updated_at=? WHERE id=?").run(expertId, now, sessionId);
  }
}

/**
 * Open a bound work session for a published expert.
 * Reuses POST /api/sessions + openKolSession; does not send mail, write stage, or call LIVE Gateway.
 */
export async function summonExpert(
  id: string,
  body: { title?: string; collaboration_id?: string } = {},
): Promise<Json> {
  const manifest = assertExpertSummonable(id);
  const title = String(body.title || "").trim() || manifest.title;
  const collaborationId = String(body.collaboration_id || "").trim();
  if (collaborationId) {
    const { openKolSession } = await import("./host/kol-journey.js");
    const opened = openKolSession(collaborationId);
    bindExpertId(String(opened.id), manifest.id, body.title ? title : undefined);
    return {
      session_id: opened.id,
      expert_id: manifest.id,
      title: body.title ? title : opened.title,
      created: Boolean(opened.created),
      collaboration_id: collaborationId,
    };
  }
  const sid = nid("ses");
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "INSERT INTO sessions (id, title, created_at, updated_at, kind, disabled, owner_user_id, expert_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run(sid, title, now, now, "work", 0, scopedUser()?.id || null, manifest.id);
  });
  return {
    session_id: sid,
    expert_id: manifest.id,
    title,
    created: true,
    created_at: now,
  };
}
