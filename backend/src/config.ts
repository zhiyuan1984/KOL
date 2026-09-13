import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Dify「应用后端」= Host 进程根目录（本包）。 */
export const BACKEND_ROOT = path.resolve(here, "..");
export const SERVER_ROOT = BACKEND_ROOT;
export const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");

// Keep direct `tsx src/index.ts` launches consistent with scripts/start.sh.
// Existing environment variables take precedence over local, uncommitted .env values.
const envFile = process.env.LINGONG_ENV_FILE || path.join(REPO_ROOT, ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(envFile);

export function parseMediaCrawlerConfigMarkdown(markdown: string): {
  url?: string;
  token?: string;
} {
  const url = markdown.match(/https?:\/\/[^\s`"'<>]+\/mcp\b/i)?.[0];
  const token = usableSecret(markdown.match(/Authorization:\s*Bearer\s+([^\s`"'<>]+)/i)?.[1]);
  return {
    ...(url ? { url } : {}),
    ...(token ? { token } : {}),
  };
}

function usableSecret(value?: string): string | undefined {
  const token = value?.trim();
  if (!token || /^<[^>]+>$/.test(token) || /your-|changeme|example|placeholder/i.test(token)) return undefined;
  return token;
}

function jsonObject(text: string): Record<string, unknown> | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fence?.[1] || text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function bearerToken(value: unknown): string | undefined {
  const match = /^(?:Bearer\s+)?(\S+)/i.exec(String(value || "").trim());
  return usableSecret(match?.[1]);
}

function headerSecret(headers: Record<string, unknown>): string | undefined {
  return bearerToken(headers.Authorization ?? headers.authorization)
    || usableSecret(String(headers["X-MCP-API-KEY"] || headers["x-mcp-api-key"] || headers["Api-Key"] || ""));
}

function serverCredential(server: Record<string, unknown>): { url?: string; token?: string } {
  const url = String(server.url || server.serverUrl || "").trim();
  const headers = server.headers && typeof server.headers === "object" && !Array.isArray(server.headers)
    ? server.headers as Record<string, unknown>
    : {};
  const token = headerSecret(headers)
    || bearerToken(server.bearer_token || server.token || server.apiKey);
  return {
    ...(url ? { url } : {}),
    ...(token ? { token } : {}),
  };
}

/** Cursor mcp.json / mcpServers.kol-claw streamable HTTP 配置。 */
export function parseKolClawMcpConfig(text: string): { url?: string; token?: string } {
  const obj = jsonObject(text);
  if (obj) {
    const servers = obj.mcpServers && typeof obj.mcpServers === "object" && !Array.isArray(obj.mcpServers)
      ? obj.mcpServers as Record<string, unknown>
      : (obj.url || obj.type ? { "kol-claw": obj } : {});
    const entries = Object.entries(servers).filter(([, value]) => value && typeof value === "object" && !Array.isArray(value));
    const chosen = entries.find(([name]) => /kol[-_]?claw/i.test(name))
      || entries.find(([, value]) => /kol[-_]?claw|:9093\b/i.test(String((value as Record<string, unknown>).url || "")));
    if (chosen) return serverCredential(chosen[1] as Record<string, unknown>);
  }
  return parseMediaCrawlerConfigMarkdown(text);
}

function mediaCrawlerMarkdownCandidates(): string[] {
  const explicit = process.env.MEDIACRAWLER_MCP_CONFIG_FILE?.trim();
  const rootFile = path.join(REPO_ROOT, "mcp_server.md");
  const cursorUploads = path.join(
    os.homedir(),
    ".cursor",
    "projects",
    path.basename(REPO_ROOT),
    "uploads",
  );
  const uploaded = fs.existsSync(cursorUploads)
    ? fs.readdirSync(cursorUploads)
      .filter((name) => /^mcp_server.*\.md$/i.test(name))
      .map((name) => path.join(cursorUploads, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  return [explicit, rootFile, ...uploaded].filter((value): value is string => Boolean(value));
}

if (!process.env.MEDIACRAWLER_MCP_URL?.trim() || !process.env.MEDIACRAWLER_MCP_TOKEN?.trim()) {
  for (const candidate of mediaCrawlerMarkdownCandidates()) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    const parsed = parseMediaCrawlerConfigMarkdown(fs.readFileSync(candidate, "utf8"));
    if (!process.env.MEDIACRAWLER_MCP_URL?.trim() && parsed.url) process.env.MEDIACRAWLER_MCP_URL = parsed.url;
    if (!process.env.MEDIACRAWLER_MCP_TOKEN?.trim() && parsed.token) process.env.MEDIACRAWLER_MCP_TOKEN = parsed.token;
    if (process.env.MEDIACRAWLER_MCP_URL?.trim() && process.env.MEDIACRAWLER_MCP_TOKEN?.trim()) break;
  }
}

function kolClawConfigCandidates(): string[] {
  const explicit = process.env.KOLCLAW_MCP_CONFIG_FILE?.trim();
  const rootFiles = ["mcp_kolclaw.json", "kol-claw.json", "mcp.json"].map((name) => path.join(REPO_ROOT, name));
  const cursorUploads = path.join(
    os.homedir(),
    ".cursor",
    "projects",
    path.basename(REPO_ROOT),
    "uploads",
  );
  const uploaded = fs.existsSync(cursorUploads)
    ? fs.readdirSync(cursorUploads)
      .filter((name) => /(kol[-_]?claw|kolclaw|kol_anlay_mcp|mcp_kolclaw).*\.(json|md)$/i.test(name))
      .map((name) => path.join(cursorUploads, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  return [explicit, ...rootFiles, ...uploaded].filter((value): value is string => Boolean(value));
}

if (!process.env.KOLCLAW_MCP_URL?.trim() || !process.env.KOLCLAW_MCP_TOKEN?.trim()) {
  for (const candidate of kolClawConfigCandidates()) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    const parsed = parseKolClawMcpConfig(fs.readFileSync(candidate, "utf8"));
    if (!process.env.KOLCLAW_MCP_URL?.trim() && parsed.url) process.env.KOLCLAW_MCP_URL = parsed.url;
    if (!process.env.KOLCLAW_MCP_TOKEN?.trim() && parsed.token) process.env.KOLCLAW_MCP_TOKEN = parsed.token;
    if (process.env.KOLCLAW_MCP_URL?.trim() && process.env.KOLCLAW_MCP_TOKEN?.trim()) break;
  }
}

export function dataDir(): string {
  return process.env.LINGONG_DATA || path.join(REPO_ROOT, "data");
}

export function dbPath(): string {
  return process.env.LINGONG_DB || path.join(dataDir(), "lingong.db");
}

export function boxDir(): string {
  return path.join(dataDir(), "boxes");
}

/** Dify Chatflow 应用 → 每个 routed intent 一份 SKILL.md */
export function skillsDir(): string {
  return path.join(BACKEND_ROOT, "skills");
}

/** Admin-published skills live outside the git bundle so they can take effect without a restart. */
export function publishedSkillsDir(): string {
  const root = path.join(dataDir(), "published-skills");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Dify 工具节点 → MCP（Starry / Claw 只读）。写操作走 Gateway。 */
export function mcpDir(): string {
  return path.join(BACKEND_ROOT, "mcp");
}

export function frontendDist(): string {
  return path.join(REPO_ROOT, "frontend", "dist");
}

export function starryMode(): string {
  return process.env.STARRY_MODE || "mock";
}

export function clawMode(): string {
  return (process.env.CLAW_MODE || (codexMode() === "stub" ? "mock" : "remote")).toLowerCase();
}

export function starryBaseUrl(): string {
  return process.env.STARRY_BASE_URL || "http://127.0.0.1:8765/mock/starry";
}

export function clawBaseUrl(): string {
  return process.env.CLAW_BASE_URL || "http://127.0.0.1:8765/mock/claw";
}

export function clawApiKey(): string {
  return process.env.CLAW_API_KEY || "demo-claw-key";
}

export function mediaCrawlerMcpUrl(): string {
  const value = process.env.MEDIACRAWLER_MCP_URL?.trim();
  if (!value) throw new Error("MEDIACRAWLER_MCP_URL is required for remote Claw MCP");
  return value;
}

export function mediaCrawlerConfigured(): boolean {
  return Boolean(process.env.MEDIACRAWLER_MCP_URL?.trim() && process.env.MEDIACRAWLER_MCP_TOKEN?.trim());
}

export function kolClawMcpUrl(): string {
  const value = process.env.KOLCLAW_MCP_URL?.trim();
  if (!value) throw new Error("KOLCLAW_MCP_URL is required");
  return value;
}

export function kolClawMcpToken(): string {
  const value = process.env.KOLCLAW_MCP_TOKEN?.trim();
  if (!value) throw new Error("KOLCLAW_MCP_TOKEN is required");
  return value;
}

export type StarryKolMcpConfig = {
  url?: string;
  apiKey?: string;
  bearer?: string;
  /** Same as apiKey. Kept so existing callers/tests still read `token`. */
  token?: string;
};

function starryKolServerCredential(server: Record<string, unknown>): StarryKolMcpConfig {
  const url = String(server.url || server.serverUrl || "").trim();
  const headers = server.headers && typeof server.headers === "object" && !Array.isArray(server.headers)
    ? server.headers as Record<string, unknown>
    : {};
  const apiKey = usableSecret(String(headers["X-MCP-API-KEY"] || headers["x-mcp-api-key"] || headers["Api-Key"] || ""));
  const bearer = bearerToken(headers.Authorization ?? headers.authorization)
    || bearerToken(server.bearer_token || server.bearer);
  return {
    ...(url ? { url } : {}),
    ...(apiKey ? { apiKey, token: apiKey } : {}),
    ...(bearer ? { bearer } : {}),
  };
}

/** Cursor mcp.json / mcpServers.starry-kol-mcp（兼容 email-mcp）streamable HTTP 配置。 */
export function parseStarryKolMcpConfig(text: string): StarryKolMcpConfig {
  const obj = jsonObject(text);
  if (obj) {
    const servers = obj.mcpServers && typeof obj.mcpServers === "object" && !Array.isArray(obj.mcpServers)
      ? obj.mcpServers as Record<string, unknown>
      : (obj.url || obj.type ? { "starry-kol-mcp": obj } : {});
    const entries = Object.entries(servers).filter(([, value]) => value && typeof value === "object" && !Array.isArray(value));
    const chosen = entries.find(([name]) => /starry[-_]?kol[-_]?mcp/i.test(name))
      || entries.find(([name]) => /email[-_]?(mcp|agent)/i.test(name))
      || entries.find(([, value]) => /starry[-_]?kol|email[-_]?(mcp|agent)|askstarry|:9091\b/i.test(String((value as Record<string, unknown>).url || "")));
    if (chosen) return starryKolServerCredential(chosen[1] as Record<string, unknown>);
  }
  const url = text.match(/https?:\/\/[^\s`"'<>]+\/mcp\b/i)?.[0];
  const apiKey = usableSecret(text.match(/X-MCP-API-KEY:\s*([^\s`"'<>]+)/i)?.[1]);
  const bearer = usableSecret(text.match(/Authorization:\s*Bearer\s+([^\s`"'<>]+)/i)?.[1]);
  return {
    ...(url ? { url } : {}),
    ...(apiKey ? { apiKey, token: apiKey } : {}),
    ...(bearer ? { bearer } : {}),
  };
}
export const parseEmailMcpConfig = parseStarryKolMcpConfig;

function starryKolMcpConfigCandidates(): string[] {
  const explicit = process.env.STARRY_KOL_MCP_CONFIG_FILE?.trim() || process.env.EMAIL_MCP_CONFIG_FILE?.trim();
  const rootFiles = [
    "mcp_starry_kol.json",
    "starry-kol-mcp.json",
    "mcp_email.json",
    "email-mcp.json",
    "mcp.json",
  ].map((name) => path.join(REPO_ROOT, name));
  const cursorUploads = path.join(
    os.homedir(),
    ".cursor",
    "projects",
    path.basename(REPO_ROOT),
    "uploads",
  );
  const uploaded = fs.existsSync(cursorUploads)
    ? fs.readdirSync(cursorUploads)
      .filter((name) => /(starry[-_]?kol|email[-_]?(mcp|agent)|mcp_email|mcp_starry).*\.(json|md)$/i.test(name))
      .map((name) => path.join(cursorUploads, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  return [explicit, ...rootFiles, ...uploaded].filter((value): value is string => Boolean(value));
}

for (const candidate of starryKolMcpConfigCandidates()) {
  if (starryKolMcpUrlValue() && starryKolMcpKeyValue() && starryKolMcpBearerValue()) break;
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
  const parsed = parseStarryKolMcpConfig(fs.readFileSync(candidate, "utf8"));
  if (!starryKolMcpUrlValue() && parsed.url) {
    process.env.STARRY_KOL_MCP_URL = parsed.url;
    process.env.EMAIL_MCP_URL = process.env.EMAIL_MCP_URL || parsed.url;
  }
  if (!starryKolMcpKeyValue() && parsed.apiKey) {
    process.env.STARRY_KOL_MCP_API_KEY = parsed.apiKey;
    process.env.EMAIL_MCP_API_KEY = process.env.EMAIL_MCP_API_KEY || parsed.apiKey;
  }
  if (!starryKolMcpBearerValue() && parsed.bearer) {
    process.env.STARRY_KOL_MCP_BEARER = parsed.bearer;
    process.env.EMAIL_MCP_BEARER = process.env.EMAIL_MCP_BEARER || parsed.bearer;
  }
}

function starryKolMcpUrlValue(): string {
  const explicit = (
    process.env.STARRY_KOL_MCP_URL
    || process.env.EMAIL_MCP_URL
    || process.env.STARRY_URL
    || ""
  ).trim();
  if (explicit) return explicit;
  return starryKolMcpKeyValue() ? "https://dev-api.askstarry.com/starry/email-agent/mcp" : "";
}

function starryKolMcpKeyValue(): string {
  return (
    process.env.STARRY_KOL_MCP_API_KEY
    || process.env.EMAIL_MCP_API_KEY
    || process.env.STARRY_API_KEY
    || ""
  ).trim();
}

function starryKolMcpBearerValue(): string {
  return bearerToken(
    process.env.STARRY_KOL_MCP_BEARER
    || process.env.STARRY_KOL_MCP_AUTHORIZATION
    || process.env.EMAIL_MCP_BEARER
    || process.env.EMAIL_MCP_AUTHORIZATION
    || process.env.STARRY_JWT
    || process.env.STARRY_BEARER
    || "",
  ) || "";
}

export function kolClawConfigured(): boolean {
  return Boolean(process.env.KOLCLAW_MCP_URL?.trim() && process.env.KOLCLAW_MCP_TOKEN?.trim());
}

export function starryKolMcpUrl(): string {
  const value = starryKolMcpUrlValue();
  if (!value) throw new Error("STARRY_KOL_MCP_URL is required");
  return value;
}

export function starryKolMcpApiKey(): string {
  const value = starryKolMcpKeyValue();
  if (!value) throw new Error("STARRY_KOL_MCP_API_KEY is required");
  return value;
}

export function starryKolMcpBearer(): string {
  return starryKolMcpBearerValue();
}

/** Headers Host sends to Starry KOL MCP. API Key opens tools; Bearer is the Starry user. */
export function starryKolMcpHeaders(bearerOverride?: string): Record<string, string> {
  const headers: Record<string, string> = { "X-MCP-API-KEY": starryKolMcpApiKey() };
  const bearer = bearerToken(bearerOverride || "") || starryKolMcpBearerValue();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

export function starryKolMcpConfigured(): boolean {
  return Boolean(starryKolMcpUrlValue() && starryKolMcpKeyValue());
}

export const emailMcpUrl = starryKolMcpUrl;
export const emailMcpApiKey = starryKolMcpApiKey;
export const emailMcpConfigured = starryKolMcpConfigured;

export function codexMode(): string {
  return (process.env.CODEX_MODE || "real").toLowerCase();
}

/** Explicit allowlist gate for irreversible live MCP writes during controlled acceptance tests. */
export function liveRemoteSideEffectsEnabled(): boolean {
  return process.env.LIVE_REMOTE_SIDE_EFFECTS === "1";
}

export function liveTestRecipientAllowed(email: string): boolean {
  const allowed = (process.env.LIVE_TEST_RECIPIENTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(email.trim().toLowerCase());
}

export function liveTestKolAllowed(kolUid: string): boolean {
  const allowed = (process.env.LIVE_TEST_KOL_UIDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(kolUid.trim());
}

export function codexBin(): string {
  return process.env.CODEX_BIN || "codex";
}

export function hostWorkerTimeout(): number {
  const n = Number(process.env.HOST_WORKER_TIMEOUT || process.env.CODEX_TURN_TIMEOUT || "120");
  return Number.isFinite(n) && n > 0 ? n : 120;
}

/** Thin task-recognition turn. Keep far below worker timeout. */
export function taskRecognizeTimeout(): number {
  const n = Number(process.env.TASK_RECOGNIZE_TIMEOUT || "12");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 30) : 12;
}

/** Codex/Luna turn for session mail-body analysis. Longer than recognize. */
export function mailAnalysisTimeout(): number {
  const n = Number(process.env.MAIL_ANALYSIS_TIMEOUT || "45");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 45;
}

/** After analysis_failed, wait this long before auto-retrying remote digest. */
export function mailDigestFailRetryMs(): number {
  const n = Number(process.env.MAIL_DIGEST_FAIL_RETRY_MS || String(5 * 60 * 1000));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 24 * 60 * 60 * 1000) : 5 * 60 * 1000;
}

export function codexTurnTimeout(): number {
  return hostWorkerTimeout();
}

export const BRAND_MAILBOXES: Record<string, string> = {
  LT: "kol.lt@litime.example",
  RO: "kol.ro@renogy.example",
  PQ: "kol.pq@powerqueen.example",
};

export type Persona = {
  id: string;
  name: string;
  handle: string;
  site: string;
  role: string;
  exam_passed: boolean;
  brands: string[];
  exam_module: string;
};

export const PERSONAS: Record<string, Persona> = {
  sriphy: {
    id: "usr_sriphy",
    name: "鄢棽",
    handle: "sriphy",
    site: "深圳站",
    role: "operator",
    exam_passed: true,
    brands: ["LT", "RO", "PQ"],
    exam_module: "数据安全与最小权限",
  },
  exam_blocked: {
    id: "usr_sriphy",
    name: "鄢棽",
    handle: "sriphy",
    site: "深圳站",
    role: "operator",
    exam_passed: false,
    brands: ["LT", "RO", "PQ"],
    exam_module: "数据安全与最小权限",
  },
  permission_blocked: {
    id: "usr_sriphy",
    name: "鄢棽",
    handle: "sriphy",
    site: "深圳站",
    role: "operator",
    exam_passed: true,
    brands: [],
    exam_module: "数据安全与最小权限",
  },
  employee: {
    id: "usr_lingong",
    name: "林工",
    handle: "lingong",
    site: "深圳站",
    role: "employee",
    exam_passed: true,
    brands: ["LT", "RO", "PQ"],
    exam_module: "数据安全与最小权限",
  },
};

export const DEMO_USER = PERSONAS.sriphy;

/** Product-manager / first admin. Handle stays sriphy; email and phone are login aliases. */
export const DEMO_ADMIN = {
  name: "鄢棽",
  handle: "sriphy",
  email: "sriphy.yan@amperetime.com",
  phone: (process.env.DEMO_ADMIN_PHONE || "").trim(),
  password: "123456789",
  role: "product_manager" as const,
};

export const PLATFORM_EXAMPLE_TITLES = ["加班申请", "华北渠道"] as const;

export const CONTENT_STAGES = new Set([
  "CONTENT_PLANNING",
  "CONTENT_REVIEW",
  "PUBLISH_PENDING",
  "PUBLISHED",
]);
