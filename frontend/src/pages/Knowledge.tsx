import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../components/AuthGate";
import AssetTaskAction from "../components/AssetTaskAction";
import { useBrowseRows } from "../components/useBrowseRows";
import { readBrowseMemory, useBrowseMemory } from "../components/browseMemory";
import { api, type KnowledgeBaseRow, type KnowledgeDomainRow, type KnowledgeRow } from "../api";
import { type ScopeOption } from "../components/ScopeTabs";
import EmployeeBrowseFilters from "../components/EmployeeBrowseFilters";
import CompactButton from "../components/CompactButton";
import { KnowledgeBrowseWorkspace, BrowseDetailMetadata, KnowledgeListRow, ListLoadFooter, KnowledgeDetailHeader, DetailActionBar } from "../components/KnowledgeBrowse";
import { FilterOptionButton } from "../components/KnowledgeFilterControls";
import { PropertyList } from "../components/InformationLayout";
import { MAIN_STAGE_TABS } from "../kolStages";
import { employeeKnowledgeFacets, filterEmployeeKnowledgeRows } from "../employeeKnowledgeFacets";
import {
  HIDE_REASONS,
  KB_EMPTY_FILTER,
  KB_EMPTY_SEARCH,
  KB_EMPTY_SCOPE,
  KB_FILTER_LABEL,
  KB_SCOPE_CLEAR,
  KB_SCOPE_NONE,
  KB_SEARCH_LABEL,
  KB_SEARCH_PLACEHOLDER,
  brandLabel,
  formatKbTime,
  hideReasonLabel,
  kbAuthorLabel,
  kbIsMail,
  kbScopeTags,
  kbStatusLabel,
  kbSummary,
  kbVariableLine,
  kbVersionTag,
  kindLabel,
  readKbFavorites,
  readKbRecent,
  rememberKbRecent,
  composerFillText,
  composerStarter,
  writeKbFavorites,
} from "../knowledgeCopy";
import KbvIcon from "../knowledgeIcons";
import "../knowledge-page.css";
import "../knowledge-browse.css";
import "../asset-browse.css";
import "./global-layout-knowledge.css";

const SEARCH_DEBOUNCE_MS = 300;

type KbEmployeeView = "all" | "favorites" | "recent";

const EMPLOYEE_VIEWS: Array<{ key: KbEmployeeView; label: string }> = [
  { key: "all", label: "全部" },
  { key: "favorites", label: "收藏" },
  { key: "recent", label: "最近查看" },
];

function Hinted({
  id,
  hint,
  open,
  onOpen,
  onClose,
  children,
}: {
  id: string;
  hint: string;
  open: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(onClose, 3000);
    return () => clearTimeout(timer.current);
  }, [open, onClose]);

  return (
    // 说明是信息不是装饰：指针悬停与键盘/触摸聚焦都能打开（DESIGN §11 输入模态）。
    <span
      className={"kb-action" + (open ? " has-tip" : "")}
      onMouseEnter={() => onOpen(id)}
      onFocus={() => onOpen(id)}
    >
      {children}
      {open && (
        <span className="kb-tip" role="tooltip" id={`kb-tip-${id}`} data-kb-tip={id}>
          <span>{hint}</span>
          <button
            type="button"
            className="kb-tip-x"
            aria-label="关闭说明"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
          >
            ×
          </button>
        </span>
      )}
    </span>
  );
}

/** 适用 chips：阶段中文标签、品牌只留值，无则「全阶段 / 通用」；行内省阶段，右栏保留。 */
function ScopeChips({ row, withStage = true, compact = false }: { row: KnowledgeRow; withStage?: boolean; compact?: boolean }) {
  const tags = kbScopeTags(row, { withStage });
  const visible = compact ? tags.slice(0, 2) : tags;
  return (
    <span className="kb-scope" data-kb-scope>
      {visible.map((tag) => (
        <span className="chip kb-scope-chip" key={tag}>{tag}</span>
      ))}
      {compact && tags.length > visible.length ? <span className="chip kb-scope-chip">+{tags.length - visible.length}</span> : null}
    </span>
  );
}

type KnowledgeSection = { id: string; title: string; content: string };

/** 有标题或超过 24 行的正文使用可折叠章节，短文本仍保持一眼读完。 */
function splitKnowledgeBody(text: string, id: string): KnowledgeSection[] | null {
  const lines = String(text || "").split("\n");
  const headings = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^#{1,6}\s+/.test(line));
  if (!headings.length && lines.length <= 24) return null;
  if (!headings.length) {
    return Array.from({ length: Math.ceil(lines.length / 24) }, (_, index) => ({
      id: `kb-section-${id}-${index + 1}`,
      title: `第 ${index + 1} 节`,
      content: lines.slice(index * 24, (index + 1) * 24).join("\n"),
    }));
  }
  const introduction = lines.slice(0, headings[0].index).join("\n").trim();
  return [...(introduction ? [{ id: `kb-section-${id}-intro`, title: "概述", content: introduction }] : []), ...headings.map((heading, index) => ({
    id: `kb-section-${id}-${index + 1}`,
    title: heading.line.replace(/^#{1,6}\s+/, "").trim(),
    content: lines.slice(heading.index + 1, headings[index + 1]?.index ?? lines.length).join("\n").trim(),
  }))];
}

function KnowledgeDocumentBody({ row }: { row: KnowledgeRow }) {
  const text = row.body_en || row.body;
  const sections = splitKnowledgeBody(text, row.id);
  if (!sections) return <div className="kb-preview-body" data-kb-preview-body>{text}</div>;
  return <div className="kb-long-document" data-kb-preview-body>
    <nav className="kb-mini-toc" aria-label="正文目录">
      {sections.map((section) => <a key={section.id} href={`#${section.id}`} onClick={(event) => {
        event.preventDefault();
        const target = document.getElementById(section.id) as HTMLDetailsElement | null;
        if (target) { target.open = true; target.scrollIntoView({ block: "start", behavior: "auto" }); }
      }}>{section.title}</a>)}
    </nav>
    <div className="kb-long-document-sections">
      {sections.map((section, index) => <details key={section.id} id={section.id} open={index === 0}>
        <summary>{section.title}</summary>
        <div className="kb-preview-body">{section.content || "（本节暂无正文）"}</div>
      </details>)}
    </div>
  </div>;
}

/** 分类名称来自管理端主数据；计数仍按用户当前可见知识行计算。 */
function collectScope(
  taxonomy: { domains: KnowledgeDomainRow[]; bases: KnowledgeBaseRow[] },
  level: "family" | "domain" | "base",
  parentId: string,
  counts: Record<string, number>,
): ScopeOption[] {
  const options = level === "base"
    ? taxonomy.bases
      .filter((base) => !parentId || String(base.domain_id) === parentId)
      .map((base) => ({ id: String(base.id), name: String(base.name), count: counts[String(base.id)] ?? 0 }))
    : taxonomy.domains
      .filter((domain) => domain.level === level && (level === "family" || !parentId || String(domain.parent_id || "") === parentId))
      .map((domain) => ({ id: String(domain.id), name: String(domain.name), count: counts[String(domain.id)] ?? 0 }));
  return options
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

/** 员工端知识库（IA v2）：三级分类 tab＋筛选标签＋中栏列表＋右栏同页详情。 */
export default function Knowledge() {
  const { account } = useAccount();
  const userId = account?.id || "";
  const memory = useRef(readBrowseMemory<{ selectedId: string; detailOpen: boolean; expanded: boolean; view: KbEmployeeView; query: string; stageFilters: string[]; brandFilters: string[]; kindFilter: string; familyId: string; domainId: string; baseId: string; limit: number }>(userId,"knowledge")).current;
  const [expanded, setExpanded] = useState(memory.expanded || false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [versionError, setVersionError] = useState("");
  const [versionReload, setVersionReload] = useState(0);
  const [taxonomyLoaded, setTaxonomyLoaded] = useState(false);
  const [taxonomyReload, setTaxonomyReload] = useState(0);
  const [taxonomyError, setTaxonomyError] = useState("");
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [taxonomy, setTaxonomy] = useState<{ domains: KnowledgeDomainRow[]; bases: KnowledgeBaseRow[] }>({ domains: [], bases: [] });
  const [detailOpen, setDetailOpen] = useState(memory.detailOpen || false);
  const [selectedId, setSelectedId] = useState(memory.selectedId || "");
  const [hideFor, setHideFor] = useState("");
  const [err, setErr] = useState("");
  const [versionCompare, setVersionCompare] = useState<Array<Record<string, unknown>>>([]);
  const [tipId, setTipId] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => readKbFavorites());
  const [recentIds, setRecentIds] = useState<string[]>(() => readKbRecent(userId).map((item) => item.id));
  const [view, setView] = useState<KbEmployeeView>(memory.view || "all");
  const [query, setQuery] = useState(memory.query || "");
  const [keyword, setKeyword] = useState(memory.query || "");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const [stageFilters, setStageFilters] = useState<string[]>(memory.stageFilters || []);
  const [brandFilters, setBrandFilters] = useState<string[]>(memory.brandFilters || []);
  const [kindFilter, setKindFilter] = useState(memory.kindFilter || "");
  const [familyId, setFamilyId] = useState(memory.familyId || "");
  const [domainId, setDomainId] = useState(memory.domainId || "");
  const [baseId, setBaseId] = useState(memory.baseId || "");
  const [showEmptyTaxonomy, setShowEmptyTaxonomy] = useState(false);
  const { listRef, toolbarRef, limit: displayLimit, more } = useBrowseRows(JSON.stringify([familyId,domainId,baseId,view,stageFilters,brandFilters,kindFilter,keyword]),memory.limit,loaded);
  const browseState = useMemo(() => ({ selectedId, detailOpen, expanded, view, query, stageFilters, brandFilters, kindFilter, familyId, domainId, baseId, limit: displayLimit }),[selectedId,detailOpen,expanded,view,query,stageFilters,brandFilters,kindFilter,familyId,domainId,baseId,displayLimit]);
  useBrowseMemory(userId,"knowledge",browseState,listRef,loaded);
  const closeTip = useCallback(() => setTipId(""), []);

  const reload = useCallback(() => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    api.knowledge({ q: keyword })
      .then((nextRows) => {
        if (sequence !== loadSequence.current) return;
        setErr("");
        setRows(nextRows);
        const serverFavorites = nextRows.filter((row) => row.favorite).map((row) => row.id);
        setFavorites(serverFavorites);
        writeKbFavorites(serverFavorites);
      })
      .catch((e) => { if (sequence === loadSequence.current) setErr(e instanceof Error ? e.message : "无法加载知识库"); })
      .finally(() => { if (sequence === loadSequence.current) { setLoaded(true); setLoading(false); } });
  }, [keyword]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    let active = true;
    setTaxonomyLoaded(false);
    api.knowledgeTaxonomy()
      .then(value => { if (active) { setTaxonomy(value); setTaxonomyError(""); setTaxonomyLoaded(true); } })
      .catch((e) => { if (active) setTaxonomyError(e instanceof Error ? e.message : "无法加载知识分类"); });
    return () => { active = false; };
  }, [taxonomyReload]);

  useEffect(() => {
    const next = query.trim();
    if (next === keyword) return;
    const timer = setTimeout(() => setKeyword(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword, query]);

  const employeeFilters = useMemo(() => ({
    familyId, domainId, baseId, brandFilters, stageFilters, kindFilter, view,
    favoriteIds: favorites, recentIds,
  }), [baseId, brandFilters, domainId, familyId, favorites, kindFilter, recentIds, stageFilters, view]);
  const facets = useMemo(() => employeeKnowledgeFacets(rows, employeeFilters), [employeeFilters, rows]);
  const searchPending = loading || query.trim() !== keyword;
  const countsReady = loaded && !searchPending && !err;
  const familyOptions = useMemo(
    () => collectScope(taxonomy, "family", "", facets.family.values),
    [facets.family.values, taxonomy],
  );
  const domainOptions = useMemo(
    () => collectScope(taxonomy, "domain", familyId, facets.domain.values),
    [facets.domain.values, familyId, taxonomy],
  );
  const baseOptions = useMemo(
    () => collectScope(taxonomy, "base", domainId, facets.base.values),
    [domainId, facets.base.values, taxonomy],
  );
  const brandOptions = useMemo(() => Object.keys(facets.brand.values).sort(), [facets.brand.values]);
  const kindOptions = useMemo(() => Object.keys(facets.kind.values).sort(), [facets.kind.values]);
  const stageOptions = useMemo(() => {
    const known = new Set(MAIN_STAGE_TABS.map((stage) => stage.code));
    return [
      { value: "", label: "全部", count: facets.stage.all },
      ...MAIN_STAGE_TABS.map((stage) => ({ value: stage.code, label: stage.label, count: facets.stage.values[stage.code] ?? 0 })),
      ...stageFilters.filter((stage) => !known.has(stage)).map((stage) => ({ value: stage, label: stage, count: facets.stage.values[stage] ?? 0 })),
    ];
  }, [facets.stage, stageFilters]);
  const hasTaxonomy = familyOptions.length > 0 || domainOptions.length > 0 || baseOptions.length > 0;
  const scoped = Boolean(familyId || domainId || baseId);

  // 分类是层级的：上层变了，下层选择随之清空；选项消失也回退到「全部」。
  useEffect(() => {
    if (!taxonomyLoaded) return;
    if (familyId && !familyOptions.some((item) => item.id === familyId)) setFamilyId("");
  }, [familyId, familyOptions, taxonomyLoaded]);
  useEffect(() => {
    if (!taxonomyLoaded) return;
    if (domainId && !domainOptions.some((item) => item.id === domainId)) setDomainId("");
  }, [domainId, domainOptions, taxonomyLoaded]);
  useEffect(() => {
    if (!taxonomyLoaded) return;
    if (baseId && !baseOptions.some((item) => item.id === baseId)) setBaseId("");
  }, [baseId, baseOptions, taxonomyLoaded]);

  const filteredVisible = useMemo(() => filterEmployeeKnowledgeRows(rows, employeeFilters), [employeeFilters, rows]);
  const counts = facets.view.values;
  const emptyTaxonomyCount = useMemo(() => {
    if (!countsReady) return 0;
    const axes: Array<[ScopeOption[], string]> = [[familyOptions, familyId], [domainOptions, domainId], [baseOptions, baseId]];
    return axes
      .reduce((sum, [options, selected]) => sum + options.filter((option) => option.count === 0 && option.id !== selected).length, 0);
  }, [baseId, baseOptions, countsReady, domainId, domainOptions, familyId, familyOptions]);
  const visibleTaxonomyOptions = useCallback((options: ScopeOption[], selected: string) => {
    if (!countsReady || showEmptyTaxonomy) return options;
    return options.filter((option) => option.count !== 0 || option.id === selected);
  }, [countsReady, showEmptyTaxonomy]);
  const visible = useMemo(() => filteredVisible.slice(0, displayLimit), [filteredVisible, displayLimit]);

  const selectedRow = useMemo(
    () => filteredVisible.find((row) => row.id === selectedId) || null,
    [filteredVisible, selectedId],
  );

  useEffect(() => {
    const list = document.querySelector("[data-kbv-list]");
    if (detailOpen && selectedRow && list && getComputedStyle(list).display === "none") {
      document.getElementById("kb-preview-title")?.focus({ preventScroll: true });
    }
  }, [detailOpen, selectedRow?.id]);

  useEffect(() => {
    if (!selectedRow?.has_newer_version || !selectedRow.favorite_version) {
      setVersionCompare([]); setVersionError("");
      return;
    }
    let alive = true;
    setVersionCompare([]); setVersionError("");
    void api.knowledgeVersions(selectedRow.id)
      .then((versions) => { if (alive) setVersionCompare(versions); })
      .catch(() => { if (alive) { setVersionCompare([]); setVersionError("版本记录读取失败，请重试。"); } });
    return () => { alive = false; };
  }, [selectedRow?.id, selectedRow?.has_newer_version, selectedRow?.favorite_version, versionReload]);

  const openRow = (row: KnowledgeRow) => {
    closeTip();
    setSelectedId(row.id);
    setDetailOpen(true);
    setRecentIds(rememberKbRecent(row.id,userId).map((item) => item.id));
  };

  const toggleFavorite = async (row: KnowledgeRow) => {
    if (favoriteBusy) return;
    setFavoriteBusy(true);
    const wasFavorite = favorites.includes(row.id);
    try {
      if (wasFavorite) await api.unfavoriteKnowledge(row.id); else await api.favoriteKnowledge(row.id);
      setFavorites(current => { const next = wasFavorite ? current.filter(id => id !== row.id) : [...current,row.id]; writeKbFavorites(next); return next; });
      setRows(current => current.map(item => item.id === row.id ? { ...item, favorite: !wasFavorite } : item)); setErr("");
    } catch (e) { setErr(`收藏未保存：${e instanceof Error ? e.message : "请重试"}`); }
    finally { setFavoriteBusy(false); }
  };

  const markNotHelpful = (row: KnowledgeRow) => {
    void api.deprecateKnowledge(row.id, "not_helpful")
      .then(() => { setHideFor(""); setErr(""); reload(); })
      .catch((e) => setErr(e instanceof Error ? e.message : "无法记录反馈"));
  };

  const resetAll = () => {
    setFamilyId("");
    setDomainId("");
    setBaseId("");
    setStageFilters([]);
    setBrandFilters([]);
    setKindFilter("");
    setQuery("");
    setView("all");
  };

  const anyFilter = scoped || Boolean(stageFilters.length || brandFilters.length || kindFilter || query.trim()) || view !== "all";

  const emptyCopy = useMemo(() => {
    if (view === "favorites") return "还没有收藏的知识。先把常用资料加入收藏。";
    if (view === "recent") return "还没有最近查看的知识。打开一条资料后会出现在这里。";
    if (keyword) return KB_EMPTY_SEARCH;
    if (stageFilters.length || brandFilters.length || kindFilter) return KB_EMPTY_FILTER;
    if (scoped) return KB_EMPTY_SCOPE;
    return "暂无已发布资料。";
  }, [view, brandFilters, keyword, kindFilter, stageFilters, scoped]);

  return (
    <section className="kbv kbv-page knowledge-browse asset-browse" data-kb-page="mine" data-kb-v2="home">
      <KnowledgeBrowseWorkspace detailOpen={detailOpen && !!selectedRow} expanded={expanded}>
        <section ref={listRef} className="kbv-list" aria-label="知识列表" data-kbv-list aria-busy={loading}>
          {loading ? <p className="knowledge-load-footer" role="status">{loaded ? "正在检索知识…" : "正在加载知识…"}</p> : null}
          <div ref={toolbarRef}>
          {loaded ? (
            <EmployeeBrowseFilters
              search={<WorkspaceSearchInput className="kbv-search" aria-label={KB_SEARCH_LABEL} data-kb-search
                value={query} placeholder={KB_SEARCH_PLACEHOLDER} onChange={event => setQuery(event.target.value)} />}
              scopeFallback={taxonomyError ? <><span role="alert">知识分类暂不可用：{taxonomyError}</span> <CompactButton onClick={() => setTaxonomyReload(value => value + 1)}>重试分类</CompactButton></> : taxonomyLoaded ? KB_SCOPE_NONE : "正在读取知识分类…"}
              scope={hasTaxonomy ? {
                showCount: countsReady,
                familyOptions: visibleTaxonomyOptions(familyOptions, familyId),
                domainOptions: visibleTaxonomyOptions(domainOptions, domainId),
                baseOptions: visibleTaxonomyOptions(baseOptions, baseId),
                familyId, domainId, baseId,
                onFamily: id => { setFamilyId(id); setDomainId(""); setBaseId(""); },
                onDomain: id => { setDomainId(id); setBaseId(""); }, onBase: setBaseId,
                familyTotal: facets.family.all, domainTotal: facets.domain.all, baseTotal: facets.base.all,
              } : null}
              brand={{ label: KB_FILTER_LABEL.brand, filterKey: "brand", labelOf: brandLabel,
                options: brandOptions, selected: brandFilters,
                onToggle: value => setBrandFilters(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]),
                onClear: () => setBrandFilters([]), counts: facets.brand.values, allCount: facets.brand.all, countsReady }}
              stage={{ selected: stageFilters, onChange: setStageFilters, options: stageOptions, countsReady }}
              kinds={[{ value: "", label: "全部", count: facets.kind.all },
                ...kindOptions.map(kind => ({ value: kind, label: kindLabel(kind), count: facets.kind.values[kind] }))]}
              kind={kindFilter} onKind={setKindFilter} kindAttribute="data-kb-kind" countsReady={countsReady}
              emptyTaxonomyCount={emptyTaxonomyCount} showEmptyTaxonomy={showEmptyTaxonomy}
              onToggleEmpty={() => setShowEmptyTaxonomy(value => !value)} anyFilter={anyFilter} onReset={resetAll}
              clearAttributes={{ "data-kb-scope-clear": true }}
            />
          ) : null}

          {loaded ? (
            <div className="kbv-tabs" role="group" aria-label="快捷视图">
              {EMPLOYEE_VIEWS.map((item) => (
                <FilterOptionButton
                  key={item.key}
                  className="kbv-tab"
                  selected={view === item.key}
                  label={item.label}
                  count={counts[item.key]}
                  countsReady={countsReady}
                  data-kbv-view={item.key}
                  onClick={() => setView(item.key)}
                />
              ))}
              {/* 计数与列表同源（§8 数字同源），并入本行不再单独占一行高度。 */}
              <span className="kbv-tabs-count" data-kbv-count>{countsReady ? `${filteredVisible.length} 条知识` : searchPending ? "正在更新计数…" : "计数暂不可用"}</span>
            </div>
          ) : null}

          </div>
          {loaded && visible.length ? (
            <div className="kbv-records" data-kbv-records>
              {visible.map((row) => <KnowledgeListRow key={row.id} row={row}
                selected={selectedRow?.id === row.id} kind={kindLabel(row.kind)}
                onOpen={() => openRow(row)}
              />)}
            </div>
          ) : null}
          {loaded && visible.length > 0 ? <ListLoadFooter remaining={filteredVisible.length - visible.length}
            onMore={more} /> : null}

          {err && <p className="error" role="alert">知识服务暂不可用：{err} <CompactButton data-kb-retry onClick={reload}>重试</CompactButton></p>}
          {loaded && !loading && !err && !rows.length && !keyword ? <p className="kbv-empty">暂无已发布资料。</p> : null}
          {/* §9.3 空态紧凑且动作内联：条件类空态直接给出恢复动作，不留一句话让人自己找。 */}
          {loaded && !loading && !err && (rows.length > 0 || !!keyword) && !visible.length ? (
            <p className="kbv-empty" data-kb-empty>
              {emptyCopy}
              {anyFilter ? <button type="button" className="kbv-text-action" data-kb-empty-reset onClick={resetAll}>{KB_SCOPE_CLEAR}</button> : null}
            </p>
          ) : null}
        </section>

        <aside className="kbv-rail" aria-label="知识详情" data-kb-detail>
          {selectedRow ? (
            <div className="kbv-rail-inner" data-kb-preview={selectedRow.id}>
              <KnowledgeDetailHeader row={selectedRow} favorite={favorites.includes(selectedRow.id)} favoriteDisabled={favoriteBusy}
                expanded={expanded} onExpand={() => setExpanded(value => !value)}
                onFavorite={() => toggleFavorite(selectedRow)} onBack={() => {
                  setDetailOpen(false);
                  requestAnimationFrame(() => {
                    const buttons = document.querySelectorAll<HTMLButtonElement>("[data-kb-open]");
                    [...buttons].find((button) => button.dataset.kbOpen === selectedRow.id)?.focus({ preventScroll: true });
                  });
                }} />
              <div className="kbv-rail-body">
                <BrowseDetailMetadata status={kbStatusLabel(selectedRow)} author={kbAuthorLabel(selectedRow.created_by)}
                  version={kbVersionTag(selectedRow.current_version)}
                  updatedAt={formatKbTime(selectedRow.updated_at || selectedRow.approved_at || selectedRow.created_at)}
                  scope={<ScopeChips row={selectedRow} />} />
                {kbSummary(selectedRow) !== selectedRow.subject && kbSummary(selectedRow) !== (selectedRow.body_en || selectedRow.body) ? <p className="kb-card-summary" data-kb-summary>{kbSummary(selectedRow)}</p> : null}
                {kbVariableLine(selectedRow) ? <p className="kb-card-vars">{kbVariableLine(selectedRow)}</p> : null}
                {selectedRow.has_newer_version ? <details className="kb-version-compare" data-kb-version-diff>
                  <summary>有新版本 · 查看版本变化</summary>
                  {versionCompare.length ? (() => {
                    const favoriteVersion = Number(selectedRow.favorite_version || 0);
                    const prior = versionCompare.find((version) => Number(version.version || 0) === favoriteVersion);
                    const current = versionCompare.find((version) => Number(version.version || 0) === Number(selectedRow.published_version || selectedRow.current_version));
                    return <div className="kb-version-compare-grid">
                      <section><h3>收藏时版本 v{favoriteVersion}</h3><pre>{String(prior?.body || "该历史版本正文不可用")}</pre></section>
                      <section><h3>当前已发布版本 v{selectedRow.published_version || selectedRow.current_version}</h3><pre>{String(current?.body || selectedRow.body_en || selectedRow.body)}</pre></section>
                    </div>;
                  })() : <p className="muted" role={versionError ? "alert" : "status"}>{versionError || "正在读取版本记录…"}{versionError ? <CompactButton onClick={() => setVersionReload(value => value + 1)}>重试版本</CompactButton> : null}</p>}
                </details> : null}
                {selectedRow.subject && (
                  <PropertyList
                    className="kb-preview-subject"
                    labelWidth="short"
                    items={[{ key: "subject", label: "主题", value: selectedRow.subject }]}
                  />
                )}
                <KnowledgeDocumentBody row={selectedRow} />
                {selectedRow.deprecated && (
                  <p className="kb-card-hidden">
                    已隐藏 · {hideReasonLabel(selectedRow.deprecate_reason) || selectedRow.deprecate_reason_label}
                    {selectedRow.feedback_handled ? " · 管理员已处理" : ""}
                  </p>
                )}
                {hideFor === selectedRow.id && !selectedRow.deprecated && (
                  <div className="kb-hide-panel">
                    <p className="kb-hide-title">选择隐藏原因 · 只影响你这个账号</p>
                    {HIDE_REASONS.map((reason) => (
                      <button
                        key={reason.code}
                        className="kb-hide-option"
                        type="button"
                        data-deprecate-reason={reason.code}
                        onClick={() => void api.deprecateKnowledge(selectedRow.id, reason.code).then(() => { setHideFor(""); reload(); })}
                      >
                        <strong>{reason.label}</strong>
                        <span>{reason.result}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <DetailActionBar>
                  {selectedRow.deprecated ? (
                    <CompactButton

                      type="button"
                      onClick={() => void api.undeprecateKnowledge(selectedRow.id).then(() => { setHideFor(""); reload(); })}
                    >
                      取消隐藏
                    </CompactButton>
                  ) : (
                    <>
                      <CompactButton type="button" data-kb-not-helpful={selectedRow.id} onClick={() => markNotHelpful(selectedRow)}>没帮助</CompactButton>
                      <Hinted
                        id={`${selectedRow.id}-hide`}
                        open={tipId === `${selectedRow.id}-hide`}
                        onOpen={setTipId}
                        onClose={closeTip}
                        hint="可补充具体原因；只在本账号隐藏，已发信不受影响。"
                      >
                        <CompactButton

                          type="button"
                          aria-expanded={hideFor === selectedRow.id}
                          aria-pressed={hideFor === selectedRow.id}
                          onClick={() => setHideFor((current) => (current === selectedRow.id ? "" : selectedRow.id))}
                        >
                          反馈 / 隐藏
                        </CompactButton>
                      </Hinted>
                    </>
                  )}
                  <AssetTaskAction key={selectedRow.id} disabled={selectedRow.deprecated} useAttributes={{ "data-kb-use": selectedRow.id, "data-fill-composer": selectedRow.id }}
                    draft={{ text: kbIsMail(selectedRow) ? composerFillText(selectedRow) : composerStarter(selectedRow),
                      ...(kbIsMail(selectedRow) ? { locked_knowledge_id:selectedRow.id, locked_intent:selectedRow.skill_id || selectedRow.intent || null, locked_label:selectedRow.title } : {}),
                      chips: [{ kind: "kb", id: selectedRow.id, label: selectedRow.title, version: selectedRow.published_version || selectedRow.current_version },
                        ...(selectedRow.skill_id ? [{ kind: "skill" as const, id: selectedRow.skill_id, label: selectedRow.title }] : [])] }}
                    beforeUse={async () => {
                      const current = await api.knowledgeItem(selectedRow.id);
                      if (current.deprecated || current.status !== "published") throw new Error("这份资料已不可用，请刷新后重新选择。");
                      if ((current.published_version || current.current_version) !== (selectedRow.published_version || selectedRow.current_version)) throw new Error("这份资料已有新版本，请刷新并核对内容后再使用。");
                      if (!selectedRow.cited) await api.citeKnowledge(selectedRow.id);
                    }} />
              </DetailActionBar>
            </div>
          ) : (
            <p className="kbv-empty" role="status">{loaded ? "从列表选择一条知识，查看内容与来源。" : "正在加载知识…"}</p>
          )}
        </aside>
      </KnowledgeBrowseWorkspace>
    </section>
  );
}
