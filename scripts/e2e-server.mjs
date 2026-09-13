import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.LINGONG_PORT || "8876";
const data = process.env.LINGONG_DATA || path.join(root, "data-e2e");
// E2E defaults to the deterministic stub.  A real staging run must opt in
// explicitly so a normal Playwright invocation can never touch remote MCP or
// external side effects by accident.
const mode = String(process.env.E2E_MODE || process.env.CODEX_MODE || "stub").toLowerCase();
if (mode !== "stub" && mode !== "real") throw new Error(`Unsupported E2E_MODE: ${mode}`);
const authMode = process.env.E2E_AUTH_MODE || (mode === "real" ? "enabled" : "disabled");
fs.mkdirSync(data, { recursive: true });

const startBackend = () => {
  const server = spawn(process.execPath, [
    path.join(root, "backend", "node_modules", "tsx", "dist", "cli.mjs"),
    "src/index.ts",
  ], {
    cwd: path.join(root, "backend"),
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${path.join(root, "scripts", "tsx-windows-shim.cjs")}`.trim(),
      CODEX_MODE: mode,
      AUTH_MODE: authMode,
      LINGONG_PORT: port,
      LINGONG_DATA: data,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  process.on("SIGINT", () => server.kill("SIGINT"));
  process.on("SIGTERM", () => server.kill("SIGTERM"));
  server.on("exit", (serverCode) => process.exit(serverCode || 0));
};

if (process.env.E2E_SKIP_BUILD === "1") {
  // Useful when a verified frontend build already exists and Windows still
  // holds a handle on dist/ from a previous browser run.
  startBackend();
} else {
  const buildCommand = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const buildArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
  const build = spawn(buildCommand, buildArgs, {
    cwd: path.join(root, "frontend"),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  build.on("exit", (code) => {
    if (code !== 0) process.exit(code || 1);
    startBackend();
  });
}
