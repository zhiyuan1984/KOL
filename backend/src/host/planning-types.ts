/** Plan scope: today = 今日规划, todo = 待办规划. Same pipeline, different input catalog. */
export type PlanScope = "today" | "todo";

export const PLAN_SCOPES: readonly PlanScope[] = ["today", "todo"];

export interface ScopeConfig {
  scope: PlanScope;
  taskType: "today_plan" | "todo_plan";
  briefPointerTable: "employee_today_briefs" | "employee_todo_briefs";
  memoryKindCover: "task_cover" | "todo_cover";
  memoryKindResult: "task_result" | "todo_result";
}

export const SCOPE_TABLE: Record<PlanScope, ScopeConfig> = {
  today: {
    scope: "today",
    taskType: "today_plan",
    briefPointerTable: "employee_today_briefs",
    memoryKindCover: "task_cover",
    memoryKindResult: "task_result",
  },
  todo: {
    scope: "todo",
    taskType: "todo_plan",
    briefPointerTable: "employee_todo_briefs",
    memoryKindCover: "todo_cover",
    memoryKindResult: "todo_result",
  },
};

export const PLANNING_TASK_TYPES = ["today_plan", "todo_plan", "today_analyze"] as const;
export const PLANNING_TASK_TYPES_SET = new Set<string>(PLANNING_TASK_TYPES);

export function planTaskType(scope: PlanScope): "today_plan" | "todo_plan" {
  return SCOPE_TABLE[scope].taskType;
}

export function briefPointerTable(scope: PlanScope): "employee_today_briefs" | "employee_todo_briefs" {
  return SCOPE_TABLE[scope].briefPointerTable;
}
