import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
// Unit/contract tests run in an isolated, unauthenticated harness by default.
// Suites that exercise the real account boundary explicitly set AUTH_MODE=enabled
// in their setup; production and release-gate commands do not use this runner.
const env = {
  ...process.env,
  CODEX_MODE: process.env.CODEX_MODE || "stub",
  AUTH_MODE: process.env.AUTH_MODE || "disabled",
  NODE_ENV: process.env.NODE_ENV || "test",
};
const child = spawn(process.execPath, [vitest, "run", "--configLoader", "runner", ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: true,
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
