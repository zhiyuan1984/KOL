import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { authMiddleware, authRouter, ensureDemoAdmin } from "./auth.js";
import { clawRouter, starryRouter } from "./adapters/httpMount.js";
import { clawMode, codexMode, frontendDist } from "./config.js";
import { codexBinOk, isTestRuntime } from "./codex-runtime.js";
import { getConn } from "./db.js";
import { host } from "./host/api.js";
import { HostReject, HttpFail } from "./host/errors.js";
import { approvals } from "./routers/approvals.js";
import { misc } from "./routers/misc.js";
import { pipeline } from "./routers/pipeline.js";
import { examRouter } from "./exam.js";
import { enterprise } from "./routers/enterprise.js";
import { skillRuntimeRouter } from "./routers/skill-runtime.js";
import { runtimeDiscoveryRouter } from "./routers/runtime-discovery.js";
import { connectorOperationsRouter } from "./routers/connector-operations.js";
import { connectorCredentialsRouter } from "./routers/connector-credentials.js";
import { ensureRuntimeSchema } from "./runtime/store.js";
import { tasks } from "./routers/tasks.js";
import { crawlRouter } from "./routers/crawl.js";
import { knowledge } from "./routers/knowledge.js";
import { experts } from "./routers/experts.js";
import { discovery } from "./routers/discovery.js";
import { homeDiscovery } from "./routers/home-discovery.js";
import { cron } from "./routers/cron.js";
import { kolMemory } from "./routers/kol-memory.js";
import { mail } from "./routers/mail.js";
import { homeToday } from "./routers/home-today.js";
import { restoreActiveCrawlJobs } from "./crawl/service.js";
import { restoreActiveDiscoveryRuns } from "./discovery.js";
import { restoreActiveHomeDiscoveryRuns } from "./home-discovery.js";
import { seedIfEmpty } from "./seed.js";

export function createApp(): Hono {
  getConn();
  seedIfEmpty();
  ensureRuntimeSchema();
  ensureDemoAdmin();
  restoreActiveCrawlJobs();
  restoreActiveDiscoveryRuns();
  restoreActiveHomeDiscoveryRuns();

  const app = new Hono();
  const configuredOrigin = process.env.APP_ORIGIN || process.env.CORS_ORIGIN;
  const corsOrigin = process.env.NODE_ENV === "production"
    ? (origin: string) => configuredOrigin && origin === configuredOrigin ? configuredOrigin : null
    : configuredOrigin || "*";
  app.use("*", cors({ origin: corsOrigin, credentials: Boolean(configuredOrigin) }));
  // The mailbox list is ~200KB of CJK text and the server uplink is slow;
  // gzip cuts it by roughly 5-8x. SSE keeps its own encoding.
  app.use("/api/*", compress());
  app.use("/api/*", authMiddleware);

  app.onError((err, c) => {
    if (err instanceof HostReject) {
      return c.json(err.payload, err.statusCode as 400 | 403 | 409 | 422 | 503);
    }
    if (err instanceof HttpFail) {
      return c.json({ detail: err.detail }, err.status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503);
    }
    console.error(err);
    return c.json({ detail: err.message || "internal error" }, 500);
  });

  app.get("/api/health", (c) => c.json({
    ok: true,
    name: "灵工",
    ui: "agent-v1",
    codex_mode: codexMode(),
    codex_bin_ok: codexBinOk(),
    codex_stub_allowed: isTestRuntime(),
  }));
  app.route("/api", authRouter);
  app.route("/api", examRouter);
  app.route("/api", enterprise);
  app.route("/api", skillRuntimeRouter);
  app.route("/api", runtimeDiscoveryRouter);
  app.route("/api", connectorOperationsRouter);
  app.route("/api", connectorCredentialsRouter);
  app.route("/api", host);
  app.route("/api", pipeline);
  app.route("/api", approvals);
  app.route("/api", knowledge);
  app.route("/api", experts);
  app.route("/api", discovery);
  app.route("/api", homeDiscovery);
  app.route("/api", cron);
  app.route("/api", kolMemory);
  app.route("/api", mail);
  app.route("/api", homeToday);
  app.route("/api", misc);
  app.route("/api", tasks);
  app.route("/api", crawlRouter);
  app.route("/mock/starry", starryRouter);
  if (codexMode() === "stub" || clawMode() === "mock") app.route("/mock/claw", clawRouter);

  const dist = frontendDist();
  if (fs.existsSync(dist)) {
    // 带扩展名的静态资源不做 SPA 回退：新构建会换掉 assets 里的 hash 文件名，旧标签页请求的是
    // 已删除的文件；回 index.html（text/html）会让浏览器按 MIME 拒绝执行，动态 import 永远
    // pending（前端已有 vite:preloadError 自愈，见 frontend/src/main.tsx）。这里给准确的 404。
    const STATIC_EXT = new Set([
      ".js", ".mjs", ".css", ".map", ".json", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
      ".ico", ".woff", ".woff2", ".ttf", ".wasm", ".txt",
    ]);
    const distRoot = path.resolve(dist);
    app.get("*", async (c) => {
      const url = new URL(c.req.url);
      const full = url.pathname.replace(/^\/+/, "");
      if (full.startsWith("api/") || full.startsWith("mock/")) {
        return c.json({ detail: "not found" }, 404);
      }
      const resolved = full ? path.resolve(distRoot, full) : "";
      const insideDist = resolved.startsWith(distRoot + path.sep);
      if (full && insideDist && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return serveFile(c, resolved);
      }
      const isAsset = full.startsWith("assets/") || STATIC_EXT.has(path.extname(full).toLowerCase());
      if (isAsset) return c.json({ detail: "not found" }, 404);
      return serveFile(c, path.join(dist, "index.html"));
    });
  }

  return app;
}

function serveFile(
  c: { header: (k: string, v: string) => void; body: (b: Uint8Array) => Response },
  file: string,
) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
    ".woff2": "font/woff2",
  };
  c.header("Content-Type", types[ext] || "application/octet-stream");
  if (ext === ".html") c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  return c.body(buf);
}
