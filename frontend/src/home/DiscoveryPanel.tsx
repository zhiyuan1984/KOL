import { useEffect, useMemo, useRef, useState } from "react";
import { recognizeElapsedSeconds } from "../waitStatus";
import { useViewMode } from "../viewMode";
import {
  DEFAULT_DISCOVERY_FILTERS,
  DIRECTION_PRESETS,
  DISCOVERY_CANCELLED_MESSAGE,
  DISCOVERY_CANCELLED_TITLE,
  DISCOVERY_REGION_OPTIONS,
  DISCOVERY_TIMEOUT_MESSAGE,
  DISCOVERY_TIMEOUT_TITLE,
  MAX_DIRECTION_CHARS,
  MAX_DIRECTIONS,
  OVERSEAS_DISCOVERY_PLATFORMS,
  addDirections,
  candidateMatchesFollowFilter,
  candidateMetrics,
  candidateReason,
  checkDiscoveryConnection,
  createDiscoveryRequest,
  DiscoveryWaitCancelledError,
  discoveryEmptyCopy,
  discoveryRunStatusLabel,
  dismissCandidate,
  distinctNickname,
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
  readDiscoveryFavorites,
  regionLabel,
  splitDirectionDraft,
  startDiscoveryRun,
  summarizeFollowFilter,
  waitForDiscoveryResults,
  writeDiscoveryFavorites,
  getDiscoveryResults,
  type CreatorCandidate,
  type DiscoveryConnection,
  type DiscoveryErrorView,
  type DiscoveryFilters,
  type DiscoveryFollowBatchResult,
  type DiscoveryPhase,
  type DiscoveryPlatform,
  type DiscoveryRecoverAction,
  type DiscoveryRequest,
  type DiscoveryResults,
  type DiscoveryRun,
  type FollowFilter,
} from "./discovery";
import { DiscoveryFollowConfirm } from "./DiscoveryFollowConfirm";

const LAST_DISCOVERY_REQUEST_KEY = "discovery:last-request-id";

export default function DiscoveryPanel() {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<DiscoveryPlatform>("youtube");
  const [filters, setFilters] = useState<DiscoveryFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [directionDraft, setDirectionDraft] = useState("");
  const platformTouched = useRef(false);
  const regionTouched = useRef(false);
  const conditionsRef = useRef<HTMLDivElement>(null);
  const advancedRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<DiscoveryPhase>("idle");
  const [request, setRequest] = useState<DiscoveryRequest | null>(null);
  const [candidates, setCandidates] = useState<CreatorCandidate[]>([]);
  const [favorited, setFavorited] = useState<Record<string, boolean>>(readDiscoveryFavorites);
  const [error, setError] = useState<DiscoveryErrorView | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const [waitNow, setWaitNow] = useState(() => Date.now());
  const [activeRun, setActiveRun] = useState<DiscoveryRun | null>(null);
  const [connectionCheck, setConnectionCheck] = useState<DiscoveryConnection | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const waitGen = useRef(0);
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
  const waitSeconds = recognizeElapsedSeconds(waitStartedAt, waitNow);
  const runStatus = String(activeRun?.status || "");
  const runLabel = discoveryRunStatusLabel(runStatus, activeRun?.status_label);

  const showError = (raw: unknown, fallback: string, recover: DiscoveryRecoverAction = "plan") => {
    setDetailOpen(false);
    setError(presentDiscoveryError(raw, fallback, recover));
  };

  const clearWait = () => {
    setWaitStartedAt(null);
    setActiveRun(null);
  };

  const toggleFavorite = (id: string) => {
    setFavorited((current) => {
      const next = { ...current, [id]: !current[id] };
      writeDiscoveryFavorites(next);
      return next;
    });
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
    if (phase !== "planning" && phase !== "running") return;
    setWaitNow(Date.now());
    const timer = window.setInterval(() => setWaitNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const lastId = (() => {
      try {
        return window.sessionStorage.getItem(LAST_DISCOVERY_REQUEST_KEY) || "";
      } catch {
        return "";
      }
    })();
    const loadExisting = async () => {
      if (!lastId) return;
      const results = await getDiscoveryResults(lastId);
      if (cancelled) return;
      const status = String(results.run?.status || results.status || "");
      if (status === "queued" || status === "running") {
        setRequest(results.request);
        setActiveRun(results.run);
        setPhase("running");
        setWaitStartedAt(Date.now());
        const gen = ++waitGen.current;
        void watchResults(lastId, gen);
        return;
      }
      applyTerminalResults(results);
    };
    void loadExisting().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Restore last batch via GET only. New analysis still POSTs /runs after confirm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!conditionsOpen && !advancedOpen && !rowMenuId) return;
    if (conditionsOpen) addInputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const el = event.target instanceof Element ? event.target : null;
      if (el?.closest("[data-discovery-add-condition], [data-discovery-advanced]")) return;
      if (conditionsOpen && conditionsRef.current && !conditionsRef.current.contains(target)) {
        setConditionsOpen(false);
      }
      if (advancedOpen && advancedRef.current && !advancedRef.current.contains(target)) {
        setAdvancedOpen(false);
      }
      if (rowMenuId) {
        const menu = document.querySelector(`[data-discovery-row-menu="${rowMenuId}"]`);
        if (menu && !menu.contains(target)) setRowMenuId(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setConditionsOpen(false);
      setAdvancedOpen(false);
      setRowMenuId(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [conditionsOpen, advancedOpen, rowMenuId]);

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
    setConditionsOpen(false);
    setAdvancedOpen(false);
  };

  const applyTerminalResults = (results: DiscoveryResults) => {
    setRequest((current) => ({
      ...results.request,
      id: results.request.id || current?.id || results.id,
      keywords: results.request.keywords.length ? results.request.keywords : current?.keywords || [],
      platforms: results.request.platforms.length ? results.request.platforms : current?.platforms || [],
    }));
    setActiveRun(results.run);
    setCandidates(results.candidates);
    setSelectedIds([]);
    setBatchResult(null);
    setPendingBatch(null);
    setSearchKeywords(results.search_keywords || results.run?.search_keywords || []);
    setEmptyHintFromApi(results.empty_hint || results.run?.empty_hint || null);
    const status = String(results.run?.status || results.status);
    if (status === "failed") {
      showError(
        results.run?.error || results.request.error || "检索没有完成，可调整条件后重试。",
        "检索没有完成，可调整条件后重试。",
        "confirm",
      );
      setPhase("error");
      return;
    }
    if (status === "cancelled") {
      showError("检索已取消。", "检索已取消，可再确认计划后重试。", "confirm");
      setPhase("error");
      return;
    }
    setError(null);
    setPhase("results");
  };

  const watchResults = async (requestId: string, gen: number) => {
    const ac = abortRef.current && !abortRef.current.signal.aborted
      ? abortRef.current
      : new AbortController();
    abortRef.current = ac;
    const ended = await waitForDiscoveryResults(requestId, {
      signal: ac.signal,
      onUpdate: (latest) => {
        if (gen !== waitGen.current) return;
        setRequest((current) => ({
          ...latest.request,
          id: latest.request.id || current?.id || requestId,
          keywords: latest.request.keywords.length ? latest.request.keywords : current?.keywords || [],
          platforms: latest.request.platforms.length ? latest.request.platforms : current?.platforms || [],
        }));
        setActiveRun(latest.run);
      },
    });
    if (gen !== waitGen.current) return;
    if (ended.reason === "cancelled") {
      setError({
        kind: "cancelled",
        title: DISCOVERY_CANCELLED_TITLE,
        message: DISCOVERY_CANCELLED_MESSAGE,
        detail: null,
        retryDisabled: false,
        checkConnection: false,
        recover: "wait",
        retryLabel: "继续等待",
      });
      setPhase("error");
      return;
    }
    if (ended.reason === "timeout") {
      setError({
        kind: "timeout",
        title: DISCOVERY_TIMEOUT_TITLE,
        message: DISCOVERY_TIMEOUT_MESSAGE,
        detail: null,
        retryDisabled: false,
        checkConnection: false,
        recover: "wait",
        retryLabel: "继续等待",
      });
      setPhase("error");
      return;
    }
    applyTerminalResults(ended.results);
  };

  const buildPlan = async () => {
    setConditionsOpen(false);
    setAdvancedOpen(false);
    const text = query.trim();
    if (!text) {
      showError("先写一句想找的达人，再生成计划。", "先写一句想找的达人，再生成计划。", "plan");
      setPhase("error");
      return;
    }
    waitGen.current += 1;
    abortRef.current?.abort();
    setBusy(true);
    setError(null);
    setDetailOpen(false);
    setConnectionCheck(null);
    setPendingFollow(null);
    setCandidates([]);
    setActiveRun(null);
    setPhase("planning");
    setWaitStartedAt(Date.now());
    try {
      const next = await createDiscoveryRequest({
        keywords: keywordsFromQuery(text),
        platforms: [platform],
        mode: "search",
        filters: { region: filters.region, directions: filters.directions },
      });
      setRequest(next);
      try {
        window.sessionStorage.setItem(LAST_DISCOVERY_REQUEST_KEY, next.id);
      } catch {
        /* ignore */
      }
      setSelectedIds([]);
      setBatchResult(null);
      setPendingBatch(null);
      setSearchKeywords([]);
      setEmptyHintFromApi(null);
      clearWait();
      setPhase("plan");
    } catch (caught) {
      showError(caught, "计划没有生成，可稍后重试。", "plan");
      setPhase("error");
    } finally {
      setBusy(false);
    }
  };

  const confirmPlan = async () => {
    if (!request) return;
    const gen = ++waitGen.current;
    abortRef.current?.abort();
    setBusy(true);
    setError(null);
    setDetailOpen(false);
    setConnectionCheck(null);
    setPhase("running");
    setWaitStartedAt(Date.now());
    setActiveRun({ id: "", status: "queued", status_label: "排队中" });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const run = await startDiscoveryRun(request.id, { platform: request.platforms[0] });
      if (gen !== waitGen.current) return;
      if (ac.signal.aborted) {
        showError(new DiscoveryWaitCancelledError(), "已停止等待检索结果。", "wait");
        setPhase("error");
        return;
      }
      setActiveRun(run);
      if (run.status === "failed" || run.status === "cancelled") {
        showError(
          run.error || "检索没有完成，可调整条件后重试。",
          "检索没有完成，可调整条件后重试。",
          "confirm",
        );
        setPhase("error");
        return;
      }
      await watchResults(request.id, gen);
    } catch (caught) {
      if (gen !== waitGen.current) return;
      showError(caught, "检索没有完成，可调整条件后重试。", "confirm");
      setPhase("error");
    } finally {
      if (gen === waitGen.current) setBusy(false);
    }
  };

  const resumeWait = async () => {
    if (!request) return;
    const gen = ++waitGen.current;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setBusy(true);
    setError(null);
    setDetailOpen(false);
    setConnectionCheck(null);
    setPhase("running");
    setWaitStartedAt(Date.now());
    try {
      await watchResults(request.id, gen);
    } catch (caught) {
      if (gen !== waitGen.current) return;
      showError(caught, "检索没有完成，可调整条件后重试。", "wait");
      setPhase("error");
    } finally {
      if (gen === waitGen.current) setBusy(false);
    }
  };

  const cancelWait = () => {
    abortRef.current?.abort();
  };

  const returnToPlan = () => {
    waitGen.current += 1;
    abortRef.current?.abort();
    setError(null);
    setConnectionCheck(null);
    clearWait();
    setPhase(request ? "plan" : "idle");
  };

  const onRetry = () => {
    const recover = error?.recover || (request ? "confirm" : "plan");
    if (recover === "wait") {
      void resumeWait();
      return;
    }
    if (recover === "confirm") {
      void confirmPlan();
      return;
    }
    void buildPlan();
  };

  const diagnoseConnection = async () => {
    setCheckingConnection(true);
    try {
      const next = await checkDiscoveryConnection();
      setConnectionCheck(next);
      if (String(next.status) === "ok") {
        setError((current) => (current ? { ...current, retryDisabled: false } : current));
      }
    } catch (caught) {
      const view = presentDiscoveryError(caught, "暂时无法完成连接检查。", error?.recover || "plan");
      setConnectionCheck({
        status: "unreachable",
        credentials_present: false,
        reachable: false,
        connected: false,
        message: view.message,
        status_label: "检查失败",
      });
    } finally {
      setCheckingConnection(false);
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
      const view = presentDiscoveryError(caught, "入库公海没有完成，红人档案未写入。");
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
      const view = presentDiscoveryError(caught, "入库公海没有完成，红人档案未写入。");
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
        <div className="discovery-filters" data-discovery-filters aria-label="检索条件">
          <div className="discovery-condition-bar">
            <div className="discovery-chip-row">
              <span className="discovery-chip discovery-chip-tag" data-discovery-active-chip={platform}>
                <button
                  type="button"
                  className="discovery-chip-label"
                  onClick={() => {
                    setAdvancedOpen(false);
                    setConditionsOpen(true);
                  }}
                >
                  {platformLabel(platform)}
                </button>
                <button
                  type="button"
                  className="discovery-chip-remove"
                  aria-label={`重置平台：${platformLabel(platform)}`}
                  onClick={() => {
                    platformTouched.current = true;
                    setPlatform("youtube");
                  }}
                >
                  ×
                </button>
              </span>
              <span className="discovery-chip discovery-chip-tag" data-discovery-active-chip={filters.region}>
                <button
                  type="button"
                  className="discovery-chip-label"
                  onClick={() => {
                    setAdvancedOpen(false);
                    setConditionsOpen(true);
                  }}
                >
                  {regionLabel(filters.region)}
                </button>
                <button
                  type="button"
                  className="discovery-chip-remove"
                  aria-label={`重置地区：${regionLabel(filters.region)}`}
                  onClick={() => {
                    regionTouched.current = true;
                    setFilters((current) => ({ ...current, region: "all" }));
                  }}
                >
                  ×
                </button>
              </span>
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
              <button
                type="button"
                className="discovery-chip discovery-chip-add"
                data-discovery-add-condition
                data-discovery-add-direction
                aria-expanded={conditionsOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  setAdvancedOpen(false);
                  setConditionsOpen((open) => !open);
                }}
              >
                ＋ 添加条件
              </button>
            </div>
            <div className="discovery-condition-meta">
              {phase === "results" && visible.length ? (
                <p className="discovery-match-count" data-discovery-preview-count>
                  {previewMatches.length} 位达人符合条件
                </p>
              ) : null}
              <button
                type="button"
                className="discovery-advanced-link"
                data-discovery-advanced
                aria-expanded={advancedOpen}
                onClick={() => {
                  setConditionsOpen(false);
                  setAdvancedOpen((open) => !open);
                }}
              >
                高级筛选
              </button>
              <button
                type="button"
                className="discovery-filters-reset"
                data-discovery-reset
                onClick={resetConditions}
              >
                重置条件
              </button>
            </div>
          </div>

          {conditionsOpen ? (
            <div
              className="discovery-condition-editor"
              data-discovery-condition-editor
              ref={conditionsRef}
              role="dialog"
              aria-label="添加条件"
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
                <div className="discovery-direction-editor">
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
                        setConditionsOpen(false);
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
                          setConditionsOpen(false);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {atDirectionMax ? (
                <p className="discovery-direction-limit" role="status">最多添加 8 个方向</p>
              ) : null}
            </div>
          ) : null}

          {advancedOpen ? (
            <div
              className="discovery-advanced-panel"
              data-discovery-advanced-panel
              data-discovery-batch-conditions
              ref={advancedRef}
              role="dialog"
              aria-label="高级筛选"
            >
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
                <span>均播 ≥</span>
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
                <span>匹配度 ≥</span>
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
              <button
                type="button"
                className="btn ghost sm"
                data-discovery-conditional-follow
                disabled={!previewMatches.length || followBusy || phase !== "results"}
                onClick={() => {
                  setAdvancedOpen(false);
                  openBatchConfirm("conditional");
                }}
              >
                按条件入库公海
              </button>
            </div>
          ) : atDirectionMax && !conditionsOpen ? (
            <p className="discovery-direction-limit" role="status">最多添加 8 个方向</p>
          ) : null}
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
            <button type="submit" className="btn ghost sm" data-discovery-plan disabled={busy}>
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

      {phase === "planning" ? (
        <section
          className="task-empty"
          data-discovery-planning
          data-wait-status="生成计划"
          role="status"
          aria-busy="true"
        >
          <strong>正在生成计划</strong>
          <p data-discovery-planning-reason>
            正在根据关键词和条件整理检索计划，不会启动采集，也不会写成待办。
            {waitSeconds ? ` 已等待 ${waitSeconds} 秒。` : ""}
          </p>
        </section>
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
        <section
          className="task-empty"
          data-discovery-loading
          data-discovery-run-status={runStatus || "queued"}
          data-wait-status={runLabel}
          role="status"
          aria-busy="true"
        >
          <strong data-discovery-run-label>{runLabel}</strong>
          <p data-discovery-running-reason>
            正在按已确认的计划找红人线索，不会改正式阶段，也不会写成待办。
            {waitSeconds ? ` 已用时 ${waitSeconds} 秒。` : ""}
          </p>
          <div className="discovery-error-actions">
            <button
              type="button"
              className="btn ghost sm"
              data-discovery-cancel-wait
              onClick={cancelWait}
            >
              取消等待
            </button>
          </div>
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
          {connectionCheck ? (
            <p
              className="discovery-quiet"
              data-discovery-connection-diagnosis
              data-connection-status={connectionCheck.status}
              role="status"
            >
              {connectionCheck.status_label || connectionCheck.status}
              {connectionCheck.message ? `：${connectionCheck.message}` : ""}
            </p>
          ) : null}
          <div className="discovery-error-actions">
            <button
              type="button"
              className="btn work sm"
              data-discovery-retry
              disabled={busy || Boolean(error?.retryDisabled)}
              onClick={() => void onRetry()}
            >
              {error?.retryLabel || "重试"}
            </button>
            <button
              type="button"
              className="btn ghost sm"
              data-discovery-cancel-error
              disabled={busy}
              onClick={returnToPlan}
            >
              返回修改
            </button>
            {error?.checkConnection ? (
              <button
                type="button"
                className="btn ghost sm"
                data-discovery-check-connection
                disabled={busy || checkingConnection}
                aria-busy={checkingConnection || undefined}
                onClick={() => void diagnoseConnection()}
              >
                {checkingConnection ? "正在检查…" : "检查连接"}
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
          <li
            className={"discovery-batch-bar" + (selectedCandidates.length ? " is-selecting" : "")}
            data-discovery-batch-bar
          >
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
                className={selectedCandidates.length ? "btn work sm" : "btn ghost sm"}
                data-discovery-batch-follow
                disabled={!selectedCandidates.length || followBusy}
                onClick={() => openBatchConfirm("selected")}
              >
                按所选入库公海
              </button>
            </div>
          </li>
          {visible.map((candidate) => {
            const nickname = distinctNickname(candidate);
            const metrics = candidateMetrics(candidate);
            const reason = candidateReason(candidate);
            const followed = candidate.status === "followed";
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
                      {candidate.platform ? (
                        <span className="discovery-chip discovery-chip-soft">{platformLabel(candidate.platform)}</span>
                      ) : null}
                    </strong>
                    {reason ? (
                      <p className="discovery-candidate-reason" data-discovery-candidate-reason>{reason}</p>
                    ) : null}
                    {metrics ? (
                      <p className="discovery-candidate-meta" data-discovery-candidate-meta>{metrics}</p>
                    ) : null}
                    {followed ? (
                      <p className="discovery-quiet" data-discovery-followed>
                        已写入红人档案（公海）。不会发信或改阶段，也不会进入「我跟进」。
                      </p>
                    ) : null}
                  </div>
                  <div className="discovery-candidate-actions">
                    <button
                      type="button"
                      className="discovery-icon-btn"
                      data-discovery-favorite={candidate.id}
                      aria-pressed={Boolean(favorited[candidate.id])}
                      aria-label={favorited[candidate.id] ? "已收藏" : "收藏"}
                      title="收藏保存在此浏览器"
                      onClick={() => toggleFavorite(candidate.id)}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                        <path
                          d="M12 3.8 14.6 9l5.8.6-4.4 3.8 1.3 5.7L12 16.6 6.7 19.1 8 13.4 3.6 9.6 9.4 9z"
                          fill={favorited[candidate.id] ? "currentColor" : "none"}
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <div
                      className="discovery-row-more"
                      data-discovery-row-menu={candidate.id}
                    >
                      <button
                        type="button"
                        className="discovery-icon-btn"
                        data-discovery-more={candidate.id}
                        aria-expanded={rowMenuId === candidate.id}
                        aria-haspopup="menu"
                        aria-label={`更多操作 @${candidate.handle}`}
                        onClick={() => setRowMenuId((current) => current === candidate.id ? null : candidate.id)}
                      >
                        ···
                      </button>
                      {rowMenuId === candidate.id ? (
                        <div className="discovery-row-menu" role="menu" aria-label={`@${candidate.handle} 操作`}>
                          <button
                            type="button"
                            role="menuitem"
                            className="discovery-row-menu-item"
                            data-discovery-dismiss={candidate.id}
                            disabled={followed}
                            onClick={() => {
                              setRowMenuId(null);
                              void onDismiss(candidate);
                            }}
                          >
                            忽略
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="discovery-follow-quiet"
                      data-discovery-follow={candidate.id}
                      disabled={followed}
                      onClick={() => {
                        setFollowError(null);
                        setBatchResult(null);
                        setPendingBatch(null);
                        setPendingFollow(candidate);
                      }}
                    >
                      {followed ? "已入库" : "＋ 入库公海"}
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
          把 @{pendingFollow?.handle} 写入红人档案（公海）。不会发信，也不会改正式阶段。不会进入「我跟进」。领取跟进需另行 L3 确认。
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
          将把 {pendingBatchCandidates.length} 条线索写入红人档案（公海）。
          其中 <span data-discovery-missing-email-count>{pendingMissingEmail}</span> 条没有联系邮箱（仍会写入，不会编造邮箱）。
          {pendingFilterSummary ? ` 门槛：${pendingFilterSummary}。` : ""}
          平台 / 地区沿用当前计划
          {request?.platforms?.length ? `（${request.platforms.map(platformLabel).join("、")}）` : ""}
          {request?.filters?.region && request.filters.region !== "all"
            ? ` · ${regionLabel(request.filters.region)}`
            : ""}
          。不会发信，也不会改正式阶段。不会进入「我跟进」。领取跟进需另行 L3 确认。
        </p>
        {batchResult?.failed.length ? (
          <p className="discovery-quiet" data-discovery-batch-partial role="status">
            已入库 {batchResult.counts.followed} 人，未入库 {batchResult.counts.failed} 人
            {batchResult.counts.skipped_duplicate ? `，公海已有跳过 ${batchResult.counts.skipped_duplicate} 人` : ""}
            。未成功的线索不会标成已入库。
          </p>
        ) : null}
      </DiscoveryFollowConfirm>
    </section>
  );
}
