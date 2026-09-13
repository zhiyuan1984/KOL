# FS-KOL-009 员工端状态与管理端 Trace

范围：员工端展示 queued/running/input/approval/retry/failed/done 等状态；管理端展示执行 Trace。非目标：向员工端泄漏模型、MCP 参数或密钥。

输入：Task、WorkItem、Run、Event、Artifact、ApprovalRequest、Trace。输出：当前阶段、更新时间、产物、下一步、接管入口和脱敏 Trace。

规则：BR-UX-001 等待期间必须有状态响应；BR-UX-002 失败不得显示成功；BR-AUDIT-002 管理端可追溯 thread/turn/skill/policy/MCP 版本。

实现引用：`frontend/src/agentUx.ts`、`frontend/src/api.ts`、`docs/04-ux-ui-system.md`。

验收（TEST-KOL-009）：等待、审批、失败和人工接管均可见；员工端不出现引擎术语；管理员 Trace 可定位一次外部副作用。

评价：EVAL-KOL-006、EVAL-KOL-008。
