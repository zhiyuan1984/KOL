import { compareDecimal, validDecimal, validMoney } from "./review-numeric.js";
import type {
  ReviewCondition,
  ReviewField,
  ReviewIssue,
} from "../../../shared/review.js";

/** Bounded AST, no scripts or implicit type coercion. Missing operands never select a branch. */
export function validateCondition(
  input: unknown,
  fields: Map<string, ReviewField>,
  path: string,
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  let count = 0;
  const visit = (value: unknown, p: string, depth: number) => {
    const bad = (message: string) => issues.push({ path: p, message });
    if (++count > 100 || depth > 6) {
      bad("条件最多 100 项、6 层");
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      bad("条件必须为对象");
      return;
    }
    const c = value as ReviewCondition;
    const allowed =
      c.op === "not"
        ? ["op", "condition"]
        : ["all", "any"].includes(c.op)
          ? ["op", "conditions"]
          : ["op", "field", "value"];
    if (Object.keys(c).some((k) => !allowed.includes(k))) bad("未知条件属性");
    if (c.op === "not") {
      visit(c.condition, `${p}.condition`, depth + 1);
      return;
    }
    if (c.op === "all" || c.op === "any") {
      if (
        !Array.isArray(c.conditions) ||
        !c.conditions.length ||
        c.conditions.length > 20
      ) {
        bad("条件组须有 1–20 项");
        return;
      }
      c.conditions.forEach((child, i) =>
        visit(child, `${p}.conditions.${i}`, depth + 1),
      );
      return;
    }
    const f = fields.get(c.field);
    if (
      !f ||
      f.type === "attachment" ||
      !["eq", "ne", "gt", "gte", "lt", "lte", "contains"].includes(c.op)
    ) {
      bad("条件必须引用已有字段与受支持的运算符");
      return;
    }
    if (f.type === "decimal" || f.type === "money") {
      if (
        c.op === "contains" ||
        !(f.type === "decimal"
          ? validDecimal(c.value, f, false)
          : validMoney(c.value, f, false))
      )
        bad("比较值必须符合字段精度与币种配置");
      return;
    }
    if (
      !["string", "number"].includes(typeof c.value) ||
      (typeof c.value === "number" && !Number.isFinite(c.value))
    )
      bad("比较值必须为文本或有限数值");
    else if (
      ["gt", "gte", "lt", "lte"].includes(c.op) &&
      (f.type !== "number" || typeof c.value !== "number")
    )
      bad("大小比较只能用于数值字段");
    else if (
      c.op === "contains" &&
      (!["text", "textarea", "multiselect"].includes(f.type) ||
        typeof c.value !== "string")
    )
      bad("包含只能用于文本或多选字段的文本值");
    else if (
      c.op !== "contains" &&
      (f.type === "multiselect" ||
        (f.type === "number") !== (typeof c.value === "number"))
    )
      bad("比较值与字段类型不一致");
    else if (
      ["select", "multiselect"].includes(f.type) &&
      !f.options?.includes(String(c.value))
    )
      bad("比较值必须属于已配置选项");
  };
  visit(input, path, 1);
  return issues;
}

export function evaluateCondition(
  c: ReviewCondition,
  values: Record<string, unknown>,
  fields: ReviewField[] = [],
): { result: boolean; missing: string[] } {
  if (c.op === "all" || c.op === "any") {
    // Evaluate every operand to expose missing data even when Boolean short-circuiting could hide it.
    const children = c.conditions.map((child) =>
      evaluateCondition(child, values, fields),
    );
    return {
      result:
        c.op === "all"
          ? children.every((r) => r.result)
          : children.some((r) => r.result),
      missing: [...new Set(children.flatMap((r) => r.missing))],
    };
  }
  if (c.op === "not") {
    const child = evaluateCondition(c.condition, values, fields);
    return { ...child, result: !child.result };
  }
  const value = values[c.field];
  if (value === undefined || value === null || value === "")
    return { result: false, missing: [c.field] };
  const f = fields.find((f) => f.id === c.field);
  if (f?.type === "decimal" || f?.type === "money") {
    let comparison: number;
    if (f.type === "decimal") {
      if (!validDecimal(value, f) || !validDecimal(c.value, f, false))
        return { result: false, missing: [c.field] };
      comparison = compareDecimal(value, c.value);
    } else {
      if (
        !validMoney(value, f) ||
        !validMoney(c.value, f, false) ||
        value.currency !== c.value.currency
      )
        return { result: false, missing: [c.field] };
      comparison = compareDecimal(value.amount, c.value.amount);
    }
    const result =
      c.op === "eq"
        ? comparison === 0
        : c.op === "ne"
          ? comparison !== 0
          : c.op === "gt"
            ? comparison > 0
            : c.op === "gte"
              ? comparison >= 0
              : c.op === "lt"
                ? comparison < 0
                : c.op === "lte"
                  ? comparison <= 0
                  : false;
    return { result, missing: [] };
  }
  let result = false;
  switch (c.op) {
    case "eq":
      result = value === c.value;
      break;
    case "ne":
      result = value !== c.value;
      break;
    case "contains":
      result = Array.isArray(value)
        ? value.includes(c.value)
        : typeof value === "string" && value.includes(String(c.value));
      break;
    case "gt":
      result = typeof value === "number" && value > Number(c.value);
      break;
    case "gte":
      result = typeof value === "number" && value >= Number(c.value);
      break;
    case "lt":
      result = typeof value === "number" && value < Number(c.value);
      break;
    case "lte":
      result = typeof value === "number" && value <= Number(c.value);
      break;
  }
  return { result, missing: [] };
}
