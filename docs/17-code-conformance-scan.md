# 代码违宪扫描报告

扫描范围：`backend/src`、`backend/skills`、`backend/migrations`、`backend/tests`、`frontend/src`、`frontend/e2e`、`scripts`。本报告只记录有代码证据的问题，不把架构目标误判为已实现。

## 高严重度

### C-001 默认第一只发件箱

历史扫描曾发现前端、绑定表单和 Host 的第一邮箱回退。当前实现已改为：只有用户明确值、明确品牌且该品牌只有一个候选，或全局只有一个授权邮箱时才解析；多个候选保持空值并进入补充输入。

违反：不得默认第一只发件箱；发件箱必须由用户输入、绑定关系或明确的品牌 Policy 唯一确定，否则必须 `waiting_input`。

测试：`R-010`。

### C-002 员工端默认选择相邻阶段

证据：[`frontend/src/components/ChatBlocks.tsx`](../frontend/src/components/ChatBlocks.tsx) 使用 `targets.find(item.kind === "adjacent")` 作为默认目标。

违反：人工确认使用 `legalTargets`，不受相邻约束。前端可以展示分组，但不能自动选择或限制人工目标；候选和默认值必须由后端确认卡明确提供。

测试：`R-008`。

### C-003 生产路径仍允许预览进入 Stub

证据：[`backend/src/worker/runner.ts`](../backend/src/worker/runner.ts) 在 `extra.compose_preview_only` 时调用 `runStub`，即使 `CODEX_MODE` 不是 `stub`。

违反：生产业务和真实 UX 验收不得通过 Stub 或 Host 直出结果。预览也必须明确区分 CI 模式和真实 app-server 模式。

测试：`R-013`、`R-014`。

## 中严重度

### C-004 Host/前端重复维护业务目录

证据：[`backend/src/host/compose-loop.ts`](../backend/src/host/compose-loop.ts)、[`backend/src/sops.ts`](../backend/src/sops.ts)、[`backend/src/host/home-board.ts`](../backend/src/host/home-board.ts)、[`frontend/src/journey.ts`](../frontend/src/journey.ts)、[`frontend/src/recommendedTasks.ts`](../frontend/src/recommendedTasks.ts) 均维护模板、阶段动作、推荐或下一步文案。

违反：业务目录、缺口、推荐和模板应由 Skill/Workflow/知识或 Codex 产物提供；Host 只能做安全校验、持久化和闸门。

测试：`R-014`，并要求迁移路线逐项删除重复目录。

本轮只迁移了员工端 Agent/团队入口。阶段状态机、`legalTargets`、副作用闸门和当前阶段邮件硬规则继续留在 Host，因为它们是宪法要求的内核语义；直接删除会把安全规则重新交给 Prompt/前端。剩余可变推荐、模板和缺口文案需要按 `13` 的迁移批次逐项外迁，并以回归证据作为删除条件。

### C-005 组织/品牌模型仍是过渡实现

证据：[`backend/src/db.ts`](../backend/src/db.ts) 仍使用 `users.brands` JSON、`orgs`、`teams`、`memberships` 等简化表，没有公司、组织树任期、品牌范围、区域范围和责任分配的完整关系模型。

违反：无法完整表达多公司、多部门、多品牌、区域和刘敏的业务责任关系。

测试：`F-ORG`、`R-001`、`R-002`。

### C-006 前端存在本地 Agent/Skill 编排目录

历史扫描发现 [`frontend/src/agentConfig.ts`](../frontend/src/agentConfig.ts) 维护 `AGENT_TEAMS`、`AGENT_ENTRIES` 和 Skill 步骤。当前 `AGENT_TEAMS`/`AGENT_ENTRIES` 已迁移到 `agents/kol/manifest.yaml` 的 `employee_views`，前端通过 `/api/agent-manifest` 展示；该文件只保留调试用执行面标签，不再保存业务步骤。

违反：前端只能展示服务端发布的 Agent/Skill schema，不得成为第二个业务 catalog 或调度器。

测试：`F-SKILL`、`R-019`。

### C-007 Skill frontmatter 解析对 Windows 换行不兼容

证据：[`backend/src/tasks/registry.ts`](../backend/src/tasks/registry.ts) 使用 `text.startsWith("---\\n")` 判断 frontmatter；仓库中的 [`backend/skills/business_approval/SKILL.md`](../backend/skills/business_approval/SKILL.md) 是 CRLF（文件头实际为 `---\\r\\n`），因此运行时错误地报告“manifest missing frontmatter”。

违反：同一 Skill 在 Windows 和 POSIX 环境必须得到相同的 manifest 解析结果；否则 Codex/Skill 目录不能作为可移植的业务契约。

测试：Skill catalog contract、`F-SKILL`；当前后端套件已有大量失败由此触发。

### C-008 测试入口和 E2E 启动脚本不可移植

历史证据：[`backend/package.json`](../backend/package.json) 的 `test` 使用 POSIX 环境变量，[`frontend/playwright.config.ts`](../frontend/playwright.config.ts) 依赖 Unix 启动脚本。当前已改为 Node 测试入口、`--configLoader runner`、Node E2E server，并允许配置 Vite/Playwright 输出目录；本机剩余失败来自临时目录锁定、测试隔离数据和宿主资源，不再是命令行不可移植。

违反：宪法要求测试可重复、可自动执行；平台相关脚本失败会使红线无法被证明。

测试：测试入口自检、`F-UX-STATE`、发布门禁。

### C-009 Windows 无法发现 Codex app-server 可执行文件

证据：[`backend/src/worker/codex.ts`](../backend/src/worker/codex.ts) 原先只在 PATH 中查找无扩展名的 `codex`，Windows 实际安装的是 `codex.exe`。

违反：Windows 生产环境无法启动宪法要求的真实 Codex app-server，会错误降级为不可用或诱发 Stub 误用。

状态：已修复，Windows 现在按 `codex.exe`、`codex.cmd`、`codex` 顺序发现；真实 handshake 与 account auth 已实测通过。

## 当前测试基础的限制

- `backend/package.json` 的 `test` 脚本默认使用 `CODEX_MODE=stub`，可显式切换到 real；Stub 结果只能证明确定性逻辑。
- 真实 Codex/MCP 测试需要 Node 原生依赖、app-server 和 staging 凭据；不能用 Stub 结果冒充生产验收。
- KOL Markdown 已切换为 `data/kol` canonical 来源，并由 `backend/scripts/validate-kol-data.mjs` 校验 5 份业务表、15 个正式阶段、10 个长期/异常场景和 22 个邮箱绑定；该校验尚未等同于组织 registry 或运行时 Agent registry。
- 已增加最小契约编译器：`npm run validate:contracts` 校验组织/品牌 registry、Agent manifest、Workflow、Policy、Schema、FS 追踪和 EVAL；`--production` 要求 `status=production`（2026-09-13 已发布）。TB 远程差异按业务负责人指示不计入本轮结论，校验器仍禁止品牌回退；公司组织绑定已确认。
- 现有测试覆盖很多 KOL 邮件和阶段规则，但尚未形成 `FS-* → BR-* → EVAL-*` 完整追踪矩阵。
- 本次真实执行仅触达 allowlist 内的一封 staging 测试邮件（远端消息 `1218`，状态 `SENT`）；阶段写入仍因测试 KOL 缺少远程生命周期记录而阻塞。删除、解密和其他生产 MCP 写工具未触达，必须在 staging 与生产只读阻断器环境中单独验收。

## 修复状态

| 项目 | 状态 | 实施 |
|---|---|---|
| 多邮箱不再隐式选第一邮箱 | 已修复 | 前端选择、Starry 绑定、Host PEP、草稿和同步路径均要求明确绑定；单一授权邮箱或明确品牌的唯一候选才可解析 |
| 人工阶段不再默认相邻阶段 | 已修复 | 无后端建议时保持空选择，必须人工选择具体目标 |
| real preview 不再进入 Stub/本地种子 | 已修复 | `runWorker` 只在 `CODEX_MODE=stub` 使用 Stub；真实预览缺少 Codex 产物直接失败 |
| CRLF Skill frontmatter | 已修复 | registry 统一换行并去 BOM |
| Windows 测试/E2E 启动 | 部分修复 | Node 测试入口、Vite runner、跨平台 E2E server、可配置产物目录和 Windows Codex fixture shim 已落地；后端全量已绿，当前宿主仍禁止 Chromium `spawn`，需在干净 CI/受控主机复跑 |
| Windows Codex app-server 发现 | 已修复 | 支持 `codex.exe`/`codex.cmd`；真实 handshake、account auth 通过 |
| 真实写操作 | 受控启用 | 必须设置 `LIVE_REMOTE_SIDE_EFFECTS=1`，并同时配置 `LIVE_TEST_RECIPIENTS`、`LIVE_TEST_KOL_UIDS`；未通过 allowlist 不会发送或写阶段 |

## 2026-09-12 复扫结论

本次复扫结合真实 MCP 只读探测、契约编译、类型检查和统一发布门禁完成。C-001、C-002、C-003、C-007、C-008、C-009 的实现项已落地并有增量测试；它们不再作为当前阻断项。C-004、C-005、C-006 仍是结构性债务，且新增了以下可验证状态：

| 项目 | 当前状态 | 证据 |
|---|---|---|
| 机器可读试点契约 | 已具备 | `config/`、`agents/kol/manifest.yaml`、`workflows/`、`policies/`、`schemas/`、`specs/`、`evals/`；`npm run validate:contracts` 通过 |
| KOL 数据 canonical 来源 | 已具备 | `data/kol/README.md`、`validate:kol-data` 通过 |
| Codex scope/PEP 注入 | 试点正式完成 | `contract-scope.ts` 注入公司、组织、品牌、区域和部门负责人全范围策略；`inbound-scope.ts`、`pep.ts` 执行普通数据/邮箱范围；高风险 Gateway 继续单独闸门 |
| 企业组织主数据 | 试点正式授权已完成 | 安培时代公司、组织树、张慧玲/刘敏部门负责人、全品牌/全区域普通数据读写政策和远程邮箱 MCP 证据已进入 registry；正式多公司关系表和动态同步属于平台扩展项 |
| 员工端 Agent 目录 | 已迁移 | `agents/kol/manifest.yaml` 的 `employee_views` 是唯一入口；`/api/agent-manifest` 提供页面展示，前端不再维护团队/入口数组 |
| 全量测试发布证据 | 阻断 | 最新 `release:gate` 因后端 32 个测试文件失败而返回 `blocked`（544 个测试：331 失败、212 通过、1 跳过，另有 1 个未处理错误）；主要是 Windows 临时目录 `EPERM`、认证上下文和 Node 原生 SQLite fallback |
| 阶段写入 | 阻断 | 测试 KOL 缺远程生命周期记录，无法验证真实写入和版本冲突 |

## 2026-09-13 修复后复扫

| 项目 | 当前状态 | 证据 |
|---|---|---|
| 后端全量确定性测试 | 已通过 | 54 文件，543 通过、1 跳过、0 失败；`npm test -- --pool=forks --maxWorkers=1` |
| 试点契约与 KOL 数据 | 已通过 | `validate:contracts`、`validate:kol-data` |
| 前端类型与构建 | 已通过 | `npm run typecheck`、`npm run build`；693.25 kB chunk 警告 |
| E2E webServer | 已通过启动 | `scripts/e2e-server.mjs` 可启动 backend；用 `E2E_SKIP_BUILD=1` 避免 Windows dist 句柄重复清理 |
| E2E 浏览器执行 | 阻断 | 72 条用例均因宿主 `chrome-headless-shell.exe` `spawn EPERM`，未产生应用断言绿灯 |
| TB/生产发布 | Agent 已发布；TB 仍豁免 | 2026-09-13 将 `agents/kol/manifest.yaml` 设为 `production` / `employee_submission: true`。TB 远程差异仍不计入验收；校验器仍禁止品牌回退。发布不等于生产放行（E2E/阶段写入仍开）。 |

### 组织范围策略

| 项目 | 当前状态 | 证据 |
|---|---|---|
| 部门负责人公司级范围 | 已实现 | `config/org-registry.yaml` 声明全品牌/全区域/普通数据 read/write；`contract-scope.ts`、`inbound-scope.ts`、`pep.ts` 执行该政策；高风险动作仍走 Gateway/确认 |
