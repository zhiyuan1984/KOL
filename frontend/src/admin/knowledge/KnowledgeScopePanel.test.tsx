// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScopeDetail, KnowledgeScope } from '../../../../shared/knowledge-scope';
import KnowledgeScopePanel from './KnowledgeScopePanel';
import DocumentRail from './DocumentRail';

const mocks = vi.hoisted(() => ({ document: vi.fn(), scope: vi.fn(), action: vi.fn() }));
vi.mock('../../api', () => ({ api: { adminKnowledgeDocument: mocks.document, adminKnowledgeDocumentAction: mocks.action } }));
vi.mock('../../reviews/api', () => ({ reviewApi: mocks.scope, reviewCompany: () => '', reviewHeaders: () => ({}) }));
vi.mock('../../components/ConfirmDialog', () => ({ useAdminConfirm: () => ({ ask: vi.fn(), dialog: null, open: false }) }));
vi.mock('./WorkspaceActions', () => ({ default: ({ children }: {children: ReactNode}) => children }));
vi.mock('./PublicationPanel', () => ({ default: () => null }));

let root: Root, host: HTMLDivElement;
const ready = vi.fn(), changed = vi.fn(), dirty = vi.fn(), reload = vi.fn();
const candidate: KnowledgeScope = {
  schema_version: 1, summary: '战略解码与执行', entities: [],
  topics: [{ label: '目标与差距', evidence_ids: ['e1'] }], question_types: ['overview'],
  limitations: [], unverified_notes: [],
  evidence: [{ id: 'e1', document_id: 'doc', original_pages: [18], text: '业绩差距与机会差距' }],
  coverage: { status: 'complete', unreadable_pages: [], catalog_completeness: 'unknown' },
};
function scope(overrides: Partial<ScopeDetail> = {}): ScopeDetail {
  return { document_id: 'doc', revision: 1, explanation: '用于战略培训', state: 'empty', scope: null,
    fingerprint: '', job: null, frozen: false, actions: { edit: true, generate: false, check: false }, ...overrides };
}
function documentDetail(status: string) {
  return { document: { id: 'doc', title: '战略工作坊', filename: 'training.pptx', media_type: 'pptx',
    status, created_at: '2026-10-15T08:00:00Z', updated_at: status, current_version: 1,
    latest_job: { id: 'index', kind: 'index', status: status === 'indexing' ? 'running' : 'done' } },
    jobs: [], actions: { retry: status === 'failed' }, text_preview: null };
}
async function render(element: ReactNode) { await act(async () => root.render(element)); }
async function advance(ms: number) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }
function panel(token = 'indexing', documentStatus = 'indexing') {
  return <KnowledgeScopePanel id="doc" documentStatus={documentStatus} refreshToken={token} onReady={ready} onDirty={dirty} onChanged={changed} />;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('知识提炼真实状态与刷新恢复', () => {
  it('文档索引完成后自动发现已入队范围，并轮询到候选，不依赖整页刷新', async () => {
    mocks.document.mockResolvedValueOnce(documentDetail('indexing')).mockResolvedValue(documentDetail('pending_review'));
    mocks.scope.mockResolvedValueOnce(scope()).mockResolvedValueOnce(scope({ job: { id: 'scope-job', status: 'queued' } }))
      .mockResolvedValue(scope({ state: 'candidate', scope: candidate, job: { id: 'scope-job', status: 'succeeded' }, actions: { edit: true, generate: true, check: true } }));
    await render(<MemoryRouter><DocumentRail id="doc" path="" reload={reload} notify={vi.fn()} fail={vi.fn()} /></MemoryRouter>);
    expect(host.textContent).toContain('完成后将自动提炼知识范围');
    await advance(3000);
    expect(host.textContent).toContain('等待知识范围提炼服务');
    await advance(2500);
    expect(host.textContent).toContain('范围待核对');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="主题 1"]')!.value).toBe('目标与差距');
    expect(mocks.scope).toHaveBeenCalledTimes(3);
  });

  it('范围轮询遇到多次相同的 502 后仍会恢复，且请求不重叠', async () => {
    const error = Object.assign(new Error('暂时断线'), { status: 502 });
    mocks.scope.mockResolvedValueOnce(scope({ job: { id: 'j', status: 'running' } }))
      .mockRejectedValueOnce(error).mockRejectedValueOnce(error)
      .mockResolvedValue(scope({ state: 'candidate', scope: candidate, job: { id: 'j', status: 'succeeded' } }));
    await render(panel());
    await advance(2500); expect(host.textContent).toContain('刷新暂时失败，将自动重试');
    await advance(2500); expect(mocks.scope).toHaveBeenCalledTimes(3);
    await advance(2500); expect(host.textContent).toContain('范围待核对');
    await advance(10000); expect(mocks.scope).toHaveBeenCalledTimes(4);
  });

  it('权限错误会暂停自动刷新，手动读取成功后恢复跟踪', async () => {
    mocks.scope.mockResolvedValueOnce(scope({ job: { id: 'j', status: 'running' } }))
      .mockRejectedValueOnce(Object.assign(new Error('没有权限'), { status: 403 }))
      .mockResolvedValueOnce(scope({ job: { id: 'j', status: 'running' } }))
      .mockResolvedValue(scope({ state: 'candidate', scope: candidate, job: { id: 'j', status: 'succeeded' } }));
    await render(panel()); await advance(2500);
    expect(host.textContent).toContain('自动刷新已暂停，请重新读取');
    await advance(10000); expect(mocks.scope).toHaveBeenCalledTimes(2);
    const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '重新读取')!;
    await act(async () => button.click()); await advance(2500);
    expect(host.textContent).toContain('范围待核对'); expect(mocks.scope).toHaveBeenCalledTimes(4);
  });

  it('父资料状态更新不会覆盖未保存的解释，也不会误报可审批', async () => {
    mocks.scope.mockResolvedValue(scope({ state: 'checked', scope: candidate, actions: { edit: true, generate: true, check: true } }));
    await render(panel('a', 'pending_review'));
    const textarea = host.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '我的未保存解释');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('有未保存修改');
    await render(panel('b', 'pending_review'));
    expect(host.querySelector('textarea')!.value).toBe('我的未保存解释');
    expect(ready).toHaveBeenLastCalledWith(false);
  });

  it('资料加工失败时解释范围未启动原因，保留服务端重试入口', async () => {
    mocks.document.mockResolvedValue(documentDetail('failed')); mocks.scope.mockResolvedValue(scope());
    await render(<MemoryRouter><DocumentRail id="doc" path="" reload={reload} notify={vi.fn()} fail={vi.fn()} /></MemoryRouter>);
    expect(host.textContent).toContain('知识范围提炼尚未启动。请先重试加工');
    expect(host.textContent).not.toContain('自动刷新中');
    expect(host.querySelector<HTMLButtonElement>('[data-kbv-doc-action="retry"]')!.disabled).toBe(false);
  });

  it('资料详情遇到暂时性 502 后以退避刷新恢复并继续通知范围面板', async () => {
    mocks.document.mockResolvedValueOnce(documentDetail('indexing'))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockResolvedValue(documentDetail('pending_review'));
    mocks.scope.mockResolvedValue(scope());
    await render(<MemoryRouter><DocumentRail id="doc" path="" reload={reload} notify={vi.fn()} fail={vi.fn()} /></MemoryRouter>);
    await advance(3000); expect(host.textContent).toContain('刷新暂时失败，将自动重试');
    await advance(7999); expect(mocks.document).toHaveBeenCalledTimes(2);
    await advance(1); expect(mocks.document).toHaveBeenCalledTimes(3);
    expect(host.textContent).not.toContain('刷新暂时失败，将自动重试');
    expect(mocks.scope).toHaveBeenCalledTimes(2);
  });
});
