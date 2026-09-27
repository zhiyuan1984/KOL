import { api } from "../../api";
import {
  type RuntimeConnectorConfig,
  type RuntimeConnectorTransport,
  type RuntimeProtocol,
} from "../../runtimeConnectorUi";
import { isConnectorIdValid, slugFromLabel } from "./entity";

export type HeaderRow = { name: string; value: string };

/** Error code carried by the API error payload. The API answers `{ detail: { code } }`. */
export function errorCodeOf(cause: unknown): string {
  const payload = (cause as { payload?: unknown } | null)?.payload;
  const queue: unknown[] = [payload, (payload as { detail?: unknown } | null)?.detail];
  while (queue.length) {
    const candidate = queue.shift();
    if (typeof candidate === "string") {
      try {
        queue.push(JSON.parse(candidate));
      } catch {
        // A plain message, not an error code carrier.
      }
      continue;
    }
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as { code?: unknown; error_code?: unknown };
    if (typeof record.code === "string" && record.code) return record.code;
    if (typeof record.error_code === "string" && record.error_code) return record.error_code;
  }
  return "";
}

/**
 * Current config version of a connector; a connector without saved config is
 * version 0. Re-saving reads this back instead of assuming a fresh record, so a
 * second save never fails with a stale `expected_version`.
 */
export async function readConnectorConfigVersion(connectorId: string): Promise<number> {
  try {
    const result = await api.runtimeConnectorConfig(connectorId);
    return Number(result.version) || 0;
  } catch (cause) {
    if ((cause as { status?: number } | null)?.status === 404) return 0;
    throw cause;
  }
}

/** Secret rows become vault credentials; the saved config keeps references only. */
export async function resolveHeaderRefs(rows: HeaderRow[], label: string): Promise<Record<string, string>> {
  const refs: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (!name || !value) continue;
    if (value.startsWith("cred_")) {
      refs[name] = value;
      continue;
    }
    const created = await api.createRuntimeCredential({
      type: "organization_secret",
      label: `${label} · ${name}`,
      purpose: "由连接器配置表单写入",
      secret: value,
    });
    refs[name] = created.id;
  }
  return refs;
}

export type ConnectorConfigForm = {
  id: string;
  label: string;
  protocol: RuntimeProtocol;
  transport?: RuntimeConnectorTransport;
  url?: string;
  /** Endpoint supplied by a server-side environment variable instead of a literal URL. */
  urlEnv?: string;
  noAuth: boolean;
  timeoutMs?: number;
  /** Plaintext values are vaulted first; `cred_…` values are already references. */
  headerRows: HeaderRow[];
  envRefs?: Record<string, string>;
  bearerRef?: string;
  bearerEnv?: string;
  httpTools?: RuntimeConnectorConfig["http_tools"];
  iconFile?: File | null;
};

/**
 * Single write path for "create + save config" and "save from the config card".
 * `currentVersion` must be the version read back from the server — saving with a
 * guessed version is what made the second save fail silently.
 * Returns the new config version; the icon upload stays best-effort.
 */
export async function saveConnectorConfigForm(input: ConnectorConfigForm, currentVersion: number): Promise<number> {
  const refs = await resolveHeaderRefs(input.headerRows, input.label);
  const config: RuntimeConnectorConfig & { expected_version: number } = {
    protocol: input.protocol,
    allow_unauthenticated: input.noAuth,
    timeout_ms: input.timeoutMs ?? 30_000,
    expected_version: currentVersion,
  };
  if (input.protocol === "mcp") config.transport = input.transport ?? "streamable-http";
  else config.http_tools = input.httpTools ?? [];
  if (input.url) config.url = input.url;
  if (input.urlEnv) config.url_env = input.urlEnv;
  if (Object.keys(refs).length) config.headers_secret_refs = refs;
  if (input.envRefs && Object.keys(input.envRefs).length) config.headers_env = input.envRefs;
  if (input.bearerRef) config.bearer_secret_ref = input.bearerRef;
  if (input.bearerEnv) config.bearer_env = input.bearerEnv;
  const saved = await api.saveRuntimeConnectorConfig(input.id, config);
  if (input.iconFile) {
    try {
      await api.uploadConnectorIcon(input.id, input.iconFile);
    } catch {
      // The connector itself is saved; icon upload can be retried from the detail page.
    }
  }
  return Number(saved.version) || 0;
}

/** Register the connector record only;接入配置 is written by `saveConnectorConfigForm`. */
export async function createConnectorRecord(
  label: string,
  purpose: string,
  options: { prefix?: string; protocol?: RuntimeProtocol } = {},
): Promise<string> {
  const base = autoConnectorId(label, options.prefix);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // A taken short name is not worth asking the user about; pick another one.
    const candidate = attempt === 0 ? base : `${base.slice(0, 53)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await api.adminSave("/api/admin/connectors", {
        id: candidate,
        label,
        purpose,
        ...(options.protocol ? { protocol: options.protocol } : {}),
      }, "POST");
      return candidate;
    } catch (cause) {
      if (errorCodeOf(cause) !== "managed_connector_already_exists") throw cause;
    }
  }
  throw new Error("无法为该名称生成未被占用的短名；请改用更具体的名称后重试。");
}

/** Short name derived from the connector name; the form no longer asks for it. */
export function autoConnectorId(label: string, prefix = "mcp"): string {
  const slug = slugFromLabel(label);
  if (isConnectorIdValid(slug)) return slug;
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 63);
}
