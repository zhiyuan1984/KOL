/**
 * Codex app-server 登录判定。
 * account/read 的 account=null 只表示「这个新起的进程还没挂上账号」，
 * 不等于本机没有 `codex login`。ChatGPT 登录在 ~/.codex 或系统钥匙串里，
 * 子进程必须继承本机环境才能读到。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import type { Json } from "../types.js";

export type AuthAction =
  | { action: "ok"; via: "account" | "no_openai_required" }
  | { action: "login_api_key"; apiKey: string }
  | { action: "unavailable"; message: string; next_action: string };

export type LocalCodexAuth = {
  home: string;
  authPath: string;
  hasAuthFile: boolean;
  hasApiKey: boolean;
  hasTokens: boolean;
  apiKey: string;
};

const STRIP_PREFIXES = ["SMTP", "WECOM", "STARRY", "CLAW", "LINGONG", "MES", "WMS"];

export function envApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OPENAI_API_KEY || env.CODEX_API_KEY || "").trim();
}

export function isUsableAccount(account: unknown): boolean {
  if (account == null || typeof account !== "object") return false;
  const type = (account as Json).type;
  return typeof type === "string" && type.length > 0;
}

export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODEX_HOME && env.CODEX_HOME.trim()) return env.CODEX_HOME.trim();
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(home, ".codex");
}

/** 只看有没有登录痕迹，不把 token 打进日志。 */
export function inspectLocalCodexAuth(env: NodeJS.ProcessEnv = process.env): LocalCodexAuth {
  const home = codexHome(env);
  const authPath = path.join(home, "auth.json");
  const out: LocalCodexAuth = {
    home,
    authPath,
    hasAuthFile: false,
    hasApiKey: false,
    hasTokens: false,
    apiKey: "",
  };
  try {
    if (!fs.existsSync(authPath) || !fs.statSync(authPath).isFile()) return out;
    out.hasAuthFile = true;
    const raw = JSON.parse(fs.readFileSync(authPath, "utf8")) as Json;
    const key = firstString(raw.openai_api_key, raw.OPENAI_API_KEY, raw.api_key, raw.apiKey);
    if (key) {
      out.hasApiKey = true;
      out.apiKey = key;
    }
    const tokens = (raw.tokens && typeof raw.tokens === "object" ? (raw.tokens as Json) : raw) || {};
    if (
      firstString(
        tokens.access_token,
        tokens.accessToken,
        tokens.id_token,
        tokens.idToken,
        tokens.refresh_token,
        tokens.refreshToken,
      )
    ) {
      out.hasTokens = true;
    }
  } catch {
    /* 坏文件当不存在，不把内容抛出去 */
  }
  return out;
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function resolveApiKey(env: NodeJS.ProcessEnv = process.env, local?: LocalCodexAuth): string {
  return envApiKey(env) || (local || inspectLocalCodexAuth(env)).apiKey;
}

export function resolveAuthState(
  acct: Json,
  env: NodeJS.ProcessEnv = process.env,
  local?: LocalCodexAuth,
): AuthAction {
  const account = acct.account;
  const requires = acct.requiresOpenaiAuth;
  const store = local || inspectLocalCodexAuth(env);
  if (isUsableAccount(account)) {
    return { action: "ok", via: "account" };
  }
  if (requires === false) {
    return { action: "ok", via: "no_openai_required" };
  }
  const apiKey = resolveApiKey(env, store);
  if (apiKey) {
    return { action: "login_api_key", apiKey };
  }
  return {
    action: "unavailable",
    message: "Codex 未登录（account/read 无账号）。未起箱写假信。",
    next_action:
      "Host 每次新起 app-server，不会复用你后台那个 Codex 窗口。请在同一用户下执行 `codex login`，或把 OPENAI_API_KEY 写进仓库根目录 .env 后重启 `./scripts/start.sh`。",
  };
}

/**
 * 继承本机环境（钥匙串 / ~/.codex 需要），只剥发信与阶段库 secret。
 * spawn({ env }) 会整表替换，白名单会把 ChatGPT 登录态弄丢。
 */
export function codexChildEnv(src: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(src)) {
    if (v == null) continue;
    if (STRIP_PREFIXES.some((p) => k === p || k.startsWith(`${p}_`))) continue;
    env[k] = v;
  }
  return env;
}

/** Model/auth settings survive run isolation; tools, hooks, plugins and trust do not. */
export function isolatedCodexModelConfig(source: string): string {
  const parsed = parse(source);
  const allowed = ["model", "model_provider", "model_providers", "model_reasoning_effort", "model_verbosity",
    "service_tier", "cli_auth_credentials_store", "forced_login_method", "forced_chatgpt_workspace_id"];
  const safe: Record<string, unknown> = {};
  for (const key of allowed) if (parsed[key] !== undefined) safe[key] = parsed[key];
  const profile = typeof parsed.profile === "string" ? parsed.profile : "";
  const profiles = parsed.profiles;
  if (profile && profiles && typeof profiles === "object" && !Array.isArray(profiles)) {
    const active = (profiles as Record<string, unknown>)[profile];
    if (active && typeof active === "object" && !Array.isArray(active)) {
      for (const key of allowed) if ((active as Json)[key] !== undefined) safe[key] = (active as Json)[key];
    }
  }
  return stringify(safe);
}

export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1***")
    .replace(/("(?:access_token|refresh_token|id_token|api_key|apiKey|openai_api_key)"\s*:\s*")[^"]+/gi, "$1***");
}
