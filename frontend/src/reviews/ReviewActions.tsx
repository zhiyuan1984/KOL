import { useEffect, useRef, useState } from "react";
import type { ReviewCommand } from "../../../shared/review";
import type { InstanceView, ReviewContext } from "./api";
import { ReviewForm } from "./ReviewForm";
export const reviewActionLabels: Record<string, string> = {
  approve: "同意",
  reject: "驳回",
  withdraw: "撤回申请",
  retry: "重新解析",
  transfer: "转交审批",
  countersign: "加签",
  request_amendment: "请求补充材料",
  resubmit: "提交补充材料并重审",
  complete: "完成当前步骤",
};
export function ReviewActions({
  instance: i,
  people,
  reason,
  setReason,
  busy,
  run,
}: {
  instance: InstanceView;
  people: ReviewContext["people"];
  reason: string;
  setReason: (s: string) => void;
  busy: boolean;
  run: (c: ReviewCommand) => void;
}) {
  const [uploadBusy, setUploadBusy] = useState(false);
  const [targets, setTargets] = useState<Record<string, string>>({}),
    [values, setValues] = useState(i.values);
  const [more, setMore] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string>();
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const secondary = ["transfer", "countersign", "request_amendment", "retry"];
  const primary = i.allowedActions.find(a => ["approve", "resubmit", "complete"].includes(a));
  const currentNode = i.definition.nodes.find(node => node.id === i.currentNode);
  const completeLabel = currentNode?.type === "consult" ? "提交意见" : "完成办理";
  const reasonRequired = (action: string) => ["reject", "withdraw", "transfer", "countersign", "request_amendment", "resubmit", "complete"].includes(action);
  const reasonLabel = primary === "complete" ? currentNode?.type === "consult" ? "办理意见（必填）" : "完成说明（必填）" : "处理意见（按所选操作要求填写）";
  useEffect(() => {
    if (selectedAction && reasonRequired(selectedAction)) reasonField.current?.focus();
  }, [selectedAction]);
  return (
    <fieldset className="review-form review-action-form" disabled={busy || uploadBusy}>
      {i.allowedActions.includes("resubmit") && (
        <div className="review-amendment-fields">
          <p>补充要求：{i.amendment?.reason}。提交后重新开始全部评审。</p>
          <ReviewForm
            fields={i.definition.fields.filter((f) =>
              i.amendment?.fields.includes(f.id),
            )}
            values={values}
            onChange={setValues}
            onUploadBusy={setUploadBusy}
          />
        </div>
      )}
      {selectedAction && <label>
        {selectedAction === "complete" ? currentNode?.type === "consult" ? "办理意见（必填）" : "完成说明（必填）" : selectedAction === "reject" ? "驳回原因（必填）" : selectedAction === "withdraw" ? "撤回原因（必填）" : selectedAction === "transfer" ? "转交原因（必填）" : selectedAction === "countersign" ? "加签原因（必填）" : selectedAction === "request_amendment" ? "补充材料要求（必填）" : selectedAction === "resubmit" ? "补充说明（必填）" : "处理意见（可选）"}
        <textarea ref={reasonField} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>}
      {(["transfer", "countersign"] as const)
        .filter((a) => more && i.allowedActions.includes(a))
        .map((action) => (
          <label key={action}>
            {action === "transfer" ? "转交对象" : "加签人员"}
            <select
              value={targets[action] || ""}
              onChange={(e) =>
                setTargets({ ...targets, [action]: e.target.value })
              }
            >
              <option value="">请选择已授权候选人</option>
              {(i.candidates?.[action] || []).map((id) => (
                <option key={id} value={id}>
                  {people.find((p) => p.id === id)?.name || id}
                </option>
              ))}
            </select>
          </label>
        ))}
      <div className="review-toolbar">
        {i.allowedActions.filter(action => more || !secondary.includes(action)).map((action) => (
          <button
            key={action}
            className={((selectedAction === action || (!selectedAction && action === primary)) && !busy) ? "primary" : ""}
            disabled={
              busy ||
              uploadBusy ||
              (selectedAction === action && reasonRequired(action) && !reason.trim()) ||
              (selectedAction === action && ["transfer", "countersign"].includes(action) && !targets[action])
            }
            onClick={() => {
              if (selectedAction !== action) { setSelectedAction(action); if (secondary.includes(action)) setMore(true); return; }
              const base = {
                instanceId: i.id,
                expectedVersion: i.version,
                reason,
              };
              if (action === "resubmit") run({ ...base, action, values });
              else if (action === "transfer" || action === "countersign")
                run({ ...base, action, targetUserId: targets[action] });
              else
                run({
                  ...base,
                  action: action as
                    | "approve"
                    | "reject"
                    | "withdraw"
                    | "retry"
                    | "request_amendment"
                    | "complete",
                });
            }}
          >
            {selectedAction === action ? `确认${action === "complete" ? completeLabel : reviewActionLabels[action]}` : action === "complete" ? completeLabel : reviewActionLabels[action]}
          </button>
        ))}
        {i.allowedActions.some(a => secondary.includes(a)) && <button type="button" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "收起更多操作" : "更多操作"}</button>}
      </div>
    </fieldset>
  );
}
