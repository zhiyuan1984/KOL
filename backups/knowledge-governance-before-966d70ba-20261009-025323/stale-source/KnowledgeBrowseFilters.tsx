import type { ComponentProps } from "react";
import KnowledgeFilters from "./KnowledgeFilters";
import ScopeTabs from "../../components/ScopeTabs";
import FilterChips from "../../components/FilterChips";
import { KnowledgeFilterBar, StageFilterGroup } from "../../components/KnowledgeBrowse";
import { KB_SEARCH_PLACEHOLDER, brandLabel } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";

type Props = Omit<ComponentProps<typeof KnowledgeFilters>, "onUpload" | "onCreate" | "showCreationActions">;
/** 与员工知识页共用组件；管理侧仍使用 workspace-v1 的组织范围和同源 facet。 */
export default function KnowledgeBrowseFilters(props: Props) {
  const options = (items: Props["familyOptions"]) => items.filter(item => item.value !== "").map(item => ({ id: item.value, name: item.label, count: item.count }));
  return <div data-kbv-filter-pane>
    <KnowledgeFilterBar>
      <div className="kbv-search">
        <KbvIcon name="search" />
        <input type="search" aria-label="搜索知识" data-kbv-search placeholder={KB_SEARCH_PLACEHOLDER}
          value={props.query} onChange={event => props.onQuery(event.target.value)} />
      </div>
      <ScopeTabs familyOptions={options(props.familyOptions)} domainOptions={options(props.domainOptions)} baseOptions={options(props.baseOptions)}
        familyId={props.scope.familyId} domainId={props.scope.domainId} baseId={props.scope.baseId}
        onFamily={props.onFamily} onDomain={props.onDomain} onBase={props.onBase}
        familyTotal={props.familyOptions[0]?.count || 0} domainTotal={props.domainOptions[0]?.count || 0} baseTotal={props.baseOptions[0]?.count || 0} />
      <FilterChips label="适用品牌" filterKey="brand" options={props.brandOptions.slice(1).map(item => item.value)}
        selected={props.selectedBrands} onToggle={props.onToggleBrand} onClear={props.onClearBrands} labelOf={brandLabel} />
      <StageFilterGroup selected={props.selectedStages} onChange={next => {
        if (!next.length) props.onClearStages();
        else { const changed = [...new Set([...props.selectedStages, ...next])].find(code => next.includes(code) !== props.selectedStages.includes(code)); if (changed) props.onToggleStage(changed); }
      }} />
      <details className="knowledge-admin-more-filters">
        <summary>更多筛选{props.kind ? " · 已选类型" : ""}</summary>
        <div className="kbv-chip-row" role="group" aria-label="类型">
          <span className="kbv-scope-name">类型</span>
          {props.kindOptions.map(item => <button key={item.value} type="button" className="kbv-tab" aria-pressed={props.kind === item.value}
            data-kb-kind={item.value} onClick={() => props.onKind(item.value)}>{item.label}<small>{item.count}</small></button>)}
        </div>
      </details>
    </KnowledgeFilterBar>
    <div className="kbv-tabs" role="group" aria-label="知识状态筛选">
      {props.viewOptions.map(item => <button key={item.value} type="button" className="kbv-tab" data-kbv-view={item.value}
        aria-pressed={props.view === item.value} onClick={() => props.onView(item.value as Props["view"])}>{item.label}<small>{item.count}</small></button>)}
    </div>
  </div>;
}
