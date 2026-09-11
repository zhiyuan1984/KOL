import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { AGENT_ENTRIES, REMOTE_BACKEND_LABEL, remoteForConnector, remoteForSkill } from "../agentConfig";
import { profileNameLabel } from "../labels";
import { starterPrompt } from "../taskStarters";
import { storePending } from "../components/ChatBlocks";
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

type SkillRow = {
  id: string;
  title: string;
  label?: string;
  profile?: string;
  summary?: string;
  granted?: boolean;
  in_market?: boolean;
  source?: "bundled" | "published";
};

export default function Agents() {
  const { debug } = useViewMode();
  const nav = useNavigate();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [connectors, setConnectors] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    void Promise.all([api.profiles(), api.skills(), api.connectors().catch(() => [])])
      .then(([p, s, c]) => {
        setProfiles(Array.isArray(p) ? p : []);
        setSkills(Array.isArray(s) ? s : []);
        setConnectors(Array.isArray(c) ? c : []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载智能体目录"));
  }, []);

  const byProfile = useMemo(() => {
    const map = new Map<string, SkillRow[]>();
    for (const skill of skills.filter((s) => s.in_market !== false)) {
      const pid = skill.profile || "commander";
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(skill);
    }
    return map;
  }, [skills]);

  const startSkill = async (skill: SkillRow) => {
    const prompt = starterPrompt({ id: skill.id, title: skill.title, prompt: skill.summary || skill.title });
    const ses = await api.createSession(prompt.slice(0, 24));
    storePending(ses.id, { text: prompt, intent: skill.id });
    nav(`/s/${ses.id}`);
  };

  return (
    <div className="list-page agent-page">
      <div className="page-hero agent-hero">
        <div className="page-kicker">智能体</div>
        <h1>我的智能体</h1>
        <p className="muted">
          按红人合作、审批和采集分组的工作入口。发送不等于改阶段。
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
      {err && <p className="error">{err}</p>}
      <div className="agent-entry-grid">
        {AGENT_ENTRIES.map((entry) => (
          <article key={entry.id} className="panel agent-card agent-entry-card" data-agent-entry={entry.id}>
            <header className="agent-card-head">
              <span className="agent-avatar" aria-hidden>{entry.title.slice(0, 1)}</span>
              <div className="agent-card-titles">
                <h2>{entry.title}</h2>
                  {debug && <span className="muted nowrap">{REMOTE_BACKEND_LABEL[remoteForSkill(entry.skillId)]}</span>}
              </div>
            </header>
            <p className="agent-scope">{entry.summary}</p>
            <button
              type="button"
              className="btn work"
              onClick={() => void startSkill({
                id: entry.skillId,
                title: entry.title,
                summary: entry.prompt,
              })}
            >
              用此智能体开始
            </button>
          </article>
        ))}
      </div>
      <div className="agent-grid">
        {profiles.map((profile) => {
          const rows = byProfile.get(profile.id) || [];
          const remotes = new Set(rows.map((s) => remoteForSkill(s.id)));
          return (
            <article key={profile.id} className="panel agent-card" data-agent-profile={profile.id}>
              <header className="agent-card-head">
                <span className="agent-avatar" aria-hidden>{profileNameLabel(profile.name).slice(0, 1)}</span>
                <div className="agent-card-titles">
                  <h2>{profileNameLabel(profile.name)}</h2>
                  {debug && <span className="muted mono nowrap">{profile.harness}</span>}
                </div>
              </header>
              <p className="agent-scope">{profile.defaultWritableScope}</p>
              <p className="muted agent-guard">{profile.guardrail}</p>
              {debug && (
              <div className="agent-remotes">
                {[...remotes].map((r) => (
                  <span key={r} className="remote-pill sm" data-remote={r}>{REMOTE_BACKEND_LABEL[r]}</span>
                ))}
              </div>
              )}
              <ul className="agent-resp">
                {profile.responsibilities.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <h3 className="agent-skills-title">关联技能 ({rows.length})</h3>
              <div className="agent-skill-list">
                {rows.map((skill) => (
                  <div key={skill.id} className="agent-skill-row" data-skill={skill.id}>
                    <div className="agent-skill-copy">
                      <strong>{skill.label || skill.title}</strong>
                      {skill.source === "published" && <span className="hub-kind">自建</span>}
                      {debug && <span className="muted remote-tag nowrap">{REMOTE_BACKEND_LABEL[remoteForSkill(skill.id)]}</span>}
                      {skill.summary && <p className="muted skill-sum">{skill.summary}</p>}
                    </div>
                    <button
                      type="button"
                      className="btn work sm"
                      disabled={skill.granted === false}
                      onClick={() => void startSkill(skill)}
                    >
                      在会话里用
                    </button>
                  </div>
                ))}
                {!rows.length && <p className="muted">暂无已上架技能。</p>}
              </div>
            </article>
          );
        })}
      </div>
      <p className="muted agent-foot">
        想看预设编组？<Link to="/teams">打开智能体团队</Link>
        {" · "}
        <Link to="/skills">技能目录</Link>
      </p>
    </div>
  );
}
