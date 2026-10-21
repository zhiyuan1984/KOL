import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wecomOntologyFieldBindings, wecomOntologyObjectMappings, type WecomCommitReceipt, type WecomPreviewResponse, type WecomSnapshotPage, type WecomStatusResponse } from '../../../shared/wecom-ontology';
import WecomOntologySourcePanel from './WecomOntologySourcePanel';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const status: WecomStatusResponse = {
  source: 'wecom',
  companyId: 'company:test',
  scope: { explicitCompanyScope: true, requiredRole: 'company_admin' },
  runtimeBinding: {
    executionPath: 'platform-sync-skill', agentId: 'agent:platform-sync', skillId: 'skill:wecom-directory', connectorId: 'wecom-mcp', bindingFingerprint: 'binding:v1',
    tools: { syncStatus: 'wecom_get_sync_status', departments: 'wecom_list_departments', users: 'wecom_list_department_users' },
    bindingVersions: { agentSkill: 1, connectorConfig: 1, connectorBinding: 1, tools: { syncStatus: { skillTool: 1, policy: 1 }, departments: { skillTool: 1, policy: 1 }, users: { skillTool: 1, policy: 1 } } },
  },
  syncStatus: {
    source: 'wecom', version: 9, lastSyncedAt: '2026-10-20T06:00:00.000Z', errorCode: null, retryable: false,
    data: { initialized: true, queryEnabled: true, publishedVersion: 3, publishedDepartmentBatchId: 'dept-batch', publishedUserBatchId: 'user-batch', publishedDepartmentBatch: { id: 'dept-batch', status: 'SUCCESS', departmentCount: 1 }, publishedUserBatch: { id: 'user-batch', status: 'SUCCESS', userCount: 1, relationCount: 1 }, publishedAt: '2026-10-20T05:00:00.000Z' },
  },
  fieldBindings: wecomOntologyFieldBindings,
  objectMappings: wecomOntologyObjectMappings,
  importContract: { mode: 'confirmed_snapshot_only', doesNotWrite: ['organization_units', 'organization_people', 'organization_memberships', 'users', 'agent_bindings'], hrStatus: 'not_inferred' },
};

const preview: WecomPreviewResponse = {
  previewToken: 'preview-1', companyId: 'company:test', expiresAt: '2026-10-20T07:00:00.000Z', contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', bindingFingerprint: 'binding:v1',
  sourceVersion: { source: 'wecom', version: 9, departmentBatchId: 'dept-batch', userBatchId: 'user-batch', publishedAt: '2026-10-20T05:00:00.000Z', lastSyncedAt: '2026-10-20T06:00:00.000Z' },
  rootDepartmentExternalIds: ['wecom:company:test:department:1'],
  rows: [{ externalId: 'wecom:company:test:department:1', tenantId: 'company:test', source: 'wecom', kind: 'department', objectCode: 'org_unit', upstreamId: '1', ontologyProperties: { wecom_name: '研发部', wecom_parent_id: null }, attributes: { name: '研发部', parentId: null }, relations: { wecom_leaders: ['wecom:company:test:person:u1'] } }],
  counts: { department: 1, person: 0, membership: 0 }, warnings: [], complete: true,
};

const snapshot: WecomSnapshotPage = {
  tableVersion: 'wecom-ontology-source-snapshot.v1', snapshotId: 'snapshot-1', companyId: 'company:test', sourceVersion: preview.sourceVersion,
  rootDepartmentExternalIds: preview.rootDepartmentExternalIds, rows: preview.rows, nextCursor: null, pageSize: 20, kind: null,
};

const receipt: WecomCommitReceipt = {
  receiptId: 'receipt-1', snapshotId: 'snapshot-1', companyId: 'company:test', source: 'wecom', sourceVersion: preview.sourceVersion,
  contentHash: preview.contentHash, reason: '核对本周组织结构来源', rowCounts: preview.counts, createdAt: '2026-10-20T06:30:00.000Z',
};

function response(json: unknown, statusCode = 200) {
  return new Response(JSON.stringify(json), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
}

function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<WecomOntologySourcePanel open companyId="company:test" onClose={() => {}} />));
}

async function settle() {
  await act(async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); });
}

function button(name: string) {
  const item = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === name);
  expect(item, `missing button ${name}`).toBeTruthy();
  return item!;
}

function updateValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}

beforeEach(() => {
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => computedStyle(element));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  document.querySelectorAll('.ant-drawer').forEach(element => element.remove());
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WecomOntologySourcePanel', () => {
  it('keeps a preview unimported until a reason and explicit confirmation are supplied', async () => {
    let commits = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, window.location.origin).pathname;
      expect((init?.headers as Record<string, string>)['X-Ontology-Company']).toBe('company:test');
      if (path.endsWith('/status')) return response(status);
      if (path.endsWith('/preview')) return response(preview);
      if (path.endsWith('/commit')) { commits++; return response({ receiptId: 'receipt-1', snapshotId: 'snapshot-1', companyId: 'company:test', source: 'wecom', sourceVersion: preview.sourceVersion, contentHash: preview.contentHash, rowCounts: preview.counts, createdAt: '2026-10-20T06:30:00.000Z' }); }
      if (path.endsWith('/snapshot')) return response(snapshot);
      return response({ detail: 'unknown path' }, 404);
    }));
    mount();
    await settle();
    expect(document.body.textContent).toContain('当前可读来源可能为历史快照');
    act(() => button('生成来源预览').click());
    await settle();
    expect(document.body.textContent).toContain('候选预览 · 尚未导入');
    expect(button('确认导入来源快照').disabled).toBe(true);
    expect(commits).toBe(0);

    updateValue(document.querySelector<HTMLTextAreaElement>('#wecom-import-reason')!, '核对本周组织结构来源');
    act(() => document.querySelector<HTMLInputElement>('.wecom-source-confirm input[type=checkbox]')?.click());
    expect(button('确认导入来源快照').disabled).toBe(false);
    act(() => button('确认导入来源快照').click());
    await settle();
    expect(commits).toBe(1);
    expect(document.body.textContent).toContain('真实导入回执 receipt-1');
    expect(document.body.textContent).toContain('研发部');
  });

  it('explains a 401 source error without rendering a preview or any claim of live data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ detail: { code: 'wecom_company_admin_required', message: '仅公司管理员可管理企微本体来源' } }, 401)));
    mount();
    await settle();
    expect(document.body.textContent).toContain('来源当前不可用');
    expect(document.body.textContent).toContain('读取已导入快照');
    expect(document.body.textContent).not.toContain('生成来源预览');
  });

  it('does not resend or generate a new preview after an uncertain commit, even when its receipt is not found', async () => {
    let commits = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url, window.location.origin).pathname;
      if (path.endsWith('/status')) return response(status);
      if (path.endsWith('/preview')) return response(preview);
      if (path.endsWith('/commit')) { commits += 1; throw new TypeError('network unavailable'); }
      if (path.endsWith('/receipt')) return response({ receipt: null });
      if (path.endsWith('/snapshot')) return response(snapshot);
      return response({ detail: 'unknown path' }, 404);
    }));
    mount();
    await settle();
    act(() => button('生成来源预览').click());
    await settle();
    updateValue(document.querySelector<HTMLTextAreaElement>('#wecom-import-reason')!, '核对本周组织结构来源');
    act(() => document.querySelector<HTMLInputElement>('.wecom-source-confirm input[type=checkbox]')?.click());
    act(() => button('确认导入来源快照').click());
    await settle();
    expect(commits).toBe(1);
    expect(document.body.textContent).toContain('导入结果待核查');
    expect(button('确认导入来源快照').disabled).toBe(true);
    expect(document.body.textContent).not.toContain('生成来源预览');
    act(() => button('只读查询导入回执').click());
    await settle();
    expect(document.body.textContent).toContain('未查询到命令');
    expect(button('确认导入来源快照').disabled).toBe(true);
    expect(commits).toBe(1);
  });

  it('restores a persisted uncertain command by querying its receipt and loading that receipt snapshot without posting', async () => {
    window.sessionStorage.setItem('wecom-ontology-pending:company:test', JSON.stringify({ commandId: 'command-pending', preview, reason: receipt.reason, confirmed: true, savedAt: Date.now() }));
    let commits = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url, window.location.origin);
      expect((init?.headers as Record<string, string>)['X-Ontology-Company']).toBe('company:test');
      if (parsed.pathname.endsWith('/status')) return response(status);
      if (parsed.pathname.endsWith('/receipt')) {
        expect(parsed.searchParams.get('companyId')).toBe('company:test');
        expect(parsed.searchParams.get('commandId')).toBe('command-pending');
        return response({ receipt });
      }
      if (parsed.pathname.endsWith('/snapshot')) return response(snapshot);
      if (parsed.pathname.endsWith('/commit')) { commits += 1; return response(receipt); }
      return response({ detail: 'unknown path' }, 404);
    }));
    mount();
    await settle();
    expect(commits).toBe(0);
    expect(document.body.textContent).toContain('真实导入回执 receipt-1');
    expect(document.body.textContent).toContain('研发部');
    expect(window.sessionStorage.getItem('wecom-ontology-pending:company:test')).toBeNull();
  });

  it('formats numeric Unix seconds as their source date rather than 1970', async () => {
    const secondsStatus: WecomStatusResponse = {
      ...status,
      syncStatus: {
        ...status.syncStatus,
        lastSyncedAt: 1792481924,
        data: { ...status.syncStatus.data!, publishedAt: 1792481924 },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new URL(url, window.location.origin).pathname.endsWith('/status') ? response(secondsStatus) : response({ detail: 'unknown path' }, 404)));
    mount();
    await settle();
    expect(document.body.textContent).toContain('2026');
    expect(document.body.textContent).not.toContain('1970');
  });

  it('shows a nullable latest snapshot as not yet imported rather than as a snapshot error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url, window.location.origin).pathname;
      if (path.endsWith('/status')) return response(status);
      if (path.endsWith('/snapshot')) return response(null);
      return response({ detail: 'unknown path' }, 404);
    }));
    mount();
    await settle();
    act(() => button('读取已导入快照').click());
    await settle();
    expect(document.body.textContent).toContain('暂无已导入来源快照');
    expect(document.body.textContent).not.toContain('快照读取失败');
  });
});
