import { Button } from "antd";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

/** Knowledge-only Ant Design adapter; dimensions/colors are supplied by DESIGN tokens in CSS. */
export function FilterCount({ count, ready = true }: { count?: number; ready?: boolean }) {
  return ready && count != null ? <small className="knowledge-filter-count" data-kb-facet-count>{count}</small> : null;
}

export function FilterRow({ label, children, className = "", ...props }: HTMLAttributes<HTMLDivElement> & { label: string; children: ReactNode }) {
  return <div {...props} className={`kbv-chip-row knowledge-filter-row ${className}`}>
    <span className="kbv-scope-name">{label}</span>
    <div className="knowledge-filter-options">{children}</div>
  </div>;
}

type OptionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type" | "color"> & {
  label: string; count?: number; countsReady?: boolean; selected: boolean;
};
export function FilterOptionButton({ label, count, countsReady = true, selected, className = "kbv-tab", ...props }: OptionProps) {
  return <Button {...props} htmlType="button" type="text" size="small" aria-pressed={selected}
    className={`knowledge-filter-option ${className}`}>
    <span className="knowledge-filter-label">{label}</span><FilterCount count={count} ready={countsReady} />
  </Button>;
}

/** Actions use the same local Ant Design adapter, without pretending to be selected filters. */
export function FilterAction({ children, className = "", type: _type, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color">) {
  return <Button {...props} htmlType="button" type="text" size="small" className={`knowledge-filter-action ${className}`}>{children}</Button>;
}
