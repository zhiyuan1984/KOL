import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  user: 'employee', scope: { bound: true, status: 'connected', mailbox_id: '6', mailbox_email: 'larry@test',
    owner_open_id: '273', owner_verified_at: 'v1', updated_at: 'v1' },
  page: vi.fn(),
}));
vi.mock('../src/auth.js', () => ({ scopedUser: () => ({ id: state.user }) }));
vi.mock('../src/host/starry-bind.js', () => ({ currentFollowScope: () => state.scope }));
vi.mock('../src/host/starry-connectors.js', () => ({ pageKolProfiles: state.page }));
import { readAuthorizedOwnershipSnapshot } from '../src/starrykol/authorized-ownership.js';
const row = (kolUid: string, ownerOpenId = '273') => ({ kolUid, ownerOpenId });
beforeEach(() => {
  state.page.mockReset(); state.user = 'employee'; state.scope.status = 'connected'; state.scope.updated_at = 'v1';
});
describe('request-local Starry authorization snapshot', () => {
  it('uses the current authorized total, not public listAll, and rechecks its anchor', async () => {
    state.page.mockResolvedValue({ total: 2, list: [row('A'), row('B', '197')] });
    const result = await readAuthorizedOwnershipSnapshot('employee');
    expect(result).toMatchObject({ total: 2, scope: 'current-user-authorized', rows: [
      { kol_uid: 'A', owner_open_id: '273', owner_mailbox: '' },
      { kol_uid: 'B', owner_open_id: '197', owner_mailbox: '' },
    ] });
    expect(state.page).toHaveBeenCalledTimes(2);
    expect(JSON.parse(state.page.mock.calls[0][0].requestJson)).toMatchObject({ sortField: 'created_time', sortOrder: 'asc' });
  });
  it('paginates a complete 236-record authorized subset without demanding 240 public rows', async () => {
    const all = Array.from({length:236}, (_,i) => row(`K${i}`));
    state.page.mockImplementation(async ({requestJson}) => {
      const q = JSON.parse(requestJson); return { total:236, list:all.slice((q.pageNo-1)*100,q.pageNo*100) };
    });
    expect((await readAuthorizedOwnershipSnapshot('employee')).rows).toHaveLength(236);
    expect(state.page).toHaveBeenCalledTimes(4);
  });
  it('does not reuse a previous snapshot after upstream authorization is revoked', async () => {
    state.page.mockResolvedValue({total:1,list:[row('A')]});
    expect((await readAuthorizedOwnershipSnapshot('employee')).rows).toHaveLength(1);
    state.page.mockResolvedValue({total:0,list:[]});
    expect((await readAuthorizedOwnershipSnapshot('employee')).rows).toEqual([]);
  });
  it('fails closed for the wrong current employee before calling upstream', async () => {
    await expect(readAuthorizedOwnershipSnapshot('other')).rejects.toThrow('identity_mismatch');
    expect(state.page).not.toHaveBeenCalled();
  });
  it('fails closed if the binding expires during the call', async () => {
    state.page.mockImplementation(async () => { state.scope.status = 'expired'; return {total:1,list:[row('A')]}; });
    await expect(readAuthorizedOwnershipSnapshot('employee')).rejects.toThrow('binding_unverified');
  });
  it('rejects count-stable ownership changes in the rechecked anchor', async () => {
    state.page.mockResolvedValueOnce({total:1,list:[row('A')]}).mockResolvedValueOnce({total:1,list:[row('A','197')]});
    await expect(readAuthorizedOwnershipSnapshot('employee')).rejects.toThrow('snapshot_changed');
  });
  it.each([
    [{list:[]}, 'response_incomplete'],
    [{total:null,list:[]}, 'response_incomplete'],
    [{total:1,list:[{kolUid:'A'}]}, 'owner_capability_missing'],
    [{total:1,list:[{ownerOpenId:'273'}]}, 'identity_invalid'],
    [{total:2,list:[row('A'),row('A')]}, 'identity_invalid'],
    [{total:1,list:[]}, 'count_mismatch'],
    [{total:0,list:[row('A')]}, 'count_mismatch'],
  ])('rejects malformed or incomplete snapshot %#', async (response, error) => {
    state.page.mockResolvedValue(response);
    await expect(readAuthorizedOwnershipSnapshot('employee')).rejects.toThrow(error);
  });
  it('rejects a total change between pages', async () => {
    state.page.mockResolvedValueOnce({total:2,list:[row('A')]}).mockResolvedValueOnce({total:3,list:[row('B')]});
    await expect(readAuthorizedOwnershipSnapshot('employee')).rejects.toThrow('snapshot_changed');
  });
  it('propagates upstream authorization failure rather than authorizing old cached rows', async () => {
    state.page.mockRejectedValue(new Error('forbidden'));
    await expect(readAuthorizedOwnershipSnapshot('employee')).rejects.toThrow('forbidden');
  });
});
