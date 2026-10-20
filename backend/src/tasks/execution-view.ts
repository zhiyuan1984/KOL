/** Read-only projection; task completion is written by the execution backend. */
export function taskExecutionView(taskStatus: string, sideEffects: string | undefined, latestRun?: { id: unknown; status: unknown } | null) {
  if (!latestRun) return null;
  const status = String(latestRun.status);
  return {
    run_id: String(latestRun.id),
    status,
    result_ready: ["waiting", "completed"].includes(taskStatus) && status === "completed" && sideEffects === "none",
  };
}
