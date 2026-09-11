import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateApprovalPlan, expenseFactsFromWorkerItem, hintRequesterFromOrg, readExpenseFactsFromText, tryCitedApprovalPlan } from "../src/approval/plan.js";
import { approvalBoxGuardrails, sandboxPolicyForSkill } from "../src/worker/common.js";
import { writeSkillIntoBox } from "../src/host/skill-sop.js";
import { FX_TO_CNY, matchExpenseRule, normalizeCurrency, toBaseCny } from "../src/approval/policy.js";
import { employeeByMailbox, getManagerChain, OrgError, roleHolder } from "../src/approval/org.js";
import { defaultOrgSnapshot } from "../src/approval/snapshot.js";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { stubResolveTaskIntent } from "../src/tasks/resolver.js";
import type { OrgSnapshot } from "../src/approval/types.js";

function cloneOrg(): OrgSnapshot {
  return JSON.parse(JSON.stringify(defaultOrgSnapshot())) as OrgSnapshot;
}

function planOf(
  requester: string,
  amount: number,
  currency = "CNY",
  org?: OrgSnapshot,
  extra: { mailbox?: string; requester_id?: string } = {},
) {
  const plan = calculateApprovalPlan({
    requester_name: requester,
    amount,
    currency,
    ...extra,
  }, org);
  return { plan, names: plan.steps.map((step) => step.name), rule: plan.rule_id, blocked: plan.blocked?.code };
}

describe("org resolver", () => {
  it.each([
    ["黎玉燕", "emp_liyuanyan", ["林桐", "王主管", "张总"]],
    ["陈冰冰", "emp_chenbingbing", ["赖逸询", "王主管", "张总"]],
    ["叶观旺", "emp_yeguanwang", ["钟槿年", "王主管", "张总"]],
    ["林桐", "emp_lintong", ["王主管", "张总"]],
    ["王主管", "emp_wang", ["张总"]],
    ["张总", "emp_zhang", []],
  ])("manager chain for %s is deterministic", (_name, id, expected) => {
    expect(getManagerChain(defaultOrgSnapshot(), id).map((node) => node.name)).toEqual(expected);
  });

  it("resolves requester by mailbox from the owner list", () => {
    const person = employeeByMailbox(defaultOrgSnapshot(), "Marketing.US@ipowerqueen.com");
    expect(person?.name).toBe("黎玉燕");
    expect(planOf("", 5000, "CNY", undefined, { mailbox: "ipowerqueenmarketing@gmail.com" }).names).toEqual(["林桐"]);
  });

  it("hints requester only when the org snapshot name appears in text", () => {
    expect(hintRequesterFromOrg("Please help 黎玉燕")?.id).toBe("emp_liyuanyan");
    expect(hintRequesterFromOrg("someone named 张三")).toBeNull();
  });

  it("reads USD 50,000 and 5万美金 from the visible tokens", () => {
    expect(readExpenseFactsFromText("黎玉燕申请 USD 50,000 广告费")).toMatchObject({
      amount: 50000,
      currency: "USD",
      requester_name: "黎玉燕",
      purpose: "marketing",
    });
    expect(readExpenseFactsFromText("黎玉燕申请5万美金")).toMatchObject({
      amount: 50000,
      currency: "USD",
      requester_name: "黎玉燕",
    });
    expect(readExpenseFactsFromText("费用审批").amount).toBeUndefined();
    expect(readExpenseFactsFromText("费用审批").currency).toBeUndefined();
  });

  it("resolves functional roles from the graph, not from language", () => {
    const li = defaultOrgSnapshot().employees.find((row) => row.id === "emp_liyuanyan")!;
    const org = defaultOrgSnapshot();
    expect(roleHolder(org, "finance_owner", li)?.name).toBe("财务负责人");
    expect(roleHolder(org, "gm", li)?.name).toBe("张总");
    expect(roleHolder(org, "department_leader", li)?.name).toBe("王主管");
  });

  it("rejects circular hierarchy", () => {
    const org = cloneOrg();
    org.employees.find((row) => row.id === "emp_wang")!.manager_id = "emp_liyuanyan";
    expect(() => getManagerChain(org, "emp_liyuanyan")).toThrow(OrgError);
    try {
      getManagerChain(org, "emp_liyuanyan");
    } catch (error) {
      expect((error as OrgError).code).toBe("circular_hierarchy");
    }
  });

  it("rejects a broken manager edge", () => {
    const org = cloneOrg();
    org.employees.find((row) => row.id === "emp_lintong")!.manager_id = "emp_missing";
    expect(() => getManagerChain(org, "emp_liyuanyan")).toThrow(/emp_missing/);
  });

  it("rejects an unknown employee id", () => {
    expect(() => getManagerChain(defaultOrgSnapshot(), "emp_nobody")).toThrow(/unknown employee/);
  });
});

describe("FIN-EXP amount bands (CNY-equivalent)", () => {
  it.each([
    [5000, "FIN-EXP-001"],
    [5000.01, "FIN-EXP-002"],
    [20000, "FIN-EXP-002"],
    [20000.01, "FIN-EXP-003"],
    [100000, "FIN-EXP-003"],
    [100000.01, "FIN-EXP-004"],
    [1_000_000, "FIN-EXP-004"],
  ])("%s CNY → %s", (amount, rule) => {
    expect(matchExpenseRule(amount)?.id).toBe(rule);
    expect(planOf("黎玉燕", amount).rule).toBe(rule);
  });

  it("lists 0 on the band table but the plan still requires a positive amount", () => {
    expect(matchExpenseRule(0)?.id).toBe("FIN-EXP-001");
    expect(matchExpenseRule(Number.NaN)).toBeNull();
    expect(matchExpenseRule(-1)).toBeNull();
    expect(planOf("黎玉燕", Number.NaN).blocked).toBe("missing_amount");
    expect(planOf("黎玉燕", 0).blocked).toBe("missing_amount");
  });
});

describe("published Host FX", () => {
  it.each(Object.entries(FX_TO_CNY))("lists %s", (code, rate) => {
    const fx = toBaseCny(100, code);
    expect("error" in fx).toBe(false);
    if (!("error" in fx)) expect(fx.rate).toBe(rate);
  });

  it.each([
    ["cny", "CNY"],
    ["RMB", "CNY"],
    ["cnh", "CNY"],
    ["usd", "USD"],
  ])("normalizes %s → %s", (raw, iso) => {
    expect(normalizeCurrency(raw)).toBe(iso);
  });

  it.each([
    ["USD", 50000, 360000, "FIN-EXP-004"],
    ["EUR", 500, 3900, "FIN-EXP-001"],
    ["GBP", 800, 7280, "FIN-EXP-002"],
    ["JPY", 100000, 4800, "FIN-EXP-001"],
    ["AUD", 5000, 23500, "FIN-EXP-003"],
    ["CAD", 3000, 15600, "FIN-EXP-002"],
    ["HKD", 10000, 9200, "FIN-EXP-002"],
    ["CNY", 50000, 50000, "FIN-EXP-003"],
    ["RMB", 50000, 50000, "FIN-EXP-003"],
  ] as const)("%s %s → %s CNY / %s", (currency, amount, base, rule) => {
    const fx = toBaseCny(amount, currency);
    expect("error" in fx).toBe(false);
    if (!("error" in fx)) expect(fx.amount_base).toBe(base);
    const got = planOf("黎玉燕", amount, currency);
    expect(got.blocked).toBeUndefined();
    expect(got.rule).toBe(rule);
    expect(got.plan.amount).toBe(amount);
    expect(got.plan.amount_base).toBe(base);
  });

  it("defaults missing currency to CNY", () => {
    expect(toBaseCny(5000, undefined)).toEqual({ currency: "CNY", rate: 1, amount_base: 5000 });
  });

  it("rejects an unsupported currency instead of inventing a rate", () => {
    expect(toBaseCny(10, "BTC")).toEqual({ currency: "BTC", error: "unsupported_currency" });
    expect(planOf("黎玉燕", 50000, "BTC").blocked).toBe("unsupported_currency");
  });
});

describe("expense approval plan · personnel cases", () => {
  it("1 普通员工 5K → 直属主管", () => {
    expect(planOf("黎玉燕", 5000)).toMatchObject({ rule: "FIN-EXP-001", names: ["林桐"] });
  });

  it("2 普通员工 10K → 直属主管 + 部门负责人", () => {
    expect(planOf("黎玉燕", 10000).names).toEqual(["林桐", "王主管"]);
  });

  it("3 普通员工 50K → 直属主管 + 部门负责人 + 财务", () => {
    const got = planOf("黎玉燕", 50000);
    expect(got.names).toEqual(["林桐", "王主管", "财务负责人"]);
    expect(got.plan.explanation).toContain("FIN-EXP-003");
  });

  it("4 部门负责人 10K → skip_self 向上", () => {
    const got = planOf("林桐", 10000);
    expect(got.names[0]).toBe("王主管");
    expect(got.names).not.toContain("林桐");
  });

  it("5 部门负责人 50K → skip_self + 财务", () => {
    expect(planOf("林桐", 50000).names).toEqual(["王主管", "张总", "财务负责人"]);
  });

  it("6 事业部负责人 100K → skip_self + 财务", () => {
    const got = planOf("王主管", 100000);
    expect(got.names[0]).toBe("张总");
    expect(got.names).toContain("财务负责人");
    expect(got.names).not.toContain("王主管");
  });

  it("7 审批人休假 → 代理人", () => {
    const org = cloneOrg();
    org.employees.find((row) => row.id === "emp_laiyixun")!.status = "leave";
    expect(planOf("陈冰冰", 5000, "CNY", org).names).toEqual(["凌嘉余"]);
  });

  it("7b 休假且无代理人 → skip_inactive 向上", () => {
    const org = cloneOrg();
    const lai = org.employees.find((row) => row.id === "emp_laiyixun")!;
    lai.status = "leave";
    lai.delegate_to = null;
    expect(planOf("陈冰冰", 5000, "CNY", org).names).toEqual(["王主管"]);
  });

  it("7c 代理人也 inactive → 继续向上", () => {
    const org = cloneOrg();
    org.employees.find((row) => row.id === "emp_laiyixun")!.status = "leave";
    org.employees.find((row) => row.id === "emp_lingjiayu")!.status = "inactive";
    expect(planOf("陈冰冰", 5000, "CNY", org).names).toEqual(["王主管"]);
  });

  it("8 审批人离职 → skip_inactive 向上", () => {
    const org = cloneOrg();
    org.employees.find((row) => row.id === "emp_lintong")!.status = "inactive";
    expect(planOf("黎玉燕", 5000, "CNY", org).names).toEqual(["王主管"]);
  });

  it("9 组织层级缺失 → 向上回退", () => {
    const org = cloneOrg();
    org.employees.find((row) => row.id === "emp_wang")!.status = "vacant";
    const got = planOf("黎玉燕", 10000, "CNY", org);
    expect(got.names[0]).toBe("林桐");
    expect(got.names).toContain("张总");
    expect(got.names).not.toContain("王主管");
  });

  it("10 申请人和审批人相同 → skip_self", () => {
    const got = planOf("财务负责人", 50000);
    expect(got.names).not.toContain("财务负责人");
    expect(got.names[0]).toBe("张总");
  });

  it("11 申请人不在组织快照 → 阻断", () => {
    expect(planOf("张三", 5000).blocked).toBe("unknown_requester");
  });

  it("12 GM 没有上级 → 阻断而不是让模型指定", () => {
    expect(planOf("张总", 5000).blocked).toBe("org_level_missing");
  });

  it("13 LT / RO 员工走各自品牌组负责人", () => {
    expect(planOf("叶观旺", 5000).names).toEqual(["钟槿年"]);
    expect(planOf("余佳妮", 10000).names).toEqual(["赖逸询", "王主管"]);
  });
});

describe("cited search plan (not TypeScript constants)", () => {
  const searchedUsd = {
    type: "create_approval",
    amount: 50000,
    currency: "USD",
    requester_name: "黎玉燕",
    amount_cny: 356500,
    fx: {
      pair: "USD/CNY",
      rate: 7.13,
      as_of: "2026-09-04",
      source_title: "人民币汇率中间价",
      source_url: "https://www.pbc.gov.cn/example-mid-rate",
      quote: "1美元对人民币 7.1300 元",
    },
    policy: {
      id: "营销费用-大额",
      title: "费用报销审批权限",
      as_of: "2026-01-01",
      source_url: "https://intranet.example.com/policy/expense",
      quote: "折合人民币超过十万元须至总经理",
    },
    chain: [
      { name: "林桐", role: "PQ品牌组负责人", source: "汇报线" },
      { name: "王主管", role: "推广部负责人", source: "汇报线" },
      { name: "财务负责人", role: "财务负责人", source: "制度档位" },
      { name: "张总", role: "总经理", source: "制度档位" },
    ],
  };

  it("keeps the searched FX rate and does not replace it with 7.2", () => {
    const plan = tryCitedApprovalPlan(searchedUsd, {
      requester_name: "黎玉燕",
      amount: 50000,
      currency: "USD",
    });
    expect(plan).toBeTruthy();
    expect(plan?.source).toBe("search");
    expect(plan?.fx_rate).toBe(7.13);
    expect(plan?.amount_base).toBe(356500);
    expect(plan?.rule_id).toBe("营销费用-大额");
    expect(plan?.steps.map((step) => step.name)).toEqual(["林桐", "王主管", "财务负责人", "张总"]);
    expect(plan?.explanation).toContain("pbc.gov.cn");
    expect(plan?.explanation).not.toContain("7.2");
  });

  it("rejects a chain name that is not on the org binding", () => {
    const plan = tryCitedApprovalPlan({
      ...searchedUsd,
      chain: [{ name: "虚构审批人", role: "外人" }],
    }, { requester_name: "黎玉燕", amount: 50000, currency: "USD" });
    expect(plan?.blocked?.code).toBe("unknown_approver");
  });

  it("returns null without citations so stub can fall back", () => {
    expect(tryCitedApprovalPlan({
      type: "create_approval",
      amount: 50000,
      currency: "USD",
      requester_name: "黎玉燕",
      chain: [{ name: "林桐" }],
    }, { requester_name: "黎玉燕", amount: 50000, currency: "USD" })).toBeNull();
  });

  it("copies approval-policy.md into the box and asks Codex to web_search", () => {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-skillbox-"));
    try {
      writeSkillIntoBox(box, "business_approval");
      const policy = fs.readFileSync(path.join(box, "approval-policy.md"), "utf8");
      const skill = fs.readFileSync(path.join(box, "SKILL.md"), "utf8");
      expect(policy).toContain("web_search");
      expect(policy).toContain("不要改 TypeScript 常数");
      expect(policy).not.toMatch(/\|\s*USD\s*\|\s*7\.2\s*\|/);
      expect(skill).toContain("web_search");
      expect(approvalBoxGuardrails().some((line) => line.includes("web_search"))).toBe(true);
      expect(sandboxPolicyForSkill("business_approval", box).networkAccess).toBe(true);
      expect(sandboxPolicyForSkill("kol", box).networkAccess).toBe(false);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
});

describe("worker item sanitization", () => {
  it("keeps amount, currency, name; never approvers or chain", () => {
    const facts = expenseFactsFromWorkerItem({
      type: "create_approval",
      amount: 50000,
      currency: "usd",
      requester_name: "黎玉燕",
      mailbox: "ipowerqueenmarketing@gmail.com",
      purpose: "KOL",
      approvers: ["张三", "李四"],
      chain: ["emp_fake"],
      steps: [{ name: "虚构审批人" }],
    });
    expect(facts).toEqual({
      amount: 50000,
      currency: "USD",
      requester_name: "黎玉燕",
      mailbox: "ipowerqueenmarketing@gmail.com",
      purpose: "KOL",
    });
    const plan = calculateApprovalPlan({
      requester_name: facts.requester_name,
      amount: Number(facts.amount),
      currency: facts.currency,
    });
    expect(plan.rule_id).toBe("FIN-EXP-004");
    expect(plan.steps.map((step) => step.name).join()).not.toContain("张三");
  });
});

describe("Skill aliases route; quote language does not", () => {
  it.each([
    ["费用审批", "business_approval"],
    ["黎玉燕申请 USD 50,000 广告费", "business_approval"],
    ["申请费用", "business_approval"],
    ["查看审批路径", "business_approval"],
    ["前往工作审批查看审批路径", "business_approval"],
    ["黎玉燕要申请5万美国KOL推广预算", "business_approval"],
    ["expense approval for 黎玉燕", "business_approval"],
    ["budget request 5000 CNY", "business_approval"],
    ["Genehmigung 黎玉燕", "business_approval"],
    ["Freigabe", "business_approval"],
    ["経費申請", "business_approval"],
    ["예산 신청", "business_approval"],
    ["写报价信 金额 680", "email_compose"],
    ["写一份报价邮件 金额 680", "email_compose"],
    ["给@数码老张 写报价确认邮件 金额 500", "email_compose"],
  ])("%s → %s", (text, type) => {
    expect(stubResolveTaskIntent({ text }).task_type).toBe(type);
  });

  it("task resolver uses the same Skill aliases and does not extract amount in Host", () => {
    expect(stubResolveTaskIntent({ text: "expense approval 50000 USD" }).task_type).toBe("business_approval");
    expect(stubResolveTaskIntent({ text: "経費申請" }).task_type).toBe("business_approval");
    expect(stubResolveTaskIntent({ text: "写报价信 金额 680" }).task_type).toBe("email_compose");
    expect(stubResolveTaskIntent({ text: "黎玉燕要申请5万美国KOL推广预算" }).entities.amount).toBeUndefined();
  });
});

describe("expense approval host path", () => {
  let tmp = "";
  let app: Hono;

  async function request(method: string, url: string, body?: unknown) {
    const response = await app.request(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
  }

  async function ask(text: string, intent?: string) {
    const session = await request("POST", "/api/sessions", { title: text.slice(0, 20) });
    return request("POST", `/api/sessions/${String(session.body.id)}/messages`, {
      text,
      ...(intent ? { intent } : {}),
    });
  }

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-approval-"));
    process.env.LINGONG_DB = path.join(tmp, "t.db");
    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "stub";
    resetConn();
    seedAll();
    const { createApp } = await import("../src/app.js");
    app = createApp();
  });

  afterEach(() => {
    resetConn();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("computes 黎玉燕 5万 on the Host and cites FIN-EXP-003", async () => {
    const posted = await ask("黎玉燕要申请5万美国KOL推广预算", "business_approval");
    expect(posted.status).toBe(200);
    expect((posted.body.worker as { skill?: string } | null)?.skill).toBe("business_approval");
    const plan = posted.body.approval_plan as { rule_id: string; steps: { name: string }[]; explanation: string };
    expect(plan.rule_id).toBe("FIN-EXP-003");
    expect(plan.steps.map((step) => step.name)).toEqual(["林桐", "王主管", "财务负责人"]);
    expect(plan.explanation).toContain("FIN-EXP-003");
    const listed = await request("GET", "/api/approvals");
    const rows = listed.body as unknown as { kind: string; payload?: { rule_id?: string } }[];
    expect(rows.some((row) => row.kind === "expense")).toBe(true);
  });

  it("routes a spoken expense request without an explicit intent", async () => {
    const posted = await ask("黎玉燕要申请5万美国KOL推广预算");
    expect(posted.status).toBe(200);
    expect((posted.body.intent as { type?: string }).type).toBe("business_approval");
    expect((posted.body.approval_plan as { rule_id: string }).rule_id).toBe("FIN-EXP-003");
  });

  it("lets the worker normalize English + USD; Host FX picks FIN-EXP-004", async () => {
    const posted = await ask("Please file an expense approval for 黎玉燕 50000 USD KOL spend");
    expect(posted.status).toBe(200);
    const plan = posted.body.approval_plan as { rule_id: string; currency: string; amount_base: number; fx_rate: number };
    expect(plan.rule_id).toBe("FIN-EXP-004");
    expect(plan.currency).toBe("USD");
    expect(plan.amount_base).toBe(360000);
    expect(plan.fx_rate).toBe(7.2);
    const firstMessages = JSON.stringify(posted.body.messages || []);
    expect(firstMessages).toContain("林桐");
    expect(firstMessages).toContain("FIN-EXP-004");
    expect(firstMessages).not.toContain("未提供已落库");
  });

  it("replays the stored people path when asked to view Approvals", async () => {
    const first = await ask("Please file an expense approval for 黎玉燕 50000 USD KOL spend");
    expect(first.status).toBe(200);
    const created = first.body.approval as { id: string; payload: { rule_id: string; steps: { name: string }[] } };
    expect(created.payload.rule_id).toBe("FIN-EXP-004");
    expect(created.payload.steps.map((step) => step.name)).toEqual(["林桐", "王主管", "财务负责人", "张总"]);

    const follow = await ask("前往工作审批查看审批路径");
    expect(follow.status).toBe(200);
    expect((follow.body.approval_plan as { rule_id: string }).rule_id).toBe("FIN-EXP-004");
    const replayed = follow.body.approval as { id: string; payload: { rule_id: string; steps: { name: string }[] } };
    expect(replayed.id).toBe(created.id);
    expect(replayed.payload.rule_id).toBe("FIN-EXP-004");
    expect(replayed.payload.steps.map((step) => step.name)).toEqual(["林桐", "王主管", "财务负责人", "张总"]);
    const blob = JSON.stringify(follow.body.messages || []);
    expect(blob).toContain("林桐");
    expect(blob).toContain("王主管");
    expect(blob).toContain("财务负责人");
    expect(blob).toContain("张总");
    expect(blob).toContain("FIN-EXP-004");
    expect(blob).toContain(`/approvals?id=${created.id}`);
    expect(blob).not.toContain("未提供已落库");
    expect(blob).not.toContain("无法读取具体人员路径");
    expect((follow.body.messages as { kind: string }[]).some((row) => row.kind === "supplement_card")).toBe(false);
  });

  it.each([
    ["Genehmigung 黎玉燕 5000 CNY", "FIN-EXP-001", "CNY"],
    ["経費申請 黎玉燕 10000 CNY", "FIN-EXP-002", "CNY"],
    ["예산 신청 黎玉燕 800 GBP", "FIN-EXP-002", "GBP"],
    ["expense approval 叶观旺 700 USD", "FIN-EXP-002", "USD"],
  ])("host %s → %s", async (text, rule, currency) => {
    const posted = await ask(text);
    expect(posted.status).toBe(200);
    const plan = posted.body.approval_plan as { rule_id: string; currency: string };
    expect(plan.rule_id).toBe(rule);
    expect(plan.currency).toBe(currency);
  });

  it("asks for amount/currency instead of guessing when the Skill item is incomplete", async () => {
    const posted = await ask("费用审批");
    expect(posted.status).toBe(200);
    expect(posted.body.approval_plan).toBeUndefined();
    const messages = posted.body.messages as { kind: string; payload?: { title?: string; message?: string; fields?: { key: string; label?: string }[] } }[];
    const card = messages.find((row) => row.kind === "supplement_card");
    expect(card).toBeTruthy();
    expect(card?.payload?.title).toBe("还需要金额和币种");
    expect(card?.payload?.message).toContain("金额和币种");
    expect(JSON.stringify(card)).not.toMatch(/ISO currency|Do not name approvers|Host will not parse/i);
  });

  it("submits 黎玉燕 USD 50,000 广告费 without a supplement card", async () => {
    const posted = await ask("黎玉燕申请 USD 50,000 广告费");
    expect(posted.status).toBe(200);
    const plan = posted.body.approval_plan as { rule_id: string; currency: string; amount: number; amount_base: number };
    expect(plan.rule_id).toBe("FIN-EXP-004");
    expect(plan.currency).toBe("USD");
    expect(plan.amount).toBe(50000);
    expect(plan.amount_base).toBe(360000);
    const blob = JSON.stringify(posted.body.messages || []);
    expect(blob).not.toContain("supplement_card");
    expect(blob).not.toMatch(/Amount \/ currency|ISO currency|Do not name approvers|Understand an expense/i);
    expect(blob).toContain("林桐");
  });

  it("blocks an unknown requester after the worker emits facts", async () => {
    const posted = await ask("expense approval for 张三 5000 CNY");
    expect(posted.status).toBe(200);
    expect((posted.body.approval_plan as { blocked?: { code: string } }).blocked?.code).toBe("unknown_requester");
  });

  it("does not treat a quote compose turn as expense", async () => {
    const posted = await ask("给@数码老张 写报价确认邮件 金额 680", "email_compose");
    expect((posted.body.intent as { type?: string }).type).toBe("email_compose");
    expect((posted.body.approval as { kind?: string } | null)?.kind || "quote").not.toBe("expense");
  });

  it("persists the Host chain so later decide cannot restaff", async () => {
    const posted = await ask("黎玉燕要申请5万美国KOL推广预算");
    const approval = posted.body.approval as { id: string; chain: string[]; payload: { steps: { name: string }[] } };
    expect(approval.chain.length).toBe(3);
    expect(approval.payload.steps.map((step) => step.name)).toEqual(["林桐", "王主管", "财务负责人"]);
    const detail = await request("GET", `/api/approvals/${approval.id}`);
    expect((detail.body as { kind: string }).kind).toBe("expense");
  });

  it("walks FIN-EXP-004 through every node to 已办结 without exposing record ids", async () => {
    const posted = await ask("Please file an expense approval for 黎玉燕 50000 USD KOL spend");
    const approval = posted.body.approval as {
      id: string;
      chain: string[];
      wecom_card?: { body?: string };
      payload: { rule_id: string; steps: { name: string }[] };
    };
    expect(approval.payload.rule_id).toBe("FIN-EXP-004");
    expect(approval.payload.steps.map((step) => step.name)).toEqual(["林桐", "王主管", "财务负责人", "张总"]);
    expect(String(approval.wecom_card?.body || "")).toContain("请 林桐 确认");
    expect(String(approval.wecom_card?.body || "")).not.toMatch(/approval_id|chain_id|appr_/);

    for (let index = 0; index < approval.chain.length; index += 1) {
      const decided = await request("POST", `/api/approvals/${approval.id}/decide`, {
        decision: "approve",
        actor: approval.chain[index],
      });
      expect(decided.status).toBe(200);
      const row = decided.body as {
        status: string;
        current_index: number;
        expense?: boolean;
        wecom_card?: { body?: string };
        chain_detail?: { name: string }[];
      };
      expect(String(row.wecom_card?.body || "")).not.toMatch(/approval_id|chain_id|appr_/);
      if (index < approval.chain.length - 1) {
        expect(row.status).toBe("pending");
        expect(row.current_index).toBe(index + 1);
        expect(row.chain_detail?.[row.current_index]?.name).toBe(approval.payload.steps[index + 1].name);
        expect(String(row.wecom_card?.body || "")).toContain(`${approval.payload.steps[index].name} 已同意`);
        expect(String(row.wecom_card?.body || "")).toContain(`请 ${approval.payload.steps[index + 1].name} 确认`);
      } else {
        expect(row.status).toBe("consumed");
        expect(row.expense).toBe(true);
        expect(String(row.wecom_card?.body || "")).toContain("张总 已同意");
        expect(String(row.wecom_card?.body || "")).toContain("已办结");
      }
    }

    const listed = await request("GET", "/api/wecom/cards");
    const cards = listed.body as unknown as { body?: string }[];
    expect(cards.every((card) => !/approval_id|chain_id|appr_/.test(String(card.body || "")))).toBe(true);
    expect(cards.some((card) => String(card.body || "").includes("已办结"))).toBe(true);
  });
});
