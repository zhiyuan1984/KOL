import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postgresDb, resetDatabase } from "../src/postgres/access.js";
import { listCapabilities, registerCapability, resolveCapability, updateCapability, recordCapabilityCall, } from "../src/capability/registry.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";
let tmp: string;
beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-cap-"));
  process.env.NODE_ENV = "test";
  (await resetDatabase());
  postgresDb(); // Versioned PostgreSQL template already contains capability_registry.
});
afterEach(async () => {
  (await resetDatabase());
  fs.rmSync(tmp, { recursive: true, force: true });
});
describe("capability registry", () => {
  it("seeds builtin model profiles lazily and resolves them", async () => {
    const got = (await resolveCapability("model", "gpt-5.6-sol"));
    expect(got).not.toBeNull();
    expect(String(got!.origin)).toBe("builtin");
    // 默认配置下 chat 与 media 同模型，画像合并为一条、多角色
    const roles = (got!.capability as Json).roles as string[];
    expect(roles).toContain("检索问答");
    expect(roles).toContain("多模态规整");
    expect((await listCapabilities({ kind: "model" })).length).toBeGreaterThanOrEqual(2);
    expect((await resolveCapability("model", "no-such-model"))).toBeNull();
  });
  it("registers an external skill and upserts on repeat", async () => {
    const created = (await registerCapability({
      kind: "skill",
      ref_id: "ext:summarizer",
      origin: "external",
      capability: { description: "外部摘要 skill" },
      constraints: { risk: "R1" },
      version_pinned: "1.2.0",
    }));
    expect(String(created.id)).toBeTruthy();
    const again = (await registerCapability({
      kind: "skill",
      ref_id: "ext:summarizer",
      origin: "external",
      capability: { description: "外部摘要 skill v2" },
      notes: "已验证",
    }));
    expect(String(again.id)).toBe(String(created.id));
    expect(String((again.capability as Json).description)).toBe("外部摘要 skill v2");
    expect(String(again.notes)).toBe("已验证");
    const resolved = (await resolveCapability("skill", "ext:summarizer"));
    expect(String(resolved!.ref_id)).toBe("ext:summarizer");
  });
  it("rejects invalid kind and missing ref_id", async () => {
    await expect((async () => (await registerCapability({ kind: "nope", ref_id: "x" })))()).rejects.toThrow();
    await expect((async () => (await registerCapability({ kind: "model", ref_id: "  " })))()).rejects.toThrow();
  });
  it("updates notes and deprecates", async () => {
    const created = (await registerCapability({ kind: "model", ref_id: "ext-model-1", capability: {} }));
    const updated = (await updateCapability(String(created.id), { notes: "效果差", status: "deprecated" }));
    expect(String(updated.notes)).toBe("效果差");
    expect(String(updated.status)).toBe("deprecated");
    expect((await listCapabilities({ status: "active" })).find((c) => String(c.id) === String(created.id))).toBeUndefined();
    await expect((async () => (await updateCapability(String(created.id), { status: "nope" })))()).rejects.toThrow();
  });
  it("recordCapabilityCall accumulates aggregate stats only", async () => {
    (await recordCapabilityCall({ kind: "model", ref_id: "auto-model-x", ok: true, latencyMs: 100, inputTokens: 10, outputTokens: 5 }));
    (await recordCapabilityCall({ kind: "model", ref_id: "auto-model-x", ok: false, latencyMs: 200 }));
    const got = (await resolveCapability("model", "auto-model-x"))!;
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
  it("recordCapabilityCall never breaks the main flow", async () => {
    await expect((async () => (await recordCapabilityCall({ kind: "bogus", ref_id: "", ok: true })))().then(() => true)).resolves.toBe(true);
    await expect((async () => (await recordCapabilityCall({ kind: "model", ref_id: "", ok: true })))().then(() => true)).resolves.toBe(true);
  });
});
