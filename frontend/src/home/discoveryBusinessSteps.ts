import type { HomeDiscoveryRun } from "./discoveryHome";
import type { DiscoveryProcessStep } from "./discoveryEvents";
import { directionLabel, platformLabel, regionLabel } from "./discoveryTemplate";

export type DiscoveryBusinessStep = {
  id: "conditions" | "collection" | "filtering" | "brief" | "terminal";
  title: string;
  detail: string;
  time?: string;
  state: "done" | "running" | "failed" | "stopped";
};

function clock(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function number(value: unknown): string | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? new Intl.NumberFormat("zh-CN").format(parsed) : null;
}

function conditionDetail(run: HomeDiscoveryRun): string {
  const snapshot = run.status_contract?.condition_snapshot || {};
  const platforms = Array.isArray(snapshot.platforms) ? snapshot.platforms.map((code) => platformLabel(String(code))).join("、") : "";
  const keywords = Array.isArray(snapshot.keywords) ? snapshot.keywords.map(String).filter(Boolean).join("、") : "";
  const directions = Array.isArray(snapshot.directions) ? snapshot.directions.map((code) => directionLabel(String(code))).join("、") : "";
  const region = snapshot.region ? regionLabel(String(snapshot.region)) : "";
  const followers = number(snapshot.min_followers) != null && number(snapshot.max_followers) != null
    ? `粉丝 ${number(snapshot.min_followers)}–${number(snapshot.max_followers)}` : "";
  const views = number(snapshot.min_avg_views_10) != null ? `近10均播 ≥${number(snapshot.min_avg_views_10)}` : "";
  return [platforms, region, keywords && `关键词 ${keywords}`, directions && `方向 ${directions}`, followers, views]
    .filter(Boolean).join(" · ") || "条件已保存；该运行未提供筛选快照。";
}

/**
 * Visible milestones use only persisted run facts and collector events. Missing
 * fields remain unknown; the Host's first-pass shortlist includes metrics_missing
 * candidates and is not a claim that every candidate met every threshold.
 */
export function discoveryBusinessSteps(
  run: HomeDiscoveryRun | null,
  steps: DiscoveryProcessStep[],
  inFlight: boolean,
  reviewCount = 0,
): DiscoveryBusinessStep[] {
  if (!run) return [];
  const first = (...kinds: DiscoveryProcessStep["kind"][]) => steps.find((step) => kinds.includes(step.kind));
  const confirmed = first("conditions");
  const started = first("collecting", "search", "received");
  const filtered = first("filtered");
  const briefStarted = first("briefing", "scoring");
  const ranked = first("ranked");
  const stopped = first("stopped") || (run.status === "cancelled" ? { time: clock(run.completed_at) } : undefined);
  const failed = first("failed") || (["crawl_failed", "rank_failed", "failed"].includes(run.status)
    ? { time: clock(run.completed_at) } : undefined);
  const settled = Boolean(filtered || ["ranking", "rank_failed", "completed", "succeeded"].includes(run.status));
  const persistedCount = number(run.status_contract?.progress.collected) ?? number(run.raw_count);
  const lastProgress = [...steps].reverse().find((step) =>
    (step.kind === "collecting" || step.kind === "received") && step.count != null);
  const liveCount = lastProgress?.count;
  const count = inFlight ? number(liveCount) ?? persistedCount : persistedCount ?? number(liveCount);
  const matched = number(run.status_contract?.progress.matched) ?? number(run.shortlist_count);
  const result: DiscoveryBusinessStep[] = [{
    id: "conditions", title: "确认检索条件", detail: conditionDetail(run),
    time: confirmed?.time || clock(run.created_at), state: "done",
  }];
  if (run.started_at || started) {
    const state = stopped ? "stopped" : failed && !settled ? "failed" : settled ? "done" : "running";
    result.push({
      id: "collection",
      title: state === "failed" ? "采集未完成" : state === "stopped" ? "采集已停止"
        : state === "running" ? count != null ? `正在采集 · 已见 ${count} 条` : "正在采集候选"
          : persistedCount != null ? `采集候选 · ${persistedCount} 条` : "采集已结束",
      detail: state === "running" ? `${started?.time || clock(run.started_at) ? `开始于 ${started?.time || clock(run.started_at)}；` : ""}采集数量随真实进度更新，尚非最终入围数。`
        : state === "failed" || state === "stopped" ? "仅保留已返回的采集进度，未形成已完成的候选池。"
          : persistedCount != null ? `共采集 ${persistedCount} 条原始候选，尚未写入正式红人库。`
            : `采集已结束；${liveCount != null ? `最近一次进度 ${liveCount} 条，` : ""}未提供最终原始总数。`,
      time: state === "running" && lastProgress?.time ? lastProgress.time : started?.time || clock(run.started_at), state,
    });
  }
  if (filtered || (settled && matched != null)) {
    const snapshot = run.status_contract?.condition_snapshot || {};
    const rule = [
      number(snapshot.min_followers) != null && number(snapshot.max_followers) != null
        ? `粉丝 ${number(snapshot.min_followers)}–${number(snapshot.max_followers)}` : null,
      number(snapshot.min_avg_views_10) != null ? `近10均播 ≥${number(snapshot.min_avg_views_10)}` : null,
    ].filter(Boolean).join("、");
    result.push({
      id: "filtering", title: matched != null ? `条件初筛 · ${matched} 位候选` : "按已知条件筛选候选",
      detail: [rule && `已知字段依据：${rule}`, persistedCount != null && matched != null
        ? `原始 ${persistedCount} 条 → 暂留 ${matched} 位` : null,
        reviewCount > 0 ? `当前已加载线索中 ${reviewCount} 位待人工复核` : "缺失指标不视为验证通过"].filter(Boolean).join("；"),
      time: filtered?.time, state: "done",
    });
  }
  const succeeded = run.status === "completed" || run.status === "succeeded";
  if (!failed && !stopped && (ranked || (succeeded && Number(run.shortlist_count) > 0) || (inFlight && briefStarted))) {
    const ready = Boolean(ranked || succeeded);
    result.push({
      id: "brief", title: ready ? "评分与匹配理由已生成" : "正在生成发现简报",
      detail: ready ? "逐条查看推荐分、样本覆盖和匹配证据，再决定是否入库。"
        : "正在根据暂留候选整理评分和证据，尚未完成。",
      time: ranked?.time || briefStarted?.time || (succeeded ? clock(run.completed_at) : undefined),
      state: ready ? "done" : "running",
    });
  }
  if (failed || stopped) {
    result.push({
      id: "terminal", title: stopped ? "任务已停止" : run.status === "rank_failed" ? "简报生成未完成" : "采集未完成",
      detail: "未将该任务标记为成功；可在上方状态摘要中查看原因或重试。",
      time: stopped?.time || failed?.time,
      state: stopped ? "stopped" : "failed",
    });
  }
  return result;
}
