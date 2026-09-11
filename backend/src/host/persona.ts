import { PERSONAS, type Persona } from "../config.js";
import { tx } from "../db.js";
import { authDisabled, scopedUser } from "../auth.js";
import { getPersonaKey } from "./persona-key.js";

export { getPersonaKey, personaAccess } from "./persona-key.js";

export function currentUser(): Persona {
  if (!authDisabled()) {
    const user = scopedUser();
    if (!user) throw new Error("currentUser called without authenticated request context");
    return { ...user };
  }
  const key = getPersonaKey();
  return { ...(PERSONAS[key] || PERSONAS.sriphy) };
}

export function setPersona(key: string): Persona {
  if (!authDisabled()) throw new Error("persona switching is disabled");
  if (!(key in PERSONAS)) throw new Error("unknown persona");
  tx((c) => {
    c.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('persona', ?)").run(key);
  });
  return currentUser();
}
