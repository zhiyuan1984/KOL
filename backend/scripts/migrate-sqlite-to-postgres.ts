import path from "node:path";
import process from "node:process";
import { dbPath } from "../src/config.js";
import { migrateSqliteToPostgres } from "../src/postgres/sqlite-migration.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const source = path.resolve(option("--source") || process.env.SQLITE_SOURCE || dbPath());
const databaseUrl = option("--database-url") || process.env.DATABASE_URL;
const replace = process.argv.includes("--replace");
const verifyOnly = process.argv.includes("--verify-only");

if (!databaseUrl) {
  console.error("DATABASE_URL or --database-url is required");
  process.exitCode = 2;
} else {
  migrateSqliteToPostgres({ source, databaseUrl, replace, verifyOnly })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error("SQLite to PostgreSQL migration failed", error);
      process.exitCode = 1;
    });
}
