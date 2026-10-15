import { expect, test, type APIRequestContext } from "@playwright/test";
import { prepareNativeKnowledgeAdmin } from "./fixtures/native-knowledge-admin";

const PRODUCT_BASE_CODE = "e2e_product_knowledge";

type ProductBase = { id: string; code: string; status: string };
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

test.beforeEach(async ({ request }) => {
  // 使用系统已有的产品经理账号建立授权，再选择 E2E persona；不把 401/403/409 视作可忽略错误。
  const login = await request.post("/api/login", { data: { username: "jeffrey", password: "123456789" } });
  expect(login.ok(), `初始化产品经理授权失败：${login.status()} ${await login.text()}`).toBeTruthy();
  const persona = await request.post("/api/me/persona", { data: { persona: "sriphy" } });
  expect(persona.ok(), `初始化测试 persona 失败：${persona.status()} ${await persona.text()}`).toBeTruthy();
});

test("PDF 草稿可见并独立解析", async ({ page, request }) => {
  const suffix = Date.now().toString();
  const base = await ensureProductBase(request);
  await page.goto("/admin/knowledge?stage=create");
  await page.locator("[data-kbv-upload]").click();
  const upload = page.locator("[data-kbv-upload-dialog]");
  await upload.locator(`[data-kb-scope-base="${base.id}"]`).click();
  await upload.locator("[data-kbv-upload-pick]").setInputFiles({ name: `产品规格-${suffix}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nProduct fixture\n%%EOF") });
  await upload.getByRole("button", { name: "上传并开始解析", exact: true }).click();
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
  await expect(page.locator("[data-workspace-mode='detail']")).toBeVisible();
  await expect(page.locator("[data-knowledge-right]")).toContainText("待审批");
});

test("文档问答技能可绑定非结构化库", async ({ page, request }) => {
  const suffix=Date.now().toString();
  const base=await ensureProductBase(request);
  const skillId = `product_test_${suffix}`;
  await page.goto("/admin/skills");
  await page.getByRole("button", { name: "新增技能", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增技能" });
  await dialog.getByLabel("技能 Key（snake_case）").fill(skillId);
  await dialog.getByLabel("名称", { exact: true }).fill(`产品咨询 ${suffix}`);
  await dialog.getByLabel("说明（Markdown）").fill("查询产品规格，返回原文页码，不编造参数。");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "创建技能", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const agent = await (await request.post("/api/admin/agents", { data: { name: `产品专家 ${suffix}` } })).json();
  expect((await request.put(`/api/admin/agents/${agent.id}/skills/${skillId}`, { data: { enabled: true, expected_version: 0 } })).ok()).toBe(true);
  await page.goto("/admin/agents");
  await page.getByRole("button").filter({ hasText: `产品专家 ${suffix}` }).click();
  await page.getByLabel("调用技能").selectOption(skillId);
  await page.getByLabel("知识库").selectOption(base.id);
  await page.getByRole("button", { name: "绑定知识库", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("知识库已绑定到技能");
});
