import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { MailLabelsSnapshot, MailLabelMutation } from "./labelTypes.js";
export type { MailLabel, MailLabelsSnapshot, MailLabelMutation } from "./labelTypes.js";

function copyOf(error: unknown): string {
  const status = (error as { status?: number })?.status;
  if (status === 409) return "标签已被另一处更新。已重新读取，请核对后再次确认。";
  if (status === 403 || status === 401) return "已失去此邮箱的标签权限，请重新选择可用邮箱。";
  if (status === 404 || status === 405) return "此邮箱的标签服务暂不可用。未保存标签，可重试读取。";
  return "标签未保存，请检查连接后重试。";
}

/** Private preferences only. A stale mailbox/actor/conversation never owns a receipt. */
export function useMailLabels(actorId: string, mailbox: string, conversationId: string) {
  const scope = `${actorId}\0${mailbox}\0${conversationId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [result, setResult] = useState<{ scope: string; data: MailLabelsSnapshot } | null>(null);
  const [state, setState] = useState<{ scope: string; loading: boolean; saving: boolean; error: string; notice: string }>({ scope, loading: false, saving: false, error: "", notice: "" });

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    if (!actorId || !mailbox) { setResult(null); return; }
    setState({ scope, loading: true, saving: false, error: "", notice: "" });
    try {
      const data = await api.mailLabels(mailbox, conversationId || undefined);
      if (generation.current !== gen || currentScope.current !== scope) return;
      if (data.mailbox.toLowerCase() !== mailbox.toLowerCase()) throw new Error("标签邮箱范围不一致");
      setResult({ scope, data });
      setState({ scope, loading: false, saving: false, error: "", notice: "" });
    } catch (error) {
      if (generation.current !== gen || currentScope.current !== scope) return;
      setResult(null);
      setState({ scope, loading: false, saving: false, error: copyOf(error), notice: "" });
    }
  }, [scope, actorId, mailbox, conversationId]);

  useEffect(() => { inFlight.current = false; void reload(); return () => { generation.current += 1; }; }, [reload]);
  const data = result?.scope === scope ? result.data : null;
  const currentState = state.scope === scope ? state : { loading: Boolean(mailbox), saving: false, error: "", notice: "" };

  const mutate = async (input: Omit<MailLabelMutation, "box" | "conversation_id" | "expected_version" | "confirm">): Promise<boolean> => {
    if (!data || !conversationId || inFlight.current || currentState.loading) return false;
    inFlight.current = true;
    const gen = ++generation.current;
    setState({ scope, loading: false, saving: true, error: "", notice: "" });
    try {
      const receipt = await api.changeMailLabel({ ...input, box: mailbox, conversation_id: conversationId, expected_version: data.version, confirm: true });
      if (currentScope.current !== scope || generation.current !== gen) return false;
      if (!receipt.ok || receipt.mailbox.toLowerCase() !== mailbox.toLowerCase() || receipt.conversation_id !== conversationId) throw new Error("标签回执对象不一致");
      setResult({ scope, data: { ...receipt, selected_label_ids: receipt.label_ids } });
      setState({ scope, loading: false, saving: false, error: "", notice: input.mode === "add" ? "标签已保存。" : "标签已移除。" });
      return true;
    } catch (error) {
      if (currentScope.current !== scope || generation.current !== gen) return false;
      const copy = copyOf(error);
      if ((error as { status?: number })?.status === 409) await reload();
      if (currentScope.current === scope && (generation.current === gen || (error as { status?: number })?.status === 409)) setState({ scope, loading: false, saving: false, error: copy, notice: "" });
      return false;
    } finally { if (currentScope.current === scope) inFlight.current = false; }
  };
  return { data, ...currentState, reload, mutate };
}
