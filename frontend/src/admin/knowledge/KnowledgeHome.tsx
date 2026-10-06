import { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import { brandLabel, kindLabel } from "../../knowledgeCopy";
import { MAIN_STAGE_TABS } from "../../kolStages";
import { stageLabel } from "../../labels";
import { KNOWLEDGE_KIND_SPECS, errorMessage, expirySoon, useKbData, type KbAssetRow } from "./shared";
import EntryEditor from "./EntryEditor";
import WorkspaceEntry from "./WorkspaceEntry";
import { WorkspaceActionContext } from "./WorkspaceActions";
import { reviewApi,reviewCompany } from "../../reviews/api";
import { useAccount } from "../../components/AuthGate";
import KnowledgeFilters, { type FilterOption } from "./KnowledgeFilters";
import LibraryPane, { type KbView } from "./LibraryPane";
import UploadDialog from "./UploadDialog";
import DocumentRail from "./DocumentRail";
import ReviewView from "./ReviewView";
import { useSearchParams,useBlocker } from "react-router-dom";

const PAGE_SIZE = 20;
const VIEW_STATUS: Record<Exclude<KbView, "all">, string> = {
  pending: "pending_review",
  published: "published",
  draft: "draft",
  disabled: "archived",
};
const VIEW_OPTIONS: Array<{ value: KbView; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待审批" },
  { value: "published", label: "已发布" },
  { value: "draft", label: "草稿" },
  { value: "disabled", label: "已停用" },
];
const KIND_OPTIONS = KNOWLEDGE_KIND_SPECS.map((spec) => ({ value: spec.code, label: kindLabel(spec.code) }));
const SCOPE_NONE = "__none__";
type KbScope = { familyId: string; domainId: string; baseId: string };
const EMPTY_SCOPE: KbScope = { familyId: "", domainId: "", baseId: "" };
/** 驾驶舱下钻的 URL 轴：状态、资产类型、到期。只认合法值，其余忽略。 */
const viewParam = (value: string | null): KbView | null =>
  VIEW_OPTIONS.some((option) => option.value === value) ? (value as KbView) : null;
const assetParam = (value: string | null): "" | "entry" | "document" =>
  value === "entry" || value === "document" ? value : "";

/** 计数跳过哪些筛选组：计数口径＝点选该 chip 后的实际结果数（DESIGN §8 数字同源）。 */
type Skip = { view?: boolean; kind?: boolean; brand?: boolean; stage?: boolean; scope?: "all" | "sub" | "base" };

/**
 * 知识管理主页：中栏只承担筛选，右栏只承担浏览与查看。
 * 筛选同组多选为任一匹配，跨筛选区为同时满足；所有计数基于当前可见数据。
 */
export default function KnowledgeHome() {
  const [params,setParams]=useSearchParams();
  const requestedDocument=params.get("document");
  const {account}=useAccount();
  const contextKey=`knowledge.workspace:${account?.id || "current"}:${reviewCompany()}`;
  const restore=useMemo(()=>{try{return JSON.parse(sessionStorage.getItem(contextKey)||"{}");}catch{return {};}},[contextKey]);
  const load = useCallback(()=>reviewApi<{rows:KbAssetRow[];bases:import("../../api").KnowledgeBaseRow[];domains:import("../../api").KnowledgeDomainRow[]}>("/admin/knowledge/workspace-v1"),[contextKey]);
  const { data, error, loading, reload } = useKbData(load);

  const [receipt, setReceipt] = useState("");
  const [actionError, setActionError] = useState("");
  const [query, setQuery] = useState<string>(restore.query || "");
  const [scope, setScope] = useState<KbScope>(restore.scope || EMPTY_SCOPE);
  const [brands, setBrands] = useState<string[]>(restore.brands || []);
  const [stages, setStages] = useState<string[]>(restore.stages || []);
  const [kind, setKind] = useState<string>(restore.kind || "");
  const [view, setView] = useState<KbView>(viewParam(params.get("view")) || restore.view || "all");
  const [assetTypeFilter, setAssetTypeFilter] = useState<"" | "entry" | "document">(assetParam(params.get("asset")));
  /** `?expiring=1`：驾驶舱「30 天内到期」的下钻筛选轴（与卡片计数同一口径）。 */
  const [expiring, setExpiring] = useState<boolean>(params.get("expiring") === "1");
  const [page, setPage] = useState<number>(restore.page || 1);
  const [selectedId, setSelectedId] = useState<string>(params.get("assetId") || requestedDocument || restore.selectedId || "");
  const mode=params.get("mode") || (requestedDocument ? "detail":"list");
  const selectedType=params.get("assetType") || (requestedDocument ? "document":restore.selectedType || "entry");
  useEffect(()=>{const id=params.get("assetId") || params.get("document");if(id!==null)setSelectedId(id);},[params]);
  // 下钻轴以 URL 为准：链接可复制、可后退，回来时筛选条件不丢。
  useEffect(()=>{const next=viewParam(params.get("view"));if(next)setView(next);},[params]);
  useEffect(()=>{if(params.get("asset")!==null)setAssetTypeFilter(assetParam(params.get("asset")));},[params]);
  useEffect(()=>{if(params.get("expiring")!==null)setExpiring(params.get("expiring")==="1");},[params]);
  const [dirty,setDirty]=useState(false),dirtyRef=useRef(false);
  const onDirty=useCallback((value:boolean)=>{dirtyRef.current=value;setDirty(value);},[]);
  const blocker=useBlocker(()=>dirtyRef.current),asking=useRef(false);
  useEffect(()=>{
    if(blocker.state!=="blocked"){asking.current=false;return;}
    if(asking.current)return;asking.current=true;
    if(window.confirm("当前有未保存内容，放弃修改并离开？")){onDirty(false);blocker.proceed();}
    else blocker.reset();
  },[blocker,onDirty]);
  const [actionTarget,setActionTarget]=useState<HTMLElement|null>(null);
  const bodyRef=useRef<HTMLDivElement>(null),positions=useRef<Record<string,number>>(restore.positions || {});
  // 工作区状态机：list 只浏览/筛选；detail 可进入 edit 或 review；create/upload 完成后回 detail。
  // 所有离开可编辑态的迁移收敛到这里，先执行 dirty guard 再写 URL 状态。
  const switchMode=(next:string,id=selectedId,type=selectedType)=>{
    if(dirtyRef.current && !window.confirm("当前有未保存内容，放弃修改并离开？"))return;
    onDirty(false);setSelectedId(id);
    if(bodyRef.current)positions.current[`${mode}:${selectedType}:${selectedId}`]=bodyRef.current.scrollTop;
    const nextParams=new URLSearchParams(params);nextParams.delete("document");
    nextParams.set("mode",next);nextParams.set("assetId",id);nextParams.set("assetType",type);setParams(nextParams);
  };
  useLayoutEffect(()=>{const body=bodyRef.current;if(body)body.scrollTop=positions.current[`${mode}:${selectedType}:${selectedId}`] || 0;
    if(mode==="list" && selectedId)document.querySelector<HTMLButtonElement>(`[data-kbv-record="${CSS.escape(selectedId)}"]`)?.focus({preventScroll:true});
  },[mode,selectedId,selectedType,loading]);
  useEffect(()=>{
    const before=(event:BeforeUnloadEvent)=>{if(dirtyRef.current){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",before);
    return()=>{window.removeEventListener("beforeunload",before);};
  },[]);

  const notify = useCallback((message: string) => {
    setActionError("");
    setReceipt(message);
  }, []);
  const fail = useCallback((cause: unknown, fallback = "操作失败") => {
    setReceipt("");
    setActionError(errorMessage(cause, fallback));
  }, []);

  const rows = data?.rows || [];
  const bases = data?.bases || [];
  const domains = data?.domains || [];

  const pathOf = useCallback((row: KbAssetRow) => [row.family_name, row.domain_name, row.base_name]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" / "), []);

  /** 清掉驾驶舱带来的下钻轴（状态 / 资产类型 / 到期），用户自己的搜索与范围筛选不动。 */
  const clearFilterAxis = useCallback(() => {
    setView("all"); setAssetTypeFilter(""); setExpiring(false);
    const next = new URLSearchParams(params);
    next.delete("view"); next.delete("asset"); next.delete("expiring");
    setParams(next);
  }, [params, setParams]);

  const passes = useCallback((row: KbAssetRow, skip: Skip = {}) => {
    const q = query.trim().toLowerCase();
    const familyId = String(row.family_id || "");
    const domainId = String(row.domain_id || "");
    const baseId = String(row.base_id || "");
    const rowAssetType = row.asset_type === "document" ? "document" : "entry";
    if (assetTypeFilter && rowAssetType !== assetTypeFilter) return false;
    if (expiring && !expirySoon(row.expires_at)) return false;
    if (!skip.view && view !== "all" && String(row.status || "") !== VIEW_STATUS[view]) return false;
    if (!skip.kind && kind && row.kind !== kind) return false;
    if (skip.scope !== "all" && scope.familyId) {
      const hit = scope.familyId === SCOPE_NONE ? !familyId : familyId === scope.familyId;
      if (!hit) return false;
    }
    if (skip.scope !== "all" && skip.scope !== "sub" && scope.domainId) {
      const hit = scope.domainId === SCOPE_NONE ? !domainId : domainId === scope.domainId;
      if (!hit) return false;
    }
    if (!skip.scope && scope.baseId) {
      const hit = scope.baseId === SCOPE_NONE ? !baseId : baseId === scope.baseId;
      if (!hit) return false;
    }
    if (!skip.brand && brands.length) {
      const brand = String(row.brand || "").trim();
      if (brand && brand !== "*" && !brands.includes(brand)) return false;
    }
    if (!skip.stage && stages.length) {
      const rowStages = row.stage_codes || [];
      if (rowStages.length && !rowStages.some((code) => stages.includes(code))) return false;
    }
    if (q) {
      const haystack = [row.title, kindLabel(row.kind), pathOf(row), row.created_by || ""].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }, [query, scope, brands, stages, kind, view, pathOf, assetTypeFilter, expiring]);

  const countWhere = useCallback(
    (skip: Skip, match?: (row: KbAssetRow) => boolean) => rows.reduce(
      (total, row) => total + (passes(row, skip) && (!match || match(row)) ? 1 : 0),
      0,
    ),
    [rows, passes],
  );

  const familyFacet = useMemo<FilterOption[]>(() => {
    const candidates = [
      ...domains.filter((domain) => domain.level === "family").map((domain) => ({ value: domain.id, label: domain.name })),
      { value: SCOPE_NONE, label: "未分类" },
    ];
    const options: FilterOption[] = [{ value: "", label: "全部", count: countWhere({ scope: "all" }) }];
    candidates.forEach((candidate) => {
      const count = countWhere({ scope: "all" }, (row) => {
        const familyId = String(row.family_id || "");
        return candidate.value === SCOPE_NONE ? !familyId : familyId === candidate.value;
      });
      if (count > 0 || scope.familyId === candidate.value) options.push({ ...candidate, count });
    });
    return options;
  }, [domains, countWhere, scope.familyId]);

  const domainFacet = useMemo<FilterOption[]>(() => {
    const candidates = [
      ...domains
        .filter((domain) => domain.level === "domain")
        .filter((domain) => {
          if (!scope.familyId) return true;
          const parent = String(domain.parent_id || "");
          return scope.familyId === SCOPE_NONE ? !parent : parent === scope.familyId;
        })
        .map((domain) => ({ value: domain.id, label: domain.name })),
      { value: SCOPE_NONE, label: "未分类" },
    ];
    const options: FilterOption[] = [{ value: "", label: "全部", count: countWhere({ scope: "sub" }) }];
    candidates.forEach((candidate) => {
      const count = countWhere({ scope: "sub" }, (row) => {
        const domainId = String(row.domain_id || "");
        return candidate.value === SCOPE_NONE ? !domainId : domainId === candidate.value;
      });
      if (count > 0 || scope.domainId === candidate.value) options.push({ ...candidate, count });
    });
    return options;
  }, [domains, countWhere, scope.familyId, scope.domainId]);

  const baseFacet = useMemo<FilterOption[]>(() => {
    const inScope = bases.filter((base) => {
      if (scope.domainId) {
        const domainId = String(base.domain_id || "");
        return scope.domainId === SCOPE_NONE ? !domainId : domainId === scope.domainId;
      }
      if (scope.familyId) {
        const familyId = String(base.family_id || "");
        return scope.familyId === SCOPE_NONE ? !familyId : familyId === scope.familyId;
      }
      return true;
    });
    const candidates = [
      ...inScope.map((base) => ({ value: base.id, label: base.name })),
      { value: SCOPE_NONE, label: "未分类" },
    ];
    const options: FilterOption[] = [{ value: "", label: "全部", count: countWhere({ scope: "base" }) }];
    candidates.forEach((candidate) => {
      const count = countWhere({ scope: "base" }, (row) => {
        const baseId = String(row.base_id || "");
        return candidate.value === SCOPE_NONE ? !baseId : baseId === candidate.value;
      });
      if (count > 0 || scope.baseId === candidate.value) options.push({ ...candidate, count });
    });
    return options;
  }, [bases, countWhere, scope.domainId, scope.familyId, scope.baseId]);

  const brandCodes = useMemo(() => {
    const values = new Set(rows.map((row) => String(row.brand || "").trim()).filter(Boolean));
    return [...values].sort((a, b) => {
      if (a === "*") return 1;
      if (b === "*") return -1;
      return brandLabel(a).localeCompare(brandLabel(b), "zh-CN");
    });
  }, [rows]);

  const brandFacet = useMemo<FilterOption[]>(() => {
    const options: FilterOption[] = [{ value: "", label: "全部", count: countWhere({ brand: true }) }];
    brandCodes.forEach((value) => {
      const count = countWhere({ brand: true }, (row) => {
        const rowBrand = String(row.brand || "").trim();
        return value === "*" ? !rowBrand || rowBrand === "*" : !rowBrand || rowBrand === "*" || rowBrand === value;
      });
      if (count > 0 || brands.includes(value)) options.push({ value, label: brandLabel(value) || value, count });
    });
    return options;
  }, [brandCodes, countWhere, brands]);

  const stageFacet = useMemo<FilterOption[]>(() => {
    const options: FilterOption[] = [{ value: "", label: "全部", count: countWhere({ stage: true }) }];
    MAIN_STAGE_TABS.forEach((stage) => {
      const count = countWhere({ stage: true }, (row) => {
        const rowStages = row.stage_codes || [];
        return !rowStages.length || rowStages.includes(stage.code);
      });
      if (count > 0 || stages.includes(stage.code)) options.push({ value: stage.code, label: stageLabel(stage.code) || stage.code, count });
    });
    return options;
  }, [countWhere, stages]);

  const kindFacet = useMemo<FilterOption[]>(() => {
    const options: FilterOption[] = [{ value: "", label: "全部", count: countWhere({ kind: true }) }];
    KIND_OPTIONS.forEach((option) => {
      const count = countWhere({ kind: true }, (row) => row.kind === option.value);
      if (count > 0 || kind === option.value) options.push({ ...option, count });
    });
    return options;
  }, [countWhere, kind]);

  const viewFacet = useMemo<FilterOption[]>(() => VIEW_OPTIONS.map((option) => {
    const count = option.value === "all"
      ? countWhere({ view: true })
      : countWhere({ view: true }, (row) => String(row.status || "") === VIEW_STATUS[option.value as Exclude<KbView, "all">]);
    return { value: option.value, label: option.label, count };
  }).filter((option) => option.count > 0 || option.value === "all" || view === option.value), [countWhere, view]);

  const filtered = useMemo(() => rows.filter((row) => passes(row)), [rows, passes]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );
  const selectedRow=rows.find(row=>row.id===selectedId && (row.asset_type==="document" ? "document":"entry")===selectedType) || null;
  const lastFilters=useRef(JSON.stringify({query,kind,view,scope,brands,stages,assetTypeFilter,expiring}));
  useEffect(()=>{const current=JSON.stringify({query,kind,view,scope,brands,stages,assetTypeFilter,expiring});if(lastFilters.current!==current){setPage(1);lastFilters.current=current;}},[query,kind,view,scope,brands,stages,assetTypeFilter,expiring]);
  useEffect(()=>{if(page!==currentPage)setPage(currentPage);},[page,currentPage]);
  useEffect(()=>{sessionStorage.setItem(contextKey,JSON.stringify({query,scope,brands,stages,kind,view,page,selectedId,selectedType,positions:positions.current}));},[contextKey,query,scope,brands,stages,kind,view,page,selectedId,selectedType,mode]);
  const revealCreated=(id:string,type="entry")=>{onDirty(false);switchMode("detail",id,type);reload();};

  const toggleBrand = useCallback((value: string) => {
    setBrands((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }, []);
  const toggleStage = useCallback((value: string) => {
    setStages((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }, []);
  const clearBrands = useCallback(() => setBrands([]), []);
  const clearStages = useCallback(() => setStages([]), []);

  return (
    <section className="kbv kbv-filter-browser" data-admin-knowledge data-admin-kb-v2="home">
      {receipt ? <p className="admin-receipt status-ok" data-admin-receipt role="status">{receipt}</p> : null}
      {actionError ? <p className="error" role="alert">{actionError}</p> : null}
      {error && !actionError ? <p className="error" role="alert">{errorMessage(error)} <button className="kbv-text-action" disabled={loading} onClick={reload}>重新加载</button></p> : null}

      <div className="kbv-workspace">
        <KnowledgeFilters
          query={query}
          onQuery={setQuery}
          scope={scope}
          onFamily={(id) => setScope({ familyId: id, domainId: "", baseId: "" })}
          onDomain={(id) => setScope((current) => ({ ...current, domainId: id, baseId: "" }))}
          onBase={(id) => setScope((current) => ({ ...current, baseId: id }))}
          familyOptions={familyFacet}
          domainOptions={domainFacet}
          baseOptions={baseFacet}
          brandOptions={brandFacet}
          selectedBrands={brands}
          onToggleBrand={toggleBrand}
          onClearBrands={clearBrands}
          stageOptions={stageFacet}
          selectedStages={stages}
          onToggleStage={toggleStage}
          onClearStages={clearStages}
          kindOptions={kindFacet}
          kind={kind}
          onKind={setKind}
          viewOptions={viewFacet}
          view={view}
          onView={setView}
          onUpload={() => switchMode("upload")}
          onCreate={() => switchMode("create")}
        />

        <WorkspaceActionContext.Provider value={actionTarget}>
        <section className="kbv-browser kbw-workarea" aria-label="知识工作区" data-workspace-mode={mode} aria-busy={loading}>
          {mode!=="list" && <header className="kbw-task-head"><button className="kbv-text-action" onClick={()=>switchMode(mode==="review"?"detail":"list")}>{mode==="review"?"← 返回当前知识":"← 返回列表"}</button><span>{({detail:"知识详情",edit:"修订知识",review:"发起审批",create:"新建知识",upload:"上传文件"} as Record<string,string>)[mode]}</span>{dirty && <span>未保存</span>}</header>}
          <div className="kbw-body" ref={bodyRef} onScroll={()=>{if(bodyRef.current)positions.current[`${mode}:${selectedType}:${selectedId}`]=bodyRef.current.scrollTop;}}>
          {mode==="list" ? <ReviewView rows={rows} /> : null}
          {mode==="list" && (view !== "all" || assetTypeFilter || expiring) ? (
            <p className="kbv-filter-note" data-kbv-filter-note role="status">
              {/* 下钻筛选轴回显：条件与列表同源，可一键清除（DESIGN §9.2）。 */}
              <span>
                当前查看：
                {[
                  view !== "all" ? VIEW_OPTIONS.find((option) => option.value === view)?.label : "",
                  assetTypeFilter === "document" ? "非结构化资料" : assetTypeFilter === "entry" ? "知识条目" : "",
                  expiring ? "30 天内到期与已过期" : "",
                ].filter(Boolean).join(" · ")}
                （{filtered.length} 条）
              </span>
              <button type="button" className="kbv-text-action" data-kbv-filter-note-clear onClick={clearFilterAxis}>清除这部分筛选</button>
            </p>
          ) : null}
          {error ? <p role="alert">知识服务暂不可用，请重新加载。</p> : mode==="list" ? <>
            <LibraryPane
              rows={pageRows} totalCount={filtered.length} page={currentPage} pageCount={pageCount} selectedId={selectedId}
              onSelect={id=>{const row=pageRows.find(r=>r.id===id);switchMode("detail",id,row?.asset_type==="document"?"document":"entry");}}
              onPrevious={()=>setPage(p=>Math.max(1,p-1))} onNext={()=>setPage(p=>Math.min(pageCount,p+1))} loading={loading}
            />
          </> : mode==="create" ? <EntryEditor bases={bases} onDirty={onDirty} onCancel={()=>switchMode("list")} onSaved={row=>{notify("草稿已保存");revealCreated(row.id);}} />
          : mode==="upload" ? <UploadDialog inline open onProgress={reload} bases={bases} onDirty={onDirty} onClose={()=>switchMode("list")} onCreated={id=>{notify("PDF 已上传并开始解析；完成后请提交发布审批");revealCreated(id,"document");}} />
          : selectedId ? selectedType==="document" ? <DocumentRail key={selectedId} id={selectedId} path={selectedRow ? pathOf(selectedRow):""} mode={mode} onMode={next=>switchMode(next)} onRevision={id=>{revealCreated(id,"document");}} onDirty={onDirty} notify={notify} fail={fail} reload={reload} />
          : <WorkspaceEntry key={selectedId} id={selectedId} bases={bases} mode={mode} onMode={next=>switchMode(next)} onDirty={onDirty} onSaved={reload} notify={notify} />
          : <p className="kbv-empty">知识不存在，请返回列表。</p>}
          </div>
          {/* 动作条：本视口唯一的实底 L1 由内部组件按当前状态指定，其余动作用 L3 文字按钮。 */}
          {mode!=="list" && <footer className="kbw-action-bar" aria-label="当前阶段动作" ref={setActionTarget} />}
        </section>
        </WorkspaceActionContext.Provider>
      </div>

    </section>
  );
}
