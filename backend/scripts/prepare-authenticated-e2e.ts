import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { DEMO_ADMIN } from '../src/config.js';
import { getConn, resetConn } from '../src/db.js';
import { assertDisposableTestDatabase } from '../src/seed.js';
import { assertRuntimeSkill } from '../src/runtime/execution.js';
import { ensureManagedAgents } from '../src/runtime/managed-agents.js';
import { createAgentBinding, syncUserOrganization } from '../src/runtime/organization-tree.js';
import { ensureRuntimeSchema, getAgentSkills, setAgentSkill } from '../src/runtime/store.js';

/** Native authenticated browser fixture; never valid in a live/shared database. */
export async function prepareAuthenticatedE2E(): Promise<{ userId: string; bindingIds: Record<string, string> }> {
  if (process.env.NODE_ENV !== 'test' || process.env.CODEX_MODE !== 'stub' || process.env.AUTH_MODE !== 'enabled') {
    throw new Error('authenticated E2E requires NODE_ENV=test, CODEX_MODE=stub and AUTH_MODE=enabled');
  }
  await assertDisposableTestDatabase();
  const db = getConn();
  const { rows } = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
  if (Number(rows[0]?.count) !== 0) throw new Error('authenticated E2E bootstrap requires a new empty owned test database');
  const app = await createApp();
  const username = process.env.E2E_TEST_USERNAME || DEMO_ADMIN.handle;
  const password = process.env.E2E_TEST_PASSWORD || DEMO_ADMIN.password;
  const setup = await app.request('/api/auth/setup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, name: DEMO_ADMIN.name, password, brands: ['LT', 'RO', 'PQ'] }),
  });
  if (setup.status !== 201) throw new Error(`authenticated E2E setup rejected:${setup.status}`);
  const account = (await db.query<{ id: string }>('SELECT id FROM users WHERE username=$1', [username])).rows[0];
  if (!account) throw new Error('authenticated E2E account missing');
  const personRef = await syncUserOrganization(account.id, 'org:lt_team');
  await ensureManagedAgents();
  await ensureRuntimeSchema();
  const bindingIds: Record<string, string> = {};
  for (const agentId of ['agent:kol', 'agent:workspace-planner']) {
    const binding = await createAgentBinding({ agent_id: agentId, target_type: 'person', target_id: personRef,
      company_id: 'company:amperetime', source: 'test:authenticated-e2e', reason: 'owned stub browser fixture' });
    bindingIds[agentId] = binding.id;
  }
  const current = (await getAgentSkills('agent:kol')).find(row => row.skill_id === 'crawler_collect');
  if (!current || !current.enabled) await setAgentSkill('agent:kol', 'crawler_collect', true, current ? Number(current.version) : 0);
  for (const [agentId, skillId] of [['agent:kol', 'crawler_collect'], ['agent:workspace-planner', 'today_plan']]) {
    await assertRuntimeSkill({ agentId, skillId, userId: account.id, runId: 'authenticated-e2e:qualification' });
  }
  // Prove the actual auth middleware creates a valid native session; a legacy
  // login success body without cookies must never count as authenticated.
  const login = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!login.ok || !cookie) throw new Error('authenticated E2E native login/session missing');
  const status = await app.request('/api/auth/status', { headers: { cookie } });
  const result = await status.json() as { authenticated?: boolean; user?: { id?: string } };
  if (!result.authenticated || result.user?.id !== account.id) throw new Error('authenticated E2E session verification failed');
  return { userId: account.id, bindingIds };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await prepareAuthenticatedE2E();
    console.log('Authenticated stub E2E account, native session and published Agent qualifications verified');
  } finally { await resetConn(); }
}
