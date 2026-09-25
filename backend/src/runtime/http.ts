import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import { HttpFail } from "../host/errors.js";
import type { Json } from "../types.js";
import type { ConnectorConfig, HttpTool } from "./store.js";

export type RuntimeHttpOptions = {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  fetch?: typeof fetch;
};

export type RuntimeHttpRemote = {
  listTools: () => Promise<Json[]>;
  callToolRaw: (name: string, args?: Json) => Promise<Json>;
  close: () => Promise<void>;
};

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

function fail(code: string, status = 502): never {
  throw new HttpFail(status, { code });
}

function safeTool(tool: HttpTool): Json {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Json };
}

function invalidHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (FORBIDDEN_HOSTS.has(value) || value.endsWith(".localhost") || value.endsWith(".local")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    const octets = value.split(".").map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  const compact = value.toLowerCase();
  return compact === "::1" || compact === "::" || compact.startsWith("fc") || compact.startsWith("fd")
    || compact.startsWith("fe80:") || compact.startsWith("::ffff:127.") || compact.startsWith("::ffff:10.")
    || compact.startsWith("::ffff:192.168.") || compact.startsWith("::ffff:169.254.");
}

/** Reject known local/metadata endpoints. Test fixtures may deliberately bind loopback. */
export function assertSafeConnectorEndpoint(value: string): URL {
  let endpoint: URL;
  try { endpoint = new URL(value); } catch { fail("runtime_endpoint_invalid", 409); }
  if (!/^https?:$/.test(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash) fail("runtime_endpoint_invalid", 409);
  if (process.env.NODE_ENV !== "test" && invalidHost(endpoint.hostname)) fail("runtime_endpoint_forbidden", 403);
  return endpoint;
}

export async function assertResolvedConnectorEndpointSafe(endpoint: URL): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if (invalidHost(endpoint.hostname)) fail("runtime_endpoint_forbidden", 403);
  // Bind the policy decision to a DNS result immediately before the request.
  // The HTTP stack still keeps redirects disabled and checks the target origin.
  let addresses: Array<{ address: string }>;
  try { addresses = await lookup(endpoint.hostname, { all: true, verbatim: true }); }
  catch { fail("runtime_endpoint_unresolvable", 502); }
  if (!addresses.length || addresses.some((entry) => invalidHost(entry.address))) fail("runtime_endpoint_forbidden", 403);
}

/**
 * Node's default fetch resolves DNS again after an application-level check,
 * which leaves a DNS-rebinding window. The dispatcher's lookup hook validates
 * the addresses used for the actual socket creation as well.
 */
const guardedDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
        if (!addresses.length || addresses.some((entry) => invalidHost(entry.address))) {
          callback(Object.assign(new Error("runtime_endpoint_forbidden"), { code: "runtime_endpoint_forbidden" }), "", 0);
          return;
        }
        const chosen = addresses.find((entry) => options.family === 0 || !options.family || (options.family === 4 ? entry.family === 4 : entry.family === 6));
        if (!chosen) { callback(Object.assign(new Error("runtime_endpoint_unresolvable"), { code: "runtime_endpoint_unresolvable" }), "", 0); return; }
        callback(null, chosen.address, chosen.family);
      }).catch(() => callback(Object.assign(new Error("runtime_endpoint_unresolvable"), { code: "runtime_endpoint_unresolvable" }), "", 0));
    },
  },
});

export function fetchWithConnectorEgressPolicy(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (process.env.NODE_ENV === "test") return fetch(input, init);
  // `dispatcher` is an Undici extension implemented by Node's fetch. Cast keeps
  // the browser-compatible DOM RequestInit type used elsewhere in the project.
  return fetch(input, { ...init, dispatcher: guardedDispatcher } as RequestInit);
}

function argsObject(args: Json): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) fail("runtime_tool_arguments_invalid", 422);
  return args as Record<string, unknown>;
}

function writeMapped(target: Record<string, unknown>, mapping: Record<string, string> | undefined, args: Record<string, unknown>): void {
  for (const [name, source] of Object.entries(mapping || {})) target[name] = args[source];
}

function compileRequest(base: URL, tool: HttpTool, rawArgs: Json): { url: URL; body?: string } {
  const args = argsObject(rawArgs);
  const encodedPath = tool.path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_full, key: string) => {
    const value = args[key];
    if (value === undefined || value === null) fail("runtime_tool_arguments_invalid", 422);
    if (typeof value === "object") fail("runtime_tool_arguments_invalid", 422);
    return encodeURIComponent(String(value));
  });
  const target = new URL(encodedPath, base);
  if (target.origin !== base.origin || target.username || target.password) fail("runtime_endpoint_invalid", 409);
  for (const [name, source] of Object.entries(tool.query || {})) {
    const value = args[source];
    if (value === undefined || value === null) continue;
    if (typeof value === "object") fail("runtime_tool_arguments_invalid", 422);
    target.searchParams.set(name, String(value));
  }
  if (tool.method === "GET") return { url: target };
  if (!tool.body) return { url: target };
  const body: Record<string, unknown> = {};
  writeMapped(body, tool.body, args);
  return { url: target, body: JSON.stringify(body) };
}

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        fail("runtime_http_response_too_large", 502);
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function project(value: unknown, pointer?: string): unknown {
  if (!pointer || pointer === "$") return value;
  let current: unknown = value;
  for (const part of pointer.slice(1).match(/\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\]/g) || []) {
    if (part.startsWith(".")) {
      if (!current || typeof current !== "object" || Array.isArray(current)) fail("runtime_http_output_path_missing", 502);
      current = (current as Record<string, unknown>)[part.slice(1)];
    } else {
      if (!Array.isArray(current)) fail("runtime_http_output_path_missing", 502);
      current = current[Number(part.slice(1, -1))];
    }
    if (current === undefined) fail("runtime_http_output_path_missing", 502);
  }
  return current;
}

function resultForModel(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES) fail("runtime_http_response_invalid", 502);
  return { content: [{ type: "text", text: serialized.slice(0, 24_000) }], structuredContent: value as Json };
}

/** JSON HTTP implementation of the same restricted listTools/callToolRaw interface as MCP. */
export class HttpConnectorClient implements RuntimeHttpRemote {
  private closed = false;
  private readonly base: URL;
  private readonly tools = new Map<string, HttpTool>();

  constructor(private readonly options: RuntimeHttpOptions, config: ConnectorConfig) {
    this.base = assertSafeConnectorEndpoint(options.url);
    if ((config.protocol || "mcp") !== "http") fail("runtime_http_config_invalid", 409);
    for (const tool of config.http_tools || []) this.tools.set(tool.name, tool);
  }

  async listTools(): Promise<Json[]> {
    if (this.closed) fail("runtime_run_closed", 410);
    return [...this.tools.values()].map(safeTool);
  }

  async callToolRaw(name: string, args: Json = {}): Promise<Json> {
    if (this.closed) fail("runtime_run_closed", 410);
    const tool = this.tools.get(name);
    if (!tool) fail("runtime_tool_not_found", 404);
    const request = compileRequest(this.base, tool, args);
    await assertResolvedConnectorEndpointSafe(request.url);
    const headers = new Headers(this.options.headers);
    headers.set("Accept", "application/json");
    if (request.body !== undefined) headers.set("Content-Type", "application/json");
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    let response: Response;
    try {
      response = await (this.options.fetch || fetchWithConnectorEgressPolicy)(request.url, {
        method: tool.method,
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "error",
        signal: timeout,
      });
    } catch (error) {
      const name = String((error as Error)?.name || "");
      if (name === "TimeoutError" || name === "AbortError") fail("runtime_http_timeout", 504);
      fail("runtime_http_request_failed", 502);
    }
    const text = await boundedText(response);
    if (!response.ok) fail("runtime_http_upstream_error", 502);
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { fail("runtime_http_response_invalid", 502); }
    return resultForModel(project(data, tool.output_path));
  }

  async close(): Promise<void> { this.closed = true; }
}
