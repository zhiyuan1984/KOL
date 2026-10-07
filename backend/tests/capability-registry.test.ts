import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import {
  listCapabilities,
  registerCapability,
  resolveCapability,
  updateCapability,
  recordCapabilityCall,
} from "../src/capability/registry.js";
import type { Json } from "../src/types.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-cap-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.NODE_ENV = "test";
  resetConn();
  getConn(); // initSchema 建 capability_registry
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("capability registry", () => {
  it("seeds builtin model profiles lazily and resolves them", () => {
    const got = resolveCapability("model", "gpt-5.6-sol");
    expect(got).not.toBeNull();
    expect(String(got!.origin)).toBe("builtin");
    // 默认配置下 chat 与 media 同模型，画像合并为一条、多角色
    const roles = (got!.capability as Json).roles as string[];
    expect(roles).toContain("检索问答");
    expect(roles).toContain("多模态规整");
    expect(listCapabilities({ kind: "model" }).length).toBeGreaterThanOrEqual(2);
    expect(resolveCapability("model", "no-such-model")).toBeNull();
  });

  it("registers an external skill and upserts on repeat", () => {
    const created = registerCapability({
      kind: "skill",
      ref_id: "ext:summarizer",
      origin: "external",
      capability: { description: "外部摘要 skill" },
      constraints: { risk: "R1" },
      version_pinned: "1.2.0",
    });
    expect(String(created.id)).toBeTruthy();
    const again = registerCapability({
      kind: "skill",
      ref_id: "ext:summarizer",
      origin: "external",
      capability: { description: "外部摘要 skill v2" },
      notes: "已验证",
    });
    expect(String(again.id)).toBe(String(created.id));
    expect(String((again.capability as Json).description)).toBe("外部摘要 skill v2");
    expect(String(again.notes)).toBe("已验证");
    const resolved = resolveCapability("skill", "ext:summarizer");
    expect(String(resolved!.ref_id)).toBe("ext:summarizer");
  });

  it("rejects invalid kind and missing ref_id", () => {
    expect(() => registerCapability({ kind: "nope", ref_id: "x" })).toThrow();
    expect(() => registerCapability({ kind: "model", ref_id: "  " })).toThrow();
  });

  it("updates notes and deprecates", () => {
    const created = registerCapability({ kind: "model", ref_id: "ext-model-1", capability: {} });
    const updated = updateCapability(String(created.id), { notes: "效果差", status: "deprecated" });
    expect(String(updated.notes)).toBe("效果差");
    expect(String(updated.status)).toBe("deprecated");
    expect(listCapabilities({ status: "active" }).find((c) => String(c.id) === String(created.id))).toBeUndefined();
    expect(() => updateCapability(String(created.id), { status: "nope" })).toThrow();
  });

  it("recordCapabilityCall accumulates aggregate stats only", () => {
    recordCapabilityCall({ kind: "model", ref_id: "auto-model-x", ok: true, latencyMs: 100, inputTokens: 10, outputTokens: 5 });
    recordCapabilityCall({ kind: "model", ref_id: "auto-model-x", ok: false, latencyMs: 200 });
    const got = resolveCapability("model", "auto-model-x")!;
    expect(String(got.origin)).toBe("auto");
    const stats = got.stats as Json;
    expect(Number(stats.calls)).toBe(2);
    expect(Number(stats.ok)).toBe(1);
    expect(Number(stats.total_latency_ms)).toBe(300);
    expect(Number(stats.total_input_tokens)).toBe(10);
    expect(Number(stats.total_output_tokens)).toBe(5);
    expect(stats.last_ok).toBe(false);
    expect(String(stats.last_called_at)).toBeTruthy();
  });

  it("recordCapabilityCall never breaks the main flow", () => {
    expect(() => recordCapabilityCall({ kind: "bogus", ref_id: "", ok: true })).not.toThrow();
    expect(() => recordCapabilityCall({ kind: "model", ref_id: "", ok: true })).not.toThrow();
  });
});
