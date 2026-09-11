import { getConn } from "../db.js";

export function getPersonaKey(): string {
  const row = getConn().prepare("SELECT value FROM app_state WHERE key = 'persona'").get() as
    | { value: string }
    | undefined;
  return row?.value || "sriphy";
}

export function personaAccess(key = getPersonaKey()): {
  roles: string[];
  available_modes: ("employee" | "admin")[];
} {
  if (key === "employee") return { roles: ["employee"], available_modes: ["employee"] };
  return { roles: ["employee", "admin"], available_modes: ["employee", "admin"] };
}
