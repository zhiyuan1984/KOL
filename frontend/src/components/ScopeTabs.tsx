import { KB_SCOPE_ALL, KB_SCOPE_BASE, KB_SCOPE_DOMAIN, KB_SCOPE_FAMILY, KB_SCOPE_LEAD } from "../knowledgeCopy";
import { FilterOptionButton } from "./KnowledgeFilterControls";

export type ScopeOption = { id: string; name: string; count?: number };
type Props = {
  familyOptions: ScopeOption[]; domainOptions: ScopeOption[]; baseOptions: ScopeOption[];
  familyId: string; domainId: string; baseId: string;
  onFamily: (id: string) => void; onDomain: (id: string) => void; onBase: (id: string) => void;
  familyTotal: number; domainTotal: number; baseTotal: number;
  showCount?: boolean;
  disabled?: boolean;
};

/** Hierarchical category filters, not page navigation. Stable selectors are retained. */
export default function ScopeTabs({ familyOptions, domainOptions, baseOptions, familyId, domainId, baseId,
  onFamily, onDomain, onBase, familyTotal, domainTotal, baseTotal, showCount = true, disabled = false }: Props) {
  const axes = [
    { key: "family", label: KB_SCOPE_FAMILY, options: familyOptions, value: familyId, onChange: onFamily, total: familyTotal },
    { key: "domain", label: KB_SCOPE_DOMAIN, options: domainOptions, value: domainId, onChange: onDomain, total: domainTotal },
    { key: "base", label: KB_SCOPE_BASE, options: baseOptions, value: baseId, onChange: onBase, total: baseTotal },
  ];
  return <div className="kbv-scope-rows" data-kb-scope-picker aria-label={KB_SCOPE_LEAD}>
    {axes.map(axis => <div className="kbv-scope-row knowledge-filter-row" key={axis.key}>
      <span className="kbv-scope-name">{axis.label}</span>
      <div className="kbv-scope-tabs knowledge-filter-options" role="group" aria-label={axis.label}>
        <FilterOptionButton disabled={disabled} label={KB_SCOPE_ALL} count={axis.total} countsReady={showCount} selected={!axis.value}
          {...{ [`data-kb-scope-${axis.key}`]: "" }} onClick={() => axis.onChange("")} />
        {axis.options.map(option => <FilterOptionButton disabled={disabled} key={option.id} label={option.name} count={option.count}
          countsReady={showCount} selected={axis.value === option.id}
          {...{ [`data-kb-scope-${axis.key}`]: option.id }} onClick={() => axis.onChange(option.id)} />)}
      </div>
    </div>)}
  </div>;
}
