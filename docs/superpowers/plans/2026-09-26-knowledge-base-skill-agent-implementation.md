# 知识库治理与使用：实施计划

> 日期：2026-09-26
> 状态：实施计划（阶段步骤与验收门；**不含任何「已完成」声明**）
> 依据：[设计规格](../specs/2026-09-26-knowledge-base-skill-agent-design.md)
> 本计划范围：阶段 0–4 的文件级步骤、验收门、回滚与执行记录。阶段 1 起代码需另案批准后启动。

## 1. 审宪记录（CONST-08，与规格一致）

| 项目 | 记录 |
|---|---|
| 需求 | 知识资产治理与员工使用两端落地；知识被技能/智能体引用的绑定-解析-校验-追溯机制；分期实施。 |
| 主责角色 | 平台产品经理（机制）、UI/UX 专家（两端 IA 与视觉）、KOL 业务专家（内容与审批口径）、智能体产品经理（引用与检索准入）、前端/后端专家（实现）、测试经理（门禁证据）。 |
| 宪法条款 | CONST-03/05/06/07/09/10（详见规格 §2）。 |
| 基本法条款 | PROD-PLAT-04/05/06/07；PROD-AGENT-03/06；TECH-ARCH-01、TECH-BE-01/02/03/08、TECH-FE-01/02/03、TECH-TEST-01/02；BIZ-15；org-permissions 知识库行；DESIGN 不变量。 |
| 结论与证据 | **符合**（详见规格 §2）；空白项 5 条登记于规格 §10。 |
| 下一步 | 阶段 0 随本计划完成；阶段 1 另案批准。 |

## 2. 现状与实现边界

**复用（不重造）**

- 四闸与注入白名单：`backend/src/host/knowledge.ts:812-848,927-948`。
- 审计基础设施：`audit_events`（`backend/src/db.ts`）+ `backend/src/db.ts` 的 `audit()`。
- 管理端对话框与回执：`frontend/src/components/ConfirmDialog.tsx`、`frontend/src/adminConfirm.ts`。
- Admin 治理 IA：`frontend/src/pages/AdminConsole.tsx:34-59,160-176`（分类导航 + `detailId` 解析）。
- 迁移方式：`backend/src/db.ts` 内联 schema + `migrateSchema()` 幂等列迁移；`backend/migrations/NNN_*.sql` 仅留档（`backend/migrations/011_*.sql` 为最新）。

**明确不改**

- 权限、审批、阶段、发信闸门与 Host Gateway 契约；MediaCrawler 异步契约；Codex harness。
- 基本法正文（无条款变更；空白项仅登记，不替角色决定）。
- `email_compose` 现有行为：绑定未配置时保留现行「本人已启用集合 + 阶段优先」回退。
- 不新增顶层导航；`/kb` 不做治理动作；管理端不做第二套 Home。

## 3. 目标链路

```text
管理端治理（上传/提取/修订/审核/发布/停用/版本/范围/授权/绑定/反馈处置）
        │ 写入 knowledge / knowledge_versions / knowledge_bindings / knowledge_grants
        ▼
运行时解析（Host，服务端）：显式 id > 绑定选择器 > 现行回退
        │ 四闸 + 跳过原因（not_published/scope_mismatch/not_cited/deprecated_by_user/expired/…）
        ▼
编译载荷 → CONTEXT（白名单）→ Worker 执行 → 草稿/发送回执（knowledge_id/version）
        │
        ▼
audit_events：knowledge.resolve / binding.save / grant.save / rollback / feedback.handle
        │
        ▼
员工反馈（三原因）→ 管理端处置（转修订/归档/忽略）→ （案例候选，走 proposals 人审）
```

## 4. 阶段 0 — 规范文档（本回合成品）

**目的**：设计定稿入库，空白项登记，不开工代码。

**操作步骤**

1. 新增 `docs/superpowers/specs/2026-09-26-knowledge-base-skill-agent-design.md`（本批次已完成）。
2. 新增本实施计划文件。
3. 文档自检：内部链接可达；条款编号与原文一致；含诚实行「不声明代码已完成」；不在规范文本写 token 数值。

**主要文件**：上述两文档。

**验收门**：自检清单通过；`git status` 仅含新增/修改的文档文件。

## 5. 阶段 1 — 后端治理骨架

**目的**：把引用关系与治理缺口在后端变成可管理、可试算、可审计的事实。

**操作步骤（文件级）**

1. **数据模型**（`backend/src/db.ts`）
   - `knowledge` 增列 `effective_at`、`expires_at`（走 `migrateSchema()` 幂等 `add()`）。
   - 新增 `knowledge_grants`（id, knowledge_id, scope, scope_id, granted_by, granted_at）。
   - 新增 `knowledge_bindings`（id, skill_id, selector, enabled, note, created_by, created_at, updated_at）。
   - 镜像留档 `backend/migrations/012_knowledge_governance.sql`。
2. **领域逻辑**（`backend/src/host/knowledge.ts`）
   - 范围与授权：`listPublishedForOps` / `composerItems` 前置 grants 过滤（按对象收窄，语义见规格 §4.3）。
   - 版本：`getVersion(id, v)`；`rollbackKnowledge(id, v)`（历史 → 新版本，默认 draft）。
   - 审批：`approveKnowledge(id, expectedVersion)`——版本不一致 409，通过写版本行状态与回执。
   - 绑定：`listBindings/saveBinding/deleteBinding`；`resolveForSkill(skill, ctx)` 按规格 §4.2 优先级解析，返回 `{resolved[], skipped[{id, reason}]}`。
   - 试算：`resolvePreview(skillId, sample{user?, stage?, brand?})`。
   - 反馈：`handleFeedback(knowledgeId, user, action, reason)`（转修订 / 归档 / 忽略）。
   - 注入兼容：`resolveMailTemplate` 改为「显式 id > 绑定解析 > 现行回退」；`workerSafeExtra` 白名单不变。
   - 审计：`knowledge.resolve`、`knowledge.binding.save`、`knowledge.grant.save`、`knowledge.rollback`、`knowledge.feedback.handle`。
3. **路由**（`backend/src/routers/knowledge.ts`，沿用 host 层 `requireAdmin` 守卫模式）
   - 员工：`GET /api/knowledge?q=&kind=&stage=&brand=`（范围过滤 + 关键词 + 分页）。
   - 管理：`GET /api/admin/knowledge/assets`；`GET /api/admin/knowledge/:id/versions/:v`；`POST /api/admin/knowledge/:id/rollback`；`GET/PUT /api/admin/knowledge/:id/grants`；`GET/POST /api/admin/knowledge/bindings` 与 `PATCH/DELETE /api/admin/knowledge/bindings/:id`；`POST /api/admin/knowledge/resolve-preview`；`GET /api/admin/knowledge/feedback`；`POST /api/admin/knowledge/:id/feedback-handle`。
   - 扩展：`POST /api/admin/knowledge/:id/approve` 接受 `expected_version`。
4. **测试**（新增 `backend/tests/knowledge-governance.test.ts`；扩展 `backend/tests/knowledge-wikiskill.test.ts`）
   - 范围过滤与 grants 收窄；diff/回滚版本语义；审批 409；绑定解析优先级与跳过原因；试算输出；审计事件写入。

**验收门**：`cd backend && npm run typecheck`；`cd backend && npm test`；回归 `cd backend && node scripts/test.mjs tests/knowledge-wikiskill.test.ts`。

**回滚策略**：新增列/表可空、向后兼容；解析器保留 legacy 回退；异常时回滚代码提交即可，无需数据迁移回退。

## 6. 阶段 2 — 管理端 UI

**目的**：六子视图落地，治理动作可执行、可回执、可回放。

**操作步骤（文件级）**

1. 拆分 `frontend/src/pages/AdminKnowledge.tsx` 为子视图（建议目录 `frontend/src/admin/knowledge/`：TodoView / AssetsView / AssetDetailView / IngestView / BindingsView / FeedbackView）；`frontend/src/pages/AdminConsole.tsx` 向知识页传 `detailId`。
2. 新建 `frontend/src/components/VersionDiff.tsx`（只读 diff，当前无既有组件）。
3. `frontend/src/adminConfirm.ts` 补 confirm kinds（回滚、绑定启停、反馈处置）。
4. `frontend/src/api.ts` 封装新端点；`frontend/src/knowledgeCopy.ts` 补文案。
5. `frontend/src/styles.css` 追加类（仅既有 token）。
6. 新增 `frontend/e2e/admin-knowledge.spec.ts`：六视图可达、每视口 0–1 实底 CTA、L3 确认 + 回执、打开期间版本变化 → 409 失效并刷新、试算显示跳过原因。

**验收门**：`cd frontend && npm run typecheck && npm run build && npm run test:e2e`。

## 7. 阶段 3 — 员工端

**目的**：`/kb` 可用、可溯源；引用在草稿与回执上可见。

**操作步骤（文件级）**

1. `frontend/src/pages/Knowledge.tsx`：行式列表、适用 chips、搜索/筛选（接 `?q=`）、详情抽屉（来源/版本/时间、反馈、启用/隐藏、用于当前任务）。
2. 引用芯片：`frontend/src/components/ChatBlocks.tsx`（结果/回执区）、`frontend/src/pages/Mail.tsx`（邮件回执）、`frontend/src/pages/Home.tsx`（锁定 chip 沿用）；数据取草稿 extra 的 `knowledge_id/version`，标题取不到时降级显示版本与 id。
3. 新增 `frontend/e2e/knowledge-usage.spec.ts`：列表 → 抽屉 → 用于当前任务 → 草稿引用芯片可见；范围外知识不出现。

**验收门**：`cd frontend && npm run typecheck && npm run build && npm run test:e2e`。

## 8. 阶段 4 — 检索与闭环（另案批准）

**目的**：开放式问答场景与智能体范围校验；闭环收紧。

**操作步骤（文件级）**

1. `backend/mcp/tools.ts`：`search_knowledge` 强化（服务端范围前置过滤、仅 published、片段 + 来源 + 版本 + 时间、限量截断）。
2. 试点技能登记：目标技能 `mcp[]` 加入该工具；SKILL.md 正文写明引用与「知识不足」处理（技能目录与命名由业务确认）。
3. kind 扩展（faq/case）——待规格 §10 空白 4 裁定后实施。
4. `backend/src/host/knowledge.ts`：`knowledge_proposals` 扩展案例候选；发布前影响面提示（依赖技能/专家），绑定技能提示跑 `skill_tests`。
5. `backend/src/experts.ts` / `backend/src/contract-scope.ts`：manifest 知识范围字段 + 发布期校验 + 运行时求交（先补校验再宣称）。

**验收门**：`cd backend && npm run release:gate`（含 `eval:kol`）；前端改动时同步 `npm run test:e2e`。

## 9. 自动化验证（命令清单）

```bash
cd backend && npm run typecheck
cd backend && npm test
cd backend && node scripts/test.mjs tests/knowledge-wikiskill.test.ts   # 单套
cd frontend && npm run typecheck && npm run build && npm run test:e2e
cd backend && npm run release:gate                                      # 全量门禁（阶段 4）
```

## 10. 完成定义与上线阻断条件

- 每阶段必须：文件级变更完成 + 验收门全绿 + 执行记录填写；不以文档或测试冒充生产能力（CONST-10）。
- 阻断条件：验收门任一失败；L3 动作缺确认或回执；范围过滤未生效；审计事件缺失。
- 「已完成」只能由实际命令输出与执行记录证明；文档完成不等于功能完成。

## 11. 回滚策略

- 阶段 1：代码回滚即可（新表/新列可空，无数据破坏）。
- 阶段 2/3：前端行为回滚到上一提交；引用芯片缺失时降级为不显示，不影响主链路。
- 阶段 4：`search_knowledge` 强化未通过前保持占位行为；智能体范围校验未落地前，不得在任何界面宣称「智能体已引用知识」。

## 12. 执行记录模板

| 阶段 | 实际文件 | 负责人角色 | 状态 | 验证证据 | 已知缺口/回滚点 |
|---|---|---|---|---|---|
| 0 | `docs/superpowers/specs|plans/2026-09-26-knowledge-base-skill-agent-*.md` | 平台产品经理（机制）/ UI/UX 专家（两端 IA，阶段 2 复核） | 完成 | 文档自检：站内链接可达、条款引用核对、无 token 数值 | 无 |
| 1 | `backend/src/db.ts`、`backend/src/host/grants.ts`、`backend/src/host/knowledge.ts`、`backend/src/routers/knowledge.ts`、`backend/migrations/012_knowledge_governance.sql`、`backend/tests/knowledge-governance.test.ts`、`backend/tests/knowledge-wikiskill.test.ts`、`frontend/src/api.ts`、`frontend/src/pages/AdminKnowledge.tsx` | 后端专家（实现）/ 测试经理（独立复核） | 完成（范围内）；仓库全量门禁红由工作区其它在途改动导致 | `npm run typecheck` ✅；新套件 13/13 ✅；`knowledge-wikiskill` 14/14 ✅；全量 `npm test`：1019 passed / 27 failed / 1 skipped（两个知识套件在全量中通过；失败集中在 connectors / discovery / starrykol / home 等其它在途工作流）；复核修复两处解析缺陷（钉住 id 过四闸、试算 id→handle）并补 2 条回归用例 | 非本阶段文件阻断中：`frontend/src/layout/Workbench.tsx:6` 语法错误使前端 typecheck/e2e 暂不可跑（属其它在途工作流，未修改）；到期语义等待空白项 ③ |
| 2 | `frontend/src/pages/AdminKnowledge.tsx`（重写为宿主，自解析 pathname）、`frontend/src/admin/knowledge/`（6 视图 + shared + `knowledge-admin.css`）、`frontend/src/components/VersionDiff.tsx`、`frontend/src/api.ts`／`adminConfirm.ts`／`knowledgeCopy.ts`（仅追加）、`frontend/e2e/admin-knowledge.spec.ts`、`frontend/e2e/workbench.spec.ts`（仅知识块 8 行配套） | UI/UX 专家（规范）/ 前端专家（实现）/ 测试经理（独立复核） | 完成（范围内）：独立复核 typecheck+build+两套 e2e 全绿；共享 spec 知识块已在实跑中通过 | `npm run typecheck` ✅；`npm run build` ✅；新 spec 5 passed (49.7s)；`skills-catalog` 54 passed (2.0m)；`workbench.spec --grep "L3 destructive writes"`：知识块（:3305-3330）执行通过，整条失败点在 :3333 技能块 `[data-skill-admin]`（属其它在途工作流的过期 hook）；逐项抽查：审批带版本+409、hooks 落点、实底 CTA 互斥（≤1）、CSS 无 hex/px、styles.css 零泄漏 | 未做（后续）：详情页审计切片、绑定「可解析数」列；本地 e2e 数据做过可逆准备并已还原（claw `mcp_config` 回 NULL、`e2e-deactivate-*` 残留清零）；workbench 整条转绿待该文件属主处理（员工区竞态、连接器前置数据、技能区 hook） |
| 3 | `frontend/src/pages/Knowledge.tsx`（重写为行式列表+搜索+适用筛选+溯源抽屉）、`frontend/src/knowledgeCopy.ts`（追加）、`frontend/src/api.ts`（`EmailCard` 补字段 + `knowledge()` 加可选参数）、`frontend/src/components/ChatBlocks.tsx`（草稿/回执引用芯片）、`frontend/src/styles.css`（仅 `.kb-*` 段）、`backend/src/host/api.ts`（`emailCardPayload` 补 `knowledge_id/version/title`）、`backend/src/host/knowledge.ts`（q 覆盖 subject/body_en；**修复 `listed()`→`publicKnowledge` 的 deprecated 误判**）、`backend/tests/knowledge-governance.test.ts`（+2 用例）、`backend/tests/knowledge-wikiskill.test.ts`（+email_card 断言）、`frontend/e2e/knowledge-usage.spec.ts`（新 5 条） | UI/UX 专家（员工面）/ 前端专家 / 后端专家 / 测试经理（独立复核） | 完成（范围内） | 独立复核：backend typecheck ✅、governance **15/15**、wikiskill **14/14**；frontend typecheck/build ✅；新 e2e **5 passed**；`/kb` 基线（employee knowledge base + cited knowledge template）**2 passed**；admin-knowledge **5 passed**；草稿链 `home-chat-send-ne-stage` **7 passed**；deprecated 误判做了「临时回退→回归用例必红→恢复→全绿」双向验证 | 后续项：芯片点击回抽屉、「制度」类芯片、抽屉内占位符高亮与反馈入口沿用现状；首载门 `data-kb-loading` 为新行为（消除假空态与断言竞速，偏差已记）；`frontend/package-lock.json` 的 npm 副作用已还原；workbench 其它段红属并行流（:3017 技能导航等） |
| 4 | | | | | |
