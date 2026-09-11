import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Json } from "../types.js";

export type RemoteMcpOptions = {
  url?: string;
  token?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
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
  private readonly transport: StreamableHTTPClientTransport;
  private connecting: Promise<void> | null = null;
  private closed = false;

  constructor(options: RemoteMcpOptions = {}) {
    this.url = required(options.url ?? process.env.MEDIACRAWLER_MCP_URL, "MCP URL");
    const token = options.token ?? process.env.MEDIACRAWLER_MCP_TOKEN;
    const headers: Record<string, string> = { ...(options.headers || {}) };
    if (token && !headers.Authorization && !headers["X-MCP-API-KEY"]) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (!headers.Authorization && !headers["X-MCP-API-KEY"]) {
      throw new Error("MCP auth header is required");
    }
    this.timeoutMs = options.timeoutMs ?? Number(process.env.MEDIACRAWLER_MCP_TIMEOUT_MS || 30_000);
    this.client = new Client({ name: "lingong-mcp", version: "0.1.0" });
    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  private async connect(): Promise<void> {
    if (this.closed) throw new Error("remote MCP client is closed");
    if (!this.connecting) this.connecting = this.client.connect(this.transport, { timeout: this.timeoutMs });
    await this.connecting;
  }

  async listTools(): Promise<Json[]> {
    await this.connect();
    const result = await this.client.listTools({}, { timeout: this.timeoutMs });
    return result.tools as unknown as Json[];
  }

  async callTool(name: string, args: Json = {}): Promise<Json> {
    await this.connect();
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: this.timeoutMs },
    ) as unknown as Record<string, unknown>;
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
