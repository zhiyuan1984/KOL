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
- **影响**：新增 `docs/superpowers/specs/2026-09-23-skill-routing-param-memory-design.md`；修订 `DESIGN.md`（字号用途与密度节）与 `BUSINESS.md`（覆盖表 alias 裁定空白备注）；registry/skill-publish/判别器/resolver 契约扩展；SkillParamCard/ResultRail/NextActionBar 通用渲染器；creator_discovery 试点迁移。
- **限制**：8 个未登记技能的快捷面/Agent 面口径、「AI发现」模式名是否登记为发现技能 alias、BIZ-07 公海字段仍是规则空白，待 KOL 业务专家裁定；机制先行，不编口径。判别器不可用时保持诚实降级，不加本地关键词兜底。
