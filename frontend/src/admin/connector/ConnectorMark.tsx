import { useEffect, useState } from "react";

/** Icon tile for a connector: uploaded image when present, letter fallback otherwise. */
export function ConnectorMark({ id, label, iconUrl }: { id: string; label: string; iconUrl?: string | null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [iconUrl]);
  const letter = (label || id || "?").trim().slice(0, 1).toUpperCase();
  if (iconUrl && !broken) {
    return (
      <span className="connector-mark" data-connector-mark>
        <img src={iconUrl} alt="" onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className="connector-mark connector-mark-letter" data-connector-mark aria-hidden>
      {letter}
    </span>
  );
}
