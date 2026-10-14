import { postgresDb } from "../postgres/access.js";
export async function getPersonaKey(): Promise<string> {
  const row = (await postgresDb().one("SELECT value FROM app_state WHERE key = 'persona'")) as {
    value: string;
  } | undefined;
  return row?.value || "sriphy";
}
export async function personaAccess(key?: string): Promise<{
  roles: string[];
  available_modes: ("employee" | "admin")[];
}> {
  if ((key || (await getPersonaKey())) === "employee")
    return { roles: ["employee"], available_modes: ["employee"] };
  return { roles: ["employee", "admin"], available_modes: ["employee", "admin"] };
}
