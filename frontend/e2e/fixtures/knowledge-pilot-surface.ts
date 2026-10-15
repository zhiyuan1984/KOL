import { expect, type Page } from '@playwright/test';

/** HTTP contract fixture only: never reported as real-service/production evidence. */
export async function knowledgePilotSurface(page: Page, initial = 'running') {
  const account = { id: 'admin', name: '管理员', available_modes: ['admin', 'employee'] };
  const bases = [{ id: 'specs', name: '电池', kind: 'unstructured', status: 'active', family_id: 'ipd', family_name: '产品与解决方案', domain_id: 'battery', domain_name: '产品管理' }];
  const domains = [{ id: 'ipd', name: '产品与解决方案', level: 'family' }, { id: 'battery', name: '产品管理', level: 'domain', parent_id: 'ipd' }];
  const docs = ['pilot-one', 'pilot-two'].map((id, index) => ({ id, base_id: 'specs', title: 'NETC 产品介绍（同名资料）', filename: 'NETC 产品介绍.pptx', media_type: 'pptx', size_bytes: 40000, status: 'pending_review', current_version: index + 1, retry_count: 0, created_by: 'admin', created_at: '2026-10-15T08:00:00Z', updated_at: '2026-10-15T09:00:00Z', artifacts: { normalize: { preview_path: 'fixture.pdf' } } }));
  let state = initial;
  let readFailure = 0;
  let reads = 0;
  let done = 2;
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const evidence = { id: 'ev1', document_id: 'pilot-one', original_pages: [3], text: 'NETC 参数与适用条件，核对原件第三页。' };
  const scope = { schema_version: 1, summary: '候选范围必须人工核对，不等于已审批或发布。', topics: [{ label: '产品参数与边界', evidence_ids: ['ev1'] }], entities: [{ name: 'NETC', evidence_ids: ['ev1'] }], question_types: ['overview'], limitations: ['仅限当前资料版本'], unverified_notes: [], evidence: [evidence], coverage: { status: 'complete', unreadable_pages: [], catalog_completeness: 'unknown' } };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${path}`);
    let json: any = [];
    if (path === '/api/auth/status') json = { authenticated: true, account };
    else if (path === '/api/me') json = account;
    else if (path === '/api/preferences') json = { theme: 'light' };
    else if (path === '/api/health') json = { ok: true };
    else if (path === '/api/cron/jobs') json = { jobs: [] };
    else if (path === '/api/knowledge') json = [];
    else if (path.endsWith('/taxonomy')) json = { domains, bases };
    else if (path === '/api/admin/knowledge/documents') json = { documents: docs };
    else if (path === '/api/admin/knowledge/bases') json = { bases };
    else if (path === '/api/admin/knowledge/domains') json = { domains };
    else if (path === '/api/admin/knowledge/index-health') json = { ok: true, mode: 'fixture' };
    else if (path === '/api/admin/knowledge/workspace-v1') {
      const rows = docs.map(doc => ({ ...doc, kind: 'document', asset_type: 'document', family_id: 'ipd', domain_id: 'battery' }));
      const group = (key: string) => ({ all: rows.length, values: Object.fromEntries([...new Set(rows.map((row: any) => row[key]))].map(value => [value, rows.filter((row: any) => row[key] === value).length])) });
      json = { tenant: 'company', bases, domains, rows, total: rows.length, page: 1, page_size: 20, page_count: 1, facets: { view: group('status'), kind: group('kind'), brand: { all: 2, values: {}, unbranded: 2 }, stage: { all: 2, values: {}, empty: 2 }, family: group('family_id'), domain: group('domain_id'), base: group('base_id') }, stats: { status: { draft: 0, pending_review: 2, published: 0, archived: 0 }, pending_review: { count: 0, max_wait_days: 0 }, pending_documents: { count: 2, max_wait_days: 0 }, expiring: { count: 0, nearest: null } } };
    } else if (path.endsWith('/scope')) {
      reads++;
      if (readFailure) return route.fulfill({ status: readFailure, json: { detail: '范围读取暂时不可用' } });
      const id = path.split('/').at(-2)!;
      json = { document_id: id, revision: 1, explanation: '', state: state === 'candidate' ? 'candidate' : 'empty', scope: state === 'candidate' ? scope : null, fingerprint: 'fixture', frozen: false, handoff: { status: state === 'handoff' ? 'pending' : state === 'idle' ? 'none' : 'queued', requested_at: '2026-10-15T09:00:00Z' }, job: ['handoff', 'idle'].includes(state) ? null : { id: `job:${id}`, status: state === 'candidate' ? 'succeeded' : state, attempts: 1, max_attempts: 3, progress: { done: state === 'candidate' ? 4 : done, total: 4, unit: 'batches', last_progress_at: '2026-10-15T09:00:03Z' } }, actions: { edit: !['running', 'queued', 'retrying', 'uncertain', 'handoff'].includes(state), generate: ['idle', 'candidate', 'failed', 'cancelled'].includes(state), check: state === 'candidate' } };
    } else if (/\/documents\/pilot-(one|two)$/.test(path)) {
      const doc = docs.find(item => item.id === path.split('/').at(-1))!;
      json = { document: doc, base: bases[0], jobs: [], actions: { edit: doc.status === 'draft', start: doc.status === 'draft', retry: false, cancel: false, revision: doc.status !== 'draft' }, text_preview: { text: '提取文本并不保留原件版式。\n' + '长中文段落包含参数、限制、型号与完整原文依据。'.repeat(80) } };
    } else if (path.endsWith('/preview') || path.endsWith('/file')) {
      // Viewer URL/loading semantics only. Real PDF comparison is a separately labeled check.
      return route.fulfill({ status: 503, contentType: 'text/plain', body: 'HTTP fixture: use external verified PDF for fidelity comparison' });
    } else if (path.endsWith('/publication-v2/companies')) json = [{ id: 'company', name: '公司' }];
    else if (path.endsWith('/publication-v2')) json = { tenant: 'company', templates: [], publication: null, intake: { allowed: true, reason: '' } };
    await route.fulfill({ json });
  });
  await page.goto('/admin/knowledge?reviewCompany=company&stage=processing&assetId=pilot-one&assetType=document&mode=detail');
  await expect(page.locator('[data-workspace-mode="detail"]')).toBeVisible({ timeout: 15000 });
  return { writes, errors, get reads() { return reads; }, setState(value: string) { state = value; }, failReads(status: number) { readFailure = status; }, setProgress(value: number) { done = value; }, setDocumentStatus(status: string) { docs[0].status = status; } };
}
