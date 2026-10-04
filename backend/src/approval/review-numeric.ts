import type { ReviewField, ReviewMoney } from "../../../shared/review.js";

// Bounded decimal strings only: never round, coerce an IEEE float, or convert currency.
export function decimalParts(
  value: unknown,
): { units: bigint; scale: number; integerDigits: number } | undefined {
  if (
    typeof value !== "string" ||
    value.length > 60 ||
    !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)
  )
    return;
  const [integer, fraction = ""] = value.replace(/^-/, "").split(".");
  return {
    units: BigInt(`${value.startsWith("-") ? "-" : ""}${integer}${fraction}`),
    scale: fraction.length,
    integerDigits: integer === "0" ? 0 : integer.length,
  };
}

export function compareDecimal(left: string, right: string): number {
  const a = decimalParts(left),
    b = decimalParts(right);
  if (!a || !b) throw new Error("无效的精确数值");
  const scale = Math.max(a.scale, b.scale);
  const x = a.units * 10n ** BigInt(scale - a.scale),
    y = b.units * 10n ** BigInt(scale - b.scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function validDecimal(
  value: unknown,
  field: ReviewField,
  checkBounds = true,
): value is string {
  const p = decimalParts(value),
    n = field.numeric;
  if (
    !p ||
    !n ||
    !Number.isInteger(n.precision) ||
    n.precision < 1 ||
    n.precision > 38 ||
    !Number.isInteger(n.scale) ||
    n.scale < 0 ||
    n.scale > 18 ||
    n.scale > n.precision ||
    p.scale > n.scale ||
    p.integerDigits > n.precision - n.scale
  )
    return false;
  if (
    checkBounds &&
    ((n.min !== undefined && !decimalParts(n.min)) ||
      (n.max !== undefined && !decimalParts(n.max)))
  )
    return false;
  return (
    !checkBounds ||
    ((!n.min || compareDecimal(value as string, n.min) >= 0) &&
      (!n.max || compareDecimal(value as string, n.max) <= 0))
  );
}

export function validMoney(
  value: unknown,
  field: ReviewField,
  checkBounds = true,
): value is ReviewMoney {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as ReviewMoney;
  return (
    Object.keys(v).every((k) => ["amount", "currency"].includes(k)) &&
    validDecimal(v.amount, field, checkBounds) &&
    typeof v.currency === "string" &&
    Array.isArray(field.currencies) &&
    field.currencies.includes(v.currency)
  );
}

export function numericConfigurationErrors(field: ReviewField): string[] {
  const n = field.numeric;
  if (!["decimal", "money"].includes(field.type))
    return n || field.currencies || field.currencySource
      ? ["精确数值配置只能用于十进制或货币字段"]
      : [];
  if (
    !n ||
    typeof n !== "object" ||
    Array.isArray(n) ||
    Object.keys(n).some(
      (k) => !["precision", "scale", "min", "max"].includes(k),
    ) ||
    !Number.isInteger(n.precision) ||
    n.precision < 1 ||
    n.precision > 38 ||
    !Number.isInteger(n.scale) ||
    n.scale < 0 ||
    n.scale > 18 ||
    n.scale > n.precision
  )
    return ["须配置 1–38 位精度及 0–18 位小数，小数位不能超过精度"];
  const errors: string[] = [];
  for (const key of ["min", "max"] as const)
    if (n[key] !== undefined && !validDecimal(n[key], field, false))
      errors.push("上下限必须是符合精度的十进制字符串");
  if (
    !errors.length &&
    n.min !== undefined &&
    n.max !== undefined &&
    compareDecimal(n.min, n.max) > 0
  )
    errors.push("下限不能超过上限");
  if (field.type === "money") {
    if (
      !Array.isArray(field.currencies) ||
      !field.currencies.length ||
      field.currencies.length > 100 ||
      field.currencies.some(
        (c) => typeof c !== "string" || !/^[A-Z]{3}$/.test(c),
      ) ||
      new Set(field.currencies).size !== field.currencies.length
    )
      errors.push("须提供不重复的三位大写币种代码字典");
    if (
      typeof field.currencySource !== "string" ||
      !field.currencySource.trim() ||
      field.currencySource.length > 500
    )
      errors.push("须注明币种字典及金额规则的业务来源和版本");
  } else if (field.currencies || field.currencySource)
    errors.push("币种配置只能用于货币字段");
  return errors;
}
