import {
  COMPOSER_DRAFT_EVENT,
  COMPOSER_DRAFT_STASH,
  type ComposerDraftStash,
} from "./types";

export type { ComposerDraftStash } from "./types";

/**
 * Unified composer drafts (ADR-2026-10-15 (iii)). One module, one entry
 * point, scoped keys — the replacement for the five draft mechanisms that
 * grew side by side:
 * - global stash (`composer_draft_stash` + `composer:apply-draft` event)
 * - mail stash (`composer:mail-draft`, dead: no producer on main)
 * - mail local drafts (`mail-draft:v2:…`, per mailbox + conversation)
 * - knowledge fill stash (`kb_fill_composer`, dead: producer removed)
 * - session workspace drafts (`workspace:asset-draft:…`)
 * - session work drafts (`employee-agent:…:session:…`)
 * - ChatBlocks session drafts (`draft:<sessionId>`)
 *
 * Live keys are preserved byte-for-byte so in-flight drafts survive the
 * migration. Dead keys (`composer:mail-draft`, `kb_fill_composer`) are
 * dropped, never read. Scope — not a separate module — is what keeps a
 * mail draft out of the background workbench composer: broadcasts carry
 * their scope and a dock only applies events for its own scope.
 */
export type ComposerDraftScope = {
  page: "home" | "mail" | "session";
  /** Account id. Part of the mail/session storage keys, not of scope identity. */
  actor?: string;
  mailbox?: string;
  conversationId?: string;
  sessionId?: string;
};

/** Session-page draft handed off from a result card / agent browser. */
export type ComposerDraft = {
  text: string;
  intent?: string;
  title?: string;
};

export type WorkspaceTarget = { sessionId: string; path: string; title: string };
export type WorkspaceDraft = { target: WorkspaceTarget; draft: ComposerDraftStash };
export type SessionWorkDraft = { text: string; intent?: string; title?: string; knowledge_id?: string };

const WORKSPACE_PREFIX = "workspace:asset-draft:";
const LEGACY_SESSION_DRAFT_PREFIX = "draft:";

/** Stable string for React effect deps and scope comparison. */
export function draftScopeKey(scope: ComposerDraftScope): string {
  return JSON.stringify([
    scope.page,
    scope.mailbox || "",
    scope.conversationId || "",
    scope.sessionId || "",
  ]);
}

/** Scope identity for broadcast routing. Actor is storage detail, not identity. */
export function scopeEquals(a: ComposerDraftScope, b: ComposerDraftScope): boolean {
  return a.page === b.page
    && (a.mailbox || "") === (b.mailbox || "")
    && (a.conversationId || "") === (b.conversationId || "")
    && (a.sessionId || "") === (b.sessionId || "");
}

/** Canonical storage key. Mail keeps its live `mail-draft:v2:…` format. */
export function draftKey(scope: ComposerDraftScope): string {
  if (scope.page === "mail") {
    return `mail-draft:v2:${encodeURIComponent(scope.actor || "")}:${encodeURIComponent((scope.mailbox || "").toLowerCase())}:${encodeURIComponent(scope.conversationId || "")}`;
  }
  if (scope.page === "session") {
    return `${WORKSPACE_PREFIX}${scope.actor || ""}:${scope.sessionId || ""}`;
  }
  return COMPOSER_DRAFT_STASH;
}

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

function storageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function normalizeDraft(draft: ComposerDraftStash): ComposerDraftStash {
  return {
    text: draft.text || "",
    locked_intent: draft.locked_intent,
    locked_label: draft.locked_label,
    locked_knowledge_id: draft.locked_knowledge_id,
    intent: draft.intent,
    chips: draft.chips || [],
    attachments: draft.attachments,
    scope: draft.scope,
    object_refs: draft.object_refs || [],
    client_entry: draft.client_entry,
    model_tier: draft.model_tier,
    skill_template: draft.skill_template,
  };
}

function parseDraft(raw: string | null): ComposerDraftStash | null {
  try {
    const parsed = JSON.parse(raw || "null") as ComposerDraftStash | null;
    if (parsed && typeof parsed.text === "string") return parsed;
  } catch {
    /* unreadable slot: treat as no draft */
  }
  return null;
}

export function readDraft(scope: ComposerDraftScope): ComposerDraftStash | null {
  return parseDraft(storageGet(draftKey(scope)));
}

export function writeDraft(scope: ComposerDraftScope, draft: ComposerDraftStash): ComposerDraftStash {
  const key = draftKey(scope);
  takenCache.delete(key);
  const payload = normalizeDraft(draft);
  storageSet(key, JSON.stringify(payload));
  return payload;
}

export function clearDraft(scope: ComposerDraftScope): void {
  const key = draftKey(scope);
  takenCache.delete(key);
  storageRemove(key);
}

/**
 * Consume a draft. Cached so React StrictMode remounts still see it —
 * the same guarantee ChatBlocks' per-session draft cache used to give.
 * A fresh write clears the cache entry, so a later take reads the new draft.
 */
const takenCache = new Map<string, ComposerDraftStash>();

export function takeDraft(scope: ComposerDraftScope): ComposerDraftStash | null {
  const key = draftKey(scope);
  const cached = takenCache.get(key);
  if (cached) return cached;
  const draft = readDraft(scope);
  if (!draft) return null;
  storageRemove(key);
  takenCache.set(key, draft);
  return draft;
}

export type DraftBroadcast = { scope: ComposerDraftScope; draft: ComposerDraftStash };

/** Write + broadcast. Docks only apply broadcasts for their own scope. */
export function applyDraft(scope: ComposerDraftScope, draft: ComposerDraftStash): ComposerDraftStash {
  const stored = writeDraft(scope, draft);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(COMPOSER_DRAFT_EVENT, { detail: { scope, draft: stored } satisfies DraftBroadcast }));
  }
  return stored;
}

// --- Session workspace drafts (catalogue handoff) ---

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null") as T | null;
  } catch {
    return null;
  }
}

export function readWorkspaceDraft(userId: string, sessionId: string): WorkspaceDraft | null {
  const saved = readJson<WorkspaceDraft>(`${WORKSPACE_PREFIX}${userId}:${sessionId}`);
  return saved?.target?.sessionId === sessionId && typeof saved.draft?.text === "string" && validWorkspaceTarget(saved.target) ? saved : null;
}

export function lastWorkspaceTarget(userId: string): WorkspaceTarget | null {
  const target = readJson<WorkspaceTarget>(`${WORKSPACE_PREFIX}${userId}:last`);
  return target && validWorkspaceTarget(target) ? target : null;
}

export function validWorkspaceTarget(target: WorkspaceTarget): boolean {
  try {
    const url = new URL(target.path, window.location.origin);
    return url.origin === window.location.origin && (url.pathname === `/s/${encodeURIComponent(target.sessionId)}`
      || (url.pathname === "/" && url.searchParams.get("tab") === "discovery" && url.searchParams.get("session_id") === target.sessionId));
  } catch {
    return false;
  }
}

export function saveWorkspaceDraft(userId: string, target: WorkspaceTarget, draft: ComposerDraftStash): void {
  if (!userId || !validWorkspaceTarget(target)) return;
  sessionStorage.setItem(`${WORKSPACE_PREFIX}${userId}:${target.sessionId}`, JSON.stringify({ target, draft }));
  sessionStorage.setItem(`${WORKSPACE_PREFIX}${userId}:last`, JSON.stringify(target));
}

export function mergeAssetDraft(existing: ComposerDraftStash | undefined, asset: ComposerDraftStash): ComposerDraftStash {
  const prior = existing || { text: "" };
  const chips = [...(prior.chips || [])];
  for (const chip of asset.chips || []) {
    const index = chips.findIndex(item => item.kind === chip.kind && item.id === chip.id);
    if (index < 0) chips.push(chip); else chips[index] = chip;
  }
  if (chips.filter(chip => chip.kind === "skill").length > 3) throw new Error("当前草稿已有三项技能，请先移除一项再选择。");
  // An existing sentence is never replaced by a catalogue starter or template.
  // References are additive; an explicit skill choice updates its interaction form.
  return {
    ...prior, ...asset, text: prior.text || asset.text,
    chips, attachments: prior.attachments || asset.attachments,
    object_refs: prior.object_refs || asset.object_refs,
    scope: { ...prior.scope, ...asset.scope }, model_tier: prior.model_tier || asset.model_tier,
    intent: prior.intent || asset.intent, skill_template: asset.skill_template || prior.skill_template,
  };
}

// --- Legacy session drafts (ChatBlocks `draft:<sessionId>`, kept live) ---

const takenSessionCache = new Map<string, ComposerDraft>();

function parseSessionDraft(raw: string): ComposerDraft {
  try {
    const parsed = JSON.parse(raw) as ComposerDraft | string;
    if (typeof parsed === "string") return { text: parsed };
    if (parsed && typeof parsed.text === "string") return parsed;
  } catch {
    /* treat the raw slot as plain text */
  }
  return { text: raw };
}

export function storeSessionDraft(sessionId: string, draft: ComposerDraft): void {
  const key = `${LEGACY_SESSION_DRAFT_PREFIX}${sessionId}`;
  takenSessionCache.delete(key);
  storageSet(key, JSON.stringify(draft));
}

/** Consume a template draft. Cached so React StrictMode remounts still see it. */
export function takeSessionDraft(sessionId: string): ComposerDraft | null {
  const key = `${LEGACY_SESSION_DRAFT_PREFIX}${sessionId}`;
  const cached = takenSessionCache.get(key);
  if (cached) return cached;
  const raw = storageGet(key);
  if (!raw) return null;
  storageRemove(key);
  const draft = parseSessionDraft(raw);
  takenSessionCache.set(key, draft);
  return draft;
}

export function clearSessionDraft(sessionId: string): void {
  const key = `${LEGACY_SESSION_DRAFT_PREFIX}${sessionId}`;
  takenSessionCache.delete(key);
  storageRemove(key);
}

// --- Legacy session work drafts (`employee-agent:…:session:…`, kept live) ---

function agentStorageKey(actor: string, slot: string): string {
  return `employee-agent:${encodeURIComponent(actor)}:${slot}`;
}

export function readSessionWorkDraft(actor: string, id: string): SessionWorkDraft | null {
  if (!actor) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(agentStorageKey(actor, `session:${id}`)) || "null");
    return value && typeof value.text === "string" ? value : null;
  } catch {
    return null;
  }
}

export function saveSessionWorkDraft(actor: string, id: string, draft: SessionWorkDraft): boolean {
  if (!actor) return false;
  try {
    const key = agentStorageKey(actor, `session:${id}`);
    if (draft.text) sessionStorage.setItem(key, JSON.stringify(draft)); else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
