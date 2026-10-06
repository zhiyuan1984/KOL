# MCP、真实 API 与数据契约

> 上位规则：[TECHNOLOGY.md](TECHNOLOGY.md)。本文件是物理契约与工具风险实施细则。Starry 等物理限制留在这里，不升格为产品法；冲突时服从 TECHNOLOGY。

## MCP 服务器（物理接入事实）

| 服务 | 用途 | 连接配置来源 | 鉴权头 |
|---|---|---|---|
| Starry KOL / email-agent | 红人库、品牌邮箱、邮件会话、合作阶段（62 个 `@Tool`） | 管理侧 `starrykol` 连接配置 + 保险柜引用 | `X-MCP-API-KEY` + `Authorization: Bearer`（网关要**两个头**） |
| MediaCrawler | 采集（YouTube / Instagram / Facebook） | 管理侧 `claw` 连接配置 + 保险柜引用 | `Authorization: Bearer <token>` |
| KOL Claw | 评分、建联话术、每日任务、预算 | `KOLCLAW_MCP_URL` / `_TOKEN` | 见 `.env.example` |

Starry KOL 只读取管理侧保存的地址及保险柜引用，不再读取 MCP 环境变量、上传文件或进程级身份回退。个人邮箱令牌也存入保险柜，邮箱绑定只持有引用；历史明文绑定须在切换时迁移。MediaCrawler 同样只读取管理侧地址及组织保险柜引用；KOL Claw 仍沿用 `.env.example` 的配置。不在此写死 URL、IP 或隧道地址。

### MediaCrawler 工具与平台码

工具：`start_crawl`（`search` 必填 `keywords` / `detail` 用 `specified_ids` / `creator` 用 `creator_ids`）、`get_crawl_status`、`get_crawl_logs`、`stop_crawl`、`get_creators`（入参只接受 `platform` / `offset` / `limit`，发 `page` / `page_size` 会被忽略并返回全量）、`list_result_files`、`upload_creators`（按 `task_id` 重试入库）、`clear_history`（必须 `confirm=true`）。

`start_crawl` 只接受海外平台码 `youtube` / `instagram` / `facebook`；`xhs` / `dy` / `ks` / `bili` / `wb` / `tieba` / `zhihu` 为历史遗留码，仅供旧计划与既有快照。自动化采集测试必须只用海外码，不得把历史码当作被测场景。

内置 `claw` 与其他 MCP 一样，通过管理端 `tools/list` 登记真实工具与 schema；不按环境变量或 URL 相等判断 Host 专用连接。读写工具均可挂载，L3 及风险下限目录中的工具调用只能提出待确认动作；实际执行复核当前身份、Agent→技能→连接器→工具绑定、参数快照、配置/schema 版本、业务范围和适用审批。没有专用业务门禁的写入走通用门禁（确认、复核授权、单次提交、回执不变），发信与正式阶段写入除外（见下方真实调用规则；ADR-2026-10-06「写入型工具通用放行」）。默认连接测试只读目录，不启动采集。真实采集通过 `crawler_collect` 技能独立确认、持久执行与监控；结果读取和停止必须绑定任务 ID。未知远端结果保留不确定状态，禁止盲重试。采集和 Starry 导入是两个独立动作。凭据继续只从管理配置的保险柜引用解析。

入库回调使用独立的 `MEDIACRAWLER_INGEST_SECRET_REF`（组织保险柜引用），兼容显式配置的 `MEDIACRAWLER_INGEST_TOKEN`；不再回退到旧 MCP 环境令牌。回调认证与出站连接配置是独立用途。

物理事实来源是 `domain-objects.md`（字典与枚举）和 `codex/` 协议 schema。它们描述工具、参数、响应、错误、鉴权、限流、异步生命周期和版本，不描述员工体验或业务编排。

Starry KOL MCP 和 `data/kol/邮箱-负责人绑定清单.md` 提供 KOL 域事实；安培时代组织注册表提供部门负责人和公司级范围政策。MCP/Skill 不得重新解释部门负责人范围，统一消费 Host 注入的 scope。

## 工具风险目录

人员使用资格按 Agent 绑定校验；MCP、API 和知识库无独立人员授权，均经 Agent 所装配的技能调用。资源不设人员授权不降低以下工具风险分档、数据范围、凭据和正式副作用闸门（2026-10-03 修宪，见 [DECISIONS.md](DECISIONS.md) ADR-2026-10-03）。

每个工具标记 `read_only`、`draft`、`reversible_write`、`external_side_effect`、`destructive`、`requires_confirmation`、`requires_admin`、`idempotent`。画像读取、邮件读取、爬虫状态为 L1；草稿/预览为 L2；`sendEmailNow`、`changeLifecycleStage`、联系方式解密、导入和删除按 L3/敏感动作闸门处理。

技能 md 的 `mcp` 声明对照**已登记工具目录**（连接器 tools/list 发现、管理员已定风险档），不设代码白名单；所需工具未登记或未挂载时，技能可存草稿，但不能进入测试或发布。平台后台作业只能由平台系统智能体 `agent:platform-sync` 以系统主体运行已装配技能里的只读工具，走同一挂载与风险档闸门，不能执行需要确认的工具（ADR-2026-10-06）。

## 真实调用规则

生产 IO 只能由 Codex turn 调已授权远程 MCP；不得再包一层本地业务工具或 Host 代调作为第二真相源。`sendEmailNow` 不能由 Worker 直接调用，必须由用户确认后的 Gateway 提交。`changeLifecycleStage` 不能由 Worker/Skill 直接写，必须由 `confirm_stage` 提案后经 Host 写入。通用写入门禁不替代这两条路径：二者没有注册专用门禁时，运行时连待确认动作都不提出（`runtime_host_path_required`）。产品边以 [business-rules/stage-transitions.md](business-rules/stage-transitions.md) 为准，不由本文件改写。

MediaCrawler 是异步作业：`start_crawl → get_crawl_status → get_creators → upload_creators`，同一时间一个任务；不得把它伪装成同步 Skill。

Home AI发现跟进写入 Starry 的物理路径遵守 L3 确认→执行→持久回执（CONST-05、BIZ-10/14、TECH-BE-02/03）：员工确认后由 Host Gateway 调 `starrykol.importKolProfilesFromCrawler`（单行映射亦可；无 `contactEmail` 仍写，禁止编造邮箱、禁止只落本地）。采集完成只入库 CreatorCandidate，**禁止** MediaCrawler 任务结束时直接写 Starry。`upload_creators` / `KOL_INGESTION_URL` 仍是 Host 侧入库，不是 Starry 写入。条件批量门槛只在 Host 列表预览与写入前复核：线索字段 `followers` / `score`、Host 用最近 10 条 `views`/`recent_views` 算的 `avg_views_10`，以及发现计划的平台 / 地区条件。MediaCrawler 工具无 min-followers / min-views / min-score。本路径禁止 `sendEmailNow`、`changeLifecycleStage`、`decryptKolContact`。每个 `source_batch` 必须独立确认。

## 数据字典

展示值、外部 code、平台 canonical code 和显示阶段分开维护；跨系统映射版本化，Codex 只输出 Host canonical code，adapter 读取时归一、写入 Starry 时输出原生码。租户、用户、公司、部门、品牌、区域和授权范围必须进入请求上下文，服务端二次校验。

## 物理适配（Starry 阶段写入；≠ 产品边）

下列只描述 Host ↔ Starry 适配器，**不得**当成「人只能相邻前进」的产品法：

1. **字段形状。** LIVE `changeLifecycleStage` 顶层只有 `{ lifecycleId, requestJson }`；`requestJson` 为 `{ toStageCode, reason }`；`toStageCode` 是 Starry 原生码（Host `NEGOTIATING` → `BUSINESS_NEGOTIATION`）。不要写 `cooperationStageCode` / `targetStageCode` / `stageCode`（会误报回退）。
2. **hop 残差。** 现行远程 API 仍可能只接受相邻前进；`planStarryAdjacentWalk` 只是物理适配器。Host 产品闸门读 `config/stage-transitions.json`，**不得**把远程 hop 限制说成「产品只允许相邻」。产品允许人跨段 / 回退 / 进出异常（须原因）。adapter 若不能一次写，应逐格 walk 或诚实失败 `not_supported_by_remote`。
3. **业务规则。** 正式阶段写入必须给出具体 `stage_code`，不能用「下一阶段」代替（BIZ-12）。

密钥只引用环境变量或 Secret 名称，不能写入 Markdown、Skill、日志或提交记录。
