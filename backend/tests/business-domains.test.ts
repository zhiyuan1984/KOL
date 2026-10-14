import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";

let tmp = "";
let app: Hono;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-business-domains-"));
  process.env.LINGONG_DB = path.join(tmp, "om.db");
  process.env.LINGONG_DATA = tmp;
  process.env.AUTH_MODE = "disabled";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  process.env.AUTH_MODE = "disabled";
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("business domains", () => {
  it("returns 6 domains with six components each", async () => {
    const res = await app.request("/api/admin/business-domains");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      domains: Array<{
        code: string; name: string; owner: string; pilot: boolean;
        components: Record<string, { total: number; items: unknown[] }>;
      }>;
      relations: unknown[];
    };
    expect(body.domains).toHaveLength(6);
    const codes = body.domains.map((d) => d.code).sort();
    expect(codes).toEqual(["brand", "finance", "hr", "marketing", "site", "supply"]);
    for (const d of body.domains) {
      for (const key of ["objects", "properties", "relations", "events", "rules", "actions"]) {
        expect(d.components[key]).toBeDefined();
        expect(typeof d.components[key].total).toBe("number");
      }
    }
    // 域主来自 qiyou 2026-10-12 决策
    const owners = Object.fromEntries(body.domains.map((d) => [d.code, d.owner]));
    expect(owners.brand).toBe("张慧玲");
    expect(owners.hr).toBe("赵海龙");
    expect(owners.site).toBe("邢海龚");
    expect(owners.finance).toBe("彭学知");
    expect(owners.supply).toBe("晏琼瑶");
    // 试点域
    expect(body.domains.filter((d) => d.pilot).map((d) => d.code).sort()).toEqual(["brand", "marketing"]);
    // 域间关系
    expect(body.relations.length).toBeGreaterThan(5);
  });

  it("marketing domain has objects, events and actions from real registries", async () => {
    const res = await app.request("/api/admin/business-domains");
    const body = (await res.json()) as {
      domains: Array<{ code: string; components: Record<string, { total: number; items: Array<{ code?: string }> }> }>;
    };
    const mkt = body.domains.find((d) => d.code === "marketing")!;
    expect(mkt.components.objects.total).toBeGreaterThan(0);
    expect(mkt.components.events.total).toBeGreaterThan(0);
    expect(mkt.components.actions.total).toBeGreaterThan(0);
    expect(mkt.components.rules.total).toBeGreaterThan(0);
    // 事件来自真实 event-catalog（collaboration./kol./stage. 等前缀）
    const eventCodes = mkt.components.events.items.map((e) => e.code);
    expect(eventCodes.some((c) => c?.startsWith("collaboration.") || c?.startsWith("kol.") || c?.startsWith("stage."))).toBe(true);
  });

  it("site domain honestly marks blank object registry", async () => {
    const res = await app.request("/api/admin/business-domains");
    const body = (await res.json()) as {
      domains: Array<{ code: string; components: Record<string, { total: number }> }>;
    };
    const site = body.domains.find((d) => d.code === "site")!;
    // 独立站域对象注册待补：对象数为 0 是如实标注，不是 bug
    expect(site.components.objects.total).toBe(0);
    // 但关系和主数据有
    expect(site.components.relations.total).toBeGreaterThan(0);
  });
});
