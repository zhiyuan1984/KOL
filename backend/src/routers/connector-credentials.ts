import { Hono } from "hono";
import { authDisabled, requireAdmin } from "../auth.js";
import { audit, getConn, nowIso } from "../db.js";
import { HttpFail } from "../host/errors.js";
import {
  bindStarryOrganizationKey,
  createCredential,
  deleteCredential,
  getCredentialMetadata,
  listCredentialMetadata,
  updateCredentialMetadata,
} from "../runtime/credentials.js";
import { inspectConnectorTools, runtimeErrorCode } from "../runtime/execution.js";
import { recordToolInventory } from "../runtime/organization.js";

/**
 * Credential governance endpoints. The parent application owns mounting this
 * router under `/api`; all secrets remain write-only and never enter audit data.
 */
export const connectorCredentialsRouter = new Hono();

function credentialAdmin() {
  // AUTH_MODE=disabled is a controlled isolated-test fixture only. Never make
  // vault writes anonymously available in a non-test process.
  if (authDisabled() && process.env.NODE_ENV !== "test") {
    throw new HttpFail(403, "runtime credential administration requires enabled authentication outside tests");
  }
  return requireAdmin();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function bodyObject(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpFail(400, "request body must be JSON");
  }
  if (!isPlainObject(body)) throw new HttpFail(400, "request body must be an object");
  return body;
}

function onlyFields(body: Record<string, unknown>, fields: readonly string[]): void {
  const allowed = new Set(fields);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new HttpFail(400, "unsupported request field");
}

function expectedVersion(body: Record<string, unknown>): number {
  if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version) || body.expected_version < 0) {
    throw new HttpFail(400, "expected_version must be a non-negative integer");
  }
  return body.expected_version;
}

connectorCredentialsRouter.get("/admin/runtime/credentials", () => {
  credentialAdmin();
  return Response.json(listCredentialMetadata());
});

connectorCredentialsRouter.post("/admin/runtime/credentials", async (c) => {
  const admin = credentialAdmin();
  const body = await bodyObject(c);
  onlyFields(body, ["id", "type", "owner_user_id", "label", "purpose", "status", "secret"]);
  const created = createCredential({
    id: body.id, type: body.type, owner_user_id: body.owner_user_id, label: body.label,
    purpose: body.purpose, status: body.status, secret: body.secret,
  }, admin.id);
  // Never add `secret`, ciphertext, nonce, tag, or any recoverable credential
  // material to audit records.
  audit(admin.id, "runtime.credential.created", {
    credential_id: created.id,
    type: created.type,
    owner_user_id: created.owner_user_id,
    status: created.status,
    version: created.version,
  });
  return c.json(created, 201);
});

/** Product-specific onboarding: a single one-time Starry key field, then a safe list-tools test. */
connectorCredentialsRouter.post("/admin/runtime/connectors/starrykol/onboard", async (c) => {
  const admin = credentialAdmin();
  const body = await bodyObject(c);
  onlyFields(body, ["url", "timeout_ms", "expected_version", "secret"]);
  const bound = bindStarryOrganizationKey({
    connector_id: "starrykol",
    url: body.url,
    timeout_ms: body.timeout_ms,
    expected_version: body.expected_version,
    secret: body.secret,
  }, admin.id);
  const checkedAt = nowIso();
  try {
    const tools = await inspectConnectorTools(
      { agentId: "governance", skillId: "", userId: admin.id, runId: "starry-onboarding" },
      "starrykol",
    );
    recordToolInventory("starrykol", tools);
    getConn().prepare("UPDATE connectors SET enabled=0,status='verified',last_verified_at=?,last_error=NULL,updated_at=? WHERE id='starrykol'")
      .run(checkedAt, checkedAt);
    audit(admin.id, "runtime.starry.onboarded", {
      connector_id: "starrykol", config_version: bound.version, credential_id: bound.credential.id, tool_count: tools.length,
    });
    return c.json({
      config: { url: bound.config.url || "", timeout_ms: bound.config.timeout_ms || 30_000, version: bound.version },
      credential_saved: true,
      checked_at: checkedAt,
      tools,
    }, 201);
  } catch (error) {
    const code = runtimeErrorCode(error);
    getConn().prepare("UPDATE connectors SET enabled=0,status='verification_failed',last_verified_at=?,last_error=?,updated_at=? WHERE id='starrykol'")
      .run(checkedAt, code, checkedAt);
    audit(admin.id, "runtime.starry.onboarding_failed", { connector_id: "starrykol", config_version: bound.version, code });
    throw new HttpFail(502, { code, config_saved: true });
  }
});

connectorCredentialsRouter.put("/admin/runtime/credentials/:id", async (c) => {
  const admin = credentialAdmin();
  const body = await bodyObject(c);
  // PUT is metadata-only: rotation/write of new secret material must be an
  // explicit future API and must not accidentally turn into a read/write DTO.
  onlyFields(body, ["label", "purpose", "status", "expected_version"]);
  const updated = updateCredentialMetadata(c.req.param("id"), {
    label: body.label,
    purpose: body.purpose,
    status: body.status,
    expected_version: expectedVersion(body),
  });
  audit(admin.id, "runtime.credential.metadata_updated", {
    credential_id: updated.id,
    type: updated.type,
    owner_user_id: updated.owner_user_id,
    status: updated.status,
    version: updated.version,
  });
  return c.json(updated);
});

connectorCredentialsRouter.delete("/admin/runtime/credentials/:id", async (c) => {
  const admin = credentialAdmin();
  const body = await bodyObject(c);
  onlyFields(body, ["expected_version"]);
  const prior = getCredentialMetadata(c.req.param("id"));
  deleteCredential(c.req.param("id"), expectedVersion(body));
  audit(admin.id, "runtime.credential.deleted", {
    credential_id: prior.id,
    type: prior.type,
    owner_user_id: prior.owner_user_id,
    version: prior.version,
  });
  return c.json({ ok: true });
});
