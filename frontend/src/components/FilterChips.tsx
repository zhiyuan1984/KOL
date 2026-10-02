type Props = {
  label: string;
  filterKey: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  /** 展示名（值仍按原始代码过滤）：如阶段代码显示为中文标签。 */
  labelOf?: (value: string) => string;
};

/** 适用范围筛选标签：值全部露出，点击即筛；品牌支持多选（selected 多项），阶段单选。 */
export default function FilterChips({ label, filterKey, options, selected, onToggle, onClear, labelOf }: Props) {
  return (
    <div className="kbv-chip-row" data-kb-filter={filterKey}>
      <span className="kbv-scope-name">{label}</span>
      <button
        type="button"
        className="kbv-filter-chip"
        aria-pressed={selected.length === 0}
        data-kb-filter-value=""
        onClick={onClear}
      >
        全部
      </button>
      {options.map((value) => (
        <button
          key={value}
          type="button"
          className="kbv-filter-chip"
          aria-pressed={selected.includes(value)}
          data-kb-filter-value={value}
          onClick={() => onToggle(value)}
        >
          {labelOf ? labelOf(value) : value}
        </button>
      ))}
    </div>
  );
}
