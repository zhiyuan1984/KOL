import {
  COMPOSER_DRAFT_EVENT,
  COMPOSER_DRAFT_STASH,
  type ComposerDraftStash,
} from "./types";

export type { ComposerDraftStash } from "./types";

export function stashComposerDraft(draft: ComposerDraftStash): ComposerDraftStash {
  const payload: ComposerDraftStash = {
    text: draft.text || "",
    intent: draft.intent,
    chips: draft.chips || [],
    attachments: draft.attachments,
    scope: draft.scope,
    object_refs: draft.object_refs || [],
    client_entry: draft.client_entry,
    model_tier: draft.model_tier,
  };
  try {
    sessionStorage.setItem(COMPOSER_DRAFT_STASH, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
  return payload;
}

export function peekComposerDraft(): ComposerDraftStash | null {
  try {
    const raw = sessionStorage.getItem(COMPOSER_DRAFT_STASH);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ComposerDraftStash;
    if (!parsed || typeof parsed.text !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function takeComposerDraftStash(): ComposerDraftStash | null {
  const draft = peekComposerDraft();
  try {
    sessionStorage.removeItem(COMPOSER_DRAFT_STASH);
  } catch {
    /* ignore */
  }
  return draft;
}

export function applyComposerDraft(draft: ComposerDraftStash): ComposerDraftStash {
  const stored = stashComposerDraft(draft);
  window.dispatchEvent(new CustomEvent(COMPOSER_DRAFT_EVENT, { detail: stored }));
  return stored;
}
