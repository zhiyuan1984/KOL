import { useRef } from "react";

export type ResultRailTab = "result" | "status" | "debug";

export type ResultRailTabItem = {
  id: ResultRailTab;
  label: string;
  badge?: number;
};

/** 结果栏的视图切换：只改变右栏呈现，不改变执行、确认或成果本身。 */
export default function ResultRailTabs({
  tabs,
  active,
  onChange,
  ariaLabel = "结果栏视图",
}: {
  tabs: ResultRailTabItem[];
  active: ResultRailTab;
  onChange: (id: ResultRailTab) => void;
  ariaLabel?: string;
}) {
  const buttons = useRef<Partial<Record<ResultRailTab, HTMLButtonElement | null>>>({});
  const focus = (id: ResultRailTab) => requestAnimationFrame(() => buttons.current[id]?.focus());
  const select = (id: ResultRailTab) => {
    if (id !== active) onChange(id);
  };
  const move = (index: number, delta: number) => {
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (!next) return;
    select(next.id);
    focus(next.id);
  };
  return (
    <div className="rail-tabs" role="tablist" aria-label={ariaLabel} data-result-rail-tabs>
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => { buttons.current[tab.id] = node; }}
            type="button"
            role="tab"
            id={`rail-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`rail-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            data-rail-tab={tab.id}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                const first = tabs[0];
                if (first) { select(first.id); focus(first.id); }
              } else if (event.key === "End") {
                event.preventDefault();
                const last = tabs[tabs.length - 1];
                if (last) { select(last.id); focus(last.id); }
              }
            }}
          >
            {tab.label}
            {tab.badge ? <em aria-label={`${tab.badge} 项`}>{tab.badge}</em> : null}
          </button>
        );
      })}
    </div>
  );
}
