# Admin Agent / 员工目录 E2E 测试对账报告

## 结论

已仅更新以下两份目标 E2E 文件，使其与当前 `InformationLayout` 共享展示结构、`AdminAgents` 的现行筛选/绑定交互、以及 `EmployeeDirectoryV2` 的现行 `RecordRow` DOM 对齐：

- `frontend/e2e/admin-agents.spec.ts`
- `frontend/e2e/admin-employees.spec.ts`

**没有修改任何生产页面、共享组件、API、数据库、部署或路由。** 本报告为任务明确要求的新文档；工作区中随后出现的其他页面/CSS/全局测试文件改动不是本轮所写，见“并发变更注意事项”。

> **未执行任何新的 Playwright 测试，也不声称测试已通过。** 本轮仅作源码、日志、远程既有失败工件与静态结构核对。

## 审查依据

已读取并交叉核对：

| 范围 | 已核对内容 |
|---|---|
| Agent 页面 | `frontend/src/pages/AdminAgents.tsx`：默认 `bindingType = "person"`、7 个绑定类型筛选、共享摘要 `section[aria-label='Agent 摘要']`、三级部门级联筛选、复选目标、`bulk-preview`/`bulk` 绑定、撤销预览与原因 |
| 员工页面 | `frontend/src/admin/employees/EmployeeDirectoryV2.tsx` 与 `EmployeeDirectory.tsx`：员工卡由 `RecordRow` 根节点承载，Agent 在 `ui-record-meta`，状态在 `ui-record-status`，组织筛选及个人绑定逻辑未改写 |
| 共享展示 | `frontend/src/components/InformationLayout.tsx`：`RecordRow` 根为 `ui-record-row`，其子区为 `ui-record-main`、`ui-record-meta`、`ui-record-status`、`ui-record-actions`、`ui-record-detail` |
| API 契约 | `frontend/src/api.ts`：Agent 页现用 `POST .../bindings/bulk-preview`，载荷为 `{ targets }`；确认用 `POST .../bindings/bulk`，载荷为 `{ targets, org_version, reason }`，返回取 `response.agent` |
| 架构约束 | `docs/TECHNOLOGY.md` §TECH-FE-01、§TECH-TEST-01/02/04 与 `docs/ia-information-architecture.md`：共享布局不应改变入口/路由；授权与覆盖名单由服务端结果决定；E2E 应保留试算、确认和副作用边界 |
| 既有回归证据 | 本地 `global-e2e-auth-fixed.log`；通过只读 SSH 读取 `/home/ecs-user/kol-global-0eFKM861/frontend/test-results/global-layout/**/error-context.md` |

## 已更新内容

### 1. `admin-agents.spec.ts`

#### 1.1 默认筛选与全范围验证

旧用例将初始列表断言为 **3 / 3**。当前页面的初始状态是 `bindingType = "person"`，且夹具中只有 **KOL 助理**具有人員绑定，因此正确初始结果是 **1 / 3**。

已改为：

1. 断言默认“人员”被选中、列表为 1 项、计数为 `1 / 3 个 Agent`；再次点击已选“人员”仍不取消。
2. 主动点击“全部”后才断言 3 项/`3 / 3`。
3. 选择已渲染的“商务 Agent”，以现行 `Agent 摘要`确认选中对象及状态。
4. 在已发布范围逐项验证 **公司、一级部门、二级部门、三级部门、人员、未绑定、全部**：三级部门只命中“商务 Agent”，人员只命中“KOL 助理”，一级/二级部门为空。
5. 在人员筛选使“商务 Agent”离开列表后，继续断言摘要仍是刚才选择的“商务 Agent”，从而覆盖“筛选不应误改详情选中对象”的不变量。
6. 保留状态筛选单选、不取消、草稿/未绑定交叉筛选与空态断言。

#### 1.2 新增草稿与共享摘要

新增草稿前先主动切换绑定类型到“全部”，避免新建的**未绑定草稿**被默认“人员”范围隐藏而误判为创建失败。

旧断言依赖已不承载选中名称的 `.governance-main-head h2`，以及已经不存在的“技能与知识库 / 人员范围 / 发布 / 运行与审计 / 审计行”。已改为验证现行不变量：

- 摘要卡包含“风控 Agent”和“草稿”；
- 可见治理区为“绑定技能”“绑定知识库”“组织人员绑定”，并保留“版本”；
- 空草稿仍显示未绑定提示、`0 项技能`、`0 人覆盖`、`0 个绑定点`；
- 发布操作使用当前按钮名“发布智能体”，仍保留后端 409 原因、版本载荷及取消确认卡断言。

#### 1.3 三级组绑定、取消零写入与撤销原因

旧用例使用已不存在的“选择目标”下拉与 `.governance-row-split`。当前页面以公司默认范围 + 1/2/3 级部门级联筛选 + 目标复选框呈现，因此已改为：

- 选择“品牌与用户增长中心 → 推广部 → LT组”，勾选“LT组”；
- 对当前 `bulk-preview` 载荷断言 `{ targets: [{ target_type: "organization_unit", target_id: "org:lt_team" }] }`；
- **先取消预览并断言 `state.binds` 为空**，随后对同一勾选目标重新试算，才确认绑定；
- 对 `bulk` 载荷完整断言目标、`org_version: 2` 和理由“管理侧 Agent 页面绑定”；
- 用 `#agent-bindings-card .ui-record-row` 断言新增/移除的“组织单元 · LT组”记录；
- 保留覆盖名单变化、`revoke-preview` 移除名单、必填撤销理由“试点结束”、实际 DELETE 载荷和原生 dialog 零出现断言。

测试桩仅随已存在的页面 API 调用对齐到批量路径及响应中的 `agent` 字段，未改变生产 API AST、后端行为或业务规则。

### 2. `admin-employees.spec.ts`

员工首例的准确源码级原因已定位：

- `[data-employee-row='usr_directory']` **本身**就是拥有 `employee-card` 类的 `RecordRow` 根节点；旧代码 `row.locator('.employee-card')` 做的是后代查询，不会命中自身，因此“应有 1 张卡”的断言为 0。
- 旧断言还将 Agent 和状态放在 `.employee-row-primary` 下；当前实现分别渲染在共享组件的 `.ui-record-meta .employee-agent` 与 `.ui-record-status .employee-status`。

已将首例更新为：

- 直接以 `row` 为卡根并断言其 `employee-card` 类；
- 断言姓名、Agent 元数据“商务 Agent”、状态“已启用”、邮箱和三个操作；
- 保留品牌/状态单选、组织过滤、独立滚动、绑定先试算后确认、直接绑定可撤销、继承来源只读、撤销原因与原生 dialog 零出现等负向/副作用验证。

同时修复第二个员工用例在不同视口中测量操作区时的共享组件选择器：旧 `.employee-main` 已替换为 `.ui-record-main`。该旧选择器会得到 `null` 并在调用 `getBoundingClientRect()` 时失败；现改为实际结构，仍保留“操作区在主信息右缘”和无横向溢出的断言。

## 既有失败证据与限制

### 本地日志

`/home/ubuntu/kol-global-impl/global-e2e-auth-fixed.log` 记录了以下既有失败条目：

- Agent 用例 1、2、3；
- 员工用例 1、2；
- 员工用例 3 已通过。

该日志仅含 reporter 列表，不含各目标用例的堆栈。远程 `frontend/test-results/global-layout` 在审查时**没有**生成这五个目标用例对应的 `error-context.md`；故不能把某一条远程错误文本伪称为目标员工首例的原始堆栈。员工首例的根因由当前测试选择器与当前 `RecordRow` 源码一一对应确认，见上节。

### 不作为“已通过”的验证

仅进行了：

- 已知过时选择器/文本的只读扫描；
- 两个目标文件的括号计数静态检查（均平衡）；
- 测试桩与 `api.ts`、页面调用的载荷和返回字段核对。

**没有运行 Playwright、构建、部署或任何写生产操作。** 后续应在隔离环境运行这两个 spec，再执行发布门禁所需的全量回归。

## 需要主任务处理的真实阻塞项

### `/admin/work-orders` 在既有 global-layout 烟测中崩溃

远程工件 `frontend/test-results/global-layout/...smoke-admin-work-orders.../error-context.md` 显示页面没有渲染“工单治理”，而是错误边界：

> `Cannot read properties of undefined (reading 'mode')`

根因链已定位：

1. 该 global-layout fixture 返回的 `organization/stages`、`organization` 报告缺少完整授权结构；
2. `AdminWorkOrders.tsx:169` 在 `counts` 有值时直接读取 `counts.authorization.mode` 与 `counts.authorization.root_units`；
3. 当 `counts.authorization` 缺失时，页面直接进入错误边界，而不是显示该资源的读取/契约错误状态。

这是**页面鲁棒性缺陷/夹具契约不匹配的阻塞项**，不属于本任务允许修改的两份测试文件，未改动。主任务应：

- 以 API schema 确认 `authorization` 是否必填；
- 若必填，修正 global-layout 只读夹具，使其提供完整 `authorization`、`by_status`、`by_assignee_unit`、`timezone` 等契约字段；
- 无论契约是否必填，页面应避免对外部响应的嵌套字段无保护解引用，并在不完整响应时显示明确可恢复错误，而非崩溃。

### 长线索标题 global-layout 失败：测试前置交互缺失，非本轮目标页缺陷

另一远程工件显示“long lead title”在 `goto('/leads')` 后直接查找“查看完整标题”按钮失败；可访问性快照仍显示“选择一条线索查看详情”。当前 `Leads.tsx` 初始 `selectedId` 为 `null`，只有点击列表项才调用 `openDetail()`。

该测试在未选择线索、也未强制窄视口产生截断的条件下，直接期待展开按钮，属于**测试前置交互/视口假设失配**，不应通过改 Agent/员工测试或改路由掩盖。此全局测试文件不在本任务允许编辑范围，未修改。

## 并发变更注意事项

最终检查时工作区还出现了 `frontend/src/components/information-layout.css`、`frontend/e2e/global-layout.spec.ts` 和 `frontend/src/pages/Leads.tsx` 的较新时间戳；这些不在本轮编辑范围，未被本轮写入。执行后续验证前，请以合并后的最新页面和全局测试版本复核本报告中的非目标页结论。

## 建议的后续验证顺序

1. 先由主任务处理或确认 `/admin/work-orders` 的响应契约/防御渲染问题；
2. 在隔离环境仅运行 `admin-agents.spec.ts` 与 `admin-employees.spec.ts`，确认更新后的选择器及批量绑定桩；
3. 再运行 global-layout 门禁，分别验证路由保持、无页面崩溃、长标题可访问性与零业务写入；
4. 将真实运行日志、trace、版本与时间补充为发布证据；不要以本次静态对账替代运行通过。

## 主任务后续纠正（2026-10-11）

上方静态建议不是最终决策。主任务真实回归发现人员列表共享迁移退化，已恢复原卡片和原目录测试，仅保留绑定详情/编辑迁移。Agent测试追加计数徽章匹配与属性dd断言。长线索列表本身确有hover-only漏项，已改为可聚焦完整展开并通过样板；工单fixture已补完整authorization并通过。最终运行状态以主任务验收报告为准。

最终人员边界：EmployeeDirectoryV2完整恢复生产基线，包含目录卡与绑定详情；本批只改EmployeeEditDialog短字段横向布局。未迁移绑定详情明确保留，不宣称共享模式已接入。人员原有几何、完整Agent展开及确认测试保留。
