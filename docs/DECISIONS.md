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

## ADR-2026-09-26：管理端左侧菜单复刻员工端外壳（单壳共用）

- **状态**：已接受
- **决定者**：用户（产品发起人）；UI/UX 专家负责导航外壳与三轴适配，平台产品经理负责管理端 IA 不降级。
- **背景**：管理端 `/admin/*` 自持一列 `.admin-nav`——只有品牌文字、一条「管理」kicker 与九个纯文字条目，没有条目图标、没有分簇分隔线、没有 Lucas、没有折叠 56px 轨道，≤860px 还把导航压成横向顶条；员工端侧栏（`Workbench` 的 `.sidebar`）则是「品牌 + Lucas + 折叠按钮 → 分簇图标条目 → 版本号 + 账户块」。用户要求：除菜单文字内容外，管理页左侧菜单必须与员工端完全复刻。
- **决定**：不再给管理端第二列导航。`/admin/*` 且账号含 admin 模式时，**同一个侧栏实例**改渲染管理端条目集合（`frontend/src/layout/adminNav.ts` 的 9 条：员工 / 数据 / 数字员工治理 / 技能 / 知识 / 审批 / 考试 / 连接器枢纽 / 配置），员工条目集合不渲染；`AdminConsole` 交出 `.admin-nav` 列与品牌块，只留 `.admin-shell > .admin-body`（页头 / 健康条 / 面板）。`styles.css` 删除 `.admin-nav*`（含 `--admin-nav-width`、≤860px 横向顶条、暗色与 ≤720px 覆盖），移除 `.workbench.admin-surface` 的隐藏与单列覆盖，并去掉侧栏轨道 / 折叠规则里的 `:not(.admin-surface)` 守卫。管理端分簇按员工端节奏落位（治理日常 2 / 数字员工 1 / 技能 1 / 资产 4 / 平台配置 1），资产簇顺序与员工端一致（知识 → 审批 → 考试 → 连接器）。
- **理由**：① 「完全复刻」只能由同一实例保证——几何、折叠状态、抽屉触发、页脚与焦点态不会再漂移；② 净减 CSS（约 150 行管理端导航专属规则），少一处「两套外壳各自演化」的重复；③ 复刻只动外壳：条目标签、href、面板与权限闸门、页头治理文案全部不变，员工开工条目在管理面不渲染，符合 `ia-information-architecture.md` §3「配套 ≠ 副本」与 §4「管理端顶栏不得跳员工开工入口」。
- **影响**：新增 `docs/superpowers/specs/2026-09-26-admin-sidebar-shell-parity.md`；`frontend/src/layout/adminNav.ts`（新）、`Workbench.tsx`、`pages/AdminConsole.tsx`、`styles.css`；过时断言同步 `frontend/src/layout/sidebarNav.test.ts`、`frontend/e2e/workbench.spec.ts`（`.admin-nav` 选择器 → `.sidebar`，标签顺序改为新分簇顺序），证据脚本 `artifacts/account-footer/capture.cjs` 改抓 `.sidebar` 并新增折叠 / 抽屉截图；`docs/org-permissions.md` §导航规则两行补「同一侧栏外壳」说明。
- **审宪记录**：需求「除了菜单文字内容外，管理页的左侧菜单必须和用户端的左侧菜单完全复刻」→ 主责 UI/UX 专家、平台产品经理 → CONST-04（前端不重写权限判定）、CONST-07（两类界面各受产品与 UI/UX 规范约束）、CONST-08、CONST-10 → 细则：`ia-information-architecture.md` §3 / §4；`org-permissions.md` §管理端配套套件（两侧共用 MASTER token，不得做成第二套 Home / Agents）；`DESIGN.md` §三轴适配（260px 轨道）、§不变量 1 / 4 / 5、§验收矩阵；`TECHNOLOGY.md` TECH-FE → **符合**：管理端只回答谁 / 权限 / 审计，页头与九个面板未动，治理条目仍只走 `/admin/*`；admin 判据仍是 `available_modes`；复刻不含任何发送 / 阶段 / 解密 / 删除闸门 → 下一步按规格 §2 清单逐项截图核对，并跑 typecheck / build / vitest / E2E。
- **限制**：折叠偏好两面共用（同一 `ui:left-collapsed` 与 `left_sidebar_collapsed`）；若要两面独立记忆需另立一项。管理端配置面 `/admin/kol` 仍是遗留页，其内部 IA 不在本次范围。
