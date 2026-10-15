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

export function readBrowserPosition(actor: string, key: string): AgentBrowserState {
  try { return JSON.parse(sessionStorage.getItem(agentStorageKey(actor, `position:${key}`)) || "{}"); }
  catch { return { scroll: 0 }; }
}
export function saveBrowserPosition(actor: string, key: string, state: AgentBrowserState) {
  if (!actor) return;
  try { sessionStorage.setItem(agentStorageKey(actor, `position:${key}`), JSON.stringify(state)); }
  catch { /* Browsing remains available when browser storage is disabled. */ }
}
