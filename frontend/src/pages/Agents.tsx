import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { storeComposerDraft } from "../components/ChatBlocks";
import {
  bindExpertSession,
  expertCanHelpCopy,
  expertDetailPath,
  expertMissionCopy,
  expertPromptExamples,
  expertRoleCopy,
  expertsForView,
  fetchExpert,
  fetchExperts,
  isExpertPinned,
  parseExpertView,
  rememberSummonedExpert,
  summonExpert,
  togglePinnedExpert,
  type Expert,
  type ExpertView,
} from "../experts";

const VIEWS: Array<{ id: Exclude<ExpertView, "search">; label: string }> = [
  { id: "recommend", label: "推荐" },
  { id: "mine", label: "我的数字员工" },
  { id: "all", label: "全部数字员工" },
];

function ExpertPin({
  expertId,
  pinned,
  onPin,
}: {
  expertId: string;
  pinned: boolean;
  onPin: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={"expert-pin" + (pinned ? " is-on" : "")}
      data-expert-pin={expertId}
      aria-pressed={pinned}
      aria-label={pinned ? "取消固定" : "固定"}
      title={pinned ? "已固定" : "固定"}
      onClick={() => onPin(expertId)}
    >
      <span aria-hidden="true">{pinned ? "★" : "☆"}</span>
      <span className="expert-pin-label">{pinned ? "已固定" : "固定"}</span>
    </button>
  );
}

function ExpertCard({
  expert,
  pinned,
  busy,
  onSummon,
  onPin,
  onPrompt,
}: {
  expert: Expert;
  pinned: boolean;
  busy: boolean;
  onSummon: (expert: Expert) => void;
  onPin: (id: string) => void;
  onPrompt: (expert: Expert, prompt: string) => void;
}) {
  const mission = expertMissionCopy(expert);
  const role = expertRoleCopy(expert);
  const skills = expert.good_at;
  const canHelp = expertCanHelpCopy(expert);
  const prompts = expertPromptExamples(expert);

  return (
    <article className="expert-card" data-expert-card={expert.id} data-expert-recommended={expert.recommended ? "1" : "0"}>
      <header className="expert-card-head">
        <div className="expert-card-titles">
          <h2>
            <Link to={expertDetailPath(expert.id)} data-expert-open={expert.id}>{expert.name}</Link>
          </h2>
          {role && role !== expert.name ? <p className="muted expert-card-role">{role}</p> : null}
        </div>
        <ExpertPin expertId={expert.id} pinned={pinned} onPin={onPin} />
      </header>

      <div className="expert-card-body" data-expert-qa={expert.id}>
        <section className="expert-block">
          <h3>岗位使命</h3>
          <p>{mission}</p>
        </section>
        {skills.length > 0 && (
          <section className="expert-block">
            <h3>擅长</h3>
            <ul className="expert-skill-list">
              {skills.map((skill) => (
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
        {prompts.length > 0 && (
          <section className="expert-block" data-expert-prompts>
            <h3>你可以这样说</h3>
            <div className="expert-prompt-chips">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="expert-prompt"
                  data-expert-prompt={expert.id}
                  disabled={busy}
                  onClick={() => onPrompt(expert, prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="expert-card-cta">
        <button
          type="button"
          className="btn work"
          data-expert-summon={expert.id}
          disabled={busy}
          onClick={() => onSummon(expert)}
        >
          {busy ? "正在召唤…" : "召唤专家"}
        </button>
      </footer>
    </article>
  );
}

function emptyCopy(view: ExpertView, query: string): string {
  if (view === "mine") return "还没有召唤或固定过数字员工。去推荐或全部里召唤一位。";
  if (view === "search") return query.trim() ? "没有匹配的数字员工。" : "输入岗位、擅长或要完成的结果。";
  return "还没有可召唤的数字员工。";
}

export default function Agents() {
  const nav = useNavigate();
  const { id: routeId } = useParams();
  const [params, setParams] = useSearchParams();
  const view = parseExpertView(params.get("view"));
  const [experts, setExperts] = useState<Expert[]>([]);
  const [detail, setDetail] = useState<Expert | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState(params.get("q") || "");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pins, setPins] = useState<string[]>(() => []);
  const [pinTick, setPinTick] = useState(0);

  const loadList = () => {
    setLoading(true);
    setErr("");
    void fetchExperts()
      .then((rows) => {
        setExperts(rows);
        setPins(rows.filter((row) => isExpertPinned(row.id)).map((row) => row.id));
      })
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
        if (row) setPins(isExpertPinned(row.id) ? [row.id] : []);
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

  const visible = useMemo(
    () => expertsForView(experts, view, query),
    [experts, pinTick, query, view],
  );

  const setView = (next: ExpertView) => {
    const nextParams = new URLSearchParams(params);
    if (next === "recommend") nextParams.delete("view");
    else nextParams.set("view", next);
    if (next !== "search") {
      nextParams.delete("q");
      setQuery("");
    }
    setParams(nextParams, { replace: true });
  };

  const onSearch = (next: string) => {
    setQuery(next);
    const nextParams = new URLSearchParams(params);
    if (next.trim()) {
      nextParams.set("view", "search");
      nextParams.set("q", next);
    } else {
      nextParams.delete("view");
      nextParams.delete("q");
    }
    setParams(nextParams, { replace: true });
  };

  const onPin = (id: string) => {
    const next = togglePinnedExpert(id);
    setPins(next);
    setPinTick((value) => value + 1);
  };

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
      setErr(error instanceof Error ? error.message : "无法召唤专家");
      setBusyId(null);
    }
  };

  if (routeId) {
    const mission = detail ? expertMissionCopy(detail) : "";
    const role = detail ? expertRoleCopy(detail) : "";
    const skills = detail?.good_at || [];
    const canHelp = detail ? expertCanHelpCopy(detail) : [];
    const prompts = detail ? expertPromptExamples(detail) : [];
    const pinned = Boolean(detail && (pins.includes(detail.id) || isExpertPinned(detail.id)));

    return (
      <div className="list-page agent-page expert-page" data-expert-page="detail">
        <div className="expert-hero">
          <Link className="expert-back" to="/agents">← 全部数字员工</Link>
          <div className="expert-hero-row">
            <div className="expert-hero-copy">
              <h1>{detail?.name || "数字员工"}</h1>
              {role && role !== detail?.name ? <p className="muted">{role}</p> : null}
            </div>
            {detail && (
              <div className="expert-hero-actions">
                <ExpertPin expertId={detail.id} pinned={pinned} onPin={onPin} />
                <button
                  type="button"
                  className="btn work"
                  data-expert-summon={detail.id}
                  disabled={busyId === detail.id}
                  onClick={() => void onSummon(detail)}
                >
                  {busyId === detail.id ? "正在召唤…" : "召唤专家"}
                </button>
              </div>
            )}
          </div>
        </div>
        {err && (
          <div className="error" role="alert">
            <p>{err}</p>
            <button type="button" className="btn ghost sm" onClick={() => nav(0)}>重试</button>
          </div>
        )}
        {loading && <p className="muted" data-expert-loading>正在加载数字员工…</p>}
        {!loading && !detail && !err && (
          <p className="muted agent-empty" data-expert-empty>没有这位数字员工。</p>
        )}
        {detail && (
          <article className="expert-detail" data-expert-detail={detail.id}>
            <section>
              <h2>岗位使命</h2>
              <p>{mission}</p>
            </section>
            {skills.length > 0 && (
              <section>
                <h2>擅长</h2>
                <ul className="expert-skill-list">
                  {skills.map((skill) => (
                    <li key={skill} className="expert-skill">{skill}</li>
                  ))}
                </ul>
              </section>
            )}
            {canHelp.length > 0 && (
              <section>
                <h2>可以帮你</h2>
                <ul className="expert-help-list">
                  {canHelp.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
            {prompts.length > 0 && (
              <section data-expert-prompts>
                <h2>你可以这样说</h2>
                <div className="expert-prompt-chips">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="expert-prompt"
                      data-expert-prompt={detail.id}
                      disabled={busyId === detail.id}
                      onClick={() => void onSummon(detail, prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </article>
        )}
      </div>
    );
  }

  return (
    <div className="list-page agent-page expert-page" data-expert-page={view}>
      <div className="expert-hero">
        <h1>数字员工</h1>
        <p className="muted">选择一个岗位，直接说你要完成什么结果。</p>
      </div>

      <div className="expert-toolbar">
        <div className="expert-tabs" role="tablist" aria-label="数字员工">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className={"expert-tab" + (view === item.id ? " on" : "")}
              aria-selected={view === item.id}
              data-expert-view={item.id}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="expert-search">
          <span className="sr-only">搜索数字员工</span>
          <input
            type="search"
            value={query}
            data-expert-search
            placeholder="搜岗位、擅长或要完成的结果"
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
      </div>

      {err && (
        <div className="error" role="alert">
          <p>{err}</p>
          <button type="button" className="btn ghost sm" onClick={loadList}>重试</button>
        </div>
      )}
      {loading && <p className="muted" data-expert-loading>正在加载数字员工…</p>}

      {!loading && !visible.length && (
        <p className="muted agent-empty" data-expert-empty={view}>{emptyCopy(view, query)}</p>
      )}

      {!loading && visible.length > 0 && (
        <div className="expert-list" data-expert-list={view}>
          {visible.map((expert) => (
            <ExpertCard
              key={expert.id}
              expert={expert}
              pinned={pins.includes(expert.id) || isExpertPinned(expert.id)}
              busy={busyId === expert.id}
              onSummon={(row) => void onSummon(row)}
              onPin={onPin}
              onPrompt={(row, prompt) => void onSummon(row, prompt)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
