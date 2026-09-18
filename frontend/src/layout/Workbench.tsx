import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api, type Account, type SessionRow } from "../api";
import { useAccount } from "../components/AuthGate";
import BrandLockup from "../components/BrandLockup";
import UserMenu from "../components/UserMenu";
import { parseHomeMode } from "../home/modes";
import { ANALYZE_WORK_EVENT, loadKolAnalyzeInFlight, type AnalyzeWorkItem } from "../home/kolSurfaceApi";
import { isKolAnalyzeInFlight, runningBadgeCount, runningBadgeHref } from "../home/kolContract";
import { useViewMode } from "../viewMode";

function Ico({ path }: { path: string }) {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Workbench() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [analyzeItems, setAnalyzeItems] = useState<AnalyzeWorkItem[]>([]);
  const [approvalCount, setApprovalCount] = useState(0);
  const [cronAlertCount, setCronAlertCount] = useState(0);
  const [mailUnread, setMailUnread] = useState(0);
  const { account } = useAccount();
  const { admin, debug } = useViewMode();
  const [me, setMe] = useState<Account | null>(account);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ui:left-collapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    const refreshSessions = () => api.sessions().then((rows) => {
      setSessions((current) => {
        const queued = current.filter((row) => row.agent_status === "queued");
        const merged = rows.map((row) => {
          const local = queued.find((item) => item.id === row.id);
          if (local && row.agent_status === "listening") return { ...row, agent_status: "queued" as const };
          return row;
        });
        const missing = queued.filter((row) => !merged.some((item) => item.id === row.id));
        return [...missing, ...merged];
      });
    }).catch(() => undefined);
    const refreshAnalyze = () => loadKolAnalyzeInFlight().then((rows) => {
      setAnalyzeItems((current) => {
        const local = current.filter((item) => isKolAnalyzeInFlight(item.status) && !rows.some((row) => row.id === item.id));
        return [...local, ...rows];
      });
    }).catch(() => undefined);
    void refreshSessions();
    void refreshAnalyze();
    const onAnalyze = (event: Event) => {
      const item = (event as CustomEvent<AnalyzeWorkItem>).detail;
      if (!item?.id) return;
      setAnalyzeItems((current) => (
        current.some((row) => row.id === item.id)
          ? current.map((row) => (row.id === item.id ? { ...row, ...item } : row))
          : [item, ...current]
      ));
    };
    window.addEventListener(ANALYZE_WORK_EVENT, onAnalyze);
    window.addEventListener("lingong:sessions-refresh", refreshSessions);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshSessions();
        void refreshAnalyze();
      }
    }, 8000);
    return () => {
      window.removeEventListener(ANALYZE_WORK_EVENT, onAnalyze);
      window.removeEventListener("lingong:sessions-refresh", refreshSessions);
      window.clearInterval(timer);
    };
  }, [loc.pathname]);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    api.approvalBadge()
      .then((row) => setApprovalCount(Number(row.count) || 0))
      .catch(() => setApprovalCount(0));
    api.cronJobs()
      .then((data) => {
        const alerts = data.alerts || {};
        setCronAlertCount(Number(alerts.failed || 0) + Number(alerts.needs_takeover || 0));
      })
      .catch(() => setCronAlertCount(0));
    api.mailBox()
      .then((row) => setMailUnread(Number(row.unread || 0) || 0))
      .catch(() => setMailUnread(0));
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

  const skillsActive =
    loc.pathname === "/skills"
    || loc.pathname.startsWith("/market/skills");
  const homeMode = loc.pathname === "/"
    ? parseHomeMode(new URLSearchParams(loc.search).get("tab"))
    : null;
  const newTaskActive = homeMode === "today";
  const adminAvailable = admin || me?.available_modes?.includes("admin") === true;

  const runningCount = useMemo(
    () => runningBadgeCount({ sessions, analyzeItems }),
    [analyzeItems, sessions],
  );
  const runningHref = useMemo(
    () => runningBadgeHref({ sessions, analyzeItems }),
    [analyzeItems, sessions],
  );
  const sessionId = loc.pathname.match(/^\/s\/([^/]+)$/)?.[1] ?? "";
  const runningActive = Boolean(
    sessionId && sessions.some((s) => s.id === sessionId && (s.agent_status === "running" || s.agent_status === "queued")),
  );
  const discoveryActive = homeMode === "discovery";
  const poolActive = homeMode === "pool";
  const followActive = homeMode === "lifecycle";
  const onAgents = loc.pathname === "/agents" || loc.pathname.startsWith("/agents/");
  const onAdmin = loc.pathname === "/admin" || loc.pathname.startsWith("/admin/");

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      localStorage.setItem("ui:left-collapsed", String(!value));
      void api.savePreferences({ left_sidebar_collapsed: !value }).catch(() => undefined);
      return !value;
    });
  };

  return (
    <div
      className={"workbench" + (collapsed ? " sidebar-collapsed" : "") + (onAdmin ? " admin-surface" : "")}
      data-ui-shell="agent-v1"
      data-left-width={collapsed ? "56" : "260"}
      data-view-mode={debug ? "debug" : "business"}
      data-account-role={adminAvailable ? "admin" : "employee"}
    >
      <div className="mobile-top">
        <button className="icon-btn" aria-label="打开导航" aria-expanded={mobileOpen} onClick={() => setMobileOpen((v) => !v)}>☰</button>
        <strong>灵工 工作</strong>
        <NavLink to="/">任务</NavLink>
        <NavLink to="/agents" className={() => onAgents ? "active" : ""}>数字员工</NavLink>
      </div>
      <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
        <div className="sidebar-head">
          <NavLink to="/" className="sidebar-brand" data-sidebar-brand end>
            <BrandLockup variant="sidebar" />
            <span className="brand-name sidebar-label">灵工 工作</span>
          </NavLink>
          <button type="button" className="sidebar-search-btn collapse-toggle" onClick={toggleCollapsed} aria-label={collapsed ? "展开侧栏" : "收起侧栏"} title={collapsed ? "展开侧栏" : "收起侧栏"}>{collapsed ? "›" : "‹"}</button>
        </div>

        <div className="sidebar-scroll">
        <div className="sidebar-nav-stack">
        <nav className="nav-group" aria-label="今日">
          <Link
            to="/"
            className={"nav-link" + (newTaskActive ? " active" : "")}
            aria-current={newTaskActive ? "page" : undefined}
            data-nav="new-task"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M4 20h4L18 10l-4-4L4 16v4z M14 6l4 4" />
            <span className="sidebar-label">新工作任务</span>
          </Link>
          <Link
            to={runningHref}
            className={"nav-link" + (runningActive ? " active" : "")}
            aria-current={runningActive ? "page" : undefined}
            data-nav="running"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 8v4l2.5 1.5" />
            <span className="sidebar-label">进行中</span>
            {runningCount > 0 && <span className="nav-badge" data-running-count={runningCount}>{runningCount}</span>}
          </Link>
          <Link
            to="/?tab=discovery"
            className={"nav-link" + (discoveryActive ? " active" : "")}
            aria-current={discoveryActive ? "page" : undefined}
            data-nav="discovery"
            data-home-entry="existing-discovery"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z M17 16l.8 2.4L20 19.2l-2.2.8L17 22.4l-.8-2.4L14 19.2l2.2-.8z" />
            <span className="sidebar-label">AI发现</span>
          </Link>
          <Link
            to="/?tab=pool"
            className={"nav-link" + (poolActive ? " active" : "")}
            aria-current={poolActive ? "page" : undefined}
            data-nav="pool"
            data-home-entry="list-pool"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M4 7h16v10H4z M8 7V5h8v2" />
            <span className="sidebar-label">公海</span>
          </Link>
          <Link
            to="/?tab=lifecycle"
            className={"nav-link" + (followActive ? " active" : "")}
            aria-current={followActive ? "page" : undefined}
            data-nav="followed"
            data-home-entry="list-followed"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M8 7h8 M6 12h12 M8 17h8" />
            <span className="sidebar-label">我跟进的红人</span>
          </Link>
          <NavLink to="/cron" className={() => "nav-link" + ((loc.pathname === "/cron" || loc.pathname.startsWith("/cron/")) ? " active" : "")} data-nav="cron" onClick={() => setMobileOpen(false)}>
            <Ico path="M8 3v3 M16 3v3 M5 8h14 M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M9 13h3 M14 17h3" />
            <span className="sidebar-label">定时任务</span>
            {cronAlertCount > 0 && <span className="nav-badge warn" data-cron-alert>{cronAlertCount}</span>}
          </NavLink>
          <NavLink to="/mail" className={() => "nav-link" + ((loc.pathname === "/mail" || loc.pathname.startsWith("/mail/")) ? " active" : "")} data-nav="mail" onClick={() => setMobileOpen(false)}>
            <Ico path="M4 6h16v12H4z M4 6l8 7 8-7" />
            <span className="sidebar-label">通讯</span>
            {mailUnread > 0 && <span className="nav-badge" data-mail-unread-badge>{mailUnread}</span>}
          </NavLink>
        </nav>

        <nav className="nav-group" aria-label="数字员工">
          <NavLink
            to="/agents"
            className={() => "nav-link" + (onAgents ? " active" : "")}
            data-nav="agents"
            title="数字员工"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M12 4a3 3 0 0 1 3 3v1h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2V7a3 3 0 0 1 3-3z M9 13h6 M9 16h4" />
            <span className="sidebar-label">数字员工</span>
          </NavLink>
        </nav>

        {debug ? (
          <nav className="nav-group" aria-label="技能">
            <NavLink
              to="/skills"
              className={() => "nav-link" + (skillsActive ? " active" : "")}
              data-nav="skills"
              title="技能目录"
              onClick={() => setMobileOpen(false)}
            >
              <Ico path="M8 8h4v4H8z M12 12h4v4h-4z M7 16l-2 2 M17 8l2-2" />
              <span className="sidebar-label">技能目录</span>
            </NavLink>
          </nav>
        ) : null}

        <nav className="nav-group" aria-label="资产">
          <NavLink to="/kb" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="knowledge" onClick={() => setMobileOpen(false)}>
            <Ico path="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" />
            <span className="sidebar-label">知识库</span>
          </NavLink>
          <NavLink to="/approvals" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="approvals" onClick={() => setMobileOpen(false)}>
            <Ico path="M7 4h10a2 2 0 0 1 2 2v14H5V6a2 2 0 0 1 2-2z M9 4v3h6V4" />
            <span className="sidebar-label">审批</span>
            {approvalCount > 0 && <span className="nav-badge warn">{approvalCount}</span>}
          </NavLink>
          <NavLink to="/exam" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="exam" onClick={() => setMobileOpen(false)}>
            <Ico path="M3 9l9-5 9 5-9 5z M7 12v5c3 2 7 2 10 0v-5 M21 9v6" />
            <span className="sidebar-label">考试</span>
            {Number(me?.exam_todo_count || 0) > 0 && (
              <span className="nav-badge warn">{Number(me?.exam_todo_count) === 1 ? "待完成" : me?.exam_todo_count}</span>
            )}
          </NavLink>
          <NavLink to="/connectors" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="connectors" title="连接器" onClick={() => setMobileOpen(false)}>
            <Ico path="M10 13a5 5 0 0 0 7.1.4l1.5-1.5a5 5 0 1 0-7.1-7.1L10.3 6 M14 11a5 5 0 0 0-7.1-.4L5.4 12.1a5 5 0 1 0 7.1 7.1L13.7 18" />
            <span className="sidebar-label">连接器</span>
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

        <nav className="nav-group" aria-label="项目">
          <div className="nav-link is-disabled" aria-disabled="true" data-nav-disabled="创建新项目">
            <Ico path="M12 7v10 M7 12h10" />
            <span className="sidebar-label">创建新项目</span>
            <span className="nav-tag">非本期</span>
          </div>
        </nav>
        </div>
        </div>

        <div className="sidebar-foot">
          <UserMenu account={me} />
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
