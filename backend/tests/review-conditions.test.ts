import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  validateCondition,
} from "../src/approval/review-conditions.js";
import {
  emptyReviewDefinition,
  type ReviewCondition,
  type ReviewField,
} from "../../shared/review.js";
import {
  validateDefinition,
  advanceReview,
} from "../src/approval/review-engine.js";
const fields = new Map<string, ReviewField>([
  ["count", { id: "count", label: "数量", type: "number", required: true }],
  [
    "category",
    {
      id: "category",
      label: "类型",
      type: "select",
      required: true,
      options: ["content", "contract"],
    },
  ],
]);
const condition: ReviewCondition = {
  op: "all",
  conditions: [
    { field: "count", op: "gte", value: 2 },
    {
      op: "not",
      condition: { field: "category", op: "eq", value: "contract" },
    },
  ],
};
describe("bounded generic condition AST", () => {
  it("evaluates nested all, any and not without coercion", () => {
    expect(validateCondition(condition, fields, "condition")).toEqual([]);
    expect(
      evaluateCondition(condition, { count: 2, category: "content" }),
    ).toEqual({ result: true, missing: [] });
    expect(
      evaluateCondition(condition, { count: 1, category: "content" }).result,
    ).toBe(false);
    expect(
      evaluateCondition(
        {
          op: "any",
          conditions: [condition, { field: "count", op: "eq", value: 0 }],
        },
        { count: 0, category: "contract" },
      ).result,
    ).toBe(true);
    expect(
      evaluateCondition({ field: "count", op: "eq", value: 2 }, { count: "2" })
        .result,
    ).toBe(false);
  });
  it("reports missing operands even in a short-circuitable branch", () => {
    expect(
      evaluateCondition(
        {
          op: "any",
          conditions: [{ field: "count", op: "eq", value: 2 }, condition],
        },
        { count: 2 },
      ).missing,
    ).toEqual(["category"]);
  });
  it.each([
    null,
    { op: "all", conditions: [] },
    { op: "any", conditions: "bad" },
    { op: "eval", value: "true" },
    { field: "count", op: "eq", value: "2" },
    { field: "category", op: "eq", value: "unknown" },
    { field: "count", op: "eq", value: Infinity },
    { field: "count", op: "eq", value: 2, script: "ignore" },
  ])("rejects malformed or untyped expressions %j", (c) => {
    expect(validateCondition(c, fields, "condition").length).toBeGreaterThan(0);
  });
  it("rejects excessive nesting and preserves old leaf contracts", () => {
    let c: ReviewCondition = { field: "count", op: "eq", value: 2 };
    expect(validateCondition(c, fields, "condition")).toEqual([]);
    for (let i = 0; i < 6; i++) c = { op: "not", condition: c };
    expect(validateCondition(c, fields, "condition").length).toBeGreaterThan(0);
  });
  it("uses compound conditions in the actual engine and blocks missing values", () => {
    const d = emptyReviewDefinition();
    d.fields = [...fields.values()];
    d.nodes[0].next = "branch";
    d.nodes.push({
      id: "branch",
      name: "分支",
      type: "condition",
      condition,
      next: "review",
      otherwise: "review",
    });
    expect(validateDefinition(d)).toEqual([]);
    const i: any = {
      definition: d,
      values: { count: 2 },
      requester: "employee",
      tasks: [],
      status: "reviewing",
    };
    advanceReview(i, "start", () => ["reviewer"], new Date().toISOString());
    expect(i.status).toBe("blocked");
    expect(i.blockedReason).toContain("category");
    i.values.category = "content";
    advanceReview(i, "start", () => ["reviewer"], new Date().toISOString());
    expect(i.currentNode).toBe("review");
    expect(i.tasks).toHaveLength(1);
  });
});
