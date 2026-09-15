import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { storePending } from "../components/ChatBlocks";
import { HubTile, skillKind, type SkillRow } from "./SkillHub";
import { rememberJourney } from "../journey";
import { profileNameLabel } from "../labels";
import { REMOTE_BACKEND_LABEL, remoteForSkill } from "../agentConfig";
import { useViewMode } from "../viewMode";
import { brandLabel } from "../knowledgeCopy";

export function Skills() {
  const { debug } = useViewMode();
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    setLoading(true);
    api.skills()
      .then((data: unknown) => {
        setRows(Array.isArray(data) ? (data as SkillRow[]) : []);
        setErr("");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载我的技能"))
      .finally(() => setLoading(false));
  }, []);

  const useSkill = async (s: SkillRow) => {
    const label = s.label || s.title;
    setBusy(s.id);
    setErr("");
    try {
      const prompt = `@${label}`;
      const ses = await api.createSession(prompt.slice(0, 24));
      storePending(ses.id, { text: prompt, intent: s.id });
      rememberJourney({ kind: "skill", skillId: s.id, skillLabel: label });
      nav(`/s/${ses.id}`);
    } catch (e) {
      setErr(String(e));
      setBusy(null);
    }
  };

  const needle = q.trim().toLowerCase();
  const skills = useMemo(() => {
    return rows.filter((s) => {
      if (!needle) return true;
      return (s.title + (s.summary || "")).toLowerCase().includes(needle);
    });
  }, [rows, needle]);

  return (
    <div className="hub-page skills-page" data-skills-page="mine">
      <header className="hub-chrome" data-skills-chrome="mine">
        <div>
          <div className="page-kicker">技能</div>
          <h1 className="hub-section-title">我的技能</h1>
        </div>
        <div className="hub-tools">
          <label className="hub-search-wrap">
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="M16 16.4 20 20.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <input
              className="hub-search"
              data-hub-search
              placeholder="搜索技能"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
      </header>
      <p className="hub-lead muted">已授权、可用于当前任务的技能。</p>
      {err && <p className="error" role="alert" data-skills-error>{err}</p>}
      {loading && !err && <p className="muted" data-skills-loading>正在加载技能…</p>}
      <section>
        <div className="hub-grid">
          {skills.map((s) => (
            <HubTile
              key={s.id}
              id={s.id}
              title={s.title}
              kind={skillKind(s)}
              summary={s.summary || s.title}
              dataKey="data-skill"
              plusLabel={"使用 " + s.title}
              disabled={busy === s.id || s.granted === false}
              onPlus={() => void useSkill(s)}
              badge={debug ? REMOTE_BACKEND_LABEL[remoteForSkill(s.id)] : undefined}
            />
          ))}
        </div>
        {!loading && !err && skills.length === 0 && (
          <p className="muted hub-empty" data-skills-empty>没有匹配的技能</p>
        )}
      </section>
    </div>
  );
}

export function Admin() {
  const [data, setData] = useState<{
    connectors: { id: string; label: string; status: string }[];
    hidden_connectors?: string[];
    not_in_kol_scope: string[];
    mailboxes: Record<string, string>;
    profiles?: {
      id: string;
      name: string;
      responsibilities: string[];
      defaultWritableScope: string;
      guardrail: string;
      harness: string;
    }[];
  } | null>(null);
  useEffect(() => {
    api.admin().then(setData as never);
  }, []);
  return (
    <div className="list-page">
      <div className="page-kicker">协作</div>
      <h1 style={{ marginTop: 0 }}>管理配置</h1>
      <div className="panel">
        <h3>连接器</h3>
        <p className="muted">治理目录只在管理端枢纽；员工使用面只看已授权能力，不在本页。</p>
        <p><Link to="/admin/connectors">打开连接器枢纽</Link></p>
        <p><Link to="/connectors">打开员工使用面</Link></p>
      </div>
      <div className="panel">
        <h3>智能体能力域</h3>
        <p className="muted">治理入口在 <Link to="/admin/agents">数字员工治理</Link>。下面仍是只读能力域声明。</p>
        <p className="muted">对外可称智能体；对内共用同一套运行环境，不是多套系统。</p>
        {(data?.profiles || []).map((profile) => (
          <div key={profile.id} data-profile={profile.id} style={{ marginTop: 12 }}>
            <strong>{profileNameLabel(profile.name)}</strong>
            <p className="muted" style={{ margin: "4px 0" }}>
              {profile.responsibilities.join(" / ")}
            </p>
            <p style={{ margin: 0 }}>默认可写：{profile.defaultWritableScope}</p>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {String(profile.guardrail || "")
                .replace(/子 Thread/g, "子任务")
                .replace(/Codex harness/g, "运行环境")
                .replace(/Deal Memory/g, "合作备忘")}
            </p>
          </div>
        ))}
      </div>
      <div className="panel">
        <h3>品牌邮箱</h3>
        <p className="muted">组织邮箱策略在连接器详情治理；个人发件箱仍走个人设置。</p>
        {Object.entries(data?.mailboxes || {}).map(([k, v]) => (
          <p key={k} className="muted">
            {brandLabel(k)} · {v}
          </p>
        ))}
      </div>
      <div className="panel">
        <h3>本工作台不做</h3>
        <p className="muted">{(data?.not_in_kol_scope || []).join(" / ")}</p>
      </div>
    </div>
  );
}
