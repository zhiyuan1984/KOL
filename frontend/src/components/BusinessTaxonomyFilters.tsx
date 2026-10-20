import { useState, type ComponentProps } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import type ScopeTabs from "./ScopeTabs";
import { FilterAction, FilterOptionButton, FilterRow } from "./KnowledgeFilterControls";

/** Same directory hierarchy and three-option disclosure as the ontology workspace. Zero-content nodes remain discoverable. */
export default function BusinessTaxonomyFilters({ familyOptions, domainOptions, baseOptions, familyId, domainId, baseId,
  onFamily, onDomain, onBase, familyTotal, domainTotal, baseTotal, showCount = true, disabled = false }: ComponentProps<typeof ScopeTabs>) {
  const axes = [
    { key: "family", label: "业务族", options: familyOptions, value: familyId, onChange: onFamily, total: familyTotal },
    { key: "domain", label: "业务域", options: domainOptions, value: domainId, onChange: onDomain, total: domainTotal },
    { key: "base", label: "业务主题", options: baseOptions, value: baseId, onChange: onBase, total: baseTotal },
  ];
  return <div className="kbv-scope-rows business-taxonomy-filters" data-kb-scope-picker data-business-directory aria-label="与本体一致的业务目录">
    {axes.map(axis => <BusinessAxis key={axis.key + (axis.key === "domain" ? familyId : axis.key === "base" ? familyId + domainId : "")} axis={axis} countsReady={showCount} disabled={disabled} />)}
  </div>;
}
function BusinessAxis({ axis, countsReady, disabled }: { axis: { key: string; label: string; options: {id:string;name:string;count?:number}[]; value: string; onChange: (id:string)=>void; total: number }; countsReady: boolean; disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? axis.options : axis.options.slice(0, 3);
  const selected = axis.options.find(option => option.id === axis.value);
  const visible = selected && !shown.some(option => option.id === selected.id) ? [...shown, selected] : shown;
  return <FilterRow className="kbv-scope-row" label={axis.label} role="group" aria-label={axis.label}>
    <FilterOptionButton disabled={disabled} label="全部" count={axis.total} countsReady={countsReady} selected={!axis.value}
      {...{[`data-kb-scope-${axis.key}`]: ""}} onClick={() => { axis.onChange(""); setExpanded(false); }} />
    {visible.map(option => <FilterOptionButton key={option.id} disabled={disabled} label={option.name} title={option.name} count={option.count} countsReady={countsReady}
      selected={axis.value === option.id} {...{[`data-kb-scope-${axis.key}`]: option.id}} onClick={() => { axis.onChange(option.id); setExpanded(false); }} />)}
    {axis.options.length > 3 && <FilterAction disabled={disabled} aria-label={`${expanded ? "收起" : "展开"}${axis.label}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? <>收起<UpOutlined aria-hidden="true" /></> : <>更多<DownOutlined aria-hidden="true" /></>}
    </FilterAction>}
  </FilterRow>;
}
