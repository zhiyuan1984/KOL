import type { Employee, ManagerChainNode, OrgSnapshot } from "./types.js";

export class OrgError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "OrgError";
  }
}

export function employeeById(org: OrgSnapshot, id: string | null | undefined): Employee | null {
  if (!id) return null;
  return org.employees.find((row) => row.id === id) || null;
}

export function employeeByName(org: OrgSnapshot, name: string | null | undefined): Employee | null {
  const needle = String(name || "").trim();
  if (!needle) return null;
  return org.employees.find((row) => row.name === needle) || null;
}

export function employeeByMailbox(org: OrgSnapshot, mailbox: string | null | undefined): Employee | null {
  const email = String(mailbox || "").trim().toLowerCase();
  if (!email) return null;
  return org.employees.find((row) => row.mailboxes.some((item) => item.toLowerCase() === email)) || null;
}

function unitLeaderRole(org: OrgSnapshot, employee: Employee): string {
  const unit = org.units.find((row) => row.leader_id === employee.id);
  return unit?.name ? `${unit.name}负责人` : employee.position;
}

export function getManagerChain(org: OrgSnapshot, employeeId: string): ManagerChainNode[] {
  const start = employeeById(org, employeeId);
  if (!start) throw new OrgError("unknown_employee", `unknown employee ${employeeId}`);
  const out: ManagerChainNode[] = [];
  const seen = new Set<string>([employeeId]);
  let current: string | null = start.manager_id;
  let level = 1;
  while (current) {
    if (seen.has(current)) {
      throw new OrgError("circular_hierarchy", `circular manager chain at ${current}`);
    }
    seen.add(current);
    const person = employeeById(org, current);
    if (!person) throw new OrgError("broken_edge", `manager ${current} is missing`);
    out.push({
      level,
      employee_id: person.id,
      name: person.name,
      role: unitLeaderRole(org, person),
      status: person.status,
      delegate_to: person.delegate_to,
    });
    current = person.manager_id;
    level += 1;
    if (level > 32) throw new OrgError("chain_too_long", "manager chain exceeded 32 levels");
  }
  return out;
}

export function roleHolder(org: OrgSnapshot, role: "finance_owner" | "gm" | "department_leader", requester: Employee): Employee | null {
  if (role === "gm") {
    const root = org.units.find((unit) => !unit.parent_id);
    return employeeById(org, root?.leader_id);
  }
  if (role === "finance_owner") {
    const rel = org.relationships.find((row) => row.type === "FINANCE_OWNER");
    return employeeById(org, rel?.to_id);
  }
  const dept = org.units.find((unit) => unit.id === requester.department_id);
  const promo = org.units.find((unit) => unit.id === (dept?.parent_id || requester.department_id) && unit.level === 1)
    || org.units.find((unit) => unit.id === "org_promo");
  return employeeById(org, promo?.leader_id || dept?.leader_id);
}
