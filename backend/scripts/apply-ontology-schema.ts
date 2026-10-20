import { applyPostgresMigrations } from '../src/postgres/migrations.js';
import { closePostgresPool, postgresPool } from '../src/postgres/pool.js';
// Narrow, ledger-backed installation path.  The workspace schema precedes the
// independent WeCom source snapshot tables; this command never seeds instances
// or widens a runtime Agent/connector grant.
try {
  const client = await postgresPool().connect();
  try {
    for (const id of ['20261018_ontology_workspace_v1', '20261020_wecom_ontology_source_v1']) {
      await applyPostgresMigrations(client, { only: id });
    }
  } finally { client.release(); }
  console.log('Ontology and WeCom source PostgreSQL schemas are ready from the formal ledger. No business instances or runtime grants were modified.');
} finally { await closePostgresPool(); }
