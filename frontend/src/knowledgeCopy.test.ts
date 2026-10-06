import { describe, expect, it } from "vitest";
import { kbStatusCounts, kbStatusSegments } from "./knowledgeCopy";

describe("kbStatusCounts", () => {
  it("counts the four lifecycle states and keeps the total", () => {
    const rows = [
      { status: "draft" },
      { status: "pending_review" },
      { status: "published" },
      { status: "archived" },
      { status: "published" },
    ];
    expect(kbStatusCounts(rows)).toEqual({ draft: 1, pending: 1, published: 2, archived: 1, total: 5 });
  });

  it("treats a missing status as draft so the segments always add up to the total", () => {
    const counts = kbStatusCounts([{}, { status: "" }, { status: "unknown_state" }]);
    expect(counts).toEqual({ draft: 3, pending: 0, published: 0, archived: 0, total: 3 });
  });

  it("keeps zero states visible instead of dropping them", () => {
    const segments = kbStatusSegments(kbStatusCounts([{ status: "published" }]));
    expect(segments.map((segment) => segment.key)).toEqual(["draft", "pending", "published", "archived"]);
    expect(segments.map((segment) => segment.value)).toEqual([0, 0, 1, 0]);
    expect(segments.map((segment) => segment.view)).toEqual(["draft", "pending", "published", "disabled"]);
  });
});
