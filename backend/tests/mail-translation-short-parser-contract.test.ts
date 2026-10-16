import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { INTERNAL_ZH_HEADER, parseTranslatedZh } from "../src/starrykol/translate-zh.js";

describe("source-aware short translation parsing", () => {
  it("parses an actual two-Han short answer but retains normal/long quality and echo rejection", () => {
    expect(parseTranslatedZh('{"zh":"谢谢"}', "Thanks")).toBe(`${INTERNAL_ZH_HEADER}\n\n谢谢`);
    expect(parseTranslatedZh('{"zh":"已收悉"}', "Got it")).toBe(`${INTERNAL_ZH_HEADER}\n\n已收悉`);
    expect(parseTranslatedZh('{"zh":"谢谢"}', "Please confirm the detailed cooperation terms and delivery date.")).toBeNull();
    expect(parseTranslatedZh('{"zh":"内部中文对照 Please confirm the detailed cooperation terms and delivery date."}', "Please confirm the detailed cooperation terms and delivery date.")).toBeNull();
    expect(parseTranslatedZh('{"zh":"Thanks"}', "Thanks")).toBeNull();
  });

  it("keeps the source regex free of accidental nonprinting control bytes", () => {
    const source = fs.readFileSync(new URL("../src/starrykol/translate-zh.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
  });
});
