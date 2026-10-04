import type { Json } from "../types.js";

/** Display a durable receipt rather than an earlier model prediction. No lifecycle writes. */
export function runtimeActionProgress(action: { state: string; error_code: string | null }, crawl: Json | null, execution: Json | null): Json {
  let state = action.state;
  if (state === "succeeded" && crawl) state = String(crawl.state);
  if (state === "pending" && execution) state = String(execution.status);
  if (state === "dispatching") state = "starting";
  const busy = action.state === "rejected" && action.error_code === "runtime_probe_crawl_busy";
  const timeout = crawl?.error_code === "runtime_crawl_timeout";
  const labels: Record<string, string> = { pending: "待确认", queued: "已确认，等待执行", retrying: "已确认，等待执行",
    running: "执行中", starting: "正在启动", stopping: "正在停止", succeeded: crawl ? "采集已结束" : "操作已执行",
    failed: "执行失败", rejected: "未执行", uncertain: "结果待核实", cancelled: "已取消" };
  const label = busy ? "采集未启动 · 已有任务占用" : timeout ? "采集超时" : labels[state] || "状态待核实";
  const summaries: Record<string, string> = {
    pending: "采集请求尚未确认。请在确认卡核对实际参数。",
    queued: "确认已收到，正在等待后台执行。无需重复确认。",
    retrying: "确认已收到，后台执行尚未取得回执。无需重复确认。",
    running: crawl ? "已取得采集编号，后台正在监控本次采集。" : "确认已收到，正在提交采集请求。",
    starting: "正在提交采集请求，等待远端回执。不要重复提交。",
    stopping: "停止请求已提交，正在核对终态。",
    succeeded: crawl ? "本次采集已结束，候选读取状态见发现候选。" : "已取得真实执行回执。",
    failed: "执行失败，请核对原因后重新提出动作。",
    rejected: "本次请求被拒绝，远端未执行。请核对原因后重新提出动作。",
    uncertain: "尚不能确认远端结果。请核对已有任务和回执，不要重新启动。",
    cancelled: "本次动作已取消；已取得的回执和候选仍保留。",
  };
  const summary = busy ? "此前采集仍占用采集服务，本次启动未执行。请先核对已有任务的终态，再重新核对并确认启动。"
    : timeout ? "采集服务已返回本任务超时回执，本次采集失败。可重新核对范围并提出新的待确认请求。"
    : summaries[state] || "执行状态暂时无法核验，请刷新核对回执。";
  const taskId = crawl?.remote_task_id;
  return { state, label, summary, replace_result: action.state !== "pending" || Boolean(execution),
    result: { type: "task_result", title: label, summary, sections: taskId
      ? [{ title: "采集回执", body: `采集编号：${String(taskId)}`, items: [] }] : [], metrics: [], recommended_actions: [] } };
}

export function canRetryRuntimeCrawl(action: { state: string; error_code: string | null }, crawl: Json | null): boolean {
  return Boolean(crawl && ["failed", "cancelled"].includes(String(crawl.state)))
    || (!crawl && action.state === "rejected" && action.error_code === "runtime_probe_crawl_busy");
}
