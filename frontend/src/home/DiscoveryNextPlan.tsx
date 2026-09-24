import type { HomeDiscoveryEmptyKind, HomeDiscoveryRun } from "./discoveryHome";

type FailureView = {
  title: string;
  message: string;
  checkConnection?: boolean;
} | null;

type PlanItem = {
  id: string;
  title: string;
  detail: string;
  actionLabel?: string;
  action?: () => void;
};

function buildPlan(input: {
  run: HomeDiscoveryRun | null;
  visibleCount: number;
  selectedCount: number;
  inFlight: boolean;
  failure: FailureView;
  emptyKind: HomeDiscoveryEmptyKind;
  runHistoryCount: number;
  onEditConditions: () => void;
  onRetry: () => void;
  onCheckConnection: () => void;
  onOpenIngest: () => void;
}): PlanItem[] {
  if (input.failure) {
    const items: PlanItem[] = [{
      id: "retry",
      title: "重新运行发现任务",
      detail: "本次运行未完成；重试会沿用当前发现条件。",
      actionLabel: "重试",
      action: input.onRetry,
    }];
    if (input.failure.checkConnection) {
      items.push({
        id: "connection",
        title: "检查采集服务",
        detail: "确认采集连接后再重试，避免重复提交无效任务。",
        actionLabel: "检查连接",
        action: input.onCheckConnection,
      });
    }
    return items;
  }
  if (input.emptyKind === "down") {
    return [{
      id: "connection",
      title: "检查采集服务",
      detail: "发现结果暂不可读取；先恢复连接，再继续查看或提交条件。",
      actionLabel: "检查连接",
      action: input.onCheckConnection,
    }];
  }
  if (input.inFlight) {
    return [{
      id: "wait",
      title: "等待本轮检索完成",
      detail: "AI 正在处理已确认条件；完成后会按匹配度排序结果。",
    }];
  }
  if (input.selectedCount > 0) {
    return [{
      id: "ingest",
      title: `确认入库 ${input.selectedCount} 条线索`,
      detail: "入库将进入公海；不会自动建联、发信、改阶段或领取跟进。",
      actionLabel: "进入确认",
      action: input.onOpenIngest,
    }];
  }
  if (input.visibleCount > 0) {
    const items: PlanItem[] = [{
      id: "select",
      title: "核对线索后选择入库对象",
      detail: "优先查看推荐分、置信度、匹配理由与来源链接，再勾选需要保留的线索。",
    }];
    if (input.runHistoryCount > 1) {
      items.push({
        id: "history",
        title: "复核历史发现结果",
        detail: `当前保留 ${input.runHistoryCount - 1} 次历史运行，可比较不同条件下的候选。`,
      });
    }
    return items;
  }
  if (input.run && input.emptyKind === "filtered") {
    return [{
      id: "conditions",
      title: "调整发现条件后重试",
      detail: "本轮没有入围线索；可放宽平台、地区、关键词或指标阈值。",
      actionLabel: "改条件",
      action: input.onEditConditions,
    }];
  }
  return [{
    id: "start",
    title: "设置条件并开始发现",
    detail: "先确认平台、地区、方向和指标阈值；提交后 AI 会展示过程与可复核结果。",
    actionLabel: "查看条件",
    action: input.onEditConditions,
  }];
}

/**
 * A compact, deterministic next-plan layer. It turns existing run and result
 * states into visible next actions without executing any business write.
 */
export default function DiscoveryNextPlan({
  run,
  visibleCount,
  selectedCount,
  inFlight,
  failure,
  emptyKind,
  runHistoryCount,
  onEditConditions,
  onRetry,
  onCheckConnection,
  onOpenIngest,
}: {
  run: HomeDiscoveryRun | null;
  visibleCount: number;
  selectedCount: number;
  inFlight: boolean;
  failure: FailureView;
  emptyKind: HomeDiscoveryEmptyKind;
  runHistoryCount: number;
  onEditConditions: () => void;
  onRetry: () => void;
  onCheckConnection: () => void;
  onOpenIngest: () => void;
}) {
  const items = buildPlan({
    run,
    visibleCount,
    selectedCount,
    inFlight,
    failure,
    emptyKind,
    runHistoryCount,
    onEditConditions,
    onRetry,
    onCheckConnection,
    onOpenIngest,
  });

  return (
    <section className="discovery-next-plan" data-discovery-next-plan aria-label="下一步计划">
      <h3>下一步计划</h3>
      <ol>
        {items.map((item) => (
          <li key={item.id} data-discovery-plan={item.id}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
            {item.actionLabel && item.action ? (
              <button type="button" className="btn ghost sm" onClick={item.action}>
                {item.actionLabel}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
