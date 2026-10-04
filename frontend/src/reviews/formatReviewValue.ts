export function formatReviewValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(String).join("、");
  if (typeof value === "object" && "amount" in value && "currency" in value)
    return `${String(value.amount)} ${String(value.currency)}`;
  return String(value);
}
