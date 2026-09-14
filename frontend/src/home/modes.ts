export type HomeMode = "today" | "todo" | "discovery" | "lifecycle";

export const HOME_MODES: HomeMode[] = ["today", "todo", "discovery", "lifecycle"];

const HOME_MODE_ALIASES: Record<string, HomeMode> = {
  today: "today",
  todo: "todo",
  discovery: "discovery",
  lifecycle: "lifecycle",
  ai: "today",
};

export function parseHomeMode(value: string | null): HomeMode {
  if (!value) return "today";
  return HOME_MODE_ALIASES[value] || "today";
}

export function homeModeQuery(next: HomeMode): HomeMode | null {
  return next === "today" ? null : next;
}
