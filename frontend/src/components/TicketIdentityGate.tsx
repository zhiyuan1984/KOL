import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, type TicketIdentityAccount } from "../api";

type TicketIdentityContextValue = {
  account: TicketIdentityAccount | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const TicketIdentityContext = createContext<TicketIdentityContextValue>({
  account: null,
  refresh: async () => undefined,
  logout: async () => undefined,
});

export const useTicketIdentity = () => useContext(TicketIdentityContext);

type State = "loading" | "setup" | "login" | "ready" | "forbidden";

/**
 * Formal tickets deliberately use their own PostgreSQL account/session domain.
 * This prevents a historical application session from becoming an implicit
 * authority for ticket creation, assignment, acceptance or organization data.
 */
export default function TicketIdentityGate({ children, requireAdmin = false }: { children: ReactNode; requireAdmin?: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [account, setAccount] = useState<TicketIdentityAccount | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    setError("");
    try {
      const status = await api.ticketAuthStatus();
      if (status.setup_required) {
        setAccount(null);
        setState("setup");
        return;
      }
      if (!status.authenticated || !status.account) {
        setAccount(null);
        setState("login");
        return;
      }
      setAccount(status.account);
      setState(requireAdmin && !status.account.roles.includes("admin") ? "forbidden" : "ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法检查正式工单身份");
      setState("login");
    }
  };

  useEffect(() => { void refresh(); }, [requireAdmin]);

  const logout = async () => {
    try {
      await api.ticketAuthLogout();
    } finally {
      setAccount(null);
      setState("login");
    }
  };

  if (state === "loading") return <main className="ticket-identity-page" aria-live="polite">正在检查正式工单身份…</main>;
  if (state === "forbidden") {
    return <main className="ticket-identity-page"><section className="ticket-identity-card"><p className="page-kicker">正式工单 · PostgreSQL 权威库</p><h1>需要工单管理员权限</h1><p className="muted">当前账号 {account?.name || account?.username || "—"} 没有管理员角色，不能查看或变更组织绑定。</p><button type="button" className="btn ghost" onClick={() => void logout()}>切换工单账号</button></section></main>;
  }
  if (state === "setup" || state === "login") {
    return <TicketIdentityForm
      setup={state === "setup"}
      error={error}
      onSubmit={async (values) => {
        setError("");
        try {
          const result = state === "setup"
            ? await api.ticketAuthSetup(values)
            : await api.ticketAuthLogin({ username: values.username, password: values.password });
          setAccount(result.account);
          setState(requireAdmin && !result.account.roles.includes("admin") ? "forbidden" : "ready");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "正式工单身份验证失败");
        }
      }}
    />;
  }
  return <TicketIdentityContext.Provider value={{ account, refresh, logout }}>{children}</TicketIdentityContext.Provider>;
}

function TicketIdentityForm({
  setup,
  error,
  onSubmit,
}: {
  setup: boolean;
  error: string;
  onSubmit: (values: { username: string; name?: string; password: string }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    if (!username || !password) return;
    setBusy(true);
    try {
      await onSubmit({ username, name: String(form.get("name") || "").trim(), password });
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="ticket-identity-page">
      <form className="ticket-identity-card" onSubmit={submit} noValidate>
        <p className="page-kicker">正式工单 · PostgreSQL 权威库</p>
        <h1>{setup ? "设置首位工单管理员" : "登录正式工单"}</h1>
        <p className="muted">此身份域独立于历史工作台登录。工单创建、分派、验收和组织绑定只信任 PostgreSQL 会话。</p>
        {error ? <div className="error-summary" role="alert"><strong>无法继续</strong><p>{error}</p></div> : null}
        {setup ? <label className="field">姓名<input name="name" autoComplete="name" required /></label> : null}
        <label className="field">账号<input name="username" autoComplete="username" pattern="[A-Za-z0-9._@-]{3,100}" placeholder="工单账号" required /></label>
        <label className="field">密码<input name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} minLength={9} required /></label>
        <button className="btn work" disabled={busy}>{busy ? "正在验证…" : setup ? "完成初始设置" : "登录工单中心"}</button>
      </form>
    </main>
  );
}
