# 连接器设置向导与「对外只暴露技能」授权模型（设计稿）

- 日期：2026-09-27
- 状态：**待用户评审**（评审通过后进入 writing-plans 出实施计划；代码未动）
- 依据：`CONSTITUTION.md` CONST-02（2026-09-27 修订）、[DECISIONS.md](../../DECISIONS.md) ADR-2026-09-27「对外只暴露技能」
- 取代：`2026-09-26-connector-admin-console-redesign.md` 中「逐工具范围 / 行内授权 / 批量授权 / 连接器级组织范围 / 员工 read/write」部分（该文已加修订注记）；`2026-09-26-mcp-connector-admin-governance.md` 中按部门/岗位/个人授权部分。

## 1. 审宪记录（CONST-08）

| 项 | 结论与证据 |
|---|---|
| 需求 | 对外（员工）只暴露技能；连接器、MCP 工具与 API 不由人直接调用；人员授权只对技能。连接器设置弹窗内完成：保存（建连接器 + 存接入配置）→ 测试 → 工具清单（只读）→ 启用；不做逐工具/按人授权。 |
| 主责角色 | 平台产品经理（对外能力面、员工面）；权限域（org-permissions）；架构师/后端专家（执行校验与启用门禁）；UI/UX 专家（弹窗落点与版式）；宪法修订由用户裁定（CONST-09）。 |
| 宪法条款 | CONS-02（本次追加：连接器属内核能力，对外能力面只有技能）；CONST-03（Agent 以技能/知识/工具编排——支持技能作为唯一对外单位）；CONST-05（L3 确认与回执不放松）；CONST-08/09（修宪与修法记录）；CONST-10（验收证据）。 |
| 基本法条款 | `PRODUCT.md` PROD-PLAT-04 / PROD-PLAT-05（已修订）；`TECHNOLOGY.md` TECH-BE-07（已修订）、TECH-BE-01/02/03（执行校验与回执不变）；`org-permissions.md`（员工连接器使用面与按人授权段落已废止）；`ia-information-architecture.md` 能力面 #6（已废止）。 |
| 结论与证据 | **符合**：目标合宪（宪法未要求对外暴露连接器），冲突全部在基本法/细则，已按 CONST-09 原位修订并保留废止记录；`07-mcp-data-contract.md` 的 L1/L2/L3 内部门禁刻意保留，不因"只暴露技能"放松。 |
| 下一步 | 本设计稿评审 → 实施计划（writing-plans）→ 分阶段落地与验证。 |

## 2. 修法记录（CONST-09）

- **变更原因**：按人/按工具的授权层导致管理过细、无法干活（用户 2026-09-27 裁决）。
- **已落地修订**：`CONSTITUTION.md`（版本 2.1，CONST-02 追加一段 + 修订记录）；`PRODUCT.md` PROD-PLAT-04/05；`TECHNOLOGY.md` TECH-BE-07；`org-permissions.md`（员工使用面整节废止、员工 read/write 行改为技能可用、Agents 矩阵改技能 × 工具绑定、导航与审计表述同步）；`ia-information-architecture.md`（能力面 #6、使用≠治理表、资产簇）；两份连接器规格加修订注记；`DECISIONS.md` 新增本 ADR 并在两条既有 ADR 上加取代注记。
- **替代条款**：人员授权单位＝技能（`user_skill_grants`）；连接器启用门禁＝测试通过 + 已被至少一个技能绑定其工具。
- **保留不变**：`07-mcp-data-contract.md` 工具风险目录（L1/L2/L3）、L3 确认与回执、host-only 拦截、工具指纹（schema_hash）、`DESIGN.md` 视觉细则。
- **生效版本**：随本设计稿的实现同批发布；修法先于代码落地，期间代码现状与法条不一致处按本设计稿修正。

## 3. 授权模型（新）

**唯一授权单位＝技能。** 执行链（每层都必须通过）：

1. **技能授权**：调用者持有该技能（`user_skill_grants`；管理员放行）——`requireSkill()`（`backend/src/auth.ts:445`）。
2. **技能 × 连接器 / 技能 × 工具绑定**：技能声明要用哪些工具（`runtime_skill_connectors` + `runtime_skill_tools`，技能侧决定；绑定不要求连接器已启用——`backend/src/runtime/store.ts:589-618`）。
3. **内部门禁**：工具策略（enabled / risk L1-L3 / access / schema_hash 指纹）、host-only 拦截、L1/L2 放行、**L3 走 Host Gateway**（`backend/src/runtime/execution.ts:188`）。
4. **连接器启用**：`connectors.enabled`（运行时硬门禁，`execution.ts:92`）。

**退役（不再参与运行时校验，数据保留、不删除、不迁移）：**

| 退役对象 | 位置 | 说明 |
|---|---|---|
| 员工 × 连接器 read/write | `user_connector_grants` + `/admin/users/:uid/connectors*` | 人员授权只对技能 |
| 连接器级组织范围 | `runtime_connector_scope_policies/_bindings` + `connector-scope` 接口 | 不再作为授权手段 |
| 工具级范围 | `runtime_tool_scope_bindings`、`runtime_tool_global_scopes` + `tools/:tool/scope` 接口 | 同上 |
| 执行校验中的 grant/scope 检查 | `backend/src/runtime/execution.ts:95-108` | 改为技能授权校验 |
| 员工连接器使用面 | 员工 `/connectors` 页与 `GET /api/connectors` 的员工 DTO | 法律已废止该面 |

**启用门禁（替代 `connectorHasAnyScope`）**：`status='verified'` **且** `connectorInUseBySkill(connectorId)`——存在启用的技能→连接器绑定且该连接器下至少一条启用的技能→工具绑定（新 helper，落 `runtime/store.ts`；`enterprise.ts:295-307` 的 PATCH 门禁同步改）。无绑定时启用按钮置灰，并提示「尚无技能使用此连接器；请先在技能页挂载」。

**风险档**：L1/L2/L3 由平台按 07 文档规则自动推导（可内核覆盖），仅作为内部门禁与审计字段，**不再作为界面上的"授权"操作**。

## 4. 连接器设置向导（弹窗内四步）

适用范围：**MCP 创建弹窗**与**枢纽「配置」弹窗**共用同一向导组件；「自定义 API」创建弹窗按 ADR-2026-09-27 保持 1:1 复刻不动。步骤内容按创建/已有连接器分支。

| 步 | 用户操作 | 后台动作（既有接口） | 门禁 / 回执 | 完成原编号 |
|---|---|---|---|---|
| 1 | 连接信息（名称 / 传输 / URL / 密钥）→ **保存**（唯一实底 CTA） | `POST /admin/connectors`（仅创建分支）+ `PUT /admin/runtime/connectors/:id/config` | 保存后 `status=pending_verification`、`enabled=0`；回执含配置版本 | 步骤 2（保存接入配置） |
| 2 | **测试**（次按钮） | `POST .../probe`（真打 MCP `tools/list`） | 成功 `verified`；失败显示 `error_code` 可重试；保留免责声明「仅验证工具目录，不代表业务动作」；**任何再次保存配置都会回到待验证并提示"需重新测试"** | 步骤 3 |
| 3 | **工具清单**（次按钮，**只读**） | `GET .../discovery` | 列出全部工具名 + 描述 + 风险档（只读）；未连通/未保存配置时给诚实空态；不预取、不伪造；**无任何授权/审阅操作** | 步骤 4 的知情面 |
| 4 | **启用连接器**（当前步主键） | `PATCH /admin/connectors/:id {enabled:true}` | 需 `verified` + `connectorInUseBySkill`；未满足则置灰+原因；成功后额外提供「停用」与审计入口 | 步骤 5 |

**明确不做**：技能选择器、技能绑定、逐工具授权/审阅、风险档选择、按人/部门/岗位范围配置。
**版式约束**：同一视口 0–1 个实底主 CTA（只有"当前步骤推进键"是实底，其余描边/幽灵）；900 高视口内不滚动（需同步改 `docs/DESIGN.md` §连接器控制台数值与 `frontend/e2e/connector-admin.spec.ts` 版式用例）；状态不靠颜色；失败不吞错。

**必须顺带修复的缺陷**：`McpConfigPanel` 的二次保存失效（`frontend/src/admin/connector/ConnectorPanels.tsx:384,477`：硬编码 `expected_version:0` + `createdRef` 短路）——向导要求保存后能改 URL/密钥并重存，需改为读回 config 版本再写。

## 5. 实施影响清单

**后端**
- `backend/src/runtime/execution.ts`：执行校验由「员工 grant ∪ 连接器范围」改为「技能授权 + 技能绑定 + 内部门禁」（保留 schema_hash/risk/host-only/L3 语义）。
- `backend/src/routers/enterprise.ts`：启用门禁换 `connectorInUseBySkill`；`/admin/users/:uid/connectors*` 端点退役（保留路由返回 410 或直接移除，按计划定）。
- `backend/src/runtime/organization.ts`、`backend/src/routers/connector-organization.ts`：范围接口退役（不删表）。
- 新 helper：`connectorInUseBySkill()`（`runtime/store.ts`）。

**前端**
- 向导壳（步骤条 + 主键切换 + 回执区）落 `ConnectorPanels.tsx` / `ConnectorHub.tsx`。
- 下线：`ConnectorGrantsCard.tsx`、`ConnectorScopeCard.tsx`、`ConnectorToolsCard.tsx` 的范围段、员工 `/connectors` 页。
- 保留：`ConnectorToolsDrawer/Card` 的只读清单与描述渲染（向导第 3 步复用同一组件，不产生第二套清单）。
- 保留： `SkillConnectorBindings.tsx`（技能侧绑定入口，负责"技能用哪些工具"）。

**数据**：4 张退役表保留数据、停止读写；`runtime_connector_probes`/审计照旧。

**测试**：`backend/tests/connector-scope.test.ts`、`connector-employee-dto.test.ts` 等需随语义改写；`frontend/e2e/connector-admin.spec.ts` 版式与授权用例更新；新增「无技能绑定 → 启用 409」「有绑定 → 启用 200」用例。

**文档第二批同步（列而未改）**：`docs/skill-runtime-operations.md:13-14,46,98`、`docs/connector-runtime-implementation.md:45`、`docs/mail-skill-knowledge-flow.md:49`、`docs/connector-governance-ux-review-2026-09-26.md:46,83,98`、`docs/superpowers/specs/2026-09-22-composer-and-menus-review.md`（员工「+」菜单连接器项）、`2026-09-25-skill-runtime-bindings.md`（用户→Connector 表述）。

## 6. 迁移顺序

1. **阶段 A（法律 + 后端）**：执行校验切技能、启用门禁切换、范围端点退役；前端暂隐藏按人授权入口（避免"看得见点不动"）。
2. **阶段 B（前端向导）**：向导四步 + 二次保存修复 + 卡片下线 + 员工面下线 + DESIGN/E2E 同步。
3. **阶段 C（清理）**：文档第二批同步、死代码清理（`recordToolInventory` 等按需启用）。

不做数据迁移与删除；退役表随时可回溯（CONST-10 证据链）。

## 7. 验证

- 契约/单测：执行校验（技能授权缺失 → 拒绝；绑定/策略缺失 → 拒绝；L3 → 拒绝）；启用门禁（无绑定 409 / 有绑定 200）。
- E2E：向导四步可走通；第 3 步只读；改配置后回待验证；启用按钮的置灰原因可见；版式用例（无滚动、0–1 实底）。
- 只读证据：`runtime_skill_tools` 绑定行、`connectors.status/enabled`、审计事件（`runtime.config.updated` / `runtime.connector.probed` / `admin.connector.update`）各留一份。

## 8. 开放项（评审时一并定）

1. 风险档自动推导规则（L3 名单：`sendEmailNow`、`changeLifecycleStage`、解密、导入、删除 + host-only 名单）。
2. 远端工具描述变化导致 `schema_hash` 失配时的提示与刷新策略（现为静默不可用）。
3. 员工 `/connectors` 页与 `GET /api/connectors` 员工 DTO 的下线批次（阶段 B 还是 C）。
