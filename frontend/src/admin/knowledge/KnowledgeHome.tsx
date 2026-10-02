import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { KB_FILTER_LABEL, kindLabel, sortStageCodes } from "../../knowledgeCopy";
import { stageLabel } from "../../labels";
import ScopeTabs, { type ScopeOption } from "../../components/ScopeTabs";
import FilterChips from "../../components/FilterChips";
import { KNOWLEDGE_KIND_SPECS, errorMessage, useKbData, type KbAssetRow } from "./shared";
import LibraryPane, { type KbView } from "./LibraryPane";
import DetailRail from "./DetailRail";
import UploadDialog from "./UploadDialog";

const VIEW_STATUS: Record<Exclude<KbView, "all">, string> = {
  pending: "pending_review",
  published: "published",
  draft: "draft",
  disabled: "archived",
};

const KIND_OPTIONS = KNOWLEDGE_KIND_SPECS.map((spec) => ({ value: spec.code, label: spec.label }));

type KbScope = { familyId: string; domainId: string; baseId: string };
const EMPTY_SCOPE: KbScope = { familyId: "", domainId: "", baseId: "" };

/** 管理端知识主页（IA v2）：三级分类 tab＋筛选标签＋中栏列表＋右栏详情。 */
export default function KnowledgeHome() {
  const nav = useNavigate();
  const load = useCallback(async () => {
    const [rows, bases, domains, documents] = await Promise.all([
      api.adminKnowledge(),
      api.adminKnowledgeBases(),
      api.adminKnowledgeDomains(),
      api.adminKnowledgeDocuments({ status: "pending_review" }).catch(() => null),
    ]);
    return {
      rows: rows as KbAssetRow[],
      bases: bases.bases || [],
      domains: domains.domains || [],
      pendingDocs: documents?.documents || [],
    };
  }, []);
  const { data, error, loading, reload } = useKbData(load);

  const [receipt, setReceipt] = useState("");
  const [actionError, setActionError] = useState("");
  const [view, setView] = useState<KbView>("all");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [scope, setScope] = useState<KbScope>(EMPTY_SCOPE);
  const [brands, setBrands] = useState<string[]>([]);
  const [stage, setStage] = useState("");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const [selectedId, setSelectedId] = useState("");
  const [expanded, setExpanded] = useState(false);
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
  const pendingDocsCount = data?.pendingDocs.length || 0;

  const basesById = useMemo(() => new Map(bases.map((base) => [base.id, base])), [bases]);
  const domainsById = useMemo(() => new Map(domains.map((domain) => [domain.id, domain])), [domains]);

  const pathOf = useCallback((row: KbAssetRow) => {
    const base = row.base_id ? basesById.get(row.base_id) : undefined;
    const domain = base ? domainsById.get(base.domain_id) : undefined;
    const family = domain?.parent_id ? domainsById.get(String(domain.parent_id)) : undefined;
    return [family?.name, domain?.name, base?.name].filter(Boolean).join(" / ");
  }, [basesById, domainsById]);

  const counts = useMemo(() => {
    const result: Record<KbView, number> = { all: rows.length, pending: 0, published: 0, draft: 0, disabled: 0 };
    for (const row of rows) {
      const status = String(row.status || "");
      if (status === "pending_review") result.pending += 1;
      else if (status === "published") result.published += 1;
      else if (status === "archived") result.disabled += 1;
      else result.draft += 1;
    }
    return result;
  }, [rows]);

  const baseCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.base_id) continue;
      map.set(row.base_id, (map.get(row.base_id) || 0) + 1);
    }
    return map;
  }, [rows]);

  const domainCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const base of bases) {
      const count = baseCounts.get(base.id) || 0;
      if (!count) continue;
      map.set(base.domain_id, (map.get(base.domain_id) || 0) + count);
    }
    return map;
  }, [bases, baseCounts]);

  const familyOptions = useMemo<ScopeOption[]>(
    () => domains
      .filter((domain) => domain.level === "family")
      .map((family) => ({
        id: family.id,
        name: family.name,
        count: domains
          .filter((domain) => domain.level === "domain" && String(domain.parent_id || "") === family.id)
          .reduce((sum, domain) => sum + (domainCounts.get(domain.id) || 0), 0),
      }))
      .filter((option) => option.count > 0),
    [domains, domainCounts],
  );

  const familyDomainIds = useMemo(
    () => new Set(
      domains
        .filter((domain) => domain.level === "domain" && (!scope.familyId || String(domain.parent_id || "") === scope.familyId))
        .map((domain) => domain.id),
    ),
    [domains, scope.familyId],
  );

  const domainOptions = useMemo<ScopeOption[]>(
    () => domains
      .filter((domain) => domain.level === "domain" && familyDomainIds.has(domain.id))
      .map((domain) => ({ id: domain.id, name: domain.name, count: domainCounts.get(domain.id) || 0 }))
      .filter((option) => option.count > 0),
    [domains, domainCounts, familyDomainIds],
  );

  const baseOptions = useMemo<ScopeOption[]>(
    () => bases
      .filter((base) => (scope.domainId ? base.domain_id === scope.domainId : familyDomainIds.has(base.domain_id)))
      .map((base) => ({ id: base.id, name: base.name, count: baseCounts.get(base.id) || 0 }))
      .filter((option) => option.count > 0),
    [bases, baseCounts, scope.domainId, familyDomainIds],
  );

  const familyTotal = rows.length;
  const domainTotal = useMemo(
    () => domainOptions.reduce((sum, option) => sum + (option.count || 0), 0),
    [domainOptions],
  );
  const baseTotal = useMemo(
    () => baseOptions.reduce((sum, option) => sum + (option.count || 0), 0),
    [baseOptions],
  );

  const brandOptions = useMemo(
    () => [...new Set(
      rows.map((row) => String(row.brand || "").trim()).filter((code) => code && code !== "*"),
    )].sort(),
    [rows],
  );

  const stageOptions = useMemo(
    () => sortStageCodes([...new Set(rows.flatMap((row) => row.stage_codes || []).filter(Boolean))]),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (view !== "all" && String(row.status || "") !== VIEW_STATUS[view]) return false;
        if (kind && row.kind !== kind) return false;
        const base = row.base_id ? basesById.get(row.base_id) : undefined;
        if (scope.baseId && row.base_id !== scope.baseId) return false;
        if (scope.domainId && (!base || String(base.domain_id) !== scope.domainId)) return false;
        if (scope.familyId) {
          const domain = base ? domainsById.get(base.domain_id) : undefined;
          if (!domain || String(domain.parent_id || "") !== scope.familyId) return false;
        }
        if (brands.length) {
          const brand = String(row.brand || "");
          if (brand && brand !== "*" && !brands.includes(brand)) return false;
        }
        if (stage && !(row.stage_codes || []).includes(stage)) return false;
        if (q) {
          const haystack = [row.title, row.kind ? kindLabel(row.kind) : "", pathOf(row), row.created_by || ""]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === "title") return String(a.title).localeCompare(String(b.title), "zh-CN");
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });
  }, [rows, view, kind, scope, brands, stage, query, sort, basesById, domainsById, pathOf]);

  const selectedRow = useMemo(
    () => filtered.find((row) => row.id === selectedId) || filtered[0] || null,
    [filtered, selectedId],
  );

  // 0–1 实底主 CTA：待审批行选中时让位给右栏「审核」；其它状态顶栏保持主 CTA。
  const demoteNew = selectedRow ? String(selectedRow.status || "") === "pending_review" : false;

  const toggleBrand = (value: string) => {
    setBrands((current) => (
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    ));
  };

  const toggleStage = (value: string) => {
    setStage((current) => (current === value ? "" : value));
  };

  const reset = useCallback(() => {
    setQuery("");
    setKind("");
    setScope(EMPTY_SCOPE);
    setBrands([]);
    setStage("");
    setView("all");
  }, []);

  const openCreate = useCallback(() => {
    nav("/admin/knowledge/catalog");
  }, [nav]);

  const filters = (
    <>
      <ScopeTabs
        familyOptions={familyOptions}
        domainOptions={domainOptions}
        baseOptions={baseOptions}
        familyId={scope.familyId}
        domainId={scope.domainId}
        baseId={scope.baseId}
        onFamily={(id) => setScope({ familyId: id, domainId: "", baseId: "" })}
        onDomain={(id) => setScope((current) => ({ ...current, domainId: id, baseId: "" }))}
        onBase={(id) => setScope((current) => ({ ...current, baseId: id }))}
        familyTotal={familyTotal}
        domainTotal={domainTotal}
        baseTotal={baseTotal}
      />
      <FilterChips
        label={KB_FILTER_LABEL.brand}
        filterKey="brand"
        options={brandOptions}
        selected={brands}
        onToggle={toggleBrand}
        onClear={() => setBrands([])}
      />
      <FilterChips
        label={KB_FILTER_LABEL.stage}
        filterKey="stage"
        options={stageOptions}
        selected={stage ? [stage] : []}
        onToggle={toggleStage}
        onClear={() => setStage("")}
        labelOf={stageLabel}
      />
      <div className="kbv-filters">
        <select aria-label="知识类型" data-kbv-kind value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="">全部类型</option>
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button type="button" className="kbv-link-plain" data-kbv-reset onClick={reset}>重置</button>
      </div>
    </>
  );

  return (
    <section className="kbv" data-admin-knowledge data-admin-kb-v2="home">
      {receipt ? (
        <p className="admin-receipt status-ok" data-admin-receipt role="status">{receipt}</p>
      ) : null}
      {actionError ? <p className="error" role="alert">{actionError}</p> : null}
      {error && !actionError ? <p className="error" role="alert">{errorMessage(error)}</p> : null}

      <header className="kbv-top" data-kbv-top>
        <div className="kbv-heading">
          <h1>知识管理</h1>
          <span className="kbv-lead">维护可信、可用的知识</span>
        </div>
        <div className="kbv-actions">
          <button type="button" className="btn" data-kbv-upload onClick={() => setUploadOpen(true)}>
            上传文件
          </button>
          <button
            type="button"
            className={demoteNew ? "btn" : "btn work"}
            data-kbv-new
            onClick={openCreate}
          >
            新建知识
          </button>
        </div>
      </header>

      <div className="kbv-workspace">
        <LibraryPane
          rows={filtered}
          totalCount={rows.length}
          counts={counts}
          view={view}
          onView={setView}
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={setSort}
          selectedId={selectedRow?.id || ""}
          onSelect={setSelectedId}
          expanded={expanded}
          onToggleExpand={() => setExpanded((current) => !current)}
          pendingDocsCount={pendingDocsCount}
          loading={loading}
          pathOf={pathOf}
          onUpload={() => setUploadOpen(true)}
          onCreate={openCreate}
          filters={filters}
        />

        <aside className="kbv-rail" aria-label="知识详情" data-kbv-detail>
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
            <p className="kbv-empty">从列表选择一条知识，查看内容与来源。</p>
          )}
        </aside>
      </div>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} bases={bases} />
    </section>
  );
}
