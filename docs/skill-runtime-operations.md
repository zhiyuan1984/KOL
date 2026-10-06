# Skill Runtime 运行与迁移说明

> **2026-10-03 现状与目标区分：** 以下 `user_skill_grants` 描述的是旧代码基线，不能作为新法的生产授权设计。目标链为「Agent 组织/人员绑定 → Agent→技能装配 → 技能→资源依赖 → 风险/数据/审批闸门」；迁移前现有实现仍按旧链运行。见 [DECISIONS.md](DECISIONS.md) ADR-2026-10-03。

## 本轮状态

代码基线：`de3986f`。本轮完成受管 Worker 的 **绑定解析 → 动态 MCP 发现 → 调用时统一授权**；没有修改生产数据库、没有自动授权、没有部署或调用生产 MCP。

真实模式不再从 `TaskDefinition.mcp` 为 Worker 直连供应商。**未迁移绑定的真实任务会被拒绝，不会回退旧链路。** 管理界面已提供技能页「工具挂载」与连接器测试时的目录自动登记；其余治理表单（Agent→Skill、策略覆盖等）仍按以下 API 以已登录管理员身份调用。

## 执行链

```text
已认证用户
  → 技能授权（user_skill_grants）+ 当前 Agent-Skill 绑定
  → 技能→连接器/工具绑定 + Connector enabled + 内部门禁（工具策略/风险档/指纹）
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
| 扫描技能实现度与工具依赖 | `GET /admin/runtime/skills/coverage` | 可选 `?connector_id=`（只返回声明了该连接器工具的技能）；返回技能的定义/数字员工绑定/阶段、声明工具与每个工具的挂载状态（`mounted` / `available` / `blocked_by_policy` / `unregistered` / `unknown_connector`），全部来自运行时事实 |
| 按技能定义挂载工具 | `POST /admin/runtime/connectors/:connectorId/mount-declared` | 可选 `skill_ids`（省略＝扫描出的**已上线**技能，即已挂数字员工且已发布）；只挂 SKILL.md `mcp:` 声明里有的工具，且必须已登记并启用策略 |
| 查看资源运行配置 | `GET /admin/runtime/connectors/:connectorId/config` | 无 |
| 配置资源 | `PUT /admin/runtime/connectors/:connectorId/config` | 下述配置字段 + `expected_version`，不嵌套 `config` |
| 实时发现远端工具 | `GET /admin/runtime/connectors/:connectorId/discovery` | 无；返回工具描述/schema 及 `schema_hash`，**不自动授权** |
| 查看单工具策略 | `GET /admin/runtime/connectors/:connectorId/tools/:toolName` | 无 |
| 登记/停用工具策略 | `PUT /admin/runtime/connectors/:connectorId/tools/:toolName` | `enabled`, `risk`, `access`, `schema_hash`, `expected_version`；测试（probe）成功后平台会自动登记缺失策略并刷新指纹，本接口用于覆盖、停用与内核调整 |
| 当前用户可用技能能力 | `GET /agents/:agentId/capabilities` | 只读；按技能授权（`user_skill_grants`）说明技能级可用能力，不返回连接器/工具清单；无凭据/端点；`live_verified: false` |

解绑保存 `enabled=0` 墓碑，不读时重种。删除 Connector 会通过 FK 级联删除其 runtime 配置、资源绑定和工具策略；删除仍是需要单独审慎操作的治理动作。

### 按定义挂载（mount-declared）

启用连接器的前提是「至少一个技能把它已登记的工具挂到可用状态」（`connector_skill_binding_required`）。这条接口把技能自己的声明（`backend/skills/<id>/SKILL.md` 的 `mcp: ["<connector>.<tool>", …]`）与连接器已登记工具对齐，一次确认后批量落库：

- 目标技能：省略 `skill_ids` 时只覆盖扫描出的**已上线**技能（已挂数字员工且 `published`）；显式给出 `skill_ids` 时按给定列表处理，未知技能返回 400 `unknown_skill`。
- 只挂声明里有的工具，不扩展、不推断；每个技能先确保「技能→连接器」绑定启用，再逐条启用「技能→工具」绑定（沿用 `expected_version` 比较并交换）。
- 跳过项如实回报，不静默成功：`policy_disabled`（策略未启用，含自动登记为禁用的 L3）、`policy_unregistered`（连接器还没登记该工具，先完成一次通过的测试）、`unknown_connector`（声明了目录里不存在的连接器，例如遗留的 `starry.*`）。
- **不启用连接器、不启用工具策略**：启用仍是独立动作；重复调用幂等，第二次全部落在 `unchanged`。
- 审计：每个技能一行 `runtime.skill_mount.declared`（含 mounted / unchanged / skipped 清单）。

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

#### 凭据保险库主密钥

连接器表单里的明文密钥由服务端加密入库（AES-256-GCM），配置只保留 `cred_…` 引用。

- 变量：`RUNTIME_CREDENTIAL_MASTER_KEY`（64 位 hex 或 32 字节 base64；生成：`openssl rand -hex 32`），随部署 `.env` 提供。
- 缺失或无法使用：任何写入/读取已存密钥的调用（连接器保存、测试、工具发现、JSON 导入、真实调用）一律返回 503（`runtime_credential_master_key_unavailable` / `runtime_credential_master_key_invalid` / `runtime_credential_decryption_failed`），且不写入任何记录。
- 一经启用不要轮换：已存密文只能由同一把钥匙解密。启动时若未配置可用主密钥，服务端会打印一条警告。

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

新工具在完成一次通过的测试前不会进入目录；测试成功后平台按 07 规则自动登记缺失策略（推导规则见 [DECISIONS.md](DECISIONS.md) ADR-2026-09-28「工具风险档由平台自动推导，测试即登记」），管理员可用本接口覆盖或停用。指纹包括完整远端工具 descriptor，而非只包含输入字段；再次测试时指纹变化会被刷新登记。政策和凭据属于可信治理输入，不能由模型、Skill 内容或远端自报 `readOnlyHint` 自行授予权限。

`L3` 工具可以登记并按技能声明挂载，但永远不能直接执行：模型调用只会提出待确认动作，员工在中栏时间流里核对范围并确认后，平台重新核对授权与参数快照，只提交一次并留回执。有业务口径的写入注册专用门禁（如采集的实例锁），其余写入走通用门禁（2026-10-06，ADR-2026-10-06「写入型工具通用放行」）。发送、阶段写入、解密、导入、删除等动作另有物理风险下限（`config/connector-risk-floor.json`），管理员将其重标为 L1/L2 也仍须确认；发信与正式阶段写入没有专用门禁时不提出动作，继续走发送确认与 `confirm_stage`。默认风险档由命名家族与发布名单推导（无法判定者保守落 L2）；推导不能替代对具体工具副作用的审查，管理员应复核并按需覆盖。

## 部署顺序（本轮未执行）

1. 在隔离测试环境核对当前 Agent 发布状态、Skill 发布状态和待迁移资源，备份数据库。不要边迁移边继续使用未冻结的旧任务。
2. 安装锁文件依赖、部署代码。四张 runtime 表在首次访问时幂等创建，不自动授权。
3. 使用实际管理员身份，逐项登记经审核的 Agent→Skill、Skill→Connector 绑定。KOL 默认 Agent ID 来自现有发布 manifest，当前为 `agent:kol`。
4. 登记资源端点及凭据引用；只对已授权测试资源进行 discovery。远端认证/网络失败必须修复，不能用假工具补位。
5. 复核测试时自动登记的工具目录（风险、权限与指纹），需要时用策略接口覆盖。保留所有正式副作用的原 Gateway 路径。
6. 通过既有员工 Skill 授权 API 配置最小权限（人员授权唯一单位＝技能；连接器与工具不按人授权）。绑定不是用户授权，用户授权也不是解除停用。
7. 做 A—D 拔插验收及实际 Codex + 测试资源验收，再决定生产放行。不可仅因本地协议测试通过就标记 LIVE。
8. 若要中止，停用 Agent-Skill 绑定或 Connector；旧 handle 会拒绝新提交。撤权前已发送到远端的动作不能宣称回滚。**回退到旧代码可能恢复旧旁路，不是安全撤权方案。**

## 审计与失败

事件包含 `runtime.tools.discovered`、`runtime.tool.started`、`runtime.tool.received`、`runtime.tool.completed`、`runtime.tool.denied_or_failed` 及三种治理变更事件；测试成功后的目录登记汇总另记 `runtime.tool_catalog.registered`（created/refreshed/skipped 计数）。

调用事件包含用户、run/session、Agent/Skill、资源、工具、绑定/配置/策略版本、Skill 内容版本、工具指纹、耗时和输入输出的 SHA-256/长度摘要。不存放原始输入输出、认证头或远端异常原文。`dispatched` 区分提交前拒绝与提交后失败/撤权；收到结果后撤权会抑制结果发布，不伪装成回滚。

典型错误：`runtime_skill_unbound`、`runtime_identity_unavailable`、`runtime_connector_disabled`、`runtime_connector_not_granted`（2026-09-27 废止）、`runtime_binding_changed`、`runtime_tool_schema_changed`、`runtime_gateway_required`。远端异常按传输层证据分类为脱敏码：`runtime_remote_unauthorized`（401）、`runtime_remote_forbidden`（403）、`runtime_remote_not_found`（404）、`runtime_remote_rate_limited`（429）、`runtime_remote_rejected`（其余 4xx）、`runtime_remote_unavailable`（5xx）、`runtime_remote_timeout`（超时）、`runtime_remote_unreachable`（网络不可达）；无法分类时仍为 `runtime_remote_failed`。这些码只携带状态码或失败类别，不回显远端响应体、URL 或凭据（实现：`../backend/src/mcp/remote.ts` 的 `annotateRemoteFailure` 与 `../backend/src/runtime/execution.ts` 的 `runtimeErrorCode`）。

`runtime_connector_not_granted` 原表示「当前用户未被授权使用该连接器」。人员授权单位改为技能后（[DECISIONS.md](DECISIONS.md) ADR-2026-09-27「对外只暴露技能」），按人授权失败统一由 `runtime_skill_not_granted` 承担，技能→连接器绑定缺失由 `runtime_connector_unbound` 承担；后端不再发出该码（证据：`../backend/src/runtime/execution.ts`）。

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
