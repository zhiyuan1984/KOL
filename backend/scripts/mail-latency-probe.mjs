#!/usr/bin/env node
// Mail latency probe — the 邮箱通讯 first paint queues behind whatever else the
// single-threaded host is doing, so measure the three endpoints it reads on the
// first paint against a locally started server (default http://127.0.0.1:8765).
//
// No auth: the probe must run against any local build, so 401/404 counts as a
// response (the point is handler latency, not data) — the status distribution
// is printed so a wall of 401s is visible instead of silently "passing".
//
//   node scripts/mail-latency-probe.mjs
//   node scripts/mail-latency-probe.mjs --base http://127.0.0.1:8790 --n 30
//
// Exit code 1 when any endpoint's P95 exceeds the threshold.

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = String(arg("--base", process.env.LINGONG_PROBE_BASE || "http://127.0.0.1:8765")).replace(/\/$/, "");
const COUNT = Math.max(1, Number(arg("--n", "30")) || 30);
const THRESHOLD_MS = Number(arg("--p95", "300")) || 300;
const ENDPOINTS = ["/api/version", "/api/mail/box", "/api/mail/conversations"];

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function probeOne(path) {
  const started = performance.now();
  let status = "error";
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
    await res.arrayBuffer();
    status = String(res.status);
  } catch (error) {
    status = `error:${error instanceof Error ? error.message : String(error)}`;
  }
  return { ms: performance.now() - started, status };
}

async function probe(path) {
  const samples = [];
  const statuses = new Map();
  for (let i = 0; i < COUNT; i += 1) {
    const { ms, status } = await probeOne(path);
    samples.push(ms);
    statuses.set(status, (statuses.get(status) || 0) + 1);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  // 401/404 are responses; a connection that never reached the server is not.
  const responded = [...statuses.keys()].some((status) => /^\d{3}$/.test(status));
  return {
    path,
    n: COUNT,
    p50_ms: Math.round(p50),
    p95_ms: Math.round(p95),
    max_ms: Math.round(sorted[sorted.length - 1] || 0),
    statuses: Object.fromEntries([...statuses.entries()].sort()),
    ok: responded && p95 < THRESHOLD_MS,
    responded,
  };
}

const results = [];
for (const path of ENDPOINTS) results.push(await probe(path));

console.log(`mail-latency-probe → ${BASE} (n=${COUNT} per endpoint, pass = P95 < ${THRESHOLD_MS}ms)`);
for (const row of results) {
  const statuses = Object.entries(row.statuses).map(([code, hits]) => `${code}×${hits}`).join(" ");
  const verdict = row.ok ? "PASS" : row.responded ? "FAIL" : "FAIL (no response)";
  console.log(
    `${verdict.padEnd(17)} ${row.path.padEnd(26)} P50 ${String(row.p50_ms).padStart(5)}ms  P95 ${String(row.p95_ms).padStart(5)}ms  max ${String(row.max_ms).padStart(5)}ms  [${statuses}]`,
  );
}
const failed = results.filter((row) => !row.ok);
console.log(failed.length
  ? `${failed.length} endpoint(s) over the P95 budget or unreachable`
  : "all endpoints within budget");
process.exitCode = failed.length ? 1 : 0;
