# 连接器管理端界面重做：设计与实施规格

> **视觉口径更新（2026-10-03）：** 本文中的「参考图实测 ×0.7」、逐像素尺寸和两列浏览卡片是历史实施记录，已由现行 [DESIGN.md](../../DESIGN.md) §0/§4/§5/§7 替代。参考图仅用于字段与顺序；视觉尺寸直接取现行 token，浏览目录使用列表行。本文其余业务与接入决策仍须按现行上位规则核对。

> **修订（2026-09-27）：** 本文档的「逐工具范围 / 行内授权 / 批量授权 / 连接器级组织范围 / 员工 read/write」部分（增补 A3、A5 及工具抽屉授权交互）由 [DECISIONS.md](../../DECISIONS.md) ADR-2026-09-27「对外只暴露技能」取代并废止；其余（枢纽/详情六卡、SSE、凭据保险库、JSON 导入、图标、只读工具清单）仍有效。

**日期：** 2026-09-26
**范围：** 管理端 `/admin/connectors` 枢纽与 `/admin/connectors/:id` 详情；连接器运行时（MCP 传输、组织范围、图标、导入）；不改员工端使用面。
**依据：** 用户批复的界面重做方案（复刻上传附件 + API 连接结合 + MCP 接口查看 + 一级/二级部门与人员绑定）。

## CONST-08 审宪记录

| 项 | 结论与证据 |
|---|---|
| 需求 | 按附件重做管理端连接器 UI/UX（两模式卡片网格、分类 Tab、创建菜单、配置面板）；可查看 MCP 服务接口；可绑定一级部门、二级部门、人员；结合平台既有连接能力。 |
| 主责角色 | 平台产品经理（功能与验收）· UI/UX 专家（布局/交互/视觉）· 架构师（模块边界）· 前端/后端专家（实现）· 测试经理（证据） |
| 宪法条款 | CONST-02（平台能力与业务分离）、CONST-04（前端不重写权限判定）、CONST-05（读/写/正式动作分级，管理员不绕闸门）、CONST-08、CONST-10（不得冒充生产能力） |
| 基本法条款 | `docs/07-mcp-data-contract.md`（L1/L2/L3、真实调用、秘密只引用不落文）；`docs/org-permissions.md`（枢纽/详情职责、凭据永不回显、审计切片）；`docs/ia-information-architecture.md`（一页一问、使用≠治理）；`docs/DESIGN.md`（0–1 实底 CTA、状态不只靠颜色、token 唯一来源）；`docs/TECHNOLOGY.md`（TECH-BE-01/07） |
| 结论与证据 | **符合**。四块能力（界面重做、MCP 接口清单、连接器级组织范围、SSE 传输）均不触碰 L3 Gateway 与发送/阶段/解密闸门；「自定义 API（HTTP/OpenAPI）」经用户 2026-09-26 裁决**不放开生产闸门**，本期不做（adr 记录于 `docs/DECISIONS.md`），现行 `managed_connector_requires_mcp` 闸门保持。 |
| 下一步 | 按 §实施顺序交付；每步附类型检查、测试与 E2E 证据。 |

## 用户裁决（2026-09-26，基线）

1. **秘密/Header 值输入**：采纳附件式「直接填值」体验——表单接受明文值，**保存时写入凭据保险库**（`POST /api/admin/runtime/credentials`，组织 Secret），配置里只存 `cred_…` 引用；保存后永不回显。
2. **传输类型**：**实现 SSE**（`streamable-http` / `sse` 双选），不再标注「暂不支持」。
3. **自定义 API**：不放开 HTTP 生产闸门；`自定义 API` 页签与流程**本期不做**（创建菜单与 Tab 相应收敛）。
4. **部门候选**：接入 `config/org-registry.yaml` 作为一级/二级部门候选（canonical id 存入节点 `external_id`），手输保留兜底并标注「未登记名称」。

## 信息架构

### 枢纽 `/admin/connectors`

- 版式（2026-09-27 三版）：标题「已添加的连接器」与治理数字（受管连接器 / 已启用 / 凭据已登记 / 待处理，`data-admin-health` 保留）**同排**——标题居左、数字组居右，基线对齐；细分隔线在两者下方（窄屏回落上下两行）。搜索（左）+ **等宽**的 [浏览连接器] [创建 ⌄]（右）；卡片网格 2 列（`--radius-cards` 圆角、48px 图标砖）。
- 管理端外壳（所有管理页统一）：不再渲染「当前账户」卡与「← 返回员工工作台」；回员工端入口改用侧栏账户块的「员工端⇄管理端」分段切换。
- 「浏览连接器」改为**目录弹窗**（参考版式）：标题「连接器」+ 右上 [创建 ⌄] + X；搜索；Tab（应用 / 自定义 MCP）；未加入目录的内置项右侧 `+`；「自定义 MCP」下含「新建自定义 MCP」虚线卡；选中创建项 = 关闭弹窗并打开对应创建面板。
- 卡片 = 图标砖 + 名称 + 用途（≤2 行）+ 小字状态行（状态 · 最近验证 [· 已审阅接口] · 「查看工具」文字入口）+ 右侧 `✓`；点击卡片或标题进详情；不使用 chip / 按钮堆叠。
- 状态文字可点（`data-connector-status-entry`）：打开该连接器的**接入配置弹窗**（标题 = 连接器名，副标题 = 状态与状态说明；复用同一配置表单，Esc 关闭、焦点归还）；「查看工具」与状态两个入口各自独立，不触发进详情。
- 创建菜单三项：**自定义 MCP**、**通过 JSON 导入 MCP**、**通过 URL 添加 MCP**。
- **自定义 MCP 弹窗**（2026-09-27 七版，按参考图比例再降一档：实测值 ×0.7，基准标签 14px）：标题「MCP 配置」+ X，无副标题、无「取消」按钮（Esc / 点遮罩关闭）；第一行两列 = 服务器名称（占位 `e.g., My Custom Server`）｜ 传输类型（HTTP / SSE）；图标 = 56px 虚线占位框 + 「上传 ⌄」分裂按钮（菜单含「上传」「移除」）；备注（可选）95px 高；服务器 URL；自定义 headers（两列等宽 / 值 / 删除 + 「+ 添加自定义 header」）；底部 = 左侧一行「保存只生成待验证草稿，不等于启用。」+ 右侧「保存 ｜⌄」分裂按钮（菜单含「发布并保存」）。headers 区不再展示「值将加密写入凭据保险库…」说明；接入配置弹窗不再展示状态副标题、不再展示「放弃修改并刷新」，也不再提供「接入类型」切换（协议在创建入口决定）。
- **参考图测量记录（唯一来源 `docs/DESIGN.md` §连接器控制台）**：参考图（818×974 与 1186×1264 两份裁剪）是**高分屏截图**，实测 px 不能直接当 CSS px 用；按「字段标签 14px」为基准整体 ×0.7。参考图层级（同一裁剪内墨高比）：标题 21.6 / 标签 17.5 / 按钮 16.9 / 说明 16.2 —— 落地时标签不加粗（字重 400），「（可选）」后缀只降颜色。实测 → 落地（×0.7）：卡片宽 800 → 560、左右内边距 28 → 20、上 30 → 20、下 40 → 26、卡片圆角 20 → 14、控件高 48 → 34、控件圆角 8 → 6、按钮/虚线框圆角 10 → 7、图标位 80 → 56、备注域高 136 → 95、两列间距 26 → 18、字段块间距 26 → 18、headers 行距 12 → 8、标签到控件 16 → 11、标题块到首字段 22 → 16；字号：标题 → 17、标签与输入 → **14（基准）**、说明 → 13；取样色：控件填充 `#ececeb`、卡片底 `#f8f8f7`、标签/输入 `#1a1a1a`、说明 `#737373`、占位 `#a6a6a6`、描边按钮 `#dadad9`、虚线框 `#e5e5e4`、删除红 `#ee5b5e`、主按钮 `#1a1a19`。页脚**无分隔线**。
- **入口统一**：枢纽里点击 MCP 卡片（整卡/标题）不再跳详情，而是打开同一张「待配置」表单弹窗；详情经弹窗右上角「详情」入口进入。浏览连接器弹窗里的「新建自定义 MCP」虚线卡与创建菜单的「自定义 MCP」都打开同一张创建表单。
- 与参考图保留的差异（其余一律以实测值为准）：① 无「复制 UUID」chip（本平台在弹窗标题外展示短名）；② 页脚按钮文案为「保存草稿 ｜⌄」（保存≠启用）与「放弃修改并刷新」（未保存编辑的恢复入口），参考图的「管理 ⌄」「试用一下」不对应本平台动作；③ 保留参考图没有的「超时（毫秒）」与「该端点明确允许无鉴权」（真实字段与法定声明）；④ 接入配置弹窗的动作行以 `position: sticky` 固定在可视区底部，因此保留 1px 上边框；⑤ 深色模式下主按钮回落品牌主色（近黑在深底对比度不足）。
- **短名不再由用户填写**：由服务器名称自动生成（`autoConnectorId`），生成不合法或已被占用时自动换名重试，不打断流程；名称本身仍可改。
- **「发布并保存」不绕过闸门**：先建草稿，再 `PATCH /api/admin/connectors/:id {enabled:true}`；服务端要求 `status=verified` 且已有范围授权，否则返回真实原因（`connector_verification_required` / `connector_tool_scope_required`），界面以**警示收据**如实呈现「草稿已保存、未发布」，不谎报成功。
- 状态模型沿用既有治理状态（未配置 / 待验证 / 验证失败 / 已验证待启用 / 已启用 / 已停用）。

### 详情 `/admin/connectors/:id`

六卡纵排：Hero（复制 ID、测试连接、0–1 实底 CTA）· 接入配置 · 接口 · 可用范围 · 凭据引用 · 审计。

- **接入配置**（详情卡片与「接入配置」弹窗共用同一组件，版式与创建弹窗一致）：服务器名称（=label，可改）/ 传输类型（HTTP / SSE）/ 图标（56px 虚线占位 + 「上传 ⌄」分裂按钮）/ 备注（=purpose，可选，5 行）/ 服务器 URL（可回退环境变量）/ 自定义 headers（名称 / 值 / 删除，「+ 添加自定义 header」）/ 超时 / 无鉴权声明 → 底部「放弃修改并刷新」+「保存草稿 ｜⌄」（菜单含「发布并保存」）。保存后 `enabled=0`、`status=pending_verification`；在弹窗内该动作行以 `position: sticky` 固定在可视区底部，等价于页脚。
- **接口**：`GET …/discovery` 清单 = 名称 / 描述 / L1·L2·L3 风险 / 审批状态 / schema 指纹 / 范围摘要；未审阅 = 「未审阅 · 默认拒绝」；展开 = inputSchema + 审批（风险/访问级别/启用）+ 工具级范围；[重新发现]。
- **可用范围**（连接器级，新增）：模式 = 未设置（逐人授权为准）/ 所有员工 / 指定范围；指定范围 = 一级部门 → 二级部门 → 岗位/个人 树 + 勾选 + 每绑定 read/write + 覆盖人数预览 + 未匹配提示。
- **凭据引用**：保险库（复用 `ConnectorCredentialVault`）+ 本连接器引用清单（只显示引用 ID 与标签）。
- **审计**：探针记录 + `runtime.*` 治理事件（脱敏）。

## 后端契约

| 能力 | 契约 |
|---|---|
| 图标 | `POST /api/admin/connectors/:id/icon`（multipart `icon`，魔术字节 PNG/JPEG，≤1MiB；写 `connectors.icon_ref`）；`GET /api/admin/connectors/:id/icon` |
| 目录 DTO | `connectorPublic` 增 `kind`（app / custom_mcp / custom_api）/ `protocol` / `icon_url` / `approved_tool_count`（启用策略数） |
| 组织单位 | `GET /api/admin/organization-units` → `{ company, units[], people[] }`（level 由父子链计算：center=1、department/project_group=2、team=3） |
| JSON 导入 | `POST /api/admin/connectors/import-mcp`：`{ json, dry_run }`；解析 `mcpServers`（`type` 映射 transport）；dry_run 预览不落库；确认后建连接器（`pending_verification`、`enabled=0`）+ 写审计；字面量秘密值自动写入保险库并以引用保存；`cred_…` 视为直接引用 |
| 传输 | `ConnectorConfig.transport?: "streamable-http" \| "sse"`（仅 MCP；缺省 streamable-http）；SSE 请求同样经过出口防护 fetch |
| 连接器级范围 | 新表 `runtime_connector_scope_policies(connector_id, mode ∈ {all, selected}, updated_by, updated_at)` 与 `runtime_connector_scope_bindings(connector_id, node_id, access ∈ {read, write}, created_by, created_at)`；`GET/PUT /api/admin/runtime/connectors/:id/connector-scope`；审计 `runtime.connector_scope.updated` |
| 范围解析 | 有效访问 = max(逐人 `user_connector_grants`, 连接器级范围命中)；工具级范围仍是**附加限制**（不得放大）；`permitScopeResolution` 语义不变；fail-closed |
| 启用闸门 | 「范围已设置」= 存在工具级范围 **或** 连接器级范围即可（`connectorHasAnyScope`）；仍要求 `status=verified` |
| 秘密 | 配置端点仍只接受 env 名 / `cred_…` 引用（法律不变）；明文值由前端先写保险库再引用，浏览器不落明文状态 |

## 前端结构（新增 `frontend/src/admin/connector/`）

- `ConnectorHub.tsx`（两模式 + 搜索 + Tab + 创建菜单 +「查看工具」入口）、`ConnectorPanels.tsx`（三个创建面板 + 图标上传）、`ConnectorDetail.tsx`（六卡）、`ConnectorConfigCard.tsx`、`ConnectorToolsCard.tsx`（接口卡）、`ConnectorToolsDrawer.tsx`（全量工具 + 按部门/个人授权 + 批量授权）、`ConnectorScopeCard.tsx`、`ConnectorGrantsCard.tsx`、`ConnectorMark.tsx`、`entity.ts`、`connectorAdmin.css`。
- 复用：`.hub-chip/.btn/.field/.menu-popover` 等既有 token 与范式；模态用 `createPortal` + 焦点锁（`ConfirmDialog` 的 `useFocusLock` 模式），Esc 关闭，焦点归还触发元素。
- E2E 钩子（data 属性）：`data-connector-hub`、`data-connector-mode`、`data-connector-card`、`data-connector-tools-entry`、`data-connector-tools-drawer`、`data-connector-drawer-*`、`data-connector-batch-*`、`data-connector-create-menu`、`data-connector-panel`、`data-connector-tool`、`data-connector-scope-mode`、`data-connector-scope-binding`。
- 无障碍：Tab 用 `role=tablist/tab`；✓/✗ 状态带文本；焦点可见；触摸命中区 ≥44px；状态不只靠颜色。

## 合规差异（相对附件，必须显式呈现）

1. 无「项目」Tab（本平台无 project-scope 对象）。
2. 「发布并保存」只是「保存草稿 + 立即请求启用」的合并入口，不跳过 保存→测试→工具审批→范围→启用 的闸门；被闸门拒绝时如实报告，不谎报成功。
3. 「试用一下」→「测试连接」（只列工具目录，不执行业务动作）。
4. 无「自定义 API」Tab（用户裁决不放开 HTTP 闸门；保持 MCP-only）。
5. 卡片必须携带治理状态与下一步（枢纽职责，`org-permissions.md`）。
6. 视觉结构复刻，颜色/圆角/字号/间距使用 `docs/DESIGN.md` token。
7. 参考图的 Header 值是明文输入框——视觉一致；但值只在前端短暂持有，提交时写入凭据保险库并仅存 `cred_…` 引用，保存后不回显。
8. 参考图无「该端点明确允许无鉴权」勾选；本平台必须显式声明无鉴权，故该勾选项保留。

## 实施顺序与证据

1. 规格与 ADR（本文件 + `docs/DECISIONS.md`）。
2. 后端：图标、组织单位、SSE、连接器级范围、JSON 导入、DTO 扩展。
3. 前端：枢纽/详情/创建面板/范围卡/图标上传/秘密入保险库 + 样式与无障碍。
4. 测试：后端新用例；前端 E2E 修复 `workbench.spec.ts` 过时断言并新增 `connector-admin.spec.ts`。
5. 验证：`backend npm run typecheck / test / validate:contracts`；`frontend npm run typecheck / build / test:e2e`；截图对照附件。

## 验证红线

- 新建/导入/保存 ≠ 启用；秘密不回显；L3 不经由本界面放行；同一视口 0–1 实底主 CTA；不新增员工端治理目录；不得以 stub/测试通过冒充生产能力（CONST-10）。

---

## 增补 A（2026-09-26）：卡片「查看工具」入口、全量工具视图与按部门/个人授权

**需求：** MCP 卡片上要有「查看工具」入口；进入后要把该 MCP 服务的**全部工具**展示出来；并可**按部门或个人**授予权限。

### A1. 入口（枢纽卡片）

- 入口位置（2026-09-27 对版）：卡片小字状态行里的 **「查看工具」文字入口**（`data-connector-tools-entry`）；卡片正面保持「图标 + 名称 + 用途 + ✓」的参考版式，不再有 chip / 按钮堆叠。
- 不显示工具数（枢纽不做逐卡发现，避免伪造/多余网络调用）；真实数量在抽屉头部给出。
- 点击 → 打开**右侧抽屉**「工具」（不离开枢纽）；详情页「接口」卡与抽屉**共用同一组件**，不产生两套工具清单。

### A2. 工具视图（全量清单，`ConnectorToolsDrawer`）

- 头部：`<MCP 名称> · 工具`；副行 `共 N 个工具（已审阅 X · 未审阅 Y）`；动作 [重新发现]；搜索框。
- **全部工具必须可见**：未审阅（默认拒绝）、已审阅未启用、以及历史审批中已不存在的（orphan）都分别标注，不许隐藏（CONST-10）。
- 行结构：名称 · L1/L2/L3 风险 chip · 审阅状态 · 描述（截断）· 展开 = inputSchema、schema 指纹、审批控件（沿用现状）、**授权控件**（见 A3）。
- 未配置/未连通：诚实错误态 + 「去配置」链接，不显示假清单。
- 提示语：**「授权不等于审阅：未审阅工具仍不可调用。」**

### A3. 按部门 / 个人授权（沿用现行权限语义，无新增后端规则）（2026-09-27 废止：见 ADR「对外只暴露技能」）

最终判定（不变）：**连接器级命中 ∩（工具级未配置 ∪ 工具级命中）**，且工具已审阅启用；L3 仍走 Gateway。

| 层级 | 作用 | 授予对象 | 备注 |
|---|---|---|---|
| 连接器级（默认） | 谁可以使用这个 MCP（覆盖其全部已审阅工具） | 一级部门 / 二级部门 / 组 / 岗位 / 个人（read/write）；「所有员工」= read | 抽屉顶部「本 MCP 的可用范围」入口，复用现有连接器级范围编辑器与覆盖人数预览 |
| 工具级（收窄） | 指定哪些部门/个人可以调用**这一个**工具 | 一级部门 / 二级部门 / 组 / 岗位 / 个人 | 模式与现有工具级范围四态一致（未设时可选「沿用连接器授权」，设置过之后为 无人 / 所有员工 / 指定对象）；**只收窄，不放宽** |

- 行内交互：工具行「授权」→ 就地展开组织树（一级部门→二级部门→组/岗位/个人）+ 已选对象 + [保存授权]。
- **批量授权**：多选工具 → 底部操作条「授权给…」→ 选择部门/个人 + 范围 → 逐工具写入（每个工具一条 `runtime.tool_scope.updated` 审计，不合并副作用）。
- 所有授权动作沿用现有审计事件；抽屉本身只读不写。

### A4. 数据与接口（全部复用，无后端改动）

`GET …/discovery`（全量工具 + schema 指纹）、`GET/PUT …/connector-scope`（连接器级）、`POST …/organization-scope/nodes`（组织树）、`GET/PUT …/tools/:toolName/scope`（工具级）。可选增强（非本期）：工具级覆盖人数统计。

### A5. 验收（2026-09-27 废止：见 ADR「对外只暴露技能」）

1. 枢纽卡片点「查看工具」→ 抽屉打开并列出**全部**工具（含未审阅），头部计数正确。
2. 行内/批量授权给部门或个人 → 保存后该工具的范围摘要更新，审计落账。
3. 抽屉顶部「本 MCP 的可用范围」保存后覆盖人数与详情页一致。
4. 未审阅工具在授权后仍显示「未审阅 · 默认拒绝」。
5. 无障碍：抽屉焦点锁/Esc/焦点归还；键盘可完成选择与保存；状态不只靠颜色。

---

## 增补 B（2026-09-27）：浏览连接器弹窗按参考图复刻（1:1 视觉）

**需求：** 管理端 `/admin/connectors` 点「浏览连接器」的目录弹窗，按用户上传的参考图
（1034×888）做 1:1 视觉复刻（用户原话：「视觉效果必须 1：1 复刻」）。

### B1. CONST-08 审宪记录

| 项 | 结论与证据 |
|---|---|
| 需求 | 目录弹窗按参考图复刻：弹窗骨架、搜索框、页签行（含「创建 ⌄」右置）、两列卡片、✓/＋ 指示 |
| 主责角色 | UI/UX 专家（视觉）· 前端专家（实现）· 平台产品经理（验收） |
| 宪法条款 | CONST-04（前端不重写权限，未动）· CONST-08 · CONST-10（目录内容保持真实，不伪造能力）· CONST-09（未改法条迁就代码） |
| 基本法条款 | `docs/DESIGN.md`（token 唯一来源，数值先入表）· `docs/ia-information-architecture.md`（浏览=目录视图，使用≠治理）· `docs/org-permissions.md`（治理入口留在枢纽卡片）· `docs/07-mcp-data-contract.md`（无 L1/L2/L3 与异步契约变化：＋ 仍为目录登记，不等于启用） |
| 结论与证据 | **符合**。纯视觉层与文案顺序调整；不改发送 / 阶段 / 审批 / 解密任何闸门；新增测量值全部登记入 `docs/DESIGN.md` §连接器控制台「浏览弹窗」。 |
| 下一步 | 按 §B3 实施，附几何锁定 E2E 与截图对照证据。 |

### B2. 测量记录（图像 1034×888，推导 × 0.7）

与「MCP 配置」参考图同源同比例（搜索框高 48 图像 px 与表单控件高 48 一致）。实测 → 落地：

- 弹窗：内容宽 1002 → 702（宽 736 = 702 + 2×17）；左右内边距 24 → 17；头部按 X 按钮中心回推 10。
- 标题：墨高 22 → 16px/600；关闭 X 墨高 15 → 11px、色 #737373；标题墨底→搜索顶 34 → 20。
- 搜索框：高 48 → 34、圆角 8 → 6、填充 #f0f0ef（取样）、无描边；放大镜 19 → 13、左内边距 14 → 10、图标→文字 19 → 13、占位 13px #a6a6a6。
- 页签：高 42 → 30、圆角 8 → 6、字号 18 → 13、内边距 18 → 12、间距 2；选中底 #e9e9e8（取样）+ 字 #1a1a1a；未选中 #737373。
- 「创建 ⌄」：85×42 → 60×30、描边 #dadad9（取样）、字 #1a1a1a；位置=页签行右端（原在标题栏）。
- 卡片：492×101 → 圆角 8 / 最小高 71；内边距 24/17 → 16/12；列距与行距 17 → 12；描边 #e9e9e8、无底色（与弹窗底同色 #f8f8f7）。
- 图标砖：白砖资产 52-53 → 37px、圆角 10 → 7、白底无描边（彩色资产 24-32 属资产自带留白，统一归一到砖位）。
- 卡标题：拉丁 cap 15 → 14px/600 #1a1a1a；描述：墨高 14.5 → 11px/#737373、行距 21 → 15；图标→文字 19 → 13。
- 右侧：动作槽 37 → 26；✓ 墨高 16×12 → 12px #737373；＋ 37×38 → 26×26、圆角 7、描边 #e9e9e8、加号 #1a1a1a。

### B3. 实现（无后端改动）

- `ConnectorHub.tsx`：`ConnectorBrowseModal` 标题栏只留标题 + X；页签行改为工具栏
  （`data-connector-browse-toolbar`），页签顺序 **应用 / 自定义 API / 自定义 MCP**，右端「创建 ⌄」
  （`data-connector-browse-create`，菜单与动作不变）；卡片传 `plain`（不渲染治理状态行）。
  `connector-plus` 由字符「+」改为描边 SVG（规格可锁定）；`ConnectorCard` 以 `plain` 取代
  原 `showToolsEntry/showStatusEntry`；`CatalogCard` 去掉「内置」tag 与「尚未加入组织目录」行。
- `connectorAdmin.css`：新增 `.connector-panel-layer[data-connector-panel="browse"]` 与
  `.connector-browse` 作用域样式（数值全部来自 `docs/DESIGN.md`）；删除仅 `CatalogCard` 使用的
  `.connector-kind-tag`。
- `styles.css`：新增 `--dialog-w-browse` / `--browse-line` / `--browse-fill` / `--browse-tile` /
  `--font-browse-title` / `--font-browse-desc` / `--lh-browse-desc`（浅色取样 + 深色回落）。
- E2E：`connector-admin.spec.ts` 补页签顺序、「创建」位次断言与几何锁定用例。

### B4. 与参考图的保留差异（延续既有裁决，不属遗漏）

1. 无「项目」页签（本平台无 project-scope 连接器对象；见 §信息架构「合规差异」1）。
2. 目录内容为真实连接器（MediaCrawler MCP / Starry KOL MCP / 自建 MCP·HTTP 草稿），不搬运
   参考图的第三方应用图标（Gmail / GitHub / Instagram 等）；「＋」加入目录走真实
   `POST /api/admin/connectors`，不以占位数据冒充生产能力（CONST-10）。
3. 枢纽卡片保留治理状态行与「查看工具」入口；仅目录弹窗的卡片按参考图收敛为
   图标 + 名称 + 用途 + ✓/＋（治理入口在枢纽与详情，`org-permissions.md`）。
4. 深色模式无参考图，按既有深色档登记回落值（§B2 浅色值严格取样）。

### B5. 验收

1. 几何锁定用例：弹窗宽 736、搜索 34/圆角 6/填充 `rgb(240,240,239)`、页签 30/选中底
   `rgb(233,233,232)`、创建 30/描边 `rgb(218,218,217)`、卡片 71/圆角 8/描边 `rgb(233,233,232)`/
   内边距 `17px 12px`、图标砖 37、＋ 26、标题 14px、描述 11px/15px。
2. 页签顺序与「创建」位次：`[data-connector-tab]` 文案为 应用 / 自定义 API / 自定义 MCP；
   「创建」位于 `[data-connector-browse-toolbar]` 且标题栏无「创建」。
3. 截图对照：以 1.4× DPR 截取弹窗（≈1030px 宽，与参考图 1034 同尺度）并存档为证据。
4. 行为不回退：焦点锁 / Esc / 焦点归还、「＋」加入目录、搜索过滤、卡片点击进详情。

---

## 增补 C（2026-09-27）：「添加自定义 API」创建弹窗按参考图 1:1 复刻

**需求：** `/admin/connectors → 创建 ⌄ → 自定义 HTTP API` 的创建弹窗，按用户上传的参考图
（「添加自定义 API」，780×1011）做 1:1 复刻（用户原话：「修改弹窗如上传图片所示，必须 1：1 复刻」）。

### C1. CONST-08 审宪记录

| 项 | 结论与证据 |
|---|---|
| 需求 | 弹窗按参考图：标题「添加自定义 API」+ 副标题；字段 = 名称 / 图标 / 备注（可选）/ 密钥（环境变量）+「+ 添加密钥」；页脚 取消 / 保存（空名禁用灰态） |
| 主责角色 | UI/UX 专家（版式与交互）· 平台产品经理（字段与流程裁决）· 前端/后端专家（实现）· 测试经理（证据） |
| 宪法条款 | CONST-04（前端不重写规则）· CONST-08 · CONST-09（数值先入 DESIGN.md）· CONST-10（不冒充生产能力） |
| 基本法条款 | `docs/DESIGN.md` §连接器控制台（唯一数值来源；改数值先改表）、§不变量 1/2/4；`docs/07-mcp-data-contract.md`（秘密只存引用、不回显；真实调用 fail-closed）；`docs/org-permissions.md`（凭据永不回显） |
| 结论与证据 | **符合**。弹窗只建待验证草稿；明文密钥只在提交瞬间存在并写入保险库；端点缺省时执行 / 测试连接 / 工具发现 fail-closed，界面如实呈现 |
| 下一步 | 按 §C3 实施，几何锁定 E2E + 截图对照取证；ADR 见 `docs/DECISIONS.md` ADR-2026-09-27 |

### C2. 测量记录（图像 780×1011，推导 × 0.7，与既有连接器弹窗同基准）

- 弹窗：沿用 `--dialog-w-form` 560 / `--radius-dialog` 14 / 内边距 20·20·26（与「MCP 配置」同族；宽度以既有 800 参考图为准）。
- 控件：高 34（`--control-h-form`）、圆角 6（`--radius-field-form`）、填充 `#ececeb`、无描边（既有取样）。
- 图标位：56（`--icon-box`）虚线框 + 「上传 ⌄」分裂按钮；空态字形改为图片图标（24px，`--hint-text`）。
- 备注：95（`--note-h-form`），占位「提供 API 文档或说明，以告知平台如何及何时使用此 API」。
- 密钥卡片（新 token）：内边距 22 → 16（`--secret-card-pad`）；值文本域高 106 → 74（`--secret-value-h`）；
  卡内字段距 18 → 13（`--secret-row-gap`）；卡片之间与到「＋ 添加密钥」21 → 15；卡片 = 1px `--border-quiet`
  描边 + 弹窗同底 + `--radius-card`(7) 圆角；本弹窗作用域另把标题上 / 页脚底内边距收口到 14 / 16、字段标签
  行盒收口到 20px（实测 14/17 图像 px 与行盒；同时保证 900 高视口不出现滚动）。
- 「?」帮助图标（新 token）：实测 20 → 14（`--help-icon`），`--hint-text` 描边圆圈 + 10px 问号，title / aria-label 承担说明。
- 保存禁用态：`--fill-control` 底 + `--placeholder-text` 字（参考图空表单初始态）。

### C3. 实现

- `ConnectorPanels.tsx`：新增 `SecretKeysEditor` / `secretKeysProblem`；`ApiConfigPanel` 重写为 `ModalShell form` +
  参考图字段集（保留 `data-connector-field="label"`；移除 `id` / `url` / checkbox 钩子）；保存走 `createManagedHttpApi`
  （`POST` 带 `protocol: http` → 密钥入保险库 → 有密钥时保存仅含引用的配置 → 图标上传）；`autoConnectorId(label, prefix)`
  支持 `api-`；`validateHeaderName(name, label)` 文案按「请求头 / 密钥」复用；图标空态换图片字形 SVG。
- 后端：`db.ts` 迁移 `connectors.declared_protocol`；`enterprise.ts` POST 接受 `protocol`
  （非法值 400 `managed_connector_protocol_invalid`），`connectorRuntimeFacts` 回退链 = 运行时配置 → 声明协议 → mcp；
  `runtime/store.ts` `validateConnectorConfig` 允许 http 草稿两者都缺省（同时提供仍拒绝；mcp 不变）。
- `ConnectorConfigCard.tsx`：无配置（404）草稿按 `card.protocol` 初始化字段集；`ConnectorDetail.tsx` /
  `ConnectorToolsCard.tsx` 给 `runtime_endpoint_invalid` 友好文案（「尚未填写 Base URL，或端点无效」）。
- `ConnectorHub.tsx`：创建菜单与浏览弹窗「新建自定义 HTTP API」文案改为「填写名称与密钥；Base URL 与动作在详情配置」。
- `styles.css`：新增 `--secret-card-pad` / `--secret-value-h` / `--help-icon`（深色沿用既有档回落）。
- E2E：HTTP 流程重写（名称 + 密钥 → 草稿 → 详情补 URL / 动作 → 保存），新增版式锁定用例（标题 / 副标题 /
  字段集与占位 / 添加密钥与移除 / 页脚与禁用灰态 / 几何 560·13·14·16·64）。

### C4. 与参考图的保留差异（显式登记）

1. 参考图文案中的 Manus 写作「平台」；其余文案照录（含英文占位 `SOME_UNIQUE_KEY_NAME`、
   `Value of the secret, such as sk-example-1234`）。
2. 参考图只有一张密钥卡；多于一张时每卡右上角常显「移除」（无障碍必需，不是参考图元素）。
3. 「保存」在名称为空时禁用（对齐参考图初始灰态）；错误（密钥名称非法、半填密钥）仍以面板内错误条如实呈现。
4. **API Base URL 与「该端点明确允许无鉴权」不在本弹窗**（参考图没有），由详情「接入配置」采集；
   创建只建草稿，端点缺失时执行 / 测试 / 发现 fail-closed。

### C5. 验收

1. 版式锁定用例通过（见 §C3 末条）。
2. HTTP 流程：保存后卡片 `data-connector-kind="custom_api"`；详情按 HTTP 字段集打开；密钥只以引用回显；
   补齐 URL + 动作后保存成功。
3. 后端：`connector-employee-dto` / `configurable-connectors` 新旧用例通过（http 缺端点可保存、执行 fail-closed、
   分类回退正确）。
4. 截图对照：以 1.4× DPR 截取弹窗（≈780px 宽，与参考图同尺度）并存档为证据。
