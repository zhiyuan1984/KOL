import { afterAll } from "vitest";
import { dropTestDatabases, freshTestDataDirectory } from "./support/pg.js";
// PostgreSQL test databases are created by this worker only and are released
// after the file completes. No SQLite files or filesystem cleanup fallbacks remain.
// Vitest loads this setup before the test module, so application imports get an
// isolated data root even in pure unit files that do not call freshTestDatabase.
freshTestDataDirectory();
afterAll(async () => {
  await dropTestDatabases();
}, 120000);
