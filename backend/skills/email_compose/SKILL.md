---
id: email_compose
title: 写合作邮件
description: 按发件邮箱、收件邮箱和主题生成草稿预览，确认后才发送
category: 线索
profile: lead
output: task_result
mcp: ["starry.get_collaboration", "starrykol.pageMailboxes", "starrykol.previewEmailDraft"]
required_inputs: ["mailboxEmail", "to", "subject"]
permissions: ["starrykol:write"]
actions: ["create_draft"]
aliases: ["写邮件","邮件草稿","发送测试邮件","写报价信","写报价","写报价邮件","写一份报价邮件","写一封报价邮件","写跟进","写跟进邮件","要媒体包","写谈判邮件","请确认方案","合同沟通","核对地址","催大纲","发货通知","发brief","发内容brief","初稿反馈","确认排期","确认发布排期","请开发票","核对链接","核对公开链接","首封建联","加一封","再写一封","再发一封"]
in_market: true
---
# 写合作邮件

按 **当前正式阶段** 写这一封往来，不是单独的报价技能。建联、跟进、报价、核地址、发货、催大纲都走本技能。不要向人要会话编号。

已有合作 / 本会话就是该红人时，**From / To 由 Host 锁定**，不必再从口令或嵌套 JSON 里抽：

- 发件邮箱：登录用户绑定的 Starry 邮箱；没有绑定时用 CONTEXT 合作记录的 `mailbox_from`。禁止默认第一只品牌箱子。
- 收件邮箱：当前合作 KOL 的明文邮箱（`@红人` 只是选合作）。口令里写出的收件邮箱仍可用于首封、尚未建联的场景。
- 你写 `subject` 与英文 `body`（以及 `body_zh_internal`）。把它们写成 `task_result` 的**一等字段**。禁止把 `create_draft` 整段 JSON 塞进 `sections[].body`。

首封尚未建联、CONTEXT 没有合作记录时，口令仍可写三项：`发件: a@brand 收件: b@gmail.com 主题：...`。

写法：`首封建联 发件: a@brand 收件: b@gmail.com 主题：...`；已建联会话里按阶段写，例如 `写报价邮件 @红人 100美金1小时`、`核对地址 @红人`、`发货通知 运单号 XXX`。

用 `/` 唤出本技能时，Codex app-server 先把这一封的英文草稿填进输入框；人改完（小时单价写成 USD n per hour，不要写成套餐总价）再提交。本 turn 读取该红人历史往来摘要，并带上 **本阶段这封信的要点**（契约见本文件，不是 Host 目录）。结果页是本阶段要点 + 预览 + 可改草稿，不再重复展示往来依据（与 SOP 历史邮件往来摘要重复）。结果未发送时，底部输入是对这一份的补充（只改点名的字段）；点芯片或「再写一封」才新开一封。输入框已是英文信时按该正文出草稿，不再为这一封重打预览。追问走同一 thread 的下一 turn，只改点名的字段。只有人明确「确认发送」才真正发信（Gateway，不走 Worker）。发信后刷新往来摘要，并写入左侧会话；打开会话时左侧往来只向远端拉取一次。管理员同样不能跳过确认发送。发送 ≠ 推进阶段。同一箱里「加一封 / 再写一封」沿用上一封的发件箱、收件箱和往来，重新预览后再确认发送。不要换收件邮箱。

往来记录由远端在三项齐全后自己建立。禁止默认第一只发件箱。禁止把发件箱写进红人联系邮箱。

## 禁止事项

- 禁止默认第一只发件箱。
- 禁止把发件箱写进红人联系邮箱。
- 禁止未确认发送就真正发信。
- 禁止把发送当成阶段变更。
- 管理员同样不能跳过确认发送。

## 是否发信

仅人明确「确认发送」后发信。预览不等于发送。管理员同样不能跳过。

## 是否改阶段

不改阶段。发送 ≠ 推进阶段。

## 本阶段这一封

按当前正式 `stage_code` 写这一封。芯片短名、口令、结果页要点必须一致。种类只由 **已锁本技能 + 当前正式阶段** 决定，不要用口令正则覆盖阶段。

小时单价写成 `USD n per hour`。不要默认金额。人没写数字就留缺口，不要填 USD 100。

## 已启用的邮件模板（CONTEXT）

若 `CONTEXT` JSON 的 `extra.mail_template` 存在（运营在知识库对本账号启用的已发布模板）：

- 这一封英文底稿用 `mail_template.subject` 和 `mail_template.body_en`，按 placeholders 填红人 / 金额 / 运单，不要改用 `email-templates.ts` 示例正文。
- `task_result.template_id` 用 `mail_template.template_id`。
- 信件种类、芯片、要点仍按当前正式阶段契约；换底稿不等于换阶段。
- 未启用或已对本账号隐藏的模板不要用。

## 契约（机器可读，唯一目录）

```email-compose-contract
{
  "fallback": {
    "kind": "followup",
    "chip": "写合作邮件",
    "prompt": "写合作邮件",
    "factTitle": "本封要点",
    "instruction": "按当前阶段写一封往来。发送前请人核对。发送不等于改阶段。",
    "templateId": "stage_mail.followup"
  },
  "letters": {
    "INITIAL_CONTACT": {"kind": "first_touch", "chip": "写合作邮件", "prompt": "写合作邮件", "factTitle": "建联要点", "instruction": "这是首封建联：只筛选兴趣，不代表红人已同意合作。正文简短，不要写成交或报价已定。", "templateId": "kol.first_touch"},
    "INTERESTED": {"kind": "followup", "chip": "写跟进", "prompt": "写跟进邮件", "factTitle": "跟进要点", "instruction": "对方已表示兴趣。Thank you 不能当兴趣证据。下一步是收集评估材料，不要装成已经报价。", "templateId": "stage_mail.interested"},
    "EVALUATING": {"kind": "media_kit", "chip": "要媒体包", "prompt": "要媒体包", "factTitle": "评估要点", "instruction": "请媒体包或近期数据（播放、地域、年龄）。这不是报价确认。", "templateId": "stage_mail.media_kit"},
    "QUOTE_PENDING": {"kind": "quote", "chip": "写报价邮件", "prompt": "写报价邮件", "factTitle": "报价要点", "instruction": "这是报价邮件：英文正文必须写明金额；小时单价写成 USD n per hour，不要写成套餐总价。询问或确认报价都不等于已经成交。", "templateId": "quote_confirm.v1"},
    "NEGOTIATING": {"kind": "negotiate", "chip": "写谈判邮件", "prompt": "写谈判邮件", "factTitle": "谈判要点", "instruction": "围绕费用、数量、授权和档期对齐。发送不等于方案已确认。", "templateId": "stage_mail.negotiate"},
    "PLAN_PENDING": {"kind": "plan", "chip": "请确认方案", "prompt": "请确认方案", "factTitle": "方案要点", "instruction": "please confirm 仍是待确认；confirmed / agreed 才算确认。", "templateId": "stage_mail.plan_confirm"},
    "CONTRACTING": {"kind": "contract", "chip": "合同沟通", "prompt": "合同沟通", "factTitle": "合同要点", "instruction": "合同已发送与合同已签署要分开写。", "templateId": "stage_mail.contract"},
    "SAMPLE_PENDING": {"kind": "address", "chip": "核对地址", "prompt": "核对地址", "factTitle": "寄样资料", "instruction": "核对姓名、电话、地址、国家、邮编、SKU、数量。资料不齐不要假装可以出库。", "templateId": "addr_check.collect"},
    "SHIPPED": {"kind": "ship", "chip": "发货通知", "prompt": "发货通知", "factTitle": "发货要点", "instruction": "写明运单号和承运商。发信不改阶段。", "templateId": "ship_notice.v1"},
    "TESTING": {"kind": "testing", "chip": "催大纲", "prompt": "催大纲", "factTitle": "测试要点", "instruction": "确认收货与测试，可催大纲。物流签收但红人未确认时是疑似已签收。", "templateId": "content_nudge.outline"},
    "CONTENT_PLANNING": {"kind": "brief", "chip": "发brief", "prompt": "发brief", "factTitle": "内容要点", "instruction": "确认内容方向、必提点和档期。", "templateId": "stage_mail.brief"},
    "CONTENT_REVIEW": {"kind": "review", "chip": "初稿反馈", "prompt": "初稿反馈", "factTitle": "审核要点", "instruction": "反馈修改意见。未改完仍是审核中，不是已发布。", "templateId": "stage_mail.content_review"},
    "PUBLISH_PENDING": {"kind": "schedule", "chip": "确认排期", "prompt": "确认排期", "factTitle": "排期要点", "instruction": "确认发布日期、时区和平台。Scheduled 不是 live。", "templateId": "stage_mail.publish_schedule"},
    "PUBLISHED": {"kind": "live", "chip": "核对链接", "prompt": "核对链接", "factTitle": "发布要点", "instruction": "要公开 URL。主题写 live、正文没有链接不算已发布。", "templateId": "stage_mail.publish_live"},
    "SETTLING": {"kind": "settle", "chip": "请开发票", "prompt": "请开发票", "factTitle": "结算要点", "instruction": "Invoice received 是待付款；payment sent 才是已付款。", "templateId": "stage_mail.settlement"}
  }
}
```

缺关键事实时草稿仍可出，但不能假装已经齐。结果卡 `recommended_actions`、输入框默认提示、未发送时第一颗芯片共用：

| 缺口 | 默认提示 | 建议下一步 | 点了只预填 | 锁写邮件技能 |
| --- | --- | --- | --- | --- |
| 报价无金额 | `写报价邮件 @红人 金额 [USD]` | 补上金额后再确认发送 | `把金额改成 [USD]` | 否 |
| 发货无运单 | `发货通知 @红人 运单号 [运单号]` | 补上运单号后再确认发送 | `把运单号改成 [运单号]` | 否 |
| 寄样不齐 | `核对地址 @红人` | 补全寄样资料后再确认发送 | `核对地址 @红人` | 否 |
| 已齐 | 该阶段口令 `@红人` | 核对预览后回复「确认发送」 | 确认发送 | — |

点芯片仍只预填。未发送时追问是续改这一份；「再写一封」或点阶段芯片才新开。

