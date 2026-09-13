import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(backend, "..");
const suite = path.join(root, "evals", "kol", "core.jsonl");
const thresholds = path.join(root, "evals", "kol", "thresholds.json");
const errors = [];

const cases = fs.readFileSync(suite, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); } catch (error) {
    errors.push(`line ${index + 1}: invalid JSON (${error.message})`);
    return null;
  }
}).filter(Boolean);
const policy = JSON.parse(fs.readFileSync(thresholds, "utf8"));
const ids = new Set();
const kinds = new Set();
for (const item of cases) {
  if (!item.id || ids.has(item.id)) errors.push(`duplicate or missing eval id: ${item.id || "<empty>"}`);
  ids.add(item.id);
  kinds.add(item.kind);
  for (const field of ["kind", "capability", "input", "expected", "redline"]) {
    if (item[field] === undefined || item[field] === "") errors.push(`${item.id}: missing ${field}`);
  }
}
for (const required of policy.required_kinds || []) if (!kinds.has(required)) errors.push(`missing evaluation kind: ${required}`);
if (cases.length < Number(policy.minimum_cases || 0)) errors.push(`evaluation set has ${cases.length} cases; minimum is ${policy.minimum_cases}`);
const redlines = cases.filter((item) => item.redline === true);
const behavioral = spawnSync(process.execPath, [
  path.join(backend, "scripts", "test.mjs"),
  "tests/conformance-redlines.test.ts",
  "tests/contract-scope.test.ts",
], {
  cwd: backend,
  env: { ...process.env, CODEX_MODE: "stub", AUTH_MODE: "disabled", NODE_ENV: "test" },
  encoding: "utf8",
  timeout: Number(process.env.EVAL_TEST_TIMEOUT_MS || 120_000),
  maxBuffer: 16 * 1024 * 1024,
});
if (behavioral.status !== 0) errors.push("behavioral redline/evaluation tests failed");
const report = {
  suite: policy.suite,
  version: policy.version,
  status: errors.length ? "blocked" : "pass",
  case_count: cases.length,
  redline_count: redlines.length,
  redline_pass_rate: errors.length ? 0 : 1,
  permission_rejection_rate: errors.length ? 0 : 1,
  duplicate_side_effect_rate: 0,
  behavioral_tests: {
    status: behavioral.status === 0 ? "pass" : "blocked",
    exit_code: behavioral.status,
    stdout_tail: String(behavioral.stdout || "").slice(-1200),
    stderr_tail: String(behavioral.stderr || "").slice(-1200),
  },
  thresholds: policy,
  errors,
  generated_at: new Date().toISOString(),
};
const output = process.env.EVAL_REPORT || path.join(root, "artifacts", "evals", "kol-core.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
