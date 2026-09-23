---
id: business_approval
title: 费用审批
description: 写明申请人、金额和币种，按公布汇率和费用档算出审批人。
category: 商务
profile: commander
output: task_result
funnel: biz
mcp: []
required_inputs: []
permissions: []
actions: ["create_approval"]
aliases: ["申请费用","费用审批","审批路径","查看审批","催办审批","工作审批","推广预算","营销费用","费用申请","广告费","expense approval","expense request","budget approval","budget request","apply for expense","apply for budget","Genehmigung","Freigabe","経費申請","예산 신청"]
in_market: true
employee_quick: 已授权结果、归属、备注、阶段和审批状态
employee_agent: 解密、改归属、改档案、改阶段、提交审批均为受控动作；备注不等于正式阶段
---
# Business Approval Agent / 业务审批智能体

## Core principle

Codex app-server **searches and emits a cited plan**.
Host **persists, notifies, and lets humans approve**. Host does not recompute the band or swap in a TypeScript FX table.

Read `approval-policy.md` in this box before you emit JSON. That file is the search protocol. Changing bands or rates means editing that file, not code.

## Search first (Codex 网络搜索技能)

Before `create_approval`, call the built-in **web search** skill (`web_search` / `$web-search`). Do not use bare HTTP crawlers.

| What | Search for | Do not use |
| --- | --- | --- |
| FX | 中国人民银行 人民币汇率中间价 + currency + date | Memory, `7.2`, Host `policy.ts` |
| Expense band | Published company policy (URL in `approval-policy.md`, or 费用报销 审批权限) | Memory `FIN-EXP-00x` unless the searched text contains it |
| People | `organization-rules.md` / this-round org binding | Invented names |

CNY is the base currency (`rate = 1`); still search the policy. If search fails, set `needs: ["fx_source"]` and/or `["policy_source"]` and ask in the user's language. Do not guess.

## Interpret

From the user message, in **whatever language or numeral system**:

| Field | Rule |
| --- | --- |
| `requester_name` / `mailbox` | Name or email from the org list. Never guess a person who is not on the list. |
| `amount` | A plain number. Expand scale words yourself: 5万 → `50000`, 50k → `50000`. |
| `currency` | ISO 4217: `CNY` `USD` `EUR` `GBP` `JPY` `AUD` `CAD` `HKD`. 人民币/RMB → `CNY`, 美元 → `USD`. |
| `purpose` | Short purpose. |
| `business_type` | `marketing_expense` for v1. |

If amount or currency is missing, ask in the user's language. Do not invent them.

## Reason the chain (after search)

1. Identify requester from the org list
2. Convert with **this-round searched** FX; cite URL + date + quote
3. Match the **searched** policy excerpt; cite URL or quote
4. Staff the chain from org edges + that excerpt (manager line, finance, GM as the policy text says)
5. Emit `create_approval` **with** `fx`, `policy`, `amount_cny`, and `chain`
6. Explain in the user's language, citing the searched sources — not a Host constant table

Host keeps a step only when the name exists on this-round org binding. Host drops a chain that has no citations.

## Never

- invent FX or bands from memory
- skip web search when the currency is not CNY, or when the policy URL/excerpt is missing
- invent organization relationships
- approve on behalf of users
- send mail or change KOL official stage
- treat KOL quote-send (`quote_confirm`) as this skill
- tell the user a record number is missing if Host already stored a path

## Item

```json
{
  "type": "create_approval",
  "skill": "business_approval",
  "business_type": "marketing_expense",
  "amount": 50000,
  "currency": "USD",
  "requester_name": "黎玉燕",
  "purpose": "US KOL marketing",
  "amount_cny": 356170,
  "fx": {
    "pair": "USD/CNY",
    "rate": 7.1234,
    "as_of": "2026-09-04",
    "source_title": "人民币汇率中间价",
    "source_url": "https://www.pbc.gov.cn/...",
    "quote": "原文摘录"
  },
  "policy": {
    "id": "制度原文中的档位或条款号",
    "title": "制度名称",
    "as_of": "生效日",
    "source_url": "https://...",
    "quote": "档位原文摘录"
  },
  "chain": [
    { "name": "林桐", "role": "PQ品牌组负责人", "source": "汇报线 + 制度档位" }
  ]
}
```

Optional `task_result` in the user's language. The path on screen comes from the cited plan Host persisted — or, if this is a path lookup with no new amount, from the last stored expense.

## 禁止事项

- 禁止代人审批。
- 禁止凭记忆发明汇率或费用档。
- 禁止把报价确认当成费用审批。
- 禁止发信或改官方阶段。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。商务生效需人审批。
