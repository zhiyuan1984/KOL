/** PostgreSQL-only, read-only mailbox/vault verification; no authority or clone writes. */
import { getConn } from "../src/db.js";
import { closePostgresPool } from "../src/postgres/pool.js";
import { mapUser, withScopedUser } from "../src/auth.js";
import { canUseAgent } from "../src/runtime/organization-tree.js";
import { callStarryKolTool } from "../src/starrykol/service.js";
import { runtimeErrorCode } from "../src/runtime/execution.js";
import type { Json, Row } from "../src/types.js";
const userId = process.argv.find(arg => arg.startsWith("--user="))?.slice(7);
if (!userId) throw new Error("--user is required");
let phase = "native_authority_read";
try {
  const user = (await getConn().query<Row>("SELECT * FROM users WHERE id=$1 AND active=1", [userId])).rows[0];
  if (!user || !await canUseAgent(userId, "agent:kol")) throw new Error("active authorized Agent account required");
  const bindings = (await getConn().query<Row>("SELECT mailbox_email,bearer_token,status FROM user_starry_bindings WHERE user_id=$1", [userId])).rows;
  const configs = (await getConn().query<Row>("SELECT config_json FROM runtime_connector_config WHERE connector_id=$1", ["starrykol"])).rows;
  const config = JSON.parse(String(configs[0]?.config_json || "{}")) as Json;
  const references = [...Object.values((config.headers_secret_refs || {}) as Json), config.bearer_secret_ref, config.credential_account_id,
    ...bindings.map(row => row.bearer_token)].filter(value => typeof value === "string" && value !== "");
  if (references.some(value => !/^cred_[A-Za-z0-9_-]{8,160}$/.test(String(value)))) throw new Error("credential reference migration is incomplete");
  const ids = [...new Set(references.map(String))];
  const credentials = ids.length ? (await getConn().query<Row>("SELECT id FROM runtime_credentials WHERE id=ANY($1::text[])", [ids])).rows : [];
  if (credentials.length !== ids.length) throw new Error("credential reference target is missing");
  let queryRows: number | undefined;
  if (process.argv.includes("--query")) {
    phase = "authorized_business_query";
    const result = await withScopedUser(await mapUser(user), async () => (await callStarryKolTool("listAllKolProfiles", {})));
    const data = (result.data || result) as Json;
    if (!Array.isArray(data.list)) throw new Error("invalid query result");
    queryRows = data.list.length;
  }
  console.log(JSON.stringify({ phase, database: "postgresql", source_store_unchanged: true,
    credential_references_verified: true, binding_count: bindings.length, credential_count: credentials.length,
    ...(queryRows === undefined ? {} : { query_rows: queryRows }) }));
} catch (error) {
  console.error(JSON.stringify({ phase, code: runtimeErrorCode(error) })); process.exitCode = 1;
} finally { await closePostgresPool(); }
