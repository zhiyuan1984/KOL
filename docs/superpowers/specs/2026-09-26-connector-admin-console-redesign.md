# 连接器管理端界面重做：设计与实施规格

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

- 模式 A「已添加的连接器」（默认）：搜索 + [浏览连接器] + [创建 ⌄] + 卡片网格（2 列，≥1100px）。
- 模式 B「浏览连接器」：搜索 + Tab（应用 / 自定义 MCP）+ [创建 ⌄] + 卡片（右侧 `+` 加入 / `✓` 已加入）。
- 卡片 = 图标砖 + 名称 + 用途（≤2 行）+ 状态 chip + 最近验证 + 主操作（进详情 / 继续配置）。
- 创建菜单三项：**自定义 MCP**、**通过 JSON 导入 MCP**、**通过 URL 添加 MCP**。
- 状态模型沿用既有治理状态（未配置 / 待验证 / 验证失败 / 已验证待启用 / 已启用 / 已停用）。

### 详情 `/admin/connectors/:id`

六卡纵排：Hero（复制 ID、测试连接、0–1 实底 CTA）· 接入配置 · 接口 · 可用范围 · 凭据引用 · 审计。

- **接入配置**：服务器名称（=label，可改）/ 短名（只读展示）/ 传输类型（HTTP / SSE）/ 图标上传（PNG·JPG ≤1MB）/ 备注（=purpose）/ 服务器 URL / 自定义 headers / 超时 → 保存草稿（保存后 `enabled=0`、`status=pending_verification`，既有行为不变）。
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
- E2E 钩子（data 属性）：`data-connector-hub`、`data-connector-mode`、`data-connector-card`、`data-connector-action`、`data-connector-create-menu`、`data-connector-panel`、`data-connector-tool`、`data-connector-scope-mode`、`data-connector-scope-binding`。
- 无障碍：Tab 用 `role=tablist/tab`；✓/✗ 状态带文本；焦点可见；触摸命中区 ≥44px；状态不只靠颜色。

## 合规差异（相对附件，必须显式呈现）

1. 无「项目」Tab（本平台无 project-scope 对象）。
2. 无「保存并发布」：发布=启用必须经 保存→测试→工具审批→范围→启用。
3. 「试用一下」→「测试连接」（只列工具目录，不执行业务动作）。
4. 无「自定义 API」Tab（用户裁决不放开 HTTP 闸门；保持 MCP-only）。
5. 卡片必须携带治理状态与下一步（枢纽职责，`org-permissions.md`）。
6. 视觉结构复刻，颜色/圆角/字号/间距使用 `docs/DESIGN.md` token。

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

- 卡片操作区自下而上：状态 chip → 主操作（描边按钮）→ **「查看工具」低强调文字按钮**（`data-connector-tools-entry`）。
- 不显示工具数（枢纽不做逐卡发现，避免伪造/多余网络调用）；真实数量在抽屉头部给出。
- 点击 → 打开**右侧抽屉**「工具」（不离开枢纽）；详情页「接口」卡与抽屉**共用同一组件**，不产生两套工具清单。

### A2. 工具视图（全量清单，`ConnectorToolsDrawer`）

- 头部：`<MCP 名称> · 工具`；副行 `共 N 个工具（已审阅 X · 未审阅 Y）`；动作 [重新发现]；搜索框。
- **全部工具必须可见**：未审阅（默认拒绝）、已审阅未启用、以及历史审批中已不存在的（orphan）都分别标注，不许隐藏（CONST-10）。
- 行结构：名称 · L1/L2/L3 风险 chip · 审阅状态 · 描述（截断）· 展开 = inputSchema、schema 指纹、审批控件（沿用现状）、**授权控件**（见 A3）。
- 未配置/未连通：诚实错误态 + 「去配置」链接，不显示假清单。
- 提示语：**「授权不等于审阅：未审阅工具仍不可调用。」**

### A3. 按部门 / 个人授权（沿用现行权限语义，无新增后端规则）

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

### A5. 验收

1. 枢纽卡片点「查看工具」→ 抽屉打开并列出**全部**工具（含未审阅），头部计数正确。
2. 行内/批量授权给部门或个人 → 保存后该工具的范围摘要更新，审计落账。
3. 抽屉顶部「本 MCP 的可用范围」保存后覆盖人数与详情页一致。
4. 未审阅工具在授权后仍显示「未审阅 · 默认拒绝」。
5. 无障碍：抽屉焦点锁/Esc/焦点归还；键盘可完成选择与保存；状态不只靠颜色。
