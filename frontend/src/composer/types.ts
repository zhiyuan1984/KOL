import type { AttachmentRef } from "../api";

export const COMPOSER_MAX_SKILL_CHIPS = 3;
export const COMPOSER_PLACEHOLDER = "有问题，尽管问";
export const DEFAULT_EXPERT_ID = "expert:kol";
export const MODEL_TIER_KEY = "composer:model-tier";
export const MODEL_TIER_EVENT = "composer:model-tier";
export const COMPOSER_DRAFT_EVENT = "composer:apply-draft";
export const COMPOSER_DRAFT_STASH = "composer_draft_stash";

/**
 * Composer entry intents. The mail page's own entries (`kol-analyze-enqueue`,
 * `email_compose`) are real intents the Host understands, so they live in the
 * union instead of being cast past it.
 */
export type ComposerEntryIntent =
  | "free"
  | "discover"
  | "analyze_followed"
  | "mail_reply"
  | "mail_analyze"
  | "email_compose"
  | "kol-analyze-enqueue";
export type ComposerClientEntry = "compose-send" | "start-crawl" | "enqueue-analyze";
export type ModelTier = "fast" | "balanced" | "quality";

export type ConnectorDto = {
  id: string;
  label: string;
  access: "read" | "write";
  expired?: boolean;
};

export type KnowledgeLib = {
  id: string;
  title: string;
  shortName: string;
};

export type ComposerObjectRef = {
  kind: string;
  id: string;
  label?: string;
};

export type ComposerScope = {
  skills?: string[];
  knowledge_bases?: string[];
  expert_id?: string;
  connectors?: ConnectorDto[];
  intent?: ComposerEntryIntent;
};

export type ComposerChip =
  | { kind: "skill"; id: string; label: string; write?: boolean }
  | { kind: "kb"; id: string; label: string }
  | { kind: "expert"; id: string; label: string }
  | { kind: "connector"; id: string; label: string; access?: ConnectorDto["access"] }
  | { kind: "attachment"; id: string; label: string; path: string; size?: number; type?: string }
  | { kind: "object"; id: string; label: string; objectKind?: string }
  | { kind: "project"; id: string; label: string }
  | { kind: "discovery"; id: string; label: string };

export type ComposerDraftStash = {
  text: string;
  intent?: ComposerEntryIntent;
  chips?: ComposerChip[];
  attachments?: AttachmentRef[];
  scope?: ComposerScope;
  object_refs?: ComposerObjectRef[];
  client_entry?: ComposerClientEntry;
  model_tier?: string;
};

export function clientEntryFor(intent?: ComposerEntryIntent | null): ComposerClientEntry {
  if (intent === "discover") return "start-crawl";
  if (intent === "analyze_followed") return "enqueue-analyze";
  return "compose-send";
}

export function readModelTier(): ModelTier {
  const raw = localStorage.getItem(MODEL_TIER_KEY);
  if (raw === "fast" || raw === "quality" || raw === "balanced") return raw;
  return "balanced";
}

export function writeModelTier(tier: ModelTier) {
  localStorage.setItem(MODEL_TIER_KEY, tier);
  window.dispatchEvent(new CustomEvent(MODEL_TIER_EVENT, { detail: tier }));
}
