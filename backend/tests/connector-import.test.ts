import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { connectorImportRouter } from "../src/routers/connector-import.js";

let tmp = "";
let app: Hono;

const CRED_REF = "cred_importreference01";
const BUILTINS = ["claw", "starrykol"];

function testApp(): Hono {
  const a = new Hono();
  a.onError((e, c) => e instanceof HttpFail
    ? c.json({ detail: e.detail }, e.status as 400 | 401 | 403 | 404 | 409 | 413 | 503)
    : c.json({ detail: "unexpected" }, 500));
  a.route("/api", connectorImportRouter);
  return a;
}

async function post(body: unknown) {
  const res = await app.request("/api/admin/connectors/import-mcp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function count(sql: string, ...params: unknown[]): number {
  return Number((getConn().prepare(`SELECT COUNT(*) AS n ${sql}`).get(...params) as { n: number }).n);
}

/** Imported records only; the platform seeds two built-in connectors on open. */
function importedIds(): string[] {
  return (getConn().prepare("SELECT id FROM connectors WHERE id NOT IN (?,?) ORDER BY id").all(...BUILTINS) as Array<{ id: string }>)
    .map((row) => row.id);
}

const SAMPLE = {
  mcpServers: {
    "Alpha Server": { url: "https://mcp.alpha.example/mcp", headers: { "X-API-Key": "alpha-secret-value" } },
    "Beta SSE": { type: "sse", url: "https://mcp.beta.example/sse" },
    "Gamma Ref": { url: "https://mcp.gamma.example/mcp", headers: { "X-API-Key": CRED_REF } },
    "Stdio Server": { command: "npx", args: ["-y", "some-server"] },
    "Broken Url": { url: "not-a-url" },
  },
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-connector-import-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "test.db"),
    LINGONG_DATA: tmp,
    AUTH_MODE: "disabled",
    NODE_ENV: "test",
    RUNTIME_CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  resetConn();
  app = testApp();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV", "RUNTIME_CREDENTIAL_MASTER_KEY"]) {
    delete process.env[key];
  }
});

describe("connector JSON import", () => {
  it("previews mcpServers without writing connectors or credentials", async () => {
    const { status, body } = await post({ json: JSON.stringify(SAMPLE), dry_run: true });
    expect(status).toBe(200);
    expect(body.dry_run).toBe(true);
    expect(body.valid_count).toBe(3);
    expect(body.invalid_count).toBe(2);
    const servers = body.servers as Array<Record<string, unknown>>;
    const alpha = servers.find((server) => server.label === "Alpha Server");
    expect(alpha).toMatchObject({ id: "alpha-server", transport: "streamable-http", header_count: 1, secret_count: 1, valid: true });
    const beta = servers.find((server) => server.label === "Beta SSE");
    expect(beta).toMatchObject({ transport: "sse", valid: true });
    const stdio = servers.find((server) => server.label === "Stdio Server");
    expect(stdio?.valid).toBe(false);
    expect(String(stdio?.reason)).toContain("stdio");
    const broken = servers.find((server) => server.label === "Broken Url");
    expect(broken?.valid).toBe(false);
    expect(importedIds()).toEqual([]);
    // Dry run writes nothing — the lazily created credential table must not exist yet.
    expect(count("FROM sqlite_master WHERE type='table' AND name='runtime_credentials'")).toBe(0);
  });

  it("imports on confirm: pending verification, transports, vaulted secrets and references", async () => {
    const { status, body } = await post({ json: JSON.stringify(SAMPLE) });
    expect(status).toBe(200);
    expect(body.dry_run).toBe(false);
    expect((body.created as unknown[]).length).toBe(3);
    expect((body.skipped as unknown[]).length).toBe(2);

    const rows = getConn().prepare("SELECT id,enabled,status FROM connectors WHERE id NOT IN (?,?) ORDER BY id")
      .all(...BUILTINS) as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.id)).toEqual(["alpha-server", "beta-sse", "gamma-ref"]);
    expect(rows.every((row) => Number(row.enabled) === 0 && String(row.status) === "pending_verification")).toBe(true);

    const alphaConfig = JSON.parse(String((getConn().prepare("SELECT config_json FROM runtime_connector_config WHERE connector_id='alpha-server'").get() as { config_json: string }).config_json));
    expect(alphaConfig.transport).toBe("streamable-http");
    expect(alphaConfig.allow_unauthenticated).toBe(false);
    const alphaRef = alphaConfig.headers_secret_refs["X-API-Key"] as string;
    expect(alphaRef).toMatch(/^cred_/);
    expect(alphaRef).not.toBe("alpha-secret-value");

    const betaConfig = JSON.parse(String((getConn().prepare("SELECT config_json FROM runtime_connector_config WHERE connector_id='beta-sse'").get() as { config_json: string }).config_json));
    expect(betaConfig.transport).toBe("sse");
    expect(betaConfig.allow_unauthenticated).toBe(true);
    expect(betaConfig.headers_secret_refs).toBeUndefined();

    const gammaConfig = JSON.parse(String((getConn().prepare("SELECT config_json FROM runtime_connector_config WHERE connector_id='gamma-ref'").get() as { config_json: string }).config_json));
    expect(gammaConfig.headers_secret_refs["X-API-Key"]).toBe(CRED_REF);

    expect(count("FROM runtime_credentials")).toBe(1);
    const credential = getConn().prepare("SELECT label,purpose FROM runtime_credentials").get() as Record<string, unknown>;
    expect(String(credential.label)).toBe("Alpha Server · X-API-Key");
    expect(String(credential.purpose)).toContain("JSON 导入");

    const event = getConn().prepare("SELECT actor,payload FROM audit_events WHERE event_type='admin.connector.import_mcp'").get() as Record<string, unknown> | undefined;
    expect(event).toBeTruthy();
    expect(String(event?.payload)).toContain("alpha-server");
  });

  it("reports id conflicts in preview and skips them on confirm", async () => {
    getConn().prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('alpha-server','Existing',0,'draft','now')").run();
    const payload = { mcpServers: { "Alpha Server": { url: "https://mcp.alpha.example/mcp", headers: { "X-API-Key": "v" } } } };
    const preview = await post({ json: JSON.stringify(payload), dry_run: true });
    const server = (preview.body.servers as Array<Record<string, unknown>>)[0];
    expect(server.valid).toBe(false);
    expect((server.conflicts as string[]).join()).toContain("已被占用");

    const confirm = await post({ json: JSON.stringify(payload) });
    expect((confirm.body.created as unknown[]).length).toBe(0);
    expect((confirm.body.skipped as Array<Record<string, unknown>>)[0]?.reason).toBeTruthy();
    expect(importedIds()).toEqual(["alpha-server"]);
    expect(String((getConn().prepare("SELECT label FROM connectors WHERE id='alpha-server'").get() as { label: string }).label)).toBe("Existing");
  });

  it("deduplicates duplicate ids within one import payload", async () => {
    const payload = {
      mcpServers: {
        "Alpha Server": { url: "https://a.example/mcp", headers: { "X-API-Key": "v" } },
        "alpha-server": { url: "https://b.example/mcp", headers: { "X-API-Key": "v" } },
      },
    };
    const { body } = await post({ json: JSON.stringify(payload), dry_run: true });
    expect(body.valid_count).toBe(1);
    expect(body.invalid_count).toBe(1);
  });

  it("rejects malformed requests with stable codes", async () => {
    const notObject = await post({ json: "[]" });
    expect(notObject.status).toBe(400);
    expect((notObject.body.detail as Record<string, unknown>).code).toBe("connector_import_invalid_json");
    const missingServers = await post({ json: "{}" });
    expect(missingServers.status).toBe(400);
    expect((missingServers.body.detail as Record<string, unknown>).code).toBe("connector_import_mcp_servers_required");
    const missingJson = await post({ dry_run: true });
    expect(missingJson.status).toBe(400);
    const badJson = await post({ json: "{oops" });
    expect(badJson.status).toBe(400);
    expect((badJson.body.detail as Record<string, unknown>).code).toBe("connector_import_invalid_json");
    const extraKey = await post({ json: "{}", extra: true });
    expect(extraKey.status).toBe(400);
  });

  it("never imports servers whose URL cannot satisfy the runtime contract", async () => {
    const payload = { mcpServers: { "Query Server": { url: "https://mcp.example/mcp?token=1" } } };
    const preview = await post({ json: JSON.stringify(payload), dry_run: true });
    expect(preview.body.valid_count).toBe(0);
    const confirm = await post({ json: JSON.stringify(payload) });
    expect((confirm.body.created as unknown[]).length).toBe(0);
    expect((confirm.body.skipped as unknown[]).length).toBe(1);
    expect(importedIds()).toEqual([]);
  });
});
