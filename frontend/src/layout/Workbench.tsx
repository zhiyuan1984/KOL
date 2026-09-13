import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api, type Account, type SessionRow, type StarryBinding } from "../api";
import { useAccount } from "../components/AuthGate";
import { accountChipLabel } from "../labels";
import { useViewMode } from "../viewMode";

function Ico({ path }: { path: string }) {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Workbench() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [approvalCount, setApprovalCount] = useState(0);
  const { account, logout } = useAccount();
  const { admin, debug, setDebug } = useViewMode();
  const [me, setMe] = useState<Account | null>(account);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ui:left-collapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [starryBind, setStarryBind] = useState<StarryBinding | null>(null);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    api.sessions().then(setSessions).catch(() => setSessions([]));
    api.me().then((row) => {
      setMe(row);
      if (row.starry_binding) setStarryBind(row.starry_binding);
    }).catch(() => setMe(null));
    api.starryBinding().then(setStarryBind).catch(() => setStarryBind(null));
    api.approvals()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setApprovalCount(list.filter((row) => {
          const status = String((row as { status?: string }).status || "");
          const canDecide = (row as { can_decide?: boolean }).can_decide !== false;
          return (status === "pending" || status === "waiting") && canDecide;
        }).length);
      })
      .catch(() => setApprovalCount(0));
  }, [loc.pathname]);

  useEffect(() => {
    api.preferences().then((preferences) => {
      if (typeof preferences.left_sidebar_collapsed === "boolean") {
        setCollapsed(preferences.left_sidebar_collapsed);
        localStorage.setItem("ui:left-collapsed", String(preferences.left_sidebar_collapsed));
      }
      const theme = String(preferences.theme || "system");
      if (theme === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
      if (preferences.locale) document.documentElement.lang = String(preferences.locale);
      if (preferences.model_tier) localStorage.setItem("composer:model-tier", String(preferences.model_tier));
    }).catch(() => undefined);
  }, [account?.id]);

  useEffect(() => {
    if (account?.starry_binding) setStarryBind(account.starry_binding);
  }, [account?.starry_binding]);

  const recent = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = sessions.slice(0, 24);
    if (!needle) return rows;
    return rows.filter((s) => s.title.toLowerCase().includes(needle));
  }, [sessions, q]);

  const skillsActive = loc.pathname === "/skills" || loc.pathname.startsWith("/market/skills");
  const adminActive = loc.pathname.startsWith("/admin");
  const adminAvailable = admin || me?.available_modes?.includes("admin") === true;

  const runningCount = useMemo(
    () => sessions.filter((s) => s.agent_status === "running").length,
    [sessions],
  );
  const firstRunning = useMemo(
    () => sessions.find((s) => s.agent_status === "running"),
    [sessions],
  );
  const sessionId = loc.pathname.match(/^\/s\/([^/]+)$/)?.[1] ?? "";
  const runningActive = Boolean(
    sessionId && sessions.some((s) => s.id === sessionId && s.agent_status === "running"),
  );
  const onTeamsTab = loc.pathname === "/teams"
    || (loc.pathname === "/agents" && new URLSearchParams(loc.search).get("tab") === "teams");
  const onAgentsWork = loc.pathname === "/agents" && !onTeamsTab;

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      localStorage.setItem("ui:left-collapsed", String(!value));
      void api.savePreferences({ left_sidebar_collapsed: !value }).catch(() => undefined);
      return !value;
    });
  };

  const sessionAction = async (session: SessionRow, action: "rename" | "archive" | "delete") => {
    try {
      if (action === "rename") {
        const title = prompt("重命名会话", session.title)?.trim();
        if (!title) return;
        await api.renameSession(session.id, title);
        setSessions((rows) => rows.map((row) => row.id === session.id ? { ...row, title } : row));
      } else if (action === "archive") {
        await api.archiveSession(session.id);
        setSessions((rows) => rows.filter((row) => row.id !== session.id));
      } else {
        if (!confirm(`删除会话“${session.title}”？消息、草稿、运行箱和可归属附件将被清理，合规迁移记录保留。`)) return;
        await api.deleteSession(session.id);
        setSessions((rows) => rows.filter((row) => row.id !== session.id));
        if (loc.pathname === `/s/${session.id}`) nav("/");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "操作失败");
    }
  };

  return (
    <div
      className={"workbench" + (collapsed ? " sidebar-collapsed" : "")}
      data-ui-shell="agent-v1"
      data-view-mode={debug ? "debug" : "business"}
      data-account-role={adminAvailable ? "admin" : "employee"}
    >
      <div className="mobile-top">
        <button className="icon-btn" aria-label="打开导航" aria-expanded={mobileOpen} onClick={() => setMobileOpen((v) => !v)}>☰</button>
        <strong>灵工 工作</strong>
        <NavLink to="/">任务</NavLink>
        <NavLink to="/agents" className={() => onAgentsWork ? "active" : ""}>智能体</NavLink>
        <NavLink to="/agents?tab=teams" className={() => onTeamsTab ? "active" : ""}>团队</NavLink>
        <NavLink to="/pipeline">生命周期</NavLink>
      </div>
      <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
        <div className="sidebar-head">
          <NavLink to="/" className="brand-name" end>
            <span className="sidebar-label">灵工 工作</span><span className="rail-logo" aria-hidden />
          </NavLink>
          <button type="button" className="sidebar-search-btn collapse-toggle" onClick={toggleCollapsed} aria-label={collapsed ? "展开侧栏" : "收起侧栏"} title={collapsed ? "展开侧栏" : "收起侧栏"}>{collapsed ? "›" : "‹"}</button>
          <button
            type="button"
            className={"sidebar-search-btn" + (searchOpen ? " on" : "")}
            aria-label="筛选最近"
            data-search-toggle
            onClick={() => setSearchOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="M16 16.5 20 20.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {searchOpen && (
          <input
            className="sidebar-search"
            data-search-recent
            placeholder="筛选最近…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        )}

        <div className="sidebar-nav-stack">
        <nav className="nav-group" aria-label="今日">
          <div className="nav-label">今日</div>
          <NavLink to="/" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} end data-nav="new-task">
            <Ico path="M4 20h4L18 10l-4-4L4 16v4z M14 6l4 4" />
            <span className="sidebar-label">新工作任务</span>
          </NavLink>
          <Link
            to={firstRunning ? `/s/${firstRunning.id}` : "/"}
            className={"nav-link" + (runningActive ? " active" : "")}
            aria-current={runningActive ? "page" : undefined}
            data-nav="running"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 8v4l2.5 1.5" />
            <span className="sidebar-label">进行中</span>
            {runningCount > 0 && <span className="nav-badge">{runningCount}</span>}
          </Link>
        </nav>

        <nav className="nav-group" aria-label="智能体">
          <div className="nav-label">智能体</div>
          <NavLink to="/agents" className={() => "nav-link" + (onAgentsWork ? " active" : "")} data-nav="agents" title="我的智能体" onClick={() => setMobileOpen(false)}>
            <Ico path="M12 4a3 3 0 0 1 3 3v1h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2V7a3 3 0 0 1 3-3z M9 13h6 M9 16h4" />
            <span className="sidebar-label">我的智能体</span>
          </NavLink>
          <NavLink to="/agents?tab=teams" className={() => "nav-link" + (onTeamsTab ? " active" : "")} data-nav="teams" title="智能体团队" onClick={() => setMobileOpen(false)}>
            <Ico path="M8 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M16 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M3.5 18c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4 M11.5 18c0-1.6.8-3 2.2-3.8 M16 14c2.5 0 4.5 1.8 4.5 4" />
            <span className="sidebar-label">智能体团队</span>
          </NavLink>
          <div className={"nav-combo" + (skillsActive || adminActive ? " active" : "")} data-nav="skills-connectors">
            <Ico path="M8 8h4v4H8z M12 12h4v4h-4z M7 16l-2 2 M17 8l2-2" />
            <NavLink to="/skills" className={skillsActive ? "on" : ""}>
              技能目录
            </NavLink>
            {adminAvailable && <><span className="nav-dot">·</span><NavLink to="/admin/connectors" className={loc.pathname === "/admin/connectors" ? "on" : ""}>连接器</NavLink></>}
          </div>
        </nav>

        <nav className="nav-group" aria-label="资产">
          <div className="nav-label">资产</div>
          <NavLink to="/kb" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="knowledge" onClick={() => setMobileOpen(false)}>
            <Ico path="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" />
            <span className="sidebar-label">知识库</span>
          </NavLink>
          <NavLink to="/pipeline" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="pipeline" onClick={() => setMobileOpen(false)}>
            <Ico path="M4 7h16 M4 12h10 M4 17h16 M8 5v4 M14 10v4 M7 15v4" />
            <span className="sidebar-label">生命周期</span>
          </NavLink>
          <NavLink to="/approvals" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="approvals" onClick={() => setMobileOpen(false)}>
            <Ico path="M7 4h10a2 2 0 0 1 2 2v14H5V6a2 2 0 0 1 2-2z M9 4v3h6V4" />
            <span className="sidebar-label">审批</span>
            {approvalCount > 0 && <span className="nav-badge warn">{approvalCount}</span>}
          </NavLink>
          <NavLink to="/cron" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            <Ico path="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 8v4l2.5 1.5" />
            <span className="sidebar-label">定时任务</span>
          </NavLink>
          <NavLink to="/exam" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="exam" onClick={() => setMobileOpen(false)}>
            <Ico path="M3 9l9-5 9 5-9 5z M7 12v5c3 2 7 2 10 0v-5 M21 9v6" />
            <span className="sidebar-label">考试</span>
            {me?.exam_passed === false && <span className="nav-badge warn">待完成</span>}
          </NavLink>
          <div className="nav-link is-disabled" aria-disabled="true" data-nav-disabled="云盘">
            <Ico path="M7 17h10a4 4 0 0 0 .4-8 5 5 0 0 0-9.6-1.2A3.5 3.5 0 0 0 7 17z" />
            <span className="sidebar-label">云盘</span>
            <span className="nav-tag">非本期</span>
          </div>
          <div className="nav-link is-disabled" aria-disabled="true" data-nav-disabled="手机遥控电脑">
            <Ico path="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M10 6h4 M11 18h2" />
            <span className="sidebar-label">手机遥控电脑</span>
            <span className="nav-tag">非本期</span>
          </div>
        </nav>

        <div className="nav-group">
          <div className="nav-label">项目</div>
          <div className="nav-link is-disabled" aria-disabled="true" data-nav-disabled="创建新项目">
            <Ico path="M12 7v10 M7 12h10" />
            <span className="sidebar-label">创建新项目</span>
            <span className="nav-tag">非本期</span>
          </div>
        </div>
        </div>

        <div className="nav-group recents" data-recents>
          <div className="nav-label">最近</div>
          {recent.length === 0 && <p className="nav-empty">{q.trim() ? "没有匹配的会话" : "暂无会话"}</p>}
          {recent.map((s) => <div className="session-row" key={s.id}>
            <NavLink to={`/s/${s.id}`} className="session-link" onClick={() => setMobileOpen(false)}>
              <i className={"status-dot " + (s.agent_status || "listening")} title={s.agent_status || "listening"} />
              <span>{s.title}</span>
            </NavLink>
            <details className="session-menu"><summary aria-label={`${s.title} 会话菜单`}>···</summary><div className="menu-popover">
              <button onClick={() => void sessionAction(s, "rename")}>重命名</button>
              <a href={`/api/sessions/${s.id}/export?format=md`} download>导出 MD</a>
              <a href={`/api/sessions/${s.id}/export?format=json`} download>导出 JSON</a>
              <button onClick={() => void sessionAction(s, "archive")}>归档</button>
              <button className="danger-text" onClick={() => void sessionAction(s, "delete")}>删除</button>
            </div></details>
          </div>)}
        </div>

        <div className="sidebar-foot">
          <div className="user-menu-wrap">
            <button className="user-chip" data-exam={me?.exam_passed === false ? "blocked" : "ok"} aria-expanded={userOpen} onClick={() => setUserOpen((v) => !v)}>
              <span className="sidebar-label">{accountChipLabel(me)}</span>
              <span className="rail-user" aria-hidden>{me?.name?.slice(0, 1) || "我"}</span>
            </button>
            {userOpen && <div className="menu-popover user-popover">
              <NavLink to="/" onClick={() => setUserOpen(false)}>员工工作台</NavLink>
              {adminAvailable && <NavLink to="/admin" onClick={() => setUserOpen(false)}>管理控制台</NavLink>}
              {adminAvailable && (
                <button
                  type="button"
                  data-debug-toggle
                  onClick={() => {
                    setDebug(!debug);
                    setUserOpen(false);
                  }}
                >
                  {debug ? "关闭调试视图" : "打开调试视图"}
                </button>
              )}
              <NavLink to="/settings" onClick={() => setUserOpen(false)}>个人设置</NavLink>
              <NavLink to="/settings?tab=starry" data-starry-menu onClick={() => setUserOpen(false)}>
                {starryBind?.bound
                  ? `Starry 已连接${starryBind.mailbox_email ? ` · ${starryBind.mailbox_email.split("@")[0]}` : ""}`
                  : "连接 Starry 邮箱"}
              </NavLink>
              <button onClick={() => void logout()}>退出登录</button>
            </div>}
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
