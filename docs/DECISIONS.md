# 决策历史

本文件只记录「为什么」，不替代现行宪法、基本法或实施细则。现行规则以 `docs/` 下对应正文为准。

## ADR-2026-09-23：Home 统一 Agent 工作台与公海一级模式

- **状态**：已接受
- **决定者**：用户（产品发起人）；平台产品经理、智能体产品经理与 UI/UX 专家职责范围内落地
- **背景**：今日任务、我的待办和 AI发现已经使用两栏工作台；公海和我的红人仍使用旧的全宽对象列表与页面级提问框，造成同一产品心智下存在两套几何与交互协议。
- **决定**：Home 采用五个一级模式——今日任务、我的待办、AI发现、公海、我的红人。五者共享「中栏人机协作、右栏结果与下一步」协议。公海仍是 KOL 试点能力，不进入平台内核。
- **动作边界**：「首次建联」不作为第六模式；它从公海、我的红人或对象详情启动，先形成 L2 草稿，再独立执行 L3 发送确认。发送不推进阶段。
- **理由**：模式回答稳定的工作问题；首次建联回答的是对某个对象执行什么动作。将二者并列会混淆导航、提问和受控动作入口。
- **影响**：修订 `ia-information-architecture.md`、`DESIGN.md`；扩展唯一 `WorkspaceShell`；迁移公海和我的红人；将模式导航移出 Composer；保留所有既有权限、审批、异步与回执闸门。
- **限制**：BIZ-07 尚未补齐的公海字段与重新分配口径仍是规则空白；界面只呈现后端已经授权返回的字段和动作，不自行补全。

## ADR-2026-09-23：邮箱通讯页四栏 + 技能/定时/记忆增量

- **状态**：已接受
- **决定者**：用户（产品发起人）；平台产品经理、智能体产品经理、KOL 业务专家与 UI/UX 专家职责范围内落地
- **背景**：邮箱通讯页原为邮件流水页，栏3 混入摘要，栏4 在读取路径触发模型，且总结/翻译无增量记忆与定时补算。
- **决定**：改为以人为中心的四栏往来档案页（栏1 全局导航 / 栏2 聚合树 / 栏3 纯正文 / 栏4 总结+中文译稿）。总结与翻译做成 `mail_summary`、`mail_translate` 两个技能，执行走无会话 Codex app-server 直连（形态一），结果写回本地记忆；页面只读记忆、零模型。收取新邮件后 fire-and-forget 触发增量作业，并登记 `mail_memory_increment` 定时任务兜底。人来往总结只取单一邮箱维度（当前选中邮箱，未选时取绑定第一个）。
- **理由**：形态一与 `cron/handlers.ts`「确定动作不得创建 thread/turn/session」硬约束相容，且是仓库既有做法（`mail-summary.ts`、`translate-zh.ts`）。页面零模型保证即时性与确定性；记忆增量避免重复模型开销。
- **影响**：修订 `docs/BUSINESS.md` 技能计数；新增 `docs/superpowers/specs/2026-09-23-mail-correspondent-workbench-design.md` 与 `docs/superpowers/plans/2026-09-23-mail-correspondent-workbench.md`；后端增记忆列、增量协调器、cron 作业；前端四栏改版。
- **限制**：`docs/ui-ux-rules.md` 与 `docs/DESIGN.md` 唯一数值来源冲突不在本次解决；邮箱通讯页 IA 一等能力登记仍是规则空白。

## ADR-2026-09-23：技能唤起三层入口、声明式参数契约与右栏记忆优先

- **状态**：已接受
- **决定者**：用户（产品发起人，委托专家方案）；智能体产品经理、平台产品经理与 UI/UX 专家职责范围内落地
- **背景**：技能唤起只有「锁定入口」与「from-text 判别」两条散路径；必要参数只是 `required_inputs` 字符串数组，澄清与条件卡各模式硬编码；右栏历史结果读取散在各 hook，记忆存储时机写死在代码里；工作台表面出现 hero 空态、28px/700 标题与硬编码字号，违反 data-dense-dashboard。
- **决定**：① 路由固定为三层入口——L0 记忆快捷（零 thread/turn/model）、L1 Host 锁定（显式 task_type，不再推断）、L2 判别器路由（登记目录内选 ≤1 技能，结构化澄清缺参，低置信出候选点选升级为锁定）；业务词语唤起靠登记 aliases + 判别器，禁止任何一端关键词硬编码。② 技能声明契约扩展进 SKILL.md frontmatter 单一事实源（input_schema / result_type / next_actions / memory_policy / supports），WorkspaceCapability 不另建第二注册表；技能管理面可编辑参数与接口。③ 右栏统一为记忆优先结果区：进入即读登记记忆范围，显示来源与新鲜度，版本可回看，空态诚实给双入口；记忆只在 run 终态且 Host 校验通过后按 memory_policy 写入，失败不覆盖，草稿不进记忆，建议不自动成事实。④ DESIGN.md 增补字号阶梯用途与内容密度规则并执法。
- **理由**：三层入口是 PROD-AGENT-01「入口决定路径、路由显式登记」的直接落地；澄清前置到 Host 层（结构化控件、不烧 Codex turn）与数字员工/Codex 运行时分工一致——Host 管路由、pack 装配、闸门与持久化，Codex 只在 box 内跑一份 SKILL.md 输出 schema 化 Item；参数声明住 manifest 避免注册表双真相源。
- **影响**：新增 `docs/superpowers/specs/2026-09-23-skill-routing-param-memory-design.md`；修订 `DESIGN.md`（字号用途与密度节）与 `BUSINESS.md`（alias 登记裁定）；registry/skill-publish/判别器/resolver 契约扩展；SkillParamCard/ResultRail/NextActionBar 通用渲染器；creator_discovery 试点迁移。
- **限制**：8 个未登记技能的快捷面/Agent 面口径、BIZ-07 公海字段仍是规则空白，待 KOL 业务专家裁定；「AI发现」alias 按用户明确要求登记。机制先行，不编其它业务口径。判别器不可用时保持诚实降级，不加本地关键词兜底。

## ADR-2026-09-26：账户块取代账户菜单（分段切换 + 个人设置 + 退出，去掉弹窗）

- **状态**：已接受
- **决定者**：用户（产品发起人）；UI/UX 专家负责组件呈现与无障碍，平台产品经理负责员工端/管理端通用入口。
- **背景**：员工端与管理端账户区是一个按钮加弹窗菜单（员工工作台 / 管理控制台 / 调试视图 / 个人设置 / 退出登录）。切工作面、进设置、退出都要先开弹窗；当前工作面不可见，窄栏还要另算弹窗定位。
- **决定**：账户区改为常驻「账户块」——身份行（头像首字 + 姓名 + 角色）加控制行：员工端⇄管理端分段切换（`Link` + `aria-current="page"` 表达当前工作面）、个人设置、退出登录；无 admin 模式时不渲染分段。调试视图（`data-debug-toggle`）迁到「个人设置 → 偏好 → 管理员工具」，状态源仍是 `localStorage: ui:debug-view`。管理端页头「← 返回员工工作台」保留。
- **理由**：三件事都是后果明确的常用动作，常驻控件比弹窗少一次点击，且状态可见（形状 + 辅助色 + `aria-current` 三重信号）；调试视图是个人偏好而非高频动作，住 Settings 与「一页一问」一致，也让账户块与用户给定稿的三控件形态一致。
- **影响**：新增 `docs/superpowers/specs/2026-09-26-account-bar-design.md`；`UserMenu.tsx` 由 `AccountBar.tsx` 取代；修订 `docs/ia-information-architecture.md`（导航密度入口形态）；`frontend/src/styles.css` 增账户块、折叠轨道、管理顶栏、抽屉高度与触摸命中区规则；`frontend/e2e/workbench.spec.ts` 改用 `[data-account-*]` / `[data-surface-switch]` 选择器与 `enableDebugView` 帮手。含管理端措辞的 `DESIGN.md` 版本需同步把「账户菜单」改为「账户块」（本分支 DESIGN.md 尚无该节，留待合入时同步）。
- **审宪记录**：需求「用户页面和管理页面用新的账户区：第一个图标切换用户端/管理端，第二个个人设置，第三个退出；图标要更好；弹窗不再需要」→ 主责 UI/UX 专家、平台产品经理 → CONST-04（通用界面与组件呈现职责）、CONST-07（界面由产品与 UI/UX 规范约束）、CONST-08、CONST-10 → 细则：`ia-information-architecture.md` §3「使用 ≠ 治理」、§4 导航密度；`DESIGN.md` §控件尺寸 / §颜色（选中态走 `--accent*`）/ §不变量 1、4、5 / §验收矩阵；`TECHNOLOGY.md` TECH-FE（前端不重写权限、审批与阶段判定）→ **符合**：管理端入口仍只在账户块，admin 判据仍是 `available_modes` / `roles`（`isAdminAccount`）；选中态用辅助色 + 形状 + `aria-current`，不占主 CTA（`--primary` 未使用）；退出登录是会话动作，不新增 L3 确认闸门，也不与发送、删除、解密合并；页脚控件在矮视口与移动抽屉里都给内容让路 → 下一步按 DESIGN 验收矩阵截图核对员工端/管理端、展开/折叠、桌面/触摸，并跑 E2E。
- **限制**：管理员调试视图不再就地开关，需进个人设置（用一次跳转换三控件账户块，是否保留第四图标可由用户再裁决）；管理端页头返回入口与分段切换的重复关系留给下一轮 IA 复核。
- **修订（2026-09-26，同日）**：按用户要求改为**单行**（头像 + 账号名 + 员工端⇄管理端分段 + 个人设置 + 退出登录）并**去掉角色文案**（管理员 / 员工）。控件高度统一降到 `--control-h`（28px）、分段段宽 30px、图标按钮 28px，去掉分段与图标之间的分隔线；账号名弹性收缩 + 省略号。理由与代价：一行放下身份与三个动作，密度更高；角色信息不再就地呈现（管理端入口由分段本身表达，考试阻断仍有 `/exam` 闸门与侧栏「考试 · 待完成」徽标）。折叠 56px 轨道与 ≤720px 顶栏仍各自适配。

## ADR-2026-09-26：连接器管理端界面重做（复刻 + MCP 接口清单 + 连接器级组织范围 + SSE）

- **状态**：已接受（用户 2026-09-26 逐项批复）
- **决定者**：用户（产品发起人）；平台产品经理、UI/UX 专家、架构师、前端/后端专家在各自职责范围内落地
- **背景**：管理端连接器枢纽仍是「内联表单 + 行列表」，与用户提供的参考界面（卡片网格、分类 Tab、创建菜单、配置面板）不符；MCP 工具清单只有逐工具审批形态，没有「查看接口」只读面；组织范围只有逐工具绑定，没有连接器级；运行时只支持 StreamableHTTP；自定义 API（HTTP/OpenAPI）的后端内核存在但生产闸门关闭。
- **决定**：
  1. 按参考界面重做枢纽（「已添加的连接器」/「浏览连接器」两模式 + 搜索 + Tab + 创建菜单）与详情（Hero/接入配置/接口/可用范围/凭据引用/审计六卡）；创建菜单收敛为 自定义 MCP / 通过 JSON 导入 MCP / 通过 URL 添加 MCP。
  2. 新增「接口」只读清单（含 L1/L2/L3、schema 指纹、未审阅默认拒绝），保留逐工具审批与工具级范围。
  3. 新增**连接器级**组织范围（一级部门/二级部门/岗位/个人，read/write 绑定），与逐人授权取并集、作为工具级范围的补充而非放大；部门候选接入 `config/org-registry.yaml` canonical id（手输兜底）；启用闸门接受工具级或连接器级范围。
  4. 运行时新增 **SSE 传输**（`transport: streamable-http | sse`）。
  5. 表单接受**明文秘密值，保存时写入凭据保险库并只存引用**（不采纳「仅引用/仅环境变量」的输入方式；配置与回显仍永不落明文）。
  6. **不放开**自定义 API（HTTP/OpenAPI）生产闸门，本期不做该页签与流程。
- **理由**：枢纽与详情回答的仍是治理问题（挂了哪些、状态、下一步）；卡片网格与 Tab 提升扫描效率且不改变治理语义。连接器级范围把「哪些部门/人能用」从逐工具重复配置中解耦；SSE 是用户实际服务形态；明文值入保险库在保留附件式输入体验的同时不破坏「配置只存引用」的既有法律。
- **影响**：新增 `docs/superpowers/specs/2026-09-26-connector-admin-console-redesign.md`；`connectors.icon_ref`、`runtime_connector_scope_policies/_bindings`、`transport` 配置字段、图标/组织单位/JSON 导入/连接器级范围端点；`frontend/src/admin/connector/*` 新组件；E2E 过时断言迁移。
- **审宪记录**：需求「按附件重做连接器界面；结合现在 api 连接；查看 MCP 服务接口；绑定一级/二级部门、人员」→ 主责 平台产品经理 + UI/UX 专家 → CONST-02/04/05/08/10 → 细则 `07-mcp-data-contract.md`（L1/L2/L3、秘密不落文）、`org-permissions.md`（枢纽/详情职责、凭据永不回显）、`DESIGN.md`（0–1 CTA、状态不靠颜色、token 唯一来源）、`ia-information-architecture.md`（一页一问）→ **符合**：不触碰 L3 Gateway 与发送/阶段/解密闸门；HTTP 闸门按用户裁决保持关闭 → 下一步按规格实施并附类型检查、测试与 E2E 证据。
- **限制**：连接器级范围只做「增加可达范围」，不做封禁（封禁走停用）；部门成员仍按既有节点/岗位匹配解析，本地账号无部门字段的既有语义不变；「项目」Tab 无对象，不做。
- **修订（2026-09-27）**：本条第 2、3 项中的逐工具授权、连接器级组织范围、按人 read/write 与 `connectorHasAnyScope` 启用闸门，由 ADR-2026-09-27「对外只暴露技能」取代并废止；界面重做、SSE、凭据保险库、JSON 导入、图标与只读工具清单仍有效。

## ADR-2026-09-26：管理端左侧菜单复刻员工端外壳（单壳共用）

- **状态**：已接受
- **决定者**：用户（产品发起人）；UI/UX 专家负责导航外壳与三轴适配，平台产品经理负责管理端 IA 不降级。
- **背景**：管理端 `/admin/*` 自持一列 `.admin-nav`——只有品牌文字、一条「管理」kicker 与九个纯文字条目，没有条目图标、没有分簇分隔线、没有 Lucas、没有折叠 56px 轨道，≤860px 还把导航压成横向顶条；员工端侧栏（`Workbench` 的 `.sidebar`）则是「品牌 + Lucas + 折叠按钮 → 分簇图标条目 → 版本号 + 账户块」。用户要求：除菜单文字内容外，管理页左侧菜单必须与员工端完全复刻。
- **决定**：不再给管理端第二列导航。`/admin/*` 且账号含 admin 模式时，**同一个侧栏实例**改渲染管理端条目集合（`frontend/src/layout/adminNav.ts` 的 9 条：员工 / 数据 / 数字员工治理 / 技能 / 知识 / 审批 / 考试 / 连接器枢纽 / 配置），员工条目集合不渲染；`AdminConsole` 交出 `.admin-nav` 列与品牌块，只留 `.admin-shell > .admin-body`（页头 / 健康条 / 面板）。`styles.css` 删除 `.admin-nav*`（含 `--admin-nav-width`、≤860px 横向顶条、暗色与 ≤720px 覆盖），移除 `.workbench.admin-surface` 的隐藏与单列覆盖，并去掉侧栏轨道 / 折叠规则里的 `:not(.admin-surface)` 守卫。管理端分簇按员工端节奏落位（治理日常 2 / 数字员工 1 / 技能 1 / 资产 4 / 平台配置 1），资产簇顺序与员工端一致（知识 → 审批 → 考试 → 连接器）。
- **理由**：① 「完全复刻」只能由同一实例保证——几何、折叠状态、抽屉触发、页脚与焦点态不会再漂移；② 净减 CSS（约 150 行管理端导航专属规则），少一处「两套外壳各自演化」的重复；③ 复刻只动外壳：条目标签、href、面板与权限闸门、页头治理文案全部不变，员工开工条目在管理面不渲染，符合 `ia-information-architecture.md` §3「配套 ≠ 副本」与 §4「管理端顶栏不得跳员工开工入口」。
- **影响**：新增 `docs/superpowers/specs/2026-09-26-admin-sidebar-shell-parity.md`；`frontend/src/layout/adminNav.ts`（新）、`Workbench.tsx`、`pages/AdminConsole.tsx`、`styles.css`；过时断言同步 `frontend/src/layout/sidebarNav.test.ts`、`frontend/e2e/workbench.spec.ts`（`.admin-nav` 选择器 → `.sidebar`，标签顺序改为新分簇顺序），证据脚本 `artifacts/account-footer/capture.cjs` 改抓 `.sidebar` 并新增折叠 / 抽屉截图；`docs/org-permissions.md` §导航规则两行补「同一侧栏外壳」说明。
- **审宪记录**：需求「除了菜单文字内容外，管理页的左侧菜单必须和用户端的左侧菜单完全复刻」→ 主责 UI/UX 专家、平台产品经理 → CONST-04（前端不重写权限判定）、CONST-07（两类界面各受产品与 UI/UX 规范约束）、CONST-08、CONST-10 → 细则：`ia-information-architecture.md` §3 / §4；`org-permissions.md` §管理端配套套件（两侧共用 MASTER token，不得做成第二套 Home / Agents）；`DESIGN.md` §三轴适配（260px 轨道）、§不变量 1 / 4 / 5、§验收矩阵；`TECHNOLOGY.md` TECH-FE → **符合**：管理端只回答谁 / 权限 / 审计，页头与九个面板未动，治理条目仍只走 `/admin/*`；admin 判据仍是 `available_modes`；复刻不含任何发送 / 阶段 / 解密 / 删除闸门 → 下一步按规格 §2 清单逐项截图核对，并跑 typecheck / build / vitest / E2E。
- **限制**：折叠偏好两面共用（同一 `ui:left-collapsed` 与 `left_sidebar_collapsed`）；若要两面独立记忆需另立一项。管理端配置面 `/admin/kol` 仍是遗留页，其内部 IA 不在本次范围。
- **修订（2026-09-27）**：条目顺序与两条文字（连接器枢纽 → 连接、数字员工治理 → 治理）改由 ADR-2026-09-27「管理端左侧菜单条目顺序与展示文字调整」取代；本条的「同一侧栏外壳、只有菜单文字不同」与「分簇 5 簇」仍有效。

## ADR-2026-09-27：「添加自定义 API」创建弹窗 1:1 复刻（端点后置到详情）

- **状态**：已接受（用户 2026-09-27 附参考图，要求必须 1:1 复刻）
- **决定者**：用户（产品发起人）；UI/UX 专家负责版式与交互，平台产品经理与前端/后端专家负责字段与契约落地。
- **背景**：`连接器 → 创建 ⌄ → 自定义 HTTP API` 的创建弹窗与用户附件（「添加自定义 API」）不符：多出「短名 / API Base URL / 自定义 headers / 无鉴权勾选」，缺少图标上传与「密钥（环境变量）」卡片区。参考图只收：名称 / 图标 / 备注（可选）/ 密钥（环境变量），页脚「取消 / 保存」。
- **决定**：
  1. 弹窗按参考图 1:1 重构（`docs/DESIGN.md` §连接器控制台「添加自定义 API 创建弹窗」）：字段集只保留 名称 / 图标 / 备注（可选）/ 密钥（环境变量）+「+ 添加密钥」；短名由名称自动生成（`api-` 前缀）；副标题按参考图文案（Manus → 平台）；名称未填时保存为禁用灰态；多于一张密钥卡时每卡常显「移除」。
  2. 「密钥」即现有的请求头引用（`headers_secret_refs`）：名称是请求头名，值写入凭据保险库，保存后不回显。
  3. **API Base URL 与「该端点明确允许无鉴权」移出创建弹窗**，由详情「接入配置」采集 —— 创建只建「身份 + 密钥引用」草稿。为此 `POST /api/admin/connectors` 新增可选 `protocol`（写入 `connectors.declared_protocol`；分类回退链 = 运行时配置 → 声明协议 → mcp），`validateConnectorConfig` 允许 http 草稿两者都缺省（同时提供仍拒绝；mcp 不变）。
  4. 未填端点时执行、测试连接与工具发现一律 fail-closed（`runtime_endpoint_invalid`），界面按诚实错误呈现，不得表述为可用。
- **理由**：① 用户要求 1:1，参考图的字段集就是产品口径；② 端点与动作属「接入配置」的真实字段，详情已有完整表单与 OpenAPI 导入，创建步骤不必重复采集；③ 先建草稿再补齐端点是既有治理叙事（保存 ≠ 启用；测试 → 审阅 → 范围 → 启用都不变）；④ 声明协议让无配置草稿保持「自定义 API」分类与 HTTP 字段集，不会在配置未建时被误判为 MCP。
- **影响**：`frontend/src/admin/connector/ConnectorPanels.tsx`（`SecretKeysEditor` + `ApiConfigPanel` 重构 + 图标空态 + `autoConnectorId(prefix)`）、`connectorAdmin.css`、`styles.css`（`--secret-card-pad` / `--secret-value-h` / `--help-icon`）、`ConnectorConfigCard.tsx`（无配置草稿按 `card.protocol` 初始化）、`e2e/connector-admin.spec.ts`（HTTP 流程重写 + 新增版式用例）；后端 `db.ts`（`declared_protocol` 迁移）、`routers/enterprise.ts`（POST `protocol` + 分类回退）、`runtime/store.ts`（http 草稿端点放行）；规格增补见 `docs/superpowers/specs/2026-09-26-connector-admin-console-redesign.md`。
- **审宪记录**：需求「连接器点击创建，点击自定义 HTTP API，修改弹窗如上传图片所示，必须 1:1 复刻」→ 主责 UI/UX 专家 + 平台产品经理 → CONST-04 / CONST-08 / CONST-09（数值只住 DESIGN.md 与 styles.css）/ CONST-10 → 细则：`DESIGN.md` §连接器控制台（唯一数值来源，改数值先改表）、§不变量 2（L2 草稿必须标注）；`07-mcp-data-contract.md`（秘密只存引用、不回显；真实调用 fail-closed）；`org-permissions.md`（凭据永不回显）→ **符合**：弹窗只建草稿，不触碰 L3；明文值只在提交瞬间存在；端点缺失不被表述为可用 → 下一步按 DESIGN 数值与 E2E 用例取证。
- **限制**：参考图文案中的 Manus 一律写作「平台」；多密钥的「移除」入口是参考图没有、无障碍需要的补充。端点后置意味着「创建即可测试」不再成立，测试前必须先补 Base URL。
- **修订（2026-09-27）**：同日 ADR「对外只暴露技能」取代其中「测试 → 审阅 → 范围 → 启用」里的『范围』——范围不再指员工授权；其余不变。

## ADR-2026-09-27：管理端左侧菜单条目顺序与展示文字调整

- **状态**：已接受（用户 2026-09-27 直接指定顺序与文字）
- **决定者**：用户（产品发起人）；UI/UX 专家负责导航文字与分簇，平台产品经理负责管理端 IA 不降级。
- **背景**：管理端侧栏九条目的顺序与文字沿用 2026-09-26 复刻时的口径（员工 / 数据 / 数字员工治理 / 技能 / 知识 / 审批 / 考试 / 连接器枢纽 / 配置）。用户要求改为 员工 / 连接 / 知识 / 审批 / 技能 / 考试 / 治理 / 数据 / 配置，并明确「连接」即原「连接器枢纽」、「治理」即原「数字员工治理」，只改顺序与展示文字。
- **决定**：`frontend/src/layout/adminNav.ts` 的 `ADMIN_NAV_GROUPS` 按新顺序重排并缩短两条文字；分簇边界随之移动（治理日常 1 / 资产 3 / 技能 1 / 数字员工 2 / 平台配置 2，仍为 5 簇，分隔线条数不变）。`技能` 保持独立一等入口（`ia-information-architecture.md` §4）；`考试` 与「治理」同簇（考试是 `/admin/agents` 的治理闸门）；`数据` 与「配置」同簇（平台级设置）。`data-admin-nav` / `data-admin-tab` id、href、图标、面板与权限闸门全部不变。
- **理由**：用户口径即产品口径；只动条目排列与可见文字，不改任何治理职责、取数路径或闸门，风险面 = 侧栏渲染与两处顺序断言。
- **影响**：`frontend/src/layout/adminNav.ts`、`frontend/src/layout/sidebarNav.test.ts`、`frontend/e2e/workbench.spec.ts`（`.sidebar [data-admin-nav]` 文字序列）、`docs/org-permissions.md`（§导航规则「管理端信息架构」行的侧栏顺序）、`docs/superpowers/specs/2026-09-26-admin-sidebar-shell-parity.md`（§3 菜单映射表）。
- **审宪记录**：需求「管理页面右侧导航调整为：员工 / 连接 / 知识 / 审批 / 技能 / 考试 / 治理 / 数据 / 配置；仅改变导航菜单项的顺序和展示文字」→ 主责 UI/UX 专家 + 平台产品经理 → CONST-04（前端不重写权限判定）、CONST-08、CONST-09（细则写死了旧顺序，须同步而非偷改）、CONST-10 → 细则：`ia-information-architecture.md` §4（禁可见组标题、簇间只用分割线、`aria-label` 留给读屏）；`org-permissions.md` §管理端左侧菜单 / §管理端信息架构；`TECHNOLOGY.md` TECH-FE → **符合**：href、id、面板内容、页头与发送 / 阶段 / 解密 / 删除闸门均未变 → 下一步以 typecheck / build / `vitest sidebarNav` / 管理端 E2E 取证。
- **限制**：管理端配置面 `/admin/kol` 仍是遗留页；「连接」「治理」只是入口名，相关面板标题仍为「已添加的连接器」「数字员工治理」等治理文案，两者措辞不一致属预期。

## ADR-2026-09-27：对外只暴露技能（人员授权只对技能）

- **状态**：已接受（用户 2026-09-27 裁决：「我们只对技能授权，不然的话管理过细，无法干活」）。
- **背景**：连接器控制台此前引入按人/按部门/按工具的多层授权（员工 read/write、连接器级组织范围、工具级范围、逐工具审阅授权）。用户裁定对外能力面只有技能：连接器、MCP 工具与 API 属平台内核能力；管理过细会导致无法干活。
- **决定**：
  1. 修宪：`CONSTITUTION.md` CONST-02 增加一段——连接器、MCP 工具与 API 是平台内核能力，只对技能与后台任务开放；对员工的能力面只有技能。员工能否执行由技能授权与技能内的工具绑定决定。
  2. 基本法同步修订：`PRODUCT.md` PROD-PLAT-04 / PROD-PLAT-05、`TECHNOLOGY.md` TECH-BE-07、`org-permissions.md` 员工连接器使用面与按人授权段落、`ia-information-architecture.md` 能力面 #6（原位废止并保留记录）。
  3. 人员授权唯一单位＝技能：谁有技能权限谁可执行；技能自决所用工具（技能 × 工具绑定）。
  4. 连接器不按人授权：员工连接器使用面、员工连接器 read/write、连接器级范围、工具级范围的**授权语义**退役；相关数据表保留但不参与运行时校验，不再提供按人授权入口。
  5. 内部门禁不变：`07-mcp-data-contract.md` 的 L1/L2/L3、L3 确认与回执（CONST-05）、host-only 拦截、工具指纹（schema_hash）。
- **启用门禁（替代原「已有范围」）**：测试通过（`status=verified`）且**已被至少一个技能绑定其工具**（存在启用的技能→连接器→工具绑定）。
- **影响资产**：`backend/src/runtime/execution.ts`（执行校验改技能授权）、`backend/src/routers/enterprise.ts`（启用闸门）、`backend/src/runtime/organization.ts`（范围接口退役）、前端 `ConnectorGrantsCard` / `ConnectorScopeCard` / `ConnectorToolsCard` 范围段 / 员工 `/connectors` 面、E2E `connector-admin.spec.ts`；逐文件清单见设计稿 `superpowers/specs/2026-09-27-connector-setup-wizard-design.md`。
- **生效版本**：随「连接器设置向导」实现同批发布；本 ADR 先于代码落地，期间代码现状与本 ADR 不一致处按本 ADR 修正。
- **审宪记录**：需求「对外只暴露技能；取消逐工具/按人授权」→ 主责 平台产品经理 + 权限域 + 架构师/后端 + UI/UX → CONST-02（本次修订）/ CONST-03（支持）/ CONST-05（L3 闸门不变）/ CONST-08/09（修宪与修法记录）/ CONST-10 → 基本法 `PRODUCT.md` PROD-PLAT-04/05、`TECHNOLOGY.md` TECH-BE-07、`org-permissions.md`、`ia-information-architecture.md` → **符合**（按用户修宪决定执行，内部门禁不放松）→ 下一步：设计稿评审后出实施计划。

## ADR-2026-09-28：写邮件默认发件箱＝当前用户挂载的邮箱；任务中栏只留一条滚动轴

- **状态**：已接受（用户 2026-09-27 直接要求：「写邮件如果没有指定发件箱，默认就是当前用户挂载的邮箱」「任务中栏多了一个区域输出 codex 思考过程，删除该区域，将思考过程拼接在中栏，通过滚轮进行自然滑动」）。
- **决定者**：用户（产品发起人）；KOL 业务专家与后端负责发件箱口径，UI/UX 专家与前端负责中栏几何。
- **背景**：① `backend/skills/email_compose/SKILL.md` 已写明默认发件邮箱是登录用户绑定的 Starry 邮箱，但 `preparedSender` 之后把它丢掉：核对不过就返回空，写邮件停在「待补：发件邮箱」，草稿卡「确认发送」置灰。② 提交 `a5c1990` 把技能交互模板块放进**不滚动**的任务头部，块内又自带 `max-height/overflow-y`（`frontend/src/components/skill-template-context.css`），任务详情中栏因此出现第二条滚动轴：模板卡占掉头部、时间线被压成一条缝，滚轮在头部与卡片上不产生滚动。
- **决定**：① 未指定发件箱时按「请求显式指定 → 当前用户挂载的 Starry 邮箱（`user_starry_bindings.is_default`）→ 合作记录 `mailbox_from` → 当前品牌唯一授权箱 → 留空」解析，规则只住 `backend/src/host/compose-sender.ts` 一处。挂载邮箱只在品牌与范围核对通过时使用：品牌取 `mailbox_owners` 登记，没有登记时用调用方给出的明确品牌（当前合作品牌）并要求该品牌在员工授权范围内；共用邮箱要求本人是 owner 或 `shared_with`。任何一步都不得从多个候选里取第一只（BIZ-04）。② 技能交互模板等中栏内容并入唯一滚动容器 `.session-stream`，`.session-skill-template` 不再自带滚动条；新内容只在用户本来就在底部时才跟随滚动。
- **理由**：① 是 BIZ-04「实际发件箱必须属于员工获准使用的品牌及范围」与 SKILL.md 默认口径的落地——默认来自用户自己的绑定，不是从候选列表挑第一只。② 是 `DESIGN.md`「中栏时间线与右栏结果体各自滚动」与 `docs/superpowers/specs/2026-09-23-unified-agent-workspace.md`「InteractionTimeline ← 唯一中栏滚动容器」的执法。
- **影响**：`backend/src/host/compose-sender.ts`（新增）、`pep.ts`（From 授权分支与 `enforceSend`）、`api.ts`（prepare / 草稿落库 / 卡片载荷 / `PATCH /drafts/:did` 的 from_addr）、`frontend/src/pages/Chat.tsx`、`frontend/src/components/skill-template-context.css`、`frontend/src/components/ChatBlocks.tsx`、`frontend/src/api.ts`。
- **补充决定（同日，用户要求）**：任务详情页的**中栏与右栏改为复用今日任务工作台的视觉 token 与几何**：右栏宽度＝`clamp(--workspace-result-rail-min, --workspace-result-rail-ideal, --workspace-result-rail-max)`、收起＝`--workspace-result-rail-collapsed`；工作区可用宽度＝`.home-stage` 同款（`width: min(100%, --content-max)` + `padding-inline: var(--page-gutter)`）；栏首留白、hairline 颜色、字号/行高/控件（24px `--icon-btn`、`--radius-control`、`--surface-hover`、`--focus-ring`）与 composer 宽度（`--composer-maxw` 居中、dock 不再二次内缩）全部走同一组 token；收起/展开按钮复用今日任务右栏的 `.scope-task-rail-toggle` 控件（真控件：`aria-expanded`、悬停面、可见焦点环、收起态竖排标签）；两栏各只保留一条滚动轴（中栏 `.session-stream`，右栏 `.side-body`）。
- **影响（补充）**：`frontend/src/styles.css`（`.session-shell` / `.session-center` / `.task-detail-header` / `.session-stream` / `.session-composer` / `.side-workbench` / `.side-body` / 字号 token）、`frontend/src/components/SideWorkbench.tsx`（按钮与收起态标记）、`frontend/e2e/workbench.spec.ts`（跨页宽度对照与单滚动轴断言）。
- **审宪记录**：需求「默认＝用户挂载的发件箱 + 任务中栏单滚动轴」→ 主责 KOL 业务专家/后端 + UI/UX 专家/前端 → CONST-04（前端不重写权限）、CONST-05（L3 闸门不变）、CONST-09、CONST-10 → BIZ-04、`email_compose/SKILL.md`、`DESIGN.md`（工作台几何与不变量 5）、统一工作台规格 §7 → **符合**（属实施细则执法与实现补齐，未改法条；挂载邮箱仍受品牌与范围约束，发送仍走确认、幂等与回执）→ 下一步：后端用例与 E2E 取证。
- **限制**：`BRAND_MAILBOX_*` 仍是真实外发白名单；未登记品牌归属的挂载邮箱只有在本人挂载、调用方给出明确品牌且该品牌在其授权范围内时才作为默认，否则退回品牌箱。KOL 会话头部（journey/SOP）几何本次未收敛，矮视口裁切风险仍在。

## ADR-2026-09-28：候选推荐与「采纳为待办」不得混入「今日任务 / 我的待办」

- **状态**：已接受（用户 2026-09-28 报告「今日任务和我的任务又出现了这个，不合逻辑，这个是哪个版本引进来的」）。
- **决定者**：用户（产品发起人）；UI/UX 专家与前端负责渲染归属；平台产品经理保留「推荐块最终住哪个面」的归属决定。
- **背景**：截图里的三行（如「给 @测试1号 超时/风险扫描」「给@100705721 写合作邮件」＋「采纳为待办」）不是任务列表行，而是右栏「下一步动作」（`NextActionBar`）渲染的 `workbench.recommendations`。它出现过两轮：第 1 轮 `4649c43`（2026-09-16，画在今日任务中栏列表内）被次日 `8cdac8d` 删除；第 2 轮 **`e85b12a`（2026-09-23 22:57 +0800「feat(workspace): complete generic skill result and density work」）**把 `recommendations` / `onAdoptRecommendation` 接进今日任务与我的待办**共用**的 `ScopeWorkspace` 右栏，两个页签因此显示同一份行，`status` 又被硬编码为 `candidate`，采纳过的行按钮也不会消失。修复 `eca9156`（2026-09-26）只活在分支 `fix/today-todo-scope`，从未合入主干；`14c2b69`（2026-09-28）加的 board 预热（`void loadBoard("following")`）让这三行在首次进 Home 时就出现。
- **决定**：候选推荐不属于平台任务脊柱。`frontend/src/home/ScopeWorkspace.tsx` 不再接受 `recommendations` / `onAdoptRecommendation`；`frontend/src/pages/Home.tsx` 不再传这两个 prop，并删除唯一消费者 `convertSuggestion` 与从未渲染的 `recommendedItems`。后端的 `buildRecommendedTasks`（`backend/src/host/home-board.ts`）与采纳接口 `POST /api/tasks/recommendations/:id/adopt`、审计事件「采纳为待办」保持不变；`NextActionBar` 继续服务 `registeredActions`（AI发现 / 公海 / 我跟进的红人）。
- **理由**：`ia-information-architecture.md` §1 一页一问（每个表面只回答一个问题，不得把另一表面的信息架构或主 CTA 抄过来）与五模式段落（今日任务 / 我的待办是平台任务脊柱，两模式共享的是布局与状态语义）；推荐属候选面（后端测试 `backend/tests/discovery.test.ts:361`「AI发现 is not 今日任务 recommendations」）；两页签是同一判定下的互斥分流（`superpowers/specs/2026-09-22-today-todo-reuse.md`），候选推荐不在其中；`DESIGN.md` 不变量 1（同一视口 0–1 个实底主 CTA）。
- **影响资产**：`frontend/src/home/ScopeWorkspace.tsx`、`frontend/src/pages/Home.tsx`、`frontend/e2e/home-today-pane.spec.ts`（断言范围从 `[data-today-list]` 扩到整个页签，并先等 board 响应，避免抢在首次绘制前通过）、`frontend/e2e/home-pane-parity.spec.ts`（新增「两个页签右栏都不得出现候选推荐」用例）。
- **审宪记录**：需求「今日任务 / 我的待办不得出现候选推荐与采纳为待办」→ 主责 UI/UX 专家/前端 + 平台产品经理（归属）→ CONST-04（前端只实现已定义规则）、CONST-10（交付必须可验证）→ `ia-information-architecture.md` 一页一问与平台任务脊柱、`DESIGN.md` 不变量 1 → **符合**（执行既有 IA 与 CTA 不变量，未改法条；采纳能力与其审计事件保留）→ 下一步：E2E 取证。
- **限制**：推荐块今后住「AI发现」还是「我跟进的红人」属产品归属决定，本次未定；`eca9156` 的后端一半（today↔todo 互斥分流与 `isAwaitingApproval` 等）未随本次移植，另开一轮。

## ADR-2026-09-28：公海 / 我的红人「分析已选」提交后立即执行（入队接既有任务运行链路）

- **状态**：已接受（用户 2026-09-28 选定「方案A」：提交后 Codex 应真实执行，处理过程在中栏可见）。
- **决定者**：用户（产品发起人）；前端专家负责提交链路，KOL 业务专家负责分析执行口径。
- **背景**：`2026-09-27` 公海交互迁移后，中栏四个入口只预填草稿（`Home.tsx` `prefillPoolQuestion`），提交命中 `Home.tsx` 的 analyze 分支，只调 `POST /api/home/kol-analyze/enqueue` 写一条 `queued` 工作项（`routers/kol-memory.ts`，响应自报 `creates_session:false / calls_model:false`）。全仓创建 `task_runs` 只有两处——人工 `POST /api/tasks/:id/run` 与规划运行，没有任何消费者把排队中的 `kol_analyze` 推进为运行。因此「提交 → Codex 执行 → 中栏处理过程」这段链路实际断路：Codex 不执行、不建会话，中栏无从展示推理（用户验收报告「codex没有执行，中栏没有展示推理过程」）。
- **决定**：提交在入队成功后，立即用返回的 `work_item_id` 调用既有 `POST /api/tasks/:id/run`（`text` 携带完整提问框正文），并沿用 `openRun` 打开会话；执行、停止、恢复全部沿用既有任务运行链路，不新增接口、不新造状态机。`queued` 工作项保留为耐久凭据；「不走 from-text、不冒充副作用」的既有语义不变。该 analyze 分支同时服务「我的红人」的「分析已选」（`analyzeSurface=following`），两处语义一致。
- **理由**：CONST-10（等待必须有真实原因、阶段与恢复入口；入队后无执行者、无恢复入口）；`docs/superpowers/specs/2026-09-23-unified-agent-workspace.md`（「对象分析、澄清和过程进入中栏」；`queued/running` 需真实状态）；`docs/BUSINESS.md` 将 `kol_analyze` 的 Agent 面登记为规则空白——本决定以「不新造口径、复用既有运行链路」的最小方式补齐。
- **影响资产**：`frontend/src/pages/Home.tsx`（analyze 分支：取消检查 + `api.runTask` + `openRun`）、`frontend/e2e/home-pool-follow.spec.ts`（用例改为断言「入队 + run + messages(ask) + 落到 `/s/:session` + 完整 prompt 传递」）。
- **审宪记录**：需求「公海分析提交后 Codex 真实执行、中栏可见过程」→ 主责 KOL 业务专家 + 前端专家 → CONST-04（前端不重写权限与阶段规则，只编排既有受控接口）、CONST-08、CONST-10 → BIZ-16、PROD-AGENT-01、统一工作台规格 §6.1 → **符合**（未触碰发信 / 改阶段 / 领取 / 解密边界；`kol_analyze` 仍为只读分析，仍受技能授权与硬顶 3 约束）→ 下一步：E2E 取证。
- **限制**：入队后到运行之间若进程退出，工作项留在 `queued`，恢复入口仍是任务列表打开（与既有任务一致）；通讯页「快速分析」直连入队的入口不在本次范围（其既有验收仍为「点击即入队、不建会话」）。

