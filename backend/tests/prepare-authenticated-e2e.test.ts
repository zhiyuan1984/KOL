import { afterEach, beforeEach, expect, it } from 'vitest';
import { prepareAuthenticatedE2E } from '../scripts/prepare-authenticated-e2e.js';
import { createApp } from '../src/app.js';
import { DEMO_ADMIN } from '../src/config.js';
import { getConn, resetConn } from '../src/db.js';
import { assertRuntimeSkill } from '../src/runtime/execution.js';
import { revokeAgentBinding } from '../src/runtime/organization-tree.js';
import { freshTestDatabase } from './support/pg.js';

beforeEach(async () => {
  await freshTestDatabase({ reclaimPrevious: true });
  process.env.NODE_ENV = 'test'; process.env.CODEX_MODE = 'stub'; process.env.AUTH_MODE = 'enabled';
});
afterEach(async () => { await resetConn(); process.env.AUTH_MODE = 'disabled'; process.env.NODE_ENV = 'test'; process.env.CODEX_MODE = 'stub'; });

it.each([
  ['NODE_ENV', 'production'], ['CODEX_MODE', 'real'], ['AUTH_MODE', 'disabled'],
  ['TEST_DB_PREFIX', 'wrong_owner'],
])('rejects unsafe %s before creating any users', async (key, value) => {
  const previous = process.env[key];
  process.env[key] = value;
  try { await expect(prepareAuthenticatedE2E()).rejects.toThrow(); }
  finally { process.env[key] = previous; }
  const { rows } = await getConn().query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
  expect(Number(rows[0]?.count)).toBe(0);
});

it('bootstraps a real local session and both published Agent qualifications; revocation still refuses', async () => {
  const { userId, bindingIds } = await prepareAuthenticatedE2E();
  const app = await createApp();
  const anonymous = await (await app.request('/api/auth/status')).json() as { authenticated: boolean };
  expect(anonymous.authenticated).toBe(false);
  const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: DEMO_ADMIN.handle, password: DEMO_ADMIN.password }) });
  expect(login.ok).toBe(true);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  expect(cookie).toBeTruthy();
  const authenticated = await (await app.request('/api/auth/status', { headers: { cookie: cookie! } })).json() as { authenticated: boolean; user: { id: string } };
  expect(authenticated).toMatchObject({ authenticated: true, user: { id: userId } });
  for (const [agentId, skillId] of [['agent:kol', 'crawler_collect'], ['agent:workspace-planner', 'today_plan']] as const) {
    await expect(assertRuntimeSkill({ agentId, skillId, userId, runId: 'test:authenticated-e2e' })).resolves.toBeTruthy();
    expect(bindingIds[agentId]).toBeTruthy();
    // Reference organization facts can give this account legitimate inherited
    // eligibility. In this exclusively owned DB, revoke ALL current sources
    // through the formal API before asserting there is no runtime qualification.
    const { rows: bindings } = await getConn().query<{ id: string }>("SELECT id FROM agent_bindings WHERE agent_id=$1 AND status='active'", [agentId]);
    expect(bindings.some(row => row.id === bindingIds[agentId])).toBe(true);
    for (const binding of bindings) {
      await expect(revokeAgentBinding(binding.id, { reason: 'test revoke all owned fixture sources' })).resolves.toBe(true);
    }
    await expect(assertRuntimeSkill({ agentId, skillId, userId, runId: 'test:revoked-e2e' })).rejects.toMatchObject({ detail: { code: 'runtime_agent_not_usable' } });
  }
  // No rebootstrap/password reset/claiming a pre-existing account is allowed.
  await expect(prepareAuthenticatedE2E()).rejects.toThrow('new empty owned test database');
});
