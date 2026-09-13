import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { storePending } from "../components/ChatBlocks";
import { FUNNEL, HubTile, SkillHubChrome, skillFunnel, skillKind, type SkillRow } from "./SkillHub";
import JourneyGuide from "../components/JourneyGuide";
import { rememberJourney } from "../journey";
import { connectorStatusLabel, profileNameLabel } from "../labels";
import { REMOTE_BACKEND_LABEL, remoteForSkill } from "../agentConfig";
import { useViewMode } from "../viewMode";
import { brandLabel } from "../knowledgeCopy";

export function Skills({ market = false }: { market?: boolean }) {
  const { debug } = useViewMode();
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const funnelParam = params.get("funnel") || "";
  // The personal catalog opens on all currently granted skills. Funnel tabs
  // remain available for focused work; defaulting to the first funnel hid
  // common actions such as email_compose from the internal employee path.
  const active = FUNNEL.some((f) => f.id === funnelParam) ? funnelParam : "all";

  useEffect(() => {
    (market ? api.skillMarket() : api.skills()).then((data: unknown) => {
      setRows(Array.isArray(data) ? (data as SkillRow[]) : []);
    });
  }, [market]);

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

  const stage = active === "all"
    ? { id: "all", label: "全部技能", hint: "已授权的工作技能" }
    : (FUNNEL.find((f) => f.id === active) || FUNNEL[0]);
  const needle = q.trim().toLowerCase();
  const skills = useMemo(() => {
    return rows.filter((s) => {
      if (active !== "all" && skillFunnel(s) !== active) return false;
      if (!needle) return true;
      return (s.title + (s.summary || "")).toLowerCase().includes(needle);
    });
  }, [rows, active, needle]);

  return (
    <div className="hub-page skills-page" data-skills-page="mine">
      <SkillHubChrome mode="mine" q={q} onQ={setQ} />
      <JourneyGuide variant="compact" definitions={rows} />
      {err && <p className="error">{err}</p>}
      <div className="hub-chips" role="tablist" aria-label="建联进度">
        {[{ id: "all", label: "全部", hint: "已授权技能" }, ...FUNNEL].map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            className={"hub-chip" + (active === f.id ? " on" : "")}
            data-funnel-tab={f.id}
            aria-selected={active === f.id}
            title={f.hint}
            onClick={() => setParams({ funnel: f.id }, { replace: true })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <section className="skill-funnel" data-funnel={stage.id}>
        <h2 className="hub-section-title">
          {stage.label}
          <span className="hub-section-hint">{stage.hint}</span>
        </h2>
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
          {stage.id === "settle" && !skills.some((s) => s.id === "attribution_review") && (
            <HubTile
              id="attribution_review"
              title="归因复盘"
              kind="暂未开放"
              summary="本期还不能做转化归因。超时或失联请先用风险扫描。"
              dataKey="data-skill"
              plusLabel="未开放"
              disabled
              onPlus={() => undefined}
            />
          )}
        </div>
        {skills.length === 0 && stage.id !== "settle" && <p className="muted hub-empty">这一步还没有技能</p>}
      </section>
    </div>
  );
}

export function Exam() {
  const [data, setData] = useState<{
    user: string;
    passed: boolean;
    modules: string[];
    note: string;
    personas?: string[];
  } | null>(null);
  const [persona, setPersona] = useState("sriphy");
  const [assignments, setAssignments] = useState<Record<string, unknown>[] | null>(null);
  const load = () => api.exam().then(setData as never);
  useEffect(() => {
    api.examAssignments().then(setAssignments).catch(() => setAssignments(null));
    load();
    api.me().then((m: { handle?: string; exam_passed?: boolean; brands?: string[] }) => {
      if (m.exam_passed === false) setPersona("exam_blocked");
      else if (Array.isArray(m.brands) && m.brands.length === 0) setPersona("permission_blocked");
      else setPersona("sriphy");
    });
  }, []);
  if (assignments) {
    return (
      <div className="list-page">
        <div><div className="page-kicker">协作</div><h1 style={{ marginTop: 0 }}>学习考试</h1></div>
        {assignments.map((assignment) => (
          <div className="panel" key={String(assignment.id)}>
            <h3>{String(assignment.title || "必修考试")}</h3>
            <p className="muted">{String(assignment.description || "")}</p>
            <p>{assignment.passed ? "已通过" : `待完成${assignment.due_at ? ` · 截止 ${assignment.due_at}` : ""}`}</p>
            {!assignment.passed && (
              <button className="btn work" onClick={() => {
                void api.submitExam(String(assignment.id), { answers: { acknowledged: true }, score: 100 })
                  .then(() => api.examAssignments().then(setAssignments));
              }}>完成考试</button>
            )}
          </div>
        ))}
        {!assignments.length && <p className="muted">暂无待完成考试。</p>}
      </div>
    );
  }
  const switchPersona = async (p: string) => {
    await api.setPersona(p);
    setPersona(p);
    load();
  };
  return (
    <div className="list-page">
      <div className="page-kicker">协作</div>
      <h1 style={{ marginTop: 0 }}>学习考试</h1>
      <div className="panel">
        <h3>
          {data?.user} · {data?.passed ? "已通过" : "未通过"}
        </h3>
        <p className="muted">{data?.note}</p>
        <ul>
          {(data?.modules || []).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
      <div className="panel" data-persona-switch>
        <h3>演示身份</h3>
        <p className="muted">默认鄢棽已通过「数据安全与最小权限」。切换后发送会被拦，不改合作库。</p>
        <div className="chip-row">
          <button
            className={"btn" + (persona === "sriphy" ? " selected" : "")}
            type="button"
            data-persona="sriphy"
            onClick={() => switchPersona("sriphy")}
          >
            鄢棽 · 已通过
          </button>
          <button
            className={"btn" + (persona === "exam_blocked" ? " selected" : "")}
            type="button"
            data-persona="exam_blocked"
            onClick={() => switchPersona("exam_blocked")}
          >
            未通过考试
          </button>
          <button
            className={"btn" + (persona === "permission_blocked" ? " selected" : "")}
            type="button"
            data-persona="permission_blocked"
            onClick={() => switchPersona("permission_blocked")}
          >
            无发信权
          </button>
        </div>
      </div>
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
        <h3>本期连接器</h3>
        {(data?.connectors || []).map((c) => (
          <p key={c.id} className="muted" data-connector={c.id}>
            {c.label} · {connectorStatusLabel(c.status)}
          </p>
        ))}
        <h3 style={{ marginTop: 16 }}>本期隐藏</h3>
        {(data?.hidden_connectors || []).map((h) => (
          <p key={h} className="muted hidden-connector" data-hidden-connector={h}>
            {h} · 本期隐藏
          </p>
        ))}
        {(!data?.hidden_connectors || data.hidden_connectors.length === 0) && (
          <p className="muted">无</p>
        )}
      </div>
      <div className="panel">
        <h3>智能体能力域</h3>
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
