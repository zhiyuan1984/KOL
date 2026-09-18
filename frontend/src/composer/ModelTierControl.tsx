import { useEffect, useState } from "react";
import { MODEL_TIER_EVENT, readModelTier, writeModelTier, type ModelTier } from "./types";

export default function ModelTierControl({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const [tier, setTier] = useState<ModelTier>(readModelTier);

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<ModelTier>).detail;
      if (next === "fast" || next === "balanced" || next === "quality") setTier(next);
      else setTier(readModelTier());
    };
    window.addEventListener(MODEL_TIER_EVENT, sync);
    return () => window.removeEventListener(MODEL_TIER_EVENT, sync);
  }, []);

  return (
    <label className={"tier-control composer-tier-topbar" + (className ? ` ${className}` : "")} data-composer-tier>
      <span className="sr-only">模型档位</span>
      {compact ? null : <span className="composer-tier-label" aria-hidden>档位</span>}
      <select
        value={tier}
        aria-label="模型档位"
        onChange={(event) => {
          const next = event.target.value as ModelTier;
          setTier(next);
          writeModelTier(next);
        }}
      >
        <option value="fast">快速</option>
        <option value="balanced">均衡</option>
        <option value="quality">高质量</option>
      </select>
    </label>
  );
}
