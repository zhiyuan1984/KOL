import { describe, expect, it } from "vitest";
import { streamingNarrative } from "../../shared/narrative.js";
import { withNarrative } from "../src/worker/runner.js";

describe("streamingNarrative", () => {
  it("returns the narrative as it grows, before the JSON is closed", () => {
    expect(streamingNarrative('{"narr')).toBeNull();
    expect(streamingNarrative('{"narrative":"')).toBe("");
    expect(streamingNarrative('{"narrative":"正在查询达人库')).toBe("正在查询达人库");
    expect(streamingNarrative('{"narrative":"正在查询达人库，命中 12 位。","type":"task_result"')).toBe("正在查询达人库，命中 12 位。");
  });

  it("decodes escapes and waits when an escape is cut at the buffer end", () => {
    expect(streamingNarrative('{"narrative":"第一行\\n第二行 \\"引号\\"')).toBe('第一行\n第二行 "引号"');
    expect(streamingNarrative('{"narrative":"半截\\')).toBe("半截");
    expect(streamingNarrative('{"narrative":"码点\\u4e2')).toBe("码点");
    expect(streamingNarrative('{"narrative":"码点\\u4e2d"')).toBe("码点中");
  });

  it("is null for output without a narrative field", () => {
    expect(streamingNarrative('{"type":"task_result","title":"x"}')).toBeNull();
    expect(streamingNarrative("普通文字")).toBeNull();
  });
});

describe("withNarrative", () => {
  it("puts narrative first and keeps the strict required list complete", () => {
    const schema = withNarrative({ type: "object", properties: { type: { type: "string" }, title: { type: "string" } }, required: ["type", "title"], additionalProperties: false });
    expect(Object.keys(schema.properties as object)).toEqual(["narrative", "type", "title"]);
    expect(schema.required).toEqual(["narrative", "type", "title"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("leaves non-object schemas and schemas that already declare narrative untouched", () => {
    const already = { type: "object", properties: { narrative: { type: "string" } }, required: ["narrative"] };
    expect(withNarrative(already)).toBe(already);
    const array = { type: "array", items: { type: "string" } };
    expect(withNarrative(array)).toBe(array);
  });
});
