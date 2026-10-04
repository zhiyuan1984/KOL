import { useState } from "react";
import type { ReviewCommand } from "../../../shared/review";
import { useAdminConfirm } from "../components/ConfirmDialog";
import { prepareReview, reviewApi } from "./api";
const labels = {
  submit: "提交评审",
  publish: "发布流程",
  enable: "启用流程",
  disable: "停用流程",
  approve: "同意",
  reject: "拒绝",
  withdraw: "撤回申请",
  retry: "重试阻塞节点",
  transfer: "转交评审",
  countersign: "加签",
  request_amendment: "请求补充材料",
  resubmit: "提交补充材料并重审",
  complete: "完成办理／提交意见",
};
export function useReviewCommand(after: () => Promise<void>) {
  const confirm = useAdminConfirm(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState("");
  async function run(command: ReviewCommand) {
    setError("");
    setBusy(true);
    try {
      const prepared = await prepareReview(command),
        key = crypto.randomUUID();
      confirm.ask(
        {
          kind: "review-command",
          title: `确认${labels[command.action]}`,
          object: prepared.summary.name,
          scope: "当前组织内的流程参与人",
          ruleVersion: String(prepared.summary.version),
          consequence: prepared.summary.consequence,
          change: "reason" in command ? command.reason : undefined,
          confirmLabel: labels[command.action],
          confirmTone: ["reject", "withdraw"].includes(command.action)
            ? "danger"
            : "primary",
        },
        async () => {
          const r = await reviewApi<{ id: string }>("/approvals/v2/commands", {
            command,
            confirmationId: prepared.confirmationId,
            idempotencyKey: key,
          });
          setReceipt(`已${labels[command.action]} · 回执 ${r.id}`);
          await after();
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return {
    run,
    error,
    busy: busy || confirm.open,
    receipt,
    dialog: confirm.dialog,
  };
}
