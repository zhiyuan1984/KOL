import type { ComposerDraftStash } from "../composer/types";
export function mailDraftKey(actor: string, mailbox: string, conversation: string) {
  return `mail-draft:v2:${encodeURIComponent(actor)}:${encodeURIComponent(mailbox.toLowerCase())}:${encodeURIComponent(conversation)}`;
}
export function readLocalMailDraft(key: string): ComposerDraftStash {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) || "null") as ComposerDraftStash | null;
    if (draft && typeof draft.text === "string") return draft;
  } catch { /* storage unavailable: keep the in-memory editor */ }
  return { text: "", chips: [], attachments: [], object_refs: [] };
}
export function writeLocalMailDraft(key: string, draft: ComposerDraftStash) {
  try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch { /* private mode or quota */ }
}
