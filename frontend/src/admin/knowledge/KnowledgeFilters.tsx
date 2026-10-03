import ScopeTabs, { type ScopeOption } from "../../components/ScopeTabs";
import { brandLabel, KB_FILTER_LABEL, kindLabel } from "../../knowledgeCopy";
import { stageLabel } from "../../labels";
import type { KbView } from "./LibraryPane";

export type FacetOption = { value: string; count: number };

type Scope = { familyId: string; domainId: string; baseId: string };

type Props = {
  query: string;
  onQuery: (value: string) => void;
  scope: Scope;
  onFamily: (id: string) => void;
  onDomain: (id: string) => void;
  onBase: (id: string) => void;
  familyOptions: ScopeOption[];
  domainOptions: ScopeOption[];
  baseOptions: ScopeOption[];
  brandOptions: FacetOption[];
  brandAllCount: number;
  hiddenBrands: string[];
  selectedBrands: string[];
  onToggleBrand: (value: string) => void;
  onRemoveBrand: (value: string) => void;
  onRestoreBrand: (value: string) => void;
  stageOptions: FacetOption[];
  hiddenStages: string[];
  selectedStages: string[];
  onToggleStage: (value: string) => void;
  onRemoveStage: (value: string) => void;
  onRestoreStage: (value: string) => void;
  kind: string;
  kinds: Array<{ value: string; label: string }>;
  onKind: (value: string) => void;
  view: KbView;
  onView: (value: KbView) => void;
  onUpload: () => void;
  onCreate: () => void;
};

const VIEWS: Array<{ value: KbView; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待审批" },
  { value: "published", label: "已发布" },
  { value: "draft", label: "草稿" },
  { value: "disabled", label: "已停用" },
];

/** 管理端左侧筛选列：只有筛选在这里发生；底部操作始终固定可见。 */
export default function KnowledgeFilters({
  query, onQuery, scope, onFamily, onDomain, onBase,
  familyOptions, domainOptions, baseOptions,
  brandOptions, brandAllCount, hiddenBrands, selectedBrands, onToggleBrand, onRemoveBrand, onRestoreBrand,
  stageOptions, hiddenStages, selectedStages, onToggleStage, onRemoveStage, onRestoreStage,
  kind, kinds, onKind, view, onView, onUpload, onCreate,
}: Props) {
  const visibleBrands = brandOptions.filter((option) => !hiddenBrands.includes(option.value));
  const hiddenBrandOptions = brandOptions.filter((option) => hiddenBrands.includes(option.value));
  const visibleStages = stageOptions.filter((option) => !hiddenStages.includes(option.value));
  const hiddenStageOptions = stageOptions.filter((option) => hiddenStages.includes(option.value));

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

        <section className="kbv-filter-card" data-kb-filter="taxonomy">
          <h2>分类</h2>
          <ScopeTabs
            showCount={false}
            familyOptions={familyOptions}
            domainOptions={domainOptions}
            baseOptions={baseOptions}
            familyId={scope.familyId}
            domainId={scope.domainId}
            baseId={scope.baseId}
            onFamily={onFamily}
            onDomain={onDomain}
            onBase={onBase}
            familyTotal={0}
            domainTotal={0}
            baseTotal={0}
          />
        </section>

        <section className="kbv-filter-card" data-kb-filter="brand">
          <h2>{KB_FILTER_LABEL.brand}</h2>
          <div className="kbv-facet-list">
            <button
              type="button"
              className="kbv-filter-chip"
              aria-pressed={selectedBrands.length === 0}
              data-kb-filter-value=""
              onClick={() => selectedBrands.forEach((value) => onToggleBrand(value))}
            >
              <span>全部</span>
              <small data-kb-facet-count>{brandAllCount}</small>
            </button>
            {visibleBrands.map((option) => (
              <span className="kbv-facet-chip" key={option.value}>
                <button
                  type="button"
                  className="kbv-filter-chip"
                  aria-pressed={selectedBrands.includes(option.value)}
                  data-kb-filter-value={option.value}
                  onClick={() => onToggleBrand(option.value)}
                >
                  <span>{brandLabel(option.value)}</span>
                  <small data-kb-facet-count>{option.count}</small>
                </button>
                <button
                  type="button"
                  className="kbv-facet-remove"
                  data-kb-brand-remove={option.value}
                  aria-label={`从常用品牌中移除 ${brandLabel(option.value)}`}
                  onClick={() => onRemoveBrand(option.value)}
                >
                  ×
                </button>
              </span>
            ))}
            {hiddenBrandOptions.length ? (
              <select
                className="kbv-facet-add"
                aria-label="找回品牌筛选"
                data-kb-brand-add
                value=""
                onChange={(event) => {
                  if (event.target.value) onRestoreBrand(event.target.value);
                }}
              >
                <option value="">＋</option>
                {hiddenBrandOptions.map((option) => (
                  <option key={option.value} value={option.value}>{brandLabel(option.value)}</option>
                ))}
              </select>
            ) : null}
          </div>
        </section>

        <section className="kbv-filter-card" data-kb-filter="stage">
          <h2>{KB_FILTER_LABEL.stage}</h2>
          <div className="kbv-facet-list">
            {visibleStages.map((option) => (
              <span className="kbv-facet-chip" key={option.value}>
                <button
                  type="button"
                  className="kbv-filter-chip"
                  aria-pressed={selectedStages.includes(option.value)}
                  data-kb-stage-toggle={option.value}
                  onClick={() => onToggleStage(option.value)}
                >
                  <span>{stageLabel(option.value) || option.value}</span>
                  <small data-kb-facet-count>{option.count}</small>
                </button>
                <button
                  type="button"
                  className="kbv-facet-remove"
                  data-kb-stage-remove={option.value}
                  aria-label={`从常用标签中移除 ${stageLabel(option.value) || option.value}`}
                  onClick={() => onRemoveStage(option.value)}
                >
                  ×
                </button>
              </span>
            ))}
            {hiddenStageOptions.length ? (
              <select
                className="kbv-facet-add"
                aria-label="找回阶段筛选"
                data-kb-stage-add
                value=""
                onChange={(event) => {
                  if (event.target.value) onRestoreStage(event.target.value);
                }}
              >
                <option value="">＋</option>
                {hiddenStageOptions.map((option) => (
                  <option key={option.value} value={option.value}>{stageLabel(option.value) || option.value}</option>
                ))}
              </select>
            ) : null}
          </div>
        </section>

        <section className="kbv-filter-card" data-kb-filter="kind">
          <h2>类型</h2>
          <div className="kbv-type-list">
            <button
              type="button"
              className="kbv-type-choice"
              aria-pressed={!kind}
              data-kb-kind=""
              onClick={() => onKind("")}
            >
              全部
            </button>
            {kinds.map((option) => (
              <button
                key={option.value}
                type="button"
                className="kbv-type-choice"
                aria-pressed={kind === option.value}
                data-kb-kind={option.value}
                onClick={() => onKind(option.value)}
              >
                {option.label || kindLabel(option.value)}
              </button>
            ))}
          </div>
        </section>

        <section className="kbv-filter-card" data-kb-filter="status">
          <h2>状态</h2>
          <div className="kbv-status-list" role="group" aria-label="状态">
            {VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="kbv-status-choice"
                aria-pressed={view === option.value}
                data-kbv-view={option.value}
                onClick={() => onView(option.value)}
              >
                {option.label}
              </button>
            ))}
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
