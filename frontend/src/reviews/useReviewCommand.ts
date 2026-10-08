import { useState, useRef } from "react";
import type { ReviewCommand } from "../../../shared/review";
import { useAdminConfirm } from "../components/ConfirmDialog";
import { prepareReview, reviewApi, ReviewApiError } from "./api";
import { randomUuid } from "../uuid";
const labels = {
  submit: "提交审批",
  publish: "发布流程",
  enable: "启用流程",
  disable: "停用流程",
  approve: "同意",
  reject: "驳回",
  withdraw: "撤回申请",
  retry: "重试阻塞节点",
  transfer: "转交审批",
  countersign: "加签",
  request_amendment: "请求补充材料",
  resubmit: "提交补充材料并重审",
  complete: "完成办理／提交意见",
};
export function useReviewCommand(after: (receipt: { id: string; resourceId: string }, action: ReviewCommand["action"]) => Promise<string | void>) {
  const confirm = useAdminConfirm(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState("");
  const preparing = useRef(false);
  async function run(command: ReviewCommand) {
    if (preparing.current || confirm.open) return;
    preparing.current = true;
    setError("");
    setBusy(true);
    try {
      const prepared = await prepareReview(command),
        key = randomUuid();
      confirm.ask(
        {
          kind: "review-command",
          title: `确认${labels[command.action]}`,
          object: prepared.summary.name,
          scope: prepared.summary.scope || "当前组织内的流程参与人",
          ruleVersion: String(prepared.summary.version),
          consequence: prepared.summary.consequence,
          note: "R3 · 确认后正式写入，并保存操作回执。",
          change: [prepared.summary.configuration, prepared.summary.reviewers?.length ? `本次处理人：${prepared.summary.reviewers.join("、")}` : "", "reason" in command ? command.reason : ""].filter(Boolean).join("\n"),
          confirmLabel: labels[command.action],
          confirmTone: ["reject", "withdraw"].includes(command.action)
            ? "danger"
            : "primary",
        },
        async () => {
          const r = await reviewApi<{ id: string; resourceId: string }>("/approvals/v2/commands", {
            command,
            confirmationId: prepared.confirmationId,
            idempotencyKey: key,
          });
          setReceipt(`已${labels[command.action]} · 回执 ${r.id}`);
          const outcome = await after(r, command.action);
          if (outcome) setReceipt(`已${labels[command.action]} · ${outcome} · 回执 ${r.id}`);
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ReviewApiError && command.action === "submit") {
        const field = e.issues[0]?.path.replace(/^values\./, "");
        if (field) {
          const group = document.querySelector(`[data-review-field="${CSS.escape(field)}"]`);
          const control = group instanceof HTMLInputElement ? group : group?.querySelector<HTMLElement>("input,select,textarea");
          control?.focus();
          control?.scrollIntoView({ block: "nearest" });
        }
      }
    } finally {
      preparing.current = false;
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
