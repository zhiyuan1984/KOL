# 实时上下文层 P1：实现与验证记录

> 日期：2026-10-07  
> 基线：`55a0e4e6c0a7131d82c34544666d7ec84b9325be`  
> 分支：`feat/knowledge-qa-context-p1`  
> 状态：代码已实现；本记录所列沙箱测试通过；未合并、未部署生产、未完成真实文档答案质量验收。

## 1. 本次范围

按 2026-10-06 已确认设计的 D1–D4、D7 和“P1 线① only”实施：

- 管理端非结构化知识库试算保留临时上一轮明细与历史摘要。
- 每次合法、获授权且预算允许的管理端问答直调项目 Luna；不做代词规则层，不启动 Codex 或 Thread。
- Host 校验模型提议；改写不通过或 Luna 不可用时，只在改写层回退原问题。
- PageIndex 保持干净单问，历史摘要与上一轮明细不拼入 `--question`。
- 实体维护、摘要压缩、审计与用量归集纳入已有 Host 治理。

**没有实施：**事件总线、相关性排名、`writeBox` 注入、worker prompt 热刷新、员工端上下文改写、P2 会话数据库表、PageIndex 多轮 SDK 改造。

## 2. 代码清单

| 文件 | 主要作用 |
|---|---|
| `shared/knowledge-qa.ts` | 前后端上下文、范围、诊断及维护结果契约 |
| `backend/src/knowledge/qa-luna.ts` | 项目原有模型与凭据来源；有界 Responses 调用、响应读取和 usage 解析 |
| `backend/src/knowledge/qa-contract.ts` | 运行时版本、范围、引用、实体、长度与字节上限校验 |
| `backend/src/knowledge/qa-rewriter.ts` | few-shot 提议与 Host 实体出处、改写一致性裁决 |
| `backend/src/knowledge/qa-context.ts` | 完整本轮回答的实体提取及按需摘要压缩；失败有界降级 |
| `backend/src/knowledge/qa-governance.ts` | 公司/用户预算硬停、已知真实 usage 归集及未知用量审计 |
| `backend/src/host/knowledge-qa.ts` | 管理员、组织资料授权、资料状态及预算复核；临时维护服务 |
| `backend/src/host/knowledge-documents.ts` | 管理端专用改写回调；保留共享检索与引用过滤；异步复核权限 |
| `backend/src/routers/knowledge.ts` | 检索接入及管理员 `POST /api/admin/knowledge/qa-context`；非法 JSON 为 400 |
| `backend/src/routers/knowledge-publication.ts` | 静态试算接口不再误当知识 ID；对象路径原守卫保留 |
| `frontend/src/admin/knowledge/qaSession.ts` | 临时会话、范围键、R1 折叠、R2 计划与最多八轮明细窗口 |
| `frontend/src/admin/knowledge/UnstructuredBasePanel.tsx` | 状态接入、实际检索问题、清空、阶段提示及请求代际保护 |
| `frontend/src/api.ts` | 上下文请求、诊断与维护接口类型 |
| `frontend/src/knowledgeCopy.ts` | 会话与等待/降级文案 |
| `backend/tests/knowledge-qa-rewriter.test.ts` | 改写与有界调用单元测试 |
| `backend/tests/knowledge-qa-context.test.ts` | 实体维护、摘要与失败保底测试 |
| `backend/tests/knowledge-documents.test.ts` | 真实隔离 PostgreSQL Host/HTTP 集成与原检索回归 |
| `frontend/src/admin/knowledge/qaSession.test.ts` | 会话、边界、重放、实体原文与完整回答测试 |
| `frontend/e2e/knowledge-qa-context.spec.ts` | 浏览器 HTTP 契约、竞态、权限清空与适配用例 |
| `backend/vitest.config.ts` | 登记会话纯函数测试，避免存在但未执行 |
| `frontend/playwright.knowledge.config.ts` | 保留原 presentation 回归并加入新会话用例 |
| `backend/scripts/check-knowledge-qa-live.ts` | 显式开启的真实模型目录与五项合成样本检查 |

无数据库迁移，无依赖增补，无新色盘或 CSS token。

## 3. 检索与维护链路

```text
前端原问题 + 范围 + 版本化 context
→ Host 管理员与运行时输入校验
→ 资料范围/发布状态/索引检查
→ 当前组织资料授权与预算检查
→ Luna 改写提议
→ Host 输出形状/实体出处/实体包含关系裁决
→ 管理员、组织、预算及资料状态复核
→ PageIndex 单问
→ 再次复核权限与资料；原引用过滤、审计、用量归集
→ 返回答案、引用与改写诊断
→ 管理员上下文维护：完整回答抽实体 + 必要的 R2 压缩
→ 返回前复核当前权限、资料与预算
→ 前端提交本轮状态，下一问使用新 context
```

### 3.1 不改变授权的范围

- `base_id`、`doc_ids`、有效 `include_pending` 是调用方范围，模型不能修改。
- 上下文范围只是提示数据，不是授权证据。
- 当前组织通过既有 `X-Review-Company` 通道进入 Host；复用 `adminDocument`，不另立人员/品牌授权规则。
- 不合法的顶层输入返回 400；权限、组织、范围与预算错误保持现有 4xx，不被改写失败降级吞掉。
- 改写模型不得新增实体：每项须来自上轮实体、经范围与名称检查的引用资料名或历史摘要；非空实体集合时，改写问题须包含其中至少一项。
- 无改写时 `rewritten` 必须与原问题一致；改写为真但没有可核验实体等非法提议会被拒绝。

### 3.2 临时会话

- 状态仅存在组件内存，不写 `localStorage`/`sessionStorage`，不复用任务会话表。
- 下一轮的 `last_turn.answer` 截断到 2000 字符；维护请求使用完整回答，实体与引用不随回答截断丢弃。
- R1 每轮折叠此前尚未折叠的上一轮：问题、回答首句与实体。摘要与原始明细分别维护。
- 摘要超过 1500 字符或维护轮次超过 8 时请求 R2；成功摘要最多 1500 字符。
- 明细窗口最多保存八轮；旧维护重放即使对应轮次已被窗口淘汰，也不能倒退序号或覆盖摘要。
- 范围变化、清空、刷新及离开页面开始新临时会话；旧 response 和旧 `finally` 不得污染新请求状态。
- 搜索或维护返回 401/403 时清空临时状态，不继续展示旧答案。普通维护故障则保留已经成功的答案并明确降级。

### 3.3 时限、资源与用量

- 改写默认 5000 ms；实体/摘要维护默认 8000 ms；可分别配置 `KNOWLEDGE_QA_REWRITE_TIMEOUT_MS` 与 `KNOWLEDGE_QA_CONTEXT_TIMEOUT_MS`，取值仍受 Host 约束。
- 模型使用 `intentLlmModel()`，默认项目已定义的 `gpt-5.6-luna`，Responses API，不更换意图裁判实现。
- 问题上限 16000 字符；维护完整回答上限 64000 字符；上下文整体上限 128 KiB；实体和引用数组有上限。
- 改写与维护使用独立成本来源 `knowledge_rewrite`、`knowledge_qa_context`。管理端试算无 Agent 身份，不伪造 Agent 归集。
- 返回完整可核验 usage 时才记真实总数；缺失或部分 usage 总量不可得时只记不可完整计量审计，不补成“实际零值”。请求 ID 关联改写诊断、检索审计及相应成本记录。
- 模型超时不代表供应商没有消耗；未知用量不被解释为零成本。

## 4. 接入时发现并修复的问题

1. 发布路由通配守卫将 `search`、`index-health` 等静态路径误判为知识 ID，造成 404；新增 `qa-context` 也会被阻挡。仅为这些静态路径修复路由识别，其他对象路径保留原守卫。
2. 静态检索/维护必须显式执行当前组织资料授权，不能仅凭 `admin` 角色。已复用既有资料授权并覆盖 Luna/PageIndex 等待后的变化。
3. 已有删除测试只接受不存在资料的 404；租户守卫为避免披露可返回 403。测试允许两种拒绝码，同时新增实际数据库删除断言，保留文件删除断言。
4. 未配置测试数据库时清理钩子不应因未创建临时目录掩盖真正错误；只清理已创建目录。
5. 独立只读审查发现维护返回前缺少预算再检查；已修复，并新增等待中超额必须 429、不得返回实体或摘要的集成回归。

## 5. 验证证据

### 5.1 可复现的代码与契约验证

| 验证 | 结果 | 范围与限制 |
|---|---|---|
| 后端类型检查 | 通过 | `npm run typecheck` |
| 前端类型检查 | 通过 | `npm run typecheck` |
| 前端生产构建 | 通过 | `npm run build` |
| 后端/共享纯函数/Host/原生发布集成 | **107/107 通过** | 六个测试文件，无跳过；隔离沙箱 PostgreSQL，PageIndex 为 stub |
| 知识域 Chromium E2E | **21/21 通过** | 原 presentation 十项 + 会话十一项；HTTP fixture，不冒充真实引擎 |
| 契约校验 | 通过 | `validate:contracts` |
| 设计 token 校验 | 通过 | `validate:design-tokens`；仍有登记表原有待落地项，不归本次新实现 |
| 仓库脱敏检查 | 通过 | `scan:redaction` 扫描既有目标目录；未把生成时间戳纳入提交 |
| 本次变更明文密钥模式检查 | 通过 | 新增/修改内容未匹配私钥、真实 Key 或 JWT 模式；不宣称替代完整安全审计 |
| 补丁空白检查 | 通过 | `git diff --check` |

六个后端/共享测试文件：`knowledge-documents.test.ts`、`knowledge-qa-rewriter.test.ts`、`knowledge-qa-context.test.ts`、`knowledge-publication.postgres.integration.test.ts`、`knowledge-scope-contract.test.ts`、`qaSession.test.ts`。

### 5.2 真实 Luna 合成样本

先核对项目端点模型目录，确认实际配置模型可用；不以沙箱自带代理端点替代项目端点。随后五项均通过：

| 样本 | 观察结果 |
|---|---|
| 唯一上轮型号 + “它的规格参数和用途” | 采用明确型号改写，保留规格与用途要求 |
| 本轮明确指定新型号 | 原样查询，不由历史覆盖 |
| 上轮两个型号 + “它的规格” | 不擅自选型号，保留原问并给出需明确型号的原因 |
| 完整回答的型号提取 | 两个明确型号均保留 |
| 长摘要压缩 | 返回有界摘要，并保留“规格未确认”否定信息 |

本次可记录的三次改写耗时分别为 3145、2308、4476 ms。它们是少量样本观察，不是 p95/p99 或稳定服务承诺。

**该检查验证实际 Luna API 与本期纯改写/维护模块，不证明真实 PDF、PageIndex 检索和答案引用质量。**

### 5.3 复现命令

后端集成需要独立测试 PostgreSQL，并有创建临时数据库所需权限。禁止填生产数据库：

```bash
cd backend
npm run typecheck
# 先设置独立测试 URL；TEST_POSTGRES_URL 用于显式开启原生发布集成测试。
export TEST_DATABASE_URL='postgresql://<test-role>:<password>@127.0.0.1:5432/postgres'
export DATABASE_URL="$TEST_DATABASE_URL"
export TEST_POSTGRES_URL="$TEST_DATABASE_URL"
npm test -- tests/knowledge-documents.test.ts tests/knowledge-qa-rewriter.test.ts \
  tests/knowledge-qa-context.test.ts tests/knowledge-publication.postgres.integration.test.ts \
  tests/knowledge-scope-contract.test.ts ../frontend/src/admin/knowledge/qaSession.test.ts
npm run validate:contracts
npm run validate:design-tokens
```

```bash
cd frontend
npm run typecheck
npm run build
npx playwright install chromium
npx playwright test --config=playwright.knowledge.config.ts --project=chromium
```

真实模型检查只在显式开启且已有项目模型凭据的环境运行，会产生真实 API 调用。核对项目 `OPENAI_BASE_URL`，不要继承其他代理的端点：

```bash
cd backend
QA_LIVE_CHECK=1 npx tsx scripts/check-knowledge-qa-live.ts
```

## 6. 审宪与角色记录

| 项目 | 记录 |
|---|---|
| 需求 | P1 管理端临时问答上下文、Luna 改写提议、Host 裁决与审计 |
| 主责角色 | 架构师：边界；后端专家：运行时校验与治理；前端专家：会话与竞态；测试经理：分层证据；只复用既定组织规则，不制定新的业务授权 |
| 宪法条款 | CONST-03 程序执行规则；CONST-05 不扩大授权；CONST-06 摘要不替代事实、读取复核权限；CONST-08 审查记录；CONST-10 实现与生产验收分开 |
| 相关规则 | PROD-AGENT-04~07 的受控知识通道；TECH 的组件/后端/测试边界；BIZ-02/03 与 `org-permissions.md` 的权威组织证据及角色不等于范围；`DESIGN.md` 的状态、次级操作与适配规范 |
| 结论与证据 | **符合本期实现范围**：模型无授权权，保留原检索与引用闸门，员工路径不接入改写；上述测试与实际供应商合成检查支持本期代码能力，不声明生产验收完成 |
| 下一步 | 审查 PR → 在获授权测试环境部署 → 用实际资料做质量验收；确认后按项目既有发布流程推进 |

## 7. 上线前与回滚

1. 对实际已发布资料验证“型号首问 → 它的规格/用途”，核对答案与页码；对多个型号验证不擅自选择。
2. 验证真实维护、跨资料/知识库隔离、当前组织选择、在途撤权和预算硬停。
3. 验证稳定网络下的时延与故障率，再决定是否调整默认时限；不得根据五个样本宣称整体服务 SLA。
4. 老资料缺少当前组织归属证据时必须拒绝，不能借改写失败退回无范围检索；由既有组织治理补正。
5. 本次不执行数据库迁移、不写持久 QA 会话表。回滚本 PR 即恢复原单轮试算；既有审计与真实用量记录无需删除。
6. P2 持久化及员工端接入、事件线均保持未实施状态，不能因本期测试通过标记完成。
