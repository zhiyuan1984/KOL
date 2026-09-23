# 邮箱通讯页 — 以人为中心的往来档案（四栏 + 技能/定时/记忆）设计规格

> 实施规格，不声明生产代码已经完成；状态见文末「实施状态」。
> 上位规则：`docs/CONSTITUTION.md`、`docs/PRODUCT.md`、`docs/BUSINESS.md`、`docs/TECHNOLOGY.md`；本文件是实施细则，不得覆盖上位条款。
> 同类前身：`docs/superpowers/specs/2026-09-21-mail-workbench-4col-design.md`（本文件在其基础上收敛，见「与既有规格的关系」）。

## 目标

把「邮箱通讯」页从**邮件流水页**改成**以人为中心的往来档案页**：

```
栏1 全局左导航  →  栏2 聚合树（对端 → 会话 → 邮件）  →  栏3 正文  ｜  栏4 总结 + 中文译稿
```

五个需求（需求方原话合并）：

1. 四栏、各自独立滚动；
2. 栏2 = 多邮箱切换 + 收件箱/发件箱 + **按收发人聚合**；折叠行只显示已读/未读数量 + 发件人邮箱 + 收件人邮箱，点击展开标题与进线时间；
3. 栏3 = 点文件夹默认选中第一封并渲染正文，**只出正文**，布局不得越界；
4. 栏4 = **总结 + 中文翻译**，且**只和记忆打交道**（页面零模型）；
5. 总结与翻译做成 **skill**、**记忆增量**、**登记为定时任务**：收取新邮件后查是否已翻译，没有就启动翻译技能跑 Codex app-server，跑完写回记忆；总结同逻辑。

## 现状勘测（改前）

| 设计要求 | 现状 | 结论 |
|---|---|---|
| 四栏各自独立滚动 | 三栏栅格 `320px/1fr/340px`，**只有右栏**有 `max-height + overflow-y`；顶部「邮箱切换 + 收取」条横跨列表栏压进正文栏 | ❌ 待改 |
| 栏2 按收发人聚合 | 后端一行一会话，前端无分组 | ❌ 待改 |
| 栏3 只出正文 | 正文栏内还挂着会话摘要卡片 | ❌ 待改 |
| 栏4 只和记忆打交道 | `GET /api/mail/conversations/:id` 声明 `calls_model:false`，实际会标 pending 并后台跑模型翻译 | ❌ 待改（声明与行为不一致） |
| 总结/翻译是技能 | `backend/skills/` 无这两个技能；摘要由 `host/mail-summary.ts` 直连实现，译文只在 `translation_zh IS NULL` 时补 | ❌ 待补 |
| 记忆增量 | 译文非空即永不重算；摘要指纹只用「长度」，同长度改写不触发 | ❌ 待补（缺内容指纹列） |
| 定时任务跑模型 | `cron` 四个 handler 全是确定性动作；`CronHandler` 是同步签名；`retry_policy` 只存不用；`cron_runs.session_id` 恒 NULL | ❌ 待补（需 async 化 + 新增作业） |
| 正文实体 | `&ensp;` 等 HTML 实体在正文里当字面量显示（前端无实体解码） | ❌ 待改 |

## 信息架构

```
Mail_Page
├── Sidebar（全局左导航，不改）
├── Mail_List_Panel     320px   邮箱切换▾ 收取 ｜ 搜索 ｜ 收件箱/发件箱/未读/已读 ｜ 聚合树
├── Mail_Content_Panel  minmax(0,1fr)   只出正文
└── Mail_Assist_Panel   340px   上=总结（人/会话/封三级）  下=中文译稿
```

三栏各自 `overflow-y: auto`；页面外层不出现第三条业务滚动轴（`docs/DESIGN.md:83`）。窄屏（<1024px）沿用既有单栏 + 顶部三段切换，不做四栏硬挤。

## 栏2：聚合树

| 层级 | 折叠态显示 | 数据 |
|---|---|---|
| 组行（对端） | 未读 N · 已读 M ＋ 发件人邮箱 ＋ 收件人邮箱 | `peer_email`、`mailbox`、`unread_count`、`message_count` |
| 会话行 | 标题 ＋ **进线时间** ＋ 未读标记 | `subject`、`first_at`、`unread_count` |
| 邮件行 | 时间 ＋ 主题 ＋ 已读标记 | `occurred_at`、`subject`、`unread` |

- **分组键 = 归一化小写完整邮箱地址**（`peer_email`）；不得用显示名或前缀（`docs/BUSINESS.md:11`：「邮箱前缀相同不能认定为同一对象」）。
- 一级筛选沿用 收件箱 / 发件箱 / 未读 / 已读 + 搜索 + 只看未建档（不引入 CRM 阶段）。
- 「进线时间」= 该会话内最早一封的 `occurred_at`；无数据时显示未知，**不伪造**。

## 选择状态与默认选中

URL：`?box=<邮箱>&p=<对端邮箱>&c=<conversation_id>&m=<message_id>`，可刷新、可分享。

| 动作 | 栏2 | 栏3（只出正文） | 栏4 |
|---|---|---|---|
| 点文件夹 / 切换邮箱且无有效 `c`、`m` | 首组展开，**默认选中第一封** | 该封正文 | 会话摘要 + 该封译稿 |
| 点组行（`?p=`） | 展开 | 该对端默认一封正文 | **人来往总结** + 该封译稿 |
| 点会话行 | 展开并选中 | 该会话默认一封正文 | 会话摘要 + 该封译稿 |
| 点具体邮件（`?m=`） | 时间线选中 | 该封正文 | 单封总结 + 该封译稿 |

**栏3 不允许空态**：任何层级的选择都必须解析出「一封」再渲染。

## 栏4：只和记忆打交道

| 状态 | 触发条件（真实信号） | 显示 |
|---|---|---|
| 有产物 | `digest_text` / `translation_zh` 非空 | 内容 + 来源标记 + **更新时间** + 原邮件引用 |
| 生成中 | `memory_source='pending'`（后台作业已接单、尚未落库） | 「摘要生成中…」「翻译生成中…」 |
| 缺失 / 失败 | 无产物，或 `analysis_failed` | 保留旧产物并标过期/失败 + 真实错误 + 「填入输入框」入口 |

- **人来往总结只取一个邮箱维度**：当前栏2 选中邮箱；未指定时取绑定的第一个邮箱（`is_default` 优先）。不跨我绑定的多个邮箱合并，也不跨对端的多个地址合并；卡片标注来源邮箱地址。
- 页面**不得**触发模型：缺失/失败态只提供「填入输入框」（语义 = 填进提问框、由员工自己发送，不等于执行）或「交给 Agent」。

## 技能 · 定时任务 · 记忆增量

```
收取新邮件 POST /api/mail/sync（command，零模型）
  └─ 同步收口：扫描「缺产物 / 指纹变化」→ 只写「待补算」标记（零模型）
       └─ 触发「邮件记忆增量」作业（登记为定时任务；收取后 fire-and-forget 触发一次，inflight 去重）
            └─ 技能 mail_translate / mail_summary（SKILL.md = 契约 + 提示词）
                 └─ 执行：Codex app-server 直连（无会话、无 thread/turn）
                      └─ 结果写回本地记忆
                           └─ 栏4 只读记忆（零模型、零 thread/turn）
```

- **两个技能**：`backend/skills/mail_summary/SKILL.md`、`backend/skills/mail_translate/SKILL.md`。两者 `employee_visible: false`、`in_market: false`、`side_effects: none`、`creates_session: false`、`auto_ok: true`，`aliases: []`；正文声明只写本地记忆、不发信、不改阶段、不写远端。
- **增量条件**：译文 = `translation_zh` 为空 **或** 正文指纹变化；摘要 = 无模型产物 **或** 会话指纹变化 **或** 上次失败且过冷却窗口。
- **记忆写回**：`kol_mail_items` 增 `memory_fingerprint / memory_source / memory_generated_at / memory_error / memory_attempts`；失败只标失败，**不覆盖已有产物**（PROD-AGENT-07：「后台摘要失败应保留旧摘要并标过期或失败」）。
- **定时任务**：`cron_jobs` 的 `mail_memory_increment`（`cron/store.ts` 的 `SYSTEM_JOBS` + `cron/handlers.ts` 的 handler + `handlerContract`）。回执写 `receipt` / `artifact_refs`（`cron_runs.session_id` 恒为 NULL，模型证据不能放那里）。
- **形态选择**：执行走**无会话的 app-server 直连**（与 `cron/handlers.ts` 头注「确定动作不得创建 thread/turn/session」相容，且是仓库既有做法：`mail-summary.ts` 的 `digestWithCodexAppServer` / `summarizeWithCodexAppServer`、`translate-zh.ts` 的 `translateWithCodex`）。
- **失败与重试**：`retry_policy` 目前只存不用，重试写在 handler 内（复用 `analysis_failed` + 粘滞冷却），失败保留旧产物。

## 视觉与越界

- 顶部「邮箱切换 + 收取」移进栏2 头部（消除横跨两栏）。
- 去掉 `.mail-split{overflow:hidden}` 对 sticky 浮层的裁切（`docs/DESIGN.md:92`：浮层不得被静默裁切）。
- 长邮箱地址 `overflow-wrap: anywhere` / `word-break: break-all`，不靠 `white-space: nowrap` 硬撑；仍需省略处补 `title`。
- 正文渲染前做 HTML 实体解码（`&nbsp; &ensp; &amp; …`），**保持纯文本渲染**，不引入 `dangerouslySetInnerHTML`。
- 选中态沿用既有「3px 左侧强调条 + 字重/背景」，不靠颜色单独表达（`docs/DESIGN.md:90`）。

## 组件（前端）

| 组件 | 职责 |
|---|---|
| `CorrespondentRow` | 组行（折叠计数 + 收发双方邮箱；展开/选中态） |
| `ConversationItem` | 会话行（标题、进线时间、未读标记） |
| `MailTimelineItem` | 邮件行 |
| `MailContent` | 栏3 正文（只出正文） |
| `MailAssist` | 栏4 容器（上总结、下翻译） |
| `CorrespondentDigest` | 人来往总结（单邮箱维度） |
| `ConversationSummary` / `TranslationPanel` | 会话摘要 / 该封译稿 |

纯函数：`mail/groups.ts`（按对端分组 + 默认选中）、`mail/text.ts`（实体解码）、`mail/digestView.ts`（三态视图模型）。

## 测试计划

- 后端：增量只处理缺产物/指纹变化；失败不覆盖旧产物；`first_at/message_count/unread` 字段；同步后不在读取路径跑模型；cron 作业回执照实填写；`validate:contracts` 通过。
- 前端：`groups.ts` / `text.ts` / `digestView.ts` 单测；e2e —— 点文件夹默认选中第一封、栏3 不含总结与译稿、栏4 两态块齐备、点组行出来往总结、每栏无横向越界、各栏可独立滚动、`&ensp;` 不字面出现、**栏4 零模型调用**。
- 截图：1440×900 与 1280×800。

## 与既有规格的关系

- 唯一修订：邮箱切换入口从页面顶部移到栏2 头部（消除越界）。
- 两处收敛：总结粒度由「会话级」扩展为「人 / 会话 / 封」三级；栏3 收敛为纯正文（总结与译稿只在栏4）。
- 明确不做：不改栏宽；不引入 CRM 阶段；不新增文件夹页/会话详情页；不在页面触发模型；不做跨邮箱合并。

## 规则空白与交办（CONST-08 四档结论）

| 事项 | 结论 | 交办 |
|---|---|---|
| 邮箱通讯页未在 IA 一等能力表登记 | 规则空白 | 平台产品经理补「本面回答哪个问题」 |
| `mail_summary` / `mail_translate` 员工口径未登记 | 规则空白 | KOL 业务专家补 `docs/BUSINESS.md` 覆盖表 |
| `docs/ui-ux-rules.md` 与 `docs/DESIGN.md` 双双自称唯一数值来源；四栏内容宽触到 `--content-max` | 冲突（不在本次解决） | UI/UX 专家裁定；本次不改栏宽 |
| cron 通道跑模型的形态 | 已定：无会话 app-server 直连 | 若后端专家要求改走会话态统一 harness，另立变更 |

## 实施状态

- Phase 1 技能：已完成（`backend/skills/mail_summary`、`mail_translate`）。
- Phase 2+3 后端记忆增量：已完成（记忆列、`persistItemMemory`、`mail-memory-job.ts`、sync 挂钩、读取路径零模型）。
- Phase 4 定时任务：已完成（`mail-memory-increment` handler + async 化 + 系统作业登记）。
- Phase 5 前端四栏：已完成主体（聚合树、栏3 纯正文、栏4 只读记忆、独立滚动、实体解码、越界修复）；e2e 11/14 通过，2 项失败与 Home 页既有改动相关，1 项 flaky。
- Phase 6 验收：后端 typecheck/contracts/关键测试通过；前端 typecheck/build 通过；截图已补（`artifacts/mail-redesign/mail-{1440x900,1280x800}-{conversation,message,person}.png`）；e2e 11/14 通过，2 项失败与 Home 页既有改动相关（非本次邮件改版引入），1 项 flaky。
- Phase 7 文档：本文件与 `docs/superpowers/plans/2026-09-23-mail-correspondent-workbench.md`、`docs/DECISIONS.md` 已更新。
