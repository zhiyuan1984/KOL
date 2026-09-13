# email-agent MCP

进程内 Spring AI MCP Server，把 `apifox/email-agent-openapi.yaml` 清单里的接口（**不含 Nylas webhook**）包装成 62 个 `@Tool`。含 **红人数据库**、邮件会话、邮箱、Nylas、合作阶段。

YAML 只作对照清单，运行时不读取。

| 项 | 值 |
|----|-----|
| 客户端名字 | `email-agent` |
| 服务名 | `email-agent-mcp` `1.0.0` |
| 协议 | Streamable HTTP，`POST /mcp` |
| 本机 | `http://localhost:9091/mcp` |
| 测试机 | `http://47.251.65.112:9091/mcp` |
| Header | `X-MCP-API-KEY: email-agent-mcp-dev` |
| 生产 Key | 环境变量 `EMAIL_AGENT_MCP_API_KEY` |

网关 `https://dev-api.askstarry.com/starry/email-agent` 的 `/mcp` 未放行时会 503，客户端请直连本机或测试机。不要填 `/sse` 或 `/mcp/message`。

实现细节与开关见 [`email-agent/MCP.md`](email-agent/MCP.md)。

## 客户端配置

测试机：

```json
{
  "mcpServers": {
    "email-agent": {
      "url": "http://47.251.65.112:9091/mcp",
      "headers": {
        "X-MCP-API-KEY": "email-agent-mcp-dev"
      }
    }
  }
}
```

本机把 URL 换成 `http://localhost:9091/mcp`。  
Manus 选 **MCP / HTTP**，`Accept` 需同时带 `application/json` 和 `text/event-stream`。

## 开关

| 配置 | 默认 | 说明 |
|------|------|------|
| `email.mcp.enabled` | true | 关闭后不注册 Tool，也不启动 MCP 端点 |
| `email.mcp.write-enabled` | true | false 时拒绝 add / update / del / send |
| `email.mcp.auth.enabled` | true | 是否校验 `X-MCP-API-KEY` |
| `email.mcp.operator.user-id` | `mcp-operator` | Tool 调用时注入的服务账号 |

REST `/api/**` 仍走 JWT。这 62 个 Tool **不会**进入站内 `ChatClient`。

## Tool 清单（62）

复杂请求体用 **JSON 字符串**，字段与现有 DTO 一致。导入用 `fileName` + `fileBase64`。  
不包装：`POST /api/integrations/nylas/webhook`。

### 红人画像（红人数据库）— `KolProfileMcpTools`

| Tool | 说明 |
|------|------|
| `pageKolProfiles` | 画像分页 |
| `getKolProfileDetail` | 按 `kolUid` 详情 |
| `getKolProfileSidebarMetrics` | 红人 / 阶段 / 风险会话数量 |
| `listAllKolProfiles` | 全量白名单字段 |
| `addKolProfile` | 新增 |
| `updateKolProfile` | 更新 |
| `deleteKolProfile` | 删除 |
| `listKolPlatformData` | 平台账号列表 |
| `deleteKolPlatformData` | 删除平台账号 |
| `decryptKolContact` | 解密联系方式 |

### 红人导入 — `KolProfileImportMcpTools`

| Tool | 说明 |
|------|------|
| `downloadKolProfileImportTemplateV2` | 下载模板（文件名 + Base64） |
| `importKolProfilesFromCrawler` | 爬虫 CSV/Excel 导入 |
| `importKolProfilesV2` | 标准模板导入 |

### 字典 — `DictionaryMcpTools`

| Tool | 说明 |
|------|------|
| `listDictionaryOptions` | 通用字典：`kol_primary_platform`、`kol_email_ai_language`、`kol_niche`、`kol_follow_style`、`kol_risk_tag` |

### 阶段 / 风险配置 — `KolConfigMcpTools`

| Tool | 说明 |
|------|------|
| `listCooperationStageOptions` | 合作阶段下拉 |
| `listRiskTagOptions` | 风险标签下拉 |
| `getStageRiskMatrix` | 阶段-风险矩阵 |
| `updateRiskDefinition` | 更新风险定义 |
| `previewDefaultStageRules` | 预览某阶段默认规则 |
| `previewDefaultAllStageRules` | 预览全部默认规则 |
| `batchSaveRiskRules` | 批量保存风险规则 |

### 合作生命周期 — `LifecycleMcpTools`

| Tool | 说明 |
|------|------|
| `pageLifecycleKanban` | 看板分页 |
| `pageRiskConversations` | 风险会话分页 |
| `summarizeRiskConversations` | 风险会话统计 |
| `changeLifecycleStage` | 改合作阶段 |
| `changeLifecycleRiskTag` | 改风险标签 |

### 邮箱权限 — `MailboxPermissionMcpTools`

| Tool | 说明 |
|------|------|
| `pageMailboxes` | 邮箱分页 |
| `listMailboxOwnerOptions` | 负责人下拉 |
| `getMailboxDetail` | 邮箱详情 |
| `addMailbox` | 新增邮箱 |
| `batchSaveMailboxes` | 批量保存 |
| `deleteMailbox` | 删除邮箱 |
| `getMailboxPermissions` | 权限明细 |
| `saveMailboxPermissions` | 保存权限 |

### Nylas 账号 — `NylasAccountMcpTools`

| Tool | 说明 |
|------|------|
| `upsertNylasAccount` | 新增或更新映射 |
| `listNylasAccounts` | 账号列表 |
| `syncNylasGrants` | 同步 grants |
| `setNylasAccountEnabled` | 启用 / 停用 |
| `getNylasMessageTracking` | 消息追踪状态 |

### 历史同步 — `HistorySyncMcpTools`

| Tool | 说明 |
|------|------|
| `listHistorySyncMailboxes` | 可同步邮箱 |
| `addHistorySync` | 创建异步同步任务 |
| `runHistorySync` | 同步导入（阻塞至终态） |
| `getHistorySyncDetail` | 批次详情 |
| `pageHistorySync` | 批次分页 |
| `cancelHistorySync` | 取消批次 |
| `retryHistorySync` | 重试失败批次 |
| `reRecognizeHistorySyncStages` | 按批次重跑阶段识别 |
| `startMailboxMessageStats` | 启动消息统计 |
| `getMailboxMessageStatsDetail` | 统计任务详情 |

### 邮件助手 — `KolEmailMcpTools`

| Tool | 说明 |
|------|------|
| `createEmailConversation` | 创建会话 |
| `pageEmailConversations` | 会话分页 |
| `getEmailConversation` | 会话详情 |
| `getEmailConversationSubjectGroups` | 按主题分组 |
| `markEmailConversationRead` | 标已读 |
| `markEmailMessageUnread` | 单封标未读 |
| `saveEmailDraft` | 存草稿 |
| `polishEmailPrompt` | 提示词润色 |
| `previewEmailDraft` | 生成预览 |
| `translateEmailToChinese` | 译成中文 |
| `sendEmailNow` | 立即发送 |

### APP 邮件 — `AppKolEmailMcpTools`

| Tool | 说明 |
|------|------|
| `pageAppEmailConversations` | APP 会话卡片分页 |
| `getAppEmailTaskSummary` | APP 任务摘要 |

## Host 契约（2026-09-10）

正式阶段写入走 Host `confirm_stage` → 人确认后 Host 内核调 `changeLifecycleStage`。Worker / Skill turn **禁止**自己调该工具。画像备注、负责人等非阶段字段仍走 `updateKolProfile`。

### 阶段

Host 读取归一成 Host-local 码；`changeLifecycleStage` / `updateKolProfile` 阶段写入发 **Starry 原生码**（ADR-011）。`listCooperationStageOptions` 仍列 Host 官方 15+6 码，原生码在 `aliases`：

| 官方码 | 旧码别名 |
|---|---|
| INTERESTED | INTEREST_CONFIRMED |
| EVALUATING | COOPERATION_EVALUATION |
| NEGOTIATING | BUSINESS_NEGOTIATION |
| CONTRACTING | CONTRACT_SIGNING |
| TESTING | DELIVERED_TESTING |
| PUBLISH_PENDING | PENDING_PUBLISH |
| SETTLING | SETTLING_PAID |
| DISPUTED | EXCEPTION_HANDLING |

旁路/终态：`PAUSED`、`LOST`、`REJECTED`、`CANCELLED`、`DISPUTED`、`COMPLETED`。

`updateKolProfile` / `changeLifecycleStage` 写阶段时同时给 `cooperationStageCode`（Starry 原生码，如 `BUSINESS_NEGOTIATION`）和 `cooperationStageName`（中文）。不要把码写进 Name。人跳过只在 Host 记账，远程只写落地阶段。

### 风险标签

`listRiskTagOptions` / `getStageRiskMatrix` / 会话 `riskTag` 只用：`DELAY`、`CONTENT`、`LOST_CONTACT`。与跟进风格、垂类标签分开。

### 跟进风格

画像字段 `followStyleTags: [{ id, label }]`。预设：犹豫谨慎 / 回复慢 / 价格敏感 / 决策快 / 需上级拍板 / 材料不齐。不是阶段，也不是风险。

### `listAllKolProfiles` 白名单

在原指标字段外必须带：`kolId`、`cooperationStageCode`、`cooperationStageName`、`daysInStage`、`riskTag` / `riskTagCodes`、`contactEmailMasked`、`ownerUserId`、`ownerMailbox`、`notes`、`wechat`、`lastConversationId`、`followStyleTags`、`nicheTags`。
