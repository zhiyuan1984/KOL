import { useState } from "react";
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
};

/** chips 超过 8 项时先折叠，由「更多阶段」展开（DESIGN §4；选中项始终可见）。 */
const CHIP_VISIBLE_LIMIT = 8;

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
 * 管理端中栏筛选列：七组筛选全部为「标签＋计数」chips，每组一个「全部」。
 * 分类（业务族 → 业务域 → 知识库）逐级收窄；品牌/阶段为多选，其余单选。
 * 底部操作始终固定可见；中栏只做筛选，不再出现卡片壳。
 */
export default function KnowledgeFilters({
  query, onQuery, scope, onFamily, onDomain, onBase,
  familyOptions, domainOptions, baseOptions,
  brandOptions, selectedBrands, onToggleBrand, onClearBrands,
  stageOptions, selectedStages, onToggleStage, onClearStages,
  kindOptions, kind, onKind,
  viewOptions, view, onView,
  onUpload, onCreate,
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
        <label className="kbv-search" aria-label="搜索知识">
          <span className="kbv-search-glyph" aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="搜索知识"
            placeholder="搜索标题、主题、负责人…"
            data-kbv-search
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>

        <section className="kbv-filter-group" data-kb-filter="taxonomy">
          <div className="kbv-filter-block">
            <span className="kbv-filter-name">{KB_SCOPE_FAMILY}</span>
            <div className="kbv-facet-list" role="group" aria-label={KB_SCOPE_FAMILY}>
              {chipList(
                familyOptions,
                (value) => scope.familyId === value,
                (value) => ({ "data-kb-scope-family": value }),
                onFamily,
              )}
            </div>
          </div>
          <div className="kbv-filter-block">
            <span className="kbv-filter-name">{KB_SCOPE_DOMAIN}</span>
            <div className="kbv-facet-list" role="group" aria-label={KB_SCOPE_DOMAIN}>
              {chipList(
                domainOptions,
                (value) => scope.domainId === value,
                (value) => ({ "data-kb-scope-domain": value }),
                onDomain,
              )}
            </div>
          </div>
          <div className="kbv-filter-block">
            <span className="kbv-filter-name">{KB_SCOPE_BASE}</span>
            <div className="kbv-facet-list" role="group" aria-label={KB_SCOPE_BASE}>
              {chipList(
                baseOptions,
                (value) => scope.baseId === value,
                (value) => ({ "data-kb-scope-base": value }),
                onBase,
              )}
            </div>
          </div>
        </section>

        <section className="kbv-filter-group" data-kb-filter="brand">
          <span className="kbv-filter-name">{KB_FILTER_LABEL.brand}</span>
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
        </section>

        <section className="kbv-filter-group" data-kb-filter="stage">
          <span className="kbv-filter-name">{KB_FILTER_LABEL.stage}</span>
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
        </section>

        <section className="kbv-filter-group" data-kb-filter="kind">
          <span className="kbv-filter-name">类型</span>
          <div className="kbv-facet-list" role="group" aria-label="类型">
            {chipList(
              kindOptions,
              (value) => kind === value,
              (value) => ({ "data-kb-kind": value }),
              onKind,
            )}
          </div>
        </section>

        <section className="kbv-filter-group" data-kb-filter="status">
          <span className="kbv-filter-name">状态</span>
          <div className="kbv-facet-list" role="group" aria-label="状态">
            {chipList(
              viewOptions,
              (value) => view === value,
              (value) => ({ "data-kbv-view": value }),
              (value) => onView(value as KbView),
            )}
          </div>
        </section>
      </div>

      <footer className="kbv-filter-actions">
        <button type="button" className="btn" data-kbv-upload onClick={onUpload}>上传文件</button>
        <button type="button" className="btn work" data-kbv-new onClick={onCreate}>新建知识</button>
      </footer>
    </aside>
  );
}
