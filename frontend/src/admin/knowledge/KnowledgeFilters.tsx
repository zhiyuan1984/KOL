import WorkspaceSearchInput from "../../components/WorkspaceSearchInput";
import { useState, type ReactNode } from "react";
import KbvIcon from "../../knowledgeIcons";
import {
  brandLabel,
  KB_FILTER_LABEL,
  KB_SCOPE_BASE,
  KB_SCOPE_DOMAIN,
  KB_SCOPE_FAMILY,
} from "../../knowledgeCopy";
import { stageLabel } from "../../labels";
import type { KbView } from "./LibraryPane";

/** 一组筛选 chips：value=""/“all” 表示「全部」，count 为点选后的结果数（应用除本组外的筛选）。 */
export type FilterOption = { value: string; label: string; count: number };

type Scope = { familyId: string; domainId: string; baseId: string };

type Props = {
  query: string;
  onQuery: (value: string) => void;
  scope: Scope;
  onFamily: (id: string) => void;
  onDomain: (id: string) => void;
  onBase: (id: string) => void;
  familyOptions: FilterOption[];
  domainOptions: FilterOption[];
  baseOptions: FilterOption[];
  brandOptions: FilterOption[];
  selectedBrands: string[];
  onToggleBrand: (value: string) => void;
  onClearBrands: () => void;
  stageOptions: FilterOption[];
  selectedStages: string[];
  onToggleStage: (value: string) => void;
  onClearStages: () => void;
  kindOptions: FilterOption[];
  kind: string;
  onKind: (value: string) => void;
  viewOptions: FilterOption[];
  view: KbView;
  onView: (value: KbView) => void;
  onUpload: () => void;
  onCreate: () => void;
  showCreationActions?: boolean;
};

/** 长选项组使用紧凑列表；折叠时选中项始终可见。 */
const CHIP_VISIBLE_LIMIT = 5;

function FilterGroup({ label, icon, children, className = "", defaultOpen = true, selectedCount = 0 }: {
  label: string; icon: string; children: ReactNode; className?: string; defaultOpen?: boolean; selectedCount?: number;
}) {
  return <details open={defaultOpen} className={`kbv-filter-section ${className}`}>
    <summary><KbvIcon name={icon} /><span>{label}</span>{selectedCount ? <small>{selectedCount} 项</small> : null}<KbvIcon name="chevron" /></summary>
    {children}
  </details>;
}

function FilterChip({ label, count, pressed, attrs, onClick }: {
  label: string;
  count: number;
  pressed: boolean;
  attrs: Record<string, string>;
  onClick: () => void;
}) {
  return (
    <button type="button" className="kbv-chip" aria-pressed={pressed} {...attrs} onClick={onClick}>
      <span>{label}</span>
      <small data-kb-facet-count>{count}</small>
    </button>
  );
}

/**
 * 管理端筛选列：可折叠的分类列表与短选项组，每组一个「全部」。
 * 分类（业务族 → 业务域 → 知识库）逐级收窄；品牌/阶段为多选，其余单选。
 * 底部操作固定可见；折叠不会清除已选条件。
 */
export default function KnowledgeFilters({
  query, onQuery, scope, onFamily, onDomain, onBase,
  familyOptions, domainOptions, baseOptions,
  brandOptions, selectedBrands, onToggleBrand, onClearBrands,
  stageOptions, selectedStages, onToggleStage, onClearStages,
  kindOptions, kind, onKind,
  viewOptions, view, onView,
  onUpload, onCreate, showCreationActions = true,
}: Props) {
  const [stagesExpanded, setStagesExpanded] = useState(false);
  const stageAll = stageOptions[0];
  const stageRest = stageOptions.slice(1);
  const stageFold = stageRest.length > CHIP_VISIBLE_LIMIT && !stagesExpanded;
  const visibleStages = stageFold
    ? stageRest.filter((option, index) => index < CHIP_VISIBLE_LIMIT || selectedStages.includes(option.value))
    : stageRest;
  const hiddenStageCount = stageRest.length - visibleStages.length;

  const chipList = (
    options: FilterOption[],
    pressedOf: (value: string) => boolean,
    attrsOf: (value: string) => Record<string, string>,
    onClickOf: (value: string) => void,
  ) => options.map((option) => (
    <FilterChip
      key={`${option.value || "__all"}`}
      label={option.label}
      count={option.count}
      pressed={pressedOf(option.value)}
      attrs={attrsOf(option.value)}
      onClick={() => onClickOf(option.value)}
    />
  ));

  return (
    <aside className="kbv-filter-pane" aria-label="知识筛选" data-kbv-filter-pane>
      <div className="kbv-filter-scroll">
        <WorkspaceSearchInput className="kbv-search"
            aria-label="搜索知识"
            placeholder="搜索标题、正文、负责人…"
            data-kbv-search
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />

        <section className="kbv-filter-group" data-kb-filter="taxonomy">
          <FilterGroup label={KB_SCOPE_FAMILY} icon="family" className="kbv-filter-block">
            <div className="kbv-facet-list" role="group" aria-label={KB_SCOPE_FAMILY}>
              {chipList(
                familyOptions,
                (value) => scope.familyId === value,
                (value) => ({ "data-kb-scope-family": value }),
                onFamily,
              )}
            </div>
          </FilterGroup>
          <FilterGroup label={KB_SCOPE_DOMAIN} icon="layers" className="kbv-filter-block">
            <div className="kbv-facet-list" role="group" aria-label={KB_SCOPE_DOMAIN}>
              {chipList(
                domainOptions,
                (value) => scope.domainId === value,
                (value) => ({ "data-kb-scope-domain": value }),
                onDomain,
              )}
            </div>
          </FilterGroup>
          <FilterGroup label={KB_SCOPE_BASE} icon="book" className="kbv-filter-block">
            <div className="kbv-facet-list" role="group" aria-label={KB_SCOPE_BASE}>
              {chipList(
                baseOptions,
                (value) => scope.baseId === value,
                (value) => ({ "data-kb-scope-base": value }),
                onBase,
              )}
            </div>
          </FilterGroup>
        </section>

        <section className="kbv-filter-group" data-kb-filter="brand">
          <FilterGroup label={KB_FILTER_LABEL.brand} icon="tag" defaultOpen={false} selectedCount={selectedBrands.length} >
          <div className="kbv-facet-list" role="group" aria-label={KB_FILTER_LABEL.brand}>
            <FilterChip
              label="全部"
              count={brandOptions[0]?.count ?? 0}
              pressed={selectedBrands.length === 0}
              attrs={{ "data-kb-filter-value": "" }}
              onClick={onClearBrands}
            />
            {brandOptions.slice(1).map((option) => (
              <FilterChip
                key={option.value}
                label={brandLabel(option.value) || option.value}
                count={option.count}
                pressed={selectedBrands.includes(option.value)}
                attrs={{ "data-kb-filter-value": option.value }}
                onClick={() => onToggleBrand(option.value)}
              />
            ))}
          </div>
          </FilterGroup>
        </section>

        <section className="kbv-filter-group" data-kb-filter="stage">
          <FilterGroup label={KB_FILTER_LABEL.stage} icon="hierarchy" defaultOpen={false} selectedCount={selectedStages.length} >
          <div className="kbv-facet-list" role="group" aria-label={KB_FILTER_LABEL.stage}>
            <FilterChip
              label="全部"
              count={stageAll?.count ?? 0}
              pressed={selectedStages.length === 0}
              attrs={{ "data-kb-stage-toggle": "" }}
              onClick={onClearStages}
            />
            {visibleStages.map((option) => (
              <FilterChip
                key={option.value}
                label={stageLabel(option.value) || option.label || option.value}
                count={option.count}
                pressed={selectedStages.includes(option.value)}
                attrs={{ "data-kb-stage-toggle": option.value }}
                onClick={() => onToggleStage(option.value)}
              />
            ))}
            {stageRest.length > CHIP_VISIBLE_LIMIT ? (
              <button
                type="button"
                className="kbv-chip kbv-chip-more"
                data-kb-stage-more
                aria-expanded={stagesExpanded}
                onClick={() => setStagesExpanded((value) => !value)}
              >
                {stagesExpanded ? "收起" : `＋ 更多阶段（${hiddenStageCount}）`}
              </button>
            ) : null}
          </div>
          </FilterGroup>
        </section>

        <section className="kbv-filter-group" data-kb-filter="kind">
          <FilterGroup label="类型" icon="file" defaultOpen={false} selectedCount={kind ? 1 : 0} className={kindOptions.length > CHIP_VISIBLE_LIMIT ? "kbv-filter-list" : ""}>
          <div className="kbv-facet-list" role="group" aria-label="类型">
            {chipList(
              kindOptions,
              (value) => kind === value,
              (value) => ({ "data-kb-kind": value }),
              onKind,
            )}
          </div>
          </FilterGroup>
        </section>

        <section className="kbv-filter-group" data-kb-filter="status">
          <FilterGroup label="状态" icon="status">
          <div className="kbv-facet-list" role="group" aria-label="状态">
            {chipList(
              viewOptions,
              (value) => view === value,
              (value) => ({ "data-kbv-view": value }),
              (value) => onView(value as KbView),
            )}
          </div>
          </FilterGroup>
        </section>
      </div>

      {showCreationActions ? <footer className="kbv-filter-actions">
        <button type="button" className="kbv-text-action" data-kbv-upload onClick={onUpload}>上传文件</button>
        <button type="button" className="kbv-text-action" data-kbv-new onClick={onCreate}>新建知识</button>
      </footer> : null}
    </aside>
  );
}
