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
//   node scripts/mail-latency-probe.mjs --endpoints /api/tasks
//
// Exit code 1 when any probed endpoint's P95 exceeds the threshold. The byte
// budget line below is informational only: it never changes the exit code.

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = String(arg("--base", process.env.LINGONG_PROBE_BASE || "http://127.0.0.1:8765")).replace(/\/$/, "");
const COUNT = Math.max(1, Number(arg("--n", "30")) || 30);
const THRESHOLD_MS = Number(arg("--p95", "300")) || 300;
const DEFAULT_ENDPOINTS = ["/api/version", "/api/mail/box", "/api/mail/conversations"];
// Opt-in extras: the mail probe stays fast by default, but /api/tasks is the
// endpoint the 邮箱 first paint actually queues behind on a busy host.
const EXTRA_ENDPOINTS = String(arg("--endpoints", "")).split(",").map((path) => path.trim()).filter(Boolean);
const ENDPOINTS = [...DEFAULT_ENDPOINTS, ...EXTRA_ENDPOINTS.filter((path) => !DEFAULT_ENDPOINTS.includes(path))];

/** Average transfer budget per response, bytes. Presentation budget, not a gate. */
const BYTE_BUDGETS = { "/api/tasks": 512 * 1024 };

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/** Response bodies are small JSON documents; one decimal is enough to see volume. */
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / (1024 * 1024)).toFixed(1)}M`;
}

async function probeOne(path) {
  const started = performance.now();
  let status = "error";
  let bytes = 0;
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
    const body = await res.arrayBuffer();
    bytes = body.byteLength;
    status = String(res.status);
  } catch (error) {
    status = `error:${error instanceof Error ? error.message : String(error)}`;
  }
  return { ms: performance.now() - started, status, bytes };
}

async function probe(path) {
  const samples = [];
  const sizes = [];
  const statuses = new Map();
  for (let i = 0; i < COUNT; i += 1) {
    const { ms, status, bytes } = await probeOne(path);
    samples.push(ms);
    sizes.push(bytes);
    statuses.set(status, (statuses.get(status) || 0) + 1);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sortedSizes = [...sizes].sort((a, b) => a - b);
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
    // Transfer volume sits next to latency: a fast-but-fat endpoint still costs.
    bytes_min: sortedSizes[0] || 0,
    bytes_avg: Math.round(sizes.reduce((sum, value) => sum + value, 0) / (sizes.length || 1)),
    bytes_max: sortedSizes[sortedSizes.length - 1] || 0,
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
  const bytes = `bytes min ${formatBytes(row.bytes_min)} / avg ${formatBytes(row.bytes_avg)} / max ${formatBytes(row.bytes_max)}`;
  console.log(
    `${verdict.padEnd(17)} ${row.path.padEnd(26)} P50 ${String(row.p50_ms).padStart(5)}ms  P95 ${String(row.p95_ms).padStart(5)}ms  max ${String(row.max_ms).padStart(5)}ms  [${statuses}]  ${bytes}`,
  );
}
const failed = results.filter((row) => !row.ok);
// One line of volume verdicts next to the latency table; informational only.
const budgetLine = Object.entries(BYTE_BUDGETS).map(([path, cap]) => {
  const row = results.find((item) => item.path === path);
  if (!row) return `${path} not probed (--endpoints ${path})`;
  return `${path} avg ${formatBytes(row.bytes_avg)} ${row.bytes_avg > cap ? "OVER" : "ok"} (budget ${formatBytes(cap)})`;
});
console.log(`byte budget: ${budgetLine.join(" · ")}`);
console.log(failed.length
  ? `${failed.length} endpoint(s) over the P95 budget or unreachable`
  : "all endpoints within budget");
process.exitCode = failed.length ? 1 : 0;
