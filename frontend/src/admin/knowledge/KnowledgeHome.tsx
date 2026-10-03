import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { brandLabel, kindLabel } from "../../knowledgeCopy";
import { MAIN_STAGE_TABS } from "../../kolStages";
import { stageLabel } from "../../labels";
import { KNOWLEDGE_KIND_SPECS, errorMessage, useKbData, type KbAssetRow } from "./shared";
import CreateKnowledgeDialog from "./CreateKnowledgeDialog";
import DetailRail from "./DetailRail";
import KnowledgeFilters, { type FilterOption } from "./KnowledgeFilters";
import LibraryPane, { type KbView } from "./LibraryPane";
import UploadDialog from "./UploadDialog";

const PAGE_SIZE = 5;
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

/** 计数跳过哪些筛选组：计数口径＝点选该 chip 后的实际结果数（DESIGN §8 数字同源）。 */
type Skip = { view?: boolean; kind?: boolean; brand?: boolean; stage?: boolean; scope?: "all" | "sub" | "base" };

/**
 * 知识管理主页：中栏只承担筛选，右栏只承担浏览与查看。
 * 筛选同组多选为任一匹配，跨筛选区为同时满足；所有计数基于当前可见数据。
 */
export default function KnowledgeHome() {
  const load = useCallback(async () => {
    const [rows, bases, domains] = await Promise.all([
      api.adminKnowledge(),
      api.adminKnowledgeBases(),
      api.adminKnowledgeDomains(),
    ]);
    return {
      rows: rows as KbAssetRow[],
      bases: bases.bases || [],
      domains: domains.domains || [],
    };
  }, []);
  const { data, error, loading, reload } = useKbData(load);

  const [receipt, setReceipt] = useState("");
  const [actionError, setActionError] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<KbScope>(EMPTY_SCOPE);
  const [brands, setBrands] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [kind, setKind] = useState("");
  const [view, setView] = useState<KbView>("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

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

  const passes = useCallback((row: KbAssetRow, skip: Skip = {}) => {
    const q = query.trim().toLowerCase();
    const familyId = String(row.family_id || "");
    const domainId = String(row.domain_id || "");
    const baseId = String(row.base_id || "");
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
  }, [query, scope, brands, stages, kind, view, pathOf]);

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
  const selectedRow = useMemo(
    () => pageRows.find((row) => row.id === selectedId) || pageRows[0] || null,
    [pageRows, selectedId],
  );

  useEffect(() => {
    setPage(1);
  }, [query, kind, view, scope.familyId, scope.domainId, scope.baseId, brands, stages]);
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);
  useEffect(() => {
    const first = pageRows[0]?.id || "";
    if (first && !pageRows.some((row) => row.id === selectedId)) setSelectedId(first);
    if (!first && selectedId) setSelectedId("");
  }, [pageRows, selectedId]);

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
      {error && !actionError ? <p className="error" role="alert">{errorMessage(error)}</p> : null}

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
          onUpload={() => setUploadOpen(true)}
          onCreate={() => setCreateOpen(true)}
        />

        <section className="kbv-browser" aria-label="浏览知识">
          <LibraryPane
            rows={pageRows}
            totalCount={filtered.length}
            page={currentPage}
            pageCount={pageCount}
            selectedId={selectedRow?.id || ""}
            onSelect={setSelectedId}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pageCount, current + 1))}
            loading={loading}
          />
          <aside className="kbv-admin-detail" aria-label="知识详情" data-kbv-detail>
            {selectedRow ? (
              <DetailRail
                key={selectedRow.id}
                row={selectedRow}
                path={pathOf(selectedRow)}
                baseKind={selectedRow.base_id ? bases.find((item) => item.id === selectedRow.base_id)?.kind : undefined}
                notify={notify}
                fail={fail}
                reload={reload}
              />
            ) : (
              <p className="kbv-empty">从上方列表选择一条知识，查看详情。</p>
            )}
          </aside>
        </section>
      </div>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} bases={bases} />
      <CreateKnowledgeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        bases={bases}
        onCreated={(id, title) => {
          notify(`已创建草稿「${title}」`);
          reload();
          setSelectedId(id);
        }}
      />
    </section>
  );
}
