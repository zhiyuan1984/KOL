import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [operation, recordPath, rawOwner] = process.argv.slice(2);
if (!["create", "drop"].includes(operation) || !recordPath) throw new Error("e2e_database_operation_required");
const prefix = "lingong_t_server_e2e";
const quote = name => `"${name.replaceAll('"', '""')}"`;
const local = url => ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);

if (operation === "create") {
  const owner = Number(rawOwner);
  if (!Number.isSafeInteger(owner) || owner <= 0 || fs.existsSync(recordPath)) throw new Error("e2e_owner_record_must_be_new");
  // Never derive test authority from a production URL, including one supplied in
  // the caller environment. The dedicated checkout must declare its test DB.
  const source = {};
  process.loadEnvFile(path.join(root, ".env"));
  source.url = process.env.DATABASE_URL;
  const url = new URL(String(source.url || ""));
  if (!local(url) || !/^\/(?:lingong_e2e|lingong_t_[a-z0-9_]+)$/.test(url.pathname)) throw new Error("isolated_local_e2e_source_required");
  const database = `${prefix}_${owner}_${Date.now().toString(36)}`;
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quote(database)}`);
    url.pathname = `/${database}`;
    fs.writeFileSync(recordPath, JSON.stringify({ owner, prefix, database, url: url.toString(), admin: adminUrl.toString() }) + "\n", { flag: "wx", mode: 0o600 });
  } finally { await admin.end(); }
  console.log("Created isolated E2E database; connection details stored in private owner record");
} else {
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  if (record.owner !== Number(rawOwner) || record.prefix !== prefix || !new RegExp(`^${prefix}_${rawOwner}_[a-z0-9]+$`).test(record.database)) throw new Error("e2e_cleanup_owner_mismatch");
  const url = new URL(record.url); const adminUrl = new URL(record.admin);
  if (!local(url) || !local(adminUrl) || url.pathname !== `/${record.database}` || adminUrl.pathname !== "/postgres" || url.host !== adminUrl.host) throw new Error("e2e_cleanup_record_invalid");
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    // No FORCE, no terminate_backend, no retries hiding an active producer.
    await admin.query(`DROP DATABASE ${quote(record.database)}`);
    fs.unlinkSync(recordPath);
  } finally { await admin.end(); }
  console.log("Owned E2E database dropped normally");
}
