import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, type KnowledgeBaseRow, type KnowledgeDomainRow, type KnowledgeRow } from "../api";
import ScopeTabs, { type ScopeOption } from "../components/ScopeTabs";
import FilterChips from "../components/FilterChips";
import CompactButton from "../components/CompactButton";
import { KnowledgeBrowseWorkspace, KnowledgeFilterBar, StageFilterGroup, KnowledgeListRow, ListLoadFooter, KnowledgeDetailHeader, InlineMetadata, DetailActionBar } from "../components/KnowledgeBrowse";
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
  formatKbTime,
  hideReasonLabel,
  kbIsMail,
  kbScopeTags,
  kbSummary,
  kbVariableLine,
  kbVersionTag,
  kindLabel,
  readKbFavorites,
  readKbRecent,
  rememberKbRecent,
  stashComposerFill,
  writeKbFavorites,
} from "../knowledgeCopy";
import KbvIcon from "../knowledgeIcons";
import "../knowledge-page.css";
import "../knowledge-browse.css";

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
  rows: KnowledgeRow[],
  taxonomy: { domains: KnowledgeDomainRow[]; bases: KnowledgeBaseRow[] },
  level: "family" | "domain" | "base",
  parentId: string,
): ScopeOption[] {
  const count = new Map<string, number>();
  for (const row of rows) {
    const id = level === "family" ? row.family_id : level === "domain" ? row.domain_id : row.base_id;
    if (id) count.set(String(id), (count.get(String(id)) || 0) + 1);
  }
  const options = level === "base"
    ? taxonomy.bases
      .filter((base) => !parentId || String(base.domain_id) === parentId)
      .map((base) => ({ id: String(base.id), name: String(base.name), count: count.get(String(base.id)) || 0 }))
    : taxonomy.domains
      .filter((domain) => domain.level === level && (level === "family" || !parentId || String(domain.parent_id || "") === parentId))
      .map((domain) => ({ id: String(domain.id), name: String(domain.name), count: count.get(String(domain.id)) || 0 }));
  return options
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

/** 员工端知识库（IA v2）：三级分类 tab＋筛选标签＋中栏列表＋右栏同页详情。 */
export default function Knowledge() {
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [displayLimit, setDisplayLimit] = useState(5);
  const [taxonomy, setTaxonomy] = useState<{ domains: KnowledgeDomainRow[]; bases: KnowledgeBaseRow[] }>({ domains: [], bases: [] });
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [hideFor, setHideFor] = useState("");
  const [err, setErr] = useState("");
  const [versionCompare, setVersionCompare] = useState<Array<Record<string, unknown>>>([]);
  const [tipId, setTipId] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => readKbFavorites());
  const [recentIds, setRecentIds] = useState<string[]>(() => readKbRecent().map((item) => item.id));
  const [view, setView] = useState<KbEmployeeView>("all");
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [stageFilters, setStageFilters] = useState<string[]>([]);
  const [brandFilters, setBrandFilters] = useState<string[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [baseId, setBaseId] = useState("");
  const nav = useNavigate();
  const closeTip = useCallback(() => setTipId(""), []);

  const reload = useCallback(() => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    api.knowledge({ q: keyword })
      .then((nextRows) => {
        if (sequence !== loadSequence.current) return;
        setErr("");
        setRows(nextRows);
        if (!keyword) setBrandOptions([...new Set(nextRows.map((row) => String(row.brand || "").trim()).filter((code) => code && code !== "*"))].sort());
        const serverFavorites = nextRows.filter((row) => row.favorite).map((row) => row.id);
        setFavorites(serverFavorites);
        writeKbFavorites(serverFavorites);
      })
      .catch((e) => { if (sequence === loadSequence.current) setErr(e instanceof Error ? e.message : "无法加载知识库"); })
      .finally(() => { if (sequence === loadSequence.current) { setLoaded(true); setLoading(false); } });
  }, [keyword]);

  useEffect(() => { setDisplayLimit(5); void reload(); }, [reload]);

  useEffect(() => {
    api.knowledgeTaxonomy()
      .then(setTaxonomy)
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载知识分类"));
  }, []);

  useEffect(() => {
    const next = query.trim();
    if (next === keyword) return;
    const timer = setTimeout(() => setKeyword(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword, query]);

  const familyOptions = useMemo(() => collectScope(rows, taxonomy, "family", ""), [rows, taxonomy]);
  const domainOptions = useMemo(() => collectScope(rows, taxonomy, "domain", familyId), [rows, taxonomy, familyId]);
  const baseOptions = useMemo(() => collectScope(rows, taxonomy, "base", domainId), [rows, taxonomy, domainId]);
  const hasTaxonomy = familyOptions.length > 0 || baseOptions.length > 0;
  const scoped = Boolean(familyId || domainId || baseId);

  // 分类是层级的：上层变了，下层选择随之清空；选项消失也回退到「全部」。
  useEffect(() => {
    if (familyId && !familyOptions.some((item) => item.id === familyId)) setFamilyId("");
  }, [familyId, familyOptions]);
  useEffect(() => {
    if (domainId && !domainOptions.some((item) => item.id === domainId)) setDomainId("");
  }, [domainId, domainOptions]);
  useEffect(() => {
    if (baseId && !baseOptions.some((item) => item.id === baseId)) setBaseId("");
  }, [baseId, baseOptions]);

  const familyTotal = rows.length;
  const domainTotal = useMemo(
    () => (familyId ? domainOptions.reduce((sum, option) => sum + (option.count || 0), 0) : rows.length),
    [familyId, domainOptions],
  );
  const baseTotal = useMemo(
    () => (domainId ? baseOptions.reduce((sum, option) => sum + (option.count || 0), 0) : rows.length),
    [domainId, baseOptions],
  );

  const scopedVisible = useMemo(() => {
    return rows.filter((row) => {
      if (familyId && row.family_id !== familyId) return false;
      if (domainId && row.domain_id !== domainId) return false;
      if (baseId && row.base_id !== baseId) return false;
      if (stageFilters.length && !(row.stage_codes || []).some((code) => stageFilters.includes(code))) return false;
      if (brandFilters.length) {
        const brand = String(row.brand || "");
        if (brand && brand !== "*" && !brandFilters.includes(brand)) return false;
      }
      return true;
    });
  }, [rows, familyId, domainId, baseId, stageFilters, brandFilters]);

  const counts = useMemo(() => ({
    all: scopedVisible.length,
    favorites: scopedVisible.filter((row) => favorites.includes(row.id)).length,
    recent: scopedVisible.filter((row) => recentIds.includes(row.id)).length,
  }), [scopedVisible, favorites, recentIds]);

  const filteredVisible = useMemo(() => {
    if (view === "favorites") return scopedVisible.filter((row) => favorites.includes(row.id));
    if (view === "recent") return scopedVisible.filter((row) => recentIds.includes(row.id));
    return scopedVisible;
  }, [scopedVisible, view, favorites, recentIds]);
  useEffect(() => { setDisplayLimit(5); }, [familyId, domainId, baseId, view, stageFilters, brandFilters]);
  const visible = useMemo(() => filteredVisible.slice(0, displayLimit), [filteredVisible, displayLimit]);

  const selectedRow = useMemo(
    () => visible.find((row) => row.id === selectedId) || null,
    [visible, selectedId],
  );

  useEffect(() => {
    const list = document.querySelector("[data-kbv-list]");
    if (detailOpen && selectedRow && list && getComputedStyle(list).display === "none") {
      document.getElementById("kb-preview-title")?.focus({ preventScroll: true });
    }
  }, [detailOpen, selectedRow?.id]);

  useEffect(() => {
    if (!selectedRow?.has_newer_version || !selectedRow.favorite_version) {
      setVersionCompare([]);
      return;
    }
    let alive = true;
    void api.knowledgeVersions(selectedRow.id)
      .then((versions) => { if (alive) setVersionCompare(versions); })
      .catch(() => { if (alive) setVersionCompare([]); });
    return () => { alive = false; };
  }, [selectedRow?.id, selectedRow?.has_newer_version, selectedRow?.favorite_version]);

  const openRow = (row: KnowledgeRow) => {
    closeTip();
    setSelectedId(row.id);
    setDetailOpen(true);
    setRecentIds(rememberKbRecent(row.id).map((item) => item.id));
  };

  const useForTask = (row: KnowledgeRow) => {
    closeTip();
    const go = () => {
      stashComposerFill(row);
      nav(`/?knowledge_id=${encodeURIComponent(row.id)}`);
    };
    if (row.cited) {
      go();
      return;
    }
    void api.citeKnowledge(row.id).then(() => go()).catch((e) => setErr(e instanceof Error ? e.message : "无法选用这份资料"));
  };

  const toggleFavorite = (row: KnowledgeRow) => {
    const wasFavorite = favorites.includes(row.id);
    const next = wasFavorite ? favorites.filter((id) => id !== row.id) : [...favorites, row.id];
    setFavorites(next);
    writeKbFavorites(next);
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, favorite: !wasFavorite, has_newer_version: false } : item));
    const request = wasFavorite ? api.unfavoriteKnowledge(row.id) : api.favoriteKnowledge(row.id);
    void request.catch(() => {
      // 收藏的本机缓存是离线与接口故障时的降级路径；下一次成功加载会以服务端为准。
      setErr("收藏暂未同步到服务器，已保存在本机；恢复连接后请刷新确认。");
    });
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
    setQuery("");
    setView("all");
  };

  const anyFilter = scoped || Boolean(stageFilters.length || brandFilters.length || query.trim()) || view !== "all";

  const emptyCopy = useMemo(() => {
    if (view === "favorites") return "还没有收藏的知识。先把常用资料加入收藏。";
    if (view === "recent") return "还没有最近查看的知识。打开一条资料后会出现在这里。";
    if (keyword) return KB_EMPTY_SEARCH;
    if (stageFilters.length || brandFilters.length) return KB_EMPTY_FILTER;
    if (scoped) return KB_EMPTY_SCOPE;
    return "暂无已发布资料。";
  }, [view, brandFilters, keyword, stageFilters, scoped]);

  return (
    <section className="kbv kbv-page knowledge-browse" data-kb-page="mine" data-kb-v2="home">
      <KnowledgeBrowseWorkspace detailOpen={detailOpen && !!selectedRow}>
        <section className="kbv-list" aria-label="知识列表" data-kbv-list aria-busy={loading}>
          {loading ? <p className="knowledge-load-footer" role="status">{loaded ? "正在检索知识…" : "正在加载知识…"}</p> : null}
          {loaded ? (
            <KnowledgeFilterBar>
              <WorkspaceSearchInput className="kbv-search"
                  aria-label={KB_SEARCH_LABEL}
                  data-kb-search
                  value={query}
                  placeholder={KB_SEARCH_PLACEHOLDER}
                  onChange={(event) => setQuery(event.target.value)}
                />

              {hasTaxonomy ? (
                <ScopeTabs
                  familyOptions={familyOptions}
                  domainOptions={domainOptions}
                  baseOptions={baseOptions}
                  familyId={familyId}
                  domainId={domainId}
                  baseId={baseId}
                  onFamily={(id) => {
                    setFamilyId(id);
                    setDomainId("");
                    setBaseId("");
                  }}
                  onDomain={(id) => {
                    setDomainId(id);
                    setBaseId("");
                  }}
                  onBase={setBaseId}
                  familyTotal={familyTotal}
                  domainTotal={domainTotal}
                  baseTotal={baseTotal}
                />
              ) : (
                <p className="muted" data-kb-scope-none>{KB_SCOPE_NONE}</p>
              )}

              <FilterChips
                label={KB_FILTER_LABEL.brand}
                filterKey="brand"
                options={brandOptions}
                selected={brandFilters}
                onToggle={(value) => setBrandFilters((current) => (
                  current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
                ))}
                onClear={() => setBrandFilters([])}
              />
              <StageFilterGroup
                selected={stageFilters}
                onChange={setStageFilters}
              />
              {anyFilter ? (
                <div className="kbv-filters">
                  <button className="kbv-link-plain" type="button" data-kb-scope-clear onClick={resetAll}>
                    {KB_SCOPE_CLEAR}
                  </button>
                </div>
              ) : null}
            </KnowledgeFilterBar>
          ) : null}

          {loaded ? (
            <div className="kbv-tabs" role="group" aria-label="快捷视图">
              {EMPLOYEE_VIEWS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="kbv-tab"
                  aria-pressed={view === item.key}
                  data-kbv-view={item.key}
                  onClick={() => setView(item.key)}
                >
                  {item.label} <small>{counts[item.key]}</small>
                </button>
              ))}
              {/* 计数与列表同源（§8 数字同源），并入本行不再单独占一行高度。 */}
              <span className="kbv-tabs-count" data-kbv-count>{filteredVisible.length} 条知识</span>
            </div>
          ) : null}

          {loaded && visible.length ? (
            <div className="kbv-records" data-kbv-records>
              {visible.map((row) => <KnowledgeListRow key={row.id} row={row}
                selected={selectedRow?.id === row.id} kind={kindLabel(row.kind)}
                onOpen={() => openRow(row)}
              />)}
            </div>
          ) : null}
          {loaded && visible.length > 0 ? <ListLoadFooter remaining={filteredVisible.length - visible.length}
            onMore={() => setDisplayLimit((value) => Math.min(value + 5, filteredVisible.length))} /> : null}

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
              <KnowledgeDetailHeader row={selectedRow} favorite={favorites.includes(selectedRow.id)}
                onFavorite={() => toggleFavorite(selectedRow)} onBack={() => {
                  setDetailOpen(false);
                  requestAnimationFrame(() => {
                    const buttons = document.querySelectorAll<HTMLButtonElement>("[data-kb-open]");
                    [...buttons].find((button) => button.dataset.kbOpen === selectedRow.id)?.focus({ preventScroll: true });
                  });
                }} />
              <div className="kbv-rail-body">
                <InlineMetadata row={selectedRow} scope={<ScopeChips row={selectedRow} />} />
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
                  })() : <p className="muted">正在读取版本记录…</p>}
                </details> : null}
                {selectedRow.subject && (
                  <p className="kb-preview-subject"><span>主题</span> {selectedRow.subject}</p>
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
                  <Hinted
                    id={`${selectedRow.id}-fill`}
                    open={tipId === `${selectedRow.id}-fill`}
                    onOpen={setTipId}
                    onClose={closeTip}
                    hint={
                      kbIsMail(selectedRow)
                        ? "锁定这份资料并打开首页草稿。英文正文会填进输入框，可改后再发，不会直接发送。"
                        : "把适用说明带进当前任务。只作为参考草稿，不会直接发送，也不会改阶段。"
                    }
                  >
                    <CompactButton
                      emphasis="primary" size="md"
                      type="button"
                      data-kb-use={selectedRow.id}
                      data-fill-composer={selectedRow.id}
                      onClick={() => useForTask(selectedRow)}
                    >
                      带入工作草稿
                    </CompactButton>
                  </Hinted>
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
