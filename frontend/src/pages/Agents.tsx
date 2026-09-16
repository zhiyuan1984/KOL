import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { storeComposerDraft } from "../components/ChatBlocks";
import {
  APPROVER_EXPERT_ID,
  KOL_EXPERT_ID,
  bindExpertSession,
  expertCanHelpCopy,
  expertCanSummon,
  expertDetailPath,
  expertMissionCopy,
  expertPrimaryCta,
  expertRoleCopy,
  expertSecondaryCta,
  fetchExpert,
  fetchExperts,
  parseSummonRefusal,
  rememberSummonedExpert,
  summonExpert,
  type Expert,
} from "../experts";
import AgentApprover, { approverRiskPrompt } from "./AgentApprover";
import AgentCrawler from "./AgentCrawler";
import AgentKol from "./AgentKol";
import type { ApprovalRow } from "./Approvals";

async function attachHonestCounts(rows: Expert[]): Promise<Expert[]> {
  return Promise.all(rows.map(async (expert) => {
    if (expert.open_count != null) return expert;
    if (expert.id !== APPROVER_EXPERT_ID) return expert;
    try {
      const approvals = await api.approvals();
      const list = Array.isArray(approvals) ? approvals : [];
      const pending = list.filter((row) => {
        const status = String((row as { status?: string }).status || "");
        const canDecide = (row as { can_decide?: boolean }).can_decide !== false;
        return (status === "pending" || status === "waiting") && canDecide;
      }).length;
      return { ...expert, open_count: pending };
    } catch {
      return expert;
    }
  }));
}

function RoleCard({
  expert,
  busy,
  onPrimary,
}: {
  expert: Expert;
  busy: boolean;
  onPrimary: (expert: Expert) => void;
}) {
  const mission = expertMissionCopy(expert);
  const role = expertRoleCopy(expert);
  const canHelp = expertCanHelpCopy(expert);
  const primary = expertPrimaryCta(expert);
  const think = expertCanSummon(expert);

  return (
    <article
      className="expert-card"
      data-expert-card={expert.id}
      data-expert-kind={expert.kind}
      data-expert-entry={expert.primary_entry}
    >
      <header className="expert-card-head">
        <div className="expert-card-titles">
          <h2>
            <Link to={expertDetailPath(expert.id)} data-expert-open={expert.id}>{expert.name}</Link>
          </h2>
          {role && role !== expert.name ? <p className="muted expert-card-role">{role}</p> : null}
        </div>
        {expert.open_count != null ? (
          <p className="muted expert-card-count" data-expert-count={expert.id}>{expert.open_count}</p>
        ) : null}
      </header>

      <div className="expert-card-body" data-expert-qa={expert.id}>
        <section className="expert-block">
          <h3>岗位使命</h3>
          <p>{mission}</p>
        </section>
        {expert.good_at.length > 0 && (
          <section className="expert-block">
            <h3>擅长</h3>
            <ul className="expert-skill-list">
              {expert.good_at.map((skill) => (
                <li key={skill} className="expert-skill">{skill}</li>
              ))}
            </ul>
          </section>
        )}
        {canHelp.length > 0 && (
          <section className="expert-block">
            <h3>可以帮你</h3>
            <ul className="expert-help-list">
              {canHelp.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="expert-card-cta">
        <Link className="btn ghost" to={expertDetailPath(expert.id)} data-expert-secondary={expert.id}>
          {expertSecondaryCta()}
        </Link>
        <button
          type="button"
          className="btn work"
          data-expert-primary={expert.id}
          {...(think ? { "data-expert-summon": expert.id } : {})}
          disabled={busy}
          onClick={() => onPrimary(expert)}
        >
          {busy ? (think ? "正在开始…" : "打开中…") : primary}
        </button>
      </footer>
    </article>
  );
}

export default function Agents() {
  const nav = useNavigate();
  const { id: routeId } = useParams();
  const [experts, setExperts] = useState<Expert[]>([]);
  const [detail, setDetail] = useState<Expert | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadList = () => {
    setLoading(true);
    setErr("");
    void fetchExperts()
      .then(attachHonestCounts)
      .then((rows) => setExperts(rows))
      .catch((error) => setErr(error instanceof Error ? error.message : "无法加载数字员工"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (routeId) return;
    loadList();
  }, [routeId]);

  useEffect(() => {
    if (!routeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr("");
    void fetchExpert(routeId)
      .then((row) => {
        if (cancelled) return;
        setDetail(row);
      })
      .catch((error) => {
        if (!cancelled) setErr(error instanceof Error ? error.message : "无法加载这位数字员工");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const onSummon = async (expert: Expert, prompt?: string) => {
    setBusyId(expert.id);
    setErr("");
    try {
      const summoned = await summonExpert(expert);
      bindExpertSession(summoned.session_id, expert, summoned);
      rememberSummonedExpert(expert.id);
      if (prompt) storeComposerDraft(summoned.session_id, { text: prompt });
      nav(`/s/${summoned.session_id}`, {
        state: {
          expertBound: true,
          expert: summoned,
          ...(prompt ? { composerDraft: { text: prompt } } : {}),
        },
      });
    } catch (error) {
      const refused = parseSummonRefusal(error);
      setBusyId(null);
      if (refused.code === "expert_summon_not_allowed" && refused.path && refused.path !== "/agents") {
        nav(refused.path);
        return;
      }
      setErr(refused.message || (error instanceof Error ? error.message : "无法开始工作"));
    }
  };

  const onExplainRisk = async (row: ApprovalRow) => {
    const kol = (experts.find((item) => item.id === KOL_EXPERT_ID) || await fetchExpert(KOL_EXPERT_ID));
    if (!kol || kol.id !== KOL_EXPERT_ID) {
      setErr("没有 KOL推广，无法说明风险");
      return;
    }
    await onSummon(kol, approverRiskPrompt(row));
  };

  const onPrimary = (expert: Expert) => {
    if (expertCanSummon(expert)) {
      void onSummon(expert);
      return;
    }
    nav(expertDetailPath(expert.id));
  };

  if (routeId) {
    if (loading && !detail) {
      return (
        <div className="list-page agent-page expert-page" data-expert-page="detail">
          <p className="muted" data-expert-loading>正在加载数字员工…</p>
        </div>
      );
    }
    if (!detail) {
      return (
        <div className="list-page agent-page expert-page" data-expert-page="detail">
          {err ? (
            <div className="error" role="alert">
              <p>{err}</p>
              <button type="button" className="btn ghost sm" onClick={() => nav(0)}>重试</button>
            </div>
          ) : (
            <p className="muted agent-empty" data-expert-empty>没有这位数字员工。</p>
          )}
        </div>
      );
    }
    if (detail.kind === "collector" || detail.primary_entry === "job_console") {
      return <AgentCrawler expert={detail} />;
    }
    if (detail.kind === "governance" || detail.primary_entry === "approval_queue") {
      return <AgentApprover expert={detail} onExplainRisk={(row) => void onExplainRisk(row)} />;
    }
    return (
      <AgentKol
        expert={detail}
        busy={busyId === detail.id}
        error={err}
        onSummon={(row, prompt) => void onSummon(row, prompt)}
      />
    );
  }

  return (
    <div className="list-page agent-page expert-page" data-expert-page="roster">
      <div className="expert-hero">
        <h1>数字员工</h1>
        <p className="muted">三个岗位各有入口：跟进走思考会话，采集走作业台，审批走队列。</p>
      </div>

      {err && (
        <div className="error" role="alert">
          <p>{err}</p>
          <button type="button" className="btn ghost sm" onClick={loadList}>重试</button>
        </div>
      )}
      {loading && <p className="muted" data-expert-loading>正在加载数字员工…</p>}

      {!loading && !experts.length && (
        <p className="muted agent-empty" data-expert-empty>还没有可使用的数字员工。</p>
      )}

      {!loading && experts.length > 0 && (
        <div className="expert-list" data-expert-list="roster">
          {experts.map((expert) => (
            <RoleCard
              key={expert.id}
              expert={expert}
              busy={busyId === expert.id}
              onPrimary={onPrimary}
            />
          ))}
        </div>
      )}
    </div>
  );
}
