type TaskDetail = {
  status?: unknown;
  artifacts?: unknown;
  runs?: unknown;
};

/** Wait for Host's persisted terminal receipt; an initial message response only acknowledges dispatch. */
export async function waitForTaskResultCard(
  read: () => Promise<TaskDetail>,
  timeoutMs = 5000,
): Promise<TaskDetail> {
  const deadline = Date.now() + timeoutMs;
  let latest: TaskDetail = {};
  while (Date.now() < deadline) {
    latest = await read();
    const hasCard = Array.isArray(latest.artifacts)
      && latest.artifacts.some((artifact) => artifact && typeof artifact === "object"
        && (artifact as { artifact_type?: unknown }).artifact_type === "task_result_card");
    const completedRun = Array.isArray(latest.runs)
      && latest.runs.some((run) => run && typeof run === "object"
        && (run as { status?: unknown }).status === "completed");
    if (completedRun && hasCard)
      return latest;
    if (["failed", "cancelled"].includes(String(latest.status)))
      throw new Error(`任务在结果卡持久化前终止：${String(latest.status)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`等待任务结果卡超时；最后状态：${String(latest.status || "unknown")}`);
}
