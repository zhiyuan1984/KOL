/**
 * Codex app-server 是唯一模型 Worker。
 * stdio JSONL，省略 jsonrpc:2.0（MCP 线才带 2.0）。
 * 缺 codex / 未登录 / 无 OPENAI_API_KEY → CodexUnavailable，永不假信。
 * 有 key 时先 account/login/start，不把「后台已有 Codex」当成已登录。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CodexUnavailable } from "./errors.js";
import type { Json } from "../types.js";
import {
  codexChildEnv,
  inspectLocalCodexAuth,
  redactSecrets,
  resolveAuthState,
} from "./auth.js";

const CLIENT_INFO = { name: "lingong_kol", title: "灵工 KOL", version: "0.1.0" };

export function findCodex(): string {
  const override = process.env.CODEX_BIN;
  if (override) {
    try {
      fs.accessSync(override, fs.constants.X_OK);
      if (fs.statSync(override).isFile()) return override;
    } catch {
      throw new CodexUnavailable(
        `CODEX_BIN=${override} 不可执行。未起箱、未合成邮件。`,
        "安装 Codex CLI：npm i -g @openai/codex，然后 `codex login` 或设置 OPENAI_API_KEY。",
      );
    }
  }
  const pathEnv = process.env.PATH || "";
  const names = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  for (const dir of pathEnv.split(path.delimiter)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* next candidate */
      }
    }
  }
  throw new CodexUnavailable(
    "本机 PATH 上没有 `codex`。默认 Worker 必须走真实 app-server，不会用模板假信。",
    "先安装：npm i -g @openai/codex 或按官方文档安装，再执行 `codex login`（或设置 OPENAI_API_KEY），然后重试「写跟进信」。",
  );
}

export class CodexAppServer {
  timeout: number;
  private deadlineMs: number;
  bin: string;
  proc: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  notifications: Json[] = [];
  agentTexts: string[] = [];
  onNotification?: (method: string | undefined, params: Json) => void;
  authVia: "account" | "api_key_login" | "no_openai_required" | null = null;
  stderr = "";
  private dead = false;

  constructor(timeout = 180) {
    this.timeout = timeout;
    // One budget for handshake + auth + turn/start + waitTurn. Per-RPC
    // timeouts used to stack (account/read 20s × N + turn 120s) and left
    // home compose stuck on “recognizing” or the worker past E2E limits.
    this.deadlineMs = Date.now() + timeout * 1000;
    this.bin = findCodex();
    // Windows cannot execute a .mjs/.cjs fixture via its shebang directly.
    // Keep CODEX_BIN semantics unchanged in production while making the
    // repository's app-server fixtures portable across CI runners.
    const command = process.platform === "win32" && /\.(?:mjs|cjs|js)$/i.test(this.bin)
      ? process.execPath
      : this.bin;
    const args = command === process.execPath ? [this.bin, "app-server"] : ["app-server"];
    this.proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: codexChildEnv(),
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    let buf = "";
    this.proc.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) this.onLine(line);
      }
    });
    this.proc.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-8000);
    });
    if (this.proc.exitCode != null) {
      throw new CodexUnavailable("codex app-server 立刻退出。未合成邮件。", "检查 `codex --version` 与 `codex login`。");
    }
  }

  private onLine(line: string): void {
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      return;
    }
    if (msg.id != null && msg.method && msg.result === undefined && msg.error === undefined) {
      this.answerServerRequest(msg);
      return;
    }
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(Number(msg.id));
      if (p) {
        this.pending.delete(Number(msg.id));
        p.resolve(msg);
      }
      return;
    }
    this.notifications.push(msg);
    const method = msg.method as string | undefined;
    const params = (msg.params as Json) || {};
    this.collectAgent(method, params);
    this.onNotification?.(method, params);
  }

  private collectAgent(method: string | undefined, params: Json): void {
    if (method !== "item/completed" && method !== "item/started") return;
    const item = (params.item as Json) || params;
    if (item.type === "agentMessage" || item.itemType === "agentMessage") {
      let text = String(item.text || "");
      if (!text && Array.isArray(item.content)) {
        text = (item.content as Json[])
          .map((c) => (typeof c === "object" ? String(c.text || "") : ""))
          .join("");
      }
      if (text) this.agentTexts.push(text);
    }
  }

  private answerServerRequest(msg: Json): void {
    this.write({ id: msg.id, result: { decision: "accept" } });
  }

  private write(obj: Json): void {
    if (!this.proc.stdin.writable) {
      throw new CodexUnavailable("app-server stdin 已关。", "重启会话后重试。");
    }
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  remainingMs(requestedSec?: number): number {
    const requested = (requestedSec ?? this.timeout) * 1000;
    return Math.min(requested, this.deadlineMs - Date.now());
  }

  async request(method: string, params: Json = {}, timeout?: number): Promise<Json> {
    this.nextId += 1;
    const rid = this.nextId;
    this.write({ method, id: rid, params });
    const waitMs = this.remainingMs(timeout);
    if (waitMs <= 50) {
      throw new CodexUnavailable(`等待 Codex \`${method}\` 超时。未合成邮件。`, "检查网络与 Codex 登录后重试。");
    }
    const msg = await new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new CodexUnavailable(`等待 Codex \`${method}\` 超时。未合成邮件。`, "检查网络与 Codex 登录后重试。"));
      }, waitMs);
      this.pending.set(rid, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.proc.once("exit", () => {
        if (this.pending.has(rid)) {
          this.pending.delete(rid);
          clearTimeout(timer);
          reject(
            new CodexUnavailable("codex app-server 在等待响应时退出。未合成邮件。", "确认已 `codex login` 或设置 OPENAI_API_KEY。"),
          );
        }
      });
    });
    if (msg.error) {
      const err = msg.error as Json;
      const text = typeof err === "object" ? String(err.message || err) : String(err);
      throw new CodexUnavailable(`Codex \`${method}\` 失败：${text}`, "检查登录与技能路径后重试。");
    }
    return (msg.result as Json) || {};
  }

  notify(method: string, params: Json = {}): void {
    this.write({ method, params });
  }

  /** Commander 派生子 Thread；仍复用当前 app-server harness 和鉴权连接。 */
  async deriveChildThread(threadId: string): Promise<Json> {
    return this.request("thread/fork", { threadId });
  }

  async waitTurn(timeout?: number): Promise<Json> {
    const deadline = Date.now() + Math.max(0, this.remainingMs(timeout));
    while (Date.now() < deadline) {
      for (const n of this.notifications) {
        if (n.method === "turn/completed") return (n.params as Json) || {};
      }
      if (this.proc.exitCode != null) {
        throw new CodexUnavailable("app-server 在 turn 完成前退出。未合成邮件。", "重试或检查 `codex login`。");
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new CodexUnavailable("等待 turn/completed 超时。未合成邮件。", "重试一次；模型较慢时可加大 CODEX_TURN_TIMEOUT。");
  }

  async handshake(): Promise<Json> {
    const result = await this.request(
      "initialize",
      {
        clientInfo: CLIENT_INFO,
        capabilities: { experimentalApi: false },
      },
      Math.min(this.timeout, 15),
    );
    this.notify("initialized", {});
    return result;
  }

  private async waitForAccountNotice(ms: number): Promise<Json | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      for (const n of this.notifications) {
        if (n.method === "account/updated") return (n.params as Json) || {};
      }
      if (this.proc.exitCode != null) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  async requireAuth(): Promise<Json> {
    const local = inspectLocalCodexAuth();
    const authSec = Math.min(20, Math.max(1, this.remainingMs() / 1000));
    // 已登录时立即返回；只有首读为空才等 account/updated，避免每轮固定空等。
    let acct = await this.request("account/read", { refreshToken: false }, authSec);
    let state = resolveAuthState(acct, process.env, local);
    if (!this.isUsable(acct) && state.action !== "login_api_key") {
      await this.waitForAccountNotice(Math.min(800, Math.max(0, this.remainingMs())));
      acct = await this.request("account/read", { refreshToken: false }, authSec);
      state = resolveAuthState(acct, process.env, local);
    }
    if (!this.isUsable(acct) && local.hasAuthFile) {
      try {
        acct = await this.request("account/read", { refreshToken: true }, authSec);
        state = resolveAuthState(acct, process.env, local);
      } catch {
        /* 文件登录仍可继续起箱 */
      }
    }
    if (state.action === "login_api_key") {
      await this.request("account/login/start", { type: "apiKey", apiKey: state.apiKey }, authSec);
      this.authVia = "api_key_login";
      acct = await this.request("account/read", { refreshToken: false }, authSec);
      return acct;
    }
    if (state.action === "ok") {
      this.authVia = state.via;
      return acct;
    }
    const hint = this.authHint(local, acct);
    throw new CodexUnavailable(
      "Codex 未登录（account/read 无账号）。未起箱写假信。",
      hint,
    );
  }

  private isUsable(acct: Json): boolean {
    const a = acct.account;
    return Boolean(a && typeof a === "object" && typeof (a as Json).type === "string");
  }

  private authHint(local: ReturnType<typeof inspectLocalCodexAuth>, acct: Json): string {
    const keySet = Boolean((process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || "").trim());
    const err = redactSecrets(this.stderr.trim().split("\n").slice(-6).join(" / "));
    return [
      "Host 不会复用后台已开的 Codex 窗口，每次新起 app-server。",
      `account=${acct.account == null ? "null" : "set"} requiresOpenaiAuth=${String(acct.requiresOpenaiAuth)}`,
      `auth.json=${local.hasAuthFile ? "yes" : "no"} env_key=${keySet ? "yes" : "no"}`,
      err ? `codex: ${err}` : "在同一用户执行 `codex login`，或把 OPENAI_API_KEY 写入 .env 后重启 ./scripts/start.sh。",
    ].join(" ");
  }

  close(): void {
    if (this.dead) return;
    this.dead = true;
    const stopped = new CodexUnavailable(
      "Codex 任务已停止，未合成邮件。",
      "检查登录状态后重试。",
    );
    for (const pending of this.pending.values()) pending.reject(stopped);
    this.pending.clear();
    try {
      if (this.proc.exitCode == null) {
        this.proc.kill("SIGTERM");
        setTimeout(() => {
          if (this.proc.exitCode == null) this.proc.kill("SIGKILL");
        }, 3000);
      }
    } catch {
      /* ignore */
    }
  }
}
