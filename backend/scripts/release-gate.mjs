import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(backend, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const internal = process.argv.includes("--internal") || process.env.RELEASE_GATE_PROFILE === "internal";
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
  { id: "frontend-e2e", cwd: path.join(root, "frontend"), command: npm, args: ["run", "test:e2e"] },
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
    },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    // A browser runner or remote test must never leave the release gate
    // hanging forever. Its timeout is reported as a failed gate item.
    timeout: Number(process.env.RELEASE_GATE_STEP_TIMEOUT_MS || 300_000),
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
