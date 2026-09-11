import type { ApprovalPolicy, PolicyRule } from "./types.js";

/**
 * Stub / offline fallback only. Live bands and FX come from Codex web_search
 * per backend/skills/business_approval/approval-policy.md.
 * Do not edit these numbers to change policy — edit the skill.
 */
export const FX_TO_CNY: Record<string, number> = {
  CNY: 1,
  RMB: 1,
  CNH: 1,
  USD: 7.2,
  EUR: 7.8,
  GBP: 9.1,
  JPY: 0.048,
  AUD: 4.7,
  CAD: 5.2,
  HKD: 0.92,
};

export function normalizeCurrency(code: string | null | undefined): string {
  const raw = String(code || "CNY").trim().toUpperCase();
  if (raw === "RMB" || raw === "CNH") return "CNY";
  return raw;
}

export function toBaseCny(amount: number, currency?: string | null): {
  currency: string;
  rate: number;
  amount_base: number;
} | { currency: string; error: "unsupported_currency" } {
  const iso = normalizeCurrency(currency);
  const rate = FX_TO_CNY[iso];
  if (rate == null) return { currency: iso, error: "unsupported_currency" };
  return { currency: iso, rate, amount_base: Math.round(amount * rate * 100) / 100 };
}

/** Stub / offline FIN-EXP shape. Live tiers are searched; do not edit this table to change policy. */
export const EXPENSE_POLICY: ApprovalPolicy = {
  id: "FIN-EXP",
  name: "Marketing Expense",
  business_type: "marketing_expense",
  currency: "CNY",
  skip_self: true,
  skip_inactive: true,
  skip_vacant: true,
  skip_same_person: true,
  rules: [
    {
      id: "FIN-EXP-001",
      amount_min: 0,
      amount_max: 5000,
      approvers: [{ kind: "manager", level: 1 }],
    },
    {
      id: "FIN-EXP-002",
      amount_min: 5000.01,
      amount_max: 20000,
      approvers: [
        { kind: "manager", level: 1 },
        { kind: "manager", level: 2 },
      ],
    },
    {
      id: "FIN-EXP-003",
      amount_min: 20000.01,
      amount_max: 100000,
      approvers: [
        { kind: "manager", level: 1 },
        { kind: "manager", level: 2 },
        { kind: "role", role: "finance_owner" },
      ],
    },
    {
      id: "FIN-EXP-004",
      amount_min: 100000.01,
      amount_max: null,
      approvers: [
        { kind: "manager", level: 1 },
        { kind: "manager", level: 2 },
        { kind: "role", role: "finance_owner" },
        { kind: "role", role: "gm" },
      ],
    },
  ],
};

export function matchExpenseRule(amount: number, policy: ApprovalPolicy = EXPENSE_POLICY): PolicyRule | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  return policy.rules.find((rule) =>
    amount >= rule.amount_min && (rule.amount_max == null || amount <= rule.amount_max),
  ) || null;
}
