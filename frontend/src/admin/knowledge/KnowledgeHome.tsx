import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { brandLabel, kindLabel } from "../../knowledgeCopy";
import { MAIN_STAGE_TABS } from "../../kolStages";
import type { ScopeOption } from "../../components/ScopeTabs";
import { KNOWLEDGE_KIND_SPECS, errorMessage, useKbData, type KbAssetRow } from "./shared";
import DetailRail from "./DetailRail";
import KnowledgeFilters, { type FacetOption } from "./KnowledgeFilters";
import LibraryPane, { type KbView } from "./LibraryPane";
import UploadDialog from "./UploadDialog";

const PAGE_SIZE = 5;
const VIEW_STATUS: Record<Exclude<KbView, "all">, string> = {
  pending: "pending_review",
  published: "published",
  draft: "draft",
  disabled: "archived",
};
const KIND_OPTIONS = KNOWLEDGE_KIND_SPECS.map((spec) => ({ value: spec.code, label: kindLabel(spec.code) }));
type KbScope = { familyId: string; domainId: string; baseId: string };
const EMPTY_SCOPE: KbScope = { familyId: "", domainId: "", baseId: "" };

/**
 * 知识管理主页：中栏只承担筛选，右栏只承担浏览与查看。
 * 筛选同组多选为任一匹配，跨筛选区为同时满足；所有计数基于当前可见数据。
 */
export default function KnowledgeHome() {
  const nav = useNavigate();
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
  const [hiddenBrands, setHiddenBrands] = useState<string[]>([]);
  const [hiddenStages, setHiddenStages] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

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
  const basesById = useMemo(() => new Map(bases.map((base) => [base.id, base])), [bases]);
  const domainsById = useMemo(() => new Map(domains.map((domain) => [domain.id, domain])), [domains]);

  const pathOf = useCallback((row: KbAssetRow) => {
    const base = row.base_id ? basesById.get(row.base_id) : undefined;
    const domain = base ? domainsById.get(base.domain_id) : undefined;
    const family = domain?.parent_id ? domainsById.get(String(domain.parent_id)) : undefined;
    return [family?.name, domain?.name, base?.name].filter(Boolean).join(" / ");
  }, [basesById, domainsById]);

  const baseCounts = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      if (row.base_id) counts.set(row.base_id, (counts.get(row.base_id) || 0) + 1);
    });
    return counts;
  }, [rows]);
  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    bases.forEach((base) => {
      const count = baseCounts.get(base.id) || 0;
      if (count) counts.set(base.domain_id, (counts.get(base.domain_id) || 0) + count);
    });
    return counts;
  }, [bases, baseCounts]);

  const familyOptions = useMemo<ScopeOption[]>(() => domains
    .filter((domain) => domain.level === "family")
    .map((family) => ({
      id: family.id,
      name: family.name,
      count: domains
        .filter((domain) => domain.level === "domain" && String(domain.parent_id || "") === family.id)
        .reduce((sum, domain) => sum + (domainCounts.get(domain.id) || 0), 0),
    }))
    .filter((option) => (option.count || 0) > 0), [domains, domainCounts]);

  const availableDomainIds = useMemo(() => new Set(
    domains
      .filter((domain) => domain.level === "domain" && (!scope.familyId || String(domain.parent_id || "") === scope.familyId))
      .map((domain) => domain.id),
  ), [domains, scope.familyId]);
  const domainOptions = useMemo<ScopeOption[]>(() => domains
    .filter((domain) => domain.level === "domain" && availableDomainIds.has(domain.id))
    .map((domain) => ({ id: domain.id, name: domain.name, count: domainCounts.get(domain.id) || 0 }))
    .filter((option) => (option.count || 0) > 0), [domains, availableDomainIds, domainCounts]);
  const baseOptions = useMemo<ScopeOption[]>(() => bases
    .filter((base) => (scope.domainId ? base.domain_id === scope.domainId : availableDomainIds.has(base.domain_id)))
    .map((base) => ({ id: base.id, name: base.name, count: baseCounts.get(base.id) || 0 }))
    .filter((option) => (option.count || 0) > 0), [bases, scope.domainId, availableDomainIds, baseCounts]);

  const matches = useCallback((row: KbAssetRow, includeBrand = true, includeStage = true) => {
    const q = query.trim().toLowerCase();
    const base = row.base_id ? basesById.get(row.base_id) : undefined;
    const domain = base ? domainsById.get(base.domain_id) : undefined;
    if (view !== "all" && String(row.status || "") !== VIEW_STATUS[view]) return false;
    if (kind && row.kind !== kind) return false;
    if (scope.baseId && row.base_id !== scope.baseId) return false;
    if (scope.domainId && (!base || String(base.domain_id) !== scope.domainId)) return false;
    if (scope.familyId && (!domain || String(domain.parent_id || "") !== scope.familyId)) return false;
    if (includeBrand && brands.length) {
      const brand = String(row.brand || "").trim();
      if (brand && brand !== "*" && !brands.includes(brand)) return false;
    }
    if (includeStage && stages.length) {
      const rowStages = row.stage_codes || [];
      if (rowStages.length && !rowStages.some((code) => stages.includes(code))) return false;
    }
    if (q) {
      const haystack = [row.title, kindLabel(row.kind), pathOf(row), row.created_by || ""].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }, [query, scope, brands, stages, kind, view, basesById, domainsById, pathOf]);

  const filtered = useMemo(() => rows.filter((row) => matches(row)), [rows, matches]);

  const brandCodes = useMemo(() => {
    const values = new Set(rows.map((row) => String(row.brand || "").trim()).filter(Boolean));
    return [...values].sort((a, b) => {
      if (a === "*") return 1;
      if (b === "*") return -1;
      return brandLabel(a).localeCompare(brandLabel(b), "zh-CN");
    });
  }, [rows]);
  const brandOptions = useMemo<FacetOption[]>(() => brandCodes.map((value) => ({
    value,
    count: rows.filter((row) => {
      if (!matches(row, false, true)) return false;
      const rowBrand = String(row.brand || "").trim();
      return value === "*" ? !rowBrand || rowBrand === "*" : !rowBrand || rowBrand === "*" || rowBrand === value;
    }).length,
  })), [brandCodes, rows, matches]);
  const brandAllCount = useMemo(
    () => rows.filter((row) => matches(row, false, true)).length,
    [rows, matches],
  );

  const stageOptions = useMemo<FacetOption[]>(() => MAIN_STAGE_TABS.map((stage) => ({
    value: stage.code,
    count: rows.filter((row) => {
      if (!matches(row, true, false)) return false;
      const rowStages = row.stage_codes || [];
      return !rowStages.length || rowStages.includes(stage.code);
    }).length,
  })), [rows, matches]);

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
  const removeBrand = useCallback((value: string) => {
    setHiddenBrands((current) => current.includes(value) ? current : [...current, value]);
  }, []);
  const restoreBrand = useCallback((value: string) => {
    setHiddenBrands((current) => current.filter((item) => item !== value));
  }, []);
  const toggleStage = useCallback((value: string) => {
    setStages((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }, []);
  const removeStage = useCallback((value: string) => {
    setHiddenStages((current) => current.includes(value) ? current : [...current, value]);
  }, []);
  const restoreStage = useCallback((value: string) => {
    setHiddenStages((current) => current.filter((item) => item !== value));
  }, []);

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
          familyOptions={familyOptions}
          domainOptions={domainOptions}
          baseOptions={baseOptions}
          brandOptions={brandOptions}
          brandAllCount={brandAllCount}
          hiddenBrands={hiddenBrands}
          selectedBrands={brands}
          onToggleBrand={toggleBrand}
          onRemoveBrand={removeBrand}
          onRestoreBrand={restoreBrand}
          stageOptions={stageOptions}
          hiddenStages={hiddenStages}
          selectedStages={stages}
          onToggleStage={toggleStage}
          onRemoveStage={removeStage}
          onRestoreStage={restoreStage}
          kind={kind}
          kinds={KIND_OPTIONS}
          onKind={setKind}
          view={view}
          onView={setView}
          onUpload={() => setUploadOpen(true)}
          onCreate={() => nav("/admin/knowledge/catalog")}
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
                baseKind={selectedRow.base_id ? basesById.get(selectedRow.base_id)?.kind : undefined}
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
    </section>
  );
}
