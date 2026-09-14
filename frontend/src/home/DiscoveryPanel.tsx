import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DISCOVERY_FILTERS,
  DIRECTION_PRESETS,
  DISCOVERY_REGION_OPTIONS,
  MAX_DIRECTION_CHARS,
  MAX_DIRECTIONS,
  OVERSEAS_DISCOVERY_PLATFORMS,
  addDirections,
  candidateReason,
  createDiscoveryRequest,
  dismissCandidate,
  emptyResultsHint,
  followCandidate,
  guessPlatformFromQuery,
  guessRegionFromQuery,
  keywordsFromQuery,
  planSteps,
  planSummary,
  platformLabel,
  presentDiscoveryError,
  splitDirectionDraft,
  startDiscoveryRun,
  waitForDiscoveryResults,
  type CreatorCandidate,
  type DiscoveryErrorView,
  type DiscoveryFilters,
  type DiscoveryPhase,
  type DiscoveryPlatform,
  type DiscoveryRequest,
} from "./discovery";
import { useViewMode } from "../viewMode";

function formatFollowers(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

export default function DiscoveryPanel() {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<DiscoveryPlatform>("youtube");
  const [filters, setFilters] = useState<DiscoveryFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [addOpen, setAddOpen] = useState(false);
  const [directionDraft, setDirectionDraft] = useState("");
  const platformTouched = useRef(false);
  const regionTouched = useRef(false);
  const addWrapRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<DiscoveryPhase>("idle");
  const [request, setRequest] = useState<DiscoveryRequest | null>(null);
  const [candidates, setCandidates] = useState<CreatorCandidate[]>([]);
  const [favorited, setFavorited] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<DiscoveryErrorView | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingFollow, setPendingFollow] = useState<CreatorCandidate | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchKeywords, setSearchKeywords] = useState<string[]>([]);
  const [emptyHintFromApi, setEmptyHintFromApi] = useState<string | null>(null);
  const { debug } = useViewMode();

  const showError = (raw: unknown, fallback: string) => {
    setDetailOpen(false);
    setError(presentDiscoveryError(raw, fallback));
  };

  const visible = useMemo(
    () => candidates.filter((row) => row.status !== "dismissed"),
    [candidates],
  );

  const emptyHint = useMemo(() => {
    if (phase === "results" && !visible.length) {
      return emptyHintFromApi || emptyResultsHint(searchKeywords);
    }
    return "用一句话描述想找的达人。确认计划后只检索线索，不会写成待办，也不会自动建合作。";
  }, [phase, visible.length, emptyHintFromApi, searchKeywords]);

  const atDirectionMax = filters.directions.length >= MAX_DIRECTIONS;

  useEffect(() => {
    if (phase !== "error") return;
    errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [phase, error?.kind]);

  useEffect(() => {
    if (!addOpen) return;
    addInputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (addWrapRef.current && !addWrapRef.current.contains(event.target as Node)) {
        setAddOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [addOpen]);

  const applyDirections = (incoming: Iterable<string>) => {
    setFilters((current) => {
      const next = addDirections(current.directions, incoming);
      return { ...current, directions: next.directions };
    });
  };

  const commitDirectionDraft = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    applyDirections([name]);
    setDirectionDraft("");
  };

  const onDirectionDraftChange = (raw: string) => {
    const { complete, rest } = splitDirectionDraft(raw);
    if (complete.length) applyDirections(complete);
    setDirectionDraft(rest.slice(0, MAX_DIRECTION_CHARS));
  };

  const onQueryChange = (text: string) => {
    setQuery(text);
    if (!platformTouched.current) {
      const guessed = guessPlatformFromQuery(text);
      if (guessed) setPlatform(guessed);
    }
    if (!regionTouched.current) {
      const guessed = guessRegionFromQuery(text);
      if (guessed) setFilters((current) => ({ ...current, region: guessed }));
    }
  };

  const resetConditions = () => {
    platformTouched.current = false;
    regionTouched.current = false;
    setPlatform("youtube");
    setFilters({ region: "all", directions: [] });
    setAddOpen(false);
  };

  const buildPlan = async () => {
    setAddOpen(false);
    const text = query.trim();
    if (!text) {
      showError("先写一句想找的达人，再生成计划。", "先写一句想找的达人，再生成计划。");
      setPhase("error");
      return;
    }
    setBusy(true);
    setError(null);
    setDetailOpen(false);
    setPendingFollow(null);
    try {
      const next = await createDiscoveryRequest({
        keywords: keywordsFromQuery(text),
        platforms: [platform],
        mode: "search",
        filters: { region: filters.region, directions: filters.directions },
      });
      setRequest(next);
      setCandidates([]);
      setSearchKeywords([]);
      setEmptyHintFromApi(null);
      setPhase("plan");
    } catch (caught) {
      showError(caught, "计划没有生成，可稍后重试。");
      setPhase("error");
    } finally {
      setBusy(false);
    }
  };

  const confirmPlan = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    setDetailOpen(false);
    setPhase("running");
    try {
      const run = await startDiscoveryRun(request.id, { platform: request.platforms[0] });
      if (run.status === "failed" || run.status === "cancelled") {
        showError(run.error || "检索没有完成，可调整条件后重试。", "检索没有完成，可调整条件后重试。");
        setPhase("error");
        return;
      }
      const results = await waitForDiscoveryResults(request.id);
      setRequest(results.request);
      setCandidates(results.candidates);
      setSearchKeywords(results.search_keywords || results.run?.search_keywords || []);
      setEmptyHintFromApi(results.empty_hint || null);
      if (String(results.run?.status || results.status) === "failed") {
        showError(
          results.run?.error || results.request.error || "检索没有完成，可调整条件后重试。",
          "检索没有完成，可调整条件后重试。",
        );
        setPhase("error");
        return;
      }
      setPhase("results");
    } catch (caught) {
      showError(caught, "检索没有完成，可调整条件后重试。");
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
      <p className="home-lane-label">红人线索</p>
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
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <div className="discovery-filters" data-discovery-filters>
          <div className="discovery-filters-toolbar">
            <p className="discovery-filters-hint">已识别并可调整</p>
            <button
              type="button"
              className="discovery-filters-reset"
              data-discovery-reset
              onClick={resetConditions}
            >
              重置条件
            </button>
          </div>

          <div className="discovery-filter-group" data-discovery-filter="platform">
            <span className="discovery-filter-title">平台</span>
            <div className="discovery-chip-row">
              {OVERSEAS_DISCOVERY_PLATFORMS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="discovery-chip"
                  data-discovery-chip={value}
                  aria-pressed={platform === value}
                  onClick={() => {
                    platformTouched.current = true;
                    setPlatform(value);
                  }}
                >
                  {platformLabel(value)}
                </button>
              ))}
            </div>
          </div>

          <div className="discovery-filter-group" data-discovery-filter="region">
            <span className="discovery-filter-title">地区</span>
            <div className="discovery-chip-row">
              {DISCOVERY_REGION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="discovery-chip"
                  data-discovery-chip={option.value}
                  aria-pressed={filters.region === option.value}
                  onClick={() => {
                    regionTouched.current = true;
                    setFilters((current) => ({ ...current, region: option.value }));
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="discovery-filter-group" data-discovery-filter="directions">
            <span className="discovery-filter-title">方向</span>
            <div className="discovery-chip-row">
              {filters.directions.map((name) => (
                <span
                  key={name}
                  className="discovery-chip discovery-chip-tag"
                  data-discovery-direction={name}
                >
                  <span>{name}</span>
                  <button
                    type="button"
                    className="discovery-chip-remove"
                    data-discovery-direction-remove={name}
                    aria-label={`删除方向：${name}`}
                    onClick={() => setFilters((current) => ({
                      ...current,
                      directions: current.directions.filter((item) => item !== name),
                    }))}
                  >
                    ×
                  </button>
                </span>
              ))}
              <div className="discovery-direction-add" ref={addWrapRef} data-open={addOpen || undefined}>
                <button
                  type="button"
                  className="discovery-chip discovery-chip-add"
                  data-discovery-add-direction
                  aria-expanded={addOpen}
                  aria-haspopup="dialog"
                  onClick={() => setAddOpen((open) => !open)}
                >
                  + 添加方向
                </button>
                {addOpen ? (
                  <div
                    className="discovery-direction-popover"
                    data-discovery-direction-popover
                    role="dialog"
                    aria-label="添加方向"
                  >
                    <input
                      ref={addInputRef}
                      className="discovery-direction-input"
                      data-discovery-direction-input
                      value={directionDraft}
                      placeholder="输入方向，回车添加"
                      maxLength={MAX_DIRECTION_CHARS}
                      onChange={(event) => onDirectionDraftChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setAddOpen(false);
                          return;
                        }
                        if (event.key === "Enter" || event.key === "," || event.key === "、") {
                          event.preventDefault();
                          event.stopPropagation();
                          commitDirectionDraft(directionDraft);
                        }
                      }}
                    />
                    <div className="discovery-chip-row discovery-preset-row">
                      {DIRECTION_PRESETS.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className="discovery-chip discovery-chip-preset"
                          data-discovery-preset={name}
                          aria-pressed={filters.directions.includes(name)}
                          disabled={atDirectionMax && !filters.directions.includes(name)}
                          onClick={() => {
                            applyDirections([name]);
                            setAddOpen(false);
                          }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    {atDirectionMax ? (
                      <p className="discovery-direction-limit" role="status">最多添加 8 个方向</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            {atDirectionMax && !addOpen ? (
              <p className="discovery-direction-limit" role="status">最多添加 8 个方向</p>
            ) : null}
          </div>
        </div>
        <div className="discovery-form-actions">
          <button type="submit" className="btn work sm" data-discovery-plan disabled={busy}>
            生成计划
          </button>
        </div>
      </form>

      {phase === "idle" ? (
        <div className="task-empty" data-discovery-empty="idle">
          <strong>先确认计划，再看红人线索</strong>
          <p>{emptyHint}</p>
        </div>
      ) : null}

      {phase === "plan" && request ? (
        <section
          className="discovery-plan"
          data-discovery-plan-card
          data-discovery-request={request.id}
          data-discovery-request-status={request.status}
        >
          <strong>检索计划</strong>
          <p data-discovery-plan-summary>{planSummary(request)}</p>
          <ol data-discovery-plan-steps>
            {planSteps(request).map((step) => (
              <li key={step.id}>{step.label}</li>
            ))}
          </ol>
          <p className="discovery-quiet" data-discovery-no-live>
            确认后只检索红人线索，不会自动发信、改阶段或写成待办。
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
          <p>正在按已确认的计划找红人线索，不会改正式阶段，也不会写成待办。</p>
        </section>
      ) : null}

      {phase === "error" ? (
        <section
          ref={errorRef}
          className="task-empty discovery-error"
          data-discovery-error
          data-discovery-error-kind={error?.kind || "generic"}
          role="alert"
        >
          <strong data-discovery-error-title>{error?.title || "检索没有完成"}</strong>
          <p data-discovery-error-message>{error?.message || "可调整条件后重试。"}</p>
          {error?.detail ? (
            debug ? (
              <p className="discovery-error-debug" data-discovery-error-detail data-open="true">
                {error.detail}
              </p>
            ) : (
              <details
                className="discovery-error-detail"
                data-discovery-error-detail
                open={detailOpen}
                onToggle={(event) => setDetailOpen(event.currentTarget.open)}
              >
                <summary>查看详情</summary>
                <pre>{error.detail}</pre>
              </details>
            )
          ) : null}
          <div className="discovery-error-actions">
            <button
              type="button"
              className="btn work sm"
              data-discovery-retry
              disabled={busy || Boolean(error?.retryDisabled)}
              onClick={() => void buildPlan()}
            >
              重试
            </button>
            {error?.checkConnection ? (
              <button
                type="button"
                className="btn ghost sm"
                data-discovery-check-connection
                disabled={busy}
                onClick={() => setDetailOpen(true)}
              >
                检查连接
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {phase === "results" && !visible.length ? (
        <div
          className="task-empty"
          data-discovery-empty="results"
          data-discovery-search-keywords={searchKeywords.join(" / ")}
        >
          <strong>没有红人线索</strong>
          <p data-discovery-empty-hint>{emptyHint}</p>
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
                      已加入跟进。加入跟进才建合作，不会发信或改阶段。
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
              把 @{pendingFollow.handle} 记为跟进意向。不会发信，也不会改正式阶段。加入跟进后才会建合作。
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
