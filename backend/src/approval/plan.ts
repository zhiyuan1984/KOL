import { createHash } from "node:crypto";
import { employeeById, employeeByMailbox, employeeByName, getManagerChain, OrgError, roleHolder } from "./org.js";
import { EXPENSE_POLICY, matchExpenseRule, normalizeCurrency, toBaseCny } from "./policy.js";
import { defaultOrgSnapshot } from "./snapshot.js";
import type {
  ApprovalPlan,
  ApprovalPolicy,
  ApprovalStep,
  Employee,
  OrgSnapshot,
  PolicyApprover,
  SearchCitation,
} from "./types.js";

export type PlanInput = {
  requester_id?: string;
  requester_name?: string;
  mailbox?: string;
  amount: number;
  currency?: string;
  business_type?: string;
  purpose?: string;
};

function resolveRequester(org: OrgSnapshot, input: PlanInput): Employee | null {
  return employeeById(org, input.requester_id)
    || employeeByName(org, input.requester_name)
    || employeeByMailbox(org, input.mailbox);
}

function effectivePerson(org: OrgSnapshot, person: Employee | null, policy: ApprovalPolicy): Employee | null {
  if (!person) return null;
  if (policy.skip_inactive && (person.status === "inactive" || person.status === "vacant")) return null;
  if (policy.skip_vacant && person.status === "vacant") return null;
  if (person.status === "leave") {
    const delegate = employeeById(org, person.delegate_to);
    if (delegate && delegate.status === "active") return delegate;
    if (policy.skip_inactive) return null;
  }
  return person;
}

function walkFrom(org: OrgSnapshot, start: Employee, policy: ApprovalPolicy): Employee[] {
  const people: Employee[] = [];
  for (const node of getManagerChain(org, start.id)) {
    const person = effectivePerson(org, employeeById(org, node.employee_id), policy);
    if (person) people.push(person);
  }
  return people;
}

function managerAt(org: OrgSnapshot, requester: Employee, level: number, policy: ApprovalPolicy): Employee | null {
  return walkFrom(org, requester, policy).filter((person) => !(policy.skip_self && person.id === requester.id))[level - 1]
    || null;
}

function fallbackUp(org: OrgSnapshot, requester: Employee, policy: ApprovalPolicy, used: Set<string>): Employee | null {
  for (const person of walkFrom(org, requester, policy)) {
    if (policy.skip_self && person.id === requester.id) continue;
    if (used.has(person.id)) continue;
    return person;
  }
  return null;
}

function resolveApprover(
  org: OrgSnapshot,
  requester: Employee,
  spec: PolicyApprover,
  policy: ApprovalPolicy,
): { person: Employee | null; source: string } {
  if (spec.kind === "manager") {
    return {
      person: managerAt(org, requester, spec.level, policy),
      source: `manager(level=${spec.level})`,
    };
  }
  let person = effectivePerson(org, roleHolder(org, spec.role, requester), policy);
  if (person && policy.skip_self && person.id === requester.id) {
    person = spec.role === "finance_owner"
      ? effectivePerson(org, roleHolder(org, "gm", requester), policy)
      : fallbackUp(org, requester, policy, new Set([requester.id]));
    if (person && person.id === requester.id) person = null;
  }
  return { person, source: `role(${spec.role})` };
}

function emptyPlan(
  policy: ApprovalPolicy,
  input: PlanInput,
  extra: Partial<ApprovalPlan> & { explanation: string; blocked: ApprovalPlan["blocked"] },
): ApprovalPlan {
  return {
    policy_id: policy.id,
    rule_id: extra.rule_id || "",
    business_type: policy.business_type,
    amount: input.amount,
    currency: input.currency || policy.currency,
    amount_base: Number.NaN,
    currency_base: policy.currency,
    fx_rate: Number.NaN,
    requester_id: extra.requester_id || "",
    requester_name: extra.requester_name || String(input.requester_name || ""),
    steps: extra.steps || [],
    explanation: extra.explanation,
    blocked: extra.blocked,
  };
}

export function calculateApprovalPlan(
  input: PlanInput,
  org: OrgSnapshot = defaultOrgSnapshot(),
  policy: ApprovalPolicy = EXPENSE_POLICY,
): ApprovalPlan {
  const requester = resolveRequester(org, input);
  if (!requester) {
    return emptyPlan(policy, input, {
      explanation: "申请人不在组织名单里。请用名单上的姓名或邮箱。",
      blocked: { code: "unknown_requester", message: "requester not in org" },
    });
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return emptyPlan(policy, input, {
      requester_id: requester.id,
      requester_name: requester.name,
      explanation: "还需要金额和币种，例如 50000 美元。",
      blocked: { code: "missing_amount", message: "amount required" },
    });
  }
  const fx = toBaseCny(input.amount, input.currency);
  if ("error" in fx) {
    return emptyPlan(policy, input, {
      requester_id: requester.id,
      requester_name: requester.name,
      explanation: `暂不支持币种 ${fx.currency}。可用人民币、美元、欧元、英镑、日元、澳元、加元、港币。`,
      blocked: { code: "unsupported_currency", message: `unsupported ${fx.currency}` },
    });
  }
  const rule = matchExpenseRule(fx.amount_base, policy);
  if (!rule) {
    return emptyPlan(policy, input, {
      requester_id: requester.id,
      requester_name: requester.name,
      explanation: "No FIN-EXP band matched the CNY-equivalent amount.",
      blocked: { code: "missing_amount", message: "amount required" },
    });
  }

  const steps: ApprovalStep[] = [];
  const used = new Set<string>();
  for (const spec of rule.approvers) {
    let { person, source } = resolveApprover(org, requester, spec, policy);
    if (person && used.has(person.id)) {
      person = fallbackUp(org, requester, policy, used);
      source = `${source}+dedupe`;
      if (!person && spec.kind === "role") continue;
    }
    if (!person) {
      person = fallbackUp(org, requester, policy, used);
      source = `${source}+fallback`;
    }
    if (!person && spec.kind === "manager" && spec.level > 1) continue;
    if (!person && spec.kind === "role" && used.size) continue;
    if (!person) {
      return emptyPlan(policy, input, {
        rule_id: rule.id,
        requester_id: requester.id,
        requester_name: requester.name,
        steps,
        explanation: `Rule ${rule.id} needs ${source}, but the org chain has no fallback.`,
        blocked: { code: "org_level_missing", message: `missing approver for ${source}` },
      });
    }
    used.add(person.id);
    steps.push({
      sequence: steps.length + 1,
      employee_id: person.id,
      name: person.name,
      role: person.position,
      source,
    });
  }

  const names = steps.map((step) => `${step.name}｜${step.role}`).join(" / ");
  return {
    policy_id: policy.id,
    rule_id: rule.id,
    business_type: policy.business_type,
    amount: input.amount,
    currency: fx.currency,
    amount_base: fx.amount_base,
    currency_base: policy.currency,
    fx_rate: fx.rate,
    requester_id: requester.id,
    requester_name: requester.name,
    steps,
    explanation:
      `${policy.name} ${fx.currency} ${input.amount} = ${policy.currency} ${fx.amount_base} @ Host FX ${fx.rate}. `
      + `Rule ${rule.id}: ${names}.`,
    source: "stub_fallback",
  };
}

function citationOf(raw: unknown): SearchCitation | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const source_url = String(row.source_url || "").trim();
  const quote = String(row.quote || "").trim();
  const source_title = String(row.source_title || row.title || "").trim();
  const as_of = String(row.as_of || "").trim();
  const id = String(row.id || "").trim();
  const pair = String(row.pair || "").trim();
  const rate = Number(row.rate);
  if (!source_url && !quote && !source_title && !id && !Number.isFinite(rate)) return null;
  return {
    ...(id ? { id } : {}),
    ...(pair ? { pair } : {}),
    ...(Number.isFinite(rate) && rate > 0 ? { rate } : {}),
    ...(source_title ? { title: source_title, source_title } : {}),
    ...(as_of ? { as_of } : {}),
    ...(source_url ? { source_url } : {}),
    ...(quote ? { quote } : {}),
  };
}

export function hasSearchCitation(raw: unknown): boolean {
  const cite = citationOf(raw);
  if (!cite) return false;
  const url = String(cite.source_url || "");
  const quote = String(cite.quote || "");
  return /^https?:\/\//i.test(url) || quote.length >= 8;
}

function readCitedChain(raw: unknown): { name: string; role?: string; source?: string; employee_id?: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const rec = row as Record<string, unknown>;
    const name = String(rec.name || "").trim();
    const employee_id = String(rec.employee_id || rec.id || "").trim();
    if (!name && !employee_id) return [];
    return [{
      name,
      ...(employee_id ? { employee_id } : {}),
      ...(rec.role ? { role: String(rec.role) } : {}),
      ...(rec.source ? { source: String(rec.source) } : {}),
    }];
  });
}

/**
 * Live path: Codex web_search citations + org-bound names.
 * Returns null when citations are missing so stub/offline can fall back.
 */
export function tryCitedApprovalPlan(
  item: Record<string, unknown> | undefined,
  input: PlanInput,
  org: OrgSnapshot = defaultOrgSnapshot(),
): ApprovalPlan | null {
  if (!item || typeof item !== "object") return null;
  const fxCite = citationOf(item.fx);
  const policyCite = citationOf(item.policy);
  if (!fxCite || !policyCite) return null;
  const currency = normalizeCurrency(input.currency || String(item.currency || "CNY"));
  const rate = Number(fxCite.rate ?? item.fx_rate);
  const cnyOk = currency === "CNY" && (rate === 1 || !Number.isFinite(rate));
  if (!cnyOk && (!hasSearchCitation(item.fx) || !Number.isFinite(rate) || rate <= 0)) return null;
  if (!hasSearchCitation(item.policy)) return null;
  const chainRaw = readCitedChain(item.chain || item.steps);
  if (!chainRaw.length) return null;

  const requester = resolveRequester(org, input);
  if (!requester) {
    return emptyPlan(EXPENSE_POLICY, input, {
      explanation: "申请人不在组织名单里。请用名单上的姓名或邮箱。",
      blocked: { code: "unknown_requester", message: "requester not in org" },
    });
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) return null;

  const fxRate = currency === "CNY" ? 1 : rate;
  const citedBase = Number(item.amount_cny ?? item.amount_base);
  const amount_base = Number.isFinite(citedBase) && citedBase > 0
    ? Math.round(citedBase * 100) / 100
    : Math.round(input.amount * fxRate * 100) / 100;
  const ruleId = String(policyCite.id || item.rule_id || policyCite.title || "searched-policy").trim();
  const steps: ApprovalStep[] = [];
  const used = new Set<string>();
  for (const row of chainRaw) {
    const person = employeeById(org, row.employee_id) || employeeByName(org, row.name);
    if (!person) {
      return emptyPlan(EXPENSE_POLICY, input, {
        rule_id: ruleId,
        requester_id: requester.id,
        requester_name: requester.name,
        explanation: `${row.name || row.employee_id} 不在本轮组织绑定里，不能写入审批链。`,
        blocked: { code: "unknown_approver", message: "approver not in org binding" },
      });
    }
    if (used.has(person.id)) continue;
    used.add(person.id);
    steps.push({
      sequence: steps.length + 1,
      employee_id: person.id,
      name: person.name,
      role: row.role || person.position,
      source: row.source || "codex_search",
    });
  }
  if (!steps.length) return null;
  const fxUrl = fxCite.source_url || "";
  const policyUrl = policyCite.source_url || "";
  const names = steps.map((step) => `${step.name}｜${step.role}`).join(" / ");
  return {
    policy_id: String(policyCite.title || ruleId),
    rule_id: ruleId,
    business_type: String(input.business_type || item.business_type || "marketing_expense"),
    amount: input.amount,
    currency,
    amount_base,
    currency_base: "CNY",
    fx_rate: fxRate,
    requester_id: requester.id,
    requester_name: requester.name,
    steps,
    explanation:
      `${currency} ${input.amount} × ${fxRate} = CNY ${amount_base}`
      + `${fxCite.as_of ? `（${fxCite.as_of}）` : ""}`
      + `${fxUrl ? `，汇率来源 ${fxUrl}` : fxCite.quote ? `，汇率摘录「${fxCite.quote.slice(0, 80)}」` : ""}`
      + `。适用 ${ruleId}`
      + `${policyUrl ? `，制度 ${policyUrl}` : policyCite.quote ? `，制度摘录「${policyCite.quote.slice(0, 80)}」` : ""}`
      + `。人员路径：${names}。`,
    fx_citation: fxCite,
    policy_citation: policyCite,
    source: "search",
  };
}

/** Identity match against the org snapshot only. Not language NLU. */
export function hintRequesterFromOrg(text: string, org: OrgSnapshot = defaultOrgSnapshot()): Employee | null {
  return org.employees.find((row) => text.includes(row.name)) || null;
}

const ISO_CURRENCY = "USD|EUR|GBP|CNY|JPY|AUD|CAD|HKD|RMB";
const CURRENCY_WORD: Record<string, string> = {
  美元: "USD",
  美金: "USD",
  欧元: "EUR",
  英镑: "GBP",
  日元: "JPY",
  人民币: "CNY",
  港币: "HKD",
  RMB: "CNY",
};

function readNumber(raw: string): number {
  return Number(String(raw).replace(/,/g, ""));
}

function mapCurrency(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim();
  const named = CURRENCY_WORD[key] || CURRENCY_WORD[key.toUpperCase()];
  if (named) return named;
  const iso = key.toUpperCase();
  return new RegExp(`^(?:${ISO_CURRENCY})$`).test(iso) ? (iso === "RMB" ? "CNY" : iso) : undefined;
}

/** Read amount / ISO currency / purpose from visible tokens. Not free-form translation. */
export function readExpenseFactsFromText(text: string): Partial<PlanInput> {
  const t = String(text || "");
  let amount: number | undefined;
  let currency: string | undefined;
  const wan = /(\d+(?:\.\d+)?)\s*万\s*(美元|美金|欧元|英镑|日元|人民币|港币|USD|EUR|GBP|JPY|CNY|HKD|RMB)?/i.exec(t);
  const leading = new RegExp(`(?:${ISO_CURRENCY})\\s*[:：]?\\s*(\\d[\\d,]*(?:\\.\\d+)?)`, "i").exec(t);
  const leadingCur = new RegExp(`(${ISO_CURRENCY})\\s*[:：]?\\s*\\d`, "i").exec(t);
  const trailing = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${ISO_CURRENCY}|美元|美金|欧元|英镑|日元|人民币|港币)`, "i").exec(t);
  const dollar = /\$\s*(\d[\d,]*(?:\.\d+)?)/.exec(t);
  if (wan) {
    amount = Number(wan[1]) * 10000;
    currency = mapCurrency(wan[2]) || (wan[2] ? undefined : "CNY");
  } else if (leading && leadingCur) {
    amount = readNumber(leading[1]);
    currency = mapCurrency(leadingCur[1]);
  } else if (trailing) {
    amount = readNumber(trailing[1]);
    currency = mapCurrency(trailing[2]);
  } else if (dollar) {
    amount = readNumber(dollar[1]);
    currency = "USD";
  }
  const hinted = hintRequesterFromOrg(t);
  return {
    ...(Number.isFinite(amount) && amount && amount > 0 ? { amount } : {}),
    ...(currency ? { currency } : {}),
    ...(hinted ? { requester_name: hinted.name, requester_id: hinted.id } : {}),
    purpose: /广告|KOL|营销|推广|marketing|campaign/i.test(t) ? "marketing" : undefined,
  };
}

/** Worker / task entities may fill facts. Host never accepts approvers / chain / steps. */
export function expenseFactsFromWorkerItem(item: Record<string, unknown> | undefined): Partial<PlanInput> {
  if (!item || typeof item !== "object") return {};
  const out: Partial<PlanInput> = {};
  const amount = Number(item.amount);
  if (Number.isFinite(amount) && amount > 0) out.amount = amount;
  if (item.requester_name) out.requester_name = String(item.requester_name);
  if (item.requester_id) out.requester_id = String(item.requester_id);
  if (item.mailbox) out.mailbox = String(item.mailbox);
  if (item.purpose) out.purpose = String(item.purpose);
  if (item.currency) out.currency = String(item.currency).trim().toUpperCase();
  if (item.business_type) out.business_type = String(item.business_type);
  return out;
}

/** Stable integer of the published plan content. Used as create expected_version. */
export function planContentVersion(plan: Pick<ApprovalPlan, "policy_id" | "rule_id" | "amount" | "currency" | "requester_id" | "steps">): number {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      policy_id: plan.policy_id || "",
      rule_id: plan.rule_id || "",
      amount: plan.amount,
      currency: plan.currency,
      requester_id: plan.requester_id || "",
      steps: (plan.steps || []).map((step) => step.employee_id),
    }))
    .digest();
  return digest.readUInt32BE(0);
}

export { getManagerChain, OrgError };
