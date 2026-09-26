import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
import { audit, getConn, nowIso } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { createCredential } from "../runtime/credentials.js";
import { setConnectorConfig, type ConnectorConfig } from "../runtime/store.js";

export const connectorImportRouter = new Hono();

const CONNECTOR_ID = /^[a-z][a-z0-9_-]{2,63}$/;
const MAX_SERVERS = 50;
const MAX_URL_LENGTH = 2048;
const MAX_HEADERS = 32;
const MAX_JSON_BYTES = 200_000;
const CREDENTIAL_REFERENCE = /^cred_[A-Za-z0-9_-]{8,160}$/;
const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const RESERVED_HEADERS = new Set([
  "content-length", "host", "connection", "transfer-encoding", "upgrade", "keep-alive", "proxy-connection",
]);
const IMPORT_PURPOSE = "待补充业务用途";

type ImportTransport = "streamable-http" | "sse";

type ParsedServer = {
  id: string;
  label: string;
  url: string;
  transport: ImportTransport;
  headers: Record<string, string>;
  conflicts: string[];
  valid: boolean;
  reason?: string;
};

function slugify(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) return "";
  const prefixed = /^[a-z]/.test(slug) ? slug : `mcp-${slug}`;
  return prefixed.slice(0, 63);
}

function parseTransport(value: unknown): ImportTransport | undefined {
  if (value === undefined || value === null || value === "") return "streamable-http";
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "sse") return "sse";
  if (normalized === "http" || normalized === "streamable-http" || normalized === "streamablehttp") return "streamable-http";
  return undefined;
}

function parseServer(name: string, value: unknown, taken: Set<string>): ParsedServer {
  const label = name.trim();
  const base: ParsedServer = { id: "", label, url: "", transport: "streamable-http", headers: {}, conflicts: [], valid: false };
  if (!label || label.length > 120) {
    return { ...base, reason: "服务器名称必须为 1–120 个字符" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...base, reason: "服务器配置必须是对象" };
  }
  const entry = value as Record<string, unknown>;
  if (entry.command !== undefined || entry.args !== undefined) {
    return { ...base, reason: "仅支持远程 MCP（HTTP / SSE）；stdio（command/args）不受支持" };
  }
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!url || url.length > MAX_URL_LENGTH) {
    return { ...base, reason: "缺少有效的 url" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ...base, reason: "url 必须是合法的 http/https 地址" };
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password
    || parsed.search || parsed.hash || url.includes("?") || url.includes("#")) {
    return { ...base, reason: "url 必须是 http/https，且不含凭据、查询串或锚点" };
  }
  const transport = parseTransport(entry.type);
  if (!transport) {
    return { ...base, reason: "type 只支持 http / streamable-http / sse" };
  }
  const headers: Record<string, string> = {};
  if (entry.headers !== undefined) {
    if (!entry.headers || typeof entry.headers !== "object" || Array.isArray(entry.headers)) {
      return { ...base, reason: "headers 必须是对象" };
    }
    const entries = Object.entries(entry.headers as Record<string, unknown>);
    if (entries.length > MAX_HEADERS) return { ...base, reason: `headers 不能超过 ${MAX_HEADERS} 项` };
    for (const [header, raw] of entries) {
      if (!HTTP_HEADER_NAME.test(header) || RESERVED_HEADERS.has(header.toLowerCase())) {
        return { ...base, reason: `请求头名称无效：${header}` };
      }
      if (typeof raw !== "string" || !raw.trim() || raw.length > 4096 || /[\x00-\x1f\x7f]/.test(raw)) {
        return { ...base, reason: `请求头 ${header} 的值必须是 1–4096 字符的字符串` };
      }
      headers[header] = raw.trim();
    }
  }
  const id = slugify(label);
  const conflicts: string[] = [];
  if (!CONNECTOR_ID.test(id)) {
    return { ...base, reason: "无法从名称生成合法短名；请改用小写字母、数字、- 或 _" };
  }
  if (taken.has(id)) conflicts.push("同一次导入中出现重复短名");
  if (getConn().prepare("SELECT 1 FROM connectors WHERE id=?").get(id)) conflicts.push("连接器短名已被占用");
  return { ...base, id, url, transport, headers, conflicts, valid: conflicts.length === 0 };
}

function parseServers(root: unknown): ParsedServer[] {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new HttpFail(400, { code: "connector_import_invalid_json" });
  }
  const servers = (root as Record<string, unknown>).mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new HttpFail(400, { code: "connector_import_mcp_servers_required" });
  }
  const entries = Object.entries(servers as Record<string, unknown>);
  if (!entries.length) throw new HttpFail(400, { code: "connector_import_empty" });
  if (entries.length > MAX_SERVERS) throw new HttpFail(400, { code: "connector_import_too_many_servers" });
  const taken = new Set<string>();
  const parsed: ParsedServer[] = [];
  for (const [name, value] of entries) {
    const server = parseServer(name, value, taken);
    if (server.id) taken.add(server.id);
    parsed.push(server);
  }
  return parsed;
}

function preview(server: ParsedServer) {
  const values = Object.values(server.headers);
  return {
    id: server.id,
    label: server.label,
    url: server.url,
    transport: server.transport,
    header_count: values.length,
    secret_count: values.filter((value) => !CREDENTIAL_REFERENCE.test(value)).length,
    conflicts: server.conflicts,
    valid: server.valid,
    ...(server.reason ? { reason: server.reason } : {}),
  };
}

connectorImportRouter.post("/admin/connectors/import-mcp", async (c) => {
  const admin = requireAdmin();
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpFail(400, { code: "connector_import_invalid_request" });
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "json" && key !== "dry_run")) {
    throw new HttpFail(400, { code: "connector_import_invalid_request" });
  }
  const text = typeof input.json === "string" ? input.json : "";
  if (!text.trim() || Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
    throw new HttpFail(400, { code: "connector_import_json_required" });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new HttpFail(400, { code: "connector_import_invalid_json" });
  }
  const servers = parseServers(parsedJson);

  if (input.dry_run === true) {
    const valid = servers.filter((server) => server.valid);
    return c.json({
      dry_run: true,
      servers: servers.map(preview),
      valid_count: valid.length,
      invalid_count: servers.length - valid.length,
    });
  }

  const created: Array<{ id: string; label: string }> = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const server of servers) {
    if (!server.valid) {
      skipped.push({ name: server.label, reason: server.reason || server.conflicts[0] || "不可导入" });
      continue;
    }
    const now = nowIso();
    try {
      getConn().prepare(
        "INSERT INTO connectors(id,label,purpose,enabled,status,credential_ref,updated_at) VALUES (?,?,?,0,'pending_verification',NULL,?)",
      ).run(server.id, server.label, IMPORT_PURPOSE, now);
    } catch {
      skipped.push({ name: server.label, reason: "连接器短名已被占用" });
      continue;
    }
    try {
      const refs: Record<string, string> = {};
      for (const [header, value] of Object.entries(server.headers)) {
        if (CREDENTIAL_REFERENCE.test(value)) {
          refs[header] = value;
          continue;
        }
        const credential = createCredential({
          type: "organization_secret",
          label: `${server.label} · ${header}`,
          purpose: "由 JSON 导入写入",
          secret: value,
        }, admin.id);
        refs[header] = credential.id;
      }
      const config: ConnectorConfig = { protocol: "mcp", transport: server.transport, url: server.url, timeout_ms: 30_000 };
      if (Object.keys(refs).length) {
        config.headers_secret_refs = refs;
        config.allow_unauthenticated = false;
      } else {
        // No header values were provided. The preview states this explicitly before confirm.
        config.allow_unauthenticated = true;
      }
      setConnectorConfig(server.id, config, 0);
      created.push({ id: server.id, label: server.label });
    } catch {
      // Never leave a half-imported connector behind.
      getConn().prepare("DELETE FROM connectors WHERE id=?").run(server.id);
      skipped.push({ name: server.label, reason: "配置未通过校验" });
    }
  }
  audit(admin.id, "admin.connector.import_mcp", {
    connector_ids: created.map((row) => row.id),
    skipped: skipped.length,
  });
  return c.json({ dry_run: false, created, skipped });
});
