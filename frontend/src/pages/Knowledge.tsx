import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, type KnowledgeRow, type SkillTemplate } from "../api";
import SkillTemplateContext from "../components/SkillTemplateContext";
import { stashComposerDraft } from "../composer/draft";
import { templateQuestionDraft } from "../skillTemplate";
import {
  HIDE_REASONS,
  KB_EMPTY_FILTER,
  KB_EMPTY_SEARCH,
  KB_EMPTY_SCOPE,
  KB_FILTER_ALL,
  KB_FILTER_LABEL,
  KB_LEAD,
  KB_LOADING,
  KB_PROVENANCE_LABEL,
  KB_PROVENANCE_TITLE,
  KB_SCOPE_ALL,
  KB_SCOPE_BASE,
  KB_SCOPE_CURRENT,
  KB_SCOPE_DOMAIN,
  KB_SCOPE_FAMILY,
  KB_SCOPE_LEAD,
  KB_SCOPE_NONE,
  KB_SEARCH_LABEL,
  KB_SEARCH_PLACEHOLDER,
  formatKbTime,
  hideReasonLabel,
  kbAuthorLabel,
  kbIsMail,
  kbMatchesFilter,
  kbRowVersionLine,
  kbScopeTags,
  kbStatusLabel,
  kbSummary,
  kbVariableLine,
  kbVersionTag,
  kindLabel,
  readKbFavorites,
  readKbRecent,
  rememberKbRecent,
  stashComposerFill,
  toggleKbFavorite,
} from "../knowledgeCopy";
import KbvIcon from "../knowledgeIcons";
import "../knowledge-page.css";

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
    <span className={"kb-action" + (open ? " has-tip" : "")} onMouseEnter={() => onOpen(id)}>
      {children}
      {open && (
        <span className="kb-tip" role="tooltip" data-kb-tip={id}>
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

/** 适用 chips：有则显示阶段/品牌，无则「全阶段 / 通用」，行内与详情共用。 */
function ScopeChips({ row }: { row: KnowledgeRow }) {
  return (
    <span className="kb-scope" data-kb-scope>
      {kbScopeTags(row).map((tag) => (
        <span className="chip kb-scope-chip" key={tag}>{tag}</span>
      ))}
    </span>
  );
}

type ScopeOption = { id: string; name: string };

/** 从可见行里归纳分类选项：只列出你确实看得到的族 / 域 / 库。 */
function collectScope(
  rows: KnowledgeRow[],
  level: "family" | "domain" | "base",
  parentId: string,
): ScopeOption[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (level === "family") {
      if (row.family_id) seen.set(row.family_id, row.family_name || row.family_id);
    } else if (level === "domain") {
      if (parentId && row.family_id !== parentId) continue;
      if (row.domain_id) seen.set(row.domain_id, row.domain_name || row.domain_id);
    } else {
      if (parentId && row.domain_id !== parentId) continue;
      if (row.base_id) seen.set(row.base_id, row.base_name || row.base_id);
    }
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

/** 员工端知识库（IA v2）：顶栏＋中栏列表＋右栏同页详情；保留既有筛选、收藏、反馈/隐藏与引用链路。 */
export default function Knowledge() {
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [skillTemplates, setSkillTemplates] = useState<SkillTemplate[]>([]);
  const [skillTemplatesLoading, setSkillTemplatesLoading] = useState(true);
  const [skillTemplatesError, setSkillTemplatesError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [hideFor, setHideFor] = useState("");
  const [err, setErr] = useState("");
  const [tipId, setTipId] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => readKbFavorites());
  const [recentIds, setRecentIds] = useState<string[]>(() => readKbRecent().map((item) => item.id));
  const [view, setView] = useState<KbEmployeeView>("all");
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [stageFilter, setStageFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [baseId, setBaseId] = useState("");
  const nav = useNavigate();
  const closeTip = useCallback(() => setTipId(""), []);

  const reload = useCallback(() => {
    api.knowledge({ q: keyword })
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载知识库"))
      .finally(() => setLoaded(true));
  }, [keyword]);

  useEffect(reload, [reload]);

  const loadSkillTemplates = useCallback(async () => {
    setSkillTemplatesLoading(true);
    setSkillTemplatesError("");
    try {
      const templates = await api.skillTemplates();
      setSkillTemplates(Array.isArray(templates) ? templates : []);
    } catch (error) {
      setSkillTemplatesError(error instanceof Error ? error.message : "无法加载技能交互模板");
    } finally {
      setSkillTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { void loadSkillTemplates(); }, [loadSkillTemplates]);

  useEffect(() => {
    const next = query.trim();
    if (next === keyword) return;
    const timer = setTimeout(() => setKeyword(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword, query]);

  const familyOptions = useMemo(() => collectScope(rows, "family", ""), [rows]);
  const domainOptions = useMemo(() => collectScope(rows, "domain", familyId), [rows, familyId]);
  const baseOptions = useMemo(() => collectScope(rows, "base", domainId), [rows, domainId]);
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

  const stageOptions = useMemo(
    () => [...new Set(rows.flatMap((row) => row.stage_codes || []).filter(Boolean))].sort(),
    [rows],
  );
  const brandOptions = useMemo(
    () => [...new Set(
      rows.map((row) => String(row.brand || "").trim()).filter((code) => code && code !== "*"),
    )].sort(),
    [rows],
  );

  useEffect(() => {
    if (stageFilter && !stageOptions.includes(stageFilter)) setStageFilter("");
    if (brandFilter && !brandOptions.includes(brandFilter)) setBrandFilter("");
  }, [brandFilter, brandOptions, stageFilter, stageOptions]);

  const scopedVisible = useMemo(() => {
    return rows.filter((row) => {
      if (familyId && row.family_id !== familyId) return false;
      if (domainId && row.domain_id !== domainId) return false;
      if (baseId && row.base_id !== baseId) return false;
      return kbMatchesFilter(row, stageFilter, brandFilter);
    });
  }, [rows, familyId, domainId, baseId, stageFilter, brandFilter]);

  const counts = useMemo(() => ({
    all: scopedVisible.length,
    favorites: scopedVisible.filter((row) => favorites.includes(row.id)).length,
    recent: scopedVisible.filter((row) => recentIds.includes(row.id)).length,
  }), [scopedVisible, favorites, recentIds]);

  const visible = useMemo(() => {
    if (view === "favorites") return scopedVisible.filter((row) => favorites.includes(row.id));
    if (view === "recent") return scopedVisible.filter((row) => recentIds.includes(row.id));
    return scopedVisible;
  }, [scopedVisible, view, favorites, recentIds]);

  const selectedRow = useMemo(
    () => visible.find((row) => row.id === selectedId) || visible[0] || null,
    [visible, selectedId],
  );

  const visibleSkillTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return skillTemplates;
    return skillTemplates.filter((template) => (
      `${template.title} ${template.description} ${template.skill_id}`.toLowerCase().includes(needle)
    ));
  }, [query, skillTemplates]);

  const scopeNames = useMemo(() => {
    const pick = (options: ScopeOption[], id: string) => options.find((item) => item.id === id)?.name || "";
    return [
      familyId ? pick(familyOptions, familyId) : "",
      domainId ? pick(domainOptions, domainId) : "",
      baseId ? pick(baseOptions, baseId) : "",
    ].filter(Boolean);
  }, [familyId, domainId, baseId, familyOptions, domainOptions, baseOptions]);

  const openRow = (row: KnowledgeRow) => {
    closeTip();
    setSelectedId(row.id);
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

  const askWithSkillTemplate = (template: SkillTemplate) => {
    closeTip();
    // The template is a read-only published Skill projection, not a knowledge
    // row: stash only an editable question draft and never cite/edit this
    // synthetic identifier or start an execution from the library.
    stashComposerDraft(templateQuestionDraft(template));
    nav("/");
  };

  const clearScope = () => {
    setFamilyId("");
    setDomainId("");
    setBaseId("");
  };

  const resetAll = () => {
    clearScope();
    setStageFilter("");
    setBrandFilter("");
    setQuery("");
    setView("all");
  };

  const anyFilter = scoped || Boolean(stageFilter || brandFilter || query.trim()) || view !== "all";

  const emptyCopy = useMemo(() => {
    if (view === "favorites") return "还没有收藏的知识。先把常用资料加入收藏。";
    if (view === "recent") return "还没有最近查看的知识。打开一条资料后会出现在这里。";
    if (keyword) return KB_EMPTY_SEARCH;
    if (stageFilter || brandFilter) return KB_EMPTY_FILTER;
    if (scoped) return KB_EMPTY_SCOPE;
    return "暂无已发布资料。";
  }, [view, brandFilter, keyword, stageFilter, scoped]);

  return (
    <section className="kbv kbv-page" data-kb-page="mine" data-kb-v2="home">
      <header className="kbv-top" data-kbv-top>
        <div className="kbv-heading">
          <h1>知识库</h1>
          {loaded
            ? <span className="kbv-lead">{KB_LEAD}</span>
            : <span className="kbv-lead" data-kb-loading>{KB_LOADING}</span>}
        </div>
        <div className="kbv-actions">
          <small className="muted">仅展示已发布、且在你的范围内可见的知识</small>
        </div>
      </header>

      <div className="kbv-workspace">
        <section className="kbv-list" aria-label="知识列表" data-kbv-list>
          {loaded ? (
            <div className="kbv-tools" data-kb-scope-picker aria-label={KB_SCOPE_LEAD}>
              <div className="kbv-search">
                <KbvIcon name="search" />
                <input
                  type="search"
                  aria-label={KB_SEARCH_LABEL}
                  data-kb-search
                  value={query}
                  placeholder={KB_SEARCH_PLACEHOLDER}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="kbv-filters">
                {hasTaxonomy ? (
                  <>
                    <span className="sr-only">{KB_SCOPE_CURRENT}</span>
                    <select
                      aria-label={KB_SCOPE_FAMILY}
                      data-kb-scope-family
                      value={familyId}
                      onChange={(event) => {
                        setFamilyId(event.target.value);
                        setDomainId("");
                        setBaseId("");
                      }}
                    >
                      <option value="">{KB_SCOPE_ALL}族</option>
                      {familyOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <select
                      aria-label={KB_SCOPE_DOMAIN}
                      data-kb-scope-domain
                      value={domainId}
                      onChange={(event) => {
                        setDomainId(event.target.value);
                        setBaseId("");
                      }}
                    >
                      <option value="">{KB_SCOPE_ALL}域</option>
                      {domainOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <select
                      aria-label={KB_SCOPE_BASE}
                      data-kb-scope-base
                      value={baseId}
                      onChange={(event) => setBaseId(event.target.value)}
                    >
                      <option value="">{KB_SCOPE_ALL}库</option>
                      {baseOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </>
                ) : (
                  <span className="muted" data-kb-scope-none>{KB_SCOPE_NONE}</span>
                )}
                <select
                  aria-label={KB_FILTER_LABEL.stage}
                  data-kb-filter="stage"
                  value={stageFilter}
                  onChange={(event) => setStageFilter(event.target.value)}
                >
                  <option value="">{KB_FILTER_LABEL.stage}{KB_FILTER_ALL}</option>
                  {stageOptions.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
                <select
                  aria-label={KB_FILTER_LABEL.brand}
                  data-kb-filter="brand"
                  value={brandFilter}
                  onChange={(event) => setBrandFilter(event.target.value)}
                >
                  <option value="">{KB_FILTER_LABEL.brand}{KB_FILTER_ALL}</option>
                  {brandOptions.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
                {anyFilter ? (
                  <button className="kbv-link-plain" type="button" data-kb-scope-clear onClick={resetAll}>
                    清空筛选
                  </button>
                ) : null}
              </div>
            </div>
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
            </div>
          ) : null}

          {loaded ? (
            <div className="kbv-count">
              <span>{visible.length} 条知识</span>
              {scoped ? <span data-kb-scope-path>{scopeNames.join(" / ")}</span> : null}
            </div>
          ) : null}

          {loaded ? (
            <details className="kb-skill-templates" data-kb-skill-templates>
              <summary className="kb-skill-templates-head">
                <span>
                  <span className="page-kicker">已发布技能</span>
                  <strong id="kb-skill-template-title">技能交互模板</strong>
                  <small>查看功能、预计步骤和输入条件；用于提问只打开草稿，不会自动执行。</small>
                </span>
                <span>{skillTemplatesLoading ? "加载中" : `${visibleSkillTemplates.length} 项`}</span>
              </summary>
              <div className="kb-skill-template-list" aria-labelledby="kb-skill-template-title">
                {skillTemplatesLoading ? <p className="muted">正在加载技能交互模板…</p> : null}
                {skillTemplatesError ? (
                  <p className="error" role="alert">
                    无法加载技能交互模板：{skillTemplatesError}
                    <button className="btn row-action" type="button" onClick={() => void loadSkillTemplates()}>重试</button>
                  </p>
                ) : null}
                {!skillTemplatesLoading && !skillTemplatesError && !visibleSkillTemplates.length ? (
                  <p className="muted">{query.trim() ? "没有匹配的技能交互模板。" : "暂无已发布技能交互模板。"}</p>
                ) : null}
                {visibleSkillTemplates.map((template) => (
                  <article className="kb-skill-template-row" key={template.id} data-skill-template={template.id}>
                    <div className="kb-skill-template-summary">
                      <strong>{template.title}</strong>
                      <span>{template.description || "按已发布技能契约处理你的请求。"}</span>
                    </div>
                    <div className="kb-skill-template-actions">
                      <details data-kb-skill-template-preview={template.id}>
                        <summary>查看交互模板</summary>
                        <SkillTemplateContext template={template} />
                      </details>
                      <button
                        className="btn row-action"
                        type="button"
                        data-kb-skill-template-ask={template.skill_id}
                        onClick={() => askWithSkillTemplate(template)}
                      >
                        用于提问
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </details>
          ) : null}

          {loaded && visible.length ? (
            <div className="kbv-records" data-kbv-records>
              {visible.map((row) => {
                const favorited = favorites.includes(row.id);
                return (
                  <button
                    type="button"
                    className="kbv-record"
                    key={row.id}
                    data-knowledge={row.id}
                    data-kind={row.kind}
                    data-cited={row.cited ? "true" : "false"}
                    data-kb-open={row.id}
                    aria-current={selectedRow?.id === row.id}
                    onClick={() => openRow(row)}
                  >
                    <span className="kbv-record-icon"><KbvIcon name={kbIsMail(row) ? "mail" : "file"} /></span>
                    <span className="kbv-record-copy">
                      <span className="kbv-record-title">{row.title}</span>
                      <span className="kbv-record-meta">
                        <span>{kindLabel(row.kind)}</span>
                        <ScopeChips row={row} />
                        {row.deprecated ? <span className="chip chip-warn">已隐藏</span> : null}
                        {favorited ? <span aria-hidden="true">★</span> : null}
                      </span>
                    </span>
                    <span className="kbv-record-end">
                      <span>{formatKbTime(row.updated_at || row.approved_at || row.created_at) || ""}</span>
                      <span>{kbVersionTag(row.current_version)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {err && <p className="error">{err}</p>}
          {loaded && !rows.length && !keyword ? <p className="kbv-empty">暂无已发布资料。</p> : null}
          {loaded && (rows.length > 0 || !!keyword) && !visible.length ? (
            <p className="kbv-empty" data-kb-empty>{emptyCopy}</p>
          ) : null}
        </section>

        <aside className="kbv-rail" aria-label="知识详情" data-kb-detail>
          {selectedRow ? (
            <div className="kbv-rail-inner" data-kb-preview={selectedRow.id}>
              <div className="kbv-rail-head">
                <div className="kbv-title-row">
                  <h2 id="kb-preview-title">{selectedRow.title}</h2>
                  <Hinted
                    id={`${selectedRow.id}-fav`}
                    open={tipId === `${selectedRow.id}-fav`}
                    onOpen={setTipId}
                    onClose={closeTip}
                    hint="先记在这台设备上，方便下次找。不会同步到其他设备。"
                  >
                    <button
                      className={"btn" + (favorites.includes(selectedRow.id) ? " is-on" : "")}
                      type="button"
                      data-kb-favorite={selectedRow.id}
                      aria-pressed={favorites.includes(selectedRow.id)}
                      onClick={() => setFavorites(toggleKbFavorite(selectedRow.id))}
                    >
                      {favorites.includes(selectedRow.id) ? "已收藏" : "收藏"}
                    </button>
                  </Hinted>
                </div>
                <div className="kbv-subtitle">
                  <span className="chip">{kbStatusLabel(selectedRow)}</span>
                  <span>{kbRowVersionLine(selectedRow)}</span>
                </div>
              </div>

              <div className="kbv-rail-body">
                <p className="kb-result">打开全文，不会把资料发出去。</p>
                <section className="kb-provenance" data-kb-provenance aria-label={KB_PROVENANCE_TITLE}>
                  <p className="kb-provenance-title">{KB_PROVENANCE_TITLE}</p>
                  <dl className="kb-provenance-grid">
                    <div>
                      <dt>{KB_PROVENANCE_LABEL.author}</dt>
                      <dd>{kbAuthorLabel(selectedRow.created_by)}</dd>
                    </div>
                    <div>
                      <dt>{KB_PROVENANCE_LABEL.version}</dt>
                      <dd>{kbVersionTag(selectedRow.current_version)}</dd>
                    </div>
                    <div>
                      <dt>{KB_PROVENANCE_LABEL.updated}</dt>
                      <dd>{formatKbTime(selectedRow.updated_at || selectedRow.approved_at || selectedRow.created_at) || "暂无时间"}</dd>
                    </div>
                    <div>
                      <dt>{KB_PROVENANCE_LABEL.scope}</dt>
                      <dd><ScopeChips row={selectedRow} /></dd>
                    </div>
                  </dl>
                </section>
                <p className="kb-card-summary" data-kb-summary>{kbSummary(selectedRow)}</p>
                {kbVariableLine(selectedRow) ? <p className="kb-card-vars">{kbVariableLine(selectedRow)}</p> : null}
                {selectedRow.subject && (
                  <p className="kb-preview-subject"><span>主题</span> {selectedRow.subject}</p>
                )}
                <pre className="kb-preview-body" data-kb-preview-body>{selectedRow.body_en || selectedRow.body}</pre>
                {selectedRow.deprecated && (
                  <p className="kb-card-hidden">
                    已隐藏 · {hideReasonLabel(selectedRow.deprecate_reason) || selectedRow.deprecate_reason_label}
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

              <footer className="kbv-rail-foot">
                <small className="muted">用于当前任务只把它带进草稿；正式发送前仍需要你确认。</small>
                <div className="kbv-actions">
                  {selectedRow.deprecated ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void api.undeprecateKnowledge(selectedRow.id).then(() => { setHideFor(""); reload(); })}
                    >
                      取消隐藏
                    </button>
                  ) : (
                    <Hinted
                      id={`${selectedRow.id}-hide`}
                      open={tipId === `${selectedRow.id}-hide`}
                      onOpen={setTipId}
                      onClose={closeTip}
                      hint="只在本账号隐藏；写邮件时不再带上这份资料，已发信不受影响。"
                    >
                      <button
                        className={"btn" + (hideFor === selectedRow.id ? " is-on" : "")}
                        type="button"
                        aria-expanded={hideFor === selectedRow.id}
                        aria-pressed={hideFor === selectedRow.id}
                        onClick={() => setHideFor((current) => (current === selectedRow.id ? "" : selectedRow.id))}
                      >
                        反馈 / 隐藏
                      </button>
                    </Hinted>
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
                    <button
                      className="btn work"
                      type="button"
                      data-kb-use={selectedRow.id}
                      data-fill-composer={selectedRow.id}
                      onClick={() => useForTask(selectedRow)}
                    >
                      用于当前任务
                    </button>
                  </Hinted>
                </div>
              </footer>
            </div>
          ) : (
            <p className="kbv-empty">{loaded ? "从列表选择一条知识，查看内容与来源。" : KB_LOADING}</p>
          )}
        </aside>
      </div>
    </section>
  );
}
