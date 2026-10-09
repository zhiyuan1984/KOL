import { FilterOptionButton, FilterRow } from "./KnowledgeFilterControls";

type Props = {
  label: string; filterKey: string; options: string[]; selected: string[];
  onToggle: (value: string) => void; onClear: () => void;
  labelOf?: (value: string) => string;
  counts?: Record<string, number>; allCount?: number; countsReady?: boolean;
};

/** Applicability multiselection retains the caller's matching and permission contract. */
export default function FilterChips({ label, filterKey, options, selected, onToggle, onClear, labelOf,
  counts, allCount, countsReady = true }: Props) {
  return <FilterRow label={label} data-kb-filter={filterKey} role="group" aria-label={label}>
    <FilterOptionButton className="kbv-filter-chip" label="全部" count={allCount} countsReady={countsReady}
      selected={!selected.length} data-kb-filter-value="" onClick={onClear} />
    {options.map(value => <FilterOptionButton key={value} className="kbv-filter-chip"
      label={labelOf ? labelOf(value) : value} count={counts?.[value]} countsReady={countsReady}
      selected={selected.includes(value)} data-kb-filter-value={value} onClick={() => onToggle(value)} />)}
  </FilterRow>;
}
