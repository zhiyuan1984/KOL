import type { ComposerDraftStash } from "./types";

export type WorkspaceTarget = { sessionId: string; path: string; title: string };
export type WorkspaceDraft = { target: WorkspaceTarget; draft: ComposerDraftStash };
const PREFIX = "workspace:asset-draft:";

function read<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) || "null") as T | null; } catch { return null; }
}
export function readWorkspaceDraft(userId: string, sessionId: string): WorkspaceDraft | null {
  const saved = read<WorkspaceDraft>(`${PREFIX}${userId}:${sessionId}`);
  return saved?.target?.sessionId === sessionId && typeof saved.draft?.text === "string" && validWorkspaceTarget(saved.target) ? saved : null;
}
export function lastWorkspaceTarget(userId: string): WorkspaceTarget | null {
  const target = read<WorkspaceTarget>(`${PREFIX}${userId}:last`);
  return target && validWorkspaceTarget(target) ? target : null;
}
export function validWorkspaceTarget(target: WorkspaceTarget): boolean {
  try {
    const url = new URL(target.path, window.location.origin);
    return url.origin === window.location.origin && (url.pathname === `/s/${encodeURIComponent(target.sessionId)}`
      || (url.pathname === "/" && url.searchParams.get("tab") === "discovery" && url.searchParams.get("session_id") === target.sessionId));
  } catch { return false; }
}
export function saveWorkspaceDraft(userId: string, target: WorkspaceTarget, draft: ComposerDraftStash): void {
  if (!userId || !validWorkspaceTarget(target)) return;
  sessionStorage.setItem(`${PREFIX}${userId}:${target.sessionId}`, JSON.stringify({ target, draft }));
  sessionStorage.setItem(`${PREFIX}${userId}:last`, JSON.stringify(target));
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
  return { ...prior, ...asset, text: prior.text || asset.text,
    chips, attachments: prior.attachments || asset.attachments,
    object_refs: prior.object_refs || asset.object_refs,
    scope: { ...prior.scope, ...asset.scope }, model_tier: prior.model_tier || asset.model_tier,
    intent: prior.intent || asset.intent, skill_template: asset.skill_template || prior.skill_template };
}
