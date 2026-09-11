import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  codexChildEnv,
  inspectLocalCodexAuth,
  isUsableAccount,
  redactSecrets,
  resolveAuthState,
} from "../src/worker/auth.js";

describe("codex auth", () => {
  it("treats chatgpt / apiKey / bedrock accounts as logged in", () => {
    expect(isUsableAccount({ type: "chatgpt", email: "a@b.c", planType: "plus" })).toBe(true);
    expect(isUsableAccount({ type: "apiKey" })).toBe(true);
    expect(isUsableAccount({ type: "amazonBedrock" })).toBe(true);
    expect(isUsableAccount(null)).toBe(false);
    expect(isUsableAccount({})).toBe(false);
  });

  it("does not throw when account/read is empty but OPENAI_API_KEY is set", () => {
    const state = resolveAuthState(
      { account: null, requiresOpenaiAuth: true },
      { OPENAI_API_KEY: "sk-test", HOME: "/tmp/no-codex-home" },
      {
        home: "/tmp/no-codex-home/.codex",
        authPath: "/tmp/no-codex-home/.codex/auth.json",
        hasAuthFile: false,
        hasApiKey: false,
        hasTokens: false,
        apiKey: "",
      },
    );
    expect(state.action).toBe("login_api_key");
    if (state.action === "login_api_key") expect(state.apiKey).toBe("sk-test");
  });

  it("accepts CODEX_API_KEY as the login key", () => {
    const state = resolveAuthState(
      { account: null, requiresOpenaiAuth: true },
      { CODEX_API_KEY: "sk-codex", HOME: "/tmp/no-codex-home" },
      {
        home: "/tmp/no-codex-home/.codex",
        authPath: "/tmp/no-codex-home/.codex/auth.json",
        hasAuthFile: false,
        hasApiKey: false,
        hasTokens: false,
        apiKey: "",
      },
    );
    expect(state.action).toBe("login_api_key");
    if (state.action === "login_api_key") expect(state.apiKey).toBe("sk-codex");
  });

  it("uses openai_api_key from ~/.codex/auth.json when env is empty", () => {
    const state = resolveAuthState(
      { account: null, requiresOpenaiAuth: true },
      { HOME: "/tmp/no-key" },
      {
        home: "/tmp/x/.codex",
        authPath: "/tmp/x/.codex/auth.json",
        hasAuthFile: true,
        hasApiKey: true,
        hasTokens: false,
        apiKey: "sk-from-file",
      },
    );
    expect(state.action).toBe("login_api_key");
    if (state.action === "login_api_key") expect(state.apiKey).toBe("sk-from-file");
  });

  it("does not trust auth.json when account/read still says no account", () => {
    const state = resolveAuthState(
      { account: null, requiresOpenaiAuth: true },
      { HOME: "/tmp/no-key" },
      {
        home: "/tmp/x/.codex",
        authPath: "/tmp/x/.codex/auth.json",
        hasAuthFile: true,
        hasApiKey: false,
        hasTokens: true,
        apiKey: "",
      },
    );
    expect(state.action).toBe("unavailable");
  });

  it("reports unavailable only when there is no account, no key, and no auth.json", () => {
    const state = resolveAuthState(
      { account: null, requiresOpenaiAuth: true },
      { HOME: "/tmp/empty-home" },
      {
        home: "/tmp/empty-home/.codex",
        authPath: "/tmp/empty-home/.codex/auth.json",
        hasAuthFile: false,
        hasApiKey: false,
        hasTokens: false,
        apiKey: "",
      },
    );
    expect(state.action).toBe("unavailable");
  });

  it("allows Codex when OpenAI auth is not required", () => {
    const state = resolveAuthState({ account: null, requiresOpenaiAuth: false }, { HOME: "/tmp/x" });
    expect(state).toEqual({ action: "ok", via: "no_openai_required" });
  });

  it("prefers an existing account over env key", () => {
    const state = resolveAuthState(
      { account: { type: "chatgpt", email: "u@x", planType: "pro" }, requiresOpenaiAuth: true },
      { OPENAI_API_KEY: "sk-ignored" },
    );
    expect(state).toEqual({ action: "ok", via: "account" });
  });

  it("inherits host env except SMTP/WeCom secrets so keychain login survives", () => {
    const env = codexChildEnv({
      PATH: "/usr/bin",
      HOME: "/home/u",
      OPENAI_API_KEY: "sk-pass",
      OPENAI_BASE_URL: "https://example.invalid/v1",
      CODEX_HOME: "/tmp/codex",
      SMTP_PASS: "secret",
      WECOM_TOKEN: "tok",
      LINGONG_DB: "/tmp/x.db",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/dbus",
      RANDOM_KEEP: "yes",
    });
    expect(env.OPENAI_API_KEY).toBe("sk-pass");
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/tmp/dbus");
    expect(env.RANDOM_KEEP).toBe("yes");
    expect(env.SMTP_PASS).toBeUndefined();
    expect(env.WECOM_TOKEN).toBeUndefined();
    expect(env.LINGONG_DB).toBeUndefined();
  });

  it("inspects auth.json without exposing tokens in the summary flags", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-"));
    const home = path.join(dir, ".codex");
    fs.mkdirSync(home);
    fs.writeFileSync(
      path.join(home, "auth.json"),
      JSON.stringify({
        tokens: { access_token: "tok-secret", account_id: "acct_1" },
        openai_api_key: "sk-file",
      }),
    );
    const info = inspectLocalCodexAuth({ HOME: dir });
    expect(info.hasAuthFile).toBe(true);
    expect(info.hasTokens).toBe(true);
    expect(info.hasApiKey).toBe(true);
    expect(info.apiKey).toBe("sk-file");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("redacts secrets in stderr snippets", () => {
    expect(redactSecrets("key sk-proj-ABCDEFG12345678 ok")).toContain("sk-***");
    expect(redactSecrets('{"access_token":"aaaa"}')).not.toContain("aaaa");
  });
});
