import { expect, test, type APIRequestContext } from "@playwright/test";
import { processExecutionJobById } from "../../backend/src/execution-jobs/dispatcher";
import { prepareNativeKnowledgeAdmin } from "./fixtures/native-knowledge-admin";

const PRODUCT_BASE_CODE = "e2e_product_knowledge";

type ProductBase = { id: string; code: string; name: string; status: string };
type ProductDomain = { id: string; code: string };

async function responseJson<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, message: string): Promise<T> {
  expect(response.ok(), `${message}：${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

/**
 * 测试只使用当前 persona 有权管理的、固定命名的非结构化库；不会放开 409
 * 或绕过知识/Agent 的服务端授权。夹具可复用，避免测试顺序依赖。
 */
async function ensureProductBase(request: APIRequestContext): Promise<ProductBase> {
  const bases = await responseJson<{ bases: ProductBase[] }>(
    await request.get("/api/admin/knowledge/bases"),
    "读取受权知识库夹具失败",
  );
  const existing = bases.bases.find((base) => base.code === PRODUCT_BASE_CODE);
  if (existing) return existing;

  const domains = await responseJson<{ domains: ProductDomain[] }>(
    await request.get("/api/admin/knowledge/domains"),
    "读取受权知识分类夹具失败",
  );
  let family = domains.domains.find((domain) => domain.code === `${PRODUCT_BASE_CODE}_family`);
  if (!family) {
    family = (await responseJson<{ domain: ProductDomain }>(
      await request.post("/api/admin/knowledge/domains", {
        data: { code: `${PRODUCT_BASE_CODE}_family`, name: "E2E 产品资料", level: "family" },
      }),
      "创建受权产品资料族失败",
    )).domain;
  }
  let domain = domains.domains.find((item) => item.code === `${PRODUCT_BASE_CODE}_domain`);
  if (!domain) {
    domain = (await responseJson<{ domain: ProductDomain }>(
      await request.post("/api/admin/knowledge/domains", {
        data: { code: `${PRODUCT_BASE_CODE}_domain`, name: "E2E 产品规格", level: "domain", parent_id: family.id },
      }),
      "创建受权产品资料域失败",
    )).domain;
  }
  return (await responseJson<{ base: ProductBase }>(
    await request.post("/api/admin/knowledge/bases", {
      data: { code: PRODUCT_BASE_CODE, name: "E2E 产品资料库", kind: "unstructured", domain_id: domain.id },
    }),
    "创建受权非结构化知识库失败",
  )).base;
}

test.beforeAll(async () => { await prepareNativeKnowledgeAdmin(); });

test.beforeEach(async ({ page }) => {
  // 所有管理请求都继承全局登录建立的真实同一 principal；不再通过 persona 端点提升身份。
  const status = await page.request.get("/api/auth/status");
  expect(status.ok(), `读取当前认证状态失败：${status.status()} ${await status.text()}`).toBeTruthy();
  await expect.poll(async () => (await page.request.get("/api/auth/status")).json()).toMatchObject({ authenticated: true });
});

test("PDF 草稿可见并独立解析", async ({ page }) => {
  const request = page.request;
  const suffix = Date.now().toString();
  const base = await ensureProductBase(request);
  await page.goto("/admin/knowledge?stage=create");
  await page.locator("[data-kbv-upload]").click();
  const upload = page.locator("[data-kbv-upload-dialog]");
  await upload.locator(`[data-kb-scope-base="${base.id}"]`).click();
  await upload.locator("[data-kbv-upload-pick]").setInputFiles({ name: `产品规格-${suffix}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nProduct fixture\n%%EOF") });
  // UploadDialog keeps fields in the rail while WorkspaceActions renders the
  // current semantic submit action outside that region.
  const uploadSubmit = page.locator("[data-kbv-upload-submit]");
  await expect(uploadSubmit).toBeEnabled();
  await uploadSubmit.click();
  await expect(upload).not.toBeVisible();
  const documents = await responseJson<{ documents: Array<{ id: string; title: string; status: string }> }>(
    await request.get(`/api/admin/knowledge/documents?base=${base.id}`),
    "读取上传资料失败",
  );
  const doc = documents.documents.find((item) => item.title === `产品规格-${suffix}`);
  expect(doc, "上传的 PDF 应在指定非结构化库中留下独立资料记录").toBeTruthy();
  await expect.poll(async () => {
    const detail = await responseJson<{ document: { status: string } }>(
      await request.get(`/api/admin/knowledge/documents/${doc!.id}`),
      "读取资料解析状态失败",
    );
    return detail.document.status;
  }, { timeout: 15000, message: "PDF 解析应推进到待审批，而不能伪造已发布" }).toBe("pending_review");
  const pending = await responseJson<{ state: string; job?: { id?: string } | null }>(
    await request.get(`/api/admin/knowledge/documents/${doc!.id}/scope`),
    '读取资料真实持久范围作业失败',
  );
  expect(pending.state).toBe('empty');
  expect(pending.job?.id, '上传后须真正持久化范围作业').toEqual(expect.any(String));
  expect(await processExecutionJobById(pending.job!.id!, 'product-knowledge-real-scope')).toMatchObject({
    execution_job_id: pending.job!.id, job_type: 'knowledge.scope', handled: true, outcome: 'processed',
  });
  await expect.poll(async () => (await responseJson<{ state: string }>(
    await request.get(`/api/admin/knowledge/documents/${doc!.id}/scope`), '读取范围提炼终态失败',
  )).state, { timeout: 15000 }).toBe('candidate');
  const detail = page.locator("[data-knowledge-right][data-workspace-mode='detail']");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".kbv-document-title")).toHaveText(`产品规格-${suffix}`);
  // Parsing is not approval: the real completed range is still awaiting
  // explicit human checking, while the document remains unpublished.
  await expect(detail).toContainText('范围待核对', { timeout: 15000 });
  const final = await responseJson<{ document: { status: string } }>(await request.get(`/api/admin/knowledge/documents/${doc!.id}`), '读取未发布资料状态失败');
  expect(final.document.status).toBe('pending_review');
});

test("文档问答技能可绑定非结构化库", async ({ page }) => {
  const request = page.request;
  const suffix = Date.now().toString();
  const base = await ensureProductBase(request);
  const skillId = `product_test_${suffix}`;
  await page.goto("/admin/skills");
  await page.getByRole("button", { name: "新增技能", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增技能" });
  await dialog.getByLabel("技能 Key（snake_case）").fill(skillId);
  await dialog.getByLabel("名称", { exact: true }).fill(`产品咨询 ${suffix}`);
  await dialog.getByLabel("说明（Markdown）").fill("查询产品规格，返回原文页码，不编造参数。");
  const readonlyQuery = dialog.getByRole('checkbox', { name: '非结构化文档问答（L1 只读；知识库在 Agent 页绑定）', exact: true });
  await readonlyQuery.check();
  await expect(readonlyQuery).toBeChecked();
  await dialog.getByRole("button", { name: "创建技能", exact: true }).click();
  await expect(dialog).not.toBeVisible();

  // The creation checkbox establishes the ordinary SKU's document-query
  // capability.  Persist the same tool as the SKU's supported lifecycle
  // draft through its real management endpoint; saving a draft neither
  // changes the current definition nor publishes it.
  const toolDraft = await responseJson<{ id: string; patch: { mcp?: unknown }; updated_at: string | null }>(
    await request.put(`/api/admin/skills/${encodeURIComponent(skillId)}/draft`, {
      data: { mcp: ["knowledge.ask_documents"] },
    }),
    "保存文档问答技能草稿失败",
  );
  expect(toolDraft.id).toBe(skillId);
  expect(toolDraft.patch.mcp).toEqual(["knowledge.ask_documents"]);

  // The management binding form does not offer un-published SKUs or an
  // explicit `base_ids` selector.  Use the same authenticated admin API that
  // it calls, rather than inventing a second form or changing publication.
  // This is the runtime's document-dependency fact source: a disabled record
  // deliberately keeps the dependency as a draft and cannot be resolved.
  const saved = await responseJson<{
    id: string;
    skill_id: string;
    selector: Record<string, unknown>;
    enabled: number | boolean;
  }>(
    await request.post("/api/admin/knowledge/bindings", {
      data: {
        skill_id: skillId,
        selector: { base_ids: [base.id] },
        enabled: false,
        note: "E2E 草稿文档依赖；未发布、未注入",
      },
    }),
    "保存文档问答草稿依赖失败",
  );
  expect(saved.id, "真实管理绑定 API 必须返回持久记录 id").toEqual(expect.any(String));
  expect(saved.skill_id).toBe(skillId);
  expect(Number(saved.enabled)).toBe(0);
  expect(saved.selector).toEqual({ base_ids: [base.id] });

  const persisted = await responseJson<Array<{
    id: string;
    skill_id: string;
    selector: Record<string, unknown>;
    enabled: number | boolean;
  }>>(
    await request.get("/api/admin/knowledge/bindings"),
    "回读文档问答草稿依赖失败",
  );
  expect(persisted.find((binding) => binding.id === saved.id)).toMatchObject({
    id: saved.id,
    skill_id: skillId,
    enabled: 0,
    selector: { base_ids: [base.id] },
  });

  const draft = await responseJson<{ patch: { mcp?: unknown } }>(
    await request.get(`/api/admin/skills/${encodeURIComponent(skillId)}/draft`),
    "读取文档问答技能草稿失败",
  );
  expect(draft.patch.mcp, "文档问答工具必须仍是未发布草稿的一部分").toEqual(["knowledge.ask_documents"]);
  const skillDirectory = await responseJson<{
    skills: Array<{
      id: string;
      grants?: { org: string[]; team: string[]; user: string[] };
      lifecycle?: { stage?: string; current_version?: number | null; release?: { kind?: string } };
    }>;
  }>(
    await request.get("/api/admin/skills"),
    "读取新建技能生命周期失败",
  );
  const createdSkill = skillDirectory.skills.find((skill) => skill.id === skillId);
  expect(createdSkill, "新建 SKU 必须仍在真实技能目录中").toBeTruthy();
  expect(createdSkill?.lifecycle?.stage).toBe("draft");
  expect(createdSkill?.lifecycle?.current_version ?? null).toBeNull();
  expect(createdSkill?.lifecycle?.release?.kind ?? "none").toBe("none");
  expect(createdSkill?.grants ?? { org: [], team: [], user: [] }).toEqual({ org: [], team: [], user: [] });

  const agents = await responseJson<{ agents: Array<{ skills: Array<{ skill_id: string; enabled: boolean | number }> }> }>(
    await request.get("/api/admin/agents"),
    "读取 Agent 装配关系失败",
  );
  expect(agents.agents.some((agent) => agent.skills.some((skill) => skill.skill_id === skillId && Boolean(skill.enabled)))).toBe(false);

  // The SKU detail's current “知识” tab reads `knowledge_bindings`.  It is a
  // review projection only: it must show this disabled draft record without
  // creating an Agent, granting direct access, publishing the skill, or
  // treating a draft dependency as a resolved document scope.
  await page.goto(`/admin/skills?skillId=${encodeURIComponent(skillId)}`);
  await page.getByRole("button", { name: "知识", exact: true }).click();
  const knowledgeBindings = page.locator("section[aria-labelledby='skill-knowledge-heading']");
  await expect(knowledgeBindings).toBeVisible();
  await expect(knowledgeBindings.locator(".skill-knowledge-row")).toHaveCount(1);
  await expect(knowledgeBindings.locator(".skill-knowledge-row")).toContainText("已停用");
});
