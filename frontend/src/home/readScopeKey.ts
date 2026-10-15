/**
 * AuthGate is the identity fact source. This helper deliberately receives only
 * that already-verified metadata, so read helpers remain usable in pure Node
 * tests and never infer an actor from a display name or browser state.
 */
export type ScopeMetadata = {
  id?: string | null;
  role?: string | null;
  roles?: readonly string[] | null;
  brands?: readonly string[] | null;
  mailboxes?: readonly string[] | null;
  available_modes?: readonly string[] | null;
};

function scopeValues(values: readonly (string | null | undefined)[]): string {
  return [...new Set(values
    .map((value) => String(value || "").trim())
    .filter(Boolean))]
    .sort()
    .map(encodeURIComponent)
    .join(",");
}

/**
 * A missing stable account id is intentionally its own non-private scope. It
 * must never share an authenticated actor's in-flight private read.
 */
export function readScopeKey(metadata: ScopeMetadata | null | undefined): string {
  const actorId = String(metadata?.id || "").trim();
  if (!actorId) return "actor:unverified";
  return [
    `actor:${encodeURIComponent(actorId)}`,
    `roles:${scopeValues([...(metadata?.roles || []), metadata?.role])}`,
    `brands:${scopeValues(metadata?.brands || [])}`,
    `mailboxes:${scopeValues(metadata?.mailboxes || [])}`,
    `modes:${scopeValues(metadata?.available_modes || [])}`,
  ].join("|");
}
