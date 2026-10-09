import { useState, type ComponentProps } from "react";
import KnowledgeFilters from "./KnowledgeFilters";
import ScopeTabs from "../../components/ScopeTabs";
import FilterChips from "../../components/FilterChips";
import { KnowledgeFilterBar, StageFilterGroup } from "../../components/KnowledgeBrowse";
import { FilterAction, FilterOptionButton, FilterRow } from "../../components/KnowledgeFilterControls";
import { LifecycleNavigation } from "../../components/LifecycleNavigation";
import { KB_SEARCH_PLACEHOLDER, brandLabel } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";

type Props = Omit<ComponentProps<typeof KnowledgeFilters>, "onUpload" | "onCreate" | "showCreationActions"> & {
  onStages: (next: string[]) => void; countsReady?: boolean; onReset?: () => void;
};
/** Organization facets remain server supplied; both surfaces share the same presentation adapters. */
export default function KnowledgeBrowseFilters(props: Props) {
  const [showEmpty, setShowEmpty] = useState(false);
  const countsReady = props.countsReady !== false;
  const axes = [[props.familyOptions, props.scope.familyId], [props.domainOptions, props.scope.domainId], [props.baseOptions, props.scope.baseId]] as const;
  const emptyCount = axes.reduce((sum, [items, selected]) => sum + items.filter(item => item.value !== "" && item.count === 0 && item.value !== selected).length, 0);
  const options = (items: Props["familyOptions"], selected: string) => items
    .filter(item => item.value !== "" && (!countsReady || showEmpty || item.count !== 0 || item.value === selected))
    .map(item => ({ id: item.value, name: item.label, count: item.count }));
  const filtered = Boolean(props.query || props.scope.familyId || props.scope.domainId || props.scope.baseId
    || props.selectedBrands.length || props.selectedStages.length || props.kind || props.view !== "all");
  const otherStates = Math.max(0, (props.viewOptions.find(item => item.value === "all")?.count || 0)
    - props.viewOptions.filter(item => item.value !== "all").reduce((sum, item) => sum + item.count, 0));
  return <div data-kbv-filter-pane>
    <KnowledgeFilterBar>
      <div className="kbv-search">
        <KbvIcon name="search" />
        <input type="search" aria-label="搜索知识" data-kbv-search placeholder={KB_SEARCH_PLACEHOLDER}
          value={props.query} onChange={event => props.onQuery(event.target.value)} />
      </div>
      <div className="kbv-filter-tools">
        <span className="muted" data-kbv-count-scope>计数随其他筛选条件变化 · 组织授权范围</span>
        <div>
          {countsReady && emptyCount > 0 && <FilterAction className="kbv-text-action" data-kbv-empty-taxonomy
            aria-expanded={showEmpty} onClick={() => setShowEmpty(value => !value)}>{showEmpty ? "收起空分类" : `显示空分类（${emptyCount}）`}</FilterAction>}
          {filtered && props.onReset && <FilterAction className="kbv-text-action" data-kbv-filter-reset onClick={props.onReset}>清除筛选</FilterAction>}
        </div>
      </div>
      <div className="knowledge-browse-filter-group" data-kb-filter="taxonomy" role="group" aria-label="知识分类">
        <ScopeTabs showCount={countsReady} familyOptions={options(props.familyOptions, props.scope.familyId)} domainOptions={options(props.domainOptions, props.scope.domainId)} baseOptions={options(props.baseOptions, props.scope.baseId)}
          familyId={props.scope.familyId} domainId={props.scope.domainId} baseId={props.scope.baseId}
          onFamily={props.onFamily} onDomain={props.onDomain} onBase={props.onBase}
          familyTotal={props.familyOptions[0]?.count || 0} domainTotal={props.domainOptions[0]?.count || 0} baseTotal={props.baseOptions[0]?.count || 0} />
      </div>
      <div className="knowledge-browse-filter-group">
        <FilterChips label="适用品牌" filterKey="brand" options={props.brandOptions.slice(1).map(item => item.value)}
          selected={props.selectedBrands} onToggle={props.onToggleBrand} onClear={props.onClearBrands}
          labelOf={value => brandLabel(value) || props.brandOptions.find(item => item.value === value)?.label || value}
          counts={Object.fromEntries(props.brandOptions.map(item => [item.value, item.count]))}
          allCount={props.brandOptions.find(item => item.value === "")?.count} countsReady={countsReady} />
      </div>
      <div className="knowledge-browse-filter-group">
        <StageFilterGroup selected={props.selectedStages} onChange={props.onStages} options={props.stageOptions} countsReady={countsReady && props.stageOptions.length > 0} />
      </div>
      <FilterRow label="类型" className="knowledge-browse-filter-group" data-kb-filter="kind" role="group" aria-label="类型">
        {props.kindOptions.map(item => <FilterOptionButton key={item.value} label={item.label} count={item.count} countsReady={countsReady}
          selected={props.kind === item.value} data-kb-kind={item.value} onClick={() => props.onKind(item.value)} />)}
      </FilterRow>
    </KnowledgeFilterBar>
    <div className="kbv-tabs knowledge-lifecycle-filter" title="以下计数保留当前其他筛选条件，仅忽略生命周期条件">
      <span className="kbv-filter-status-label">生命周期</span>
      <LifecycleNavigation mode="filter" label="知识状态筛选" idPrefix="knowledge-status" value={props.view}
        onChange={value => props.onView(value as Props["view"])} options={props.viewOptions.map(item => ({
          id: item.value, label: item.label, count: countsReady ? item.count : undefined,
          title: countsReady && item.value === "all" && otherStates > 0 ? `含 ${otherStates} 条加工中或其他状态资产` : undefined,
          dataAttributes: { "data-kbv-view": item.value },
        }))} />
    </div>
  </div>;
}
