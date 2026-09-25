import { useRef, useState } from "react";
import { api } from "../api";
import { draftSendConfirm } from "../adminConfirm";
import { useAdminConfirm } from "../components/ConfirmDialog";

/** Save -> current server snapshot -> human confirmation -> same version/request id. */
export function useConfirmedDraftSend(onRefresh?: () => void) {
  const { ask, dialog, open } = useAdminConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preparing = useRef(false);
  const attempt = useRef<{ draftId: string; version: string; requestId: string } | null>(null);

  const requestSend = async (draftId: string, save?: () => Promise<void>) => {
    if (!draftId || preparing.current || open) return;
    preparing.current = true;
    setBusy(true);
    setError("");
    try {
      if (save) await save();
      const view = await api.draftActions(draftId);
      const version = view.action.confirmation_version;
      if (!view.action.enabled || !version) throw new Error(view.action.disabled_reason || "此草稿当前不能发送，请核对最新结果。");
      if (attempt.current?.draftId !== draftId || attempt.current.version !== version) {
        attempt.current = { draftId, version, requestId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("") };
      }
      const confirmed = { ...attempt.current };
      ask(draftSendConfirm(view.snapshot), async () => {
        setBusy(true);
        try {
          await api.sendDraft(confirmed.draftId, { confirmation_version: confirmed.version, request_id: confirmed.requestId });
          onRefresh?.();
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "发送结果待核实，请检查当前回执。";
          setError(message);
          onRefresh?.();
          throw cause;
        } finally {
          setBusy(false);
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法准备发送确认");
      onRefresh?.();
    } finally {
      preparing.current = false;
      setBusy(false);
    }
  };
  return { requestSend, dialog, busy: busy || open, error };
}
