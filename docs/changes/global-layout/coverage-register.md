# 全局布局实施登记

基线 c6a8cb37。状态以最终报告为准；这里列结构迁移，不代替真实用户任务或生产能力验证。

## 实际路由基线

- `/`
- `/work`
- `/s/:id`
- `/tasks`
- `/tasks/:taskId`
- `/leads`
- `/cooperations`
- `/pipeline`
- `/cron`
- `/cron/:jobId`
- `/mail`
- `/skills`
- `/agents/:id`
- `/agents`
- `/teams`
- `/kb`
- `/market/skills`
- `/partners`
- `/market/kb`
- `/exam/:assignmentId`
- `/exam`
- `/approvals/:id`
- `/approvals/legacy`
- `/reviews/:id`
- `/approvals`
- `/admin/approval-types/legacy`
- `/admin/approval-types`
- `/settings`
- `/admin/*`
- `/share/:token`
- `*`


## 本批组件入口

| 页面组件 | 结构处理 |
|---|---|
| AccountSettings.tsx | 共享模式已接入 |
| Tasks.tsx | 共享模式已接入 |
| Mail.tsx | 共享模式已接入 |
| Leads.tsx | 共享模式已接入 |
| Cooperations.tsx | 共享模式已接入 |
| Knowledge.tsx | 共享模式已接入 |
| Approvals.tsx | 共享模式已接入 |
| Reviews.tsx | 既有表格/子组件保留 |
| AdminConsole.tsx | 既有表格/子组件保留 |
| AdminAgents.tsx | 共享模式已接入 |
| AdminWorkOrders.tsx | 共享模式已接入 |
| AdminOntology.tsx | 共享模式已接入 |

个人设置六类由SettingsPanels、StarryBindForm、MemorySettings、PrivacySettings接入；人员目录卡保留成熟紧凑结构；EmployeeDirectoryV2绑定详情及EmployeeEditDialog接入。

## 保留/未迁移

Home/Chat协作工作区、发现、公海、我跟进、Pipeline、定时任务、数字员工/技能浏览、考试、运营报表、调度监控、成本、管理知识生命周期/动态审批表单、连接器向导继续用其专业组件；本批不强压布局。连接器配置已采用局部横向标签，正文/headers/动态动作JSON为复杂例外。没有新建组织/品牌/区域维护页面；这些引用在本体/组织/偏好入口保持现行职责。非本批接口未进行全站安全审计。

实际迁移细节与例外见九份migration-*.md；这些代理报告的本地缺node_modules为初步状态，最终真实类型及浏览器门禁以后续主任务日志为准。
