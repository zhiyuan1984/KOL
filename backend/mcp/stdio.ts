/** Minimal MCP JSON-RPC stdio transport, with ordered asynchronous dispatch. */
import type { Json } from "../src/types.js";
import { READ_ONLY_ANNOTATIONS, type McpToolDef } from "./tools.js";
type Handler = (name: string, args: Json) => Json | Promise<Json>;
export function describeTools(tools: McpToolDef[]) {
  return tools.map((tool) => ({ ...tool, annotations: tool.annotations || READ_ONLY_ANNOTATIONS }));
}
export function filterTools(tools: McpToolDef[], allow?: readonly string[]): McpToolDef[] {
  if (!allow) return [...tools];
  const allowed = new Set(allow);
  return tools.filter((tool) => allowed.has(tool.name));
}
export function serveMcpStdio(opts: { name: string; version?: string; tools: McpToolDef[]; call: Handler; allow?: readonly string[] }): void {
  const { name, version = "0.1.0", call } = opts;
  const tools = filterTools(opts.tools, opts.allow);
  let buf = "";
  let pending = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) pending = pending.then(() => onMessage(line)).catch((error: unknown) => {
        process.stderr.write(`[mcp-stdio] dispatch failed: ${error instanceof Error ? error.message : String(error)}\n`);
      });
    }
  });
  function write(obj: Json): void { process.stdout.write(`${JSON.stringify(obj)}\n`); }
  async function onMessage(line: string): Promise<void> {
    let msg: Json;
    try { msg = JSON.parse(line) as Json; } catch { return; }
    const id = msg.id;
    const method = String(msg.method || "");
    const params = (msg.params as Json) || {};
    try {
      if (method === "initialize") {
        write({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name, version } } });
        return;
      }
      if (method === "notifications/initialized" || method === "initialized") return;
      if (method === "ping") { write({ jsonrpc: "2.0", id, result: {} }); return; }
      if (method === "tools/list") { write({ jsonrpc: "2.0", id, result: { tools: describeTools(tools) } }); return; }
      if (method === "tools/call") {
        const toolName = String(params.name || "");
        if (!tools.some((tool) => tool.name === toolName)) throw new Error(`MCP tool is not allowed for this task: ${toolName}`);
        const result = await call(toolName, (params.arguments as Json) || {});
        write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } });
        return;
      }
      if (id != null) write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (error) {
      if (id != null) write({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
    }
  }
}
export function parseDbArg(argv = process.argv): string | undefined {
  const i = argv.indexOf("--db");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}
export function parseAllowArg(argv = process.argv): string[] | undefined {
  const i = argv.indexOf("--allow");
  return i < 0 ? undefined : String(argv[i + 1] || "").split(",").map((name) => name.trim()).filter(Boolean);
}
