# Skill Runtime 运行与迁移说明

## 本轮状态

代码基线：`de3986f`。本轮完成受管 Worker 的 **绑定解析 → 动态 MCP 发现 → 调用时统一授权**；没有修改生产数据库、没有自动授权、没有部署或调用生产 MCP。

真实模式不再从 `TaskDefinition.mcp` 为 Worker 直连供应商。**未迁移绑定的真实任务会被拒绝，不会回退旧链路。** 管理界面尚未提供这些新治理表单，当前通过已有登录身份调用以下 API。

## 执行链

```text
已认证用户
  → 当前 Agent-Skill 绑定 + 用户 Skill 权限
  → 当前 Skill-Connector 绑定 + Connector enabled + 用户资源权限
  → 远端 tools/list（全部分页，逐次刷新）
  → 已审查的工具元数据/schema 指纹、L1/L2 风险策略
  → 本次运行专属的 localhost MCP 代理
  → 唯一 Codex app-server 按真实描述/schema 选择工具
  → 每次调用重新授权 + 再发现并验证 schema + 校验参数
  → 远端 tools/call
  → 回传前再次授权 + 脱敏审计
```

- 工具外部名称使用 `rt_<hash>` 避免同名冲突；审计同时保留真实 Connector ID 和远端工具名。
- 代理令牌仅用于本次运行，绑定 `127.0.0.1`；拒绝其他令牌、浏览器 Origin 和非本地 Host。
- 每次执行使用新 thread 和隔离 `CODEX_HOME`，不会恢复旧 thread 的 MCP 配置。已有模型/供应商配置按白名单继承，已有模型登录文件复制到权限受限的临时目录；旧 MCP、插件、信任配置不继承。原模型登录文件不被覆盖。
- 只使用 Host 本轮传入的授权上下文。依赖历史 thread 隐式上下文的业务，需要在 UAT 中确认其 Host context pack 完整性。
- 已登记连接器的秘密环境变量不继承给 Codex；供应商凭据由 Host 按配置引用解析。
- 真实结果缺失时不再由 Host 固定调用 `pageKolProfiles` 等工具回填。stub 保留明确的本地测试行为。

## 治理接口

以下路径均以 `/api` 开头，管理接口要求管理员已登录。生产关闭认证时这些新治理接口拒绝访问。`expected_version` 必填：**0 只表示尚不存在，初建返回 1，此后每次更新加 1。** 重复首建、旧版本写入返回 409。

| 操作 | 方法与路径 | 请求字段 |
|---|---|---|
| 查看 Agent 的 Skill 绑定 | `GET /admin/runtime/agents/:agentId/skills` | 无 |
| 绑定/解绑 Skill | `PUT /admin/runtime/agents/:agentId/skills/:skillId` | `enabled`, `expected_version` |
| 查看 Skill 的资源绑定 | `GET /admin/runtime/skills/:skillId/connectors` | 无 |
| 绑定/解绑资源 | `PUT /admin/runtime/skills/:skillId/connectors/:connectorId` | `enabled`, `expected_version` |
| 查看资源运行配置 | `GET /admin/runtime/connectors/:connectorId/config` | 无 |
| 配置资源 | `PUT /admin/runtime/connectors/:connectorId/config` | 下述配置字段 + `expected_version`，不嵌套 `config` |
| 实时发现远端工具 | `GET /admin/runtime/connectors/:connectorId/discovery` | 无；返回工具描述/schema 及 `schema_hash`，**不自动授权** |
| 查看单工具策略 | `GET /admin/runtime/connectors/:connectorId/tools/:toolName` | 无 |
| 登记/停用工具策略 | `PUT /admin/runtime/connectors/:connectorId/tools/:toolName` | `enabled`, `risk`, `access`, `schema_hash`, `expected_version` |
| 当前用户可用能力说明 | `GET /agents/:agentId/capabilities` | 只读；无凭据/端点；`live_verified: false` |

解绑保存 `enabled=0` 墓碑，不读时重种。删除 Connector 会通过 FK 级联删除其 runtime 配置、资源绑定和工具策略；删除仍是需要单独审慎操作的治理动作。

### 资源配置

只支持 Streamable HTTP MCP。本轮不支持 stdio、OpenAPI、API Skill/script 的通用执行注册。

```json
{
  "url_env": "PROFILE_MCP_URL",
  "headers_env": { "X-MCP-API-KEY": "PROFILE_MCP_API_KEY" },
  "credential_provider": "starry-user",
  "timeout_ms": 30000,
  "expected_version": 0
}
```

- `url` / `url_env` 恰好一个；URL 只允许 HTTP(S)，禁止 userinfo、query、fragment，展开环境变量时再次校验。生产应使用 TLS 或可信的受保护网络。
- `headers_env` 是 Header 名 → 环境变量名，不是 Header 原值。
- `bearer_env` 可指定 Bearer token 的环境变量名。
- `starry-user` 仅为现有个人凭据适配器：每次读取**本次执行用户**的已连接 Starry 绑定。没有有效个人绑定时拒绝，不能回退管理员全局 JWT。
- 普通替换资源可直接使用 endpoint + 环境变量引用，不需要新增供应商分支。增加新的个人凭据协议适配器仍需要登记适配器，不等于工具名白名单。
- 无认证的本地/公开 MCP 必须显式设置 `allow_unauthenticated: true`。
- 不允许把密码、原始 Authorization、Key、Bearer 或任意新字段提交到配置 API。进程环境配置由已有部署机制管理。
- 重定向拒绝，避免凭据被转发到另一个地址。

### 工具政策

```json
{
  "enabled": true,
  "risk": "L1",
  "access": "read",
  "schema_hash": "从 discovery 返回的完整 64 位指纹复制",
  "expected_version": 0
}
```

该示例中的指纹文字是说明，不是可提交的有效值。请读取实际 discovery 响应后登记。

新工具和任何元数据/schema 变更默认不执行。指纹包括完整远端工具 descriptor，而非只包含输入字段；名称、描述、annotations、outputSchema 等变化需要重新审查。政策和凭据属于可信治理输入，不能由模型、Skill 内容或远端自报 `readOnlyHint` 自行授予权限。

`L3` 可以登记，但不进入 Worker 工具目录且不能直接执行。发送、阶段写入、解密、导入、删除等已知 Host 专属动作另有物理风险下限，管理员将其重标为 L1/L2 也不会进入代理。新工具必须如实分类；运行时不会声称能够从任意工具名称自动证明没有副作用。

## 部署顺序（本轮未执行）

1. 在隔离测试环境核对当前 Agent 发布状态、Skill 发布状态和待迁移资源，备份数据库。不要边迁移边继续使用未冻结的旧任务。
2. 安装锁文件依赖、部署代码。四张 runtime 表在首次访问时幂等创建，不自动授权。
3. 使用实际管理员身份，逐项登记经审核的 Agent→Skill、Skill→Connector 绑定。KOL 默认 Agent ID 来自现有发布 manifest，当前为 `agent:kol`。
4. 登记资源端点及凭据引用；只对已授权测试资源进行 discovery。远端认证/网络失败必须修复，不能用假工具补位。
5. 审查所需工具的真实描述/schema，登记风险、权限与指纹。保留所有正式副作用的原 Gateway 路径。
6. 通过既有员工 Skill/Connector 授权 API 配置最小权限。绑定不是用户授权，用户授权也不是解除停用。
7. 做 A—D 拔插验收及实际 Codex + 测试资源验收，再决定生产放行。不可仅因本地协议测试通过就标记 LIVE。
8. 若要中止，停用 Agent-Skill 绑定或 Connector；旧 handle 会拒绝新提交。撤权前已发送到远端的动作不能宣称回滚。**回退到旧代码可能恢复旧旁路，不是安全撤权方案。**

## 审计与失败

事件包含 `runtime.tools.discovered`、`runtime.tool.started`、`runtime.tool.received`、`runtime.tool.completed`、`runtime.tool.denied_or_failed` 及三种治理变更事件。

调用事件包含用户、run/session、Agent/Skill、资源、工具、绑定/配置/策略版本、Skill 内容版本、工具指纹、耗时和输入输出的 SHA-256/长度摘要。不存放原始输入输出、认证头或远端异常原文。`dispatched` 区分提交前拒绝与提交后失败/撤权；收到结果后撤权会抑制结果发布，不伪装成回滚。

典型错误：`runtime_skill_unbound`、`runtime_identity_unavailable`、`runtime_connector_disabled`、`runtime_connector_not_granted`、`runtime_binding_changed`、`runtime_tool_schema_changed`、`runtime_gateway_required`。未知远端异常统一脱敏为 `runtime_remote_failed`。

## 验证与范围

本地验证命令：

```bash
cd backend
npm ci
npm run typecheck
npm test -- tests/skill-runtime-execution.test.ts tests/skill-runtime-governance.test.ts tests/remote-mcp-discovery.test.ts tests/async-worker.test.ts tests/codex.test.ts tests/starrykol-read-never.test.ts
npm run validate:contracts
# 全量测试还引用前端组件，因此先在 frontend 执行 npm ci
npm test
```

本轮本地测试覆盖：A 多资源/重名、B 解绑/停用/撤权、C 换资源和工具名、D 动态新增/政策授权、用户隔离、管理员边界、L3、schema/描述变更、参数校验、调用中撤权、脱敏审计、代理令牌/Origin/关闭、版本冲突、能力说明，以及 **真实 Worker → fake-Codex 协议进程 → 真实 localhost MCP 协议 → 本地 fixture**。最后一条仍不是实际模型推理，也不是生产 MCP 验证。

尚未覆盖/未承诺：生产部署与真实模型质量；全部八项业务端到端验收；所有旧专用采集、审批和业务适配链的统一迁移；多租户数据模型重构；所有旧 Skill SOP 的供应商名称清理；管理 UI；基于远端通知的持续目录订阅（当前逐次刷新）。
