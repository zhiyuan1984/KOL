/**
 * 把 MCP 工具节点挂到 Codex Thread（Dify conversation 的一次配置）。
 * 走 thread/start.config.mcp_servers，并写箱内 .codex/config.toml。
 */
import fs from "node:fs";
import path from "node:path";
import {
  BACKEND_ROOT,
  clawMode,
  codexMode,
  dbPath,
  kolClawConfigured,
  kolClawMcpUrl,
  mcpDir,
  mediaCrawlerMcpUrl,
  starryKolMcpConfigured,
  starryKolMcpHeaders,
  starryKolMcpUrl,
} from "../src/config.js";
import type { Json } from "../src/types.js";
import { ALLOWED_TASK_MCP } from "../src/tasks/registry.js";

function toolsForServer(allowlist: readonly string[], server: string): string[] {
  const prefix = `${server}.`;
  return allowlist.filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length));
}

export function mcpServerSpecs(allowlist: readonly string[] = [...ALLOWED_TASK_MCP]): Json {
  const tsxCli = path.join(BACKEND_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const db = dbPath();
  const starry = path.join(mcpDir(), "starry-server.ts");
  const grouped = {
    starrykol: toolsForServer(allowlist, "starrykol"),
    kolclaw: toolsForServer(allowlist, "kolclaw"),
    starry: toolsForServer(allowlist, "starry"),
    claw: toolsForServer(allowlist, "claw"),
  };
  const specs: Json = {};
  if (grouped.starry.length) specs.starry = {
    command: process.execPath,
    args: [tsxCli, starry, "--db", db, "--allow", grouped.starry.join(",")],
    cwd: BACKEND_ROOT,
    enabled: true,
  };
  if (grouped.starrykol.length && starryKolMcpConfigured()) {
    specs.starrykol = {
      url: starryKolMcpUrl(),
      http_headers: starryKolMcpHeaders(),
      enabled_tools: grouped.starrykol,
      enabled: true,
      startup_timeout_sec: 15,
      tool_timeout_sec: 30,
    };
  }
  if (grouped.kolclaw.length && kolClawConfigured()) {
    specs.kolclaw = {
      url: kolClawMcpUrl(),
      bearer_token_env_var: "KOLCLAW_MCP_TOKEN",
      enabled_tools: grouped.kolclaw,
      enabled: true,
      startup_timeout_sec: 15,
      tool_timeout_sec: 60,
    };
  }
  if (grouped.claw.length) {
    const localFallback = codexMode() === "stub" || clawMode() === "mock" ||
      process.env.MEDIACRAWLER_MCP_TEST_LOCAL === "1";
    specs.claw = localFallback
      ? {
          command: process.execPath,
          args: [tsxCli, path.join(mcpDir(), "claw-server.ts"), "--db", db, "--allow", grouped.claw.join(",")],
          cwd: BACKEND_ROOT,
          enabled: true,
          enabled_tools: grouped.claw,
        }
      : {
          url: mediaCrawlerMcpUrl(),
          bearer_token_env_var: "MEDIACRAWLER_MCP_TOKEN",
          enabled: true,
          enabled_tools: grouped.claw,
          startup_timeout_sec: 15,
          tool_timeout_sec: 60,
        };
  }
  return specs;
}

export function writeBoxCodexConfig(box: string, allowlist?: readonly string[]): void {
  const dir = path.join(box, ".codex");
  fs.mkdirSync(dir, { recursive: true });
  const specs = mcpServerSpecs(allowlist) as Record<string, {
    command?: string; args?: string[]; cwd?: string; url?: string;
    bearer_token_env_var?: string; http_headers?: Record<string, string>;
    enabled_tools?: string[]; startup_timeout_sec?: number; tool_timeout_sec?: number;
  }>;
  const lines = [
    "# Dify 工具节点 → MCP。Codex 只通过这里读 Starry/Claw。",
    "# 无 SMTP / WeCom / 阶段写。",
    "# streamable_http 不能写 bearer_token；鉴权放 http_headers 或 bearer_token_env_var。",
  ];
  for (const [name, spec] of Object.entries(specs)) {
    lines.push("");
    lines.push(`[mcp_servers.${name}]`);
    if (spec.command) lines.push(`command = ${tomlStr(spec.command)}`);
    if (spec.args) lines.push(`args = [${spec.args.map(tomlStr).join(", ")}]`);
    if (spec.cwd) lines.push(`cwd = ${tomlStr(spec.cwd)}`);
    if (spec.url) lines.push(`url = ${tomlStr(spec.url)}`);
    if (spec.bearer_token_env_var) {
      lines.push(`bearer_token_env_var = ${tomlStr(spec.bearer_token_env_var)}`);
    }
    if (spec.enabled_tools) lines.push(`enabled_tools = [${spec.enabled_tools.map(tomlStr).join(", ")}]`);
    if (spec.startup_timeout_sec) lines.push(`startup_timeout_sec = ${spec.startup_timeout_sec}`);
    if (spec.tool_timeout_sec) lines.push(`tool_timeout_sec = ${spec.tool_timeout_sec}`);
    lines.push("enabled = true");
    if (spec.http_headers && Object.keys(spec.http_headers).length) {
      lines.push("");
      lines.push(`[mcp_servers.${name}.http_headers]`);
      for (const [key, value] of Object.entries(spec.http_headers)) {
        lines.push(`${tomlStr(key)} = ${tomlStr(value)}`);
      }
    }
  }
  fs.writeFileSync(path.join(dir, "config.toml"), lines.join("\n") + "\n", "utf8");
}

function tomlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
