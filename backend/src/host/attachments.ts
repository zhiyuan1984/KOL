import fs from "node:fs";
import path from "node:path";
import { authDisabled, scopedUser } from "../auth.js";
import { dataDir } from "../config.js";
import { getConn, nowIso } from "../db.js";
import { HttpFail } from "./errors.js";

export type AttachmentRef = { id?: string; name: string; path: string; size?: number; type?: string };

export function uploadsDir(): string {
  return path.join(dataDir(), "uploads");
}

export function sanitizeAttachments(raw: unknown): AttachmentRef[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const root = path.resolve(uploadsDir());
  const out: AttachmentRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new HttpFail(400, "attachment missing on disk");
    const name = String((item as { name?: string }).name || "").trim();
    const p = String((item as { path?: string }).path || "").trim();
    if (!name || !p) throw new HttpFail(400, "attachment missing on disk");
    const resolved = path.resolve(p);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new HttpFail(400, "attachment missing on disk");
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new HttpFail(400, "attachment missing on disk");
    }
    const upload = getConn().prepare(
      "SELECT id,owner_user_id,size_bytes,mime_type FROM user_uploads WHERE path=?",
    ).get(resolved) as {
      id: string;
      owner_user_id?: string | null;
      size_bytes: number;
      mime_type: string;
    } | undefined;
    if (!authDisabled()) {
      const user = scopedUser();
      if (!user || !upload || upload.owner_user_id !== user.id) {
        throw new HttpFail(403, "attachment does not belong to current user");
      }
    }
    if (upload) {
      getConn().prepare("UPDATE user_uploads SET last_used_at=? WHERE id=?").run(nowIso(), upload.id);
    }
    out.push({
      id: upload?.id,
      name: path.basename(name),
      path: resolved,
      size: upload?.size_bytes,
      type: upload?.mime_type,
    });
  }
  return out;
}

export function excerptFile(filePath: string, max = 4000): string {
  const buf = fs.readFileSync(filePath);
  if (buf.includes(0)) return `[binary ${buf.length} bytes]`;
  return buf.toString("utf8").slice(0, max);
}

/** Copy files into the worker box and append path + excerpt to CONTEXT.md. */
export function writeAttachmentContext(box: string, extra: { attachments?: AttachmentRef[] } | Record<string, unknown>): void {
  const atts = ((extra as { attachments?: AttachmentRef[] }).attachments || []) as AttachmentRef[];
  if (!atts.length) return;
  const dir = path.join(box, "attachments");
  fs.mkdirSync(dir, { recursive: true });
  const lines = ["", "## Attachments", ""];
  for (const a of atts) {
    if (!a?.path || !fs.existsSync(a.path)) {
      lines.push(`- missing: ${a?.name || a?.path || "?"}`);
      continue;
    }
    const dest = path.join(dir, path.basename(a.name || a.path));
    fs.copyFileSync(a.path, dest);
    lines.push(`- ${a.name} → ${dest}`);
    lines.push("```");
    lines.push(excerptFile(a.path));
    lines.push("```");
  }
  fs.appendFileSync(path.join(box, "CONTEXT.md"), lines.join("\n") + "\n");
}
