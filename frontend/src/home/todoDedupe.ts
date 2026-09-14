import type { RecommendedTask, Task } from "../api";

function norm(value: unknown): string {
  return String(value || "").replace(/^@/, "").trim().toLowerCase();
}

export type SuggestionIdentity = {
  id?: string;
  title?: string;
  handle?: string;
  intent?: string;
  collaboration_id?: string | null;
};

export function suggestionDedupeKey(item: SuggestionIdentity): string {
  return [
    norm(item.intent),
    norm(item.handle) || norm(item.collaboration_id),
    norm(item.title),
  ].join("|");
}

export function todoDedupeKey(task: Task): string {
  return suggestionDedupeKey({
    title: task.title,
    handle: task.kol_name,
    intent: String(task.skill_id || task.skill || task.task_type || ""),
    collaboration_id: task.collaboration_id,
  });
}

export function findDuplicateTodo(todos: Task[], suggestion: SuggestionIdentity): Task | undefined {
  const key = suggestionDedupeKey(suggestion);
  const title = norm(suggestion.title);
  const handle = norm(suggestion.handle) || norm(suggestion.collaboration_id);
  const intent = norm(suggestion.intent);
  const recId = norm(suggestion.id);
  return todos.find((task) => {
    const entities = task.entities && typeof task.entities === "object"
      ? task.entities as Record<string, unknown>
      : {};
    if (recId && (norm(task.id) === recId || norm(entities.recommendation_id) === recId)) return true;
    if (todoDedupeKey(task) === key && title) return true;
    if (!title || norm(task.title) !== title) return false;
    const taskHandle = norm(task.kol_name) || norm(task.collaboration_id);
    if (handle && taskHandle) return handle === taskHandle;
    if (handle !== taskHandle) return false;
    const taskIntent = norm(task.skill_id || task.skill || task.task_type);
    if (intent && taskIntent) return intent === taskIntent;
    return true;
  });
}

export function recommendationIdentity(item: RecommendedTask): SuggestionIdentity {
  return {
    id: item.id,
    title: item.title,
    handle: item.handle,
    intent: item.intent,
    collaboration_id: item.collaboration_id,
  };
}
