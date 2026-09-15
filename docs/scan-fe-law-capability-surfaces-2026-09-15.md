# 前端法律扫描：员工能力面（2026-09-15）

> 只读扫描。**不改应用代码，不附补丁。** 本文件只记录对照现行法的发现与建议。

## 0. 范围与方法

| 项 | 值 |
|---|---|
| 基线 | `cursor/docs-org-domain-canons-a1e1` @ `f76512c`（ADR-028 单一 C/D） |
| 仓库 | https://github.com/zhiyuan1984/KOL |
| Track | 审批 / 连接器使用 / 知识库 / 考试 / 个人设置 |
| 扫描文件 | `frontend/src/pages/Approvals.tsx`、`ConnectorUse.tsx`、`Knowledge.tsx`、`Exam.tsx`、`AccountSettings.tsx` |
| 连带只读 | `StarryBindForm.tsx`、`connectorUse.ts`、`knowledgeCopy.ts`、`frontend/src/styles.css` 对应节、`layout/Workbench.tsx` 侧栏坐落 |
| 不做 | JSX/CSS/API 修改；Admin 治理页全文；后端 schema 提案 |

### 对照法（按 LAW-MAP 高 → 低）

| 层 | 路径 | 本扫描用到的硬条款 |
|---|---|---|
| B | `docs/CONSTITUTION.md` §3 / §4.1 / §5 | 一页一问；L1–L3；删除/外发等须对象·范围·后果；Toast ≠ 持久回执；禁伪造完成 |
| C | `docs/org-permissions.md` | 使用 ≠ 治理；员工 `/connectors` 禁凭据/启停；Starry 个人绑定只留 Settings；员工 `/kb` ≠ 邮件模板管理台 |
| G | `specs/UX-EMPLOYEE.md` `L3_CONFIRM` | 执行前展示对象、范围、后果；确认后才执行；持久回执；拒绝必须填原因；员工禁 MCP/Codex/Thread/JWT 堆栈 |
| H | `docs/ia-information-architecture.md` | `/approvals` 哪些单要我确认；`/connectors` 已授权可用哪些；`/kb` 查找/预览/收藏/用于当前任务；`/exam` 应试；Settings 个人绑定 |
| I | `docs/design.md` → `MASTER.md`；`pages/approvals.md` | 语义 token；一区一个主按钮；迁移别名不得进新代码；审批确认/回执 chrome |

严重度：

- **P0**：现行硬不变量已被页面动作打破（L3 闭环、使用面出现治理控件、伪造完成）。
- **P1**：能力面答错问 / CTA 合同未完成 / 员工禁词或 MASTER 主色槽位明显走偏。
- **P2**：视觉残留、无障碍、元数据缺口、预留路由。不阻断本面主路径。

建议只写「应改成什么」，不写补丁。

---

## 1. 五面总表

| 面 | 路径 | 一页一问 | L3 / 破坏性 | 使用≠治理 | 视觉 / 行话 | 本轮 |
|---|---|---|---|---|---|---|
| 审批 | `/approvals` | 队列 + 费用预览（页规允许） | 同意/驳回已闭环 | 无治理控件 | 安静；`rule_id` 与 `docs20` 残留 | **基本合规** |
| 连接器使用 | `/connectors` | 已授权可用哪些 | 无写动作 | 无凭据/启停；Starry 只链 Settings | token 较干净 | **合规** |
| 知识库 | `/kb` | 浏览/预览/收藏在；「用于当前任务」仅邮件 | 隐藏是次要偏好（ADR-021 允许） | 无发布/停用主 CTA | 迁移别名 + hex 回退 | **部分合规** |
| 考试 | `/exam` | 应试；未就绪诚实空态 | 无提交、无一键通过 | 无闸门治理 | 行内 style；「闸门 / 体验账号」 | **合规（主路径）** |
| 设置 | `/settings` | 个人绑定与偏好 | **删除/解绑未走 L3_CONFIRM** | Starry 表单住对地方 | JWT/Bearer；`--star`/`--line` | **P0** |

---

## 2. P0

### P0-1 Settings：删除记忆、删除会话、解除 Starry 绑定没有 L3 确认与持久回执

**法**：宪法 §5；`UX-EMPLOYEE` `L3_CONFIRM`。删除、敏感绑定变更、需审计动作必须：触发 → 展示**对象 / 范围 / 后果** → 确认后执行 → **持久回执**（Toast 不能替代）。拒绝路径须填原因。

**证据**（`AccountSettings.tsx` + `StarryBindForm.tsx`）：

| 动作 | 确认 | 对象 / 范围 / 后果 | 拒绝原因 | 回执 |
|---|---|---|---|---|
| 删除 Markdown 记忆 | `window.confirm(\`永久删除“${title}”？\`)` | 仅标题；无范围；后果只「永久」 | 无 | `setNotice("记忆已删除")`，对象已从列表消失 |
| 删除会话 | `window.confirm`（提到消息/草稿/运行箱/附件与合规记录） | 有对象与部分后果；无范围字段 | 无 | `setNotice("会话已删除")` |
| 解除 Starry 绑定 | `window.confirm("解除绑定后，首页不再按该邮箱过滤跟进红人。")` | 无对象行；后果一句 | 无 | `setNotice("已解除绑定")` |

`run()` 把成功写成页顶 `status-ok`。下一操作会清掉。被删对象不再挂回执。这是瞬时提示，不是业务回执。

管理端已有结构化确认（`adminConfirm.ts`：title / scope / consequence）。员工 Settings 的破坏性动作没有对等闭环。

**建议（不补丁）**

1. 三次破坏性动作都改成与审批确认层同构的卡：对象、范围、后果先于按钮。
2. 解绑 / 删除的关闭路径收原因（至少解绑与删会话）。
3. 成功后在本页留可刷新仍在的回执（设置审计切片或「最近一次绑定/删除」），不要只靠 notice。
4. 不要把 `window.confirm` 算作 `L3_CONFIRM`。

---

## 3. P1

### P1-1 知识库：「用于当前任务」只挂在邮件模板上

**法**：H §2 #5；C 员工 `/kb`；ADR-021。员工面只回答查找 / 理解适用 / 预览 / 收藏 / **用于当前任务**。邮件模板是一类资料，不是整库。

**证据**：`Knowledge.tsx` 卡片主 CTA 与抽屉脚都用 `kbIsMail(row)` 包住「用于当前任务」。`useForTask` 对非邮件直接 `return`。SOP / 品牌与产品 / 报价与谈判只有「查看内容」「收藏」。

主 CTA 文案已是「用于当前任务」，`btn work` 在 `.kb-page` 里映射 `--primary`（MASTER 主色槽位对）。合同缺口是**覆盖面**，不是文案。

**建议**：非邮件资料也要有「用于当前任务」（把适用说明/摘要带进当前任务上下文，仍只产未发送草稿，不发信、不写阶段）。不要把该 CTA 收成「用这份写信」的别名。

### P1-2 知识库仍保留「我的 / 市场」双面

**法**：ADR-021 §2：不得再用「我的知识库 / 知识市场」当员工主 IA。

**证据**：

- `App.tsx`：`/kb` → `<Knowledge />`，`/market/kb` → `<Knowledge market />`
- `Knowledge.tsx`：`data-kb-page={market ? "market" : "mine"}`；`KB_MARKET_LEAD` 仍写「组织已发布、可直接选用」
- 默认侧栏只链 `/kb`（`Workbench.tsx`），市场路由是遗留深链

**建议**：员工只留 `/kb` 一条 IA。`/market/kb` 重定向或删除；去掉 `mine`/`market` 状态。上架/下架只在 Admin。

### P1-3 知识库员工 chrome 仍用迁移别名与裸 hex

**法**：I `design.md` §2；MASTER §2：新代码用核心 token；`--canvas` / `--line` / `--muted` / `--star` / `--chrome` 只保旧代码；禁止散落 hex。

**证据**（`styles.css` 员工 KB 节，非 Admin 专属）：

- `.kb-lead`、`.kb-card-summary`、`.kb-card-source` 用 `var(--muted)`
- `.kb-drawer` 用 `var(--canvas)`；头/脚/预览框用 `var(--line)`、`var(--chrome)`
- `.kb-ok` / `.kb-warn` 回退 `#008f6b`、`#e11d2e`；hide option 用 `#fff`
- `.kb-page .btn.work:hover` 混入 `#111827`

`.kb-page .btn.work` 本身已是 `--primary` / `--primary-fg`，主 CTA 槽位正确。问题是周围皮肤仍走旧别名。

**建议**：员工 KB（含抽屉）改读 `--text-muted`、`--bg`、`--bg-elevated`、`--border`、`--success`、`--danger`、`--primary-fg`。不要再给 `--kb-*` 写 hex 回退。

### P1-4 Settings · Starry：员工面摊 JWT / Host Bearer

**法**：G 员工禁词（引擎/堆栈不摊给员工）；C：个人绑定只留 Settings，**使用面**禁 JWT 粘贴框。Settings 可以绑邮箱，不必把密钥协议写给员工。

**证据**：`StarryBindForm.tsx`（Settings `tab=starry` 唯一实现）

- 标题「连接 Starry KOL」
- 标签「Starry 用户 JWT（可选）」
- placeholder「已配置 Host Bearer 时可留空；过期时再粘贴新的 JWT」
- 说明「JWT 不会回显」

绑定 CTA 只从 `/connectors` 链来（`/settings?tab=starry`），**使用面没有复刻表单**——那条是对的。行话在 Settings 里。

**建议**：员工只问「绑哪只跟进邮箱」。密钥过期用「重新验证」而不是 JWT/Bearer/Host。KOL 试点对象不要写进设置页标题当产品壳。

### P1-5 Settings 主按钮与 Tab 仍走 `--star` / `--line` / `--font-ui`

**法**：MASTER §5：主按钮用主色实底；I：迁移别名不进新代码。

**证据**：

- 全局 `.btn.work` = `background: var(--canvas); color: var(--star); border-color: var(--star)`（审批/KB 有页级覆盖，**Settings 没有**）
- `.settings-tabs`：`border-bottom: var(--line)`；active 用 `var(--star)`；`font-size: var(--font-ui)`；`min-height: 36px`（MASTER 触控 44px）

「保存资料 / 保存偏好 / 更新密码 / 绑定所选邮箱」因此不是 MASTER primary 实底。

**建议**：Settings 与审批/KB 一样，主按钮映射 `--primary`；Tab 用 `--border` / `--text` / `--primary`；触控目标 44px。

### P1-6 考试页文案把治理词和调试词留给员工

**法**：H #10：员工 `/exam` 只回答应试；闸门治理在 Admin。G：不摊调试/引擎。宪法 §3：不伪造完成——本页空态是诚实的，问题在用词。

**证据**：`Exam.tsx`

- 导语：「应试与**发信闸门**」「本页不能提交成绩，也**不能切换体验账号**」
- 未就绪且 `exam_passed === false`：「发信仍会被考试**闸门**拦住」

页上**没有**通过按钮，也**没有**调用 `api.submitExam`。空态 `data-exam-empty="unready"` 写明「不会在本页假装通过」。主路径合规。

**建议**：员工只说「还没有可作答的题卷；开通前不能完成考试」。闸门矩阵、体验账号切换放到 Admin / 调试。不要为了诚实空态而把治理词写进英雄区。

**接线风险（尚未发生）**：`api.submitExam` 与 `POST /api/exams/:id/submit` 仍接受 `passed: true`。员工页若接这条 API，禁止做成一键通过。本条不是当前 JSX 违约，是后续禁令。

---

## 4. P2

### P2-1 审批：费用发起没有第二层确认卡

`pages/approvals.md` 把 L3 收在同意/驳回；费用发起走规则预览后提交。`InitiateExpenseForm` 在预览链上写「确认后提交」，提交键即主按钮，没有对象/范围/后果卡，也没有「已提交」独立回执（成功后深链新单，新卡本身即待处理记录）。

若把「提交费用审批」升级为正式资产写入，建议与决定层共用确认卡。按现行页规记 **P2**，不升 P0。

### P2-2 审批：员工可见 `rule_id`；壳标记 `docs20`

- 卡片元数据：`适用 ${rule}`（`payload.rule_id`）
- 根节点 `data-visual="docs20"`（考试页同样）

`design.md` 已废止把 `docs/20` 当实施入口。规则短名对员工是引擎目录，不是金额/审批人。

**建议**：员工写「按费用规则」或规则展示名；去掉 `docs20` 标记。

### P2-3 审批确认层是卡片内 Dialog，没有焦点阱

确认层有 `role="dialog"`、`aria-modal`、对象/范围/后果、驳回原因必填、Escape、关闭后焦点回触发钮、执行中 `aria-busy`、回执 `role="status"`——`pages/approvals.md` 状态矩阵基本齐。Tab 仍可逃到卡外。MASTER §6：Dialog 打开后焦点在层内。

### P2-4 知识库：「查找」只有 Tab，没有检索

ADR-021 明确「不补检索 API」，故无搜索框**不升 P1**。查找 = 锁定 Tab 顺序（全部 / SOP / 邮件 / 品牌 / 报价 / 最近使用）。无收藏筛选（收藏只写本机 `localStorage`，提示已诚实）。

**建议**：有检索 API 后再加查找；收藏筛选可先做，勿做成第二套 Home 待办。

### P2-5 知识库隐藏是次要偏好，但写库无回执

「对本账号隐藏」在 `<details>更多</details>`，不是主 CTA；文案写清只影响本账号。后端 `knowledge_deprecations` 按 `user_id` 分行，不是组织停用。符合 ADR-021 §3。

缺口：点原因即 `deprecateKnowledge`，无确认、无回执。隐藏原因三条（过时 / 品牌 / 发出去容易被拦）仍偏邮件模板。

**建议**：保持次要；原因改成资料通用语。不要做成启用/停用主按钮。

### P2-6 知识库抽屉是第二滚动区；说明只靠 hover

- `.kb-drawer-body { overflow: auto }` + 页主滚动。宪法 §3：一页一个主滚动。
- `Hinted` 只 `onMouseEnter`，3s 消失。键盘/触控看不到「不会直接发送」。MASTER：操作须能无鼠标完成。

### P2-7 考试 `h1` 行内 style

`style={{ marginTop: 0 }}` 叠在已有 `.exam-page h1` 上。宪法 §3 / MASTER：页面不自写与设计系统冲突的间距。用 token 间距即可。

### P2-8 Settings：密码确认失败静默；「模型档位」是引擎词

- `PasswordForm`：两次新密码不一致直接 `return`，无 `role="alert"`。宪法 §6：提交失败聚焦错误。
- 偏好「模型档位」`model_tier`（快速/均衡/高质量）是引擎档，不是员工工作偏好。G 禁把引擎说明书摊给员工。
- 改密成功只有 notice + `location.reload()`。改密可视为表单即确认；回执仍偏 Toast。低于删除，保持 P2/P1 边界偏下。

### P2-9 连接器使用面：无功能性违约

只读消费 `GET /api/connectors`；状态「可用 / 需个人绑定」；空态「目前没有已授权给你的」；绑定只去 `/settings?tab=starry`；页脚写明不收密钥、不表示远端已通。标签去掉 MCP/Codex。侧栏入口在资产簇，链 `/connectors`，不链 `/admin/connectors`。

可收拾：遗留 id（`emailmcp`）若仍出现，继续用业务名，不要把短名当员工标题。

---

## 5. 已合规（避免误报）

### 5.1 审批 · L3_CONFIRM（同意 / 驳回）

对照 `pages/approvals.md` 与 G：

| 要求 | 实现 |
|---|---|
| 第一次点击不执行 | `setPending`，打开确认层 |
| 对象 / 范围 / 后果 | `moneyLine`；等待人 + 链位置 + 规则；`consequenceCopy`（末人办结 / 交下一任 / 驳回整单作废） |
| 驳回必填原因 | 空原因禁用确认并 `role="alert"` |
| 执行中锁定 | `busy` + `aria-busy` |
| 持久回执 | 卡内 `data-approval-receipt` + `role="status"`；刷新后从 `wecom_card` / `reject_reason` / 状态重绘 |
| Toast 不替代 | 无 toast 成功路径 |
| 不是第二套 Home | 无今日任务 / 发现 / Pipeline |

费用发起与「审批通知」是本面附属，不是 Home 待办桶。

### 5.2 连接器使用 ≠ 治理

无启用/停用、无 `credential_ref`、无授权矩阵、无第二份 `StarryBindForm`。与 C「员工使用面」表一致。

### 5.3 知识库主路径已离开邮件模板管理台

- Tab 顺序与 ADR-021 锁定文案一致（有数据才露出中间 Tab）
- 主 CTA 不再是启用/停用/发布/隐藏
- 页头无 Codex / harness；不宣讲「发送 ≠ 改阶段」
- 「用于当前任务」只 `stashComposerFill` + 引用 + 回 Home，提示「可改后再发，不会直接发送」
- 收藏本机、预览抽屉「打开全文，不会把资料发出去」

### 5.4 考试无一键通过

无分数提交、无「标记通过」。无题卷 →「考试未就绪」。有分配但未通过 →「已分配的题卷尚未开放作答，不能在本页提交成绩」。`exam_passed === false` 只加诚实说明，不提供旁路。

### 5.5 导航坐落

员工侧栏资产簇：知识库 / 审批 / 考试 / 连接器使用面 → 各面自己的路径。进管理端只在账户菜单「管理控制台」。Settings 在账户菜单「个人设置」。符合 H §4。

---

## 6. 建议实施顺序（仍不补丁）

1. **P0-1** Settings 三条破坏性动作：L3 卡 + 原因 + 持久回执。
2. **P1-1 / P1-2** 知识库：非邮件也能用于当前任务；收敛 `/market/kb`。
3. **P1-4 / P1-6** 抹掉 Settings JWT 与考试「闸门/体验账号」。
4. **P1-3 / P1-5** 员工 KB + Settings 改核心 token 与 MASTER 主按钮。
5. **P2** 随邻近 PR 清 `docs20`、`rule_id`、行内 style、焦点阱、KB 第二滚动。

不要在本扫描的后续 PR 里夹带 Admin 枢纽、考试提交 API、检索 API 或 LIVE 连接器健康。

---

## 7. 非目标 / 未扫

- Admin：`AdminConnectors.tsx`、`AdminKnowledge.tsx`、`AdminConsole` 考试分配（只确认员工面无深链）
- Home / Chat / Pipeline / Agents
- `POST /api/exams/:id/submit` 后端是否过松（只标接线风险）
- 无障碍全量 WCAG 审计、多视口实测（本文件是法对照，不是 e2e 报告）
- 不修改 `ux-traceability.json`，不新增 UX ID
