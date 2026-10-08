import { useRef, type KeyboardEvent } from "react";

export type LifecycleOption = { id: string; label: string; count?: number | null; disabled?: boolean; dataAttributes?: Record<`data-${string}`, string> };

type Props = {
  label: string;
  options: LifecycleOption[];
  value: string;
  onChange: (id: string) => void;
  /** Views switch panels; filters only narrow the current collection. */
  mode?: "views" | "filter";
  idPrefix: string;
};

/** Presentation contract only: callers supply states, counts and authorization. */
export function LifecycleNavigation({ label, options, value, onChange, mode = "filter", idPrefix }: Props) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const views = mode === "views";
  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!views || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const enabled = options.filter(option => !option.disabled);
    if (!enabled.length) return;
    event.preventDefault();
    const index = enabled.findIndex(option => option.id === id);
    const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
    onChange(enabled[next].id);
    buttons.current.get(enabled[next].id)?.focus();
  }
  return <div className="lifecycle-navigation" data-mode={mode} role={views ? "tablist" : "group"} aria-label={label}>
    {options.map(option => <button key={option.id} type="button" {...option.dataAttributes}
      ref={node => { if (node) buttons.current.set(option.id, node); else buttons.current.delete(option.id); }}
      id={`${idPrefix}-tab-${option.id}`} className="lifecycle-tab"
      role={views ? "tab" : undefined} aria-selected={views ? value === option.id : undefined}
      aria-pressed={!views ? value === option.id : undefined}
      aria-controls={views ? `${idPrefix}-panel-${option.id}` : undefined}
      tabIndex={views && value !== option.id ? -1 : 0} disabled={option.disabled}
      data-selected={value === option.id} onClick={() => onChange(option.id)} onKeyDown={event => navigate(event, option.id)}>
      {option.label}{option.count != null ? <span className="lifecycle-count">{option.count}</span> : null}
    </button>)}
  </div>;
}
