import { HttpFail } from "./errors.js";

/** Strict non-negative integer. null / "" / NaN are not version 0. */
export function parseExpectedVersion(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && !Object.is(value, -0)) {
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value.trim())) {
    return Number(value.trim());
  }
  throw new HttpFail(400, "expected_version 必须是非负整数");
}
