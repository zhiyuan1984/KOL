import type { ComponentProps } from "react";
import ScopeTabs from "../../components/ScopeTabs";
import { StageFilterGroup } from "../../components/KnowledgeBrowse";
import type { FilterOption } from "./KnowledgeFilters";

type Props = ComponentProps<typeof ScopeTabs> & {
  brandOptions: FilterOption[];
  selectedBrands: string[];
  onToggleBrand: (code: string) => void;
  onClearBrands: () => void;
  selectedStages: string[];
  onStages: (next: string[]) => void;
  kindOptions?: FilterOption[];
  kind?: string;
  onKind?: (code: string) => void;
  fileTypeOptions?: FilterOption[];
  fileType?: string;
  onFileType?: (code: string) => void;
};

/** Shared presentation, independent list-filter and upload-form state. */
export default function KnowledgeSelectionFields({
  brandOptions, selectedBrands, onToggleBrand, onClearBrands, selectedStages, onStages,
  kindOptions = [], kind = "", onKind, fileTypeOptions = [], fileType = "", onFileType,
  ...scope
}: Props) {
  const showCount = scope.showCount !== false;
  const selectedAll = !kind && !fileType;
  return <>
    <div className="knowledge-browse-filter-group" data-kb-filter="taxonomy" role="group" aria-label="知识分类">
      <ScopeTabs {...scope} />
    </div>
    <div className="knowledge-browse-filter-group kbv-chip-row" data-kb-filter="brand" role="group" aria-label="适用品牌">
      <span className="kbv-scope-name">适用品牌</span>
      <div className="knowledge-filter-options">
        <button type="button" className="kbv-filter-chip" disabled={scope.disabled} aria-pressed={!selectedBrands.length}
          data-kb-filter-value="" onClick={onClearBrands}>全部</button>
        {brandOptions.filter(item => item.value && item.value !== "*").map(item => <button key={item.value} type="button" className="kbv-filter-chip"
          disabled={scope.disabled} aria-pressed={selectedBrands.includes(item.value)} data-kb-filter-value={item.value}
          title={item.label} onClick={() => onToggleBrand(item.value)}>{item.value}</button>)}
      </div>
    </div>
    <div className="knowledge-browse-filter-group">
      <StageFilterGroup selected={selectedStages} onChange={onStages} disabled={scope.disabled} />
    </div>
    <div className="knowledge-browse-filter-group kbv-chip-row" data-kb-filter="kind" role="group" aria-label="类型">
      <span className="kbv-scope-name">类型</span>
      <div className="knowledge-filter-options">
        <button type="button" className="kbv-tab" disabled={scope.disabled} aria-pressed={selectedAll} data-kb-kind=""
          data-kb-file-type="" onClick={() => { onKind?.(""); onFileType?.(""); }}>
          <span className="knowledge-option-label">全部</span>{showCount && <small>{kindOptions[0]?.count ?? fileTypeOptions[0]?.count ?? 0}</small>}
        </button>
        {kindOptions.filter(item => item.value).map(item => <button key={item.value} type="button" className="kbv-tab" disabled={scope.disabled}
          aria-pressed={kind === item.value && !fileType} data-kb-kind={item.value} onClick={() => { onFileType?.(""); onKind?.(item.value); }}>
          <span className="knowledge-option-label">{item.label}</span>{showCount && <small>{item.count}</small>}
        </button>)}
        {fileTypeOptions.filter(item => item.value).map(item => <button key={item.value} type="button" className="kbv-tab" disabled={scope.disabled}
          aria-pressed={fileType === item.value} data-kb-file-type={item.value} onClick={() => { onKind?.(""); onFileType?.(item.value); }}>
          <span className="knowledge-option-label">{item.label}</span>{showCount && <small>{item.count}</small>}
        </button>)}
      </div>
    </div>
  </>;
}
