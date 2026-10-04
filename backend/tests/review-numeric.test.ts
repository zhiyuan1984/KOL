import { describe, it, expect } from "vitest";
import {
  emptyReviewDefinition,
  type ReviewField,
} from "../../shared/review.js";
import {
  validateDefinition,
  validateValues,
  advanceReview,
} from "../src/approval/review-engine.js";
import { compareDecimal } from "../src/approval/review-numeric.js";
import {
  validateCondition,
  evaluateCondition,
} from "../src/approval/review-conditions.js";

const decimal: ReviewField = {
  id: "quantity",
  label: "精确数量",
  type: "decimal",
  required: true,
  numeric: { precision: 38, scale: 18 },
};
const money: ReviewField = {
  id: "price",
  label: "金额",
  type: "money",
  required: true,
  numeric: { precision: 22, scale: 2, min: "0" },
  currencies: ["CNY", "USD"],
  currencySource: "测试制度 v1（夹具）",
};
const definition = (field: ReviewField) => ({
  ...emptyReviewDefinition(),
  fields: [field],
});

describe("exact decimal and configured currency", () => {
  it("compares beyond safe integers and keeps the last decimal digit", () => {
    expect(compareDecimal("9007199254740993.01", "9007199254740993.00")).toBe(
      1,
    );
    expect(compareDecimal("0.000000000000000001", "0")).toBe(1);
    expect(compareDecimal("-9007199254740993.01", "-9007199254740993.00")).toBe(
      -1,
    );
    expect(compareDecimal("-0.00", "0")).toBe(0);
    expect(compareDecimal("1.00", "1")).toBe(0);
  });
  it.each([
    1.2,
    "1e3",
    "NaN",
    "01.2",
    "+1",
    "1,000",
    " 1",
    "1.",
    "0.0000000000000000001",
  ])("rejects coerced or imprecise decimal input %s", (value) => {
    expect(
      validateValues(definition(decimal), { quantity: value }).length,
    ).toBeGreaterThan(0);
  });
  it("validates precision, bounds and source rather than inventing currency defaults", () => {
    expect(validateDefinition(definition(money))).toEqual([]);
    expect(
      validateValues(definition(money), {
        price: { amount: "9007199254740993.01", currency: "CNY" },
      }),
    ).toEqual([]);
    for (const value of [
      { amount: "-0.01", currency: "CNY" },
      { amount: "1.001", currency: "CNY" },
      { amount: "1", currency: "EUR" },
      { amount: 1, currency: "CNY" },
      { amount: "1", currency: "CNY", rate: 1 },
    ])
      expect(
        validateValues(definition(money), { price: value }).length,
      ).toBeGreaterThan(0);
    for (const field of [
      { ...money, currencies: [] },
      { ...money, currencySource: "" },
      { ...decimal, numeric: { precision: 2, scale: 3 } },
      { ...decimal, numeric: { precision: 5, scale: 2, min: "10", max: "1" } },
    ])
      expect(validateDefinition(definition(field)).length).toBeGreaterThan(0);
  });
  it("evaluates precise decimal and monetary conditions without float conversion", () => {
    const condition = {
      field: money.id,
      op: "gt" as const,
      value: { amount: "9007199254740993.00", currency: "CNY" },
    };
    expect(
      validateCondition(condition, new Map([[money.id, money]]), "condition"),
    ).toEqual([]);
    expect(
      evaluateCondition(
        condition,
        { price: { amount: "9007199254740993.01", currency: "CNY" } },
        [money],
      ),
    ).toEqual({ result: true, missing: [] });
    expect(
      evaluateCondition(
        { field: decimal.id, op: "eq", value: "1.00" },
        { quantity: "1" },
        [decimal],
      ),
    ).toEqual({ result: true, missing: [] });
    expect(
      validateCondition(
        { field: decimal.id, op: "contains", value: "1" },
        new Map([[decimal.id, decimal]]),
        "condition",
      ).length,
    ).toBeGreaterThan(0);
  });
  it("currency mismatch blocks even inside a negated compound predicate", () => {
    const condition = {
      op: "not" as const,
      condition: {
        field: money.id,
        op: "gt" as const,
        value: { amount: "1", currency: "CNY" },
      },
    };
    const d = definition(money);
    d.nodes[0].next = "branch";
    d.nodes.push({
      id: "branch",
      name: "币种比较",
      type: "condition",
      condition,
      next: "review",
      otherwise: "review",
    });
    const i: Parameters<typeof advanceReview>[0] = {
      id: "i",
      templateId: "t",
      templateVersion: 1,
      version: 1,
      requester: "employee",
      title: "测试",
      definition: d,
      values: { price: { amount: "2", currency: "USD" } },
      currentNode: "",
      status: "reviewing",
      tasks: [],
      createdAt: "2026-10-04T00:00:00Z",
      updatedAt: "2026-10-04T00:00:00Z",
    };
    expect(validateDefinition(d)).toEqual([]);
    advanceReview(i, "start", () => ["reviewer"], i.createdAt);
    expect(i.status).toBe("blocked");
    expect(i.tasks).toEqual([]);
    expect(i.blockedReason).toContain("币种");
  });
});
