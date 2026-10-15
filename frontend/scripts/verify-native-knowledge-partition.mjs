import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : "test-results/native-knowledge-partition.json";
if (!out) throw new Error("--out requires a path");

const playwright = path.resolve("node_modules/.bin/playwright");
function list(config, env = {}) {
  const result = spawnSync(playwright, ["test", "--list", `--config=${config}`], {
    cwd: process.cwd(), env: { ...process.env, ...env }, encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`${config} --list failed\n${result.stdout}\n${result.stderr}`);
  // Playwright renders paths relative to `testDir`, so normalize the display
  // form back to repo-relative E2E identities before comparing collections.
  const tests = [...result.stdout.matchAll(/›\s+([^:\n]+\.spec\.ts):\d+:\d+\s+›\s+(.+)$/gm)]
    .map((match) => `e2e/${match[1]} › ${match[2]}`).sort();
  if (!tests.length) throw new Error(`${config} --list returned no parsable tests\n${result.stdout}`);
  return tests;
}
function unique(rows, label) {
  const duplicates = rows.filter((row, index) => rows.indexOf(row) !== index);
  if (duplicates.length) throw new Error(`${label} contains duplicate cases: ${[...new Set(duplicates)].join(" | ")}`);
}
function same(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const baseline = list("playwright.config.ts");
const legacy = list("playwright.config.ts", { E2E_NATIVE_AUTH_PARTITION: "1" });
const native = list("playwright.native-knowledge.config.ts");
const nativeOriginal = native.filter((row) => row.startsWith("e2e/knowledge-documents.spec.ts ›"));
const nativeInfra = native.filter((row) => row.startsWith("e2e/native-knowledge-auth.spec.ts ›"));
const legacyNativeOverlap = legacy.filter((row) => nativeOriginal.includes(row));
const union = [...legacy, ...nativeOriginal].sort();
unique(baseline, "baseline");
unique(legacy, "legacy partition");
unique(nativeOriginal, "native original partition");
unique(union, "partition union");
if (legacyNativeOverlap.length || !same(baseline, union)) {
  throw new Error(JSON.stringify({
    reason: "native/legacy original collection partition is not exact",
    baselineCount: baseline.length,
    legacyCount: legacy.length,
    nativeOriginalCount: nativeOriginal.length,
    overlap: legacyNativeOverlap,
    missing: baseline.filter((row) => !union.includes(row)),
    extra: union.filter((row) => !baseline.includes(row)),
  }, null, 2));
}
const receipt = {
  status: "passed",
  baseline_original_cases: baseline.length,
  legacy_original_cases: legacy.length,
  native_original_cases: nativeOriginal.length,
  native_infrastructure_cases: nativeInfra.length,
  original_overlap: legacyNativeOverlap,
  original_missing: baseline.filter((row) => !union.includes(row)),
  original_extra: union.filter((row) => !baseline.includes(row)),
  native_original_cases_detail: nativeOriginal,
  native_infrastructure_cases_detail: nativeInfra,
};
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
