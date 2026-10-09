# Home 五 Tab 视觉补丁合并验证（2026-10-09）

## 范围与基线

- 用户提供：`ui-unify-5tabs-from-56fef12b.patch`，基线 `origin/main@56fef12b`。
- 实际合并起点：`main@e2e15e4c7bbcedf11b580d381df00361ff0a9e77`。
- 原基线及最新 main 的 `git apply --check`、完整 `git apply` 和 `git diff --check` 均通过，无冲突。
- 原补丁修改 WorkspaceShell 的 CSS 引入、增加 antd-visual.css、移除 styles.css 的桌面 Home 宽度例外并设顶部 4px。
- 未新增依赖，不改变页面内容、数据流、业务动作、权限、确认流程或路由。
- 本次仅收到 patch；附件目录没有所提同目录 README，服务器也未找到 today-todo-rework/pool/followed 的待打 Home 补丁。现有 main 与生产改动均保留。
- 后续 Home 补丁若改同一批样式，按用户要求保留本次视觉 CSS；不要覆盖本次对比度修正。

## 审查记录

需求 → 合入并发布用户提供的五 Tab 视觉补丁。

主责角色 → 前端实现、测试验证、发布运维。

宪法条款 → CONST-04（仅呈现层，不改业务规则）；CONST-08（本记录）；CONST-10（区分渲染测试、生产健康与业务闭环）。

基本法条款 → TECH-FE-03（独立会话地址与恢复不变）；TECH-TEST-01/02/03/04（相关范围验证、真实证据、保留回滚）。DESIGN §1.4（文字 AA 对比度）、§27.2（已有会话几何）。

结论与证据 → 符合上述宪法与技术条款；原补丁的 antd 蓝色、14px 等相对 DESIGN 的偏离依据用户所给补丁执行，不修法。已有会话宽度例外继续保留，不将注释中的“五 Tab 同为 1200px”冒充全部已实现。

下一步 → 推送 main、备份生产差异、无损快进、运行现有 deploy.sh、校验版本/健康/服务与静态资源。

## 实际布局例外

`frontend/src/home/workspace/workspace-shell.css` 中 `.home-pane[data-home-workspace]:has([data-agent-visual]) .home-stage.home-stage` 比补丁规则优先级更高。AI 发现继续采用 DESIGN §27.2 的会话几何：桌面 stage 占侧栏以外可用宽度；其他四 Tab 恢复 shared-frame 上限。1920px 视口中 AI 发现 stage 为 1660px，其他四 Tab 不超过 1200px。独立会话的 400px 内容列及均衡 gutter 保持原状。

新增冒烟用例明确测出并保留此例外；没有修改旧测试地址或降低旧断言。

## 最小发布修正

原补丁新增两项对比度回归，未打补丁 main 的同用例通过：

- 浅色确认区：链接与“确认开始采集”约 4.10:1。
- 深色确认区：链接约 4.47:1，按钮约 4.20:1。

只在 antd-visual.css 末尾调整文字链与 `[data-discovery-start-confirm]` 的蓝色色阶；保留所有业务逻辑、按钮级别、禁用态及会话作用域。浅/深主题确认文字原有回归现已通过。

## 验证结果

| 验证 | 结果 | 说明 |
|---|---|---|
| 原基线与最新 main apply 检查/完整应用 | 通过 | 无冲突 |
| 最终 `npm run build` | 通过 | 包含 TypeScript noEmit |
| Home Vitest | 236 通过，1 失败 | 唯一失败在未打补丁 main 复现 |
| 相关展示 E2E 最终版 | 46 通过，3 失败 | 3 个失败均在未打补丁 main 同位置复现 |
| 五 Tab 浅/深主题冒烟 | 2 通过 | 每项覆盖 5 Tab × 5 宽度，共 50 组合 |
| 浅/深主题确认文字对比度 | 通过 | 已修复原补丁引入失败 |
| 独立会话、深链、浏览器返回、确认与滚动回归 | 通过 | 保留地址与已有会话视觉 |

冒烟宽度：375、768、1280、1440、1920px；检查主题 token、选中下划线、键盘聚焦、外层无横向溢出、四 Tab 几何一致及 AI 发现既有例外。既有相关测试另覆盖矮窗口及粗指针。

所有上述前端 E2E 使用拦截 fixture，不调用生产外部工具，不证明真实采集/发信/入库业务闭环。

### 基线已有失败（本次不改）

1. `src/home/discoveryRemoteCrawl.test.ts`：“非推进状态不展示”期望 null，与当前完成态返回不一致。
2. `discovery-presentation.spec.ts:354`：找不到预期“确认入库”按钮。
3. `discovery-presentation.spec.ts:375`：找不到 `[data-discovery-ingest]`。
4. `discovery-presentation.spec.ts:453`：候选容器为空，读取 children 失败。

不得将上述结果报告为全量测试全通过。

## 部署方式与回滚

- 真实活动目录是 `/home/ecs-user/kol-releases/kb-assets-e2e15e4c`；并非旧 `~/kol` 工作区。
- 当前活动目录有生产专用未提交改动，旧 `~/kol` 也有其他任务的改动；不用 `deploy.sh --sync` 或 `git reset --hard`。
- 在已授权人工发布中，保留所有 tracked/untracked 生产差异，使用 detached revision 无损快进，再运行活动目录的 `bash scripts/deploy.sh`。
- 推送提交沿用仓库现有人工发布 `[skip ci]` 标记，避免长时全量流水线再次对旧 `~/kol` 做破坏性同步；这不代表全量 release gate 已通过。
- 服务器备份目录：`/home/ecs-user/kol-release-backups/ui-unify-20261009-1357`。包含旧 SHA、tracked/index patch、untracked 存档与校验、旧 dist，以及部署脚本。
- 切换与部署前后比较 retained diff 和 untracked 文件 SHA；构建失败或健康/版本校验失败自动恢复旧 revision 和 dist，再重启原四个服务。
- 本次无数据库/schema/权限/密钥变更。
