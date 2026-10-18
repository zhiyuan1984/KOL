import { ontologySchema } from '../src/ontology/schema.js';
import { closePostgresPool, postgresTransaction } from '../src/postgres/pool.js';
// Narrow installation path for this feature; no unrelated migrations or seed data.
try {
  await postgresTransaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ontology-schema-v1']);
    await client.query(ontologySchema);
  });
  console.log('Ontology PostgreSQL schema is ready. No business instances were modified.');
} finally { await closePostgresPool(); }
