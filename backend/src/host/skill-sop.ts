/**
 * Operator SOP lives on the skills page.
 * Host still owns stage gates, send, MCP, templates — this only edits Worker instructions.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, publishedSkillsDir, skillsDir } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
import { HttpFail } from "./errors.js";
import { SKILL_CATALOG } from "./skills-catalog.js";
import { currentUser } from "./persona.js";

const MAX_SUMMARY = 200;
const MAX_BODY = 32000;

export type SkillSopRow = {
  id: string;
  summary: string;
  body: string;
  updated_at: string | null;
  edited: boolean;
};

export function bundledSkillPath(id: string): string {
  return path.join(skillsDir(), id, "SKILL.md");
}

export function publishedSkillPath(id: string): string {
  return path.join(publishedSkillsDir(), id, "SKILL.md");
}

export function packagedSkillDir(id: string): string | null {
  const bundled = path.join(skillsDir(), id);
  if (fs.existsSync(path.join(bundled, "SKILL.md"))) return bundled;
  const published = path.join(publishedSkillsDir(), id);
  if (fs.existsSync(path.join(published, "SKILL.md"))) return published;
  return null;
}

export function isBundledSkill(id: string): boolean {
  return fs.existsSync(bundledSkillPath(id));
}

export function readBundledSkill(id: string): string {
  const dir = packagedSkillDir(id);
  if (!dir) return "";
  const file = path.join(dir, "SKILL.md");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export function catalogSkill(id: string) {
  return SKILL_CATALOG.find((s) => s.id === id) || null;
}

export function overlayRow(id: string): { summary: string; body: string; updated_at: string } | null {
  const row = getConn()
    .prepare("SELECT id, summary, body, updated_at FROM skill_sops WHERE id = ?")
    .get(id) as { id: string; summary: string; body: string; updated_at: string } | undefined;
  return row || null;
}

export function effectiveSummary(id: string): string {
  const cat = catalogSkill(id);
  const over = overlayRow(id);
  return (over?.summary || cat?.summary || cat?.label || id).trim();
}

/**
 * One read for every overlay instead of one per skill. `catalogSkill` rebuilds
 * the whole catalog on each call, so a per-skill loop of overlay + summary is
 * quadratic and blocks the single-threaded Host for seconds.
 */
export function overlaySummaries(): Map<string, { summary: string; updated_at: string }> {
  const rows = getConn()
    .prepare("SELECT id, summary, updated_at FROM skill_sops")
    .all() as { id: string; summary: string; updated_at: string }[];
  return new Map(rows.map((row) => [String(row.id), row]));
}

export function effectiveSkillBody(id: string): string {
  const over = overlayRow(id);
  if (over?.body) return over.body;
  return readBundledSkill(id);
}

export function getSkillSop(id: string): SkillSopRow {
  const cat = catalogSkill(id);
  if (!cat) throw new HttpFail(404, "unknown skill");
  const over = overlayRow(id);
  return {
    id,
    summary: over?.summary || cat.summary,
    body: over?.body || readBundledSkill(id),
    updated_at: over?.updated_at || null,
    edited: Boolean(over),
  };
}

export function saveSkillSop(id: string, patch: { summary?: string; body?: string }): SkillSopRow {
  const cat = catalogSkill(id);
  if (!cat) throw new HttpFail(404, "unknown skill");
  const cur = getSkillSop(id);
  const summary = String(patch.summary ?? cur.summary).trim();
  const body = String(patch.body ?? cur.body).trim();
  if (!summary) throw new HttpFail(400, "summary required");
  if (summary.length > MAX_SUMMARY) throw new HttpFail(400, "summary too long");
  if (!body) throw new HttpFail(400, "sop body required");
  if (body.length > MAX_BODY) throw new HttpFail(400, "sop body too long");
  const ts = nowIso();
  getConn()
    .prepare(
      "INSERT INTO skill_sops (id, summary, body, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary, body=excluded.body, updated_at=excluded.updated_at",
    )
    .run(id, summary, body, ts);
  audit(currentUser().handle, "skill.sop.save", { skill: id, summary });
  writeRuntimeSkill(id);
  return getSkillSop(id);
}

export function resetSkillSop(id: string): SkillSopRow {
  const cat = catalogSkill(id);
  if (!cat) throw new HttpFail(404, "unknown skill");
  getConn().prepare("DELETE FROM skill_sops WHERE id = ?").run(id);
  audit(currentUser().handle, "skill.sop.reset", { skill: id });
  writeRuntimeSkill(id);
  return getSkillSop(id);
}

export function writeRuntimeSkill(id: string): string {
  const dir = path.join(dataDir(), "skills", id);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, "SKILL.md");
  fs.writeFileSync(dest, effectiveSkillBody(id), "utf8");
  return dest;
}

export function writeSkillIntoBox(box: string, skill: string): string {
  const dest = path.join(box, "SKILL.md");
  fs.writeFileSync(dest, effectiveSkillBody(skill), "utf8");
  const srcDir = packagedSkillDir(skill);
  if (srcDir) {
    for (const name of fs.readdirSync(srcDir)) {
      if (name === "SKILL.md" || name.startsWith(".")) continue;
      const from = path.join(srcDir, name);
      const stat = fs.statSync(from);
      if (stat.isFile()) fs.copyFileSync(from, path.join(box, name));
      if (stat.isDirectory()) fs.cpSync(from, path.join(box, name), { recursive: true });
    }
  }
  return dest;
}

export function runtimeSkillsRoot(): string {
  const root = path.join(dataDir(), "skills");
  fs.mkdirSync(root, { recursive: true });
  return root;
}
