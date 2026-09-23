import { useState } from "react";
import type { RegisteredActionView, TaskRecommendationView } from "./result-contract";

/** Recommendations are proposals; only registered Host actions can be invoked. */
export default function NextActionBar({
  recommendations = [],
  actions = [],
  onAdopt,
  onAction,
}: {
  recommendations?: TaskRecommendationView[];
  actions?: RegisteredActionView[];
  onAdopt?: (recommendation: TaskRecommendationView) => void;
  onAction?: (action: RegisteredActionView) => void;
}) {
  const [confirmingAction, setConfirmingAction] = useState<string | null>(null);
  if (!recommendations.length && !actions.length) return null;
  return <section className="next-action-bar" aria-label="下一步">
    {recommendations.map((recommendation) => <article key={recommendation.id} className="next-action-recommendation"
      data-recommendation-status={recommendation.status}>
      <div><strong>{recommendation.title}</strong>{recommendation.reason ? <p>{recommendation.reason}</p> : null}</div>
      {recommendation.status === "candidate" && onAdopt ? <button type="button" className="btn ghost sm"
        onClick={() => onAdopt(recommendation)}>采纳为待办</button> : null}
      {recommendation.status !== "candidate" ? <span>{recommendation.status === "adopted" ? "已采纳" : "已忽略"}</span> : null}
    </article>)}
    {actions.map((action) => {
      const confirmationRequired = action.confirmation_required || action.risk_level === "L3";
      const missingConfirmationSnapshot = Boolean(confirmationRequired && !action.confirmation_version);
      const confirmationKey = `${action.action_id}:${action.confirmation_version || "unversioned"}`;
      const stateLabel = action.state === "awaiting_selection" ? "请先选择对象"
        : action.state === "awaiting_approval" ? "等待审批"
          : action.state === "completed" ? (action.receipt_id ? `回执 ${action.receipt_id}` : "操作已完成")
            : undefined;
      const disabledReason = action.disabled_reason || stateLabel || (!action.allowed ? "当前无权执行"
        : !action.enabled ? "当前条件不满足"
          : missingConfirmationSnapshot ? "确认信息已失效，请重新准备操作"
            : !onAction ? "操作入口暂不可用" : undefined);
      const disabled = !action.allowed || !action.enabled || !onAction || missingConfirmationSnapshot;
      const confirming = confirmingAction === confirmationKey;
      return <div className="next-action-registered" key={action.action_id}
        data-registered-action={action.action_id} data-action-allowed={action.allowed} data-action-state={action.state}>
        <button type="button" className="btn ghost sm" disabled={disabled}
          title={disabled ? disabledReason : undefined}
          aria-label={confirmationRequired && confirming ? `确认并执行：${action.label}` : action.label}
          onClick={() => {
            if (confirmationRequired && !confirming) {
              setConfirmingAction(confirmationKey);
              return;
            }
            setConfirmingAction(null);
            onAction?.(action);
          }}>{confirmationRequired && confirming ? "确认并执行" : action.label}</button>
        {confirmationRequired && confirming ? <button type="button" className="btn ghost sm"
          onClick={() => setConfirmingAction(null)}>取消</button> : null}
        {disabled ? <span>{disabledReason}</span> : null}
        {action.state === "awaiting_selection" ? <span>请先选择对象</span> : null}
        {action.risk_level === "L2" ? <span>草稿操作</span> : null}
        {confirmationRequired ? <span>{confirming ? "请再次确认此操作" : "需要确认"}</span> : null}
        {action.state === "awaiting_approval" ? <span>等待审批</span> : null}
        {action.approval_state === "rejected" ? <span>审批未通过</span> : null}
        {action.receipt_id ? <span>回执 {action.receipt_id}</span> : null}
      </div>;
    })}
  </section>;
}
