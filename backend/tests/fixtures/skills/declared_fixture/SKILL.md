---
id: declared_fixture
title: 声明挂载夹具
description: 用例夹具：同时声明可挂载、策略禁用、未登记与遗留连接器的工具，覆盖四种挂载状态
category: 线索
profile: lead
output: task_result
mcp: ["starrykol.pageKolProfiles", "starrykol.previewEmailDraft", "starrykol.decryptKolContact", "starrykol.pageMailboxes", "starry.get_collaboration"]
required_inputs: []
permissions: []
actions: ["analyze"]
aliases: ["声明挂载夹具"]
in_market: true
---
# 声明挂载夹具 declared_fixture · Lead

用例夹具：只被覆盖率与声明挂载用例复制到临时 published-skills 目录使用，不执行任何外部动作。
`starrykol.decryptKolContact` 按发布名单是 L3（策略默认禁用），`starry.get_collaboration` 指向目录里不存在的遗留连接器。
