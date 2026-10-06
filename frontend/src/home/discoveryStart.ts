import type { RuntimeActionView } from "../api";

/**
 * 「确认开始采集」的相位（纯函数）。权威状态来自服务端的待确认动作：
 * 前端只在员工点击确认到下一次读取回来之间显示 dispatching（已确认、正在启动），
 * 不伪造执行进度。
 */
export type DiscoveryStartPhase =
  | "waiting_proposal"
  | "pending"
  | "dispatching"
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "rejected"
  | "uncertain"
  | "cancelled";

export function discoveryStartAction(actions: RuntimeActionView[]): RuntimeActionView | null {
  const starts = actions.filter((action) => action.operation === "start_crawl");
  if (!starts.length) return null;
  return starts[starts.length - 1];
}

export function discoveryStartPhase(
  action: RuntimeActionView | null,
  optimistic: boolean,
): DiscoveryStartPhase {
  // 员工刚点确认、服务端回执未回来：立即按「已确认，正在启动」呈现，且不再显示确认按钮。
  if (optimistic && (!action || (String(action.state || "").toLowerCase() === "pending" && !action.execution))) {
    return "dispatching";
  }
  if (!action) return "waiting_proposal";
  const state = String(action.state || "").toLowerCase();
  const execution = action.execution && String(action.execution.status || "").toLowerCase();
  if (state === "pending") {
    if (!action.execution) return "pending";
    return execution === "failed" ? "failed" : "dispatching";
  }
  if (execution === "failed" || state === "failed") return "failed";
  if (state === "queued" || state === "starting") return "starting";
  if (state === "running") return "running";
  if (state === "succeeded") return "succeeded";
  if (state === "rejected") return "rejected";
  if (state === "uncertain") return "uncertain";
  if (state === "cancelled") return "cancelled";
  return "pending";
}

/** 采集任务的独立相位（动作终态之后的远端事实）。 */
export function discoveryCrawlPhase(action: RuntimeActionView | null): string | null {
  const state = action?.crawl && String(action.crawl.state || "").toLowerCase();
  return state || null;
}

export const DISCOVERY_START_COPY: Record<DiscoveryStartPhase, { label: string; detail: string }> = {
  waiting_proposal: {
    label: "正在整理采集范围",
    detail: "线索智能体正在按已提交的条件整理本次采集范围；参数齐备后才出现确认动作。",
  },
  pending: {
    label: "待确认",
    detail: "仅以上参数会提交给采集服务。确认前不会发起任何采集。",
  },
  dispatching: {
    label: "已确认，正在启动",
    detail: "确认已提交；若长时间没有回执，请核对任务状态，不要重复提交。",
  },
  starting: {
    label: "已确认，正在启动",
    detail: "采集请求正在排队启动；可继续在此查看状态。",
  },
  running: {
    label: "正在采集",
    detail: "远端正在按已确认的范围采集公开创作者数据；结果到达后右栏原位更新。",
  },
  succeeded: {
    label: "已取得回执",
    detail: "本次采集已取得回执；候选与来源在右栏，入库是独立动作。",
  },
  failed: {
    label: "执行失败",
    detail: "采集没有成功结束；保留已取得的结果，可核对原因后重试。",
  },
  rejected: {
    label: "未执行",
    detail: "本次确认已取消，未发起采集。",
  },
  uncertain: {
    label: "结果待核实",
    detail: "远端是否已执行无法确认；先核对任务状态，禁止重复提交。",
  },
  cancelled: {
    label: "已取消",
    detail: "采集已取消，仅保留已取得的候选。",
  },
};
