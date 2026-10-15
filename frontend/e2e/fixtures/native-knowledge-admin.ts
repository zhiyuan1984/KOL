import { createRequire } from 'node:module';

/**
 * A catalog positive case needs a current native users row; a display persona
 * is not an administrator grant. This fixture is opt-in per knowledge suite
 * and may never create or alter principals on production/real-mode databases.
 */
export async function prepareNativeKnowledgeAdmin(): Promise<void> {
  if (process.env.E2E_MODE !== 'stub' || process.env.E2E_AUTH_MODE === 'enabled' || process.env.NODE_ENV !== 'test') {
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
    await client.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8)
      ON CONFLICT (id) DO UPDATE SET roles=EXCLUDED.roles,active=1,updated_at=EXCLUDED.updated_at`,
      ['sriphy', 'sriphy', '隔离知识管理员', 'fixture-no-login-password', '["employee","admin"]', '["LT","RO","PQ"]', '', stamp]);
  } finally {
    await client.end();
  }
}
