---
id: creator_library_query
title: 达人库查询
description: 按关键词、合作阶段和风险标签分页查询红人库
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: ["starrykol.pageKolProfiles", "starrykol.getKolProfileSidebarMetrics"]
required_inputs: []
input_schema: [{"key":"keyword","label":"关键词","kind":"text","required":false,"reason":"可留空；按当前授权范围查询。","prefill":"entities.keyword"},{"key":"stage_codes","label":"合作阶段","kind":"text","required":false,"reason":"可填写阶段名称或已知代码；多项用逗号分隔。","prefill":"entities.stageCodes"},{"key":"risk_tag_codes","label":"风险标签","kind":"text","required":false,"reason":"可填写风险标签；多项用逗号分隔。","prefill":"entities.riskTagCodes"},{"key":"page_no","label":"页码","kind":"number","required":false,"default":1,"min":1,"integer":true,"prefill":"entities.pageNo"},{"key":"page_size","label":"每页数量","kind":"number","required":false,"default":20,"min":1,"max":50,"integer":true,"prefill":"entities.pageSize"}]
interaction: {"purpose":"在你有权限访问的达人库中，按关键词、合作阶段和风险标签筛选达人，分页查看档案及负责人信息。","steps":["确认本次筛选条件；未填写条件时查询授权范围内的第一页。","读取符合条件的达人档案，必要时补充统计信息。","在结果区展示匹配达人、分页信息与来源；无匹配或读取失败时说明原因。"],"output_title":"达人列表、分页信息与来源说明","constraints":["关键词和筛选条件均为可选项。","本技能只读，不发信、不更改合作阶段、不解密联系方式。"]}
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["查询达人库","达人筛选"]
in_market: true
employee_quick: 授权档案、画像、筛选与已有摘要
employee_agent: 新画像分析、补查新事实走 AI 助理或已配置同步
---
# 达人库查询

## 触发与边界

当用户要求“达人库查询”“查询达人库”“按条件筛选已有达人”时选用本技能；用户已显式选中技能时保持该选择，不因输入只有参数而切换技能。发现/采集新达人、重新评分、解密联系方式及更新档案不属于本技能。

`interaction` 是知识库给人的功能模板，`input_schema` 是双方共用的参数契约。模板说明不是执行结果；不要将占位符、字段提示或整段功能说明当成搜索关键词。执行逻辑以下文为准，仍须遵守 Host 的授权与工具白名单。

## 输入

- 无必填参数，不能因为没有关键词阻塞执行或反复追问。
- `keyword`：关键词，可留空。
- `stage_codes` / `risk_tag_codes`：可选合作阶段、风险标签。Host 分别映射到 `entities.stageCodes` / `entities.riskTagCodes`；读取名称需由已授权上下文中的字典解释，无法映射时明确请用户修正，不编造代码。
- `page_no` / `page_size`：映射到 `pageNo` / `pageSize`，默认 1 / 20，每页最多 50；页码、数量必须为正整数。
- 复用当前任务提供的有效参数；用户明确填写优先于抽取值与默认值。不要扩大 Host 注入的可见范围。

## 执行步骤

1. 校验上述参数与当前授权范围。空条件使用默认分页；缺少可选条件不是失败。
2. 在本 Skill 的 Codex app-server turn 中调用 Starry KOL MCP `pageKolProfiles`，按工具 schema 传入筛选及分页参数；需要统计时才调用 `getKolProfileSidebarMetrics`。禁止裸 HTTP 或未经授权的替代数据源。
3. 从真实工具回执生成 `task_result`，区分有效空结果与工具失败。失败返回真实原因及重试建议，禁止输出伪造达人或一直保持“正在查询”。

## 输出

使用现有 `task_result` 契约，展示查询条件、匹配达人、返回的总数/分页信息与数据来源。列表按实际返回字段呈现昵称/标识、平台、阶段、风险标签及负责人；未知字段留空或标记未提供，不臆测总数。结果在右栏展示，中栏说明必要的缺失信息、结论与下一步，不重复粘贴工具 JSON。

## 禁止事项

- 不发信；不修改官方阶段、档案或负责人。
- 不调用 `decryptKolContact`，不擅自解密联系方式。
- 不把“未命中”说成服务失败，不把服务失败说成零条记录。
