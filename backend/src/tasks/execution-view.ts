/** Presentation of the current run; never completes or authorizes the formal ticket. */
export function taskExecutionView(taskStatus: string, sideEffects: string | undefined, latestRun?: { id: unknown; status: unknown } | null) {
  if (!latestRun) return null;
  const status = String(latestRun.status);
  return {
    run_id: String(latestRun.id),
    status,
    result_ready: taskStatus === "waiting" && status === "completed" && sideEffects === "none",
  };
}
