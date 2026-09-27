# 连接器设置向导与技能唯一授权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把连接器的授权收口为「只对技能」，并把连接器设置做成弹窗内四步向导（保存 → 测试 → 工具清单只读 → 启用）。

**Architecture:** 后端把运行时执行校验从「员工×连接器 grant/范围」换成「技能授权 + 技能×工具绑定 + 内部门禁」，启用门禁改为「测试通过 + 已被至少一个技能绑定其工具」；前端把创建弹窗与枢纽配置弹窗统一到一个四步向导组件，工具清单只读，退役全部按人/按工具的授权入口。

**Tech Stack:** 后端 Hono + node:sqlite（`backend/src`，测试 vitest：`npm test`），前端 React 19 + Vite（`frontend/src`，Playwright E2E：`npm run test:e2e`）。样式 token 唯一来源 `docs/DESIGN.md` → `frontend/src/styles.css`。

**Spec:** `docs/superpowers/specs/2026-09-27-connector-setup-wizard-design.md`（已评审通过；修法记录见 `docs/DECISIONS.md` ADR-2026-09-27）

## Global Constraints

- 授权唯一单位＝技能；连接器/工具不按人授权，不提供任何按人/部门/岗位的授权入口。
- L1/L2/L3 内部门禁不变：L3（外发、导入、删除、解密、正式写入）仍走 Host Gateway 并留回执；host-only 工具仍拦截。
- 同一视口 0–1 个实底主 CTA；900 高视口内弹窗不滚动；状态不靠颜色；失败不吞错、不伪造完成。
- 不删除数据表、不做数据迁移；退役表保留数据、停止读写。
- 副作用不合并：保存 / 测试 / 启用各自独立，各自审计与回执。
- 本仓库约定：**不自动 git commit**（提交需用户明确要求）；任务收尾记录改动清单即可。
- 每次改动的验证命令：后端 `cd backend && npm run typecheck && npm test`；契约 `npm run validate:contracts`；前端 `cd frontend && npm run build`。

---

## 文件结构

**后端（阶段 A）**
- Modify `backend/src/runtime/store.ts`：新增 `connectorInUseBySkill()`。
- Modify `backend/src/runtime/execution.ts:85-112`：`authorizeConnector` 改为技能授权校验。
- Modify `backend/src/routers/enterprise.ts:295-368`：启用门禁换新 helper；退役 `/admin/users/:uid/connectors*` 端点；用户 DTO 去掉 connector grants。
- Delete `backend/src/routers/connector-organization.ts`；Modify `backend/src/app.ts`（解除挂载）。
- Tests：删 `backend/tests/connector-scope.test.ts`、`backend/tests/organization-scope.test.ts`；改写 `connector-employee-dto.test.ts`、`skill-runtime-execution.test.ts`、`skill-runtime-governance.test.ts`、`configurable-connectors.test.ts`、`managed-connectors.test.ts`、`connector-operations.test.ts` 中受影响断言。

**前端（阶段 B）**
- Create `frontend/src/admin/connector/connectorSetup.ts`（保存逻辑抽离 + 版本读回）。
- Create `frontend/src/admin/connector/ConnectorSetupWizard.tsx`（四步壳 + 测试/工具清单/启用面板）。
- Modify `ConnectorPanels.tsx`（`McpConfigPanel` 接入向导）、`ConnectorHub.tsx`（枢纽配置弹窗接入向导）、`ConnectorConfigCard.tsx`（支持 `embedded`/`onSaved`）。
- Modify `ConnectorToolsCard.tsx`、`ConnectorToolsDrawer.tsx`（去授权/范围，保留只读清单）。
- Delete `ConnectorGrantsCard.tsx`、`ConnectorScopeCard.tsx`、`frontend/src/pages/ConnectorUse.tsx`；Modify `App.tsx`、导航与 `AdminConsole.tsx`。
- Modify `frontend/src/api.ts`（删退役方法）、`docs/DESIGN.md`（§连接器控制台数值/元素）、`frontend/e2e/connector-admin.spec.ts` 等。

---

## 阶段 A：后端

### Task 1: 新 helper `connectorInUseBySkill` + 启用门禁

**Files:**
- Modify: `backend/src/runtime/store.ts`
- Modify: `backend/src/routers/enterprise.ts:295-307`
- Test: `backend/tests/configurable-connectors.test.ts`（新增用例）

**Interfaces:**
- Produces: `export function connectorInUseBySkill(connectorId: string): boolean` —— 存在「启用的技能→连接器绑定」且「该连接器下至少一条启用的技能→工具绑定」时返回 true。

- [ ] **Step 1: 写失败测试**（`backend/tests/configurable-connectors.test.ts` 追加）

```ts
it("enabling a verified connector requires a skill to bind one of its tools", async () => {
  const app = await testApp();                       // 沿用文件内既有工具函数
  const { id } = await createVerifiedConnector(app); // 复用文件内既有创建+probe 流程
  const blocked = await app.request(`/api/admin/connectors/${id}`, {
    method: "PATCH", headers: jsonAdminHeaders(), body: JSON.stringify({ enabled: true }),
  });
  expect(blocked.status).toBe(409);
  expect((await blocked.json()).code).toBe("connector_skill_binding_required");
  // 绑定技能 → 工具后同请求应成功
  await bindSkillTool(app, "creator_profile", id, "pageKolProfiles");
  const ok = await app.request(`/api/admin/connectors/${id}`, {
    method: "PATCH", headers: jsonAdminHeaders(), body: JSON.stringify({ enabled: true }),
  });
  expect(ok.status).toBe(200);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run tests/configurable-connectors.test.ts -t "skill"`
Expected: FAIL（`connector_tool_scope_required` 或 500/断言不符）

- [ ] **Step 3: 最小实现**

`backend/src/runtime/store.ts` 末尾追加：

```ts
/** 启用门禁：只要有一个启用的技能绑定了该连接器的启用工具，即视为"在用"。 */
export function connectorInUseBySkill(connectorId: string): boolean {
  ensureRuntimeSchema();
  const row = getConn().prepare(
    `SELECT 1 FROM runtime_skill_tools t
      JOIN runtime_skill_connectors c
        ON c.skill_id=t.skill_id AND c.connector_id=t.connector_id
     WHERE t.connector_id=? AND t.enabled=1 AND c.enabled=1 LIMIT 1`,
  ).get(assertIdentifier(connectorId, "connector_id"));
  return Boolean(row);
}
```

`backend/src/routers/enterprise.ts:295-307`：把 `connectorHasAnyScope(id)` 分支替换为

```ts
      if (!connectorInUseBySkill(id)) {
        throw new HttpFail(409, { code: "connector_skill_binding_required", connector_id: id });
      }
```

并删除 `connectorHasAnyScope` 的 import。

- [ ] **Step 4: 运行通过**

Run: `cd backend && npx vitest run tests/configurable-connectors.test.ts && npm run typecheck`
Expected: PASS

### Task 2: `authorizeConnector` 改为技能授权

**Files:**
- Modify: `backend/src/runtime/execution.ts:12,85-112`
- Test: `backend/tests/skill-runtime-execution.test.ts`（改断言）

**Interfaces:**
- Consumes: `connectorInUseBySkill` 不涉及；本任务只依赖 `user_skill_grants` 表与既有 `RuntimeContext{agentId,skillId,userId,runId}`。
- Produces: 同签名 `authorizeConnector(context, connectorId, access, toolName?, permitScopeResolution?)` —— 但授权判定改为「调用者持有该技能（或为管理员）」。

- [ ] **Step 1: 写失败测试**（`skill-runtime-execution.test.ts`）

```ts
it("denies execution when the invoking user lacks the skill grant", async () => {
  const { app } = await setupRuntime();                 // 复用文件内既有装配
  await grantSkillToUser("skill_user_missing", "creator_profile", false); // 不授予
  const response = await invokeTool(app, "creator_profile", "starrykol.pageKolProfiles", {});
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("runtime_skill_not_granted");
});

it("allows execution once the user holds the skill grant", async () => {
  await grantSkillToUser("skill_user_ok", "creator_profile", true);
  const response = await invokeTool(app, "creator_profile", "starrykol.pageKolProfiles", {});
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run tests/skill-runtime-execution.test.ts -t "skill grant"`
Expected: FAIL（当前按 connector grant 判定，未授权的连接器仍可能放行/报错码不同）

- [ ] **Step 3: 实现**

`backend/src/runtime/execution.ts`：删除 `connectorHasOrganizationScopes, userConnectorScopeAccess, userHasToolScope` 的 import（第 12 行），`authorizeConnector` 内从 `const scopeConfigured = ...` 到 `if (!permitScopeResolution && ...)` 一段整体替换为：

```ts
  if (!userHoldsSkill(context.userId, context.skillId)) {
    reject("runtime_skill_not_granted", 403);
  }
```

新增模块内私有函数（同文件底部）：

```ts
/** 技能授权：管理员放行；其余按 user_skill_grants 精确校验。 */
function userHoldsSkill(userId: string, skillId: string): boolean {
  const user = getConn().prepare("SELECT roles,active FROM users WHERE id=?").get(userId) as Row | undefined;
  if (!user?.active) return false;
  const roles = String(user.roles || "");
  if (roles.includes("admin")) return true;
  return Boolean(getConn().prepare("SELECT 1 FROM user_skill_grants WHERE user_id=? AND skill_id=?")
    .get(userId, skillId));
}
```

同时：`permitScopeResolution` 参数保留但不再参与判定（调用点旧行为见 `grep -rn "permitScopeResolution" backend/src`，逐个改为不传或传 false；若可安全删除则删除该参数与其调用点实参，测试同步）。

- [ ] **Step 4: 运行**

Run: `cd backend && npx vitest run tests/skill-runtime-execution.test.ts tests/skill-runtime-governance.test.ts && npm run typecheck`
Expected: PASS（若旧断言依赖范围语义，按新法条改写断言并在报告中列出）

### Task 3: 退役按人授权端点与范围路由

**Files:**
- Modify: `backend/src/routers/enterprise.ts:56,326-368`
- Delete: `backend/src/routers/connector-organization.ts`
- Modify: `backend/src/app.ts`（去掉 `connectorOrganizationRouter` 的 import 与 `app.route`）
- Modify: `backend/src/runtime/organization.ts`（暂不动；只确认无其它调用方）
- Tests: Delete `backend/tests/connector-scope.test.ts`、`backend/tests/organization-scope.test.ts`

- [ ] **Step 1: 写失败测试**（`backend/tests/connector-employee-dto.test.ts` 改写为契约断言）

```ts
it("no longer exposes per-user connector grants or scope endpoints", async () => {
  const app = await testApp();
  expect((await app.request("/api/admin/users/usr_x/connectors/starrykol", { method: "PUT", headers: jsonAdminHeaders(), body: "{}" })).status).toBe(404);
  expect((await app.request("/api/admin/runtime/connectors/starrykol/connector-scope", { headers: adminHeaders() })).status).toBe(404);
  expect((await app.request("/api/admin/runtime/connectors/starrykol/organization-scope", { headers: adminHeaders() })).status).toBe(404);
});
```

- [ ] **Step 2: 运行确认失败**（当前这些路由存在 → 200/400）
- [ ] **Step 3: 实现**：删除 `enterprise.ts` 中 `enterprise.put/delete("/admin/users/:uid/connectors/:id")` 与 `enterprise.put("/admin/users/:uid/connectors")` 三个路由；用户 DTO（:56 附近）删除 connector grants 字段（保留 `skill_grants`）；删除 `connector-organization.ts` 文件与 `app.ts` 挂载。
- [ ] **Step 4: 运行**

Run: `cd backend && npm test && npm run typecheck && npm run validate:contracts`
Expected: PASS（受影响测试同步改写；范围/授权相关测试删除）

### Task 4: 后端回归修补

- [ ] **Step 1:** `grep -rn "user_connector_grants\|connector-scope\|organization-scope\|connectorHasAnyScope\|userConnectorScopeAccess\|userHasToolScope" backend/src backend/tests` 逐处处理（源：删除；测试：改写为技能口径或删除）。
- [ ] **Step 2:** `cd backend && npm test && npm run typecheck && npm run validate:contracts && npm run release:gate`
- [ ] **Step 3:** 记录改动清单（不 commit）。

---

## 阶段 B：前端

### Task 5: 保存逻辑抽离与二次保存修复

**Files:**
- Create: `frontend/src/admin/connector/connectorSetup.ts`
- Modify: `frontend/src/admin/connector/ConnectorConfigCard.tsx`（改用抽离函数；新增 `embedded?: boolean`、`onSaved?: (version: number) => void`）
- Modify: `frontend/src/admin/connector/ConnectorPanels.tsx:367-410`（`saveConnectorSetup` 改用抽离函数并支持版本读回）

**Interfaces:**
- Produces:
  - `export async function readConnectorConfigVersion(connectorId: string): Promise<number>`（GET config；404 → 0）
  - `export async function saveConnectorConfigForm(input: { id: string; protocol; transport?; url?; urlEnv?; noAuth; timeoutMs?; headerRows; envRefs?; bearerRef?; bearerEnv?; httpTools? }, currentVersion: number): Promise<number>` —— 明文密钥先 `createRuntimeCredential`，再 `PUT .../config`（带 `expected_version: currentVersion`），返回新版本。

- [ ] **Step 1:** 写失败测试（`frontend/src/admin/connector/connectorSetup.test.ts`，vitest 已覆盖前端用例）

```ts
it("re-saves with the read-back version instead of a hardcoded zero", async () => {
  mockGetConfig({ version: 3 });
  const put = mockPutConfig();
  await saveConnectorConfigForm({ id: "starrykol", protocol: "mcp", transport: "streamable-http", url: "https://x/mcp", noAuth: true, headerRows: [] }, await readConnectorConfigVersion("starrykol"));
  expect(put).toHaveBeenCalledWith(expect.objectContaining({ expected_version: 3 }));
});
```

- [ ] **Step 2:** 运行确认失败 `cd frontend && npx vitest run src/admin/connector/connectorSetup.test.ts`
- [ ] **Step 3:** 实现抽离（把 `ConnectorPanels.tsx:367-396` 与 `ConnectorConfigCard.tsx:122-164` 的保存逻辑合并到 `connectorSetup.ts`），删掉 `expected_version: 0` 与 `createdRef` 短路（`ConnectorPanels.tsx:384,477`）。
- [ ] **Step 4:** `cd frontend && npx vitest run src/admin/connector && npm run typecheck`

### Task 6: 四步向导组件

**Files:**
- Create: `frontend/src/admin/connector/ConnectorSetupWizard.tsx`
- Test: `frontend/e2e/connector-admin.spec.ts`（新增向导用例）

**Interfaces:**
- Produces: `export function ConnectorSetupWizard(props: { mode: "create" | "configure"; connectorId?: string; label?: string; onClose: () => void; onDone: (message: string, tone?: "ok" | "warn") => void })`
- 步骤状态：`"save" | "test" | "tools" | "enable"`；每步一个实底主 CTA（`data-connector-wizard-primary`），其余动作描边/幽灵。
- 复用：第 3 步工具清单复用 `ConnectorToolsDrawer`/`ConnectorToolsCard` 的只读清单（`data-connector-tools-list`），**不新增第二套清单实现**。

- [ ] **Step 1: 写失败 E2E**（`connector-admin.spec.ts`）

```ts
test("wizard: save → test → read-only tools → enable", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/connectors`);
  await page.locator("[data-connector-create-toggle]").click();
  await page.locator("[data-connector-create-item='mcp']").click();
  await page.locator("[data-connector-field='label']").fill("Wizard MCP");
  await page.locator("[data-connector-field='url']").fill("http://127.0.0.1:8899/mcp");
  await page.locator("[data-connector-wizard-primary]").click();          // 保存
  await expect(page.locator("[data-connector-wizard-step='test']")).toBeVisible();
  await page.locator("[data-connector-wizard-test]").click();             // 测试
  await page.locator("[data-connector-wizard-tools-open]").click();       // 工具清单
  await expect(page.locator("[data-connector-tools-list]")).toBeVisible();
  await expect(page.locator("[data-connector-tools-authorize]")).toHaveCount(0); // 只读
});
```

- [ ] **Step 2:** 运行确认失败：`cd frontend && E2E_PORT=8876 npx playwright test e2e/connector-admin.spec.ts -g "wizard"`
- [ ] **Step 3:** 实现向导壳（步骤条 + 每步内容 + 回执区 + 失败态；测试步调 `api.probeRuntimeConnector`，工具步调 `api.runtimeConnectorDiscovery`，启用步调 `api.adminSave(PATCH {enabled:true})`；无技能绑定时启用按钮置灰并显示原因）。
- [ ] **Step 4:** 运行通过。

### Task 7: 两个弹窗接入向导

**Files:** Modify `ConnectorPanels.tsx`（`McpConfigPanel` 的 body/footer 换成向导步骤 1 字段集）、`ConnectorHub.tsx:184,201-217`（配置弹窗与创建面板渲染向导）。

- [ ] **Step 1:** E2E：枢纽卡片打开配置弹窗后同样出现四步（`data-connector-wizard-step` 存在）。
- [ ] **Step 2:** 实现：`mode="create"` 复用现有 MCP 字段（名称/传输/URL/密钥）+ `createConnectorRecord`；`mode="configure"` 渲染 `ConnectorConfigCard embedded`。
- [ ] **Step 3:** 验证 `cd frontend && npm run typecheck && npx playwright test e2e/connector-admin.spec.ts`。

### Task 8: 工具清单只读化

**Files:** Modify `ConnectorToolsCard.tsx`、`ConnectorToolsDrawer.tsx`（删除逐工具 risk/access/scope 表单与「授权给…」交互，保留名称+描述+风险档只读展示与刷新）。

- [ ] **Step 1:** E2E 断言：工具行内不存在 `[data-connector-tool-save]`、`[data-connector-scope-save]`、授权控件。
- [ ] **Step 2:** 实现并跑 `npx playwright test e2e/connector-admin.spec.ts`。

### Task 9: 退役员工面与授权卡片

**Files:** Delete `ConnectorGrantsCard.tsx`、`ConnectorScopeCard.tsx`、`frontend/src/pages/ConnectorUse.tsx`；Modify `App.tsx:23,63`（删 `/connectors` 路由）、导航（`layout/*`）与 `AdminConsole.tsx`（删连接器授权 UI）、`api.ts`（删 `saveRuntimeToolScope`/`saveRuntimeConnectorScope`/organization-scope/connector-grants 方法）。

- [ ] **Step 1:** `grep -rn "ConnectorUse\|ConnectorGrantsCard\|ConnectorScopeCard\|saveRuntimeToolScope\|saveRuntimeConnectorScope" frontend/src` 清点并删除引用。
- [ ] **Step 2:** `cd frontend && npm run build`；`npx playwright test e2e/workbench.spec.ts e2e/skills-catalog.spec.ts`（更新受影响断言）。

### Task 10: DESIGN.md 与版式 E2E

**Files:** Modify `docs/DESIGN.md` §连接器控制台（弹窗步骤元素集与数值）、`frontend/e2e/connector-admin.spec.ts`（版式用例）、必要时 `frontend/src/styles.css`。

- [ ] **Step 1:** 按新弹窗元素（步骤条、次级按钮、回执区）更新 DESIGN.md 的元素清单与数值表。
- [ ] **Step 2:** 更新版式用例（900 高无滚动、0–1 实底 CTA、步骤条可见），跑通整套 `npx playwright test e2e/connector-admin.spec.ts`。

---

## 阶段 C：清理与文档

### Task 11: 全量验证与第二批文档同步

- [ ] **Step 1:** 后端：`cd backend && npm run typecheck && npm test && npm run validate:contracts && npm run release:gate`
- [ ] **Step 2:** 前端：`cd frontend && npm run build && npm run typecheck && npm run test:e2e`
- [ ] **Step 3:** 文档第二批（按设计稿 §5 清单）：`docs/skill-runtime-operations.md:13-14,46,98`、`docs/connector-runtime-implementation.md:45`、`docs/mail-skill-knowledge-flow.md:49`、`docs/connector-governance-ux-review-2026-09-26.md:46,83,98`、`docs/superpowers/specs/2026-09-22-composer-and-menus-review.md`、`2026-09-25-skill-runtime-bindings.md`。
- [ ] **Step 4:** 只读证据留档：绑定行 → 启用 200 / 无绑定 → 409；审计事件三类各一份；写入报告。

---

## Self-Review

- **Spec 覆盖**：四步向导（Task 6/7）、只读工具清单（Task 8）、技能唯一授权（Task 2）、启用门禁（Task 1）、退役清单（Task 3/8/9）、二次保存修复（Task 5）、DESIGN/E2E（Task 10）、第二批文档（Task 11）——全覆盖。
- **占位符**：无 TBD；未知项（如测试工具函数名）在任务里以「复用文件内既有 X」指明定位方式，执行者需先读文件再落代码。
- **类型一致性**：`connectorInUseBySkill(connectorId: string): boolean`、`readConnectorConfigVersion(connectorId: string): Promise<number>`、`saveConnectorConfigForm(input, currentVersion): Promise<number>` 在后续任务中引用一致。
