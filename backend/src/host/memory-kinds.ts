/** Two employee memories. They update independently and must not upsert each other.
 *
 * task            = formal work_items (source != planning)
 * task_result     = Codex/host artifacts such as today_brief
 */
export const TASK_MEMORY = "task" as const;
export const TASK_RESULT_MEMORY = "task_result" as const;

export type EmployeeMemoryKind = typeof TASK_MEMORY | typeof TASK_RESULT_MEMORY;

export const TASK_MEMORY_READ = {
  memory_kind: TASK_MEMORY,
  entry: "memory",
  kind: "memory",
  creates_session: false,
  calls_model: false,
} as const;

export const TASK_RESULT_MEMORY_READ = {
  memory_kind: TASK_RESULT_MEMORY,
  entry: "memory",
  kind: "memory",
  creates_session: false,
  calls_model: false,
} as const;
