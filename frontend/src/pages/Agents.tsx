import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  bindExpertSession,
  expertDetailPath,
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

const VIEWS: Array<{ id: ExpertView; label: string }> = [
  { id: "recommend", label: "推荐" },
  { id: "mine", label: "我的数字员工" },
  { id: "all", label: "全部数字员工" },
  { id: "search", label: "搜索" },
];

function joinList(items: string[]): string {
  return items.filter(Boolean).join(" · ");
}

function ExpertCard({
  expert,
  pinned,
  busy,
  onSummon,
  onPin,
}: {
  expert: Expert;
  pinned: boolean;
  busy: boolean;
  onSummon: (expert: Expert) => void;
  onPin: (id: string) => void;
}) {
  return (
    <article className="expert-card" data-expert-card={expert.id} data-expert-recommended={expert.recommended ? "1" : "0"}>
      <header className="expert-card-head">
        <div className="expert-card-titles">
          <h2>
            <Link to={expertDetailPath(expert.id)} data-expert-open={expert.id}>{expert.name}</Link>
          </h2>
          <p className="muted">{expert.mission}</p>
        </div>
        <button
          type="button"
          className="btn ghost sm"
          data-expert-pin={expert.id}
          aria-pressed={pinned}
          onClick={() => onPin(expert.id)}
        >
          {pinned ? "已固定" : "固定"}
        </button>
      </header>
      <dl className="expert-qa" data-expert-qa={expert.id}>
        <div>
          <dt>谁</dt>
          <dd>{expert.who}</dd>
        </div>
        {expert.good_at.length > 0 && (
          <div>
            <dt>擅长</dt>
            <dd>{joinList(expert.good_at)}</dd>
          </div>
        )}
        {expert.can_finish.length > 0 && (
          <div>
            <dt>能完成</dt>
            <dd>{joinList(expert.can_finish)}</dd>
          </div>
        )}
        {expert.how_to_start && (
          <div>
            <dt>怎么开始</dt>
            <dd>{expert.how_to_start}</dd>
          </div>
        )}
      </dl>
      <div className="expert-card-cta">
        <button
          type="button"
          className="btn work"
          data-expert-summon={expert.id}
          disabled={busy}
          onClick={() => onSummon(expert)}
        >
          {busy ? "正在召唤…" : "召唤专家"}
        </button>
      </div>
    </article>
  );
}

function emptyCopy(view: ExpertView, query: string): string {
  if (view === "mine") return "还没有召唤或固定过数字员工。去推荐或全部里召唤一位。";
  if (view === "search") return query.trim() ? "没有匹配的数字员工。" : "输入姓名、擅长或能完成的事。";
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
    if (next !== "search") nextParams.delete("q");
    setParams(nextParams, { replace: true });
  };

  const onPin = (id: string) => {
    const next = togglePinnedExpert(id);
    setPins(next);
    setPinTick((value) => value + 1);
  };

  const onSummon = async (expert: Expert) => {
    setBusyId(expert.id);
    setErr("");
    try {
      const summoned = await summonExpert(expert);
      bindExpertSession(summoned.session_id, expert, summoned);
      rememberSummonedExpert(expert.id);
      nav(`/s/${summoned.session_id}`, { state: { expertBound: true, expert: summoned } });
    } catch (error) {
      setErr(error instanceof Error ? error.message : "无法召唤专家");
      setBusyId(null);
    }
  };

  if (routeId) {
    return (
      <div className="list-page agent-page expert-page" data-expert-page="detail" data-visual="docs20">
        <div className="page-hero agent-hero">
          <div className="page-kicker">数字员工</div>
          <Link className="expert-back" to="/agents">← 全部数字员工</Link>
          <h1>{detail?.name || "数字员工"}</h1>
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
              <h2>使命</h2>
              <p>{detail.mission}</p>
            </section>
            {detail.good_at.length > 0 && (
              <section>
                <h2>擅长</h2>
                <p>{joinList(detail.good_at)}</p>
              </section>
            )}
            {detail.quick_prompts.length > 0 && (
              <section data-expert-prompts>
                <h2>你可以这样说</h2>
                <ul className="expert-prompt-list">
                  {detail.quick_prompts.map((prompt) => (
                    <li key={prompt}>{prompt}</li>
                  ))}
                </ul>
              </section>
            )}
            {detail.working_style && (
              <section>
                <h2>工作方式</h2>
                <p>{detail.working_style}</p>
              </section>
            )}
            <section className="expert-detail-summon">
              <h2>召唤</h2>
              <button
                type="button"
                className="btn work"
                data-expert-summon={detail.id}
                disabled={busyId === detail.id}
                onClick={() => void onSummon(detail)}
              >
                {busyId === detail.id ? "正在召唤…" : "召唤专家"}
              </button>
            </section>
          </article>
        )}
      </div>
    );
  }

  return (
    <div className="list-page agent-page expert-page" data-expert-page={view} data-visual="docs20">
      <div className="page-hero agent-hero">
        <div className="page-kicker">数字员工</div>
        <h1>数字员工</h1>
        <p className="muted">选一位专家，召唤进会话后交代这一件。发送和改阶段仍要你确认。</p>
      </div>

      <div className="agent-tabs" role="tablist" aria-label="数字员工">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={"agent-tab" + (view === item.id ? " on" : "")}
            aria-selected={view === item.id}
            data-expert-view={item.id}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === "search" && (
        <label className="expert-search">
          <span className="muted">搜索</span>
          <input
            type="search"
            value={query}
            data-expert-search
            placeholder="搜姓名、擅长或能完成的事"
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              const nextParams = new URLSearchParams(params);
              nextParams.set("view", "search");
              if (next.trim()) nextParams.set("q", next);
              else nextParams.delete("q");
              setParams(nextParams, { replace: true });
            }}
          />
        </label>
      )}

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
            />
          ))}
        </div>
      )}
    </div>
  );
}
