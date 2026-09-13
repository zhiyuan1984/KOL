import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { REMOTE_BACKEND_LABEL, remoteForConnector, remoteForSkill } from "../agentConfig";
import {
  asTaskList,
  buildAgentNextSteps,
  failedTaskReason,
  parseAgentTab,
  readRecentAgents,
  recentIdleSessions,
  retryFailedTask,
  runningSessions,
  sessionStatusLabel,
  startAgentWork,
  type AgentNextStep,
  type AgentPageTab,
  type RecentAgent,
} from "../agentWork";
import { api, type SessionRow, type Task } from "../api";
import { storePending } from "../components/ChatBlocks";
import { useAgentManifest } from "../hooks/useAgentManifest";
import { rememberJourney } from "../journey";
import { profileNameLabel } from "../labels";
import { useViewMode } from "../viewMode";

type Profile = {
  id: string;
  name: string;
  responsibilities: string[];
  defaultWritableScope: string;
  guardrail: string;
  harness: string;
  canDeriveChildThreads?: boolean;
};

const TABS: Array<{ id: AgentPageTab; label: string }> = [
  { id: "work", label: "工作" },
  { id: "teams", label: "数字团队" },
  { id: "spec", label: "说明书" },
];

export default function Agents() {
  const { debug } = useViewMode();
  const manifest = useAgentManifest();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = parseAgentTab(params.get("tab"));
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [connectors, setConnectors] = useState<Record<string, unknown>[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [failedTasks, setFailedTasks] = useState<Task[]>([]);
  const [recentAgents, setRecentAgents] = useState<RecentAgent[]>(() => readRecentAgents());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [openSpec, setOpenSpec] = useState<string | null>(null);
  const [openTeam, setOpenTeam] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Do not fetch GET /api/home/board here. That payload is Home's
    // 「今天推荐」and was replacing catalog entries after first paint.
    void Promise.all([
      api.profiles().catch(() => []),
      api.connectors().catch(() => []),
      api.sessions().catch(() => []),
      api.tasks({ status: "failed" }).catch(() => []),
    ])
      .then(([p, c, s, failed]) => {
        if (cancelled) return;
        setProfiles(Array.isArray(p) ? p : []);
        setConnectors(Array.isArray(c) ? c : []);
        setSessions(Array.isArray(s) ? s : []);
        setFailedTasks(asTaskList(failed));
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "无法加载工作台");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nextSteps = useMemo(
    () => buildAgentNextSteps({
      entries: manifest?.entries || [],
    }),
    [manifest?.entries],
  );

  const running = useMemo(() => runningSessions(sessions), [sessions]);
  const runningIds = useMemo(() => new Set(running.map((row) => row.id)), [running]);
  const recentSessions = useMemo(() => recentIdleSessions(sessions, runningIds), [runningIds, sessions]);

  useEffect(() => {
    if (tab !== "work") return;
    const refreshShell = () => {
      void api.sessions().then(setSessions).catch(() => undefined);
      void api.tasks({ status: "failed" }).then((rows) => setFailedTasks(asTaskList(rows))).catch(() => undefined);
    };
    const timer = window.setInterval(refreshShell, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshShell();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tab]);

  const setTab = (next: AgentPageTab) => {
    const nextParams = new URLSearchParams(params);
    if (next === "work") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };

  const goSession = (sessionId: string, kolSession = false) => {
    if (kolSession) sessionStorage.setItem(`kol-session:${sessionId}`, "1");
    nav(`/s/${sessionId}`, { state: kolSession ? { kolSession: true } : undefined });
  };

  const onStart = async (step: AgentNextStep) => {
    setBusy(step.id);
    setErr("");
    rememberJourney({
      kind: "skill",
      skillId: step.intent,
      skillLabel: step.title,
      handle: step.handle,
    });
    try {
      const opened = await startAgentWork(step);
      setRecentAgents(readRecentAgents());
      goSession(opened.id, opened.kolSession);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "无法开始");
      setBusy(null);
    }
  };

  const startTeam = async (teamId: string, stepIndex = 0) => {
    const team = manifest?.teams.find((row) => row.id === teamId);
    if (!team) return;
    const step = team.steps[stepIndex] || team.steps[0];
    const title = `${team.title} · ${step.label}`;
    setBusy(`team-${teamId}`);
    setErr("");
    rememberJourney({ kind: "skill", skillId: step.skillId, skillLabel: step.label });
    try {
      const ses = await api.createSession(title.slice(0, 24));
      storePending(ses.id, { text: step.prompt });
      sessionStorage.setItem(`team:${ses.id}`, JSON.stringify({ teamId, stepIndex }));
      nav(`/s/${ses.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "无法开始团队步骤");
      setBusy(null);
    }
  };

  const onRetryFailed = async (task: Task) => {
    setBusy(`failed-${task.id}`);
    setErr("");
    rememberJourney({
      kind: "task",
      skillId: String(task.skill_id || task.skill || ""),
      skillLabel: task.title,
      handle: task.kol_name,
    });
    try {
      const opened = await retryFailedTask(task);
      goSession(opened.id, opened.kolSession);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "无法重试");
      setBusy(null);
    }
  };

  const startRecent = (row: RecentAgent) => {
    void onStart({
      id: row.id,
      title: row.title,
      reason: "最近用过",
      cta: "再开一单",
      source: "catalog",
      sourceLabel: "最近在用",
      intent: row.intent,
      prompt: row.prompt,
      handle: row.handle,
    });
  };

  return (
    <div className="list-page agent-page" data-agent-page={tab} data-visual="docs20">
      <div className="page-hero agent-hero">
        <div className="page-kicker">数字员工</div>
        <h1>数字员工</h1>
        <p className="muted">
          从今天的合作开工。说明书收在后面，技能仍走
          <Link to="/skills">技能目录</Link>
          。发送不等于改阶段。
        </p>
        {debug && (
          <div className="remote-legend">
            {Object.entries(REMOTE_BACKEND_LABEL).map(([id, label]) => {
              const live = connectors.find((row) => remoteForConnector(String(row.id || "")) === id);
              const status = live ? String(live.status || "configured") : "catalog";
              return (
                <span key={id} className="remote-pill" data-remote={id} data-live={live ? "on" : "off"} title={live ? `连接器 ${String(live.label || live.id)} · ${status}` : "目录映射"}>
                  <i className="live-dot" aria-hidden />
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="agent-tabs" role="tablist" aria-label="数字员工页面">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={"agent-tab" + (tab === item.id ? " on" : "")}
            aria-selected={tab === item.id}
            data-agent-tab={item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {err && <p className="error">{err}</p>}

      {tab === "work" && (
        <div className="agent-work" data-agent-work>
          <section className="agent-section" data-agent-section="next">
            <header className="agent-section-head">
              <h2>推荐下一步</h2>
              <span className="muted">{nextSteps.length ? `${nextSteps.length} 项` : "暂无"}</span>
            </header>
            {nextSteps.length ? (
              <ul className="agent-work-list">
                {nextSteps.map((step) => (
                  <li key={step.id} className="agent-work-row" data-agent-next={step.id} data-agent-source={step.source}>
                    <span className="agent-work-icon" aria-hidden>{step.icon || "○"}</span>
                    <div className="agent-work-copy">
                      <strong title={step.title}>{step.title}</strong>
                      <p className="muted" title={`${step.reason} · ${step.sourceLabel}`}>{step.reason} · {step.sourceLabel}</p>
                    </div>
                    <button
                      type="button"
                      className="btn work sm"
                      disabled={busy === step.id}
                      onClick={() => void onStart(step)}
                    >
                      {step.cta}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted agent-empty">还没有跟进中的红人或待办。可以从技能目录开工，或先回首页看今天的合作。</p>
            )}
          </section>

          <section className="agent-section" data-agent-section="recent">
            <header className="agent-section-head">
              <h2>最近在用</h2>
              <span className="muted">{recentSessions.length || recentAgents.length ? "接着上次的会话" : "暂无"}</span>
            </header>
            {recentSessions.length ? (
              <ul className="agent-work-list">
                {recentSessions.map((session) => (
                  <li key={session.id} className="agent-work-row" data-agent-recent={session.id}>
                    <i className={"status-dot " + (session.agent_status || "listening")} aria-hidden />
                    <div className="agent-work-copy">
                      <strong title={session.title}>{session.title}</strong>
                      <p className="muted">{sessionStatusLabel(session.agent_status)}</p>
                    </div>
                    <Link className="btn work sm" to={`/s/${session.id}`}>继续</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted agent-empty">还没有会话。从上面选一步开始，不要先翻说明书。</p>
            )}
            {recentAgents.length > 0 && (
              <div className="agent-recent-chips" aria-label="最近用过的入口">
                {recentAgents.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="chip agent-recent-chip"
                    disabled={busy === row.id}
                    onClick={() => startRecent(row)}
                  >
                    再开 · {row.title}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="agent-section" data-agent-section="running">
            <header className="agent-section-head">
              <h2>运行中</h2>
              <span className="muted">{running.length ? `${running.length} 个会话` : "当前没有"}</span>
            </header>
            {running.length ? (
              <ul className="agent-work-list">
                {running.map((session) => (
                  <li key={session.id} className="agent-work-row" data-agent-running={session.id}>
                    <i className={"status-dot " + (session.agent_status || "running")} aria-hidden />
                    <div className="agent-work-copy">
                      <strong title={session.title}>{session.title}</strong>
                      <p className="muted">{sessionStatusLabel(session.agent_status)}</p>
                    </div>
                    <Link className="btn work sm" to={`/s/${session.id}`}>回到会话</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted agent-empty">
                当前没有进行中的会话。会话列表里状态为运行中或等审批的会出现在这里。
              </p>
            )}
          </section>

          <section className="agent-section" data-agent-section="failed">
            <header className="agent-section-head">
              <h2>失败</h2>
              <span className="muted">{failedTasks.length ? `${failedTasks.length} 项` : "当前没有"}</span>
            </header>
            {failedTasks.length ? (
              <ul className="agent-work-list">
                {failedTasks.map((task) => (
                  <li key={task.id} className="agent-work-row" data-agent-failed={task.id}>
                    <span className="agent-work-icon" aria-hidden>!</span>
                    <div className="agent-work-copy">
                      <strong title={task.title}>{task.title}</strong>
                      <p className="muted" title={failedTaskReason(task)}>{failedTaskReason(task)}</p>
                    </div>
                    <div className="agent-card-actions">
                      {task.session_id && (
                        <Link className="agent-secondary-link" to={`/s/${task.session_id}`}>打开会话</Link>
                      )}
                      <button
                        type="button"
                        className="btn work sm"
                        disabled={busy === `failed-${task.id}`}
                        onClick={() => void onRetryFailed(task)}
                      >
                        重试
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted agent-empty">没有失败的任务。</p>
            )}
          </section>
        </div>
      )}

      {tab === "teams" && (
        <div className="agent-teams-pane" data-agent-teams>
          <header className="agent-section-head">
            <h2>数字团队</h2>
            <p className="muted">预设编组，不是群聊。每一步仍走已发布动作。</p>
          </header>
          <div className="team-grid">
            {(manifest?.teams || []).map((team) => {
              const expanded = openTeam === team.id;
              return (
                <article key={team.id} className="panel team-card" data-team={team.id}>
                  <h3>{team.title}</h3>
                  <p className="muted">{team.summary}</p>
                  <p className="team-profiles">
                    {team.profileIds.map((id) => (
                      <span key={id} className="chip">{profileNameLabel(id)}</span>
                    ))}
                  </p>
                  <ol className="team-steps">
                    {team.steps.map((step, index) => (
                      <li key={step.skillId} data-step={index}>
                        <span className="team-step-idx">{index + 1}</span>
                        <div>
                          <strong>{step.label}</strong>
                          {debug && <span className="muted remote-tag">{REMOTE_BACKEND_LABEL[remoteForSkill(step.skillId)]}</span>}
                          {expanded && <p className="muted step-prompt">{step.prompt}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="agent-card-actions">
                    <button
                      type="button"
                      className="btn work"
                      disabled={busy === `team-${team.id}`}
                      onClick={() => void startTeam(team.id, 0)}
                    >
                      从第一步开始
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      aria-expanded={expanded}
                      onClick={() => setOpenTeam(expanded ? null : team.id)}
                    >
                      {expanded ? "收起步骤说明" : "查看步骤说明"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {tab === "spec" && (
        <div className="agent-spec-pane" data-agent-spec>
          <header className="agent-section-head">
            <h2>说明书</h2>
            <p className="muted">职责、护栏和可写范围默认收起。要开工请回到「工作」或去<Link to="/skills">技能目录</Link>。</p>
          </header>
          <div className="agent-grid">
            {profiles.map((profile) => {
              const expanded = openSpec === profile.id;
              return (
                <article key={profile.id} className="panel agent-card agent-spec-card" data-agent-profile={profile.id}>
                  <header className="agent-card-head">
                    <span className="agent-avatar" aria-hidden>{profileNameLabel(profile.name).slice(0, 1)}</span>
                    <div className="agent-card-titles">
                      <h3>{profileNameLabel(profile.name)}</h3>
                      {debug && <span className="muted mono">{profile.harness}</span>}
                      <p className="muted">{profile.responsibilities[0] || profile.defaultWritableScope}</p>
                    </div>
                  </header>
                  <div className="agent-card-actions">
                    <button
                      type="button"
                      className="btn ghost sm"
                      aria-expanded={expanded}
                      data-agent-spec-toggle={profile.id}
                      onClick={() => setOpenSpec(expanded ? null : profile.id)}
                    >
                      {expanded ? "收起说明书" : "展开说明书"}
                    </button>
                    <Link className="btn ghost sm" to="/skills">技能目录</Link>
                  </div>
                  {expanded && (
                    <div className="agent-spec-body" data-agent-spec-body={profile.id}>
                      <p className="agent-scope"><strong>可写范围</strong> {profile.defaultWritableScope}</p>
                      <p className="muted agent-guard"><strong>护栏</strong> {profile.guardrail}</p>
                      {debug && (
                        <div className="agent-remotes">
                          <span className="remote-pill sm" data-remote={remoteForSkill(profile.id)}>{REMOTE_BACKEND_LABEL[remoteForSkill(profile.id)]}</span>
                        </div>
                      )}
                      <ul className="agent-resp">
                        {profile.responsibilities.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
