import { describe, expect, it } from "vitest";
import { clampCountInput } from "./discoveryBriefForm";

describe("discovery brief form helpers", () => {
  it("never lets a numeric field go NaN", () => {
    expect(clampCountInput("", 10000)).toBe(10000);
    expect(clampCountInput("abc", 30)).toBe(30);
    expect(clampCountInput("-5", 30)).toBe(30);
    expect(clampCountInput("12000", 10000)).toBe(12000);
    expect(clampCountInput("12.7", 30)).toBe(12);
  });
});
