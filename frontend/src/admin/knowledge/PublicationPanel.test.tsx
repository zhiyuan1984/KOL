// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicationPanel from './PublicationPanel';
import { ReviewApiError } from '../../reviews/api';

const mocks = vi.hoisted(() => ({ api: vi.fn(), check: vi.fn(), confirm: vi.fn() }));
vi.mock('../../reviews/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../reviews/api')>(),
  reviewApi: mocks.api, reviewCompany: () => '',
}));
vi.mock('../../components/ConfirmDialog', () => ({ useAdminConfirm: () => ({ ask: mocks.confirm, dialog: null, open: false }) }));
vi.mock('./WorkspaceActions', () => ({ default: ({children}: {children: ReactNode}) => children }));

let host: HTMLDivElement, root: Root;
let required = true;
let extraFields: Record<string, unknown>[] = [];
const issue = {path: 'publication_note', message: '发布说明必填'};
function options() {
  return {tenant: 'test-company', publication: null, intake: {allowed: true, reason: ''}, submission: {allowed: true, reason: ''}, templates: [{
    id: 'test-flow', version: 4, definition: {name: '测试知识发布审批', subjectType: 'knowledge_publication', fields: [
      {id: 'knowledge_request', label: '资料引用', type: 'text', required: true},
      {id: 'publication_note', label: '发布说明', type: 'textarea', required},
      {id: 'audience', label: '适用对象', type: 'textarea', required: false},
      ...extraFields,
    ], nodes: []},
  }]};
}
async function render() { await act(async () => root.render(<MemoryRouter><PublicationPanel id="test-doc" mode="review" notify={vi.fn()} refreshDocument={vi.fn()} /></MemoryRouter>)); }
async function advance() { await act(async () => vi.advanceTimersByTimeAsync(350)); }
function note() { return host.querySelector<HTMLTextAreaElement>('textarea[name="publication_note"]') || host.querySelectorAll<HTMLTextAreaElement>('textarea')[1]; }
function submit() { return host.querySelector<HTMLButtonElement>('[data-kbv-doc-action="submit"]')!; }
async function input(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', {bubbles: true}));
  });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); required = true; extraFields = [];
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.check.mockImplementation((body: {releaseNote: string}) => Promise.resolve(body.releaseNote.trim() || !required
    ? {allowed: true, reason: '', issues: [], reviewers: ['测试评审人']}
    : {allowed: false, reason: '请修正审批表单', issues: [issue], reviewers: []}));
  mocks.api.mockImplementation((url: string, body?: unknown) => {
    if (url.endsWith('/publication-v2/companies')) return Promise.resolve([{id: 'test-company', name: '测试公司'}]);
    if (url.endsWith('/publication-v2/check')) return mocks.check(body);
    if (url.endsWith('/publication-v2')) return Promise.resolve(options());
    throw new Error('Unexpected API: '+url);
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('知识发布审批字段校验', () => {
  it('显示服务端具体错误、必填标识和字段错误状态，不只给泛化提示', async () => {
    await render(); await advance();
    expect(host.textContent).toContain('发布说明必填');
    expect(note().required).toBe(true);
    expect(note().getAttribute('aria-invalid')).toBe('true');
    expect(note().getAttribute('aria-describedby')).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });
  it('点击错误摘要定位发布说明，而不是查找一个不存在的内部字段', async () => {
    await render(); await advance();
    const link = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('发布说明必填'));
    expect(link).toBeTruthy();
    await act(async () => link!.click());
    expect(document.activeElement).toBe(note());
  });
  it('填完说明后重新检查、清除旧错误，不自动准备或提交审批', async () => {
    await render(); await advance(); await input(note(), '发布测试资料，用于测试培训范围'); await advance();
    expect(host.textContent).not.toContain('发布说明必填');
    expect(host.textContent).toContain('测试评审人');
    expect(submit().disabled).toBe(false);
    expect(mocks.api.mock.calls.filter(([url]) => /\/prepare|\/submit/.test(url))).toHaveLength(0);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('展示并定位动态审批字段的服务端错误', async () => {
    mocks.check.mockResolvedValue({allowed: false, reason: '请修正审批表单', issues: [{path: 'audience', message: '适用对象必填'}], reviewers: []});
    await render(); await advance();
    const field = host.querySelector('[data-review-field="audience"]')!;
    expect(field.textContent).toContain('适用对象必填');
    expect(field.querySelector('textarea')!.getAttribute('aria-invalid')).toBe('true');
    const link = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('适用对象必填'))!;
    await act(async () => link.click());
    expect(document.activeElement).toBe(field.querySelector('textarea'));
  });
  it('必填来自流程定义，不擅自把可选说明变成业务规则', async () => {
    required = false;
    await render(); await advance();
    expect(note().required).toBe(false);
    expect(submit().disabled).toBe(false);
  });
  it('兼容 HTTP 422 的字段错误，并仍保持提交禁用', async () => {
    mocks.check.mockRejectedValue(new ReviewApiError(422, {message: '请修正审批表单', issues: [issue]}));
    await render(); await advance();
    expect(host.textContent).toContain('发布说明必填');
    expect(note().getAttribute('aria-invalid')).toBe('true');
    expect(submit().disabled).toBe(true);
  });
  it('非字段权限错误保留原始原因，不误报缺少发布说明', async () => {
    mocks.check.mockRejectedValue(new ReviewApiError(403, {message: '没有知识管理权限'}));
    await render(); await advance();
    expect(host.textContent).toContain('没有知识管理权限');
    expect(host.textContent).not.toContain('发布说明必填');
    expect(submit().disabled).toBe(true);
  });
  it('金额字段的金额与币种均展示错误，摘要定位第一个可编辑控件', async () => {
    extraFields = [{id: 'budget', label: '测试预算', type: 'money', required: true, currencies: ['CNY'], currencySource: '测试配置'}];
    mocks.check.mockResolvedValue({allowed: false, reason: '请修正审批表单', issues: [{path: 'budget', message: '测试预算必填'}], reviewers: []});
    await render(); await advance();
    const field = host.querySelector('[data-review-field="budget"]')!;
    expect(field.textContent).toContain('测试预算必填');
    for (const control of field.querySelectorAll('input,select')) expect(control.getAttribute('aria-invalid')).toBe('true');
    const link = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('测试预算必填'))!;
    await act(async () => link.click());
    expect(document.activeElement).toBe(field.querySelector('input'));
  });
  it('附件错误可见且能定位文件控件，定位不会上传文件', async () => {
    extraFields = [{id: 'supporting', label: '测试依据附件', type: 'attachment', required: true}];
    mocks.check.mockResolvedValue({allowed: false, reason: '请修正审批表单', issues: [{path: 'supporting', message: '测试依据附件必填'}], reviewers: []});
    await render(); await advance();
    const field = host.querySelector('[data-review-field="supporting"]')!;
    expect(field.textContent).toContain('测试依据附件必填');
    const link = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('测试依据附件必填'))!;
    await act(async () => link.click());
    expect(document.activeElement).toBe(field.querySelector('input[type="file"]'));
    expect(mocks.api.mock.calls.filter(([url]) => /attachment/.test(url))).toHaveLength(0);
  });
});
