import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { organizationUnitsRouter } from "../src/routers/organization-units.js";

type UnitRow = { id: string; display_name: string; type: string | null; parent: string | null; level: number; head: string | null };
type PersonRow = { display_name: string; role: string | null; org_unit: string | null; user_ref: string | null };
type Directory = { company: { id: string; display_name: string } | null; units: UnitRow[]; people: PersonRow[] };

let tmp = "";
let app: Hono;

function testApp(): Hono {
  const a = new Hono();
  a.onError((e, c) => e instanceof HttpFail
    ? c.json({ detail: e.detail }, e.status as 400 | 401 | 403 | 404 | 409 | 503)
    : c.json({ detail: "unexpected" }, 500));
  a.route("/api", organizationUnitsRouter);
  return a;
}

async function directory(): Promise<{ status: number; body: Directory }> {
  const res = await app.request("/api/admin/organization-units");
  return { status: res.status, body: (await res.json()) as Directory };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-organization-units-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, AUTH_MODE: "disabled", NODE_ENV: "test" });
  resetConn();
  app = testApp();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"]) delete process.env[key];
});

describe("admin organization unit directory", () => {
  it("returns the confirmed registry tree with levels computed from parent chains", async () => {
    const { status, body } = await directory();
    expect(status).toBe(200);
    expect(body.company).toEqual({ id: "company:amperetime", display_name: "安培时代" });

    const units = new Map(body.units.map((unit) => [unit.display_name, unit]));
    expect(units.get("品牌与用户增长中心")).toEqual({
      id: "org:brand_user_growth_center",
      display_name: "品牌与用户增长中心",
      type: "center",
      parent: "company:amperetime",
      level: 1,
      head: "张慧玲",
    });
    expect(units.get("品牌项目组")).toMatchObject({ parent: "org:brand_user_growth_center", level: 2 });
    expect(units.get("市场部")).toMatchObject({ parent: "org:brand_user_growth_center", level: 2 });
    expect(units.get("推广部")).toMatchObject({ parent: "org:brand_user_growth_center", level: 2, head: "刘敏" });
    expect(units.get("LT组")).toMatchObject({ parent: "org:promotion_department", level: 3, type: "team" });
    expect(units.get("PQ-RO-TB组")).toMatchObject({ parent: "org:promotion_department", level: 3, type: "team" });
  });

  it("returns the confirmed people and never the raw registry rows", async () => {
    const { body } = await directory();
    const people = new Map(body.people.map((person) => [person.display_name, person]));
    expect(people.get("张慧玲")).toEqual({
      display_name: "张慧玲",
      role: "department_head",
      org_unit: "org:brand_user_growth_center",
      user_ref: null,
    });
    expect(people.get("刘敏")).toEqual({
      display_name: "刘敏",
      role: "department_head",
      org_unit: "org:promotion_department",
      user_ref: "user:liu_min",
    });
    expect(body.people.every((person) => Object.keys(person).sort().join(",") === "display_name,org_unit,role,user_ref")).toBe(true);
    const raw = JSON.stringify(body);
    for (const leaked of ["email", "password", "secret", "token", "bearer", "pending_fields", "principal_ref", "source", "external_id"]) {
      expect(raw).not.toContain(leaked);
    }
  });

  it("fails loudly when the registry cannot be read instead of serving an empty directory", async () => {
    const original = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: unknown, ...rest: unknown[]) => {
      if (String(file).includes("org-registry.yaml")) throw new Error("registry missing");
      return (original as (...args: unknown[]) => unknown)(file, ...rest);
    }) as unknown as typeof fs.readFileSync);

    const res = await app.request("/api/admin/organization-units");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { detail: { code: string } }).detail).toEqual({ code: "organization_registry_unavailable" });
  });
});
