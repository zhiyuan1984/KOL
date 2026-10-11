import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(backendDir, "..");

function readConfig(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, "config", name), "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
}

describe("ontology config registries", () => {
  it("three catalogs are strict JSON and pass validate-registry --require-all", () => {
    const result = spawnSync(process.execPath, ["scripts/validate-registry.mjs", "--require-all"], {
      cwd: backendDir,
      encoding: "utf8",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("keeps the stage/email wiring event types in the catalog", () => {
    const catalog = readConfig("event-catalog.yaml") as { events: Array<{ code: string }> };
    const codes = new Set(catalog.events.map((event) => event.code));
    for (const code of [
      "stage.advanced",
      "stage.forward_skipped",
      "stage.regressed",
      "stage.exception_entered",
      "stage.exception_left",
      "stage.completed",
      "email.received",
    ]) {
      expect(codes.has(code), `event catalog missing ${code}`).toBe(true);
    }
  });

  it("covers B1..B18 objects and the ticket taxonomy", () => {
    const registry = readConfig("objects-registry.yaml") as { objects: Array<{ id: string; code: string }> };
    const ids = new Set(registry.objects.map((object) => object.id));
    for (let index = 1; index <= 18; index += 1) expect(ids.has(`B${index}`)).toBe(true);
    const tickets = readConfig("ticket-types.yaml") as {
      kinds: Array<{ code: string }>;
      channels: Array<{ code: string }>;
    };
    expect(tickets.kinds.map((kind) => kind.code)).toContain("service");
    expect(tickets.kinds.map((kind) => kind.code)).toContain("general");
    expect(tickets.channels.map((channel) => channel.code)).toContain("email");
  });

  it("registers every formal wave event code in the event catalog with a matching object type", async () => {
    const contracts = await import("../src/ticket-domain/event-contracts.js");
    const catalog = readConfig("event-catalog.yaml") as {
      events: Array<{ code: string; object_type: string }>;
    };
    const objectTypeByCode = new Map(catalog.events.map((event) => [event.code, event.object_type]));
    const codes = contracts.FORMAL_BUSINESS_EVENT_TYPES as readonly string[];
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(objectTypeByCode.has(code), `event catalog missing formal code ${code}`).toBe(true);
      expect(objectTypeByCode.get(code)).toBe(
        (contracts.FORMAL_EVENT_OBJECT_TYPES as Record<string, string>)[code],
      );
    }
  });
});
