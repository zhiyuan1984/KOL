import { scryptSync } from 'node:crypto';
import { createRequire } from 'node:module';

export const nativeKnowledgePrincipal = {
  id: 'sriphy',
  username: 'sriphy',
  password: 'NativeKnowledgeE2E!2026',
  company: 'company:amperetime',
  agentId: 'agent:kol',
  skillId: 'email_compose',
} as const;

/**
 * A catalog positive case needs a current native users row; a display persona
 * is not an administrator grant. This fixture is opt-in per knowledge suite
 * and may never create or alter principals on production/real-mode databases.
 */
export async function prepareNativeKnowledgeAdmin(): Promise<void> {
  const authMode = process.env.E2E_AUTH_MODE || 'disabled';
  if (process.env.E2E_MODE !== 'stub' || !['disabled', 'enabled'].includes(authMode) || process.env.NODE_ENV !== 'test') {
    throw new Error('Native knowledge fixture requires explicit isolated stub/test mode');
  }
  const url = process.env.DATABASE_URL;
  const prefix = String(process.env.TEST_DB_PREFIX || '');
  if (!url || !/^[a-z_][a-z0-9_]+$/.test(prefix)) throw new Error('Native knowledge fixture requires explicit isolated database authority');
  const declaredDatabase = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!declaredDatabase.startsWith(`${prefix}_`)) throw new Error('Refusing knowledge fixture outside the declared test prefix');
  const backendRequire = createRequire(new URL('../../../backend/package.json', import.meta.url));
  const { Client } = backendRequire('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query('SELECT current_database() AS name');
    if (result.rows[0]?.name !== declaredDatabase || !String(result.rows[0]?.name).startsWith(`${prefix}_`)) {
      throw new Error('Knowledge fixture database identity mismatch');
    }
    const stamp = new Date().toISOString();
    const salt = Buffer.from(`native-knowledge:${declaredDatabase}`);
    const passwordHash = `scrypt$${salt.toString('base64')}$${scryptSync(nativeKnowledgePrincipal.password, salt, 64).toString('base64')}`;
    await client.query('BEGIN');
    try {
      await client.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email,phone)
        VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8,$9,'')
        ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,
          roles=EXCLUDED.roles,brands=EXCLUDED.brands,active=1,email=EXCLUDED.email,updated_at=EXCLUDED.updated_at`,
      [nativeKnowledgePrincipal.id, nativeKnowledgePrincipal.username, '隔离知识管理员', passwordHash,
        '["employee","admin"]', '["LT","RO","PQ"]', '', stamp, 'sriphy.yan@amperetime.com']);
      // This is the established built-in KOL assembly; its actual organization
      // binding is seeded by ensureOrganizationTree after native login.
      await client.query(`INSERT INTO managed_agents(id,name,description,status,version,created_at,updated_at)
        VALUES($1,$2,$3,'published',1,$4,$4)
        ON CONFLICT (id) DO UPDATE SET status='published',updated_at=EXCLUDED.updated_at`,
      [nativeKnowledgePrincipal.agentId, 'KOL 智能体', 'KOL 合作与跟进能力', stamp]);
      await client.query(`INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at)
        VALUES($1,$2,1,1,$3)
        ON CONFLICT (agent_id,skill_id) DO UPDATE SET enabled=1,updated_at=EXCLUDED.updated_at`,
      [nativeKnowledgePrincipal.agentId, nativeKnowledgePrincipal.skillId, stamp]);
      // Do not manufacture an organization row: link only the confirmed
      // registry person after ensureOrganizationTree has supplied it. The
      // first invocation before login is intentionally a no-op; global setup
      // invokes this helper again after that native bootstrap.
      await client.query(`UPDATE organization_people
        SET user_id=$1,user_ref=$1,email=$2,status='active',updated_at=$3
        WHERE person_ref='person:yan_chen' AND status='active'`,
      [nativeKnowledgePrincipal.id, 'sriphy.yan@amperetime.com', stamp]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}
