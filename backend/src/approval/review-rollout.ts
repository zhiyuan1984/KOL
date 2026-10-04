/** Drain mode stops new instances while preserving decisions, workers and receipts. */
export function reviewIntake(tenant: string) {
  const mode = process.env.REVIEW_V2_NEW_REQUESTS ?? "enabled";
  const allowed = process.env.REVIEW_V2_COMPANIES;
  if (mode !== "enabled")
    return {
      allowed: false,
      reason: "通用评审已暂停新发起；已有申请仍可继续处理。",
    };
  if (
    allowed !== undefined &&
    !allowed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(tenant)
  )
    return { allowed: false, reason: "当前组织尚未开放通用评审新发起。" };
  return { allowed: true, reason: "" };
}
