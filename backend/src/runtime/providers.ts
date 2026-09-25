import { getConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { registerRuntimeCredentialProvider } from "./execution.js";
import type { Row } from "../types.js";

// Composition root for protocol authentication adapters, never tool selection.
// A replacement/public connector using env references needs no adapter or Host edit.
registerRuntimeCredentialProvider("starry-user", ({ userId }) => {
  const row = getConn().prepare(
    `SELECT bearer_token,status FROM user_starry_bindings WHERE user_id=?
     ORDER BY is_default DESC,updated_at ASC,mailbox_email ASC LIMIT 1`,
  ).get(userId) as Row | undefined;
  const token = String(row?.bearer_token || "").trim().replace(/^Bearer\s+/i, "");
  if (!token || row?.status !== "connected") throw new HttpFail(403, { code: "runtime_personal_credential_unavailable" });
  return { Authorization: `Bearer ${token}` };
});
