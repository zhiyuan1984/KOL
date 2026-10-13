export type AgentBrowserState = { scroll: number; focusedId?: string; limit?: number };

// Browsing and unsent drafts are account-scoped. They never store capabilities.
export function agentStorageKey(actor: string, slot: string): string {
  return `employee-agent:${encodeURIComponent(actor)}:${slot}`;
}
export function readAgentDraft(actor: string, id: string): string {
  if (!actor) return "";
  try { return sessionStorage.getItem(agentStorageKey(actor, `draft:${id}`)) || ""; }
  catch { return ""; }
}
export function saveAgentDraft(actor: string, id: string, text: string): boolean {
  if (!actor) return false;
  try {
    const key = agentStorageKey(actor, `draft:${id}`);
    if (text) sessionStorage.setItem(key, text); else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}

export type SessionWorkDraft = { text: string; intent?: string; title?: string; knowledge_id?: string };
export function readSessionWorkDraft(actor: string, id: string): SessionWorkDraft | null {
  if (!actor) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(agentStorageKey(actor, `session:${id}`)) || "null");
    return value && typeof value.text === "string" ? value : null;
  } catch { return null; }
}
export function saveSessionWorkDraft(actor: string, id: string, draft: SessionWorkDraft): boolean {
  if (!actor) return false;
  try {
    const key = agentStorageKey(actor, `session:${id}`);
    if (draft.text) sessionStorage.setItem(key, JSON.stringify(draft)); else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}
export function readBrowserPosition(actor: string, key: string): AgentBrowserState {
  try { return JSON.parse(sessionStorage.getItem(agentStorageKey(actor, `position:${key}`)) || "{}"); }
  catch { return { scroll: 0 }; }
}
export function saveBrowserPosition(actor: string, key: string, state: AgentBrowserState) {
  if (!actor) return;
  try { sessionStorage.setItem(agentStorageKey(actor, `position:${key}`), JSON.stringify(state)); }
  catch { /* Browsing remains available when browser storage is disabled. */ }
}
