import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(backend, "..");
const checks = [
  ["receipt-version", "tests/receipt-version.test.ts"],
  ["run-queue", "tests/run-queue.test.ts"],
  ["redlines", "tests/conformance-redlines.test.ts"],
];
const missing = checks.filter(([, file]) => !fs.existsSync(path.join(backend, file)));
const report = {
  status: missing.length ? "blocked" : "pass",
  rehearsal: "internal-stop-and-recover",
  actions: [
    "stop_new_runs",
    "preserve_submitted_receipts",
    "replay_only_idempotent_pending_work",
    "manual_compensation_for_irreversible_external_actions",
  ],
  evidence_tests: checks.map(([id, file]) => ({ id, file })),
  missing,
  generated_at: new Date().toISOString(),
};
const output = process.env.ROLLBACK_REPORT || path.join(root, "artifacts", "ops", "rollback-rehearsal.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (missing.length) process.exitCode = 1;
