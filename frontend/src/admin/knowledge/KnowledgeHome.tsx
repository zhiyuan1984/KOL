import { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect, lazy, Suspense } from "react";
import { brandLabel, kindLabel, KB_SCOPE_FAMILY, KB_SCOPE_DOMAIN, KB_SCOPE_BASE } from "../../knowledgeCopy";
import { MAIN_STAGE_TABS } from "../../kolStages";
import { stageLabel } from "../../labels";
import { KNOWLEDGE_KIND_SPECS, errorMessage, useKbData, type KbAssetRow, type WsData } from "./shared";
import EntryEditor from "./EntryEditor";
import WorkspaceEntry from "./WorkspaceEntry";
import { WorkspaceActionContext } from "./WorkspaceActions";
import { reviewApi,reviewCompany,workspaceBatch } from "../../reviews/api";
import { useAccount } from "../../components/AuthGate";
import type { FilterOption } from "./KnowledgeFilters";
import KnowledgeBrowseFilters from "./KnowledgeBrowseFilters";
import { KnowledgeBrowseWorkspace } from "../../components/KnowledgeBrowse";
// Keep the mature planning component out of unrelated admin views.
const CatalogView = lazy(() => import("./CatalogView"));
import BaseView from "./BaseView";
import IngestView from "./IngestView";
import BindingsView from "./BindingsView";
import { KnowledgeAssetsPanel, KnowledgeGraphPanel } from "./KnowledgeGovernancePanels";
import "../../knowledge-browse.css";
import "./knowledge-governance.css";
import "./knowledge-assets-visible.css";
import LibraryPane, { type KbView } from "./LibraryPane";
import AssetStatStrip from "./AssetStatStrip";
import UploadDialog from "./UploadDialog";
import DocumentRail from "./DocumentRail";
import ReviewView from "./ReviewView";
import KnowledgeLifecycleTabs, { KNOWLEDGE_TABS, KNOWLEDGE_NAV_TABS, knowledgeStage, type KnowledgeStage } from "./KnowledgeLifecycleTabs";
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
  { value: "draft", label: "草稿" },
  { value: "pending", label: "待审批" },
  { value: "published", label: "已发布" },
  { value: "disabled", label: "已下架" },
];
const KIND_OPTIONS = [
  { value: "document", label: "文档资料" },
  ...KNOWLEDGE_KIND_SPECS.map((spec) => ({ value: spec.code, label: kindLabel(spec.code) })),
];
const SCOPE_NONE = "__none__";
type KbScope = { familyId: string; domainId: string; baseId: string };
const EMPTY_SCOPE: KbScope = { familyId: "", domainId: "", baseId: "" };
/** 驾驶舱下钻的 URL 轴：状态、资产类型、到期。只认合法值，其余忽略。 */
const viewParam = (value: string | null): KbView | null =>
  VIEW_OPTIONS.some((option) => option.value === value) ? (value as KbView) : null;
const assetParam = (value: string | null): "" | "entry" | "document" =>
  value === "entry" || value === "document" ? value : "";

  /** 筛选 chips 计数全部来自服务端 facet（skip 口径见后端 buildUnion），前端只做展示映射。 */

/**
 * 知识管理主页：中栏为已确认新基准的标题/类型知识行与可增删阶段项，右栏为一级治理 Tab 与详情。
 * 筛选同组多选为任一匹配，跨筛选区为同时满足；所有计数基于当前可见数据。
 */
export default function KnowledgeHome({ initialStage = "published", routeBaseId, routeEntryId }: {
  initialStage?: KnowledgeStage; routeBaseId?: string; routeEntryId?: string;
}) {
  const [params,setParams]=useSearchParams();
  const requestedDocument=params.get("document");
  const stage = knowledgeStage(params.get("stage") || initialStage);
  const {account}=useAccount();
  const contextKey=`knowledge.workspace:${account?.id || "current"}:${reviewCompany()}`;
  const restore=useMemo(()=>{try{return JSON.parse(sessionStorage.getItem(contextKey)||"{}");}catch{return {};}},[contextKey]);
  const [query, setQuery] = useState<string>(restore.query || "");
  const [debouncedQuery, setDebouncedQuery] = useState<string>(restore.query || "");
  useEffect(()=>{const t=setTimeout(()=>setDebouncedQuery(query),300);return ()=>clearTimeout(t);},[query]);
  const [receipt, setReceipt] = useState("");
  const receiptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (receiptTimer.current) clearTimeout(receiptTimer.current); }, []);
  const [actionError, setActionError] = useState("");
  const [scope, setScope] = useState<KbScope>(restore.scope || EMPTY_SCOPE);
  const [brands, setBrands] = useState<string[]>(restore.brands || []);
  const [stages, setStages] = useState<string[]>(restore.stages || []);
  const [kind, setKind] = useState<string>(restore.kind || "");
  const [view, setView] = useState<KbView>(viewParam(params.get("view")) || restore.view || "all");
  const [assetTypeFilter, setAssetTypeFilter] = useState<"" | "entry" | "document">(assetParam(params.get("asset")));
  /** `?expiring=1`：驾驶舱「30 天内到期」的下钻筛选轴（与卡片计数同一口径）。 */
  const [expiring, setExpiring] = useState<boolean>(params.get("expiring") === "1");
  const [page, setPage] = useState<number>(restore.page || 1);
  const [selectedId, setSelectedId] = useState<string>(params.get("assetId") || requestedDocument || routeEntryId || restore.selectedId || "");
  const mode=params.get("mode") || (requestedDocument || routeEntryId ? "detail":"list");
  const selectedType=params.get("assetType") || (requestedDocument ? "document":routeEntryId ? "entry":restore.selectedType || "entry");
  useEffect(()=>{const id=params.get("assetId") || params.get("document") || routeEntryId;if(id)setSelectedId(id);},[params,routeEntryId]);
  // 下钻轴以 URL 为准：链接可复制、可后退，回来时筛选条件不丢。
  useEffect(()=>{const next=viewParam(params.get("view"));if(next)setView(next);},[params]);
  useEffect(()=>{setAssetTypeFilter(assetParam(params.get("asset")));},[params]);
  useEffect(()=>{setExpiring(params.get("expiring")==="1");},[params]);
  const notify = useCallback((message: string) => {
    setActionError("");
    if (receiptTimer.current) clearTimeout(receiptTimer.current);
    setReceipt(message);
    if (stage === "catalog") receiptTimer.current = setTimeout(() => setReceipt(""), 3000);
  }, [stage]);
  const fail = useCallback((cause: unknown, fallback = "操作失败") => {
    if (receiptTimer.current) clearTimeout(receiptTimer.current);
    setReceipt("");
    setActionError(errorMessage(cause, fallback));
  }, []);

  /** 服务端过滤＋分页：筛选/搜索/页码变化即重新请求（搜索框 300ms 防抖）。 */
  const queryKey = useMemo(()=>{
    const p=new URLSearchParams();
    p.set("page",String(page));p.set("page_size",String(PAGE_SIZE));
    const q=debouncedQuery.trim();if(q)p.set("q",q);
    if(view!=="all")p.set("view",view);
    if(kind)p.set("kind",kind);
    if(brands.length)p.set("brands",brands.join(","));
    if(stages.length)p.set("stages",stages.join(","));
    if(scope.familyId)p.set("family_id",scope.familyId);
    if(scope.domainId)p.set("domain_id",scope.domainId);
    if(scope.baseId)p.set("base_id",scope.baseId);
    if(assetTypeFilter)p.set("asset",assetTypeFilter);
    if(expiring)p.set("expiring","1");
    return p.toString();
  },[page,debouncedQuery,view,kind,brands,stages,scope,assetTypeFilter,expiring]);
  const load = useCallback(
    ()=>reviewApi<WsData>(`/admin/knowledge/workspace-v1?${queryKey}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey,contextKey]);
  const { data, error, loading, reload: reloadList } = useKbData(load, [queryKey]);
  // 全局资产统计与筛选列表共用服务端投影；不把当前页 rows 当全局数据。
  const loadSummary = useCallback(() => reviewApi<WsData>("/admin/knowledge/workspace-v1?page_size=1"), [contextKey]);
  const { data: summary, error: summaryError, loading: summaryLoading, reload: reloadSummary } = useKbData(loadSummary);
  const reload = useCallback(() => { reloadList(); reloadSummary(); }, [reloadList, reloadSummary]);

  const rows = data?.rows || [];
  const total = data?.total ?? 0;
  const pageCount = data?.page_count || 1;
  const bases = data?.bases || [];
  const domains = data?.domains || [];
  const facets = data?.facets;
  /** facet 计数读取：服务端已按 skip 口径算好，前端只做展示映射。 */
  const fAll = (group: string) => facets?.[group]?.all ?? 0;
  const fVal = (group: string, key: string) => facets?.[group]?.values?.[key] ?? 0;
  // 服务端会钳制越界页码：把本地 page 同步为服务端实际页。
  useEffect(()=>{if(data && data.page!==page)setPage(data.page);},[data]); // eslint-disable-line react-hooks/exhaustive-deps
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
    nextParams.set("mode",next);nextParams.set("assetId",id);nextParams.set("assetType",type);
    if(next === "create" || next === "upload") nextParams.set("stage", "create");
    else if(next === "detail" || next === "edit") nextParams.set("stage", "published");
    else if(next === "review") nextParams.set("stage", "pending-review");
    setParams(nextParams);
  };
  useLayoutEffect(()=>{const body=bodyRef.current;if(body)body.scrollTop=positions.current[`${mode}:${selectedType}:${selectedId}`] || 0;
    if(mode==="list" && selectedId)document.querySelector<HTMLButtonElement>(`[data-kbv-record="${CSS.escape(selectedId)}"]`)?.focus({preventScroll:true});
  },[mode,selectedId,selectedType,loading]);
  useEffect(()=>{
    const before=(event:BeforeUnloadEvent)=>{if(dirtyRef.current){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",before);
    return()=>{window.removeEventListener("beforeunload",before);};
  },[]);

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

  /** 空态恢复动作（§9.3）：清掉全部筛选条件，含 URL 上的下钻轴。 */
  const resetAllFilters = useCallback(() => {
    if (dirtyRef.current && !window.confirm("当前有未保存内容，放弃修改并清除筛选？")) return;
    onDirty(false);
    setQuery(""); setScope(EMPTY_SCOPE); setBrands([]); setStages([]); setKind("");
    setView("all"); setAssetTypeFilter(""); setExpiring(false); setPage(1);
    const next = new URLSearchParams(params);
    ["view", "asset", "expiring", "mode", "assetId", "assetType", "document"].forEach((key) => next.delete(key));
    setParams(next);
  }, [params, setParams, onDirty]);

  // The __none__ facet means a missing foreign key. Named “未分类” catalog nodes
  // are real records, so keep their IDs/names and label only the missing relation explicitly.
  const familyFacet = useMemo<FilterOption[]>(() => {
    const candidates = [
      ...domains.filter((domain) => domain.level === "family").map((domain) => ({ value: domain.id, label: domain.name })),
      { value: SCOPE_NONE, label: `未归属${KB_SCOPE_FAMILY}` },
    ];
    const options: FilterOption[] = [{ value: "", label: "全部", count: fAll("family") }];
    candidates.forEach((candidate) => {
      const count = fVal("family", candidate.value);
      options.push({ ...candidate, count });
    });
    return options;
  }, [domains, facets, scope.familyId]);

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
      { value: SCOPE_NONE, label: `未归属${KB_SCOPE_DOMAIN}` },
    ];
    const options: FilterOption[] = [{ value: "", label: "全部", count: fAll("domain") }];
    candidates.forEach((candidate) => {
      const count = fVal("domain", candidate.value);
      options.push({ ...candidate, count });
    });
    return options;
  }, [domains, facets, scope.familyId, scope.domainId]);

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
      { value: SCOPE_NONE, label: `未归属${KB_SCOPE_BASE}` },
    ];
    const options: FilterOption[] = [{ value: "", label: "全部", count: fAll("base") }];
    candidates.forEach((candidate) => {
      const count = fVal("base", candidate.value);
      options.push({ ...candidate, count });
    });
    return options;
  }, [bases, facets, scope.domainId, scope.familyId, scope.baseId]);

  const brandCodes = useMemo(() => {
    const values = Object.keys(facets?.brand?.values || {});
    return values.sort((a, b) => {
      if (a === "*") return 1;
      if (b === "*") return -1;
      return brandLabel(a).localeCompare(brandLabel(b), "zh-CN");
    });
  }, [facets]);

  const brandFacet = useMemo<FilterOption[]>(() => {
    // 未设品牌的行计入每个品牌 chip（与旧客户端口径一致）。
    const unbranded = facets?.brand?.unbranded || 0;
    const options: FilterOption[] = [{ value: "", label: "全部", count: fAll("brand") }];
    brandCodes.forEach((value) => {
      const count = fVal("brand", value) + unbranded;
      if (count > 0 || brands.includes(value)) options.push({ value, label: brandLabel(value) || value, count });
    });
    return options;
  }, [brandCodes, facets, brands]);

  const stageFacet = useMemo<FilterOption[]>(() => {
    // 无阶段的行计入每个阶段 chip（与旧客户端口径一致）。
    const empty = facets?.stage?.empty || 0;
    const options: FilterOption[] = [{ value: "", label: "全部", count: fAll("stage") }];
    MAIN_STAGE_TABS.forEach((stage) => {
      const count = fVal("stage", stage.code) + empty;
      if (count > 0 || stages.includes(stage.code)) options.push({ value: stage.code, label: stageLabel(stage.code) || stage.code, count });
    });
    return options;
  }, [facets, stages]);

  const kindFacet = useMemo<FilterOption[]>(() => {
    const options: FilterOption[] = [{ value: "", label: "全部", count: fAll("kind") }];
    KIND_OPTIONS.forEach((option) => {
      const count = fVal("kind", option.value);
      if (count > 0 || kind === option.value) options.push({ ...option, count });
    });
    return options;
  }, [facets, kind]);

  const viewFacet = useMemo<FilterOption[]>(() => VIEW_OPTIONS.map((option) => {
    const count = option.value === "all"
      ? fAll("view")
      : fVal("view", VIEW_STATUS[option.value as Exclude<KbView, "all">]);
    return { value: option.value, label: option.label, count };
  }), [facets, view]);

  const selectedRow=rows.find(row=>row.id===selectedId && (row.asset_type==="document" ? "document":"entry")===selectedType) || null;
  const lastFilters=useRef(JSON.stringify({query,kind,view,scope,brands,stages,assetTypeFilter,expiring}));
  useEffect(()=>{const current=JSON.stringify({query,kind,view,scope,brands,stages,assetTypeFilter,expiring});if(lastFilters.current!==current){setPage(1);lastFilters.current=current;}},[query,kind,view,scope,brands,stages,assetTypeFilter,expiring]);
  // 批量续期 / 归档（C）：勾选行 → 服务端批量接口。
  const [selection,setSelection]=useState<string[]>([]);
  useEffect(()=>{setSelection((current)=>current.filter((id)=>rows.some((row)=>row.id===id)));},[rows]);
  const toggleSelect=useCallback((id:string)=>{
    setSelection((current)=>current.includes(id)?current.filter((x)=>x!==id):[...current,id]);
  },[]);
  const runBatch=useCallback(async (action:"renew"|"archive",expiresAt?:string)=>{
    const items=selection
      .map((id)=>{const row=rows.find((r)=>r.id===id);return row?{id,asset:(row.asset_type==="document"?"document":"entry") as "document"|"entry"}:null;})
      .filter((x):x is {id:string;asset:"document"|"entry"}=>Boolean(x));
    if(!items.length)return;
    try{
      const result=await workspaceBatch(items,action,expiresAt);
      const failed=result.results.filter((r)=>!r.ok);
      if(!failed.length)notify(action==="renew"?`已续期 ${items.length} 条。`:`已归档 ${items.length} 条。`);
      else fail(new Error(failed.map((r)=>`${r.id}：${r.error||"失败"}`).join("；")),"部分操作失败");
      setSelection([]);
      reload();
    }catch(cause){fail(cause);}
  },[selection,rows,notify,fail,reload]);
  useEffect(()=>{sessionStorage.setItem(contextKey,JSON.stringify({query,scope,brands,stages,kind,view,stage,page,selectedId,selectedType,positions:positions.current}));},[contextKey,query,scope,brands,stages,kind,view,stage,page,selectedId,selectedType,mode]);
  const revealCreated=(id:string,type="entry")=>{onDirty(false);switchMode("detail",id,type);reload();};

  const toggleBrand = useCallback((value: string) => {
    setBrands((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }, []);
  const toggleStage = useCallback((value: string) => {
    setStages((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }, []);
  const clearBrands = useCallback(() => setBrands([]), []);
  const changeStage = useCallback((next: KnowledgeStage) => {
    if (dirtyRef.current && !window.confirm("当前有未保存内容，放弃修改并切换入口？")) return;
    onDirty(false);
    const nextParams = new URLSearchParams(params);
    nextParams.set("stage", next);
    nextParams.delete("panel"); nextParams.delete("baseId"); nextParams.delete("document");
    nextParams.set("mode", "list");
    // 只切右栏视图，中栏搜索、分类、页码、选中记录和批量选择保持。
    setParams(nextParams);
  }, [onDirty, params, setParams]);
  const drillView = (next: KbView) => {
    setView(next); setPage(1);
    const url = new URLSearchParams(params); url.set("view", next); setParams(url);
  };
  const drillPendingDocuments = () => {
    setView("pending"); setAssetTypeFilter("document"); setPage(1);
    const url = new URLSearchParams(params); url.set("view", "pending"); url.set("asset", "document"); setParams(url);
  };
  const drillScope = (level: "family" | "domain" | "base", id: string) => {
    if (level === "family") setScope({ familyId: id, domainId: "", baseId: "" });
    else if (level === "domain") setScope({ familyId: "", domainId: id, baseId: "" });
    else setScope({ familyId: "", domainId: "", baseId: id });
    setPage(1);
  };
  const drillExpiring = useCallback(() => {
    setExpiring(true); setPage(1);
    const url = new URLSearchParams(params); url.set("expiring", "1"); setParams(url);
  }, [params, setParams]);
  const clearStages = useCallback(() => setStages([]), []);
  const catalogBaseId = params.get("panel") === "base" ? params.get("baseId") : !params.has("stage") ? routeBaseId : undefined;

  return (
    <section className="kbv kbv-page kbv-filter-browser knowledge-browse knowledge-governance" data-admin-knowledge data-admin-kb-v2="home">
      <KnowledgeBrowseWorkspace detailOpen={mode !== "list" || stage !== "published"}>
        <section className="kbv-list knowledge-governance-list" aria-label="知识列表" data-knowledge-middle aria-busy={loading}>
          <KnowledgeBrowseFilters countsReady={Boolean(data && !loading && !error)} query={query} onQuery={setQuery} scope={scope}
            onReset={resetAllFilters}
            onFamily={id => setScope({ familyId: id, domainId: "", baseId: "" })}
            onDomain={id => setScope(current => ({ ...current, domainId: id, baseId: "" }))}
            onBase={id => setScope(current => ({ ...current, baseId: id }))}
            familyOptions={familyFacet} domainOptions={domainFacet} baseOptions={baseFacet}
            brandOptions={brandFacet} selectedBrands={brands} onToggleBrand={toggleBrand} onClearBrands={clearBrands}
            stageOptions={stageFacet} selectedStages={stages} onToggleStage={toggleStage} onClearStages={clearStages} onStages={setStages}
            kindOptions={kindFacet} kind={kind} onKind={setKind} viewOptions={viewFacet} view={view} onView={drillView} />
          <AssetStatStrip stats={summary?.stats} loading={summaryLoading} error={summaryError} reload={reloadSummary} view={view} onView={drillView} />
          {(view !== "all" || assetTypeFilter || expiring) ? <p className="kbv-filter-note" data-kbv-filter-note role="status">
            <span>当前查看：{[view !== "all" ? VIEW_OPTIONS.find(option => option.value === view)?.label : "",
              assetTypeFilter === "document" ? "非结构化资料" : assetTypeFilter === "entry" ? "知识条目" : "",
              expiring ? "30 天内到期与已过期" : ""].filter(Boolean).join(" · ")}（{loading ? "正在更新" : error ? "计数暂不可用" : `${total} 条`}）</span>
            <button type="button" className="kbv-text-action" data-kbv-filter-note-clear onClick={clearFilterAxis}>{[view !== "all", Boolean(assetTypeFilter), expiring].filter(Boolean).length > 1 ? "清除上述条件" : "清除此条件"}</button>
          </p> : null}
          {error ? <p className="kbv-empty" role="alert">知识列表读取失败：{errorMessage(error)} <button className="kbv-text-action" onClick={reloadList}>重试</button></p>
          : <LibraryPane rows={rows} totalCount={total} page={page} pageCount={pageCount} selectedId={selectedId}
            onSelect={id => { const row=rows.find(r=>r.id===id);switchMode("detail",id,row?.asset_type==="document"?"document":"entry"); }}
            onPrevious={()=>setPage(p=>Math.max(1,p-1))} onNext={()=>setPage(p=>Math.min(pageCount,p+1))} loading={loading}
            onReset={resetAllFilters} selection={selection} onToggleSelect={toggleSelect}
            onBatchRenew={(_ids,date)=>runBatch("renew",date)} onBatchArchive={()=>runBatch("archive")} />}
        </section>
        <WorkspaceActionContext.Provider value={actionTarget}>
        <section className="kbv-rail kbv-browser kbw-workarea" aria-label="知识治理工作区" data-knowledge-right data-workspace-mode={mode} data-kb-active-stage={stage}>
          <KnowledgeLifecycleTabs stage={stage} onChange={changeStage} />
          {receipt ? <p className={`admin-receipt status-ok${stage === "catalog" ? " kbplanning-toast" : ""}`} data-admin-receipt role="status">{receipt}</p> : null}
          {actionError ? <p className="error" role="alert">{actionError}</p> : null}
          {mode!=="list" && <header className="kbw-task-head"><button className="kbv-text-action" onClick={()=>switchMode(mode==="review"?"detail":"list")}>{mode==="review"?"← 返回当前知识":"← 返回列表"}</button><span>{({detail:"知识详情",edit:"修订知识",review:"发起审批",create:"新建知识",upload:"上传文件"} as Record<string,string>)[mode]}</span>{dirty && <span>未保存</span>}</header>}
          {mode==="list" && <button className="kbv-text-action knowledge-governance-back" onClick={()=>switchMode("list")}>查看知识列表</button>}
          <div id={`kb-stage-panel-${stage}`} role="tabpanel"
            aria-labelledby={KNOWLEDGE_NAV_TABS.some(tab => tab.id === stage) ? `kb-stage-tab-${stage}` : undefined}
            aria-label={KNOWLEDGE_NAV_TABS.some(tab => tab.id === stage) ? undefined : KNOWLEDGE_TABS.find(tab => tab.id === stage)?.label}
            tabIndex={0} className="kbw-body" ref={bodyRef}
            onScroll={()=>{if(bodyRef.current)positions.current[`${mode}:${selectedType}:${selectedId}`]=bodyRef.current.scrollTop;}}>
          {mode==="list" ? <>
            {stage === "create" ? <section data-knowledge-creation>
              <div className="knowledge-creation-actions" role="group" aria-label="知识创作操作">
                <button type="button" className="kbv-text-action" data-kbv-upload onClick={()=>switchMode("upload")}>上传文件</button>
                <button type="button" className="kbv-text-action" data-kbv-new onClick={()=>switchMode("create")}>新建知识</button>
                <button type="button" className="kbv-text-action" onClick={()=>drillView("draft")}>查看草稿</button>
              </div>
            </section> : stage === "catalog" ? catalogBaseId
              ? <BaseView id={catalogBaseId} notify={notify} fail={fail} /> : <Suspense fallback={<p className="muted" role="status">正在加载知识规划…</p>}><CatalogView notify={notify} fail={fail} /></Suspense>
            : stage === "processing" ? <IngestView embedded notify={notify} fail={fail} />
            : stage === "bindings" ? <BindingsView notify={notify} fail={fail} />
            : stage === "graph" ? <KnowledgeGraphPanel data={summary} error={summaryError} reload={reloadSummary} />
            : stage === "lifecycle" ? summaryError ? <p role="alert">生命周期统计读取失败：{summaryError} <button className="kbv-text-action" onClick={reloadSummary}>重试</button></p> : summary ? <ReviewView section="lifecycle" stats={summary.stats} /> : <p role="status">正在读取生命周期统计…</p>
            : stage === "pending-review" ? <>
              <h3>发布审批</h3><p className="knowledge-panel-help">从中栏选择当前已保存版本，提交或查看审批；审批通过后等待独立发布，不等同于已发布。</p>
              <button className="kbv-text-action" onClick={()=>drillView("pending")}>筛选中栏待审批资产</button>
              {summaryError ? <p role="alert">审批统计读取失败：{summaryError} <button className="kbv-text-action" onClick={reloadSummary}>重试</button></p> : summary ? <ReviewView section="approval" stats={summary.stats} /> : <p role="status">正在读取审批统计…</p>}
            </> : <>
              <KnowledgeAssetsPanel data={summary} error={summaryError} reload={reloadSummary} onPendingDocuments={drillPendingDocuments} onScope={drillScope} onExpiring={drillExpiring} />
              <p className="kbv-empty">从列表选择一条知识，查看内容与来源。</p>
            </>}
          </> : mode==="create" ? <EntryEditor bases={bases} onDirty={onDirty} onCancel={()=>switchMode("list")} onSaved={row=>{notify("草稿已保存");revealCreated(row.id);}} />
          : mode==="upload" ? <UploadDialog inline open onProgress={reload} bases={bases} onDirty={onDirty} onClose={()=>switchMode("list")} onCreated={id=>{notify("资料已上传；请核对加工结果后提交审批");revealCreated(id,"document");}} />
          : selectedId ? selectedType==="document" ? <DocumentRail key={selectedId} id={selectedId} path={selectedRow ? pathOf(selectedRow):""} mode={mode} onMode={next=>switchMode(next)} onRevision={id=>{revealCreated(id,"document");}} onDirty={onDirty} notify={notify} fail={fail} reload={reload} />
          : <WorkspaceEntry key={selectedId} id={selectedId} bases={bases} mode={mode} onMode={next=>switchMode(next)} onDirty={onDirty} onSaved={reload} notify={notify} />
          : <p className="kbv-empty">知识不存在，请返回列表。</p>}
          </div>
          {mode!=="list" && <footer className="kbw-action-bar" aria-label="当前阶段动作" ref={setActionTarget} />}
        </section>
        </WorkspaceActionContext.Provider>
      </KnowledgeBrowseWorkspace>
    </section>
  );
}
