import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
import { dataDir } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { requireManagedConnector } from "../connectors/catalog.js";

export const connectorIconsRouter = new Hono();

const MAX_ICON_BYTES = 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const CONTENT_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg" };

function iconsDir(): string {
  return path.join(dataDir(), "connector-icons");
}

function requireConnectorIconRow(connectorId: string): { icon_ref: string | null } {
  const row = getConn().prepare("SELECT icon_ref FROM connectors WHERE id = ?").get(connectorId) as
    | { icon_ref: string | null }
    | undefined;
  if (!row) throw new HttpFail(404, { code: "managed_connector_not_found", connector_id: connectorId });
  return row;
}

function sniffExtension(buf: Buffer): "png" | "jpg" | null {
  if (buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return "png";
  if (buf.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return "jpg";
  return null;
}

/** Best-effort removal of the replaced icon; a stored name is always a plain file name. */
function removeStoredIcon(ref: string | null, keep: string): void {
  if (!ref || ref === keep) return;
  const name = path.basename(ref);
  if (name !== ref) return;
  try {
    fs.rmSync(path.join(iconsDir(), name), { force: true });
  } catch {
    // A leftover file is harmless; the database is the source of truth.
  }
}

function storedIconFile(ref: string | null): string | null {
  if (!ref) return null;
  const name = path.basename(ref);
  if (name !== ref) return null;
  const dir = path.resolve(iconsDir());
  const file = path.resolve(dir, name);
  if (!file.startsWith(dir + path.sep)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

connectorIconsRouter.post("/admin/connectors/:connectorId/icon", async (c) => {
  const admin = requireAdmin();
  const connectorId = requireManagedConnector(c.req.param("connectorId"));
  const current = requireConnectorIconRow(connectorId);
  const form = await c.req.parseBody();
  const upload = form.icon;
  if (!upload || typeof upload === "string" || Array.isArray(upload) || typeof upload.arrayBuffer !== "function") {
    throw new HttpFail(400, { code: "connector_icon_required" });
  }
  const buf = Buffer.from(await upload.arrayBuffer());
  if (buf.length > MAX_ICON_BYTES) throw new HttpFail(413, { code: "connector_icon_too_large" });
  const ext = sniffExtension(buf);
  if (!ext) throw new HttpFail(400, { code: "connector_icon_type_unsupported" });

  const dir = iconsDir();
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${connectorId}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(dir, fileName), buf);
  getConn()
    .prepare("UPDATE connectors SET icon_ref = ?, updated_at = ? WHERE id = ?")
    .run(fileName, nowIso(), connectorId);
  removeStoredIcon(current.icon_ref, fileName);
  audit(admin.id, "admin.connector.icon.updated", { connector_id: connectorId });
  return c.json({ id: connectorId, icon_url: `/api/admin/connectors/${connectorId}/icon` }, 201);
});

connectorIconsRouter.get("/admin/connectors/:connectorId/icon", (c) => {
  requireAdmin();
  const connectorId = requireManagedConnector(c.req.param("connectorId"));
  const row = requireConnectorIconRow(connectorId);
  const file = storedIconFile(row.icon_ref);
  if (!file) throw new HttpFail(404, { code: "connector_icon_not_found" });
  c.header("Content-Type", CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  c.header("Cache-Control", "private, max-age=86400");
  return c.body(fs.readFileSync(file));
});
