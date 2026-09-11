import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, type Account } from "../api";

type AuthContextValue = {
  account: Account | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  account: null,
  refresh: async () => undefined,
  logout: async () => undefined,
});

export const useAccount = () => useContext(AuthContext);

function adminLoginIdent(raw: string): { email: string; username: string } {
  const t = String(raw || "").trim();
  const email = t.toLowerCase();
  if (t === "鄢棽" || email === "sriphy" || email === "sriphy.yan@amperetime.com") {
    return { username: "sriphy", email: email.includes("@") ? email : "sriphy.yan@amperetime.com" };
  }
  return { username: t, email: t };
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "setup" | "login" | "ready">("loading");
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const status = await api.authStatus();
      if (status.setup_required) {
        setState("setup");
        return;
      }
      if (!status.authenticated) {
        setState("login");
        return;
      }
      const resolved = status.account || status.user || (await api.me());
      setAccount({
        ...resolved,
        available_modes: resolved.available_modes || status.available_modes,
      });
      setState("ready");
    } catch (statusError) {
      // Existing demo/test servers may not expose the auth endpoints. A working
      // /api/me is the explicit compatibility signal that they auto-authenticate.
      try {
        setAccount(await api.me());
        setState("ready");
      } catch {
        setError(statusError instanceof Error ? statusError.message : "无法检查登录状态");
        setState("login");
      }
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setAccount(null);
      setState("login");
    }
  };

  if (state === "loading") {
    return <main className="auth-page" aria-live="polite">正在检查账户…</main>;
  }

  if (state === "setup" || state === "login") {
    return (
      <AuthForm
        setup={state === "setup"}
        error={error}
        onSubmit={async (values) => {
          setError("");
          try {
            const result = state === "setup"
              ? await api.setup(values)
              : await api.login({ ...adminLoginIdent(values.email), password: values.password });
            const resolved = result.account || result.user || (await api.me());
            setAccount({
              ...resolved,
              available_modes: resolved.available_modes || result.available_modes,
            });
            setState("ready");
          } catch (e) {
            const raw = e instanceof Error ? e.message : "登录失败";
            setError(raw === "invalid credentials" ? "账号或密码不对" : raw);
          }
        }}
      />
    );
  }

  return <AuthContext.Provider value={{ account, refresh, logout }}>{children}</AuthContext.Provider>;
}

function AuthForm({
  setup,
  error,
  onSubmit,
}: {
  setup: boolean;
  error: string;
  onSubmit: (values: { name: string; email: string; password: string }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [identError, setIdentError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    setIdentError(email ? "" : "请填写邮箱、手机或账号");
    setPasswordError(password ? "" : "请填写密码");
    if (!email || !password) return;
    setBusy(true);
    try {
      await onSubmit({
        name: String(data.get("name") || ""),
        email,
        password,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        {error && (
          <div className="error-summary" role="alert" tabIndex={-1} aria-labelledby="auth-error-title">
            <strong id="auth-error-title">无法登录</strong>
            <p>{error}</p>
          </div>
        )}
        <div className="page-kicker">灵工工作台</div>
        <h1>{setup ? "创建首位管理员" : "登录"}</h1>
        {setup && (
          <label className="field">姓名<input name="name" autoComplete="name" defaultValue="鄢棽" required /></label>
        )}
        <label className="field">
          邮箱、手机或账号
          <input
            name="email"
            autoComplete="username"
            inputMode="email"
            defaultValue={setup ? "sriphy.yan@amperetime.com" : ""}
            placeholder="sriphy.yan@amperetime.com"
            aria-describedby={identError ? "auth-ident-error" : undefined}
            required
          />
        </label>
        {identError && <p id="auth-ident-error" className="field-error">{identError}</p>}
        <label className="field">
          密码
          <input
            name="password"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            minLength={9}
            aria-describedby={passwordError ? "auth-password-error" : undefined}
            required
          />
        </label>
        {passwordError && <p id="auth-password-error" className="field-error">{passwordError}</p>}
        {!setup && <p className="muted">管理员可用邮箱、鄢棽或 sriphy，密码 123456789。</p>}
        <button className="btn work" disabled={busy}>{busy ? "请稍候…" : setup ? "完成设置" : "登录"}</button>
      </form>
    </main>
  );
}
