import type { ComponentProps } from "react";
import KnowledgeFilters from "./KnowledgeFilters";
import ScopeTabs from "../../components/ScopeTabs";
import { KnowledgeFilterBar, StageFilterGroup } from "../../components/KnowledgeBrowse";
import { KB_SEARCH_PLACEHOLDER, brandLabel } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";

type Props = Omit<ComponentProps<typeof KnowledgeFilters>, "onUpload" | "onCreate" | "showCreationActions"> & {
  onStages: (next: string[]) => void;
  /** Hide unavailable or stale counts while a new filter request is pending. */
  countsReady?: boolean;
};
/** 与员工知识页共用组件；管理侧仍使用 workspace-v1 的组织范围和同源 facet。 */
export default function KnowledgeBrowseFilters(props: Props) {
  const options = (items: Props["familyOptions"]) => items.filter(item => item.value !== "").map(item => ({ id: item.value, name: item.label, count: item.count }));
  const countsReady = props.countsReady !== false;
  const otherStates = Math.max(0, (props.viewOptions.find(item => item.value === "all")?.count || 0)
    - props.viewOptions.filter(item => item.value !== "all").reduce((sum, item) => sum + item.count, 0));
  return <div data-kbv-filter-pane>
    <KnowledgeFilterBar>
      <div className="kbv-search">
        <KbvIcon name="search" />
        <input type="search" aria-label="搜索知识" data-kbv-search placeholder={KB_SEARCH_PLACEHOLDER}
          value={props.query} onChange={event => props.onQuery(event.target.value)} />
      </div>
      <div className="knowledge-browse-filter-group" data-kb-filter="taxonomy" role="group" aria-label="知识分类">
        <ScopeTabs showCount={countsReady} familyOptions={options(props.familyOptions)} domainOptions={options(props.domainOptions)} baseOptions={options(props.baseOptions)}
          familyId={props.scope.familyId} domainId={props.scope.domainId} baseId={props.scope.baseId}
          onFamily={props.onFamily} onDomain={props.onDomain} onBase={props.onBase}
          familyTotal={props.familyOptions[0]?.count || 0} domainTotal={props.domainOptions[0]?.count || 0} baseTotal={props.baseOptions[0]?.count || 0} />
      </div>
      <div className="knowledge-browse-filter-group kbv-chip-row" data-kb-filter="brand" role="group" aria-label="适用品牌">
        <span className="kbv-scope-name">适用品牌</span>
        <div className="knowledge-filter-options">
          <button type="button" className="kbv-filter-chip" aria-pressed={!props.selectedBrands.length}
            data-kb-filter-value="" onClick={props.onClearBrands}>全部</button>
          {props.brandOptions.slice(1).map(item => <button key={item.value} type="button" className="kbv-filter-chip"
            aria-pressed={props.selectedBrands.includes(item.value)} data-kb-filter-value={item.value}
            onClick={() => props.onToggleBrand(item.value)}>{brandLabel(item.value) || item.label}</button>)}
        </div>
      </div>
      <div className="knowledge-browse-filter-group">
        <StageFilterGroup selected={props.selectedStages} onChange={props.onStages} />
      </div>
      <div className="knowledge-browse-filter-group kbv-chip-row" data-kb-filter="kind" role="group" aria-label="类型">
        <span className="kbv-scope-name">类型</span>
        <div className="knowledge-filter-options">
          {props.kindOptions.map(item => <button key={item.value} type="button" className="kbv-tab" aria-pressed={props.kind === item.value}
            data-kb-kind={item.value} onClick={() => props.onKind(item.value)}>{item.label}{countsReady && <small>{item.count}</small>}</button>)}
        </div>
      </div>
    </KnowledgeFilterBar>
    <div className="kbv-tabs" role="group" aria-label="知识状态筛选">
      {props.viewOptions.map(item => <button key={item.value} type="button" className="kbv-tab" data-kbv-view={item.value}
        aria-pressed={props.view === item.value}
        title={countsReady && item.value === "all" && otherStates > 0 ? `含 ${otherStates} 条加工中或其他状态资产` : undefined}
        onClick={() => props.onView(item.value as Props["view"])}>{item.label}{countsReady && <small>{item.count}</small>}</button>)}
    </div>
  </div>;
}
