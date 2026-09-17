import { approvalRoles, authDisabled, type AppUser } from "../auth.js";
import { employeeById, employeeByMailbox, employeeByName } from "./org.js";
import { defaultOrgSnapshot } from "./snapshot.js";
import type { Employee } from "./types.js";

/** Login user → org employee. Name or mailbox must match the snapshot; no guessing. */
export function employeeForUser(user?: Pick<AppUser, "name" | "username"> | null): Employee | null {
  if (!user) return null;
  const org = defaultOrgSnapshot();
  return employeeByName(org, user.name) || employeeByMailbox(org, user.username);
}

export function canDecideCurrent(
  user: AppUser | undefined,
  chain: string[],
  currentIndex: number,
): boolean {
  if (authDisabled()) return true;
  if (!user) return false;
  const expected = chain[currentIndex];
  if (!expected) return false;
  const person = employeeForUser(user);
  if (person && person.id === expected) return true;
  const roles = approvalRoles();
  if (roles.includes(expected) || roles.includes(person?.name || "")) return true;
  const org = defaultOrgSnapshot();
  const node = employeeById(org, expected);
  return Boolean(node && roles.includes(node.name));
}
