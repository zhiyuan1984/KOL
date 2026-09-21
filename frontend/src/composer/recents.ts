export const RECENT_SKILLS_KEY = "composer:recent-skills";
export const RECENT_SKILLS_EVENT = "composer:recent-skills";
export const RECENT_SKILLS_LIMIT = 5;

export function readRecentSkills(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SKILLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const row of parsed) {
      if (typeof row !== "string") continue;
      const id = row.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(id);
    }
    return rows.slice(0, RECENT_SKILLS_LIMIT);
  } catch {
    return [];
  }
}

export function pushRecentSkill(id: string): string[] {
  const key = id.trim();
  if (!key) return readRecentSkills();
  const next = [key, ...readRecentSkills().filter((row) => row !== key)].slice(0, RECENT_SKILLS_LIMIT);
  try {
    localStorage.setItem(RECENT_SKILLS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new CustomEvent(RECENT_SKILLS_EVENT, { detail: next }));
  return next;
}
