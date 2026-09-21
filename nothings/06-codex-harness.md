# Codex harness 与 Host 执行契约

> 技术入口：`docs/technical-constitution.md`（**class J**）。本文件是 Codex / Host 执行细则；冲突时服从技术宪法，不在此重立法。

Codex harness 唯一指 Codex app-server：负责意图理解、Skill 选择、字段抽取、Workflow 编排、授权 MCP 调用、Item/草稿/建议和继续执行。Host 是平台内核：负责会话 HTTP、租户与 PEP、状态、审批、事务、幂等、超时、熔断、审计和外部副作用提交。

对于已确认的部门负责人，CONTEXT 还必须携带 `department_head_scope_policy`；其 `brand_scope` 和 `region_scope` 为 `all`，普通业务数据动作允许 `read/write`，但不得据此绕过高风险 Gateway。

## 标准流程

```text
Task → CONTEXT/权限快照 → initialize/initialized
→ skills/extraRoots/set → thread/start|resume
→ turn/start(text + Skill + schema)
→ item/tool/approval 事件 → turn/completed
→ schema/权限/版本校验 → WorkItem 持久化
```

未锁 Skill 时由 commander profile 在当前线程 fork/继续选择能力；已锁 Skill 的快捷入口只预填并锁定，不另建 Host 调度器。

## 硬边界

Host 只能否决越权、非法状态、缺审批、版本冲突、未知 Item 和重复副作用。不得复制业务目录、信件种类、缺口文案、推荐表、金额语义、Skill 选择或模型结果组合。生产读写走 Codex turn 调用授权远程 MCP；确认发送的那一次提交走 Gateway；确认阶段走 `hostConfirmStage`。

## 运行策略

低风险读取可自动执行；草稿和预览不产生外部副作用；发送、阶段、解密、导入、删除按 Policy 等待确认；失败按幂等键重试，否则进入人工接管。生产禁止 `CODEX_MODE=stub`、`runStub`、Host 直出业务结果和旁路 REST 编排。

Codex worker turns still start with `approvalPolicy: "never"` so write MCP cannot wait for a human click. Remote Starry KOL **read** tools (`pageKolProfiles`、`pageRiskConversations`、`summarizeRiskConversations` 等) may still be treated as needing approval and then fail under `never`. For L1 Starry KOL read Skills（达人库查询、风险扫描等），Host 通过已授权的 `RemoteMcpClient` 补读同一批只读工具，不代发信、不改阶段、不解密、不调用 `changeLifecycleStage`。写 Skill（写信、同步达人、改负责人/阶段、解密）在 real 模式仍保持 Codex-strict，Host 不代填。

## Stub 定义

Stub 是 CI 中可重复的测试替身，只覆盖状态机、权限、幂等、错误和回滚，不模拟真实模型质量、Skill 选择、MCP 连通或 UX。真实业务和员工端验收必须使用真实 app-server + 授权 MCP。
