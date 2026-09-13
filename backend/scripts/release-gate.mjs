import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(backend, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const internal = process.argv.includes("--internal") || process.env.RELEASE_GATE_PROFILE === "internal";
const defaultStepTimeoutMs = Number(process.env.RELEASE_GATE_STEP_TIMEOUT_MS || 300_000);
const e2eTimeoutMs = Number(process.env.RELEASE_GATE_E2E_TIMEOUT_MS || 1_200_000);

function allocatePort(preferred) {
  if (preferred) return String(preferred);
  const candidates = ["18876", "18877", "18878", "18879", "18880"];
  for (const port of candidates) {
    if (portFree(port)) return port;
  }
  return "18876";
}

function portFree(port) {
  // listen() reports EADDRINUSE asynchronously, so probe in a short-lived
  // child. Default Playwright 8876/8877 are skipped on purpose.
  const probe = spawnSync(process.execPath, ["-e", `
    const net = require("node:net");
    const server = net.createServer();
    server.once("error", () => process.exit(1));
    server.listen(${Number(port)}, "127.0.0.1", () => server.close(() => process.exit(0)));
  `], { encoding: "utf8", timeout: 2000 });
  return probe.status === 0;
}

// Stub gate E2E must never inherit a leftover real-mode shell. A previous
// operator export of E2E_MODE=real / port 8877 is what made spawnSync look
// like ETIMEDOUT while Chromium was still working through the suite.
const e2ePort = allocatePort(process.env.RELEASE_GATE_E2E_PORT);
const stubE2eEnv = {
  E2E_MODE: "stub",
  E2E_AUTH_MODE: "disabled",
  CODEX_MODE: "stub",
  E2E_PORT: e2ePort,
  E2E_BASE: `http://127.0.0.1:${e2ePort}`,
  LINGONG_PORT: e2ePort,
  E2E_SKIP_BUILD: "1",
  MEDIACRAWLER_AUTO_START: "",
  PW_CHANNEL: "",
  PW_EXECUTABLE_PATH: "",
  PW_HEADLESS: "1",
};

const steps = [
  { id: "kol-data", cwd: backend, command: process.execPath, args: ["scripts/validate-kol-data.mjs"] },
  { id: "contracts-pilot", cwd: backend, command: process.execPath, args: ["scripts/validate-contracts.mjs"] },
  ...(internal ? [] : [
    { id: "contracts-production", cwd: backend, command: process.execPath, args: ["scripts/validate-contracts.mjs", "--production"] },
    { id: "tb-binding", cwd: backend, command: process.execPath, args: ["scripts/validate-tb-binding.mjs"] },
  ]),
  { id: "backend-typecheck", cwd: backend, command: npm, args: ["run", "typecheck"] },
  { id: "backend-full-tests", cwd: backend, command: npm, args: ["test"] },
  { id: "kol-evals", cwd: backend, command: npm, args: ["run", "eval:kol"] },
  { id: "redaction-scan", cwd: backend, command: npm, args: ["run", "scan:redaction"] },
  { id: "rollback-rehearsal", cwd: backend, command: npm, args: ["run", "rehearse:rollback"] },
  { id: "frontend-typecheck", cwd: path.join(root, "frontend"), command: npm, args: ["run", "typecheck"] },
  { id: "frontend-build", cwd: path.join(root, "frontend"), command: npm, args: ["run", "build"] },
  {
    id: "frontend-e2e",
    cwd: path.join(root, "frontend"),
    command: npm,
    args: ["run", "test:e2e"],
    timeout: e2eTimeoutMs,
    env: stubE2eEnv,
  },
];

const results = [];
for (const step of steps) {
  const launch = process.platform === "win32" && step.command === npm
    ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", [step.command, ...step.args].join(" ")] }
    : { command: step.command, args: step.args };
  const result = spawnSync(launch.command, launch.args, {
    cwd: step.cwd,
    env: {
      ...process.env,
      CODEX_MODE: process.env.CODEX_MODE || "stub",
      ...(internal && process.platform === "win32" && !process.env.PW_CHANNEL && !process.env.PW_EXECUTABLE_PATH
        ? { PW_CHANNEL: "msedge" }
        : {}),
      ...(step.env || {}),
    },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    // A browser runner or remote test must never leave the release gate
    // hanging forever. Its timeout is reported as a failed gate item.
    // Stub Playwright is ~72 cases / ~1 min when isolated; 5 min was enough
    // on a warm machine and not enough when a rebuild + inherited real mode
    // stacked on the same spawnSync. frontend-e2e uses a longer default.
    timeout: Number(step.timeout || defaultStepTimeoutMs),
  });
  results.push({
    id: step.id,
    ok: result.status === 0,
    exitCode: result.status,
    error: result.error ? String(result.error) : null,
    stdoutTail: String(result.stdout || "").slice(-1200),
    stderrTail: String(result.stderr || "").slice(-1200),
  });
}

const failed = results.filter((item) => !item.ok).map((item) => item.id);
console.log(JSON.stringify({ profile: internal ? "internal" : "production", status: failed.length ? "blocked" : "pass", failed, results }, null, 2));
if (failed.length) process.exitCode = 1;
