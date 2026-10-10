import { scopedUser } from '../auth.js';
import { currentFollowScope } from '../host/starry-bind.js';
import { pageKolProfiles } from '../host/starry-connectors.js';
import { firstString } from './mail-fields.js';
import type { Json } from '../types.js';

export type AuthorizedOwnership = { kol_uid: string; owner_open_id: string; owner_mailbox: string };
export type AuthorizedOwnershipSnapshot = {
  rows: AuthorizedOwnership[];
  total: number;
  source_version: string;
  scope: 'current-user-authorized';
};
const PAGE_SIZE = 100;
const MAX_PAGES = 40;

function bindingFingerprint(employeeId: string): string {
  if (scopedUser()?.id !== employeeId) throw new Error('starry_ownership_identity_mismatch');
  const scope = currentFollowScope();
  if (!scope.bound || scope.status !== 'connected' || !scope.owner_verified_at)
    throw new Error('starry_ownership_binding_unverified');
  // Background mailbox reads may re-certify the same identity concurrently.
  // Verification time alone is not a binding change; losing verification is.
  return JSON.stringify([employeeId, scope.mailbox_id, scope.mailbox_email, scope.owner_open_id,
    Boolean(scope.owner_verified_at), scope.updated_at, scope.status]);
}
function pageRows(data: Json): { total: number; rows: AuthorizedOwnership[] } {
  const key = ['list', 'records', 'rows', 'items'].find(k => Array.isArray(data[k]));
  if (!key || !(typeof data.total === 'number' || typeof data.total === 'string')
    || String(data.total).trim() === '' || !Number.isSafeInteger(Number(data.total)) || Number(data.total) < 0)
    throw new Error('starry_ownership_response_incomplete');
  const rows = (data[key] as Json[]).map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new Error('starry_ownership_snapshot_identity_invalid');
    const uid = firstString(row.kolUid, row.kol_uid);
    if (!uid) throw new Error('starry_ownership_snapshot_identity_invalid');
    if (!['ownerOpenId', 'owner_open_id', 'ownerUserId', 'owner_user_id', 'ownerMailbox', 'owner_mailbox']
      .some(k => Object.hasOwn(row, k))) throw new Error('starry_ownership_snapshot_owner_capability_missing');
    return { kol_uid: uid, owner_open_id: firstString(row.ownerOpenId, row.owner_open_id, row.ownerUserId, row.owner_user_id),
      owner_mailbox: firstString(row.ownerMailbox, row.owner_mailbox).trim().toLowerCase() };
  });
  if (rows.length > PAGE_SIZE) throw new Error('starry_ownership_count_mismatch');
  return { total: Number(data.total), rows };
}
/** A request-local authorization proof, never a company-wide snapshot or grant.
 * Public listAll has a different scope and is deliberately not a completeness oracle.
 * No caching: upstream revocation is checked on every employee-list request.
 */
export async function readAuthorizedOwnershipSnapshot(employeeId: string): Promise<AuthorizedOwnershipSnapshot> {
  const fingerprint = bindingFingerprint(employeeId);
  const rows: AuthorizedOwnership[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  let first: AuthorizedOwnership[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (bindingFingerprint(employeeId) !== fingerprint) throw new Error('starry_ownership_binding_changed');
    const result = pageRows(await pageKolProfiles({ requestJson: JSON.stringify({
      pageNo: page, pageSize: PAGE_SIZE, sortField: 'created_time', sortOrder: 'asc',
    }) }));
    if (bindingFingerprint(employeeId) !== fingerprint) throw new Error('starry_ownership_binding_changed');
    if (expected !== null && expected !== result.total) throw new Error('starry_ownership_snapshot_changed_during_pagination');
    expected = result.total;
    if (page === 1) first = result.rows;
    for (const row of result.rows) {
      if (seen.has(row.kol_uid)) throw new Error('starry_ownership_snapshot_identity_invalid');
      seen.add(row.kol_uid);
      rows.push(row);
    }
    if (rows.length > expected || (!result.rows.length && rows.length < expected))
      throw new Error('starry_ownership_count_mismatch');
    if (rows.length === expected) {
      // Recheck the anchor page to detect count-stable changes and mid-pagination revocation.
      const anchor = pageRows(await pageKolProfiles({ requestJson: JSON.stringify({
        pageNo: 1, pageSize: PAGE_SIZE, sortField: 'created_time', sortOrder: 'asc',
      }) }));
      if (anchor.total !== expected || JSON.stringify(anchor.rows) !== JSON.stringify(first))
        throw new Error('starry_ownership_snapshot_changed_during_pagination');
      if (bindingFingerprint(employeeId) !== fingerprint) throw new Error('starry_ownership_binding_changed');
      return { rows, total: expected, source_version: new Date().toISOString(), scope: 'current-user-authorized' };
    }
  }
  throw new Error('starry_ownership_pagination_incomplete');
}
