import { MAIL_ANALYZE_PREFILL_PREFIX } from "./types";

export const COMPOSER_DRAFT_KEY = "composer:mail-draft";

export type ComposerDraftChip = { id: string; label: string };

export type ComposerDraft =
  | {
      kind: "mail-reply";
      text: string;
      mailbox: string;
      conversation_id: string;
      peer: string;
      subject: string;
      chips: ComposerDraftChip[];
    }
  | {
      kind: "kol-analyze-enqueue";
      text: string;
      kol_uids: string[];
      chips: ComposerDraftChip[];
    };

export function stashComposerDraft(draft: ComposerDraft): ComposerDraft {
  try {
    sessionStorage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota / private mode */
  }
  return draft;
}

export function peekComposerDraft(): ComposerDraft | null {
  try {
    const raw = sessionStorage.getItem(COMPOSER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ComposerDraft;
    if (parsed?.kind === "mail-reply" || parsed?.kind === "kol-analyze-enqueue") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function clearComposerDraft() {
  try {
    sessionStorage.removeItem(COMPOSER_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function mailReplyDraft(input: {
  mailbox: string;
  conversation_id: string;
  peer: string;
  subject: string;
}): ComposerDraft {
  const subject = input.subject || "(无主题)";
  const chips: ComposerDraftChip[] = [
    { id: "mailbox", label: input.mailbox || "邮箱未绑定" },
    { id: "conversation_id", label: input.conversation_id || "无会话" },
    { id: "peer", label: input.peer || "对方未知" },
    { id: "subject", label: subject },
  ];
  return {
    kind: "mail-reply",
    text: `回复：${subject}`,
    mailbox: input.mailbox,
    conversation_id: input.conversation_id,
    peer: input.peer,
    subject,
    chips,
  };
}

export function mailAnalyzeDraft(input: { people: string[]; peer: string }): ComposerDraft {
  const who = input.people[0] || input.peer || "已选红人";
  return {
    kind: "kol-analyze-enqueue",
    text: `${MAIL_ANALYZE_PREFILL_PREFIX}：${who}\n请根据往来邮件分析下一步，不要发信、不要改阶段。`,
    kol_uids: input.people,
    chips: [
      { id: "analyze", label: "分析入队" },
      { id: "peer", label: who },
    ],
  };
}

export function isAnalyzeEnqueuePrefill(text: string, intent?: string | null): boolean {
  if (intent === "kol-analyze-enqueue") return true;
  return String(text || "").trim().startsWith(MAIL_ANALYZE_PREFILL_PREFIX);
}
