import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type ComposeInput,
  type EmailComposePrepareRequest,
  type EmailComposePrepareResponse,
} from "../api";
import type { ComposerObjectRef } from "../composer/types";

export type MailComposePhase = "idle" | "preparing" | "editing" | "submitting" | "result_ready" | "failed";

export type MailComposeView = {
  active: boolean;
  phase: MailComposePhase;
  from: string;
  to: string[];
  subject: string;
  collaborationId?: string;
  knowledgeId?: string;
  knowledgeVersion?: number;
  contextVersion?: string;
  templateTitle?: string;
  templateSource?: string;
  candidates: EmailComposePrepareResponse["candidates"];
  missingFields: string[];
  message?: string;
  preparedPendingApply: boolean;
  onSubjectChange: (subject: string) => void;
  onApplyPrepared: () => void;
  onSelectCandidate: (knowledgeId: string) => void;
  onContextChange: (collaborationId: string | undefined, body: string) => void;
};

type PrepareInput = Omit<EmailComposePrepareRequest, "skill_id"> & {
  body: string;
  object_refs?: ComposerObjectRef[];
};

type PreparedEditor = NonNullable<EmailComposePrepareResponse["editor"]>;

/**
 * Shared L2 mail-draft preparation state for Home and session composers.
 * The server decides applicability; the browser only preserves edits and
 * discards responses that are no longer current for the selected context.
 */
export function useMailComposeFlow({
  onApplyBody,
  onPrepared,
}: {
  onApplyBody: (body: string) => void;
  onPrepared?: (response: EmailComposePrepareResponse) => void;
}) {
  const [phase, setPhase] = useState<MailComposePhase>("idle");
  const [subject, setSubject] = useState("");
  const [prepared, setPrepared] = useState<EmailComposePrepareResponse | null>(null);
  const [pendingEditor, setPendingEditor] = useState<PreparedEditor | null>(null);
  const [message, setMessage] = useState("");
  const [isActive, setIsActive] = useState(false);
  const requestSequence = useRef(0);
  const editRevision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const activeRef = useRef(false);
  const lastPrepareInput = useRef<PrepareInput | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const applyEditor = useCallback((editor: PreparedEditor, response: EmailComposePrepareResponse) => {
    onApplyBody(editor.body || "");
    setSubject(editor.subject || "");
    editRevision.current += 1;
    setPendingEditor(null);
    setPrepared(response);
    setMessage(response.message || "已准备邮件草稿，可继续编辑。");
    setPhase("editing");
    onPrepared?.(response);
  }, [onApplyBody, onPrepared]);

  const prepare = useCallback(async (input: PrepareInput) => {
    lastPrepareInput.current = input;
    const sequence = ++requestSequence.current;
    const revisionAtStart = editRevision.current;
    activeRef.current = true;
    setIsActive(true);
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setPhase("preparing");
    setMessage("正在核对合作上下文和已发布模板…");
    setPrepared(null);
    setPendingEditor(null);

    try {
      const response = await api.prepareEmailCompose({
        skill_id: "email_compose",
        session_id: input.session_id,
        collaboration_id: input.collaboration_id,
        handle: input.handle,
        knowledge_id: input.knowledge_id,
        scene_hint: input.scene_hint,
        variables: input.variables,
        object_refs: input.object_refs,
      }, nextController.signal);
      if (sequence !== requestSequence.current || nextController.signal.aborted || !activeRef.current) return response;

      setPrepared(response);
      const editor = response.editor;
      if (editor && (response.status === "ready" || response.status === "needs_fields")) {
        // A user may have typed while the deterministic prepare request was in
        // flight. Keep that body authoritative and offer an explicit apply.
        if (editRevision.current === revisionAtStart && !input.body.trim()) {
          applyEditor(editor, response);
        } else {
          setPendingEditor(editor);
          setSubject((current) => current || editor.subject || "");
          setMessage(response.message || "新模板已准备；你的已编辑正文未被覆盖。");
          setPhase("editing");
          onPrepared?.(response);
        }
      } else {
        setMessage(response.message || "请补充邮件所需信息后继续。");
        setPhase("editing");
        onPrepared?.(response);
      }
      return response;
    } catch (error) {
      if (nextController.signal.aborted || sequence !== requestSequence.current) return null;
      setPhase("editing");
      setMessage(error instanceof Error ? error.message : "暂时无法准备邮件模板，可重试。");
      return null;
    }
  }, [applyEditor, onPrepared]);

  const markEdited = useCallback(() => {
    if (!activeRef.current) return;
    editRevision.current += 1;
    setPhase((current) => current === "submitting" ? current : "editing");
  }, []);

  const applyPrepared = useCallback(() => {
    if (!pendingEditor || !prepared) return;
    applyEditor(pendingEditor, prepared);
  }, [applyEditor, pendingEditor, prepared]);

  const clear = useCallback(() => {
    requestSequence.current += 1;
    controller.current?.abort();
    activeRef.current = false;
    setIsActive(false);
    editRevision.current += 1;
    lastPrepareInput.current = null;
    setPrepared(null);
    setPendingEditor(null);
    setSubject("");
    setMessage("");
    setPhase("idle");
  }, []);

  const composeInput = useCallback((body: string, sourceDraftId?: string | null): ComposeInput | undefined => {
    const currentPrepared = prepared;
    const version = currentPrepared?.template?.published_version;
    if (!activeRef.current || !currentPrepared || version === undefined || !body.trim() || !subject.trim()) return undefined;
    return {
      mode: "edited_draft",
      knowledge_version: version,
      context_version: currentPrepared.context_version,
      subject,
      body,
      variables: {},
      source_draft_id: sourceDraftId || null,
    };
  }, [prepared, subject]);

  const view: MailComposeView = {
    active: isActive,
    phase,
    from: prepared?.editor?.from || "",
    to: prepared?.editor?.to || [],
    subject,
    collaborationId: prepared?.context?.collaboration_id,
    knowledgeId: prepared?.template?.knowledge_id,
    knowledgeVersion: prepared?.template?.published_version,
    contextVersion: prepared?.context_version,
    templateTitle: prepared?.template?.title,
    templateSource: prepared?.template?.source,
    candidates: prepared?.candidates || [],
    missingFields: prepared?.missing_fields || [],
    message,
    preparedPendingApply: Boolean(pendingEditor),
    onSubjectChange: (next) => {
      activeRef.current = true;
      setIsActive(true);
      editRevision.current += 1;
      setSubject(next);
      setPhase((current) => current === "submitting" ? current : "editing");
    },
    onApplyPrepared: applyPrepared,
    onContextChange: (collaborationId, body) => {
      const previous = lastPrepareInput.current;
      if (!previous || !activeRef.current) return;
      void prepare({ ...previous, collaboration_id: collaborationId, handle: undefined, object_refs: [], knowledge_id: undefined, body });
    },
    onSelectCandidate: (knowledgeId) => {
      const previous = lastPrepareInput.current;
      if (!previous || !knowledgeId) return;
      void prepare({ ...previous, knowledge_id: knowledgeId });
    },
  };

  return {
    ...view,
    prepare,
    markEdited,
    clear,
    composeInput,
    markSubmitting: () => setPhase("submitting"),
    markReady: () => setPhase("result_ready"),
    markFailed: (detail?: string) => {
      setPhase("failed");
      if (detail) setMessage(detail);
    },
  };
}

export type MailComposeFlow = ReturnType<typeof useMailComposeFlow>;
