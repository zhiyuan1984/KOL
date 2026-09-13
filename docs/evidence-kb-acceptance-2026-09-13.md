# `/kb` 验收证据（2026-09-13）

## 总判

当前 `/kb` **不是**企业级知识库。它是**已发布知识资产列表 + 邮件模板启用器**。

- **可接受**：KOL 邮件模板试点（运营发布 → 员工启用 → 起草引用 → 发送记版本）。
- **不通过**：员工知识库、多组织知识库、Agent RAG 检索源、生产发布资格。

本文件只记录验收事实与积压，**不实施修复**。`Knowledge.tsx` 重复分组 P0 由独立前端 PR 处理，本仓库本次不改前端/后端代码。

对照：`14-implementation-contract.md` 知识库契约、`15-conformance-gaps.md` 知识库缺口、`16-production-test-plan.md` `F-KB`。

## 评分

| 用途 | 评价 |
|---|---|
| 选择已发布邮件模板 | 6/10 |
| 个人启用/停用模板 | 5/10 |
| 管理员知识生命周期 | 6/10 |
| 员工知识库 | 2/10 |
| 企业级知识权限 | 2/10 |
| Agent 检索知识源 | 1/10 |
| 生产发布资格 | 不通过 |

## 基线

| 项 | 值 |
|---|---|
| 日期 | 2026-09-13 |
| 员工面 | `/kb`（「我的知识库」）、`/market/kb`（知识市场） |
| 管理面 | 管理台知识页（原文 / 抽取 / 待审 / 草稿 / 已发布 / 版本 / 归档 / 隔离 / 隐藏统计） |
| 实现入口 | `frontend/src/pages/Knowledge.tsx`、`frontend/src/pages/AdminKnowledge.tsx`、`backend/src/host/knowledge.ts`、`backend/src/routers/knowledge.ts` |
| 契约 | `docs/14-implementation-contract.md`：条目须带 `tenant_id`、`organization_scope`、`brand_scope`、`region_scope`、`effective_from/to`、来源、版本、敏感级别 |
| 本 PR 范围 | 仅本证据与 `docs/README.md` 索引一行；不改产品代码 |

## 已成立（邮件模板试点可用）

受控邮件模板资产中心已闭环，适合 KOL 试点，不构成企业 KB：

1. **生命周期**：原文 → 抽取 → 待审 → 发布 → 运营启用 → 起草引用 → 发送记录知识版本 → 归档。
2. **管理页**：原文库、抽取任务、待审、草稿、已发布、版本、归档、品牌隔离提案、对本账号隐藏统计均有入口。
3. **Worker 边界**：未审批知识不能进入会话或 Worker（`knowledge_unapproved`）。
4. **发送记版本**：发出邮件记录所用知识版本；已发送条目不做物理删除。
5. **Skill 隔离**：知识变更不静默改写线上 Skill 说明；演进走提案审批。
6. **品牌闸门**：可用路径上有品牌匹配（组信 `composerItems` 会 `brandMatched`），不是完全无品牌。

这些能力支撑「选一份已发布英文底稿写信」，不足以宣称员工 KB 或 Agent 检索源。

## 关键缺口

### 员工面语义与结构

- 「我的知识库」列出**全部已发布**资产（`listPublishedForOps` = `status='published'`），不是「我已启用」视图。标题语义错误。
- 无搜索、无筛选（组织 / 品牌 / 区域 / 类型 / 有效期 / 启用态）。
- 无知识库结构（目录、主题、空间、关系）；只有邮件模板与「其它」两桶。
- 预览是原始 `<pre>`，不是可读文档阅读器。
- 员工文案泄漏引擎术语（`Codex`、`Codex harness`），违反员工端隐藏执行内核的约定（`F-EMPLOYEE` / `R-018`）。

### 已知 P0（另案修复，本 PR 不改）

`frontend/src/pages/Knowledge.tsx` 的 `grouped` 把「口径与其它」写了两遍（同一 `key: "other"`）。有非邮件模板行时分组重复。独立前端 PR 修复（cloud agent `bc-1a79c8ad`）；此处只记为已知缺陷。

### 范围字段与 PEP

相对 `docs/14`，表与 API 字段不完整：

| 契约字段 | 当前 |
|---|---|
| `tenant_id` | 无 |
| `organization_scope` | 无 |
| `brand_scope` | 仅单字段 `brand`（默认 `*`） |
| `region_scope` | 无 |
| `effective_from` / `effective_to` | 无 |
| 敏感级别 | 无 |
| 来源 / owner / 核验态 | 无独立契约字段 |
| 版本 | 有 `current_version` / `knowledge_versions` |

下列接口**缺少**组织 / 品牌 / 区域 PEP 过滤（组信 `composerItems` 的品牌过滤不能代替列表与引用闸门）：

- `listPublishedForOps`（`GET /api/knowledge`）
- `listMarket`（`GET /api/knowledge/market`）
- `cite` / `deprecate`（启用、对本账号隐藏）
- `listVersions`

跨租户 / 跨品牌读知识仍是 `F-KB` / `R-001` / `R-002` 未过项。

### 发布与运行时承诺

- `approveKnowledge` 只需管理员且非归档；**无**评价集 / P1 门禁。
- 非邮件知识（`policy` / `pattern` / `glossary`）的 Skill / Agent 运行时承诺不完整；**只有 `mail_template` 明确接入组信**。
- 无检索 API、无切片、无引用回链，不能作为 Agent RAG 知识源（Agent 检索知识源 1/10）。

## 积压（只记录，不实施）

1. 删除重复「口径与其它」分组（P0，另案 FE）。
2. 「我的知识库」改为真实个人已启用视图。
3. 搜索 + 范围筛选。
4. 员工面去掉引擎术语。
5. 后端列表 / 引用 / 废弃 / 版本补组织·品牌·区域 PEP。
6. 收紧 versions / cite 权限。
7. 补 owner / 来源 / 有效期 / 已核验。
8. 发布接入评价 / P1 门禁。
9. 非邮件知识进入 Skill / Agent 路径。
10. 拆开「模板选择器」与「企业 KB」两套 UX。

## 产品陈述

**已有**：受控邮件模板资产中心（发布、个人启用/隐藏、起草引用、发送记版本、归档）。  
**未做**：企业知识库、多组织知识权限、员工可读知识库、Agent 检索知识源。

不得把 `/kb` 或「我的知识库」写成已交付企业 KB，也不得用本页通过生产发布资格。`F-KB`（上传、抽取、引用、版本、废弃、跨品牌转移，且含租户/品牌/有效期/来源）对本轮验收为 **FAIL**。

## 发布影响

| 宣称 | 判定 |
|---|---|
| KOL 邮件模板试点继续用 `/kb` 选模板 | 可接受（6/10 量级，非生产资格） |
| 员工知识库已上线 | **FAIL** |
| 企业级 / 多组织知识权限已上线 | **FAIL** |
| Agent 可以本库为 RAG 源 | **FAIL** |
| 生产发布资格 | **不通过** |
