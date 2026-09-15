import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DISCOVERY_FILTERS,
  DIRECTION_PRESETS,
  DISCOVERY_REGION_OPTIONS,
  MAX_DIRECTION_CHARS,
  MAX_DIRECTIONS,
  OVERSEAS_DISCOVERY_PLATFORMS,
  addDirections,
  candidateMatchesFollowFilter,
  candidateMetrics,
  candidateReason,
  createDiscoveryRequest,
  distinctNickname,
  discoveryEmptyCopy,
  dismissCandidate,
  followCandidate,
  followCandidatesBatch,
  guessPlatformFromQuery,
  guessRegionFromQuery,
  keywordsFromQuery,
  missingContactEmail,
  parseFollowFilterInput,
  planSteps,
  planSummary,
  platformLabel,
  presentDiscoveryError,
  regionLabel,
  splitDirectionDraft,
  startDiscoveryRun,
  summarizeFollowFilter,
  waitForDiscoveryResults,
  type CreatorCandidate,
  type DiscoveryErrorView,
  type DiscoveryFilters,
  type DiscoveryFollowBatchResult,
  type DiscoveryPhase,
  type DiscoveryPlatform,
  type DiscoveryRequest,
  type FollowFilter,
} from "./discovery";
import { DiscoveryFollowConfirm } from "./DiscoveryFollowConfirm";
import { useViewMode } from "../viewMode";

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
  const [followError, setFollowError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [minFollowers, setMinFollowers] = useState("");
  const [minAvgViews, setMinAvgViews] = useState("");
  const [minScore, setMinScore] = useState("");
  const [pendingBatch, setPendingBatch] = useState<"selected" | "conditional" | null>(null);
  const [batchResult, setBatchResult] = useState<DiscoveryFollowBatchResult | null>(null);
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
  const suggested = useMemo(
    () => visible.filter((row) => row.status === "suggested"),
    [visible],
  );
  const followFilter = useMemo(
    () => parseFollowFilterInput({
      min_followers: minFollowers,
      min_avg_views_10: minAvgViews,
      min_score: minScore,
    }),
    [minFollowers, minAvgViews, minScore],
  );
  const planForFilter = useMemo(() => ({
    platforms: request?.platforms || [],
    region: request?.filters?.region || "all",
  }), [request]);
  const previewMatches = useMemo(
    () => suggested.filter((row) => candidateMatchesFollowFilter(row, followFilter, planForFilter)),
    [suggested, followFilter, planForFilter],
  );
  const selectedCandidates = useMemo(
    () => suggested.filter((row) => selectedIds.includes(row.id)),
    [suggested, selectedIds],
  );
  const pendingBatchCandidates = pendingBatch === "conditional" ? previewMatches : selectedCandidates;
  const pendingMissingEmail = pendingBatchCandidates.filter(missingContactEmail).length;
  const pendingFilterSummary = pendingBatch === "conditional" ? summarizeFollowFilter(followFilter) : "";

  const emptyHint = useMemo(() => {
    if (phase === "results" && !visible.length) {
      return discoveryEmptyCopy({
        empty_hint: emptyHintFromApi,
        search_keywords: searchKeywords,
      });
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
      setSelectedIds([]);
      setBatchResult(null);
      setPendingBatch(null);
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
      setSelectedIds([]);
      setBatchResult(null);
      setPendingBatch(null);
      setSearchKeywords(results.search_keywords || results.run?.search_keywords || []);
      setEmptyHintFromApi(results.empty_hint || results.run?.empty_hint || null);
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
    if (!pendingFollow || followBusy) return;
    const id = pendingFollow.id;
    setFollowBusy(true);
    setFollowError(null);
    try {
      const followed = await followCandidate(id, { confirmed: true });
      setCandidates((current) => current.map((row) => (row.id === id ? followed : row)));
      setSelectedIds((current) => current.filter((item) => item !== id));
      setPendingFollow(null);
    } catch (caught) {
      const view = presentDiscoveryError(caught, "加入跟进没有完成，红人档案未写入，也未建立合作。");
      setFollowError(view.message);
    } finally {
      setFollowBusy(false);
    }
  };

  const toggleSelected = (id: string, on: boolean) => {
    setSelectedIds((current) => {
      if (on) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });
  };

  const toggleSelectAll = (on: boolean) => {
    setSelectedIds(on ? suggested.map((row) => row.id) : []);
  };

  const openBatchConfirm = (mode: "selected" | "conditional") => {
    setFollowError(null);
    setBatchResult(null);
    setPendingFollow(null);
    setPendingBatch(mode);
  };

  const confirmBatchFollow = async () => {
    if (!pendingBatch || followBusy || !request) return;
    const ids = pendingBatchCandidates.map((row) => row.id);
    if (!ids.length) {
      setFollowError("没有符合条件的线索。");
      return;
    }
    setFollowBusy(true);
    setFollowError(null);
    try {
      const filter: FollowFilter | undefined = pendingBatch === "conditional"
        ? {
            ...(followFilter || {}),
            ...(planForFilter.platforms.length === 1 ? { platform: planForFilter.platforms[0] } : {}),
            ...(planForFilter.region && planForFilter.region !== "all" ? { region: planForFilter.region } : {}),
          }
        : undefined;
      const result = await followCandidatesBatch({
        confirmed: true,
        candidate_ids: ids,
        request_id: request.id,
        filter: filter && Object.keys(filter).length ? filter : undefined,
      });
      const updates = new Map<string, CreatorCandidate>();
      for (const row of [...result.followed, ...result.skipped_duplicate]) {
        updates.set(row.id, row);
      }
      setCandidates((current) => current.map((row) => updates.get(row.id) || row));
      setSelectedIds((current) => current.filter((id) => !updates.has(id)));
      setBatchResult(result);
      if (!result.failed.length) setPendingBatch(null);
    } catch (caught) {
      const view = presentDiscoveryError(caught, "加入跟进没有完成，红人档案未写入，也未建立合作。");
      setFollowError(view.message);
    } finally {
      setFollowBusy(false);
    }
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
        <div
          className="discovery-filters"
          data-discovery-filters
          aria-label="检索条件，已识别并可调整"
        >
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
            <button
              type="button"
              className="discovery-filters-reset"
              data-discovery-reset
              onClick={resetConditions}
            >
              重置条件
            </button>
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
        <label className="discovery-query-label">
          <span className="home-lane-label">想找什么样的达人</span>
          <span className="discovery-query-row">
            <textarea
              className="discovery-query"
              data-discovery-query
              rows={1}
              value={query}
              placeholder="例如：找北美户外电源评测达人"
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <button type="submit" className="btn work sm" data-discovery-plan disabled={busy}>
              生成计划
            </button>
          </span>
        </label>
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
          <div className="discovery-plan-head">
            <strong>检索计划</strong>
            <p data-discovery-plan-summary>{planSummary(request)}</p>
          </div>
          <div className="discovery-plan-actions">
            <button type="button" className="btn work sm" data-discovery-confirm-plan disabled={busy} onClick={() => void confirmPlan()}>
              确认并开始
            </button>
            <button type="button" className="btn ghost sm" data-discovery-cancel-plan disabled={busy} onClick={() => setPhase("idle")}>
              返回修改
            </button>
          </div>
          <p className="discovery-quiet" data-discovery-no-live>
            确认后只检索红人线索，不会自动发信、改阶段或写成待办。
          </p>
          <ol data-discovery-plan-steps>
            {planSteps(request).map((step) => (
              <li key={step.id}>{step.label}</li>
            ))}
          </ol>
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
          <li className="discovery-batch-bar" data-discovery-batch-bar>
            <div className="discovery-batch-select">
              <label className="discovery-candidate-select">
                <input
                  type="checkbox"
                  data-discovery-select-all
                  checked={suggested.length > 0 && selectedIds.length === suggested.length}
                  disabled={!suggested.length}
                  onChange={(event) => toggleSelectAll(event.target.checked)}
                />
                <span>已选 {selectedCandidates.length} 人</span>
              </label>
              <button
                type="button"
                className="btn work sm"
                data-discovery-batch-follow
                disabled={!selectedCandidates.length || followBusy}
                onClick={() => openBatchConfirm("selected")}
              >
                按所选加入跟进
              </button>
            </div>
            <div className="discovery-batch-conditions" data-discovery-batch-conditions>
              <span className="discovery-filter-title">按条件加入</span>
              <label className="discovery-threshold">
                <span>粉丝 ≥</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  data-discovery-threshold-followers
                  value={minFollowers}
                  placeholder="N"
                  onChange={(event) => setMinFollowers(event.target.value)}
                />
              </label>
              <label className="discovery-threshold">
                <span>近10均播 ≥</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  data-discovery-threshold-avg-views
                  value={minAvgViews}
                  placeholder="M"
                  onChange={(event) => setMinAvgViews(event.target.value)}
                />
              </label>
              <label className="discovery-threshold">
                <span>评分 ≥</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  data-discovery-threshold-score
                  value={minScore}
                  placeholder="S"
                  onChange={(event) => setMinScore(event.target.value)}
                />
              </label>
              <p className="discovery-quiet" data-discovery-preview-count>
                符合条件 {previewMatches.length} 人
              </p>
              <button
                type="button"
                className="btn work sm"
                data-discovery-conditional-follow
                disabled={!previewMatches.length || followBusy}
                onClick={() => openBatchConfirm("conditional")}
              >
                按条件加入跟进
              </button>
            </div>
            <div className="discovery-batch-plan" data-discovery-batch-plan>
              <span className="discovery-filter-title">当前计划</span>
              <div className="discovery-chip-row" data-discovery-filter="plan-platform">
                {OVERSEAS_DISCOVERY_PLATFORMS.map((value) => (
                  <span
                    key={value}
                    className="discovery-chip"
                    data-discovery-plan-chip={value}
                    aria-pressed={request?.platforms.includes(value) || undefined}
                  >
                    {platformLabel(value)}
                  </span>
                ))}
              </div>
              <div className="discovery-chip-row" data-discovery-filter="plan-region">
                {DISCOVERY_REGION_OPTIONS.map((option) => (
                  <span
                    key={option.value}
                    className="discovery-chip"
                    data-discovery-plan-chip={option.value}
                    aria-pressed={(request?.filters?.region || "all") === option.value || undefined}
                  >
                    {option.label}
                  </span>
                ))}
              </div>
              <p className="discovery-quiet">平台 / 地区沿用发现计划，不另设一套。</p>
            </div>
          </li>
          {visible.map((candidate) => {
            const nickname = distinctNickname(candidate);
            const metrics = candidateMetrics(candidate);
            const reason = candidateReason(candidate);
            return (
              <li key={candidate.id}>
                <article
                  className="discovery-candidate"
                  data-discovery-candidate={candidate.handle}
                  data-discovery-origin="discovery"
                  data-candidate-id={candidate.id}
                  data-candidate-status={candidate.status}
                  data-discovery-preview={
                    candidate.status === "suggested" && !candidateMatchesFollowFilter(candidate, followFilter, planForFilter)
                      ? "out"
                      : "in"
                  }
                >
                  {candidate.status === "suggested" ? (
                    <label className="discovery-candidate-select">
                      <input
                        type="checkbox"
                        data-discovery-select={candidate.id}
                        checked={selectedIds.includes(candidate.id)}
                        onChange={(event) => toggleSelected(candidate.id, event.target.checked)}
                      />
                      <span className="sr-only">选择 @{candidate.handle}</span>
                    </label>
                  ) : <span className="discovery-candidate-select" />}
                  <div className="discovery-candidate-copy">
                    <strong className="discovery-candidate-identity" data-discovery-candidate-identity>
                      <span className="discovery-candidate-handle">@{candidate.handle}</span>
                      {nickname ? (
                        <span className="discovery-candidate-nickname">{nickname}</span>
                      ) : null}
                    </strong>
                    {metrics ? (
                      <p className="discovery-candidate-meta" data-discovery-candidate-meta>{metrics}</p>
                    ) : null}
                    {reason ? (
                      <p className="discovery-candidate-reason" data-discovery-candidate-reason>{reason}</p>
                    ) : null}
                    {candidate.status === "followed" ? (
                      <p className="discovery-quiet" data-discovery-followed>
                        已加入跟进。已写入红人档案并建立合作，不会发信或改阶段。
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
                      onClick={() => {
                        setFollowError(null);
                        setBatchResult(null);
                        setPendingBatch(null);
                        setPendingFollow(candidate);
                      }}
                    >
                      {candidate.status === "followed" ? "已确认跟进" : "加入跟进"}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      ) : null}

      <DiscoveryFollowConfirm
        open={Boolean(pendingFollow)}
        mode="single"
        busy={followBusy}
        error={followError}
        onConfirm={() => void confirmFollow()}
        onCancel={() => {
          setPendingFollow(null);
          setFollowError(null);
        }}
      >
        <p>
          把 @{pendingFollow?.handle} 加入跟进并写入红人档案。不会发信，也不会改正式阶段。只有写入成功后才会建立合作。
        </p>
      </DiscoveryFollowConfirm>

      <DiscoveryFollowConfirm
        open={Boolean(pendingBatch)}
        mode={pendingBatch || "selected"}
        busy={followBusy}
        error={followError}
        confirmDisabled={!pendingBatchCandidates.length}
        onConfirm={() => void confirmBatchFollow()}
        onCancel={() => {
          setPendingBatch(null);
          setBatchResult(null);
          setFollowError(null);
        }}
      >
        <p data-discovery-batch-summary>
          将把 {pendingBatchCandidates.length} 条线索加入跟进并写入红人档案。
          其中 <span data-discovery-missing-email-count>{pendingMissingEmail}</span> 条没有联系邮箱（仍会写入，不会编造邮箱）。
          {pendingFilterSummary ? ` 门槛：${pendingFilterSummary}。` : ""}
          平台 / 地区沿用当前计划
          {request?.platforms?.length ? `（${request.platforms.map(platformLabel).join("、")}）` : ""}
          {request?.filters?.region && request.filters.region !== "all"
            ? ` · ${regionLabel(request.filters.region)}`
            : ""}
          。不会发信，也不会改正式阶段。只有写入成功后才会建立合作。
        </p>
        {batchResult?.failed.length ? (
          <p className="discovery-quiet" data-discovery-batch-partial role="status">
            已加入 {batchResult.counts.followed} 人，未加入 {batchResult.counts.failed} 人
            {batchResult.counts.skipped_duplicate ? `，已跟进跳过 ${batchResult.counts.skipped_duplicate} 人` : ""}
            。未成功的线索不会标成已跟进。
          </p>
        ) : null}
      </DiscoveryFollowConfirm>
    </section>
  );
}
