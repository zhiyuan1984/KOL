import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Json } from "../types.js";

export type RemoteMcpOptions = {
  url?: string;
  token?: string;
  headers?: Record<string, string>;
  /** Explicitly permit a local or public MCP endpoint with no credential headers. */
  allowUnauthenticated?: boolean;
  timeoutMs?: number;
  /** Omitted keeps the streamable-http transport used by existing connectors. */
  transport?: "streamable-http" | "sse";
  fetch?: typeof fetch;
};

/** Bounds a single remote catalog refresh if an endpoint returns a bad cursor chain. */
const MAX_LIST_TOOLS_PAGES = 100;
const MAX_LIST_TOOLS_TOTAL = 10_000;

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.entries(headers).some(([key, value]) => key.toLowerCase() === name && Boolean(value.trim()));
}

function hasAuthenticationHeader(headers: Record<string, string>): boolean {
  // Connector authentication is not limited to bearer or MCP API-key conventions.
  // A non-empty caller-supplied header is an explicit credential declaration; this
  // transport forwards it unchanged and does not attempt to interpret its secret.
  return Object.values(headers).some((value) => Boolean(value.trim()));
}

export function normalizeMcpContent(result: Record<string, unknown>): Json {
  const unwrapResult = (value: Json): Json => {
    if (
      Object.keys(value).length === 1 &&
      value.result &&
      typeof value.result === "object" &&
      !Array.isArray(value.result)
    ) {
      return value.result as Json;
    }
    return value;
  };
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return unwrapResult(result.structuredContent as Json);
  }
  const content = Array.isArray(result.content) ? result.content as Record<string, unknown>[] : [];
  const texts = content.filter((part) => part.type === "text").map((part) => String(part.text || ""));
  if (texts.length === 1) {
    try {
      const parsed = JSON.parse(texts[0]);
      if (parsed && typeof parsed === "object") return unwrapResult(parsed as Json);
      return { value: parsed };
    } catch {
      return { text: texts[0] };
    }
  }
  return {
    content: content.map((part) => {
      if (part.type === "text") return { type: "text", text: String(part.text || "") };
      return part as Json;
    }),
    ...(result.isError ? { isError: true } : {}),
  };
}

export class RemoteMcpClient {
  readonly url: string;
  readonly timeoutMs: number;
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport | SSEClientTransport;
  private connecting: Promise<void> | null = null;
  private closed = false;

  constructor(options: RemoteMcpOptions = {}) {
    const usesDefaultMediaCrawlerEndpoint = options.url === undefined;
    this.url = required(
      usesDefaultMediaCrawlerEndpoint ? process.env.MEDIACRAWLER_MCP_URL : options.url,
      "MCP URL",
    );
    // An explicitly supplied endpoint is a separate connector. Never attach the
    // MediaCrawler credential to it, including when token is deliberately "".
    const token = usesDefaultMediaCrawlerEndpoint
      ? options.token ?? process.env.MEDIACRAWLER_MCP_TOKEN
      : options.token;
    const headers: Record<string, string> = { ...(options.headers || {}) };
    const trimmedToken = token?.trim();
    if (trimmedToken && !hasHeader(headers, "authorization") && !hasHeader(headers, "x-mcp-api-key")) {
      headers.Authorization = `Bearer ${trimmedToken}`;
    }
    if (!hasAuthenticationHeader(headers) && !options.allowUnauthenticated) {
      throw new Error("MCP auth header is required");
    }
    this.timeoutMs = options.timeoutMs ?? Number(process.env.MEDIACRAWLER_MCP_TIMEOUT_MS || 30_000);
    this.client = new Client({ name: "lingong-mcp", version: "0.1.0" });
    const endpoint = new URL(this.url);
    // SSE splits traffic over two legs: a long-lived GET event stream and the POST
    // channel. Both must traverse the caller's egress-guarded fetch, so it is
    // registered for the EventSource stream as well as the transport POST path.
    const guardedFetch = options.fetch;
    this.transport = options.transport === "sse"
      ? new SSEClientTransport(endpoint, {
        requestInit: { headers },
        ...(guardedFetch ? { fetch: guardedFetch, eventSourceInit: { fetch: guardedFetch } } : {}),
      })
      : new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers },
        ...(guardedFetch ? { fetch: guardedFetch } : {}),
      });
  }

  private async connect(): Promise<void> {
    if (this.closed) throw new Error("remote MCP client is closed");
    if (!this.connecting) this.connecting = this.client.connect(this.transport, { timeout: this.timeoutMs });
    await this.connecting;
  }

  async listTools(): Promise<Json[]> {
    await this.connect();
    // This intentionally is a refresh, not a cache: each invocation walks the
    // current remote catalog from its first page so newly bound tools are visible.
    const tools: Json[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_LIST_TOOLS_PAGES; page += 1) {
      const result = await this.client.listTools(
        cursor === undefined ? {} : { cursor },
        { timeout: this.timeoutMs },
      );
      if (tools.length + result.tools.length > MAX_LIST_TOOLS_TOTAL) {
        throw new Error(`remote MCP tools/list exceeded ${MAX_LIST_TOOLS_TOTAL} tools`);
      }
      // Preserve the SDK descriptor verbatim: name, description, JSON schemas,
      // annotations, and extension metadata are all required by downstream proxying.
      tools.push(...result.tools as unknown as Json[]);

      const nextCursor = result.nextCursor;
      if (nextCursor === undefined) return tools;
      if (seenCursors.has(nextCursor)) {
        throw new Error("remote MCP tools/list returned a repeated cursor");
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error(`remote MCP tools/list exceeded ${MAX_LIST_TOOLS_PAGES} pages`);
  }

  /** Forward an MCP tool result without normalization, including isError and content blocks. */
  async callToolRaw(name: string, args: Json = {}): Promise<Record<string, unknown>> {
    await this.connect();
    return await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: this.timeoutMs },
    ) as unknown as Record<string, unknown>;
  }

  async callTool(name: string, args: Json = {}): Promise<Json> {
    const result = await this.callToolRaw(name, args);
    const normalized = normalizeMcpContent(result);
    if (result.isError) throw new Error(String(normalized.text || `remote MCP tool ${name} failed`));
    return normalized;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.client.close();
  }
}

export async function withRemoteMcp<T>(
  operation: (client: RemoteMcpClient) => Promise<T>,
  options: RemoteMcpOptions = {},
): Promise<T> {
  const client = new RemoteMcpClient(options);
  try {
    return await operation(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
