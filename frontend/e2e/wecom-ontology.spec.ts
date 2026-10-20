import { expect, test, type Page } from '@playwright/test';
import type { OntologyCatalog, OntologyDefinition, OntologyDocument } from '../../shared/ontology';
import { wecomOntologyFieldBindings, wecomOntologyObjectMappings, type WecomPreviewResponse, type WecomSnapshotPage, type WecomStatusResponse } from '../../shared/wecom-ontology';

const organization: OntologyDefinition = {
  code: 'org_unit', id: 'org-unit', name: '组织', description: '企业组织单元定义', layer: 'platform', taxonomy: ['人力资源', '组织与人员', '组织'], source: '组织本体目录',
  items: { properties: [], relations: [], events: [], rules: [], actions: [] },
};
const ontologyDocument: OntologyDocument = { code: 'org_unit', revision: 3, draft: null, published: organization, status: 'published', updatedAt: '2026-10-20T06:00:00.000Z' };

const sourceVersion = { source: 'wecom', version: 9, departmentBatchId: 'dept-batch', userBatchId: 'user-batch', publishedAt: '2026-10-20T05:00:00.000Z', lastSyncedAt: '2026-10-20T06:00:00.000Z' };
const status: WecomStatusResponse = {
  source: 'wecom', companyId: 'company:test', scope: { explicitCompanyScope: true, requiredRole: 'company_admin' },
  runtimeBinding: {
    executionPath: 'platform-sync-skill', agentId: 'agent:platform-sync', skillId: 'skill:wecom-directory', connectorId: 'wecom-mcp', bindingFingerprint: 'binding:v1',
    tools: { syncStatus: 'wecom_get_sync_status', departments: 'wecom_list_departments', users: 'wecom_list_department_users' },
    bindingVersions: { agentSkill: 1, connectorConfig: 1, connectorBinding: 1, tools: { syncStatus: { skillTool: 1, policy: 1 }, departments: { skillTool: 1, policy: 1 }, users: { skillTool: 1, policy: 1 } } },
  },
  syncStatus: { source: 'wecom', version: 9, lastSyncedAt: sourceVersion.lastSyncedAt, errorCode: null, retryable: false, data: { initialized: true, queryEnabled: true, publishedVersion: 3, publishedDepartmentBatchId: 'dept-batch', publishedUserBatchId: 'user-batch', publishedDepartmentBatch: { id: 'dept-batch', status: 'SUCCESS', departmentCount: 2 }, publishedUserBatch: { id: 'user-batch', status: 'SUCCESS', userCount: 2, relationCount: 2 }, publishedAt: sourceVersion.publishedAt } },
  fieldBindings: wecomOntologyFieldBindings,
  objectMappings: wecomOntologyObjectMappings,
  importContract: { mode: 'confirmed_snapshot_only', doesNotWrite: ['organization_units', 'organization_people', 'organization_memberships', 'users', 'agent_bindings'], hrStatus: 'not_inferred' },
};

const preview: WecomPreviewResponse = {
  previewToken: 'preview-1', companyId: 'company:test', expiresAt: '2026-10-20T07:00:00.000Z', contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', bindingFingerprint: 'binding:v1', sourceVersion,
  rootDepartmentExternalIds: ['wecom:company:test:department:1'],
  rows: [
    { externalId: 'wecom:company:test:department:1', tenantId: 'company:test', source: 'wecom', kind: 'department', objectCode: 'org_unit', upstreamId: '1', ontologyProperties: { wecom_name: '研发部', wecom_parent_id: null, wecom_leader_user_ids: ['u1'] }, attributes: { name: '研发部', parentId: null }, relations: { wecom_leaders: ['wecom:company:test:person:u1'] } },
    { externalId: 'wecom:company:test:person:u1', tenantId: 'company:test', source: 'wecom', kind: 'person', objectCode: 'user', upstreamId: 'u1', ontologyProperties: { wecom_name: '王工', wecom_position_text: '研发工程师', wecom_main_department_id: '1', wecom_direct_leader_ids: ['u2'], wecom_departments: ['1'] }, attributes: { name: '王工', position: '研发工程师', mainDepartmentId: '1', directLeaderUserIds: ['u2'], departments: ['1'] }, relations: { wecom_member_departments: ['wecom:company:test:department:1'], wecom_direct_leaders: ['wecom:company:test:person:u2'] } },
    { externalId: 'wecom:company:test:membership:u1:1', tenantId: 'company:test', source: 'wecom', kind: 'membership', objectCode: 'membership', upstreamId: 'u1:1', ontologyProperties: { wecom_member_user_id: 'u1', wecom_department_id: '1', wecom_is_main: true, wecom_is_leader: false }, attributes: { userId: 'u1', departmentId: '1', isMain: true, isLeader: false }, relations: { wecom_member: 'wecom:company:test:person:u1', wecom_organization: 'wecom:company:test:department:1' } },
  ],
  counts: { department: 1, person: 1, membership: 1 }, warnings: [], complete: true,
};
const snapshot: WecomSnapshotPage = { tableVersion: 'wecom-ontology-source-snapshot.v1', snapshotId: 'snapshot-1', companyId: 'company:test', sourceVersion, rootDepartmentExternalIds: preview.rootDepartmentExternalIds, rows: preview.rows, nextCursor: null, pageSize: 20, kind: null };

async function fixture(page: Page, options: { admin?: boolean; source401?: boolean } = {}) {
  const admin = options.admin !== false;
  const account = { id: admin ? 'admin' : 'employee', username: 'wecom-fixture', name: '企微夹具用户', roles: admin ? ['admin', 'employee'] : ['employee'], available_modes: admin ? ['admin', 'employee'] : ['employee'], brands: [] };
  let commits = 0;
  let commitBody: Record<string, unknown> | null = null;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/ontology/workspace/catalog') {
      const catalog: OntologyCatalog = { context: { companyId: 'company:test', companies: [{ id: 'company:test', name: '测试公司' }], admin }, relevance: { configured: true, relatedDomains: [], matchedMappings: [], owners: [] }, sourceVersion: 'fixture', objects: [ontologyDocument] };
      await route.fulfill({ json: catalog }); return;
    }
    if (path === '/api/ontology/workspace/wecom/status') {
      expect(route.request().headers()['x-ontology-company']).toBe('company:test');
      expect(url.searchParams.get('companyId')).toBe('company:test');
      if (options.source401) { await route.fulfill({ status: 401, json: { detail: { code: 'wecom_company_admin_required', message: '仅公司管理员可管理企微本体来源' } } }); return; }
      await route.fulfill({ json: status }); return;
    }
    if (path === '/api/ontology/workspace/wecom/preview') { await route.fulfill({ json: preview }); return; }
    if (path === '/api/ontology/workspace/wecom/commit') {
      commits += 1; commitBody = route.request().postDataJSON();
      await route.fulfill({ json: { receiptId: 'receipt-1', snapshotId: 'snapshot-1', companyId: 'company:test', source: 'wecom', sourceVersion, contentHash: preview.contentHash, rowCounts: preview.counts, reason: commitBody.reason, createdAt: '2026-10-20T06:30:00.000Z' } }); return;
    }
    if (path === '/api/ontology/workspace/wecom/snapshot') {
      expect(url.searchParams.get('companyId')).toBe('company:test');
      expect(route.request().headers()['x-ontology-company']).toBe('company:test');
      await route.fulfill({ json: snapshot }); return;
    }
    if (path === '/api/auth/status' || path === '/api/me') { await route.fulfill({ json: { authenticated: true, account } }); return; }
    if (path === '/api/me/preferences') { await route.fulfill({ json: {} }); return; }
    if (path === '/api/sessions' || path === '/api/tasks') { await route.fulfill({ json: [] }); return; }
    if (path === '/api/health') { await route.fulfill({ json: { ok: true } }); return; }
    if (path === '/api/version') { await route.fulfill({ json: { version: 'wecom-ontology-fixture' } }); return; }
    await route.fulfill({ json: {} });
  });
  return { commits: () => commits, commitBody: () => commitBody };
}

test('admin previews and explicitly imports a versioned WeCom source snapshot without route or organization mutation', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/admin/ontology?object=org_unit&dimension=relations');
  const originalUrl = page.url();
  await page.getByLabel('对象更多操作').click();
  await page.getByRole('button', { name: '企业微信来源', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('组织与人员来源快照')).toBeVisible();
  await expect(drawer.getByText('当前可读来源可能为历史快照')).toBeVisible();
  await expect(drawer.getByText('职位仅是职位文本，不等于岗位编制、HR 合同或实时人事档案')).toBeVisible();
  await drawer.getByRole('button', { name: '生成来源预览', exact: true }).click();
  await expect(drawer.getByText('候选预览 · 尚未导入')).toBeVisible();
  const confirm = drawer.getByRole('button', { name: '确认导入来源快照', exact: true });
  await expect(confirm).toBeDisabled();
  await drawer.getByLabel('导入原因').fill('核对组织和人员来源快照');
  await drawer.getByLabel(/我已核对来源、版本、候选数量与影响边界/).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(drawer.getByText('真实导入回执 receipt-1')).toBeVisible();
  expect(state.commits()).toBe(1);
  expect(state.commitBody()).toMatchObject({ companyId: 'company:test', confirmed: true, previewToken: 'preview-1', contentHash: preview.contentHash, reason: '核对组织和人员来源快照' });
  await expect(drawer.getByText('王工', { exact: true })).toBeVisible();
  await expect(drawer.getByText(/直属上级/)).toBeVisible();
  await page.screenshot({ path: 'test-results/wecom-ontology/admin-source-panel.png', fullPage: true, animations: 'disabled' });
  await drawer.locator('.wecom-source-footer').getByRole('button', { name: '关闭', exact: true }).click();
  expect(page.url()).toBe(originalUrl);
});

test('employee has no WeCom source entry, and a 401 source response never offers a preview', async ({ page }) => {
  await fixture(page, { admin: false });
  await page.goto('/admin/ontology');
  await expect(page.getByRole('alert')).toContainText('需要本体治理管理权限');
  await expect(page.getByRole('button', { name: '企业微信来源', exact: true })).toHaveCount(0);

  await fixture(page, { source401: true });
  await page.goto('/admin/ontology?object=org_unit');
  await page.getByLabel('对象更多操作').click();
  await page.getByRole('button', { name: '企业微信来源', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('来源当前不可用')).toBeVisible();
  await expect(drawer.getByRole('button', { name: '生成来源预览', exact: true })).toHaveCount(0);
});

test('narrow source drawer keeps the outer page within the viewport while records remain internally scrollable', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/ontology?object=org_unit');
  await page.getByLabel('对象更多操作').click();
  await page.getByRole('button', { name: '企业微信来源', exact: true }).click();
  await page.getByRole('button', { name: '生成来源预览', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('候选预览 · 尚未导入')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/wecom-ontology/narrow-source-panel.png', fullPage: true });
});
