# 配置化连接器 Runtime：一期实现说明

**状态：已实现并回归验证（2026-09-26）。**

本实现把 **Skill 的 MCP / HTTP 工具调用**收敛到一个配置驱动的 Runtime 路径。新增连接器、HTTP API 或工具，不需要在 Worker / Runtime 中新增供应商判断或第三方 HTTP 调用代码。

> 本文描述的是已落地的一期执行内核和管理端闭环；不是“已将历史 Starry、KOL Claw、采集和正式动作主链全部迁移完毕”的上线宣告。

## 1. 已实现的闭环

```text
管理端连接器配置
  → 发现 MCP 工具 / 预览 OpenAPI JSON、YAML
  → 审批工具策略（Schema 指纹 + 风险 + read/write）
  → Skill 精确挂载每一个工具
  → Worker 的 skill_runtime Proxy
  → MCP Driver 或 HTTP JSON Driver
```

### 管理端

- 连接器详情新增 **运行时接入与工具治理**：
  - `protocol = mcp | http`；端点只能是 URL 或环境变量引用之一。
  - MCP 读取 `tools/list`；HTTP 可手工定义动作或预览导入 OpenAPI 3.0/3.1 的 JSON/YAML 子集。
  - 工具不是发现后自动可用：管理员需要保存每一个 Schema 指纹、风险等级、访问级别与启用状态。
  - 保存、探针、审批、Skill 挂载四个状态分离展示；HTTP 探针只验证动作定义，绝不发出业务请求。
- 技能生命周期详情新增 **工具挂载** 区：
  - 先挂载连接器，再逐项勾选已审批工具。
  - 新发现的工具不继承旧 Skill 权限。
  - 撤销单个工具会使已经发现的运行句柄在实际网络提交前失效。
- 连接器详情新增 **凭据保险库**：
  - `organization_secret` 与明确归属的 `user_account` 两种记录。
  - 秘密写入时使用 AES-256-GCM 加密，管理端和 API 只返回元数据及引用 ID。
  - `user-account` 必须精确指定 `credential_account_id`；不存在“默认账号”回退。

## 2. Runtime 契约

### MCP

配置只提供受控端点和凭据引用；Runtime 在每次发现、调用前复查：

- 当前用户、Agent→Skill、Skill→Connector、用户→Connector 授权；
- 工具策略、工具 Schema 指纹、Skill→Tool 挂载版本；
- 连接器启停、凭据引用和连接配置版本。

### HTTP JSON API

HTTP 动作被编译为和 MCP 相同的工具形状：`name`、`description` 与 JSON Schema。执行器只接受已保存的：

- `GET / POST / PUT / PATCH / DELETE`；
- 相对 Path 模板，以及受 Schema 约束的 path/query/body 映射；
- JSON 响应和可选安全 JSONPath 子集（如 `$.data.items`）。

模型不能提交 URL、任意 header、连接器 ID 或凭据。执行器会拒绝协议漂移、跨 origin、重定向、私网/metadata 地址、危险路径、过大输入/响应和未通过 Schema 校验的参数。

## 3. 凭据与出口安全

- 配置表只能保存环境变量名或 `cred_…` 引用；原始 bearer、API Key、Cookie 和 Authorization Header 会被拒绝。
- 保险库删除会检查是否仍被 Runtime 配置引用。
- 运行期对外连接使用受控 DNS 检查与 socket-lookup 检查，降低 DNS rebinding、回环、RFC1918 和云 metadata SSRF 风险。
- 远端响应、探针错误和审计只保存摘要/hash；凭据或请求 payload 不进入审计。

## 4. 公开的管理 API

| 目的 | API |
|---|---|
| 保存 / 读取连接器 Runtime 配置 | `GET/PUT /api/admin/runtime/connectors/:id/config` |
| OpenAPI JSON/YAML 预览 | `POST /api/admin/runtime/connectors/:id/import-openapi` |
| 读取、保存工具审批策略 | `GET /api/admin/runtime/connectors/:id/policies`；`PUT /tools/:toolName` |
| 测试配置与读取脱敏活动 | `POST /probe`；`GET /activity` |
| 读取、保存 Skill→Connector | `GET/PUT /api/admin/runtime/skills/:skillId/connectors/:connectorId` |
| 读取、保存 Skill→Tool | `GET /api/admin/runtime/skills/:skillId/tools`；`PUT /tools/:connectorId/:toolName` |
| 管理凭据元数据 | `GET/POST /api/admin/runtime/credentials`；`PUT/DELETE /:id` |

所有写入均采用乐观并发版本；冲突返回 `409`，管理端要求刷新并重新审阅。

## 5. 风险边界

- L1/L2 且逐工具挂载的能力，才可能被 Skill Runtime 直接暴露。
- L3 和已发布的受保护动作下限不会因为管理员把风险字段改成 L1/L2 而被 Runtime 放行。
- 高风险下限已放到受版本控制的 `config/connector-risk-floor.json` 策略资产，而不是 Runtime 内的供应商适配逻辑。

## 6. 历史链路的迁移状态

本期**没有删除或自动重写**既有的历史业务模块，例如 `backend/src/starrykol/service.ts`、`backend/src/kolclaw/service.ts`、`backend/src/crawl/service.ts` 和已有 Host/Gateway 正式动作。它们仍可能被旧工作流和测试 Stub 使用。

新的实际 Codex Worker 路径只挂载 `skill_runtime` Proxy，MCP 和 HTTP 均由本实现的通用 Runtime 驱动；不再把供应商 URL 或凭据注入 Worker box。

要达到“整个产品没有历史 Host 专用外调主链”的最终状态，需要按连接器逐个完成以下迁移并通过等价验收后再删除旧模块：

1. 在管理端保存连接实例和凭据引用；
2. 发现/导入并审批所有需用工具；
3. 在对应已发布 Skill 精确挂载工具；
4. 将旧流程的读取或编排切到该 Skill Runtime；
5. 对正式动作接入通用确认/回执执行器后，才删除旧 Host Gateway 分支。

这避免了因“迁移时静默回退到旧 URL/凭据”而出现双路径或越权调用。

## 7. 验证记录

本期已执行：

```bash
cd backend && npm run typecheck
cd backend && npm test -- tests/configurable-connectors.test.ts \
  tests/connector-credentials.test.ts tests/skill-runtime-execution.test.ts \
  tests/skill-runtime-governance.test.ts tests/connector-operations.test.ts
cd frontend && npm run typecheck && npm run build
cd frontend && E2E_MODE=stub E2E_SKIP_BUILD=1 \
  npx playwright test e2e/workbench.spec.ts \
  --grep "admin console uses a left sidebar" --project=chromium
```

专项用例覆盖 HTTP 实际调用、OpenAPI YAML 预览、逐工具撤权、个人账号精确选择、凭据不可回显、Schema 与路径校验、协议出口保护，以及真实 MCP Runtime Proxy 回归。
