/** Date split for Today vs Todo. Constitution does not encode this. */

function dayDiff(value?: string | null, now = new Date()): number | null {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = new Date(due);
  day.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - start.getTime()) / 86_400_000);
}

export function isTodayScheduled(task: { due_at?: string | null; start_at?: string | null }): boolean {
  const start = String(task.start_at || "").trim();
  const due = String(task.due_at || "").trim();
  if (!start && !due) return true;
  if (!due) return true;
  const diff = dayDiff(due);
  return diff == null || diff <= 0;
}
