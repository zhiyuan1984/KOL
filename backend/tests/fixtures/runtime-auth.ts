import { Hono } from "hono";
import { tokenDigest } from "../../src/auth.js";
import { kolAgentScopeContext } from "../../src/contract-scope.js";
import { getConn, nowIso } from "../../src/db.js";
import { setAgentSkill } from "../../src/runtime/store.js";

/** Authenticated local test session; never enables a runtime permission bypass. */
export function seedRuntimeTestActor(skills: string[]): string {
  const userId = "usr_runtime_fixture";
  const token = "local-runtime-fixture-cookie";
  const now = nowIso();
  getConn().prepare(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(userId, userId, "Local runtime test admin", "not-a-login-password", '["admin","employee"]', '["LT"]', "", 1, now, now);
  getConn().prepare("INSERT INTO auth_sessions(id_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .run(tokenDigest(token), userId, new Date(Date.now() + 60_000).toISOString(), now);
  for (const skill of skills) setAgentSkill(kolAgentScopeContext().agent_id, skill, true, 0);
  return `lingong_session=${token}`;
}
export function authenticatedTestApp(app: Hono, cookie: string): Hono {
  const request = app.request.bind(app);
  app.request = ((input, init, env, context) => {
    const headers = new Headers(init?.headers);
    headers.set("Cookie", cookie);
    return request(input, { ...init, headers }, env, context);
  }) as Hono["request"];
  return app;
}
