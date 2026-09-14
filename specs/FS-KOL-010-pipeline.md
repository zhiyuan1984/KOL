# FS-KOL-010 Pipeline 生命周期资产页

```yaml
id: FS-KOL-010
title: Pipeline 正式生命周期资产页
owner: 产品负责人
actors: [employee]
risk_level: L1
agent: kol
workflow: none
status: approved
```

范围：员工端 `/pipeline` 只作为合作资产页，回答「每条合作坐落在正式生命周期的哪一格」。阶段变更入口仅「提出阶段变更」，复用既有合作会话的 `confirm_stage` 确认卡。非目标：首页待办、AI 发现、审批任务、邮件/分析/风险快捷方式、新建通用 Chat 会话、LIVE 发送/阶段直写、新权限模型。

输入：`GET /api/pipeline` 已有字段（正式阶段、品牌、负责人、停留、旁路/异常侧状态、可选 `audience_geo`/`source`/`notes`/`last_skip_*`）；查询串 `brand|owner|stage|region|kol|sync`。输出：15 阶段轨道、筛选后的合作行、右侧详情抽屉、阶段变更提案（打开既有会话确认卡）。

规则：BR-PIPE-001 Pipeline 不得复制 Home 待办桶或 Chat 技能启动器；BR-PIPE-002 无 `?kol=` 时不默认选中第一名红人；BR-PIPE-003 缺近期事件/同步时间/往来摘要/审计时用诚实空态，不得伪造；BR-STAGE-004 仅既有 `confirm_stage` 可写阶段。

实现引用：`frontend/src/pages/Pipeline.tsx`、`docs/CONSTITUTION.md` 表面职责、`FS-KOL-006`。

验收（TEST-KOL-010）：资产页无「首页任务」「本页动作」芯片；无 Journey 教练条；无默认第一 KOL；点行打开抽屉；`?kol=` 深链仍打开对应详情；阶段按钮文案为「提出阶段变更」且不发起写邮件/风险扫描会话。

评价：EVAL-KOL-006。

## 目标与非目标

Pipeline 回答且只回答：正式阶段、品牌/负责人、停留、近期事件、同步来源/时间、阶段风险、允许提出的阶段变更。

禁止：需要我处理 / 等待中、AI 发现、审批任务、首页任务计数、「帮我处理今天工作」、邮件任务入口、与 Home 相同的排队/待确认等待语义、从本页为邮件/分析/风险新建会话。

## 筛选与动作

| 允许 | 说明 |
|---|---|
| 筛选 | `brand`、`owner`、`stage`、`region`（现有 `audience_geo`）、`kol`、`sync`（现有 `source`）；旁路/异常是生命周期侧状态，不是首页「等待中」 |
| 动作 | 「提出阶段变更」→ 打开既有合作会话阶段 UI → 人确认 → 既有审批/写入 |
| 空态 | 接口未返回的近期事件、同步时间、往来摘要、阶段证据、审计：写「本页未返回」或省略 |

## Given / When / Then

```gherkin
Given 员工打开 /pipeline 且 URL 无 kol
Then 不选中任何红人，不打开详情抽屉
And 不见首页任务芯片、本页动作伪芯片、Journey 教练条

Given 员工点击一名红人
Then 右侧打开生命周期详情抽屉
And 可见正式阶段、品牌/负责人、停留；缺字段为空态
And 唯一主动作是「提出阶段变更」

Given 员工点击「提出阶段变更」
Then 打开该合作已有会话的 confirm_stage 确认卡
And 不新建邮件/分析/风险会话，不在本页 LIVE 写阶段
```
