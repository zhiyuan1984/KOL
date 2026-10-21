import { postgresQuery } from "../postgres/pool.js";
import { createOAuthProvider, parseOAuthState } from "../mcp/oauth-client.js";
import { replaceUserCredentialSecret, resolveSecretReference } from "./credentials.js";
import type { Row } from "../types.js";

export async function userOAuthProvider(connectorId: string, userId: string) {
  const row = (await postgresQuery<Row>(
    "SELECT credential_id FROM runtime_connector_oauth_accounts WHERE connector_id=$1 AND user_id=$2",
    [connectorId, userId],
  ))[0];
  if (!row) return undefined;
  const credentialId = String(row.credential_id);
  const state = parseOAuthState(await resolveSecretReference(credentialId, userId));
  return { credentialId, provider: createOAuthProvider(state, async (next) => {
    await replaceUserCredentialSecret(credentialId, userId, JSON.stringify(next));
  }) };
}
