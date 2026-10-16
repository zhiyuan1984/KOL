import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { freshTestDatabase } from "./support/pg.js";

let app: Hono;
let temporary: string;
let previous: string | undefined;

beforeEach(async () => {
  await freshTestDatabase();
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kol-static-modules-"));
  fs.mkdirSync(path.join(temporary, "assets"));
  fs.writeFileSync(path.join(temporary, "index.html"), "<html>application</html>\n");
  fs.writeFileSync(path.join(temporary, "assets", "pdf.worker.mjs"), "export const worker = true;\n");
  previous = process.env.LINGONG_FRONTEND_DIST;
  process.env.LINGONG_FRONTEND_DIST = temporary;
  const { createApp } = await import("../src/app.js");
  app = await createApp();
});
afterEach(() => {
  if (previous === undefined) delete process.env.LINGONG_FRONTEND_DIST;
  else process.env.LINGONG_FRONTEND_DIST = previous;
  fs.rmSync(temporary, { recursive: true, force: true });
});

describe("native static module delivery", () => {
  it("serves the PDF worker as an executable ES module for GET and read-only HEAD", async () => {
    const response = await app.request("/assets/pdf.worker.mjs");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(await response.text()).toBe("export const worker = true;\n");
    const head = await app.request("/assets/pdf.worker.mjs", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(await head.text()).toBe("");
  });
  it("returns honest 404 for missing module assets rather than a successful SPA HTML body", async () => {
    const missing = await app.request("/assets/missing.worker.mjs");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Content-Type")).toContain("application/json");
    expect(await missing.json()).toEqual({ detail: "not found" });
    const deepLink = await app.request("/admin/knowledge");
    expect(deepLink.status).toBe(200);
    expect(deepLink.headers.get("Content-Type")).toContain("text/html");
  });
});
