import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { frontendDist } from "./config.js";
import { HttpFail } from "./host/errors.js";
import { postgresPool, requiredPostgresUrl } from "./postgres/pool.js";
import { cron } from "./routers/cron.js";
import { tickets } from "./routers/tickets.js";
import { pgEnsureSystemCronJobs } from "./cron/postgres-store.js";

/**
 * The PostgreSQL-only HTTP surface has no browser identity of its own. Formal
 * routes are deliberately unavailable until the established workbench identity
 * provider is migrated behind a single shared authentication boundary. This is
 * safer than recreating a ticket username/password page or trusting a header.
 */
export async function bootstrapPostgresOnlyRuntime(): Promise<void> {
  requiredPostgresUrl();
  const tables = await postgresPool().query<{ name: string | null }>(
    `SELECT unnest(ARRAY[
      to_regclass('public.tickets')::text,
      to_regclass('public.ticket_accounts')::text,
      to_regclass('public.workbench_principal_bindings')::text,
      to_regclass('public.cron_jobs')::text,
      to_regclass('public.execution_jobs')::text,
      to_regclass('public.execution_outbox')::text
    ]) AS name`,
  );
  if (tables.rows.some((row) => !row.name)) {
    throw new Error("PostgreSQL formal ticket schema is not initialized; run npm run db:apply:postgres-schema before KOL_RUNTIME_MODE=postgres-only");
  }
  await pgEnsureSystemCronJobs();
}

export function createPostgresOnlyApp(): Hono {
  requiredPostgresUrl();
  const app = new Hono();
  const configuredOrigin = process.env.APP_ORIGIN || process.env.CORS_ORIGIN;
  const corsOrigin = process.env.NODE_ENV === "production"
    ? (origin: string) => configuredOrigin && origin === configuredOrigin ? configuredOrigin : null
    : configuredOrigin || "*";
  app.use("*", cors({ origin: corsOrigin, credentials: Boolean(configuredOrigin) }));
  app.use("/api/*", compress());
  app.use("/api/*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname === "/api/health" || pathname === "/api/cron/internal/tick") return next();
    throw new HttpFail(503, {
      code: "workbench_identity_provider_required",
      message: "纯 PostgreSQL 运行模式尚未接入现有工作台登录；请使用兼容运行模式，不会提供独立工单登录",
    });
  });
  app.onError((error, c) => {
    if (error instanceof HttpFail) {
      return c.json({ detail: error.detail }, error.status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503);
    }
    console.error(error);
    return c.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
  });
  app.get("/api/health", (c) => c.json({
    ok: true,
    name: "灵工",
    runtime_mode: "postgres-only",
    authority_store: "postgresql",
    legacy_routes: "retired",
    identity_mode: "workbench_provider_required",
  }));
  app.route("/api", tickets);
  app.route("/api", cron);

  mountStaticUi(app);
  return app;
}

function mountStaticUi(app: Hono): void {
  const dist = frontendDist();
  if (!fs.existsSync(dist)) return;
  const staticExtensions = new Set([
    ".js", ".mjs", ".css", ".map", ".json", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".ico", ".woff", ".woff2", ".ttf", ".wasm", ".txt",
  ]);
  const distRoot = path.resolve(dist);
  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    const full = url.pathname.replace(/^\/+/, "");
    if (full.startsWith("api/") || full.startsWith("mock/")) return c.json({ detail: "not found" }, 404);
    const resolved = full ? path.resolve(distRoot, full) : "";
    const insideDist = resolved.startsWith(distRoot + path.sep);
    if (full && insideDist && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return serveFile(c, resolved);
    if (full.startsWith("assets/") || staticExtensions.has(path.extname(full).toLowerCase())) return c.json({ detail: "not found" }, 404);
    return serveFile(c, path.join(dist, "index.html"));
  });
}

function serveFile(
  c: { header: (key: string, value: string) => void; body: (body: Uint8Array) => Response },
  file: string,
) {
  const buffer = fs.readFileSync(file);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
    ".woff2": "font/woff2",
  };
  const ext = path.extname(file);
  c.header("Content-Type", types[ext] || "application/octet-stream");
  if (ext === ".html") c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  return c.body(buffer);
}
