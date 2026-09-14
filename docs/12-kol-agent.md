# KOL Agent 领域契约

> KOL 是本中台的**首个业务试点**（`CONSTITUTION.md` §4.2），不是平台壳。Pipeline / Home「AI发现」「我跟进的红人」属本试点域；平台任务脊柱仍是 Home「今日任务 / 我的待办」+ Chat。

## 组织和责任

组织、品牌、区域和责任关系唯一以 [`01-organization-tenancy.md`](01-organization-tenancy.md) 的 canonical ID 为准。本领域只引用其映射：`agent:kol` 的业务负责人关系是 `resp:kol_business_owner`（当前业务联系人为刘敏），执行组织是 `org:lt_team` 与 `org:pq_ro_tb_team`，品牌范围是 `brand:lt`、`brand:pq`、`brand:ro`、`brand:tb`，区域范围是 `region:eu`、`region:us`、`region:ca_au`。安培时代部门负责人按公司级政策自动拥有全部品牌、区域和普通业务数据读写范围；LT/PQ/RO/TB 是品牌，不是组织树节点；成员标签不能替代 Host scope。

## 能力域

对标 Scrumball 的五域：Strategy（品牌策略）、Discovery（发现/画像/评分）、Outreach（邮件与谈判）、Campaign Operations（合同、样品、内容和合作跟踪）、Measurement（效果和 ROI）。

## 业务对象

KOL 是外部画像；品牌、活动、负责人、阶段、价格、合同、邮件和效果属于 `Collaboration`。同一 KOL 可在不同公司、品牌或活动拥有多条独立 Collaboration；每次读写必须带公司、用户、组织、品牌和区域范围。

## 核心 Skill

`brand_strategy`、`creator_discovery`、`creator_profile`、`creator_scoring`、`email_conversation_read`、`email_compose`、`reply_analysis`、`business_approval`、`confirm_stage`、`content_review`、`campaign_tracking`、`performance_report`。

## 报价邮件闭环

打开合作会话时只做一次 Starry 摘要拉取；Codex turn 生成本阶段草稿或缺口；员工编辑；L2 预览与 L3 确认发送分离；Host Gateway 幂等提交并保存回执；发送不推进阶段；回复另起 `reply_analysis`，阶段写入另起 `confirm_stage`。

## 验收重点

覆盖跨品牌拒绝、缺邮箱/金额、草稿不发送、重复确认只发一次、MCP 超时、回执不确定、15 个正式阶段与 8 段展示、爬虫异步 Job、员工端隐藏引擎术语和管理员 Trace。
