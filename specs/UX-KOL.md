# KOL 员工端 UX 契约

本文件是 `docs/04-ux-ui-system.md` 的可执行实例。每个 UX ID 必须绑定 FS、红线测试和 E2E；员工端只显示业务语言。

## UX-CTX-BRAND 工作上下文

- Given 用户进入 KOL 工作台
- Then 常驻显示公司、品牌、区域、发件箱和 Agent 发布状态
- When 切换品牌或区域
- Then 清空未提交的品牌/区域相关草稿字段并要求重新确认

## UX-DEF-MAILBOX-N 禁止默认邮箱

- Given 可用邮箱多于一个且用户未明确选择
- Then 显示等待补充，不选择第一邮箱
- Given 邮箱为已移交或停用
- Then 可查看历史但禁止发送

## UX-MAIL-STATUS 邮箱状态卡

- 邮箱卡必须显示品牌、负责人、状态、授权范围和来源时间
- 已移交/停用状态必须使用业务文案说明不可发原因

## UX-TB-BIND TB 绑定失败态

- Given 本地 TB 与远程字典/邮箱品牌不一致
- Then 阻止 TB 写操作，显示绑定未就绪和管理端处理入口
- Then 禁止回退其他品牌或第一邮箱

## UX-AGENT-UNPUBLISHED Agent 未发布空态

- Given `agent:kol` 状态为 `unpublished` 或 `pilot-not-production`
- Then 员工端可展示能力说明但不可提交任务或消息
- Then 显示发布状态和下一步，不显示内部堆栈

## UX-OWNER-NOT-SKIP 负责人不能跳过高风险闸门

- 部门负责人拥有全部普通数据读写范围
- 发送、阶段、导入、解密和删除仍分别显示确认/审批卡

## UX-SEND-NE-STAGE 发送与阶段分卡

- 发送卡不得带阶段选择
- 阶段卡必须显示具体 canonical `stage_code`、展示名、前后 diff、版本和确认按钮
- 发送完成后不得隐式推进阶段

## UX-STATE-VISIBLE 状态必显

- `queued/running/waiting_input/waiting_approval/retrying/failed/manual_takeover` 必须显示业务阶段、最后更新时间、已有产物、下一步和停止/重试/接管操作
- 禁止只有 spinner 或无文案 loading

## UX-COPY-ENGINE 员工端禁词

- 员工端不得出现 MCP、Codex、Thread、Skill、原始堆栈、内部工具名
- 管理端 Trace 可以显示引擎信息，但必须脱敏

## 验收追踪

以上 ID 由 `specs/ux-traceability.json` 绑定 `FS-*`、`R-*` 和 Playwright/契约测试；缺绑定不得进入发布门禁。
