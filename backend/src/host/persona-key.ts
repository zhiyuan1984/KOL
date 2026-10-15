import { getConn } from "../db.js";

export async function getPersonaKey(): Promise<Awaited<string>> {
  const row = (await getConn().query("SELECT value FROM app_state WHERE key = 'persona'",[])).rows[0] as
    | { value: string }
    | undefined;
  return row?.value || "sriphy";
}

export function personaAccess(key = (await getPersonaKey())): {
  roles: string[];
  available_modes: ("employee" | "admin")[];
} {
  if (key === "employee") return { roles: ["employee"], available_modes: ["employee"] };
  return { roles: ["employee", "admin"], available_modes: ["employee", "admin"] };
}
