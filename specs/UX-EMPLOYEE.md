# 员工端 UX 契约（从宪法派生）

本文件只由 [`docs/CONSTITUTION.md`](../docs/CONSTITUTION.md) **§4–5** 派生（一等能力与试点元条款见 ADR-023；能力主权 / 使用≠治理见 ADR-015）。位阶低于宪法，不得发明新的平台法。

已删除、不得复活：`UX-KOL.md`、`UX-FOLLOWED-KOL-CARD.md`、`docs/04-ux-ui-system.md`、`docs/19-ui-ux-constitution.md`、`docs/employee-surface-contracts.md`、`FS-KOL-006`、`FS-KOL-010`、ADR-018、ADR-022、全部 `docs/evidence-*`。不恢复排序键表、四带教条、字段黑名单、强制 CTA 文案。

发布门禁只认下列硬不变量 ID（见 [`specs/ux-traceability.json`](ux-traceability.json)）。阶段写入与 Pipeline 表面以宪法 + `policies/change_stage.yaml` 为准，不另开 FS。

## 权威顺序（高 → 低）

1. `docs/CONSTITUTION.md`（§4.1–4.3；§5 L1–L3；发送 ≠ 推进阶段；表面职责）
2. ADR-023 / ADR-015 / ADR-030 / ADR-032（若仍在 `DECISIONS.md`）
3. `docs/ia-information-architecture.md`（IA：一页一问 / 导航密度 / 使用 ≠ 治理原则）
4. `docs/org-permissions.md`（管理端配套套件细则）
5. `docs/design.md`（视觉入口）→ `docs/design-system/kol-workbench/MASTER.md`（token only）

## L1–L3（摘录宪法，不改写）

宪法 §2 / §5：

> L1：只读查询，可直接执行并展示来源或证据。
> L2：生成草稿或可撤销变更，必须明确标注“草稿/暂存”。
> L3：外发、导入正式资产、删除、解密等高影响动作，执行前必须展示对象、范围与后果并确认。
> 外部系统写入、正式业务资产变更……必须完成“触发 → 确认 → 执行中 → 持久回执/部分成功/失败 → 恢复动作”闭环。Toast 只能辅助提示，不能替代业务回执。

正式阶段写入属于正式业务资产变更，走同一 L3 闭环。拒绝必须填写原因（与确认相对的关闭路径）。

## SEND_NE_STAGE 发送 ≠ 推进阶段

宪法 §3 / §4.2：

> `发送`、`暂存`、`导入`、`解密`、`删除`是不同副作用，必须使用独立动作和状态，不得相互暗示已经完成。
> 发送 ≠ 推进阶段与 L1–L3 不变。

派生：发送卡不得带阶段选择器；阶段写入必须给出具体 `stage_code`（及展示名），禁止用「下一阶段」代替目标。

```gherkin
Given 员工打开发送确认卡
Then 卡上没有阶段选择器
And 确认发送不得隐式改写 stage_code

Given 员工确认正式阶段写入
Then 卡上展示具体 stage_code
And 不得用「下一阶段」代替目标
```

## L3_CONFIRM 高影响写前确认

```gherkin
Given 员工触发外发、正式资产导入、删除、解密或正式阶段写入
Then 执行前展示对象、范围与后果
And 确认后才执行，并留下持久回执（Toast 不能替代）
And 拒绝必须填写原因
```

## Home 与 KOL 试点表面（§4.2 派生，一段）

宪法 §4.1–4.3：Home「今日任务 / 我的待办」+ Chat 是平台任务脊柱；Home「AI发现」「我跟进的红人」与 Pipeline 是 KOL 试点特化，不是中台壳。员工表面唯一交互范式是助理优先（ADR-032）：用户说意图 → 助理组织对象 → 优先卡 / 折叠分组 → 下一步。不是第二套会话，也不是列表为主 + AI 叠加。

KOL 试点 Home 模式名（只点名，不立法微 IA）：

```text
今日任务 | 我的待办 | AI发现 | 我跟进的红人
```

前两项是平台任务；后两项是试点挂件。「我跟进的红人」是 Collaboration 对象跟进面，不是第二套 Pipeline 正式资产板，也不是第二套今日任务/我的待办。对象管理可以表现为助理结果（会话脊柱 + 对象卡）；Composer 是页控件。「Home ≠ Chat」只禁止再做一套带独立任务脊柱的完整 Chat 工作台，不禁止该模式的助理线程 UX。Pipeline **页**可深链或经产品内 CTA 到达，不要求出现在默认侧栏，也不得复制 Home 待办 IA。对象面**耐久**主筛/分组不在本契约立法。优先跟进 / 等待 / 拒绝只许作为一次回答内的情境分区，不是耐久 Tab。

仍禁止：助理话语自动写 `stage_code`；同一视口多个实底主 CTA；只用颜色表达状态；未定义的「处理」在无 L3 时写入 `REJECTED`；把任务状态 owner tabs 复活成主 IA。准备回复 = L2；阶段进入 = L3。

```gherkin
Given 员工打开 Home「我跟进的红人」
Then 该表面以已跟进对象为组织单位
And 主信息架构既不是任务状态导航，也不是 15 段正式阶段板
And 对象管理可以表现为助理结果而不是 ERP 列表
And Pipeline 不是第二套 Home，也不是必挂侧栏
And 助理话语不得自动改写 stage_code
```

## 员工禁词（原则）

宪法把产品做成任务/结果工作台，不是引擎说明书。员工表面不摊 MCP、Codex、Thread、英文 Skill 时序、原始堆栈。产品名词「技能」是 §4.1 一等能力，与引擎词分家（ADR-023）。
