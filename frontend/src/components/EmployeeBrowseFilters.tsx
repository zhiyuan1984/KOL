import type { ComponentProps, ReactNode } from "react";
import ScopeTabs from "./ScopeTabs";
import BusinessTaxonomyFilters from "./BusinessTaxonomyFilters";
import FilterChips from "./FilterChips";
import { KnowledgeFilterBar, StageFilterGroup } from "./KnowledgeBrowse";
import { FilterAction, FilterOptionButton, FilterRow } from "./KnowledgeFilterControls";

/** Employee knowledge and Agent share the complete search/filter hierarchy. Callers own data and matching. */
export default function EmployeeBrowseFilters({ search, scope, brand, stage, kinds, kind, onKind, countsReady,
  emptyTaxonomyCount, showEmptyTaxonomy, onToggleEmpty, anyFilter, onReset, kindAttribute, clearAttributes, scopeFallback, businessDirectory = false }: {
  businessDirectory?: boolean; scopeFallback?: ReactNode; search: ReactNode; scope: ComponentProps<typeof ScopeTabs> | null;
  brand: ComponentProps<typeof FilterChips>; stage: ComponentProps<typeof StageFilterGroup>;
  kinds: Array<{ value: string; label: string; count: number }>; kind: string; onKind: (value: string) => void;
  countsReady: boolean; emptyTaxonomyCount: number; showEmptyTaxonomy: boolean; onToggleEmpty: () => void;
  anyFilter: boolean; onReset: () => void; kindAttribute: string; clearAttributes?: Record<string, string | boolean>;
}) {
  return <KnowledgeFilterBar>
    {search}
    <div className="kbv-filter-tools">
      <span className="muted" data-kbv-count-scope>计数随其他筛选条件变化 · 个人可见范围</span>
      <div>
        {!businessDirectory && countsReady && emptyTaxonomyCount > 0 ? <FilterAction className="kbv-text-action" data-kbv-empty-taxonomy
          aria-expanded={showEmptyTaxonomy} onClick={onToggleEmpty}>{showEmptyTaxonomy ? "收起空分类" : `显示空分类（${emptyTaxonomyCount}）`}</FilterAction> : null}
        {anyFilter ? <FilterAction className="kbv-text-action" {...clearAttributes} onClick={onReset}>清除筛选</FilterAction> : null}
      </div>
    </div>
    {scope ? businessDirectory ? <BusinessTaxonomyFilters {...scope} /> : <ScopeTabs {...scope} /> : <p className="muted" data-kb-scope-none>{scopeFallback ?? "暂无分类信息。"}</p>}
    <FilterChips {...brand} />
    <StageFilterGroup {...stage} />
    <FilterRow label="类型" data-kb-filter="kind" role="group" aria-label="类型">
      {kinds.map(item => <FilterOptionButton key={item.value} label={item.label} count={item.count} countsReady={countsReady}
        selected={kind === item.value} {...{ [kindAttribute]: item.value }} onClick={() => onKind(item.value)} />)}
    </FilterRow>
  </KnowledgeFilterBar>;
}
