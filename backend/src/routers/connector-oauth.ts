import { createHash } from "node:crypto";
import { Hono } from "hono";
import { auth, type AuthResult } from "@modelcontextprotocol/sdk/client/auth.js";
import { authDisabled, scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { postgresQuery, postgresTransaction } from "../postgres/pool.js";
import { createCredential, replaceUserCredentialSecret, resolveSecretReference, writeCredentialAudit } from "../runtime/credentials.js";
import { assertResolvedConnectorEndpointSafe, assertSafeConnectorEndpoint, fetchWithConnectorEgressPolicy } from "../runtime/http.js";
import { createOAuthProvider, newOAuthState, parseOAuthState } from "../mcp/oauth-client.js";
import { getConnectorConfig } from "../runtime/store.js";
import type { Row } from "../types.js";

export const connectorOAuthRouter = new Hono();
const MAX_PENDING_MS = 10 * 60 * 1000;

function currentUser() {
  if (authDisabled()) throw new HttpFail(403, { code: "runtime_oauth_requires_login" });
  const user = scopedUser();
  if (!user?.active) throw new HttpFail(401, { code: "runtime_identity_unavailable" });
  return user;
}
function appOrigin(): string {
  const raw = process.env.APP_ORIGIN || process.env.CORS_ORIGIN;
  if (!raw) throw new HttpFail(503, { code: "runtime_oauth_app_origin_unavailable" });
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpFail(503, { code: "runtime_oauth_app_origin_invalid" }); }
  if (!/^https?:$/.test(url.protocol) || (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new HttpFail(503, { code: "runtime_oauth_app_origin_invalid" });
  }
  return url.origin;
}
async function oauthConfig(connectorId: string) {
  const result = await getConnectorConfig(connectorId);
  const config = result?.config;
  if (!config || config.protocol === "http" || config.oauth_enabled !== true || !config.url) {
    throw new HttpFail(409, { code: "runtime_oauth_not_enabled" });
  }
  const endpoint = assertSafeConnectorEndpoint(config.url);
  await assertResolvedConnectorEndpointSafe(endpoint);
  return { config, endpoint };
}
function callbackRedirect(result: "connected" | "failed"): string {
  const target = new URL("/settings?tab=mcp", appOrigin());
  target.searchParams.set("oauth", result);
  return target.toString();
}
async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = new URL(input instanceof Request ? input.url : String(input));
  assertSafeConnectorEndpoint(target.toString());
  await assertResolvedConnectorEndpointSafe(target);
  return fetchWithConnectorEgressPolicy(input, { ...init, redirect: "error" });
}

connectorOAuthRouter.get("/admin/runtime/connectors/:connectorId/oauth/status", async (c) => {
  const user = currentUser();
  const connectorId = c.req.param("connectorId");
  const row = (await postgresQuery<Row>(
    "SELECT 1 FROM runtime_connector_oauth_accounts WHERE connector_id=$1 AND user_id=$2",
    [connectorId, user.id],
  ))[0];
  return c.json({ connector_id: connectorId, authorized: Boolean(row) });
});

connectorOAuthRouter.get("/admin/runtime/connectors/oauth-available", async () => {
  const user = currentUser();
  const rows = await postgresQuery<Row>("SELECT id,label FROM connectors ORDER BY label,id");
  const available: Array<{ id: string; label: string; authorized: boolean }> = [];
  for (const row of rows) {
    const id = String(row.id);
    const saved = await getConnectorConfig(id);
    if (saved?.config.oauth_enabled !== true) continue;
    const account = (await postgresQuery<Row>(
      "SELECT 1 FROM runtime_connector_oauth_accounts WHERE connector_id=$1 AND user_id=$2",
      [id, user.id],
    ))[0];
    available.push({ id, label: String(row.label || id), authorized: Boolean(account) });
  }
  return Response.json(available);
});

connectorOAuthRouter.post("/admin/runtime/connectors/:connectorId/oauth/start", async (c) => {
  const user = currentUser();
  const connectorId = c.req.param("connectorId");
  const { endpoint } = await oauthConfig(connectorId);
  const redirectUrl = appOrigin() + "/api/admin/runtime/connectors/" + encodeURIComponent(connectorId) + "/oauth/callback";
  const oauthState = newOAuthState(redirectUrl);
  const credential = await createCredential({
    type: "user_account", owner_user_id: user.id, label: "MCP OAuth · " + connectorId,
    purpose: "用户个人远程 MCP OAuth 授权", secret: JSON.stringify(oauthState),
  }, user.id);
  const provider = createOAuthProvider(oauthState, async (next) => {
    await replaceUserCredentialSecret(credential.id, user.id, JSON.stringify(next));
  });
  try {
    const outcome: AuthResult = await auth(provider, { serverUrl: endpoint, fetchFn: safeFetch });
    if (outcome !== "REDIRECT" || !oauthState.authorizationUrl) {
      throw new HttpFail(409, { code: "runtime_oauth_authorization_not_started" });
    }
    const stateHash = createHash("sha256").update(oauthState.state).digest("hex");
    await postgresTransaction(async (client) => {
      await client.query("DELETE FROM runtime_credentials WHERE id IN (SELECT credential_id FROM runtime_connector_oauth_pending WHERE expires_at < now())");
      await client.query("DELETE FROM runtime_connector_oauth_pending WHERE expires_at < now()");
      await client.query(
        "INSERT INTO runtime_connector_oauth_pending(state_hash,connector_id,user_id,credential_id,expires_at) VALUES($1,$2,$3,$4,$5)",
        [stateHash, connectorId, user.id, credential.id, new Date(Date.now() + MAX_PENDING_MS).toISOString()],
      );
    });
    await writeCredentialAudit(user.id, "runtime.connector.oauth_started", { connector_id: connectorId, credential_id: credential.id });
    return c.json({ authorization_url: oauthState.authorizationUrl, expires_in_seconds: MAX_PENDING_MS / 1000 });
  } catch (error) {
    await postgresQuery("DELETE FROM runtime_credentials WHERE id=$1", [credential.id]).catch(() => undefined);
    if (error instanceof HttpFail) throw error;
    throw new HttpFail(502, { code: "runtime_oauth_discovery_failed" });
  }
});

connectorOAuthRouter.get("/admin/runtime/connectors/:connectorId/oauth/callback", async (c) => {
  const user = currentUser();
  const connectorId = c.req.param("connectorId");
  const stateValue = c.req.query("state") || "";
  const code = c.req.query("code") || "";
  if (!stateValue || !code || stateValue.length > 512 || code.length > 4096) return c.redirect(callbackRedirect("failed"), 303);
  const stateHash = createHash("sha256").update(stateValue).digest("hex");
  const pending = await postgresTransaction(async (client) => {
    const result = await client.query<Row>(
      "SELECT connector_id,user_id,credential_id FROM runtime_connector_oauth_pending WHERE state_hash=$1 AND expires_at > now() FOR UPDATE",
      [stateHash],
    );
    const candidate = result.rows[0];
    if (!candidate || String(candidate.connector_id) !== connectorId || String(candidate.user_id) !== user.id) return undefined;
    await client.query("DELETE FROM runtime_connector_oauth_pending WHERE state_hash=$1", [stateHash]);
    return candidate;
  });
  if (!pending || String(pending.connector_id) !== connectorId || String(pending.user_id) !== user.id) {
    return c.redirect(callbackRedirect("failed"), 303);
  }
  const credentialId = String(pending.credential_id);
  try {
    const { endpoint } = await oauthConfig(connectorId);
    const stored = parseOAuthState(await resolveSecretReference(credentialId, user.id));
    if (stored.state !== stateValue) throw new HttpFail(409, { code: "runtime_oauth_state_mismatch" });
    const provider = createOAuthProvider(stored, async (next) => {
      await replaceUserCredentialSecret(credentialId, user.id, JSON.stringify(next));
    });
    const outcome = await auth(provider, { serverUrl: endpoint, authorizationCode: code, fetchFn: safeFetch });
    if (outcome !== "AUTHORIZED" || !stored.tokens?.access_token) throw new HttpFail(502, { code: "runtime_oauth_token_exchange_failed" });
    delete stored.authorizationUrl;
    delete stored.codeVerifier;
    await replaceUserCredentialSecret(credentialId, user.id, JSON.stringify(stored));
    const prior = (await postgresQuery<Row>(
      "SELECT credential_id FROM runtime_connector_oauth_accounts WHERE connector_id=$1 AND user_id=$2",
      [connectorId, user.id],
    ))[0];
    await postgresTransaction(async (client) => {
      await client.query(
        "INSERT INTO runtime_connector_oauth_accounts(connector_id,user_id,credential_id) VALUES($1,$2,$3) " +
        "ON CONFLICT(connector_id,user_id) DO UPDATE SET credential_id=EXCLUDED.credential_id,updated_at=now()",
        [connectorId, user.id, credentialId],
      );
      await client.query("DELETE FROM runtime_connector_oauth_pending WHERE state_hash=$1", [stateHash]);
    });
    if (prior && String(prior.credential_id) !== credentialId) {
      await postgresQuery("DELETE FROM runtime_credentials WHERE id=$1", [String(prior.credential_id)]);
    }
    await writeCredentialAudit(user.id, "runtime.connector.oauth_connected", { connector_id: connectorId, credential_id: credentialId });
    return c.redirect(callbackRedirect("connected"), 303);
  } catch {
    return c.redirect(callbackRedirect("failed"), 303);
  }
});
