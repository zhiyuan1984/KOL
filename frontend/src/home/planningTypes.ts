/**
 * Frontend mirror of backend/src/host/planning-types.ts.
 * Kept in its own module so todayPlan.ts and homeModel.ts can both import it
 * without a cycle.
 */

/** Planning task types — same list as the backend host. */
export const PLANNING_TASK_TYPES = ["today_plan", "todo_plan", "today_analyze"] as const;

export const PLANNING_TASK_TYPES_SET: ReadonlySet<string> = new Set(PLANNING_TASK_TYPES);
