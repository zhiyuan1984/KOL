import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MODEL_TIER_EVENT, readModelTier, writeModelTier, type ModelTier } from "./types";

/* 档位语义的唯一来源：backend/src/worker/runner.ts —— 档位映射到本次回答的 effort
   （fast→low / balanced→medium / quality→high）。说明用业务口径写「适合哪类活」，
   不写模型名、不写计费、也不写 effort（引擎词不上员工表面）。 */
const TIERS: { id: ModelTier; label: string; hint: string }[] = [
  { id: "fast", label: "快速", hint: "查数据、看进度这类快问快答" },
  { id: "balanced", label: "均衡", hint: "日常跟进与草稿的默认档" },
  { id: "quality", label: "高质量", hint: "写邮件、写话术等要打磨的产出" },
];

const TIER_LABEL: Record<ModelTier, string> = {
  fast: "快速",
  balanced: "均衡",
  quality: "高质量",
};

export default function ModelTierControl({ className = "" }: { className?: string }) {
  const [tier, setTier] = useState<ModelTier>(readModelTier);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => indexOfTier(readModelTier()));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<ModelTier>).detail;
      if (next === "fast" || next === "balanced" || next === "quality") setTier(next);
      else setTier(readModelTier());
    };
    window.addEventListener(MODEL_TIER_EVENT, sync);
    return () => window.removeEventListener(MODEL_TIER_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) rowRefs.current[active]?.focus();
  }, [open, active]);

  const choose = (next: ModelTier) => {
    setTier(next);
    writeModelTier(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={"tier-control composer-tier-topbar" + (className ? ` ${className}` : "")}
      data-composer-tier
    >
      <button
        type="button"
        ref={triggerRef}
        className="tier-trigger"
        data-tier-trigger
        aria-label={`模型档位：${TIER_LABEL[tier]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(indexOfTier(tier));
          setOpen((value) => !value);
        }}
      >
        <span className="composer-tier-label" aria-hidden>档位</span>
        <span className="tier-trigger-value" data-tier-value>{TIER_LABEL[tier]}</span>
        <svg className="tier-trigger-caret" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          className="menu-popover tier-panel"
          role="menu"
          aria-label="回答档位"
          data-tier-panel
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
              return;
            }
            if (event.key === "Tab") {
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((index) => (index + step + TIERS.length) % TIERS.length);
            }
          }}
        >
          <p className="tier-panel-title">回答档位</p>
          {TIERS.map((row, index) => (
            <button
              key={row.id}
              type="button"
              role="menuitemradio"
              aria-checked={row.id === tier}
              tabIndex={index === active ? 0 : -1}
              className={"tier-row" + (row.id === tier ? " is-current" : "")}
              data-tier-option={row.id}
              ref={(element) => { rowRefs.current[index] = element; }}
              onClick={() => choose(row.id)}
            >
              <span className="tier-row-text">
                <strong>{row.label}</strong>
                <small>{row.hint}</small>
              </span>
              {row.id === tier ? (
                <svg className="tier-row-check" viewBox="0 0 16 16" aria-hidden>
                  <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          ))}
          <div className="tier-panel-more">
            <Link role="menuitem" to="/settings?tab=preferences" onClick={() => setOpen(false)}>
              更多设置…
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function indexOfTier(tier: ModelTier) {
  const index = TIERS.findIndex((row) => row.id === tier);
  return index < 0 ? 1 : index;
}
