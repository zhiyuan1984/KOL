/** Idempotent native PostgreSQL reference-data initializer; existing operational state is never overwritten. */
import "../src/config.js";
import { seedPostgresReferenceData } from "../src/postgres/reference-seed.js";
import { closePostgresPool, requiredPostgresUrl } from "../src/postgres/pool.js";
requiredPostgresUrl();
try {
  const result = await seedPostgresReferenceData();
  console.log(JSON.stringify({ ...result, database: "postgres" }));
}
finally {
  await closePostgresPool();
}
