import type { ComposerChip } from "./types";

export default function ChipRail({
  chips,
  onRemove,
}: {
  chips: ComposerChip[];
  onRemove: (chip: ComposerChip, index: number) => void;
}) {
  if (!chips.length) return null;
  return (
    <div className="composer-chip-rail composer-chips" data-composer-chip-rail>
      {chips.map((chip, index) => (
        <span
          key={`${chip.kind}-${chip.id}-${index}`}
          className={"composer-chip skill-chip" + (chip.kind === "skill" && chip.write ? " skill-chip--write" : "")}
          data-composer-chip={chip.kind}
          data-skill-chip={chip.kind === "skill" || chip.kind === "discovery" ? chip.id : undefined}
          data-discovery-lock-chip={chip.kind === "discovery" ? true : undefined}
          data-knowledge-chip={chip.kind === "kb" ? chip.id : undefined}
          data-expert-chip={chip.kind === "expert" ? chip.id : undefined}
          data-connector-chip={chip.kind === "connector" ? chip.id : undefined}
          data-project-id={chip.kind === "project" ? chip.id : undefined}
          data-attachment-name={chip.kind === "attachment" ? chip.label : undefined}
          data-composer-draft-chip={chip.kind === "object" ? chip.id : undefined}
        >
          <span>{chipLabel(chip)}</span>
          <button
            type="button"
            className="chip-x"
            aria-label={`移除 ${chipLabel(chip)}`}
            onClick={() => onRemove(chip, index)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function chipLabel(chip: ComposerChip): string {
  if (chip.kind === "kb") return `库 · ${chip.label}`;
  if (chip.kind === "expert") return `岗 · ${chip.label}`;
  if (chip.kind === "connector") return `连 · ${chip.label}`;
  return chip.label;
}
