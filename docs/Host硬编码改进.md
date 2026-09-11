# Host 硬编码改进（对照现网 TS，按 Codex harness 退场）

> 日期：2026-09-10  
> 规范：`docs/灵工-Agent中台开发规范.md` → `docs/codex-KOL-编码规范.md` v1.3  
> **Codex harness = Codex app-server。** 本文只写 Host TypeScript 怎么退，不新做员工端智能体。

基线：`origin/main` 并入 `cursor/codex-account-login-475e` 之后。以后功能分支从 **main** 拉。

生产验收：已发布 Skill + 真实 app-server + 授权远程 MCP。`CODEX_MODE=stub` / `import` Host 目录函数 **不算**。

---

## 0. 先改的总开关（其余项都依赖它）

| 现网 | 最优改法 | 留在 Host |
|---|---|---|
| `runWorker`：`isEmailMcpTask` / Claw / SOP / `deal_memory` / `confirm_stage` → `runStub` | 生产一律 `runCodex`。`runStub` 仅 `CODEX_MODE=stub` | 超时、杀箱、把 Item 写入 session |
| 几乎全部 Skill `mcp: []` | frontmatter 写明本 turn 的远程工具；`runCodex` 的 `mcp_servers` 用这份列表 | Gateway 确认发送；`hostConfirmStage` |
| journey 同步自造 chips / placeholder | 读 **最近一次 Codex 产物**；打开会话若无产物，先跑 `stage_sop` 或当前阶段写信 Skill 的 turn | HTTP 组装、digest 存储、20s 拉取合并 |

不先改这三项，只把目录从 `compose-loop.ts` 挪到别的 TS 或「KOL Agent」，仍是 Host 硬编码。

---

## 1. 业务目录（必须离开 Host）

### 1.1 `STAGE_MAIL` / `stageMailSpec` / `letterCopy`（`compose-loop.ts`）

**现状：** 15 阶段 → chip / 口令 / 要点 / 模板。  
**改法：** 迁入 `backend/skills/email_compose/SKILL.md`（本阶段这一封表）。Codex turn 按 `stage_code` 选这一封并出 `create_draft`。模板正文可留 `email-templates.ts` 当 **知识/示例**，由 Skill 引用，不要 Host 按阶段硬选。  
**不要：** 灌进爬虫 / 审批入口或 Claw 远端。

### 1.2 `kindFromRaw`

**现状：** 正则猜信件种类，覆盖正式阶段。  
**改法：** 删除。种类 = 已锁 `email_compose` + 当前正式阶段 + 用户本句（由 turn 认）。  
**Host：** 无。

### 1.3 `composeGapHint`

**现状：** 缺金额 / 运单 / 地址 → placeholder 与结果卡动作。  
**改法：** Skill 缺口表为唯一契约；turn 把同一份写进 `recommended_actions` + 结果卡。chip **标签**可继续「写报价邮件」（e2e）。  
**Host：** 只转发 Item 字段到 `composer_placeholder`，不计算缺口。

### 1.4 `intent.ts` 金额 / 运单 / 承运商 / 信件口令

**现状：** Host 正则抽槽。即使用户已禁止「锁 Skill」，抽槽仍是第二套语法。  
**改法：** Codex turn 按 `required_inputs` 从口令与 CONTEXT 认。  
**Host 只否决：** `sanitizeIntentEntities` 类 allowlist（邮箱必须出现在人口令或已绑定箱）；禁止默认第一只 From；禁止编造达人邮箱。

### 1.5 `collabActions` / `recommendedCollabActions`

**现状：** Host 按阶段插 chip，`act=ask`。  
**改法：** 文案与顺序来自 `email_compose` / `stage_sop` / `confirm_stage` 的契约与最近 turn 的 `recommended_actions`。会话仍只预填。  
**Host：** 把 Codex 产出的列表原样交给前端；缺列表时不要用 TS 默认表凑。  
**不要：** 爬虫会话出现「写报价邮件」；审批会话出现合作信 chip。

### 1.6 `composer_placeholder` 与首页 `STAGE_REC_INTENT`

**现状：** 两张表，和 SOP `next_action` 不完全一致。  
**改法：** 删 Host 第二张推荐表。首页「今天推荐」= 该行合作上 **Codex 已给出的下一步**（KOL 行用邮件/SOP Skill，爬虫行用 `creator_discovery`，审批行用 `business_approval`）。  
**Host：** 查询与排序（最多 8 条），不发明口令。

### 1.7 `sops.ts` 的 `next_action`

**现状：** SOP 包内「写合作邮件 / 核对地址 / 记状态」。  
**改法：** 作为 `stage_sop` / `sop_*` 资料包内容，由 Codex 展示。与 1.1 信件短名对齐，只维护 Skill 侧一份。  
**Host：** 不在 journey 里另写 next_action。

### 1.8 `result-revise` 字段合并

**现状：** 未发送结果上 Host 合并金额等。  
**改法：** 未发送追问走 **同一 thread 的下一 turn**（Skill：只改点名字段）。Host 不再用正则判断「这是改金额」。  
**Host：** 记住「当前未发送草稿」的 session 指针，避免新开任务。

### 1.9 `quote-amount.ts`（account-login 并入）

**现状：** Host 把报价写成小时单价。  
**改法：** 单价语法写进 `email_compose` Skill；turn 认「USD n per hour」。  
**Host：** 不默认 USD 100、不在 TS 里改金额语义。

---

## 2. 闸门与阶段机（留在 Host）

### 2.1 确认发送 / `gateway/send.ts`

**不迁。** Worker / Codex 不得 `sendEmailNow`。预览 MCP 在写信 turn 里调；真发只在人说「确认发送」后走 Gateway。

### 2.2 `hostConfirmStage` / `legalTargets` / version 409 / 异常冻结

**不迁。** `confirm_stage` Skill 的 Codex turn **只出确认卡**。写入仍是人确认后的内核。SKILL.md 可写「内核写入」，不要写「Host 编排 MCP 出确认卡」。

### 2.3 `tryFactAdvance`（FACT_AUTO）

**不迁到任何 Agent。** 物流 / 平台事实仍只走相邻格。发送路径永不写阶段。

### 2.4 PEP / 发件栈 / 占位邮箱跳过

**不迁。** 知识草稿 From 白名单与 Starry 真发件栈继续分开。

---

## 3. 会话内核（留 Host，但停止自造业务）

### 3.1 打开会话一次 Starry pull / digest / 20s 合并

**留 Host。** Codex 只消费 digest，不在 chip / SSE / 发送上再拉。

### 3.2 `creator_discovery` 产出后启动采集

**现状：** SKILL 写「Host 自动启动采集」。  
**改法：** turn 只出 `crawl_plan` Item；内核按 Item 启动远程采集。这是副作用调度，不是 Host 选 Skill。

### 3.3 审批 cited plan 持久化

**留 Host。** Codex 检索制度并出 cited plan；内核校验人名 ∈ 绑定、必须有出处，然后落库通知。不要把档位表写回 TypeScript。

---

## 4. 现网「由 Host 调用 MCP」的 Skill（语言与调用方一起改）

下列 Skill 正文曾写「由 Host 调用 …」。**最优：** Codex turn 调同一批远程工具；Host 不再代调。

| Skill | 远程 | 改法 |
|---|---|---|
| `email_compose` | Starry 预览（真发仍 Gateway） | turn 预览；摘要来自 CONTEXT / 读会话 MCP，不是 Host 注入目录 |
| `email_mailbox_list` / `email_conversation_*` | Starry 读 | turn 调 `pageMailboxes` 等 |
| `creator_profile` 及库 / 看板 / 负责人 / 解密 | Starry | turn 调；解密仍 L3 |
| `reply_analysis` / `risk_scan` | Starry 只读 | turn 按工具顺序读；建议下一步进 `recommended_actions` |
| `creator_scoring` / `outreach` / `daily_tasks` / `budget_report` | Claw | turn 调 Claw；不是灌进员工端「KOL 智能体」门面当第二套写信 |
| `stage_sop` / `sop_*` | 无写 | turn 展示 SOP 包 |
| `deal_memory` | 读摘要；受控写备注 | turn 整理；写画像备注走授权 MCP，仍不改阶段 |
| `confirm_stage` | 只提案 | turn 出卡；写阶段留内核 |
| `business_approval` | web_search + 内核持久化 | 见 3.3 |
| `creator_discovery` | 无 MCP 组 plan | 见 3.2 |

员工端三张入口不变：KOL 预填 `stage_sop`，审批预填 `business_approval`，爬虫预填 `creator_discovery`。**不要**为调度再做第四张卡。未锁时用已有 commander profile 在当前会话 `thread/fork`。

---

## 5. 建议落地顺序

1. 改规范与 SKILL 用语（本变更）。  
2. 关掉生产 `runStub` 旁路；给需要 IO 的 Skill 填 `mcp:`。  
3. 把 `STAGE_MAIL` / gap / 推荐表 / 口令抽槽从 Host 删除，journey 只转发 Codex 字段。  
4. 未锁 Skill 时 runner 调用已有 `deriveChildThread`。  
5. CI：阶段机继续 stub；写信 / 推荐 UX 用真实 harness 或标明「不算本 UX 验收」。

每一步保持：发送 ≠ 改阶段；chip `act=ask`；报价 chip 文案「写报价邮件」；From 不默认列表第一只。
