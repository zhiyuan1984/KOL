import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffRegistries } from "../src/routers/ontology.js";

/**
 * 本体 diff（Phase 2）：纯函数，只做展示用的人可读变更清单，不参与审批判定。
 * 审批仍以 target_digest 为准（后端按引用计算，发起人不手输摘要）。
 */
describe("ontology diffRegistries", () => {
  it("reports added / removed / field-changed entries by code", () => {
    const base = {
      version: 1,
      objects: [
        { code: "A", name: "甲", status: "built" },
        { code: "B", name: "乙", status: "built" },
      ],
    };
    const target = {
      version: 2,
      objects: [
        { code: "A", name: "甲改", status: "built" },
        { code: "C", name: "丙", status: "not_built" },
      ],
    };
    const { changes, truncated } = diffRegistries(base, target);
    expect(truncated).toBe(false);
    const byKey = new Map(changes.map((c) => [`${c.change_kind}:${c.key}`, c]));
    expect(byKey.get("added:C")?.label).toBe("丙");
    expect(byKey.get("removed:B")?.label).toBe("乙");
    const changedA = byKey.get("changed:A");
    expect(changedA?.fields).toEqual([{ field: "name", from: "甲", to: "甲改" }]);
    // version 标量变更如实报告，不吞。
    expect(byKey.get("changed:version")?.from).toBe("1");
    expect(byKey.get("changed:version")?.to).toBe("2");
  });

  it("returns no changes for identical registries", () => {
    const reg = { version: 3, events: [{ code: "e1", name: "事件一" }] };
    expect(diffRegistries(reg, JSON.parse(JSON.stringify(reg))).changes).toEqual([]);
  });

  it("diffs primitive arrays as sets", () => {
    const { changes } = diffRegistries({ tags: ["a", "b"] }, { tags: ["b", "c"] });
    expect(changes).toContainEqual({ section: "tags", change_kind: "added", key: "c", label: "c" });
    expect(changes).toContainEqual({ section: "tags", change_kind: "removed", key: "a", label: "a" });
  });

  it("handles real registry shapes: identical files diff empty, one edit diffs one entry", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const objects = JSON.parse(fs.readFileSync(path.join(root, "config/objects-registry.yaml"), "utf8")) as {
      objects: Array<Record<string, unknown>>;
    };
    expect(objects.objects.length).toBeGreaterThan(0);
    expect(diffRegistries(objects, JSON.parse(JSON.stringify(objects))).changes).toEqual([]);
    const edited = JSON.parse(JSON.stringify(objects)) as typeof objects;
    const first = edited.objects[0];
    first.name = `${String(first.name)}（改）`;
    const { changes } = diffRegistries(objects, edited);
    const entryChanges = changes.filter((c) => c.change_kind === "changed" && c.key === String(first.code));
    expect(entryChanges.length).toBe(1);
    expect(entryChanges[0].fields).toEqual([
      { field: "name", from: String(objects.objects[0].name), to: String(first.name) },
    ]);
  });
});
