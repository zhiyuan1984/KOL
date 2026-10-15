# 治理开发执行链

> 本说明是实施资产，不改变 [`../CONSTITUTION.md`](../CONSTITUTION.md)、[`../TECHNOLOGY.md`](../TECHNOLOGY.md) 或 [`../DESIGN.md`](../DESIGN.md) 的位阶。它落实 CONST-08、CONST-10、TECH-ARCH-04、TECH-TEST-01；**执行资产通过不等于功能、浏览器体验或生产发布已完成**。

## 目的与边界

本链把一次变更变为可复核的动作：**意图与改动路径 → 实际加载规则/技能 → 角色和产物 → 机器检查与人工证据 → 交付记录**。路由数据位于 [`../../config/development-task-routes.yaml`](../../config/development-task-routes.yaml)，技能登记位于 [`../../config/development-skill-registry.yaml`](../../config/development-skill-registry.yaml)。两者是 JSON 兼容 YAML，使用 Node 内建 JSON 解析，未增加依赖。

路由同时评估用户意图和路径：

| 情况 | 结果 |
|---|---|
| `frontend/src/admin/knowledge/**` 或 `backend/src/knowledge/**` | 同时选中 UI 状态、布局/组件、异步可观察性、文档保真和证据技能；不将知识加工误降为普通后端任务。 |
| UI/布局或前端路径 | 选择状态、布局、Ant Design 组件及证据技能。 |
| 导航意图或路由路径 | 追加导航契约和地址/返回上下文验证。 |
| worker/job/queue/outbox 或异步意图 | 追加异步契约、恢复测试和浏览器等待复核。 |
| 纯后端无关改动 | 只加载基础路由技能与受影响后端验证，**不加载全部 UI 技能**。 |

## CLI：实际加载而非自我声明

从仓库根目录运行。`--intent` 和 `--path` 都可重复；逗号分隔也可。路径为仓库相对路径，preflight 不要求拟新增的文件已经存在。

```bash
node scripts/development-preflight.mjs \
  --task-id knowledge-123 \
  --intent '知识提炼,异步任务,文档预览' \
  --path frontend/src/admin/knowledge/DocumentRail.tsx \
  --path backend/src/knowledge/knowledge-job.ts \
  --out /tmp/knowledge-123-governance
```

成功时写出：

- `task-contract.json`：主责/协作角色、适用条款、必读、所选技能的注册版本及 `SKILL.md`/模板/依赖哈希、所需输出和检查。
- `loading-bundle.json`：所有实际读取文件的路径、SHA-256、字节数和**完整内容**，供 Codex CLI 或其他入口加载。它不能以 YAML 中的文件名替代真实读取。

Preflight 会阻止：未登记或不存在的技能、前置依赖/模板缺失、技能 `name` 不匹配、额外 frontmatter 字段、版本不为 `1.0.0`、模板不是约定的草案 JSON。技能前置元数据只允许 `name` 与 `description`；版本由 registry 管理。

## 八个登记技能与资源路径

技能包由负责方放入仓库 `.agents/skills/`；本执行链不代写技能内容。每项 registry 版本必须为 `1.0.0`，并包含以下已登记资源：

| 技能 | 资源路径 | 输出契约 |
|---|---|---|
| `governed-task-routing` | `.agents/skills/governed-task-routing/SKILL.md`; `templates/task-contract.json` | `task-contract` |
| `ux-task-and-state-design` | `.agents/skills/ux-task-and-state-design/SKILL.md`; `templates/state-and-action-map.json` | `state-and-action-map` |
| `information-architecture-navigation` | `.agents/skills/information-architecture-navigation/SKILL.md`; `templates/navigation-contract.json` | `navigation-contract` |
| `responsive-page-layout` | `.agents/skills/responsive-page-layout/SKILL.md`; `templates/layout-contract.json` | `layout-contract` |
| `antd-component-engineering` | `.agents/skills/antd-component-engineering/SKILL.md`; `templates/component-selection.json` | `component-selection` |
| `document-fidelity-viewing` | `.agents/skills/document-fidelity-viewing/SKILL.md`; `templates/preview-contract.json` | `preview-contract` |
| `async-job-observability` | `.agents/skills/async-job-observability/SKILL.md`; `templates/async-contract.json` | `async-contract` |
| `ui-evidence-verification` | `.agents/skills/ui-evidence-verification/SKILL.md`; `templates/browser-and-source-evidence.json` | `browser-and-source-evidence` |

每个模板必须是 JSON 草案，至少如下；可附加该输出专用字段：

```json
{
  "schema_version": 1,
  "kind": "<output-name>",
  "status": "draft",
  "owner": "<role>",
  "requirement_refs": [],
  "subject": {},
  "decisions": {},
  "verification": {}
}
```

模板可由初始化脚本或人工复制实例化，但**草案本身永远不是验收证据**。交付产物必须满足 schema：`status` 为 `complete` 或 `passed`、`decisions` 非空、`kind` 与要求的输出一致，并绑定 task ID。

## 交付与验证

把任务产物、测试报告和人工记录放在同一交付目录，创建 `development-delivery.json`（结构见 [`../../schemas/development-task.schema.json`](../../schemas/development-task.schema.json)），然后执行：

```bash
node scripts/development-verify.mjs \
  --contract /tmp/knowledge-123-governance/task-contract.json \
  --delivery /tmp/knowledge-123-governance/development-delivery.json \
  --out /tmp/knowledge-123-governance/verify-report.json
```

verify 会按 schema 校验 task contract、每项适用产物和 delivery record；重读 preflight 已加载的仓库文件并检查 SHA-256；检查产物/证据哈希、任务 ID、非空决策及状态声明冲突。以下任一情况均失败：必需产物或检查缺失、产物状态非 `complete`、检查为 `failed`/`skipped`/`pending`/`not-run`、机器检查无 `exit_code: 0` 或 `test-report`、源文件被篡改、同一主体/事实出现冲突状态。

| 检查类型 | verify 可以验证 | verify 不会声称 |
|---|---|---|
| `machine` | 命令记录、`exit_code: 0`、`test-report` 文件与哈希 | 测试覆盖了所有业务或 UX 风险。 |
| `human` | 具名复核者、时间、源复核证据的存在与哈希 | 人类的结论正确。 |
| `human-browser` | 具名复核者、时间、截图/浏览器记录/源页对照的存在与哈希 | UI/UX 专家已经审阅，或浏览器/原件保真合格。 |

因此 report 会把机器验证标为 `passed/failed`，把人工/浏览器部分标为 **`records-present-not-automatically-judged`** 或无效记录；不会伪装专家已经审阅。

## CI 与发布边界

[`.github/workflows/development-experience.yml`](../../.github/workflows/development-experience.yml) 运行执行器的隔离正负例回归，并在真实技能包存在时用知识和导航样例生成 loading bundle。它不修改、替代或宣称通过 [`release-gate.yml`](../../.github/workflows/release-gate.yml)，不设置 required check 或分支保护，也不代表生产发布完成。实际功能变更仍须按适用基本法运行测试、人工/浏览器复核和既有发布流程。

## 实际 CLI 注入入口

不是要求开发者口头声称“已读技能”，而是直接将已核对的文件内容交给支持 stdin 的开发入口：

```bash
node scripts/development-exec.mjs \
  --task-id knowledge-123 \
  --intent '知识提炼一直等待,文档预览,导航' \
  --path frontend/src/admin/knowledge/DocumentRail.tsx \
  --path backend/src/knowledge/scopes.ts \
  --out /tmp/knowledge-123-governance \
  -- codex exec -
```

该入口先运行 preflight，再按字节 SHA-256 核对 bundle 内容和仓库文件，最后执行明确指定的 CLI（不经 shell 拼接）。输出 `entry-prompt.md`、`entry-stdout.log`、`entry-stderr.log` 与 `entry-receipt.json`。只有内容传输得到回执；**不能从 stdin 交付推断模型确实采用某技能、专家已审或任务已完成**。入口支持其他 stdin CLI，失败退出码和错误回执如实保存。日志可能包含私人源码或输入，请在受控目录保存，不将目录直接公开托管。

preflight 根据路由责任显式补读 `frontend/AGENTS.md` / `backend/AGENTS.md`，不依赖“根目录启动会自动加载子目录入口”的错误假设。必要组件目录和来源/许可证记录也进入实际 loading bundle。

## 知识加工首个试点

- 查询 [组件目录](development-component-catalog.md)，复用 `PropertyList`，构造 `AsyncTaskInfo` 和 `DocumentReader`；局部 `ProjectTheme` 只消费现有 CSS token，没有引入 ProComponents、主题数值表或通用控件的副本。
- 后端契约见 [知识异步交接说明](../knowledge-async-scope-contract.md)。迁移 043 **必须先于新后端/worker** 执行；仅应用于 PostgreSQL。
- 活跃作业没有新的业务进展时最多跟踪 15 分钟，持久交接最多 2 分钟；连续读取失败最多 8 次，401/403 等权限错误立即停刷并提供手动重新读取。新批次进展或新的阶段会重置正常跟踪窗口。上限表示本次读取窗口结束，不表示作业失败。
- 后台 worker 启动和已有心跳周期独立扫描持久 pending 意图（有限批次），使用已保存的原始授权人再次检查权限；无需页面保持打开。GET 的修复只作额外补偿，绝不是唯一调度来源。
- PPTX 逐页 PDF 可能有字体/换行差异。PDF.js 渲染或 SHA 相同不证明转换等同 PowerPoint 原件；缺原页对照时不准通过保真检查。

实际验证命令：

```bash
node scripts/test-development-execution.mjs
node scripts/test-development-entry.mjs
cd frontend
npm run typecheck
npm run test:knowledge
npm run build
npx playwright test --config playwright.knowledge-pilot.config.ts
npx playwright test --config playwright.knowledge.config.ts
```

真实原件检查是显式的独立层，不用无凭据跳过冒充通过：

```bash
# 已有私有逐页 PDF 的合法只读路径；不把原件写入 Git。
KNOWLEDGE_PILOT_REAL_PDF=/private/path/existing.pdf \
PW_EXECUTABLE_PATH=/usr/bin/chromium \
npx playwright test --config playwright.knowledge-pilot.config.ts
```

后端在 `backend` 工作目录，用 **专用、可创建临时数据库的测试 PG**（绝不能用生产 DATABASE_URL）运行：

```bash
TEST_DATABASE_URL=postgres://test-role:password@localhost/test_admin npm test -- \
 tests/knowledge-scope-async.test.ts \
 tests/knowledge-scope-concurrency.test.ts \
 tests/knowledge-scope-contract.test.ts \
 tests/knowledge-scope-async.postgres.integration.test.ts \
 tests/knowledge-scope-progress.postgres.integration.test.ts
```

真实 PG 多批次测试调用实际 `generateScope` 和持久进度 SQL，但模型返回是确定性夹具；不得报告为 live-model 质量、Redis 传输或生产端到端验证。CI 新增知识组件/构建、真实 PG、HTTP fixture 浏览器作业，并保留原发布门禁。外部字体授权、PowerPoint 对照或生产预发条件欠缺时，记录未通过项，不自动合并、发布、重跑资料或更改分支保护。
