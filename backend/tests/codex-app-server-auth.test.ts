import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAppServer } from "../src/worker/codex.js";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");

const saved: Record<string, string | undefined> = {};
const keys = ["CODEX_BIN", "FAKE_CODEX_MODE", "HOME", "CODEX_HOME", "OPENAI_API_KEY", "CODEX_API_KEY"];

let rpc: CodexAppServer | null = null;
let tmp = "";

afterEach(() => {
  rpc?.close();
  rpc = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
    delete saved[k];
  }
});

function setEnv(k: string, v: string): void {
  if (!(k in saved)) saved[k] = process.env[k];
  process.env[k] = v;
}

function boot(mode: string, extraEnv: Record<string, string> = {}): CodexAppServer {
  fs.chmodSync(fake, 0o755);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-fake-codex-"));
  setEnv("CODEX_BIN", fake);
  setEnv("FAKE_CODEX_MODE", mode);
  setEnv("HOME", tmp);
  setEnv("CODEX_HOME", path.join(tmp, ".codex"));
  for (const [k, v] of Object.entries(extraEnv)) setEnv(k, v);
  fs.mkdirSync(process.env.CODEX_HOME || path.join(tmp, ".codex"), { recursive: true });
  rpc = new CodexAppServer(10);
  return rpc;
}

describe("CodexAppServer.requireAuth", () => {
  it("waits for late ChatGPT account/updated instead of failing immediately", async () => {
    const server = boot("late-chatgpt", { OPENAI_API_KEY: "", CODEX_API_KEY: "" });
    await server.handshake();
    const acct = await server.requireAuth();
    expect((acct.account as { type?: string } | null)?.type).toBe("chatgpt");
    expect(server.authVia).toBe("account");
  });

  it("logs in with OPENAI_API_KEY when account/read is empty", async () => {
    const server = boot("empty", { OPENAI_API_KEY: "sk-test-key" });
    await server.handshake();
    await server.requireAuth();
    expect(server.authVia).toBe("api_key_login");
  });

  it("fails fast when auth.json exists but app-server still reports no account", async () => {
    const server = boot("empty", { OPENAI_API_KEY: "", CODEX_API_KEY: "" });
    fs.writeFileSync(
      path.join(process.env.CODEX_HOME || "", "auth.json"),
      JSON.stringify({ tokens: { access_token: "tok", account_id: "a1" } }),
    );
    await server.handshake();
    await expect(server.requireAuth()).rejects.toThrow(/未登录/);
    expect(server.authVia).toBeNull();
  });

  it("rejects an in-flight request when the worker is cancelled", async () => {
    const server = boot("already-chatgpt");
    await server.handshake();
    const pending = server.request("test/hang", {}, 10);
    setTimeout(() => server.close(), 20);
    await expect(pending).rejects.toThrow(/已停止/);
  });

  it("bounds the whole app-server session instead of stacking per-RPC waits", async () => {
    fs.chmodSync(fake, 0o755);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-fake-codex-"));
    setEnv("CODEX_BIN", fake);
    setEnv("FAKE_CODEX_MODE", "already-chatgpt");
    setEnv("HOME", tmp);
    setEnv("CODEX_HOME", path.join(tmp, ".codex"));
    fs.mkdirSync(process.env.CODEX_HOME || path.join(tmp, ".codex"), { recursive: true });
    rpc = new CodexAppServer(1);
    await rpc.handshake();
    const started = Date.now();
    await expect(rpc.request("test/hang")).rejects.toThrow(/超时/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("Commander derives a child thread on the same app-server connection", async () => {
    const server = boot("already-chatgpt");
    await server.handshake();
    await server.requireAuth();
    const child = await server.deriveChildThread("thr_parent");
    expect((child.thread as { id?: string; parentId?: string }).id).toBe("thr_child");
    expect((child.thread as { id?: string; parentId?: string }).parentId).toBe("thr_parent");
    expect(server.proc.exitCode).toBeNull();
  });
});
