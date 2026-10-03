# KOL 业务对象动作（Action）清单

> **2026-10-03 口径更新：** 下文技能级人员授权历史索引已被 [ADR-2026-10-03](../DECISIONS.md) 取代；人员使用资格现由 Agent 绑定决定。本文为旧版研究快照，不作现行权限法。

> 整理时间：2026-10-01
> 模板来源：[《本体六构件-定义与实例》](本体六构件-定义与实例.md) §6「动作」——动作是唯一能「写回」现实的出口；每个动作规定输入参数、执行逻辑、权限检查、副作用（写回源系统）与审计留痕；铁律：**所有修改都必须走动作**，动作产生事件。
> 配套文件：[《KOL业务对象清单》](KOL业务对象清单.md)（对象口径总表）、[《KOL业务对象-属性（Property）清单》](KOL业务对象-属性（Property）清单.md)、[《KOL业务对象关系（Link）清单》](KOL业务对象关系-Link清单.md)、[《KOL业务对象-事件（Event）清单》](KOL业务对象-事件（Event）清单.md)、[《KOL业务对象-规则（Rule）清单》](KOL业务对象-规则（Rule）清单.md)——本文覆盖六构件的 Action 部分。
> **定位声明：本文是整理与对照材料，不是规范正文、不建立规则、不新增业务口径（CONST-09、CONST-10）。** 与 `docs/` 正文冲突时以正文为准；实现资产只作证据列示，不表示运行代码已完成，实施状态见 [implementation-registry.md](../implementation-registry.md)。
> 对照范围：[CONSTITUTION.md](../CONSTITUTION.md)、[BUSINESS.md](../BUSINESS.md)（BIZ-01~19）、[stage-transitions.md](../business-rules/stage-transitions.md)、[org-permissions.md](../org-permissions.md)、[PRODUCT.md](../PRODUCT.md)、[TECHNOLOGY.md](../TECHNOLOGY.md)、[07-mcp-data-contract.md](../07-mcp-data-contract.md)、[domain-objects.md](../domain-objects.md)。

**审宪记录（CONST-08）**

| 项 | 内容 |
|---|---|
| 需求 | 按六构件口径整理 KOL 项目业务对象的动作（Action）清单，并对照宪法与三部基本法 |
| 主责角色 | KOL 业务专家（对象、关系、动作、SOP、规则与业务权限，CONST-04） |
| 宪法条款 | CONST-02（业务动作由业务专家定义，不写死平台内核）、CONST-04、CONST-05（确认与审批）、CONST-10（不得以文档冒充能力） |
| 基本法条款 | BIZ-01~19；stage-transitions；org-permissions；TECH-ARCH-02、TECH-BE-01~09 |
| 结论与证据 | **符合**：本文只做条款与实现资产对照，未新增口径；空白与差距如实标注 |
| 下一步 | 规则空白交 KOL 业务专家补入；实施差距交对应实施角色核对登记（见 §4） |

---

## 一、动作的统一形态（六构件口径）

### 1.1 每个动作回答六个问题

| 构件 | 动作里的对应 | KOL 口径 |
|---|---|---|
| 对象 | 改哪类对象 | 线索、KOL 画像、合作关系、跟进关系、任务、邮件、报价、合同、样品、内容、结算、审批、风险（BIZ-01） |
| 输入 | 参数 | 对象 ID、目标值、原因、证据、预期版本（stage-transitions §3） |
| 权限检查 | 谁能执行 | 公司 + 组织 + 品牌 + 区域 + 对象 + 动作共同决定（BIZ-03；org-permissions） |
| 执行逻辑 | 校验后执行 | 前置事实校验、版本校验、幂等键（TECH-BE-02/03） |
| 副作用 | 写回哪里 | 任何业务副作用经 Host Gateway → 已授权连接器 → 回执（TECH-ARCH-02；07 文档） |
| 审计 | 留下什么 | 操作者、范围、对象、动作、前后版本、规则版本、时间、结果、回执（TECH-BE-08）；审批另记申请人/审批人/幂等键/外部回执（org-permissions） |
| 产生事件 | 新事实 | 事件记录稳定 ID、对象、发生时间、来源版本及关联动作（TECH-BE-04）；事件是状态变更的唯一合法来源 |

### 1.2 三条跨对象铁律

1. **发送 ≠ 推进阶段。** 发送只新增邮件事实，不写正式阶段（BIZ-11、BIZ-12；stage-transitions §4「发送路径永远不写阶段」；TECH-TEST-02）。
2. **不同副作用不合并。** 发送、暂存、导入、解密、删除、阶段推进必须各自独立动作与状态（根 `AGENTS.md` §4、`docs/AGENTS.md` §4）。
3. **风险三档可见。** L1 只读直接执行；L2 草稿必须标注（不得冒充正式结果）；L3 外发、导入、删除、解密和正式写入执行前必须确认并保留回执（CONST-05、BIZ-14）。**确认 ≠ 组织审批**，两者分别记录。

### 1.3 L3 统一提交闸门（所有正式副作用）

- 网关核验：身份、对象、动作权限、当前版本、确认、适用审批、发布规则版本、幂等键（TECH-BE-02）。
- 确认只覆盖当时展示的对象、内容与范围；关键字段改变要重新确认；**编辑使旧确认失效**（TECH-BE-02、TECH-TEST-02）。
- 重复确认、重试与事件重放不得造成重复发送/导入/归属变更；超时可能已提交时先查状态，不能盲重试；无法确认时如实返回「不确定」（TECH-BE-03）。
- 归属取得、续期、释放须原子判定，竞争失败返回冲突，不能后写覆盖先写（TECH-BE-03）。

### 1.4 示例：以「确认发送」跑一遍六构件（对标六构件文档的「冻结客户」例）

- **输入**：草稿快照（发件箱、收件人、主题、完整正文）+ 确认版本 + 请求号。
- **权限检查**：发件箱属员工获准品牌与范围；收件人来自已核实联系方式（BIZ-04）。
- **执行逻辑**：核对确认版本与最新编辑版本一致；版本变化必须重新确认（BIZ-11；TECH-BE-02）。
- **副作用**：仅由 Gateway 用确认快照提交发送，取得真实外部回执（07 文档；email_compose 正文）。
- **审计**：操作者、前后快照、知识/技能版本、幂等键、外部回执。
- **产生事件**：「邮件已发送」；**不产生**任何阶段事件（发送 ≠ 推进阶段）。

---

## 二、按对象的动作清单

表列说明：**档** = L1 只读 / L2 草稿 / L3 正式或敏感；「实现资产（证据）」只列资产名，不声称完成度，状态以 [implementation-registry.md](../implementation-registry.md) 为准；「产生事件」栏为典型示例，完整事件口径以[《KOL业务对象-事件（Event）清单》](KOL业务对象-事件（Event）清单.md)为准。

### 2.1 线索与发现（CreatorCandidate / 采集批次）

| 动作 | 档 | 执行者 / 权限 | 前置与约束 | 副作用（写回） | 产生事件 | 依据 | 实现资产（证据） |
|---|---|---|---|---|---|---|---|
| 发起发现采集 | L3 | 员工提交，采集内核执行 | 异步作业，可查进度/取消/重试；同一时间只跑一个 MediaCrawler 任务；只接受海外平台码 | MediaCrawler 采集，形成批次与候选 | 「采集作业已创建；进度、取消、失败、完成各落事件」 | BIZ-10；根 AGENTS 不变量；07 文档 | `creator_discovery`（只出 `crawl_plan`）；Home `start-discovery-run`、`cancel-discovery-run`、`retry-discovery-run` |
| 忽略候选 | L2 | 员工（范围校验） | 只影响候选面 | 候选标记忽略 | 「候选已忽略」 | BIZ-10 | Home `ignore-candidate` |
| 确认入库（导入正式库） | L3 | 员工逐批确认；Host Gateway 提交 | 每个 `source_batch` 独立确认；按外部 ID 去重；逐项记录成功/失败/真实 ID；缺邮箱不编造、禁止只落本地 | Starry 红人库（`importKolProfilesFromCrawler`） | 「导入已提交；导入项已成功 / 已失败 / 已跳过（逐项）」 | BIZ-10、BIZ-14；07 文档 | Home `discovery-ingest`；`creator_library_sync`（幂等查重）；`importKolProfilesFromCrawler` |
| 加入跟进 | L3 | 员工确认 | 建联成功证据 = **规则空白**（BIZ-05）；收藏候选、导入档案、打开会话、生成草稿都不算建联 | 建立有效跟进关系 | 「建联已认定 → 归属已建立」 | BIZ-05（待业务专家补证据口径） | Home `follow-candidate`；控制名单含 `follow` |
| Jev 评估公海对象 | L2 | 员工触发（think） | 先填知识库评分模板，员工确认后执行；评估是候选产出 | 本地评估产物 | 「评分已生成」 | BIZ-10（评分注明依据/版本/不确定性） | Home `assess-pool-jev` |

### 2.2 KOL 画像与联系方式

| 动作 | 档 | 执行者 / 权限 | 前置与约束 | 副作用（写回） | 产生事件 | 依据 | 实现资产（证据） |
|---|---|---|---|---|---|---|---|
| 更新档案备注 / 确认 / 跟进字段 | L3（受控写入） | 员工（范围内） | 备注 ≠ 正式阶段；「标记已签约 / 已建联」走 `confirm_stage`；禁止改品牌邮箱账号负责人 | Starry 画像字段 | 「档案备注已更新」 | BIZ-13；BUSINESS 快捷表「备注不等于正式阶段」 | `creator_status_update`（必须指定 UID，回读核验） |
| 变更档案负责人 | L3（受控写入） | 员工（范围内） | 改红人画像负责人，不是邮箱账号负责人；不写阶段、不发信 | Starry 画像字段 | 「画像已更新（负责人字段）」 | BIZ-07（变更须可追溯）；BUSINESS 快捷表 | `creator_owner_update`（无 `assignKolOwner` 专用工具，经 `updateKolProfile`） |
| 补充画像 / 同步档案 | L3（受控写入） | Agent / 员工确认 | 幂等：先按联系邮箱与名称查重再写入；缺名称或邮箱返回待补充，不写入 | Starry 红人库（`addKolProfile`） | 「档案同步已完成 / 已失败」 | BIZ-02（权威源）、BIZ-10 | `creator_library_sync`；`creator_profile`（只读） |
| 解密联系方式 | L3（敏感） | 显式执行；范围与用途校验 | 必须指定达人 UID；普通画像或写邮件时禁止解密；普通组信路径不能调用 | 返回明文联系方式（敏感读取） | 「联系方式已解密」（审计） | BIZ-14；07 文档；org-permissions 数据范围 | `creator_contact_decrypt`；工具 `decryptKolContact` |
| 删除档案 | L3（破坏性） | 明确授权；执行前确认 | 删除范围须说明实际删到什么（PROD-PLAT-07）；属「破坏性删除」需声明风险与证据（BIZ-14） | 删除远端档案 | 「档案已删除」（保留审计） | BIZ-14；PROD-PLAT-07；TECH-BE-09 | 工具 `deleteKol` / `deleteKolProfile`（控制名单）；**未见技能登记** |

### 2.3 跟进关系与归属（排他）

| 动作 | 档 | 执行者 / 权限 | 前置与约束 | 副作用（写回） | 产生事件 | 依据 | 实现资产（证据） |
|---|---|---|---|---|---|---|---|
| 领取公海档案 | L3 | 员工（公海可领取范围内） | 原子判定，竞争失败返回冲突 | 建立归属 | 「归属已领取」 | BIZ-07（领取规则待补）；TECH-BE-03 | Home `claim-kol` |
| 释放跟进 | L3 | 归属员工 / 管理员 | 记录前后负责人、原因、有效时间和授权来源；不能由任意计时任务冒充释放 | 解除归属 | 「归属已释放」 | BIZ-07；TECH-BE-05 | Home `release-follow` |
| 转交 / 离职移交 / 撤销归属 | L3 | 管理员 / 授权角色 | 保留历史与责任变化；记忆索引同步适用新权限 | 归属变更 | 「归属已移交」 | BIZ-07、BIZ-16 | 归属变更经 `updateKolProfile`；`kol_analyze` 仅给动作按钮 |
| 14 天无互动自动回公海 | L3（预授权自动） | 后台自动任务 | 执行前复核最新互动与当前归属；旧任务不能解除已续期或已重新分配的关系；数据源不可用 ≠ 没有往来 | 解除归属，回公海 | 「归属已自动释放（回公海）」 | BIZ-06；TECH-BE-05 | 自动任务契约（TECH 自动任务最低执行契约）；**有效往来口径为规则空白** |
| 公海辅助命令（同步索引 / 补全公开头像 / 清理无主页档案） | L2–L3 | 员工 / 管理员 | 「确认清理」属删除类，执行前确认；不得泄露跟进私有字段 | 本地索引 / 头像缓存 / 清理档案 | 「索引已同步 / 档案已清理」 | BIZ-07；CONST-10 | Home `sync-pool-library`、`enrich-pool-avatars`、`cleanup-pool-missing-homepage` |

### 2.4 邮件（沟通）

| 动作 | 档 | 执行者 / 权限 | 前置与约束 | 副作用（写回） | 产生事件 | 依据 | 实现资产（证据） |
|---|---|---|---|---|---|---|---|
| 生成草稿 | L2 | 员工 / Agent | 生成、改写、预览都不发送；内部中文译稿不得意外发出 | 本地草稿（含知识模板版本） | 「草稿已生成」 | BIZ-11 | `email_compose`（`create_draft`；按当前正式阶段选模板） |
| AI 改写 / 调教 | L2 | 员工 | 四种类型：邀和版 / 简洁版 / 正式商务版 / 检查风险 | 改写后的草稿 | 「草稿已改写」 | BIZ-11；domain-objects 字典 | `kol_email_ai_adjust_type` 字典 |
| 预览 | L2 | 员工 | 预览 ≠ 发送授权 | 预览快照 | 「预览已生成」 | BIZ-11 | `previewEmailDraft` |
| 确认发送 | L3 | 人核对完整快照后由 Gateway 提交 | 确认对象必须是最后编辑版本；编辑使旧确认失效；重复请求复用回执；结果不确定时停止盲重试；管理员同样不能跳过 | 真实外发（Starry 邮箱） | 「邮件已发送」＋真实回执；**不产生阶段事件** | BIZ-04、BIZ-11；TECH-BE-02/03；TECH-TEST-02；07 文档 | Home `confirm-send`；工具 `sendEmailNow`（仅 Gateway） |
| 回复理解 | L1–L2 | 员工 / Agent | 证据优先级：正文明确动作 → 附件和链接 → 履约字段 → 主题；建议不直接改正式状态 | 本地分析产物（建议、风险、下一步） | 「回复分析已生成」 | BIZ-13 | `reply_analysis`（只读） |
| 同步通讯邮箱记忆 | L3（受控同步） | 员工触发 | 本地记忆 ≠ 远端正式档案 | 本地邮件记忆 | 「邮箱记忆已同步」 | TECH-BE-06；BIZ-18 | Home `sync-mailbox-mail` |
| 后台邮件摘要 / 中文译稿 | L2（只写本地记忆） | 后台自动作业 | 员工面不呈现这两个动作；失败保留旧摘要并标过期 | 本地记忆（摘要/译文） | 「摘要已更新」 | BUSINESS 快捷表；PROD-AGENT-07 | `mail_summary`、`mail_translate`（`auto_ok`） |

### 2.5 合作阶段（正式生命周期）

| 动作 | 档 | 执行者 / 权限 | 前置与约束 | 副作用（写回） | 产生事件 | 依据 | 实现资产（证据） |
|---|---|---|---|---|---|---|---|
| 提出阶段变更建议 | L2 | Agent / 员工 | 必须给具体 `stage_code`；禁止「下一阶段」口令；建议不直接改正式状态 | 建议产物（确认卡） | 「阶段建议已生成」 | BIZ-12、BIZ-13 | `confirm_stage`（`propose_stage`）；`reply_analysis` |
| 确认阶段变更（唯一官方写入口） | L3 | 人确认后由 Host 写入 | 带 `expected_version`；跨段、回退、进出异常必须写原因；进入 PLAN_PENDING / CONTRACTING / CONTENT_REVIEW / PUBLISH_PENDING / SETTLING 再叠审批；Worker / Codex 不得自写；管理员同样等人确认 | Starry 生命周期（物理适配可能逐格） | 「阶段已变更」＋审计（目标码、原因、审批） | BIZ-12；stage-transitions §2/§3；07 文档 | `confirm_stage`；`config/stage-transitions.json`（host_enforced） |
| 自动推进（自动事实路径） | L3（预授权自动） | 后台 | 只允许：主链下一格、进入 `exception`、从可回异常返回；跨段 / 回退 / 替人纠正一律禁止；发送路径永不写阶段 | 阶段写入 | 「阶段已自动推进」 | stage-transitions §4 | 自动边配置（allow_auto / forbid） |
| 进出异常旁路 | L3 | 人确认（跨段类） | 须原因；终态异常（流失 / 拒绝 / 取消）不得自动恢复 | 阶段写入 | 「已进入 / 离开异常」 | stage-transitions §1/§3/§4 | 异常种类：暂停 / 争议可回；流失 / 拒绝 / 取消终态 |

### 2.6 报价与费用审批

| 动作 | 档 | 执行者 / 权限 | 前置与约束 | 副作用（写回） | 产生事件 | 依据 | 实现资产（证据） |
|---|---|---|---|---|---|---|---|
| 提交费用审批 | L3 | 申请人 | 必须写明申请人、金额、币种、用途、制度版本、必要汇率及日期和来源；汇率与制度档必须本轮网络搜索并附出处；Host 只持久化与通知，不重算档 | 审批单（审批队列 + 通知） | 「审批已提交」 | BIZ-14；org-permissions 审批链 | `business_approval`（`create_approval`） |
| 审批决定（批准 / 拒绝 / 撤回） | L3 | 审批人（组织绑定校验） | 不得代人审批；拒绝记录理由；审批链：工具权限 → 业务 Policy → 人工确认 → 组织审批 → 外部提交 → 回执 | 审批状态 | 「审批已批准 / 已拒绝」 | BIZ-14、BIZ-15；org-permissions | 员工 `/approvals`；`approvals` 表 |
| 报价确认（事实） | L3 | 归属员工 | 询价、收到报价与认可报价是不同事实（BIZ-08）；报价确认 ≠ 费用审批 | 合作事实记录 | 「报价已确认」 | BIZ-08、BIZ-14 | 阶段事实 + 审批承载；未见独立技能登记 |

### 2.7 履约链：合同 / 样品 / 内容 / 结算

这些对象的动作以「独立事实分开记录 + 阶段审批叠加」为口径；**未在 `backend/skills/` 找到独立技能登记**（见 §4 差距）。

| 对象 | 独立事实动作（必须分开记录） | 审批叠加 | 依据 |
|---|---|---|---|
| 合同 | 发送合同 / 合同审核 / 合同签署 | 进入 CONTRACTING 需审批 | BIZ-08（三者不同）、BIZ-12 |
| 样品 | 寄样登记（型号、数量、收件信息符合寄送条件）/ 发货（需运单或明确发货证据）/ 签收（物流签收与本人确认分开） | SAMPLE_PENDING 按规则 / 人工 | BIZ-08 |
| 内容 | 记录 Brief（核心卖点、禁止表述）/ 提交初稿 / 审核通过或驳回 / 发布核实（链接与交付完整性） | CONTENT_REVIEW、PUBLISH_PENDING 审批（content） | BIZ-08、BIZ-15（针对具体版本；实质改变重审） |
| 结算 | 收到发票 / 申请付款 / 付款成功 | SETTLING 审批（settlement） | BIZ-08、BIZ-14、BIZ-17（报表不执行付款） |

### 2.8 任务与风险

| 动作 | 档 | 执行者 / 权限 | 前置与约束 | 副作用（写回） | 产生事件 | 依据 | 实现资产（证据） |
|---|---|---|---|---|---|---|---|
| 创建任务（跟进 / 风险 / 待办） | L2 | 员工 / 已发布规则 | 负责人、对象、依据、期限、状态、摘要与下一步必须可追溯；AI 建议保持候选 | 正式待办 | 「任务已创建」 | BIZ-16；PROD-AGENT-08 | `/api/tasks`；`creator_daily_tasks`（只读） |
| 采纳推荐 → 正式待办 | L2 | 员工 | 只有员工采纳或已发布自动规则触发才进正式待办 | 正式待办 | 「推荐已采纳」 | PROD-AGENT-08；ADR-2026-09-28（候选推荐与「采纳为待办」） | Home `adopt-recommendation` |
| 记录处理 / 更新进度 / 转办 | L2 | 负责人 | 转办保留历史与责任变化 | 任务更新 | 「任务已更新 / 已转办」 | BIZ-16 | Home `acknowledge-task` |
| 完成任务 | L2 | 负责人 | 按任务验收条件；关闭会话、发送一封邮件、解除跟进关系都不自动完成关联任务 | 任务关闭 | 「任务已完成」 | BIZ-16 | 任务链路 |
| 风险识别与扫描 | L1 | 员工 / Agent | 输出证据、不确定性、风险；与 BIZ-06 归属到期分别判断 | 本地分析产物 | 「风险已识别」 | BIZ-13 | `risk_scan`、`creator_risk_conversations`（只读） |

### 2.9 项目与活动（规则空白）

| 待发布动作 | 档 | 说明 |
|---|---|---|
| 创建项目 / 活动、状态变更、分配、领取 | — | **字段、状态机、可见范围及分配 / 领取规则待 KOL 业务专家发布**（BIZ-19）；口径未发布前界面与接口不得自行补全（CONST-10）；实施登记 `PROJ-01 = not_started` |

### 2.10 记忆与索引

| 动作 | 档 | 执行者 / 权限 | 前置与约束 | 副作用（写回） | 产生事件 | 依据 | 实现资产（证据） |
|---|---|---|---|---|---|---|---|
| 记忆快捷记录 / 修改 / 删除 | L1–L2 | 员工 | 直接访问已授权记忆服务：零 thread、零 turn、零模型；只处理已明确内容；密码与令牌不得进入记忆 | 本地记忆 | 「记忆已记录 / 已修改 / 已删除」 | PROD-AGENT-01/02/04 | 快捷记忆入口（PROD-AGENT-02 契约） |
| 记录 / 修改 / 查询明确内容 | L1–L2 | 员工 | 修改远端正式档案备注是**业务写入**，不能与本地记忆混谈 | 本地记忆或远端档案（分开） | 「记忆已记录」 | BUSINESS 快捷表；TECH-BE-06（正式状态写入不藏在记忆接口里） | `deal_memory`（只读 + `updateKolProfile`） |
| 事件驱动索引更新 | L2（后台） | 后台作业 | 有效业务事件提交后更新；同一来源版本不重复提炼；快捷读取不触发模型重算；失败保留旧摘要并标注 | 索引 / 摘要 | 「索引已更新」 | PROD-AGENT-07；BIZ-18 | 后台作业（`mail_summary`、`mail_translate`） |

### 2.11 报表与评分

| 动作 | 档 | 执行者 / 权限 | 前置与约束 | 副作用（写回） | 产生事件 | 依据 | 实现资产（证据） |
|---|---|---|---|---|---|---|---|
| 生成评分 | L1 | Agent / 员工 | 注明依据、版本和不确定性；不能编造联系方式或效果 | 本地评分产物 | 「评分已生成」 | BIZ-10 | `creator_scoring`（只读） |
| 生成 / 解读报表 | L1 | Agent / 员工 | 定义范围、统计期、币种、来源、口径、更新时间；已发生 / 预测 / 模型解释分开；**预算报告不执行付款或预算调整**；汇总导出服从当前数据权限 | 报表产物 | 「报表已生成」 | BIZ-17 | `creator_budget_report`（只读） |

### 附录 A：平台治理动作（管理端控制面，非 KOL 业务动作）

| 动作 | 依据 | 边界 |
|---|---|---|
| 技能授予 / 撤销（人员授权只对技能） | PROD-PLAT-05；ADR-2026-09-27 | 管理端治理；不对员工暴露连接器/工具 |
| Agent 发布 / 可写范围 / 考试闸门 | org-permissions；PROD-PLAT-04 | 未发布 Agent：可看说明、不可提交 |
| 连接器启用 / 凭据引用变更 | org-permissions（枢纽与详情） | 永不回显秘密；管理员不能绕过运行时闸门 |
| 预算配置与硬停 | PROD-PLAT-08 | 硬停只阻止新运行，不隐藏已发生事实 |

### 附录 B：工具物理层 L3 控制名单（发布下限，只准收紧）

- 名单（`config/connector-risk-floor.json`）：`sendEmailNow`、`changeLifecycleStage`、`decryptKolContact`、`importKolProfilesFromCrawler`、`importKolProfilesV2`、`upload_creators`、`updateKolProfile`、`addKolProfile`、`clear_history`、`deleteKol`、`deleteKolProfile`、`send_mail`、`wecom_send`、`confirm_stage`、`starry_stage`、`ingest`、`start_crawl`、`stop_crawl`、`follow`。
- 推导规则（`backend/src/runtime/tool-catalog.ts`；依据 ADR-2026-09-28「工具风险档由平台自动推导」）：命中名单或 `^(send|delete|decrypt|import|upload|clear|confirm)` → **L3**；`^(page|list|get|read|search|query|status|summarize|translate|download|count|fetch|check)` → **L1**；其余 → **L2**。
- 生产 IO 只能由 Codex turn 调用已授权远程 MCP；`sendEmailNow` 必须由人确认后的 Gateway 提交；`changeLifecycleStage` 必须由 `confirm_stage` 提案后经 Host 写入（07 文档）。
- `clear_history` 必须 `confirm=true`；MediaCrawler 保持 `start_crawl → get_crawl_status → get_creators → upload_creators` 异步链，同一时间一个任务（07 文档）。

---

## 三、跨对象不变量对照（法条 ↔ 证据）

| 不变量 | 条款 | 实现证据（示例） |
|---|---|---|
| 发送 ≠ 推进阶段 | BIZ-11/12；stage-transitions §4 | `email_compose` 禁止事项；TECH-TEST-02「发送不改阶段」 |
| 副作用不合并 | 根 `AGENTS.md` §4、`docs/AGENTS.md` §4 | 各技能「禁止事项」（如 `confirm_stage` 禁止发信、禁止走企微审批） |
| L3 先确认后执行并留回执 | CONST-05、BIZ-14、07 文档 | Home L3 命令（`discovery-ingest`、`claim-kol`、`release-follow`、`confirm-stage`、`confirm-send`）；Gateway 回执 |
| 未确认不发送 / 重复确认只提交一次 / 旧确认失效 / 未知回执不误报 | TECH-BE-02/03、TECH-TEST-02 | `email_compose` 发送段；`specs/FS-KOL-004-send.md` |
| 权限先于取数（不能先取全量再过滤） | TECH-BE-01；BIZ-03 | 范围注入 CONTEXT；服务端二次校验 |
| 到期执行复核 | TECH-BE-05 | 14 天回公海（复核互动与归属版本） |
| 正式状态写入不藏在记忆接口 | TECH-BE-06 | `deal_memory` 与 `creator_status_update` / `confirm_stage` 分列 |
| 入口分类显式登记（think / memory / command / cron） | PROD-AGENT-01；TECH-ARCH-02 | `backend/src/host/entry-registry.ts` 四类 kind |
| 占位不得冒充完成 | CONST-10；BIZ-19 | 项目/活动标「规则空白」；未实现能力明示占位 |

---

## 四、差距与空白（诚实记录）

### 4.1 规则空白（待 KOL 业务专家补入，只影响依赖它们的动作）

| 条款 | 尚需明确 |
|---|---|
| BIZ-05 | 建联成功证据；排他范围（公司 / 品牌 / 活动）；与多合作关系关联 —— 影响「加入跟进」「领取」 |
| BIZ-06 | 有效往来口径（退信、自动回复是否计入）、计时起点与时区 —— 影响「14 天自动回公海」 |
| BIZ-07 | 公海可见字段、可领取人群、分配方式、历史资料移交范围 —— 影响「领取 / 释放 / 移交」 |
| BIZ-14、15、17 | 现行费用制度来源、具体审批链、场景合规要求及报表公式 |
| BIZ-19 | 项目 / 活动字段、状态机、可见范围、与任务 / 成本的挂接、分配与领取规则 |

### 4.2 实施差距候选（证据，不是规则；供对应实施角色核对登记）

1. **技能最低契约缺字段**：`domain-objects.md` 要求每个 Skill 声明 `risk_level`、`approval_policy` 等；本次核对（全量扫描 + 抽查 6 个）未见 `risk_level` / `approval_policy` 声明。风险档现由工具层自动推导（ADR-2026-09-28）。
2. **履约链无独立动作登记**：合同 / 样品 / 内容 / 结算的事实动作现由阶段确认与审批承载，未在 `backend/skills/` 发现独立技能。
3. **破坏性工具缺登记**：`deleteKol` 等工具在控制名单，但未见对应技能与确认卡登记；`clear_history` 需 `confirm=true`。
4. **远端适配诚实性**：`config/stage-transitions.json` 为 `live_enforced: false`；Starry 逐格 walk 是物理适配，远端可能返回 `not_supported_by_remote`（stage-transitions §6 要求确认卡诚实说明）。
5. **8 个技能入口未登记**：`discovery_plan`、`discovery_brief`、`kol_analyze`、`today_plan`、`today_analyze`、`todo_plan`、`mail_summary`、`mail_translate`（BUSINESS 已登记「待业务专家补齐」）。

### 4.3 本清单边界

- 不覆盖：UI 布局与视觉数值（见 `docs/DESIGN.md`）、测试证据（见 `docs/VERIFICATION.md`）、平台治理动作的字段细节（见 `docs/org-permissions.md`）。
- 本文不定义新动作；新增或修改动作必须按 CONST-08 先审宪、再由 KOL 业务专家发布规则并登记实施资产。

---

*相关文件：[《本体六构件-定义与实例》](本体六构件-定义与实例.md)、[《KOL业务对象清单》](KOL业务对象清单.md)、[《KOL业务对象-属性（Property）清单》](KOL业务对象-属性（Property）清单.md)、[《KOL业务对象关系（Link）清单》](KOL业务对象关系-Link清单.md)、[《KOL业务对象-事件（Event）清单》](KOL业务对象-事件（Event）清单.md)、[《KOL业务对象-规则（Rule）清单》](KOL业务对象-规则（Rule）清单.md)、[《概念落地对照表-总表》](概念落地对照表-总表.md)。*
