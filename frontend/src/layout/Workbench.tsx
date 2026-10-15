import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api, type Account, type SessionRow, type Task } from "../api";
import { useAccount } from "../components/AuthGate";
import BrandLockup from "../components/BrandLockup";
import PanelToggleIcon from "../components/PanelToggleIcon";
import RouteErrorBoundary, { RouteLoadingFallback } from "../components/RouteErrorBoundary";
import AccountBar from "../components/AccountBar";
import { scheduleShellRead } from "../home/firstPaint";
import { ANALYZE_WORK_EVENT, kolAnalyzeInFlight, unwrapTaskRows, type AnalyzeWorkItem } from "../home/kolSurfaceApi";
import { isKolAnalyzeInFlight, runningBadgeCount, runningBadgeHref } from "../home/kolContract";
import { useViewMode } from "../viewMode";
import { ADMIN_NAV_GROUPS, adminTabOf } from "./adminNav";
import { useInsetScrollbar } from "../hooks/useInsetScrollbar";
import { normalizeBox } from "../mail/client";
import { lastMailbox, mailboxHref, MAIL_NAVIGATION_EVENT, navigationMailbox } from "../mail/navigation";
import type { MailBox } from "../mail/types";
import "./sidebar-gutters.css";
import { useApprovalBadge, approvalBadgeLabel } from "../reviews/useApprovalBadge";
import { ApprovalNavBadge } from "./ApprovalNavBadge";

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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [analyzeItems, setAnalyzeItems] = useState<AnalyzeWorkItem[]>([]);
  const [cronAlertCount, setCronAlertCount] = useState(0);
  const [mailUnread, setMailUnread] = useState(0);
  const { account } = useAccount();
  const actorScope = [
    account?.id || "anonymous",
    [...new Set([...(account?.roles || []), account?.role || ""])].filter(Boolean).sort().join(","),
    [...(account?.brands || [])].sort().join(","),
    [...(account?.mailboxes || [])].sort().join(","),
    [...(account?.available_modes || [])].sort().join(","),
  ].join("|");
  const [mailNavBox, setMailNavBox] = useState<MailBox | null>(null);
  const [previousMailbox, setPreviousMailbox] = useState(() => lastMailbox(account?.id));
  const { admin, debug } = useViewMode();
  const [me, setMe] = useState<Account | null>(account);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ui:left-collapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [navStuck, setNavStuck] = useState(false);
  const loc = useLocation();
  const sourceSession = loc.pathname.match(/^\/s\/([^/]+)$/)?.[1];
  const agentsHref = sourceSession ? `/agents?from_session=${encodeURIComponent(sourceSession)}` : "/agents";
  const sidebarScroll = useRef<HTMLDivElement | null>(null);
  useInsetScrollbar(sidebarScroll);
  // 壳层轮询闸门：上一次读取未返回前不再发下一次（多标签页各自全速轮询曾把单线程后端压到 5–6s 停顿）。
  const pollInFlight = useRef<{ controller: AbortController; scope: string } | null>(null);

  useEffect(() => {
    setPendingNav(null);
  }, [loc.pathname]);

  // 侧栏加载态不许无限转：8 秒还没落地就换成「刷新」入口（部署换过资源名时旧标签页会卡在这）。
  useEffect(() => {
    if (!pendingNav) {
      setNavStuck(false);
      return;
    }
    const timer = window.setTimeout(() => setNavStuck(true), 8000);
    return () => window.clearTimeout(timer);
  }, [pendingNav]);

  useEffect(() => {
    let cancelled = false;
    // A new actor/scope inherits neither rows nor a pending request from the
    // prior login. The collection remains eligible for its 15s poll: another
    // tab or a cron run can create work after an idle terminal snapshot.
    setSessions([]);
    setTasks([]);
    setAnalyzeItems([]);
    const applySessions = (rows: SessionRow[]) => {
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
    };
    const applyAnalyze = (rows: AnalyzeWorkItem[]) => {
      setAnalyzeItems((current) => {
        const local = current.filter((item) => isKolAnalyzeInFlight(item.status) && !rows.some((row) => row.id === item.id));
        return [...local, ...rows];
      });
    };
    const applyTasks = (value: Task[] | { tasks: Task[] }) => {
      setTasks(Array.isArray(value) ? value : value.tasks || []);
    };
    // 读取合并成一次 Promise.all：共用同一个闸门，也共用同一次后端时隙。
    // 同一份 api.tasks() 在两个消费者之间共享，避免一次刷新发两条相同的读。
    const refresh = () => {
      if (cancelled) return;
      if (pollInFlight.current) return;
      const controller = new AbortController();
      const flight = { controller, scope: actorScope };
      pollInFlight.current = flight;
      // One task promise serves both the task list and its KOL projection.
      const taskRows = api.tasks(undefined, controller.signal);
      void Promise.allSettled([
        api.sessions(false, controller.signal),
        taskRows,
      ]).then(([sessionsResult, tasksResult]) => {
        if (cancelled || controller.signal.aborted || pollInFlight.current !== flight) return;
        const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : null;
        const tasks = tasksResult.status === "fulfilled" ? unwrapTaskRows(tasksResult.value) : null;
        if (sessions) applySessions(sessions);
        if (tasks) {
          applyAnalyze(kolAnalyzeInFlight(tasks));
          applyTasks(tasks);
        }
      }).finally(() => {
        if (pollInFlight.current === flight) pollInFlight.current = null;
      });
    };
    // 让位首屏：侧栏会话/在飞分析延后到首帧之后再发。
    const cancelKickoff = scheduleShellRead(refresh);
    const onAnalyze = (event: Event) => {
      const item = (event as CustomEvent<AnalyzeWorkItem>).detail;
      if (!item?.id) return;
      setAnalyzeItems((current) => (
        current.some((row) => row.id === item.id)
          ? current.map((row) => (row.id === item.id ? { ...row, ...item } : row))
          : [item, ...current]
      ));
      if (isKolAnalyzeInFlight(item.status)) {
        refresh();
      }
    };
    window.addEventListener(ANALYZE_WORK_EVENT, onAnalyze);
    const refreshFromEvent = refresh;
    window.addEventListener("lingong:sessions-refresh", refreshFromEvent);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15000);
    return () => {
      cancelled = true;
      window.removeEventListener(ANALYZE_WORK_EVENT, onAnalyze);
      window.removeEventListener("lingong:sessions-refresh", refreshFromEvent);
      cancelKickoff();
      window.clearInterval(timer);
      const flight = pollInFlight.current;
      if (flight?.scope === actorScope) {
        flight.controller.abort();
        pollInFlight.current = null;
      }
    };
  }, [actorScope]);

  useEffect(() => {
    // 首屏让位：这些 badge 与首屏内容无关，延后到首帧之后再发。
    const cancel = scheduleShellRead(() => {
      api.me().then(setMe).catch(() => setMe(null));
      api.cronJobs()
        .then((data) => {
          const alerts = data.alerts || {};
          setCronAlertCount(Number(alerts.failed || 0) + Number(alerts.needs_takeover || 0));
        })
        .catch(() => setCronAlertCount(0));
    });
    return cancel;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMailNavBox(null);
    setPreviousMailbox(lastMailbox(account?.id));
    const cancelKickoff = scheduleShellRead(() => {
      void api.mailBox().then(row => {
        if (cancelled) return;
        setMailNavBox(normalizeBox(row));
        setMailUnread(Number(row.unread || 0) || 0);
      }).catch(() => { if (!cancelled) setMailUnread(0); });
    });
    const selected = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId: string; mailbox: string }>).detail;
      if (detail?.accountId === account?.id) setPreviousMailbox(detail.mailbox);
    };
    window.addEventListener(MAIL_NAVIGATION_EVENT, selected);
    return () => { cancelled = true; cancelKickoff(); window.removeEventListener(MAIL_NAVIGATION_EVENT, selected); };
  }, [account?.id]);
  const mailHref = mailboxHref(mailNavBox ? navigationMailbox(mailNavBox, previousMailbox) : "");

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
  const newTaskActive = loc.pathname === "/";
  const businessMapActive =
    loc.pathname === "/leads" || loc.pathname.startsWith("/leads/")
    || loc.pathname === "/cooperations" || loc.pathname.startsWith("/cooperations/");
  const adminAvailable = admin || me?.available_modes?.includes("admin") === true;

  const runningCount = useMemo(
    () => runningBadgeCount({ sessions, analyzeItems, tasks }),
    [analyzeItems, sessions, tasks],
  );
  const runningHref = useMemo(
    () => runningBadgeHref({ sessions, analyzeItems, tasks }),
    [analyzeItems, sessions, tasks],
  );
  const sessionId = loc.pathname.match(/^\/s\/([^/]+)$/)?.[1] ?? "";
  const runningActive = Boolean(
    sessionId && sessions.some((s) => s.id === sessionId && (s.agent_status === "running" || s.agent_status === "queued")),
  );
  const onAgents = loc.pathname === "/agents" || loc.pathname.startsWith("/agents/");
  const onAdmin = loc.pathname === "/admin" || loc.pathname.startsWith("/admin/");
  // 管理面沿用同一侧栏外壳，只换条目集合（除菜单文字外与员工端复刻）。
  const showAdminNav = onAdmin && adminAvailable;
  const adminSection = adminTabOf(loc.pathname);
  const approvalBadge = useApprovalBadge(account?.id, !showAdminNav, loc.key);
  const approvalLabel = approvalBadgeLabel(approvalBadge.summary?.count, approvalBadge.error);

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
        {showAdminNav ? (
          <strong>管理</strong>
        ) : (
          <>
            <NavLink to="/">任务</NavLink>
            <NavLink to={agentsHref} className={() => onAgents ? "active" : ""}>Agent</NavLink>
          </>
        )}
      </div>
      <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
        <div className="sidebar-head">
          <NavLink to={showAdminNav ? "/admin" : "/"} className="sidebar-brand" data-sidebar-brand end>
            <BrandLockup variant="sidebar" />
            <picture className="sidebar-lucas" aria-hidden="true">
              <source media="(prefers-reduced-motion: reduce)" srcSet="/avatars/lucas/Lucas6.png" />
              <img src="/avatars/lucas/Lucas6.webp" alt="" />
            </picture>
          </NavLink>
          <button type="button" className="sidebar-search-btn collapse-toggle" onClick={toggleCollapsed} aria-label={collapsed ? "展开侧栏" : "收起侧栏"} title={collapsed ? "展开侧栏" : "收起侧栏"}><PanelToggleIcon side="left" /></button>
        </div>

        <div className="sidebar-scroll" ref={sidebarScroll}>
        <div className="sidebar-nav-stack">
        {showAdminNav ? ADMIN_NAV_GROUPS.map((group) => (
          <nav className="nav-group" aria-label={group.label} key={group.label}>
            {group.rows.map((row) => {
              const active = adminSection === row.id || (row.sections ?? []).includes(adminSection);
              return (
                <NavLink
                  key={row.id}
                  to={row.href}
                  end={row.end}
                  className={"nav-link" + (active ? " active" : "")}
                  aria-current={active ? "page" : undefined}
                  data-admin-nav={row.id}
                  data-admin-tab={row.id}
                  data-admin-agents-link={row.id === "agents" ? true : undefined}
                  title={row.label}
                  onClick={() => setMobileOpen(false)}
                  onMouseEnter={() => { void import("../pages/AdminConsole"); }}
                  onFocus={() => { void import("../pages/AdminConsole"); }}
                >
                  <Ico path={row.icon} />
                  <span className="sidebar-label">{row.label}</span>
                </NavLink>
              );
            })}
          </nav>
        )) : (
          <>
        <nav className="nav-group" aria-label="今日">
          <Link
            to="/"
            className={"nav-link" + (newTaskActive ? " active" : "")}
            aria-current={newTaskActive ? "page" : undefined}
            data-nav="new-task"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M4 20h4L18 10l-4-4L4 16v4z M14 6l4 4" />
            <span className="sidebar-label">工作台</span>
          </Link>
          <Link
            to="/tasks"
            className={"nav-link" + (runningActive ? " active" : "")}
            aria-current={runningActive ? "page" : undefined}
            data-nav="running"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 8v4l2.5 1.5" />
            <span className="sidebar-label">任务中心</span>
            {runningCount > 0 && <span className="nav-badge" data-running-count={runningCount}>{runningCount}</span>}
          </Link>
          <NavLink to="/cron" className={() => "nav-link" + ((loc.pathname === "/cron" || loc.pathname.startsWith("/cron/")) ? " active" : "")} data-nav="cron" onClick={() => setMobileOpen(false)}>
            <Ico path="M8 3v3 M16 3v3 M5 8h14 M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M9 13h3 M14 17h3" />
            <span className="sidebar-label">定时任务</span>
            {cronAlertCount > 0 && <span className="nav-badge warn" data-cron-alert>{cronAlertCount}</span>}
          </NavLink>
          <NavLink to={mailHref} className={() => "nav-link" + ((loc.pathname === "/mail" || loc.pathname.startsWith("/mail/")) ? " active" : "")} data-nav="mail" onClick={() => setMobileOpen(false)}>
            <Ico path="M4 6h16v12H4z M4 6l8 7 8-7" />
            <span className="sidebar-label">通讯</span>
            {mailUnread > 0 && <span className="nav-badge" data-mail-unread-badge>{mailUnread}</span>}
          </NavLink>
        </nav>

        <nav className="nav-group" aria-label="KOL业务">
          <NavLink
            to="/leads"
            className={() => "nav-link" + (businessMapActive ? " active" : "")}
            aria-current={businessMapActive ? "page" : undefined}
            data-nav="business-map"
            title="业务地图"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2z M9 4v14 M15 6v14" />
            <span className="sidebar-label">业务地图</span>
          </NavLink>
        </nav>

        <nav className="nav-group" aria-label="Agent">
          <NavLink
            to={agentsHref}
            className={() => "nav-link" + (onAgents ? " active" : "")}
            data-nav="agents"
            title="Agent"
            onClick={() => setMobileOpen(false)}
          >
            <Ico path="M8 5h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-2.2l-1.8 3-1.8-3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z M9 11h.01 M15 11h.01 M9 14c1.7 1.3 4.3 1.3 6 0 M12 5V3 M9 3h6" />
            <span className="sidebar-label">Agent</span>
          </NavLink>
        </nav>

        <nav className="nav-group" aria-label="技能">
          <NavLink
            to="/skills"
            className={() => "nav-link" + (skillsActive ? " active" : "")}
            data-nav="skills"
            title="技能"
            onClick={() => { setPendingNav("skills"); setMobileOpen(false); }}
            onMouseEnter={() => { void import("../pages/SkillCatalog"); }}
            onFocus={() => { void import("../pages/SkillCatalog"); }}
          >
            <Ico path="M8 8h4v4H8z M12 12h4v4h-4z M7 16l-2 2 M17 8l2-2" />
            <span className="sidebar-label">技能</span>
            {pendingNav === "skills" && !skillsActive && (
              navStuck
                ? <button type="button" className="nav-refresh" data-nav-stuck onClick={(event) => { event.preventDefault(); location.reload(); }}>刷新</button>
                : <span className="nav-loading" aria-label="正在打开技能" />
            )}
          </NavLink>
        </nav>

        <nav className="nav-group" aria-label="资产">
          <NavLink to="/kb" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="knowledge" onClick={() => setMobileOpen(false)}>
            <Ico path="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" />
            <span className="sidebar-label">知识库</span>
          </NavLink>
          <NavLink to="/approvals" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="approvals" aria-label={approvalLabel} title={approvalLabel} onClick={() => setMobileOpen(false)}>
            <Ico path="M7 4h10a2 2 0 0 1 2 2v14H5V6a2 2 0 0 1 2-2z M9 4v3h6V4" />
            <span className="sidebar-label">审批</span>
            <ApprovalNavBadge count={approvalBadge.summary?.count} error={approvalBadge.error} collapsed={collapsed} />
          </NavLink>
          <NavLink to="/exam" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-nav="exam" onClick={() => setMobileOpen(false)}>
            <Ico path="M3 9l9-5 9 5-9 5z M7 12v5c3 2 7 2 10 0v-5 M21 9v6" />
            <span className="sidebar-label">考试</span>
            {Number(me?.exam_todo_count || 0) > 0 && (
              <span className="nav-badge warn">{Number(me?.exam_todo_count) === 1 ? "待完成" : me?.exam_todo_count}</span>
            )}
          </NavLink>
        </nav>
          </>
        )}
        </div>
        </div>

        <div className="sidebar-foot">
          <AccountBar account={me} />
        </div>
      </aside>
      <main className="main">
        <RouteErrorBoundary key={loc.pathname === "/cron" || loc.pathname.startsWith("/cron/") ? "/cron" : loc.pathname} label="workbench">
          <Suspense fallback={<RouteLoadingFallback />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </main>
    </div>
  );
}
