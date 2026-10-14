import { PERSONAS, type Persona } from "../config.js";
import { pgTransaction } from "../postgres/access.js";
import { authDisabled, scopedUser } from "../auth.js";
import { getPersonaKey } from "./persona-key.js";
export { getPersonaKey, personaAccess } from "./persona-key.js";
export async function currentUser(): Promise<Persona> {
  if (!authDisabled()) {
    const user = scopedUser();
    if (!user)
      throw new Error("currentUser called without authenticated request context");
    return { ...user };
  }
  const key = (await getPersonaKey());
  return { ...(PERSONAS[key] || PERSONAS.sriphy) };
}
export async function setPersona(key: string): Promise<Persona> {
  if (!authDisabled())
    throw new Error("persona switching is disabled");
  if (!(key in PERSONAS))
    throw new Error("unknown persona");
  (await pgTransaction(async (c) => {
    (await c.execute("INSERT INTO app_state (key, value) VALUES ('persona', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", key));
  }));
  return (await currentUser());
}
