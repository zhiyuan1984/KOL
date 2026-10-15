import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";
let app: Hono;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-master-data-"));
  process.env.LINGONG_DATA = tmp;
  process.env.AUTH_MODE = "disabled";
  await freshTestDatabase();
  await seedAll();
  const { createApp } = await import("../src/app.js");
  app = await createApp();
});

afterEach(async () => {
  process.env.AUTH_MODE = "disabled";
  await resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function uploadCsv(kind: string, csv: string) {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", new File([csv], "test.csv", { type: "text/csv" }));
  return app.request("/api/admin/master-data/preview", { method: "POST", body: form });
}

describe("master data import", () => {
  it("lists 8 master data kinds with field definitions", async () => {
    const res = await app.request("/api/admin/master-data/kinds");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kinds: Array<{ kind: string; fields: unknown[] }> };
    expect(body.kinds).toHaveLength(8);
    const brand = body.kinds.find((k) => k.kind === "brand");
    expect(brand?.fields.length).toBeGreaterThan(0);
  });

  it("downloads a CSV template with header and example row", async () => {
    const res = await app.request("/api/admin/master-data/template/brand");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("brand_code");
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(2);
  });

  it("rejects unknown kind", async () => {
    const res = await app.request("/api/admin/master-data/template/nope");
    expect(res.status).toBe(404);
  });

  it("previews a valid CSV", async () => {
    const csv = "brand_code,name,positioning\nLT,LiTime,磷酸铁锂\nRO,RoyPow,高尔夫球车电池\n";
    const res = await uploadCsv("brand", csv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; valid: number; invalid: number; errors: string[] };
    expect(body.total).toBe(2);
    expect(body.valid).toBe(2);
    expect(body.invalid).toBe(0);
    expect(body.errors).toEqual([]);
  });

  it("flags missing required columns and row errors", async () => {
    const csv = "brand_code,name\nLT,LiTime\n,缺编码\nLT,重复编码\n";
    const res = await uploadCsv("brand", csv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      valid: number;
      invalid: number;
      rows: Array<{ valid: boolean; errors: string[] }>;
    };
    expect(body.total).toBe(3);
    expect(body.valid).toBe(1);
    expect(body.invalid).toBe(2);
    expect(body.rows[1].errors.join()).toContain("不能为空");
    expect(body.rows[2].errors.join()).toContain("重复");
  });

  it("rejects CSV missing required columns", async () => {
    const csv = "name\nLiTime\n";
    const res = await uploadCsv("brand", csv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: string[]; total: number };
    expect(body.errors.join()).toContain("缺少必填列");
    expect(body.total).toBe(0);
  });

  it("commit rejects empty rows without touching PG", async () => {
    const res = await app.request("/api/admin/master-data/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "brand", rows: [] }),
    });
    expect(res.status).toBe(422);
  });
});
