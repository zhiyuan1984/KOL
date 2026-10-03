/**
 * Phase 2 流程解释器：把 FlowDefinition 解释为审批链。
 * 复用 plan.ts 的组织解析（managerAt / roleHolder / effectivePerson / scope 过滤）。
 */
import {
  calculateApprovalPlan,
  effectivePerson,
  managerAt,
  type PlanInput,
} from "./plan.js";
import { defaultOrgSnapshot } from "./snapshot.js";
import { employeeById, roleHolder } from "./org.js";
import type {
  FlowApproverRule,
  FlowDefinition,
  FlowNode,
  FlowTestInput,
  FlowTestResult,
  ApprovalMode,
} from "./flow-types.js";
import type { ApprovalPolicy, Employee } from "./types.js";
import { EXPENSE_POLICY } from "./policy.js";

type Ctx = {
  org: ReturnType<typeof defaultOrgSnapshot>;
  requester: Employee;
  policy: ApprovalPolicy;
  input: PlanInput;
  amountCny: number;
  fields: Record<string, string | number>;
  selectedApprover?: string;
  resolved: Map<string, Employee>; // node_id -> 实际审批人（node_approver 用）
};

/**
 * 安全条件求值（非 eval）：支持数字比较与字符串相等。
 * 变量：amount_cny，以及 fields 中的字段名。
 * 语法示例："amount_cny < 5000", "amount_cny >= 5000 && amount_cny < 50000", "brand == 'LT'"
 */
export function evalCondition(expr: string, vars: Record<string, string | number>): boolean {
  const tokens = expr.trim();
  if (!tokens) return false;
  // 支持 && / || 连接的简单比较
  const orGroups = splitTop(tokens, "||");
  for (const og of orGroups) {
    const andParts = splitTop(og, "&&");
    let andOk = true;
    for (const part of andParts) {
      if (!evalCompare(part.trim(), vars)) { andOk = false; break; }
    }
    if (andOk) return true;
  }
  return false;
}

function splitTop(s: string, sep: "&&" | "||"): string[] {
  const out: string[] = [];
  let cur = "", inStr = false, q = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === q) inStr = false;
      continue;
    }
    if (ch === "'" || ch === '"') { inStr = true; q = ch; cur += ch; continue; }
    if (s.startsWith(sep, i)) { out.push(cur); cur = ""; i += sep.length - 1; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function evalCompare(part: string, vars: Record<string, string | number>): boolean {
  const m = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(<=|>=|==|!=|<|>)\s*(.+)$/);
  if (!m) return false;
  const [, name, op, rawRhs] = m;
  const lhs = vars[name];
  if (lhs == null) return false;
  let rhs: string | number = rawRhs.trim();
  const strM = rhs.match(/^['"](.*)['"]$/);
  if (strM) rhs = strM[1];
  else if (!Number.isNaN(Number(rhs))) rhs = Number(rhs);
  else {
    const v = vars[String(rhs)];
    if (v == null) return false;
    rhs = v;
  }
  switch (op) {
    case "<": return Number(lhs) < Number(rhs);
    case "<=": return Number(lhs) <= Number(rhs);
    case ">": return Number(lhs) > Number(rhs);
    case ">=": return Number(lhs) >= Number(rhs);
    case "==": return String(lhs) === String(rhs);
    case "!=": return String(lhs) !== String(rhs);
    default: return false;
  }
}

function matchesScope(person: Employee, brand?: string, region?: string): boolean {
  const b = String(brand || "").trim().toUpperCase();
  const r = String(region || "").trim();
  if (!b && !r) return true;
  if (b && person.brand && person.brand.toUpperCase() !== b) return false;
  if (r && person.region && person.region !== r) return false;
  return true;
}

function resolveRule(rule: FlowApproverRule, ctx: Ctx): Employee | null {
  const { org, requester, policy } = ctx;
  let person: Employee | null = null;
  switch (rule.kind) {
    case "ceo": {
      person = effectivePerson(org, roleHolder(org, "gm", requester), policy);
      break;
    }
    case "role": {
      const role = rule.role as "finance_owner" | "gm" | "department_leader";
      person = effectivePerson(org, roleHolder(org, role, requester), policy);
      break;
    }
    case "manager_chain": {
      person = managerAt(org, requester, rule.levels, policy);
      break;
    }
    case "named": {
      person = effectivePerson(org, employeeById(org, rule.employee_id), policy);
      break;
    }
    case "self_selected": {
      person = ctx.selectedApprover
        ? effectivePerson(org, employeeById(org, ctx.selectedApprover), policy)
        : null;
      break;
    }
    case "node_approver": {
      person = ctx.resolved.get(rule.node_id) || null;
      break;
    }
  }
  if (person && rule.kind !== "ceo" && !matchesScope(person, ctx.input.brand, ctx.input.region)) {
    return null;
  }
  if (person && policy.skip_self && person.id === requester.id) return null;
  return person;
}

/** 解释流程定义，返回试运行结果（含命中路径与解析出的审批人） */
export function testFlow(flow: FlowDefinition, test: FlowTestInput): FlowTestResult {
  const org = defaultOrgSnapshot();
  const requester =
    (test.requester_name &&
      org.employees.find((e) => e.name === test.requester_name)) ||
    org.employees[0];
  const policy: ApprovalPolicy = { ...EXPENSE_POLICY, skip_self: true };
  // 先用现有引擎算折合人民币（复用汇率逻辑）
  const plan = calculateApprovalPlan({
    requester_name: requester.name,
    amount: test.amount || 0,
    currency: test.currency || "CNY",
    brand: test.brand,
    region: test.region,
  });
  if (plan.blocked) {
    return { ok: false, path: [], steps: [], cc: [], error: plan.blocked.message };
  }
  const ctx: Ctx = {
    org,
    requester,
    policy,
    input: { amount: test.amount || 0, brand: test.brand, region: test.region },
    amountCny: plan.amount_base,
    fields: test.fields || {},
    selectedApprover: test.selected_approver,
    resolved: new Map(),
  };
  const vars: Record<string, string | number> = {
    amount_cny: ctx.amountCny,
    brand: test.brand || "",
    region: test.region || "",
    ...ctx.fields,
  };

  const path: string[] = [];
  const steps: FlowTestResult["steps"] = [];
  const cc: FlowTestResult["cc"] = [];
  const used = new Set<string>();
  let cur: string | undefined = flow.start;
  let guard = 0;

  while (cur && guard++ < 50) {
    const node: FlowNode | undefined = flow.nodes[cur];
    if (!node) return { ok: false, path, steps, cc, error: `未知节点 ${cur}` };
    path.push(cur);
    if (node.type === "end") break;
    if (node.type === "condition") {
      let next: string | undefined;
      let hitId = "";
      for (const b of node.branches) {
        if (evalCondition(b.when, vars)) { next = b.next; hitId = b.id; break; }
      }
      if (!next) next = node.default_next;
      path.push(next === node.default_next && !hitId ? `${cur}:default` : `${cur}:${hitId}`);
      cur = next;
      continue;
    }
    if (node.type === "cc") {
      for (const r of node.approvers) {
        const p = resolveRule(r, ctx);
        if (p) cc.push({ node_id: cur, name: p.name });
      }
      cur = node.next;
      continue;
    }
    if (node.type === "handler") {
      const p = resolveRule(node.approver, ctx);
      if (p && !used.has(p.id)) {
        used.add(p.id);
        steps.push({ node_id: cur, name: p.name, role: `${p.position}（办理）` });
      }
      cur = node.next;
      continue;
    }
    // approval
    const p = resolveRule(node.approver, ctx);
    if (!p) {
      const fb = node.fallback;
      if (fb?.action === "auto_approve") {
        cur = node.next;
        continue;
      }
      if (fb?.action === "transfer_to" && fb.employee_id) {
        const tp = effectivePerson(org, employeeById(org, fb.employee_id), policy);
        if (tp && !used.has(tp.id)) {
          used.add(tp.id);
          ctx.resolved.set(cur, tp);
          steps.push({ node_id: cur, name: tp.name, role: `${tp.position}（转交兜底）`, mode: node.mode });
          cur = node.next;
          continue;
        }
      }
      return { ok: false, path, steps, cc, error: `节点 ${node.title || cur} 解析不到审批人，且未配置兜底` };
    }
    if (used.has(p.id)) {
      return { ok: false, path, steps, cc, error: `节点 ${node.title || cur} 与前面节点审批人重复（${p.name}）` };
    }
    used.add(p.id);
    ctx.resolved.set(cur, p);
    steps.push({ node_id: cur, name: p.name, role: p.position, mode: node.mode });
    cur = node.next;
  }

  // 决策②：末端强制 CEO 终审
  const ceo = effectivePerson(org, roleHolder(org, "gm", requester), policy);
  const lastStep = steps[steps.length - 1];
  if (ceo && (!lastStep || lastStep.name !== ceo.name) && !used.has(ceo.id)) {
    if (!(policy.skip_self && ceo.id === requester.id)) {
      steps.push({ node_id: "__ceo_terminal__", name: ceo.name, role: ceo.position });
      path.push("__ceo_terminal__");
    }
  }
  return { ok: true, path, steps, cc };
}

/** 费用审批三档流的默认 FlowDefinition（与 FIN-EXP 三档语义对齐） */
export function defaultExpenseFlow(): FlowDefinition {
  return {
    start: "n_branch",
    nodes: {
      n_branch: {
        id: "n_branch",
        type: "condition",
        title: "金额分支",
        branches: [
          { id: "b1", label: "小于 5000", when: "amount_cny < 5000", next: "n_mgr" },
          { id: "b2", label: "5000–50000", when: "amount_cny >= 5000 && amount_cny < 50000", next: "n_mgr2" },
        ],
        default_next: "n_mgr3",
      },
      n_mgr: {
        id: "n_mgr", type: "approval", title: "部门经理审批",
        approver: { kind: "manager_chain", levels: 1 }, mode: "single",
        fallback: { action: "transfer_to", employee_id: "emp_wang" },
        next: "n_end",
      },
      n_mgr2: {
        id: "n_mgr2", type: "approval", title: "部门经理审批",
        approver: { kind: "manager_chain", levels: 1 }, mode: "single",
        fallback: { action: "transfer_to", employee_id: "emp_wang" },
        next: "n_l1",
      },
      n_l1: {
        id: "n_l1", type: "approval", title: "一级部门负责人审批",
        approver: { kind: "manager_chain", levels: 2 }, mode: "single",
        next: "n_end",
      },
      n_mgr3: {
        id: "n_mgr3", type: "approval", title: "部门经理审批",
        approver: { kind: "manager_chain", levels: 1 }, mode: "single",
        fallback: { action: "transfer_to", employee_id: "emp_wang" },
        next: "n_l1_3",
      },
      n_l1_3: {
        id: "n_l1_3", type: "approval", title: "一级部门负责人审批",
        approver: { kind: "manager_chain", levels: 2 }, mode: "single",
        next: "n_fin",
      },
      n_fin: {
        id: "n_fin", type: "approval", title: "财务会签",
        approver: { kind: "role", role: "finance_owner" }, mode: "single",
        next: "n_end",
      },
      n_end: { id: "n_end", type: "end", title: "结束（CEO 终审）" },
    },
  };
}
