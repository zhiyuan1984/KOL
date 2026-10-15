import { Client } from "pg";
import { requiredPostgresUrl } from "../src/postgres/pool.js";
import { applyPostgresMigrations } from "../src/postgres/migrations.js";
const client = new Client({ connectionString: requiredPostgresUrl() });
await client.connect();
try {
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
  const applied = await applyPostgresMigrations(client, { only });
  console.log(JSON.stringify({ applied, database: "postgres" }));
} finally { await client.end(); }
