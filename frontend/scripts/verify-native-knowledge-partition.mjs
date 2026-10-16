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
const nativeOriginalSpecs = [
  "knowledge-documents.spec.ts",
  "knowledge-usage.spec.ts",
  "knowledge-v2-home.spec.ts",
  "knowledge-question-template-flow.spec.ts",
  "product-knowledge.spec.ts",
];
const nativeOriginal = native.filter((row) => nativeOriginalSpecs.some((spec) => row.startsWith(`e2e/${spec} ›`)));
const nativeAuthSpec = "e2e/native-knowledge-auth.spec.ts";
const enabledNativeAuthCases = [
  `${nativeAuthSpec} › native login exposes the authenticated knowledge catalog and published template`,
  `${nativeAuthSpec} › requester cannot self-approve while the independently logged-in reviewer approves`,
].sort();
const legacyAnonymousAuthCases = [
  `${nativeAuthSpec} › anonymous caller is denied the native knowledge catalog`,
];
const baselineNativeAuth = baseline.filter((row) => row.startsWith(`${nativeAuthSpec} ›`));
const legacyNativeAuth = legacy.filter((row) => row.startsWith(`${nativeAuthSpec} ›`));
const nativeEnabledAuth = native.filter((row) => row.startsWith(`${nativeAuthSpec} ›`));
const nativeUnexpected = native.filter((row) => !nativeOriginal.includes(row) && !nativeEnabledAuth.includes(row));
const legacyNativeOverlap = legacy.filter((row) => nativeOriginal.includes(row) || nativeEnabledAuth.includes(row));
const union = [...legacy, ...nativeOriginal, ...nativeEnabledAuth].sort();
unique(baseline, "baseline");
unique(legacy, "legacy partition");
unique(nativeOriginal, "native original partition");
unique(nativeEnabledAuth, "native enabled-auth partition");
unique(union, "partition union");
if (
  nativeUnexpected.length
  || legacyNativeOverlap.length
  || !same(baseline, union)
  || !same(baselineNativeAuth, [...enabledNativeAuthCases, ...legacyAnonymousAuthCases].sort())
  || !same(legacyNativeAuth, legacyAnonymousAuthCases)
  || !same(nativeEnabledAuth, enabledNativeAuthCases)
) {
  throw new Error(JSON.stringify({
    reason: "native/legacy original collection or native-auth case partition is not exact",
    baselineCount: baseline.length,
    legacyCount: legacy.length,
    nativeOriginalCount: nativeOriginal.length,
    baselineNativeAuth,
    legacyNativeAuth,
    nativeEnabledAuth,
    expectedLegacyAnonymousAuth: legacyAnonymousAuthCases,
    expectedEnabledNativeAuth: enabledNativeAuthCases,
    overlap: legacyNativeOverlap,
    missing: baseline.filter((row) => !union.includes(row)),
    extra: union.filter((row) => !baseline.includes(row)),
    nativeUnexpected,
  }, null, 2));
}
const receipt = {
  status: "passed",
  baseline_original_cases: baseline.length,
  legacy_original_cases: legacy.length,
  native_original_cases: nativeOriginal.length,
  native_enabled_auth_cases: nativeEnabledAuth.length,
  legacy_anonymous_auth_cases: legacyNativeAuth.length,
  original_overlap: legacyNativeOverlap,
  original_missing: baseline.filter((row) => !union.includes(row)),
  original_extra: union.filter((row) => !baseline.includes(row)),
  native_unexpected_cases: nativeUnexpected,
  native_original_specs: nativeOriginalSpecs,
  native_original_cases_detail: nativeOriginal,
  native_enabled_auth_cases_detail: nativeEnabledAuth,
  legacy_anonymous_auth_cases_detail: legacyNativeAuth,
};
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
