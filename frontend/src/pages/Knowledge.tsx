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
  KB_SCOPE_CLEAR,
  KB_SCOPE_CURRENT,
  KB_SCOPE_DOMAIN,
  KB_SCOPE_FAMILY,
  KB_SCOPE_LEAD,
  KB_SCOPE_NONE,
  KB_SEARCH_CLEAR,
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
  stashComposerFill,
  toggleKbFavorite,
} from "../knowledgeCopy";

const SEARCH_DEBOUNCE_MS = 300;

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

/** 适用 chips：有则显示阶段/品牌，无则「全阶段 / 通用」，行内与抽屉共用。 */
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

function ContentDrawer({
  row,
  onClose,
  onUse,
}: {
  row: KnowledgeRow;
  onClose: () => void;
  onUse: (row: KnowledgeRow) => void;
}) {
  const status = kbStatusLabel(row);
  const vars = kbVariableLine(row);
  return (
    <aside
      className="kb-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kb-preview-title"
      data-kb-preview={row.id}
      data-kb-drawer
    >
      <header className="kb-drawer-head">
        <div>
          <div className="page-kicker">{kbIsMail(row) ? "知识库 · 邮件模板" : "知识库"}</div>
          <h2 id="kb-preview-title">{row.title}</h2>
          <p className="kb-drawer-status">
            <span className={"chip" + (row.deprecated ? " chip-warn" : "")}>{status}</span>
          </p>
        </div>
        <button className="btn" type="button" onClick={onClose}>关闭</button>
      </header>
      <div className="kb-drawer-body">
        <p className="kb-result">打开全文，不会把资料发出去。</p>
        <section className="kb-provenance" data-kb-provenance aria-label={KB_PROVENANCE_TITLE}>
          <p className="kb-provenance-title">{KB_PROVENANCE_TITLE}</p>
          <dl className="kb-provenance-grid">
            <div>
              <dt>{KB_PROVENANCE_LABEL.author}</dt>
              <dd>{kbAuthorLabel(row.created_by)}</dd>
            </div>
            <div>
              <dt>{KB_PROVENANCE_LABEL.version}</dt>
              <dd>{kbVersionTag(row.current_version)}</dd>
            </div>
            <div>
              <dt>{KB_PROVENANCE_LABEL.updated}</dt>
              <dd>{formatKbTime(row.updated_at || row.approved_at || row.created_at) || "暂无时间"}</dd>
            </div>
            <div>
              <dt>{KB_PROVENANCE_LABEL.scope}</dt>
              <dd><ScopeChips row={row} /></dd>
            </div>
          </dl>
        </section>
        {vars ? <p className="kb-card-vars">{vars}</p> : null}
        {row.subject && (
          <p className="kb-preview-subject"><span>主题</span> {row.subject}</p>
        )}
        <pre className="kb-preview-body" data-kb-preview-body>{row.body_en || row.body}</pre>
      </div>
      <footer className="kb-drawer-foot">
        <button className="btn work" type="button" data-kb-use={row.id} onClick={() => onUse(row)}>
          用于当前任务
        </button>
      </footer>
    </aside>
  );
}

export default function Knowledge() {
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [skillTemplates, setSkillTemplates] = useState<SkillTemplate[]>([]);
  const [skillTemplatesLoading, setSkillTemplatesLoading] = useState(true);
  const [skillTemplatesError, setSkillTemplatesError] = useState("");
  const [preview, setPreview] = useState<KnowledgeRow | null>(null);
  const [hideFor, setHideFor] = useState("");
  const [err, setErr] = useState("");
  const [tipId, setTipId] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => readKbFavorites());
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

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

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

  const openPreview = (row: KnowledgeRow) => {
    closeTip();
    setPreview(row);
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

  const visible = useMemo(() => {
    return rows.filter((row) => {
      if (familyId && row.family_id !== familyId) return false;
      if (domainId && row.domain_id !== domainId) return false;
      if (baseId && row.base_id !== baseId) return false;
      return kbMatchesFilter(row, stageFilter, brandFilter);
    });
  }, [rows, familyId, domainId, baseId, stageFilter, brandFilter]);

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

  const emptyCopy = useMemo(() => {
    if (keyword) return KB_EMPTY_SEARCH;
    if (stageFilter || brandFilter) return KB_EMPTY_FILTER;
    if (scoped) return KB_EMPTY_SCOPE;
    return "暂无已发布资料。";
  }, [brandFilter, keyword, stageFilter, scoped]);

  const clearScope = () => {
    setFamilyId("");
    setDomainId("");
    setBaseId("");
  };

  return (
    <div className={"list-page kb-page" + (preview ? " has-drawer" : "")} data-kb-page="mine">
      <header className="kb-hero">
        {loaded ? <div className="page-kicker">知识库</div> : null}
        <h1>知识库</h1>
        {loaded ? <p className="kb-lead">{KB_LEAD}</p> : <p className="muted" data-kb-loading>{KB_LOADING}</p>}
      </header>

      {loaded ? (
        <section className="kb-scope-picker" data-kb-scope-picker aria-label={KB_SCOPE_LEAD}>
          <p className="kb-scope-lead" data-kb-scope-lead>
            <span className="sr-only">{KB_SCOPE_CURRENT}</span>
            {KB_SCOPE_LEAD}
          </p>
          {hasTaxonomy ? (
            <div className="kb-scope-selects">
              <label className="kb-filter">
                <span className="kb-filter-label">{KB_SCOPE_FAMILY}</span>
                <select
                  data-kb-scope-family
                  value={familyId}
                  onChange={(event) => {
                    setFamilyId(event.target.value);
                    setDomainId("");
                    setBaseId("");
                  }}
                >
                  <option value="">{KB_SCOPE_ALL}</option>
                  {familyOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="kb-filter">
                <span className="kb-filter-label">{KB_SCOPE_DOMAIN}</span>
                <select
                  data-kb-scope-domain
                  value={domainId}
                  onChange={(event) => {
                    setDomainId(event.target.value);
                    setBaseId("");
                  }}
                >
                  <option value="">{KB_SCOPE_ALL}</option>
                  {domainOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="kb-filter">
                <span className="kb-filter-label">{KB_SCOPE_BASE}</span>
                <select data-kb-scope-base value={baseId} onChange={(event) => setBaseId(event.target.value)}>
                  <option value="">{KB_SCOPE_ALL}</option>
                  {baseOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              {scoped ? (
                <button className="btn row-action" type="button" data-kb-scope-clear onClick={clearScope}>
                  {KB_SCOPE_CLEAR}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="muted" data-kb-scope-none>{KB_SCOPE_NONE}</p>
          )}
          {scoped ? (
            <p className="kb-scope-path" data-kb-scope-path>{scopeNames.join(" / ")}</p>
          ) : null}
        </section>
      ) : null}

      {loaded ? (
      <div className="kb-toolbar">
        <label className="kb-search">
          <span className="sr-only">{KB_SEARCH_LABEL}</span>
          <input
            type="search"
            className="kb-search-input"
            data-kb-search
            value={query}
            placeholder={KB_SEARCH_PLACEHOLDER}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {query ? (
          <button className="btn row-action" type="button" data-kb-search-clear onClick={() => setQuery("")}>
            {KB_SEARCH_CLEAR}
          </button>
        ) : null}
        <div className="kb-filters">
          <label className="kb-filter">
            <span className="kb-filter-label">{KB_FILTER_LABEL.stage}</span>
            <select
              data-kb-filter="stage"
              value={stageFilter}
              onChange={(event) => setStageFilter(event.target.value)}
            >
              <option value="">{KB_FILTER_ALL}</option>
              {stageOptions.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </label>
          <label className="kb-filter">
            <span className="kb-filter-label">{KB_FILTER_LABEL.brand}</span>
            <select
              data-kb-filter="brand"
              value={brandFilter}
              onChange={(event) => setBrandFilter(event.target.value)}
            >
              <option value="">{KB_FILTER_ALL}</option>
              {brandOptions.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      ) : null}
      {err && <p className="error">{err}</p>}
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
      {loaded && visible.map((k) => {
        const status = kbStatusLabel(k);
        const favorited = favorites.includes(k.id);
        return (
          <article
            className={"panel kb-card" + (k.cited ? " is-cited" : "") + (k.deprecated ? " is-hidden" : "")}
            key={k.id}
            data-knowledge={k.id}
            data-kind={k.kind}
            data-cited={k.cited ? "true" : "false"}
          >
            <div className="kb-card-title-row">
              <h3>{k.title}</h3>
              <div className="kb-card-tags">
                <span className="chip kb-kind">{kindLabel(k.kind)}</span>
                <span className={"chip kb-status" + (k.deprecated ? " chip-warn" : "")}>
                  {status}
                </span>
              </div>
            </div>
            <div className="kb-card-meta-row">
              <ScopeChips row={k} />
              <span className="kb-card-source">{kbRowVersionLine(k)}</span>
            </div>
            <p className="kb-card-summary" data-kb-summary>{kbSummary(k)}</p>
            {k.deprecated && (
              <p className="kb-card-hidden">已隐藏 · {hideReasonLabel(k.deprecate_reason) || k.deprecate_reason_label}</p>
            )}
            <div className="kb-actions">
              <Hinted
                id={`${k.id}-fill`}
                open={tipId === `${k.id}-fill`}
                onOpen={setTipId}
                onClose={closeTip}
                hint={
                  kbIsMail(k)
                    ? "锁定这份资料并打开首页草稿。英文正文会填进输入框，可改后再发，不会直接发送。"
                    : "把适用说明带进当前任务。只作为参考草稿，不会直接发送，也不会改阶段。"
                }
              >
                {/* 卡内动作：不是这一屏的主行动，走描边款（抽屉页脚那颗才是该表面的主 CTA）。 */}
                <button className="btn row-action" type="button" data-fill-composer={k.id} onClick={() => useForTask(k)}>
                  用于当前任务
                </button>
              </Hinted>
              <Hinted
                id={`${k.id}-preview`}
                open={tipId === `${k.id}-preview`}
                onOpen={setTipId}
                onClose={closeTip}
                  hint="打开全文。不会把资料发出去。"
              >
                <button
                  className={"btn" + (preview?.id === k.id ? " is-on" : "")}
                  type="button"
                  data-kb-open={k.id}
                  aria-pressed={preview?.id === k.id}
                  onClick={() => openPreview(k)}
                >
                  查看内容
                </button>
              </Hinted>
              <Hinted
                id={`${k.id}-fav`}
                open={tipId === `${k.id}-fav`}
                onOpen={setTipId}
                onClose={closeTip}
                hint="先记在这台设备上，方便下次找。不会同步到其他设备。"
              >
                <button
                  className={"btn" + (favorited ? " is-on" : "")}
                  type="button"
                  data-kb-favorite={k.id}
                  aria-pressed={favorited}
                  onClick={() => setFavorites(toggleKbFavorite(k.id))}
                >
                  {favorited ? "已收藏" : "收藏"}
                </button>
              </Hinted>
            </div>
            <details className="kb-more" data-kb-more={k.id}>
              <summary>更多</summary>
              <div className="kb-more-actions">
                {k.deprecated ? (
                  <button className="btn" type="button" onClick={() => void api.undeprecateKnowledge(k.id).then(() => { setHideFor(""); reload(); })}>
                    取消隐藏
                  </button>
                ) : (
                  <button
                    className={"btn" + (hideFor === k.id ? " is-on" : "")}
                    type="button"
                    aria-expanded={hideFor === k.id}
                    aria-pressed={hideFor === k.id}
                    onClick={() => setHideFor((cur) => (cur === k.id ? "" : k.id))}
                  >
                    对本账号隐藏
                  </button>
                )}
              </div>
              {hideFor === k.id && !k.deprecated && (
                <div className="kb-hide-panel">
                  <p className="kb-hide-title">选择隐藏原因 · 只影响你这个账号</p>
                  {HIDE_REASONS.map((reason) => (
                    <button
                      key={reason.code}
                      className="kb-hide-option"
                      type="button"
                      data-deprecate-reason={reason.code}
                      onClick={() => void api.deprecateKnowledge(k.id, reason.code).then(() => { setHideFor(""); reload(); })}
                    >
                      <strong>{reason.label}</strong>
                      <span>{reason.result}</span>
                    </button>
                  ))}
                </div>
              )}
            </details>
          </article>
        );
      })}
      {loaded && !rows.length && !keyword && <p className="muted">暂无已发布资料。</p>}
      {loaded && (rows.length > 0 || !!keyword) && !visible.length && (
        <p className="muted" data-kb-empty>{emptyCopy}</p>
      )}
      {preview && (
        <ContentDrawer
          row={preview}
          onClose={() => setPreview(null)}
          onUse={useForTask}
        />
      )}
    </div>
  );
}
