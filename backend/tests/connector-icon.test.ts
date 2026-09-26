import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { connectorIconsRouter } from "../src/routers/connector-icons.js";

// Smallest well-formed 1x1 PNG (IHDR/IDAT/IEND with valid CRCs).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG_MIN = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const CONNECTOR_ID = "icon_fixture";

let tmp = "";
let app: Hono;

function testApp(): Hono {
  const a = new Hono();
  a.onError((e, c) => e instanceof HttpFail
    ? c.json({ detail: e.detail }, e.status as 400 | 401 | 403 | 404 | 409 | 413 | 503)
    : c.json({ detail: "unexpected" }, 500));
  a.route("/api", connectorIconsRouter);
  return a;
}

function iconForm(name: string, bytes: Buffer, type: string): FormData {
  const form = new FormData();
  form.append("icon", new File([new Uint8Array(bytes)], name, { type }));
  return form;
}

async function post(body: FormData, connectorId = CONNECTOR_ID) {
  const res = await app.request(`/api/admin/connectors/${connectorId}/icon`, { method: "POST", body });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function get(connectorId = CONNECTOR_ID) {
  return app.request(`/api/admin/connectors/${connectorId}/icon`);
}

function iconFiles(): string[] {
  const dir = path.join(tmp, "connector-icons");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function errorCode(body: Record<string, unknown>): unknown {
  const detail = body.detail as { code?: unknown } | undefined;
  return detail?.code ?? detail;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-connector-icon-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, AUTH_MODE: "disabled", NODE_ENV: "test" });
  resetConn();
  app = testApp();
  getConn().prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES(?,?,1,'configured','now')")
    .run(CONNECTOR_ID, "Icon fixture");
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"]) delete process.env[key];
});

describe("connector icon", () => {
  it("stores a sniffed PNG, records only the file name, and serves the same bytes", async () => {
    const created = await post(iconForm("logo.txt", PNG_1X1, "text/plain"));
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: CONNECTOR_ID, icon_url: `/api/admin/connectors/${CONNECTOR_ID}/icon` });

    const stored = getConn().prepare("SELECT icon_ref FROM connectors WHERE id=?").get(CONNECTOR_ID) as { icon_ref: string | null };
    expect(stored.icon_ref).toMatch(new RegExp(`^${CONNECTOR_ID}-[0-9a-f]{16}\\.png$`));
    expect(fs.readFileSync(path.join(tmp, "connector-icons", String(stored.icon_ref)))).toEqual(PNG_1X1);

    const event = getConn().prepare("SELECT payload FROM audit_events WHERE event_type='admin.connector.icon.updated'").get() as { payload: string };
    expect(JSON.parse(event.payload)).toEqual({ connector_id: CONNECTOR_ID });

    const served = await get();
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(PNG_1X1);
  });

  it("accepts JPEG magic bytes and serves image/jpeg", async () => {
    expect((await post(iconForm("photo.jpg", JPEG_MIN, "image/jpeg"))).status).toBe(201);
    const served = await get();
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(JPEG_MIN);
  });

  it("rejects a payload that is not a sniffed image", async () => {
    const rejected = await post(iconForm("notes.txt", Buffer.from("just some text, no image header"), "text/plain"));
    expect(rejected.status).toBe(400);
    expect(errorCode(rejected.body)).toBe("connector_icon_type_unsupported");
    expect(iconFiles()).toEqual([]);
  });

  it("rejects an icon larger than 1 MiB", async () => {
    const oversized = Buffer.concat([PNG_1X1, Buffer.alloc(1024 * 1024, 0x41)]);
    expect(oversized.length).toBeGreaterThan(1024 * 1024);
    const rejected = await post(iconForm("huge.png", oversized, "image/png"));
    expect(rejected.status).toBe(413);
    expect(errorCode(rejected.body)).toBe("connector_icon_too_large");
    expect(iconFiles()).toEqual([]);
  });

  it("requires exactly one uploaded file", async () => {
    const empty = new FormData();
    empty.append("note", "no file here");
    const missing = await post(empty);
    expect(missing.status).toBe(400);
    expect(errorCode(missing.body)).toBe("connector_icon_required");
  });

  it("deletes the replaced file and answers 404 while no icon is stored", async () => {
    const missing = await get();
    expect(missing.status).toBe(404);
    expect(errorCode((await missing.json()) as Record<string, unknown>)).toBe("connector_icon_not_found");

    expect((await post(iconForm("first.png", PNG_1X1, "image/png"))).status).toBe(201);
    const first = fs.readdirSync(path.join(tmp, "connector-icons"));
    expect((await post(iconForm("second.png", JPEG_MIN, "image/jpeg"))).status).toBe(201);
    const afterReplace = fs.readdirSync(path.join(tmp, "connector-icons"));
    expect(afterReplace).toHaveLength(1);
    expect(afterReplace[0]).not.toBe(first[0]);
    expect(fs.existsSync(path.join(tmp, "connector-icons", first[0]))).toBe(false);
  });

  it("answers 404 for an unknown connector", async () => {
    const unknown = await get("no_such_connector");
    expect(unknown.status).toBe(404);
    expect(errorCode((await unknown.json()) as Record<string, unknown>)).toBe("managed_connector_not_found");
  });
});
