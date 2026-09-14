import { useMemo, useState } from "react";
import {
  OVERSEAS_DISCOVERY_PLATFORMS,
  candidateReason,
  createDiscoveryRequest,
  dismissCandidate,
  followCandidate,
  keywordsFromQuery,
  listRunCandidates,
  planSteps,
  planSummary,
  platformLabel,
  regionLabel,
  startDiscoveryRun,
  type CreatorCandidate,
  type DiscoveryFilters,
  type DiscoveryPhase,
  type DiscoveryPlatform,
  type DiscoveryRegion,
  type DiscoveryRequest,
} from "./discovery";

const REGIONS: DiscoveryRegion[] = ["all", "na", "eu", "sea"];

function formatFollowers(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

export default function DiscoveryPanel() {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<DiscoveryPlatform>("youtube");
  const [filters, setFilters] = useState<DiscoveryFilters>({
    region: "all",
    niche: "",
  });
  const [phase, setPhase] = useState<DiscoveryPhase>("idle");
  const [request, setRequest] = useState<DiscoveryRequest | null>(null);
  const [candidates, setCandidates] = useState<CreatorCandidate[]>([]);
  const [favorited, setFavorited] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingFollow, setPendingFollow] = useState<CreatorCandidate | null>(null);

  const visible = useMemo(
    () => candidates.filter((row) => row.status !== "dismissed"),
    [candidates],
  );

  const emptyHint = useMemo(() => {
    if (phase === "results" && !visible.length) return "这次计划没有找到候选人，可换关键词再试。";
    return "用一句话描述想找的达人，确认计划后才会开始检索。";
  }, [phase, visible.length]);

  const buildPlan = async () => {
    const text = query.trim();
    if (!text) {
      setError("先写一句想找的达人，再生成计划。");
      setPhase("error");
      return;
    }
    setBusy(true);
    setError("");
    setPendingFollow(null);
    try {
      const next = await createDiscoveryRequest({
        keywords: keywordsFromQuery(text),
        platforms: [platform],
        mode: "search",
        filters,
        start: false,
      });
      setRequest(next);
      setCandidates([]);
      setPhase("plan");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "计划没有生成，可稍后重试。");
      setPhase("error");
    } finally {
      setBusy(false);
    }
  };

  const confirmPlan = async () => {
    if (!request) return;
    setBusy(true);
    setError("");
    setPhase("running");
    try {
      const run = await startDiscoveryRun(request.id, { platform: request.platforms[0] });
      if (run.status === "failed" || run.status === "cancelled") {
        setError(run.error || "检索没有完成，可调整条件后重试。");
        setPhase("error");
        return;
      }
      const page = await listRunCandidates(run.id, { status: "suggested", limit: 20, offset: 0 });
      setCandidates(page.items);
      setPhase("results");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "检索没有完成，可调整条件后重试。");
      setPhase("error");
    } finally {
      setBusy(false);
    }
  };

  const confirmFollow = async () => {
    if (!pendingFollow) return;
    const id = pendingFollow.id;
    const followed = await followCandidate(id);
    setCandidates((current) => current.map((row) => (row.id === id ? followed : row)));
    setPendingFollow(null);
  };

  const onDismiss = async (candidate: CreatorCandidate) => {
    const next = await dismissCandidate(candidate.id);
    setCandidates((current) => current.map((row) => (row.id === candidate.id ? next : row)));
  };

  return (
    <section
      className="home-mode-pane discovery-pane"
      data-home-pane="discovery"
      data-discovery-panel
      data-discovery-phase={phase}
      data-discovery-live="false"
    >
      <form
        className="discovery-form"
        data-discovery-form
        onSubmit={(event) => {
          event.preventDefault();
          void buildPlan();
        }}
      >
        <label className="discovery-query-label">
          <span className="home-lane-label">想找什么样的达人</span>
          <textarea
            className="discovery-query"
            data-discovery-query
            rows={2}
            value={query}
            placeholder="例如：找北美户外电源评测达人"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="discovery-filters" data-discovery-filters>
          <label>
            <span>平台</span>
            <select
              data-discovery-filter="platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as DiscoveryPlatform)}
            >
              {OVERSEAS_DISCOVERY_PLATFORMS.map((value) => (
                <option key={value} value={value}>{platformLabel(value)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>地区</span>
            <select
              data-discovery-filter="region"
              value={String(filters.region || "all")}
              onChange={(event) => setFilters((current) => ({
                ...current,
                region: event.target.value as DiscoveryRegion,
              }))}
            >
              {REGIONS.map((value) => (
                <option key={value} value={value}>{regionLabel(value)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>方向</span>
            <input
              data-discovery-filter="niche"
              value={String(filters.niche || "")}
              placeholder="可选，如户外电源"
              onChange={(event) => setFilters((current) => ({ ...current, niche: event.target.value }))}
            />
          </label>
        </div>
        <div className="discovery-form-actions">
          <button type="submit" className="btn work sm" data-discovery-plan disabled={busy}>
            生成计划
          </button>
        </div>
      </form>

      {phase === "idle" ? (
        <div className="task-empty" data-discovery-empty="idle">
          <strong>先确认计划，再看候选人</strong>
          <p>{emptyHint}</p>
        </div>
      ) : null}

      {phase === "plan" && request ? (
        <section className="discovery-plan" data-discovery-plan-card data-discovery-request={request.id}>
          <strong>检索计划</strong>
          <p data-discovery-plan-summary>{planSummary(request)}</p>
          <ol data-discovery-plan-steps>
            {planSteps(request).map((step) => (
              <li key={step.id}>{step.label}</li>
            ))}
          </ol>
          <p className="discovery-quiet" data-discovery-no-live>
            确认后只检索候选人，不会自动发信或改阶段。
          </p>
          <div className="discovery-plan-actions">
            <button type="button" className="btn work sm" data-discovery-confirm-plan disabled={busy} onClick={() => void confirmPlan()}>
              确认并开始
            </button>
            <button type="button" className="btn ghost sm" data-discovery-cancel-plan disabled={busy} onClick={() => setPhase("idle")}>
              返回修改
            </button>
          </div>
        </section>
      ) : null}

      {phase === "running" ? (
        <section className="task-empty" data-discovery-loading role="status" aria-busy="true">
          <strong>检索中</strong>
          <p>正在按已确认的计划找候选人，不会改正式阶段。</p>
        </section>
      ) : null}

      {phase === "error" ? (
        <section className="task-empty" data-discovery-error role="alert">
          <strong>检索没有完成</strong>
          <p>{error || "可调整条件后重试。"}</p>
          <button type="button" className="btn work sm" data-discovery-retry onClick={() => void buildPlan()}>
            重试
          </button>
        </section>
      ) : null}

      {phase === "results" && !visible.length ? (
        <div className="task-empty" data-discovery-empty="results">
          <strong>没有候选人</strong>
          <p>{emptyHint}</p>
        </div>
      ) : null}

      {phase === "results" && visible.length ? (
        <ol className="discovery-candidate-list" data-discovery-candidates>
          {visible.map((candidate) => (
            <li key={candidate.id}>
              <article
                className="discovery-candidate"
                data-discovery-candidate={candidate.handle}
                data-discovery-origin="discovery"
                data-candidate-id={candidate.id}
                data-candidate-status={candidate.status}
              >
                <div className="discovery-candidate-copy">
                  <strong>@{candidate.handle}</strong>
                  <p className="discovery-candidate-meta">
                    {candidate.nickname} · {platformLabel(candidate.platform)} · {formatFollowers(candidate.followers)}
                    {candidate.score ? ` · 评分 ${candidate.score}` : ""}
                  </p>
                  <p className="discovery-candidate-reason">{candidateReason(candidate)}</p>
                  {candidate.status === "followed" ? (
                    <p className="discovery-quiet" data-discovery-followed>
                      已确认跟进意向。模拟环境不会写进「我跟进的红人」；接上接口后才会建合作。
                    </p>
                  ) : null}
                </div>
                <div className="discovery-candidate-actions">
                  <button
                    type="button"
                    className="btn ghost sm"
                    data-discovery-favorite={candidate.id}
                    aria-pressed={Boolean(favorited[candidate.id])}
                    onClick={() => setFavorited((current) => ({ ...current, [candidate.id]: !current[candidate.id] }))}
                  >
                    {favorited[candidate.id] ? "已收藏" : "收藏"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    data-discovery-dismiss={candidate.id}
                    disabled={candidate.status === "followed"}
                    onClick={() => void onDismiss(candidate)}
                  >
                    忽略
                  </button>
                  <button
                    type="button"
                    className="btn work sm"
                    data-discovery-follow={candidate.id}
                    disabled={candidate.status === "followed"}
                    onClick={() => setPendingFollow(candidate)}
                  >
                    {candidate.status === "followed" ? "已确认跟进" : "加入跟进"}
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : null}

      {pendingFollow ? (
        <div className="discovery-confirm-layer" data-discovery-follow-confirm>
          <div className="discovery-confirm">
            <strong>确认加入跟进？</strong>
            <p>
              把 @{pendingFollow.handle} 记为跟进意向。不会发信，也不会改正式阶段。接上发现接口后，确认才会建合作。
            </p>
            <div className="discovery-plan-actions">
              <button type="button" className="btn work sm" data-discovery-follow-yes onClick={() => void confirmFollow()}>
                确认加入跟进
              </button>
              <button type="button" className="btn ghost sm" data-discovery-follow-no onClick={() => setPendingFollow(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
