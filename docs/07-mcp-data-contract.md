# MCP、真实 API 与数据契约

物理事实来源是 `starry-kol-mcp-server.md`、`median_mcp_server.md`、`DATA_DICTIONARY.md` 和 `codex/` 协议 schema。它们描述工具、参数、响应、错误、鉴权、限流、异步生命周期和版本，不描述员工体验或业务编排。

Starry KOL MCP 和 `data/kol/邮箱-负责人绑定清单.md` 提供 KOL 域事实；安培时代组织注册表提供部门负责人和公司级范围政策。MCP/Skill 不得重新解释部门负责人范围，统一消费 Host 注入的 scope。

## 工具风险目录

每个工具标记 `read_only`、`draft`、`reversible_write`、`external_side_effect`、`destructive`、`requires_confirmation`、`requires_admin`、`idempotent`。画像读取、邮件读取、爬虫状态为 L1；草稿/预览为 L2；`sendEmailNow`、`changeLifecycleStage`、联系方式解密、导入和删除按 L3/敏感动作闸门处理。

## 真实调用规则

生产 IO 只能由 Codex turn 调已授权远程 MCP；不得再包一层本地业务工具或 Host 代调作为第二真相源。`sendEmailNow` 不能由 Worker 直接调用，必须由用户确认后的 Gateway 提交。`changeLifecycleStage` 不能由 Worker/Skill 直接写，必须由 `confirm_stage` 提案后经 Host 写入。

MediaCrawler 是异步作业：`start_crawl → get_crawl_status → get_creators → upload_creators`，同一时间一个任务；不得把它伪装成同步 Skill。

## 数据字典

展示值、外部 code、平台 canonical code 和显示阶段分开维护；跨系统映射版本化，Codex 只输出 Host canonical code，adapter 读取时归一、写入 Starry 时输出原生码（ADR-011）。租户、用户、公司、部门、品牌、区域和授权范围必须进入请求上下文，服务端二次校验。

密钥只引用环境变量或 Secret 名称，不能写入 Markdown、Skill、日志或提交记录。
