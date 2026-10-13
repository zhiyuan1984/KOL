import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type EmployeeAgentBrowse, type EmployeeAgentPreference, type EmployeeAgentWorkspace } from "../api";
import { useAccount } from "../components/AuthGate";
import { storeComposerDraft } from "../components/ChatBlocks";
import CompactButton from "../components/CompactButton";
import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { BrowseDetailHeader, BrowseListRow, DetailActionBar, KnowledgeBrowseWorkspace, ListLoadFooter } from "../components/KnowledgeBrowse";
import { FilterOptionButton } from "../components/KnowledgeFilterControls";
import EmployeeBrowseFilters from "../components/EmployeeBrowseFilters";
import type { ScopeOption } from "../components/ScopeTabs";
import { brandLabel } from "../knowledgeCopy";
import { MAIN_STAGE_TABS } from "../kolStages";
import { agentBrowseFacets, filterAgentRows, NO_SCOPE } from "./browseFacets";
import { APPROVER_EXPERT_ID, KOL_EXPERT_ID, bindExpertSession, canonicalExpertId, expertCanSummon, expertDetailPath,
  fetchExpert, fetchExperts, filterExperts, parseSummonRefusal, summonExpert, type Expert, type ExpertSummonResult } from "../experts";
import AgentProfile from "./AgentProfile";
import { readBrowserPosition, saveBrowserPosition } from "./browserState";
import AgentApprover, { approverRiskPrompt } from "../pages/AgentApprover";
import AgentCrawler from "../pages/AgentCrawler";
import type { ApprovalRow } from "../pages/Approvals";
import "../knowledge-page.css";
import "../knowledge-browse.css";
import "./agent-browser.css";

type View = "all" | "favorites" | "recent";
const VIEWS: Array<{ key: View; label: string }> = [{ key: "all", label: "全部" }, { key: "favorites", label: "收藏" }, { key: "recent", label: "最近查看" }];
const KINDS = [{ key: "business", label: "业务协作" }, { key: "collector", label: "采集作业" }, { key: "governance", label: "审批处理" }];
const kindLabel = (expert: Expert) => KINDS.find(item => item.key === expert.kind)?.label || "Agent";
const errorCopy = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const safeId = (value: string) => { try { return canonicalExpertId(value); } catch { return ""; } };

export default function AgentBrowser() {
  const { account } = useAccount();
  return <AgentDirectory key={account?.id || "unresolved-account"} />;
}

function AgentDirectory() {
  const nav = useNavigate(), location = useLocation();
  const { id: routeId } = useParams();
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(params);
  useEffect(() => { latestParams.current = params; }, [params]);
  const { account } = useAccount();
  const actor = account?.id || "";
  const activeActor = useRef(actor); activeActor.current = actor;
  const [experts, setExperts] = useState<Expert[]>([]);
  const [detail, setDetail] = useState<Expert | null>(null);
  const [loading, setLoading] = useState(true), [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState(""), [detailError, setDetailError] = useState("");
  const [preferences, setPreferences] = useState<EmployeeAgentPreference[]>([]);
  const [preferencesLoading, setPreferencesLoading] = useState(true), [preferenceError, setPreferenceError] = useState("");
  const [generation, setGeneration] = useState(0), [preferenceGeneration, setPreferenceGeneration] = useState(0);
  const [workspace, setWorkspace] = useState<EmployeeAgentWorkspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false), [workspaceError, setWorkspaceError] = useState("");
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0);
  const [browse, setBrowse] = useState<EmployeeAgentBrowse | null>(null);
  const [browseLoading, setBrowseLoading] = useState(true), [browseError, setBrowseError] = useState("");
  const [showEmptyTaxonomy, setShowEmptyTaxonomy] = useState(false);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState(false), [feedback, setFeedback] = useState("");
  const [limit, setLimit] = useState(5), [listVisible, setListVisible] = useState(false);
  const actionLock = useRef(false), favoriteLock = useRef(false);
  const draft = useRef("");
  const listRef = useRef<HTMLElement>(null);
  const routeExpertId = routeId ? safeId(routeId) : "";
  const query = params.get("q") || "", kind = params.get("kind") || "";
  const familyId = params.get("family") || "", domainId = params.get("domain") || "", baseId = params.get("base") || "";
  const brands = params.getAll("brand"), stages = params.getAll("stage");
  const view: View = params.get("view") === "favorites" ? "favorites" : params.get("view") === "recent" ? "recent" : "all";
  const selectedId = routeExpertId || safeId(params.get("agent") || "");
  const positionParams = new URLSearchParams(params);
  positionParams.delete("agent"); positionParams.delete("from_session");
  const positionKey = `/agents?${positionParams.toString()}`;
  const sourceSession = params.get("from_session") || "";

  useEffect(() => {
    let alive = true;
    setBrowse(null); setBrowseLoading(true); setBrowseError("");
    void api.expertBrowse().then(value => {
      if (!value || !Array.isArray(value.rows) || !Array.isArray(value.taxonomy?.domains) || !Array.isArray(value.taxonomy?.bases)) throw new Error("分类范围返回格式无效");
      if (alive) setBrowse(value);
    }).catch(error => { if (alive) setBrowseError(errorCopy(error, "无法加载分类与关联知识范围")); })
      .finally(() => { if (alive) setBrowseLoading(false); });
    return () => { alive = false; };
  }, [actor, generation]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setLoadError(""); setExperts([]);
    void fetchExperts().then(async rows => {
      if (!alive) return;
      setExperts(rows); setLoading(false);
      // This is a real queue count; a failed request never becomes zero.
      if (rows.some(row => row.id === APPROVER_EXPERT_ID && row.open_count == null)) {
        try {
          const approvals = await api.approvals();
          if (!alive) return;
          const count = (Array.isArray(approvals) ? approvals : []).filter(row => {
            const value = row as { status?: string; can_decide?: boolean };
            return ["pending", "waiting"].includes(value.status || "") && value.can_decide !== false;
          }).length;
          setExperts(current => current.map(row => row.id === APPROVER_EXPERT_ID ? { ...row, open_count: count } : row));
        } catch { /* Count remains unknown; directory browsing is still usable. */ }
      }
    }).catch(error => { if (alive) { setLoadError(errorCopy(error, "无法加载 Agent")); setLoading(false); } });
    return () => { alive = false; };
  }, [actor, generation]);

  useEffect(() => {
    let alive = true;
    setPreferences([]); setPreferencesLoading(true); setPreferenceError("");
    void api.expertPreferences().then(rows => {
      if (!Array.isArray(rows)) throw new Error("个人偏好返回格式无效");
      if (alive) setPreferences(rows);
    }).catch(error => { if (alive) setPreferenceError(errorCopy(error, "无法读取收藏与最近查看")); })
      .finally(() => { if (alive) setPreferencesLoading(false); });
    return () => { alive = false; };
  }, [actor, preferenceGeneration]);

  useEffect(() => {
    if (!routeExpertId) { setDetail(null); setDetailError(""); setDetailLoading(false); return; }
    let alive = true;
    setDetail(null); setDetailError(""); setDetailLoading(true);
    void fetchExpert(routeExpertId).then(row => {
      if (!row) throw new Error("Agent 未发布或当前账号没有使用资格");
      if (alive) setDetail(row);
    }).catch(error => { if (alive) setDetailError(errorCopy(error, "无法加载该 Agent")); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [actor, routeExpertId, generation]);

  const prefById = useMemo(() => new Map(preferences.map(row => [row.expert_id, row])), [preferences]);
  const browseById = useMemo(() => new Map((browse?.rows || []).map(row => [row.expert_id, row])), [browse]);
  const searched = useMemo(() => filterExperts(browse ? experts.filter(row => browseById.has(row.id)) : experts, query), [experts, query, browse, browseById]);
  const filters = { familyId, domainId, baseId, brands, stages, kind, view };
  const facets = agentBrowseFacets(searched, browseById, prefById, filters);
  const filtered = filterAgentRows(searched, browseById, prefById, filters);
  if (view === "recent") filtered.sort((a, b) => String(prefById.get(b.id)?.viewed_at || "").localeCompare(String(prefById.get(a.id)?.viewed_at || "")));
  const visible = filtered.slice(0, limit);
  const selected = routeExpertId ? (browse && !browseById.has(routeExpertId) ? null : detail) : filtered.find(row => row.id === selectedId) || null;
  const consoleOpen = Boolean(routeExpertId && selected && !expertCanSummon(selected));
  const favorite = Boolean(selected && prefById.get(selected.id)?.favorite);
  const countsReady = !loading && !loadError && !browseLoading && !browseError && (view === "all" || (!preferencesLoading && !preferenceError));
  const preferencesReady = !preferencesLoading && !preferenceError;
  const scopeFilters = Boolean(familyId || domainId || baseId || brands.length || stages.length);
  const anyFilter = Boolean(query || kind || scopeFilters || view !== "all");
  const taxonomy = browse?.taxonomy || { domains: [], bases: [] };
  const scopeOptions = (axis: "family" | "domain" | "base"): ScopeOption[] => {
    const values = facets[axis].values;
    const options: ScopeOption[] = axis === "base"
      ? taxonomy.bases.filter(row => !domainId || row.domain_id === domainId).map(row => ({ id: row.id, name: row.name, count: values[row.id] || 0 }))
      : taxonomy.domains.filter(row => row.level === axis && (axis !== "domain" || !familyId || row.parent_id === familyId))
        .map(row => ({ id: row.id, name: row.name, count: values[row.id] || 0 }));
    if (values[NO_SCOPE] != null) options.push({ id: NO_SCOPE, name: axis === "base" ? "未关联知识库" : axis === "domain" ? "未归属业务域" : "未归属业务族", count: values[NO_SCOPE] });
    return options;
  };
  const familyOptions = scopeOptions("family"), domainOptions = scopeOptions("domain"), baseOptions = scopeOptions("base");
  const optionGroups: Array<[ScopeOption[], string]> = [[familyOptions, familyId], [domainOptions, domainId], [baseOptions, baseId]];
  const emptyTaxonomyCount = optionGroups.reduce((count, [options, selected]) => count + options.filter(row => row.count === 0 && row.id !== selected).length, 0);
  const shownOptions = (options: ScopeOption[], selected: string) => !countsReady || showEmptyTaxonomy ? options : options.filter(row => row.count !== 0 || row.id === selected);

  const mergePreference = useCallback((row: EmployeeAgentPreference, changed: "favorite" | "viewed") => setPreferences(current => {
    const previous = current.find(item => item.expert_id === row.expert_id);
    const merged = !previous ? row : changed === "favorite" ? { ...previous, favorite: row.favorite }
      : { ...previous, viewed_at: [previous.viewed_at || "", row.viewed_at || ""].sort().pop() || null };
    return [...current.filter(item => item.expert_id !== row.expert_id), merged];
  }), []);
  useEffect(() => {
    if (!selected?.id) return;
    let alive = true;
    setActionError(""); setFeedback("");
    void api.updateExpertPreference(selected.id, { viewed: true }).then(row => {
      if (alive) mergePreference(row, "viewed");
    }).catch(error => { if (alive) setFeedback(errorCopy(error, "最近查看暂未保存，请重试")); });
    return () => { alive = false; };
  }, [actor, selected?.id, mergePreference]);

  useEffect(() => {
    setWorkspace(null); setWorkspaceError(""); setWorkspaceLoading(Boolean(selected));
    if (!selected) return;
    let alive = true;
    void api.expertWorkspace(selected.id, sourceSession).then(value => {
      if (!value || !Array.isArray(value.skills) || !Array.isArray(value.knowledge)) throw new Error("Agent 能力返回格式无效");
      if (alive) setWorkspace(value);
    })
      .catch(error => { if (alive) setWorkspaceError(errorCopy(error, "无法读取已发布能力")); })
      .finally(() => { if (alive) setWorkspaceLoading(false); });
    return () => { alive = false; };
  }, [actor, selected?.id, sourceSession, workspaceGeneration]);

  const scopeKey = [familyId, domainId, baseId, ...brands, "|", ...stages].join("\n");
  useEffect(() => { setLimit(5); }, [query, kind, view, scopeKey]);
  useEffect(() => {
    const position = readBrowserPosition(actor, positionKey);
    if (position.limit && position.limit > 5) setLimit(position.limit);
    if (listRef.current) listRef.current.scrollTop = Number(position.scroll) || 0;
    if (position.focusedId && !selectedId) {
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-expert-open="${CSS.escape(position.focusedId!)}"]`)?.focus({ preventScroll: true }));
    }
  }, [actor, positionKey, loading]);
  useEffect(() => {
    if (!selected || listVisible || !listRef.current || getComputedStyle(listRef.current).display !== "none") return;
    document.getElementById("agent-preview-title")?.focus({ preventScroll: true });
  }, [selected?.id, listVisible]);

  const rememberPosition = () => saveBrowserPosition(actor, positionKey, { scroll: listRef.current?.scrollTop || 0, focusedId: selected?.id, limit });
  const changeFilters = (changes: Record<string, string | string[]>) => {
    rememberPosition(); setListVisible(false);
    const next = new URLSearchParams(latestParams.current);
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      for (const item of Array.isArray(value) ? value : [value]) if (item) next.append(key, item);
    }
    next.delete("agent");
    latestParams.current = next;
    if (routeExpertId) nav(`/agents?${next.toString()}`); else setParams(next, { replace: "q" in changes });
  };
  const changeFilter = (key: string, value: string) => changeFilters({ [key]: value });
  const toggleBrand = (value: string) => changeFilters({ brand: brands.includes(value) ? brands.filter(item => item !== value) : [...brands, value] });
  const openRow = (expert: Expert) => {
    rememberPosition(); setListVisible(false);
    const next = new URLSearchParams(latestParams.current); next.set("agent", expert.id);
    latestParams.current = next;
    if (routeExpertId) nav(`/agents?${next.toString()}`); else setParams(next);
  };
  const returnToList = () => {
    if (routeExpertId) {
      const next = new URLSearchParams(params); next.set("agent", routeExpertId);
      nav(`/agents?${next.toString()}`, { state: { agentListVisible: true } });
    } else {
      setListVisible(true);
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-expert-open="${CSS.escape(selectedId)}"]`)?.focus({ preventScroll: true }));
    }
  };
  useEffect(() => { if ((location.state as { agentListVisible?: boolean } | null)?.agentListVisible) setListVisible(true); }, [location.key]);
  const clearFilters = () => {
    const next = new URLSearchParams(latestParams.current); ["q", "kind", "view", "agent", "family", "domain", "base", "brand", "stage"].forEach(key => next.delete(key));
    latestParams.current = next;
    if (routeExpertId) nav(`/agents?${next.toString()}`); else setParams(next);
  };

  const toggleFavorite = async () => {
    if (!selected || favoriteLock.current || !preferencesReady) return;
    favoriteLock.current = true; setFavoriteBusy(true); setFeedback("");
    try {
      const row = await api.updateExpertPreference(selected.id, { favorite: !favorite });
      if (activeActor.current !== actor) return;
      mergePreference(row, "favorite"); setFeedback(row.favorite ? "已收藏" : "已取消收藏");
    } catch (error) { if (activeActor.current === actor) setFeedback(errorCopy(error, "收藏保存失败，请重试")); }
    finally { favoriteLock.current = false; setFavoriteBusy(false); }
  };

  const enterSession = (expert: Expert, result: ExpertSummonResult, text: string) => {
    bindExpertSession(result.session_id, expert, result);
    if (text) storeComposerDraft(result.session_id, { text });
    nav(`/s/${result.session_id}`, { state: { expertBound: true, expert: result, ...(text ? { composerDraft: { text } } : {}) } });
  };
  const startWork = async (expert: Expert, text = draft.current, resumeId?: string) => {
    if (actionLock.current) return;
    rememberPosition();
    if (!expertCanSummon(expert)) { nav(`${expertDetailPath(expert.id)}?${params.toString()}`); return; }
    actionLock.current = true; setBusy(true); setActionError("");
    try {
      const result = resumeId ? await api.resumeExpertSession(expert.id, resumeId) : await summonExpert(expert);
      if (activeActor.current === actor) enterSession(expert, result, text);
    } catch (error) {
      if (activeActor.current !== actor) return;
      const refused = parseSummonRefusal(error);
      if (refused.code === "expert_summon_not_allowed" && refused.path && refused.path !== "/agents") nav(refused.path);
      else setActionError(errorCopy(error, "无法开始工作"));
    } finally { actionLock.current = false; setBusy(false); }
  };
  const explainRisk = async (row: ApprovalRow) => {
    try {
      const expert = await fetchExpert(KOL_EXPERT_ID);
      if (!expert) throw new Error("当前没有可用于说明风险的 Agent");
      await startWork(expert, approverRiskPrompt(row));
    } catch (error) { setActionError(errorCopy(error, "无法说明审批风险")); }
  };
  const continuation = sourceSession && workspace?.recent_session?.id === sourceSession ? sourceSession : workspace?.recent_session?.id;

  return <section className="kbv kbv-page knowledge-browse agent-browser" data-expert-page={routeExpertId ? "detail" : "roster"}>
    <KnowledgeBrowseWorkspace detailOpen={Boolean(selectedId) && !listVisible}>
      <section className="kbv-list" ref={listRef} aria-label="Agent 列表" data-agent-list data-kbv-list aria-busy={loading}
        onScroll={rememberPosition}>
        <EmployeeBrowseFilters
          search={<WorkspaceSearchInput className="kbv-search" data-agent-search aria-label="搜索 Agent"
            placeholder="搜名称、职责或能力关键词" value={query} onChange={event => changeFilter("q", event.target.value)} />}
          scope={{ familyOptions: shownOptions(familyOptions, familyId), domainOptions: shownOptions(domainOptions, domainId),
            baseOptions: shownOptions(baseOptions, baseId), familyId, domainId, baseId,
            onFamily: id => changeFilters({ family: id, domain: "", base: "" }),
            onDomain: id => changeFilters({ domain: id, base: "" }), onBase: id => changeFilter("base", id),
            familyTotal: facets.family.all, domainTotal: facets.domain.all, baseTotal: facets.base.all, showCount: countsReady }}
          brand={{ label: "适用品牌", filterKey: "brand", labelOf: brandLabel,
            options: [...new Set([...Object.keys(facets.brand.values), ...brands])].sort(), selected: brands,
            onToggle: toggleBrand, onClear: () => changeFilters({ brand: [] }),
            counts: facets.brand.values, allCount: facets.brand.all, countsReady }}
          stage={{ selected: stages, onChange: values => changeFilters({ stage: values }), countsReady,
            options: [{ value: "", label: "全部", count: facets.stage.all },
              ...MAIN_STAGE_TABS.map(stage => ({ value: stage.code, label: stage.label, count: facets.stage.values[stage.code] || 0 }))] }}
          kinds={[{ value: "", label: "全部", count: facets.kind.all },
            ...KINDS.map(item => ({ value: item.key, label: item.label, count: facets.kind.values[item.key] || 0 }))]}
          kind={kind} onKind={value => changeFilter("kind", value)} kindAttribute="data-agent-kind" countsReady={countsReady}
          emptyTaxonomyCount={emptyTaxonomyCount} showEmptyTaxonomy={showEmptyTaxonomy}
          onToggleEmpty={() => setShowEmptyTaxonomy(value => !value)} anyFilter={anyFilter} onReset={clearFilters}
          clearAttributes={{ "data-agent-clear": true }}
        />
        <div className="kbv-tabs" role="group" aria-label="快捷视图">
          {VIEWS.map(item => <FilterOptionButton key={item.key} className="kbv-tab" label={item.label} selected={view === item.key} data-agent-view={item.key}
            disabled={item.key !== "all" && !preferencesReady}
            count={facets.view.values[item.key]}
            countsReady={countsReady && (item.key === "all" || preferencesReady)} onClick={() => changeFilter("view", item.key)} />)}
          <span className="kbv-tabs-count" data-agent-count>{countsReady && (view === "all" || preferencesReady) ? `${filtered.length} 位 Agent` : loading || preferencesLoading || browseLoading ? "正在更新…" : "数量暂不可用"}</span>
        </div>
        {browseLoading ? <p className="kbv-empty" role="status">正在读取分类与关联知识范围…</p> : null}
        {browseError ? <p className="error agent-browser-message" role="alert">{browseError} <CompactButton data-agent-browse-retry onClick={() => setGeneration(value => value + 1)}>重试分类范围</CompactButton></p> : null}
        {preferencesLoading ? <p className="kbv-empty" role="status">正在读取收藏与最近查看…</p> : null}
        {preferenceError ? <p className="error agent-browser-message" role="alert">{preferenceError} <CompactButton onClick={() => setPreferenceGeneration(value => value + 1)}>重试个人偏好</CompactButton></p> : null}
        {loading ? <p className="kbv-empty" role="status" data-expert-loading>正在加载 Agent…</p> : null}
        {loadError ? <p className="error agent-browser-message" role="alert">{loadError} <CompactButton data-agent-retry onClick={() => setGeneration(value => value + 1)}>重试</CompactButton></p> : null}
        {!loading && !loadError && (!scopeFilters || (!browseLoading && !browseError)) && visible.length ? <>
          <div className="kbv-records" data-expert-list="roster">{visible.map(expert => <BrowseListRow key={expert.id} title={expert.name} kind={kindLabel(expert)} selected={selected?.id === expert.id}
            recordAttributes={{ "data-expert-card": expert.id, "data-agent-row": expert.id }} openAttributes={{ "data-expert-open": expert.id }} onOpen={() => openRow(expert)} />)}</div>
          <ListLoadFooter remaining={filtered.length - visible.length} onMore={() => {
            setLimit(value => value + 5);
            saveBrowserPosition(actor, positionKey, { scroll: listRef.current?.scrollTop || 0, focusedId: selected?.id, limit: limit + 5 });
          }} />
        </> : null}
        {!loading && !loadError && (!scopeFilters || (!browseLoading && !browseError)) && !filtered.length && (view === "all" || preferencesReady) ? <p className="kbv-empty" data-expert-empty>
          {query || kind || scopeFilters ? "没有符合条件的 Agent。" : view === "favorites" ? "还没有收藏的 Agent。" : view === "recent" ? "还没有最近查看的 Agent。" : "当前没有可使用的已发布 Agent。"}
          {anyFilter ? <CompactButton onClick={clearFilters}>清除筛选</CompactButton> : null}
        </p> : null}
      </section>
      <aside className="kbv-rail" aria-label="Agent 详情" data-agent-detail>
        {selected ? <div className="kbv-rail-inner" data-agent-preview={selected.id}>
          <BrowseDetailHeader title={selected.name} titleId="agent-preview-title" favorite={favorite} onFavorite={() => void toggleFavorite()}
            onBack={returnToList} favoriteDisabled={favoriteBusy || !preferencesReady} favoriteAttributes={{ "data-agent-favorite": selected.id }} />
          <div className="kbv-rail-body">
            {consoleOpen ? <>
              <CompactButton data-agent-profile-back onClick={() => openRow(selected)}>查看职责与能力</CompactButton>
              {selected.kind === "collector" || selected.primary_entry === "job_console" ? <AgentCrawler expert={selected} embedded />
                : <AgentApprover expert={selected} embedded onExplainRisk={row => void explainRisk(row)} />}
            </> : <AgentProfile key={`${actor}:${selected.id}`} expert={selected} actor={actor} workspace={workspace}
              browseRow={browseById.get(selected.id)} taxonomy={taxonomy} browseLoading={browseLoading} browseError={browseError}
              workspaceLoading={workspaceLoading} workspaceError={workspaceError} onRetryWorkspace={() => setWorkspaceGeneration(value => value + 1)} draftRef={draft} />}
          </div>
          <DetailActionBar hint={consoleOpen ? null : expertCanSummon(selected) ? "示例只预填草稿。开始工作后可继续修改，提交提问才启动 Agent。" : "按对应工作入口继续；具体执行沿用现有确认与回执。"}>
            {actionError ? <span className="error" role="alert">{actionError}</span> : null}
            {feedback ? <span className="muted" role="status">{feedback}</span> : null}
            {sourceSession ? <CompactButton data-agent-return-source onClick={() => { rememberPosition(); nav(`/s/${encodeURIComponent(sourceSession)}`); }}>返回原任务</CompactButton> : null}
            {!consoleOpen && continuation && expertCanSummon(selected) ? <CompactButton disabled={busy} data-agent-resume
              title={workspace?.recent_session?.title} onClick={() => void startWork(selected, draft.current, continuation)}>继续已有工作</CompactButton> : null}
            {!consoleOpen ? <CompactButton emphasis="primary" size="md" disabled={busy} aria-busy={busy} data-expert-primary={selected.id}
              {...(expertCanSummon(selected) ? { "data-expert-summon": selected.id } : {})} onClick={() => void startWork(selected)}>
              {busy ? "正在打开…" : expertCanSummon(selected) ? "开始工作" : selected.primary_entry === "job_console" || selected.kind === "collector" ? "查看采集作业" : "处理审批"}
            </CompactButton> : <CompactButton onClick={() => openRow(selected)}>返回 Agent 详情</CompactButton>}
          </DetailActionBar>
        </div> : <div className="kbv-empty" role="status">
          {detailLoading || (loading && selectedId) ? "正在加载该 Agent…" : detailError ? <><span className="error" role="alert">{detailError}</span> <CompactButton onClick={() => setGeneration(value => value + 1)}>重试</CompactButton></> : selectedId ? "当前选择不在可见结果中，请从列表重新选择。" : "从列表选择一位 Agent，查看职责与能力。"}
        </div>}
      </aside>
    </KnowledgeBrowseWorkspace>
  </section>;
}
