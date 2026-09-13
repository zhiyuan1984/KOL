# 灵工 · LiTime KOL 建联工作台

TypeScript 前后端一体工作台：会话里干活，页面只放资产。Starry / Claw / 企微默认 mock。**Worker 默认走真实 `codex app-server`**，不会用模板假信。编排就是 **Dify Chatflow → Codex Skill / Thread / Turn / Item / MCP**，没有第二套运行时。

研发规范以 `docs/README.md` 和 `docs/00-platform-charter.md` 到 `docs/13-migration-roadmap.md` 为唯一主线。第一次打开仓库请先读 **`docs/90-codebase-handbook.md`**（地图、任务怎么走完、改哪一类文件）。旧中文规范只用于迁移核对；HTML 原型的 Toast / keyword `replyFor` **不是**规则。

界面是浅灰白工作台（侧栏 `#f6f7f8`、主画布白、近黑字）。Star Blue `#0D3D82` 只做 1–2px 点缀（焦点环、激活刻度、链接），Blazing Orange `#EA5504` 只用于「发送」和 Logo 弧。对话结果用 Markdown 展示。发送 ≠ 推进阶段。

## Dify → 灵工对照

从 Dify 过来看这张表就行，词对词落代码：

| Dify | 灵工 / Codex | 代码位置 |
| --- | --- | --- |
| Chatflow 应用 | Skill（一个 routed intent 一份） | `backend/skills/<intent>/SKILL.md`：`kol` `stage_mail` `quote_confirm` `addr_check` `content_nudge` `risk_scan` `ship_notice` `inbound_extract` `creator_profile` |
| conversation_id | Thread | `thread/start` 或 `thread/resume`；`sessions.thread_ref` |
| 一次 Run | Turn | `turn/start`；一问一 turn；等 `turn/completed` |
| 节点输出 | Item | `create_draft` / `propose_stage` / `list_overdue` / `create_approval` / `text`；解析在 `backend/src/worker/parse.ts`，映 UI 在 `backend/src/host/api.ts` |
| 工具节点 | MCP | `backend/mcp/`（`starry` / `claw` 只读）；Codex 调 MCP，Skill 里禁止裸 HTTP |
| 应用后端 | Host 内核 | `backend/src/host/`：会话 HTTP、PEP、确认闸门、落 session。不选 Skill、不抽口令槽、不代组草稿 |
| HTTP 外部动作 | Gateway | `backend/src/gateway/`：确认发送、企微卡、带 secret 的出站 |
| 系统提示与变量 | box 文件 | `AGENTS.md` + `CONTEXT.md`（无 SMTP / 企微 secret / 阶段库凭据） |
| 确定性分支 | 阶段机 + PEP | 阶段门、From 白名单、Cc、fingerprint。信件目录与缺口在 Skill，由 Codex turn 执行 |
| 人工等待 | `waiting_approval` + 杀 Worker | 一任务一箱；人确认后是**新 turn**，不是长驻进程 |

对照常量：`backend/src/dify.ts`。

## Codex Profile 能力域

对外可以称“智能体”，对内只有一套 `codex app-server` harness。Commander、Lead、Opportunity、Negotiation、Execution、Settlement-Growth 是同一运行时上的 Profile，不是六套框架。定义和 Skill 映射见 `backend/src/profiles.ts`。Commander 派生子 Thread 时使用同一 app-server 连接的 `thread/fork`。

## Manifest 驱动的任务运行时

25 个任务不再分别写 TypeScript 编排。`backend/skills/*/SKILL.md` 的 YAML frontmatter 是任务定义源，声明 title、Profile、输入、输出、MCP 白名单、权限和可执行动作；`backend/src/tasks/registry.ts` 自动扫描并生成目录。

统一执行链：

```text
work_item → task_run → Skill → allowlisted MCP → structured Item
          → task_events → task_artifacts → 人工完成
```

API：

```text
GET  /api/task-definitions
GET/POST /api/tasks
POST /api/tasks/from-text
POST /api/tasks/:id/run
GET  /api/tasks/:id/events
POST /api/tasks/:id/complete
```

明确点击任务卡时 `task_type` 是权威值，不再用文本重新猜测。自由文本先解析 task_type、confidence、entities 和 missing_fields；低置信度只显示澄清选项。Runner 只向 app-server 暴露当前 Manifest 声明的只读 MCP 工具。

## 15 阶段与不可变迁移

主阶段定义、能力域和推进模式见 `backend/src/stages.ts`；旁路与终态为 `PAUSED`、`LOST`、`REJECTED`、`CANCELLED`、`DISPUTED`、`COMPLETED`。正式迁移会在更新 `collaborations.stage_code` 的同一事务里追加 `stage_transitions`，保存 from/to、reason_code、evidence、推荐者、审批者、发生时间和前后数据版本。查询：

```bash
curl 'http://127.0.0.1:8765/api/stage-transitions?collaboration_id=col_xiaomei'
```

## 怎么跑

**一条命令（推荐）：**

本机先装 Codex 并登录：

```bash
npm i -g @openai/codex
codex login
# 或 export OPENAI_API_KEY=...
chmod +x scripts/start.sh && ./scripts/start.sh
```

ECS / 服务器第一次跑如果缺编译链，先装 `gcc-c++ make python3`（例如 `yum install -y gcc-c++ make python3`），再 `./scripts/start.sh`。`start.sh` 会 `npm install --ignore-scripts=false`，再手动 `prebuild-install` / `node-gyp` / `esbuild/install.js`，不依赖 npm 11/12 的 lifecycle。没有 gcc 时 Host 仍用 **node:sqlite** 写同一 SQLite 文件（不是假库）。

浏览器打开 http://127.0.0.1:8765

生产模式首次打开会进入“创建首位管理员”。登录可用邮箱 **sriphy.yan@amperetime.com**、姓名 **鄢棽**、账号 `sriphy`，或个人资料里保存的手机号；密码 `123456789`。已有 `test` 账号的服务器在启动时会迁成鄢棽。管理员在「管理控制台 → 连接 Starry」或「个人设置 → 连接 Starry」绑定跟进邮箱（例如 `larry.zhao@amperetime.com`）后，首页「我跟进的红人」只显示该邮箱负责人的红人与生命周期。左下角菜单提供「连接 Starry 邮箱」。同一账号可以在左下角菜单切换员工工作台、管理控制台和个人设置；切换只改变界面，权限始终由后端 Session、角色和授权表判定。自动化测试的 `CODEX_MODE=stub` 保留免登录模式。

没有 `codex` 或不登录时，点「写跟进信」会出持久错误（安装/登录指引），**不会**悄悄用模板假信。自动化测试才允许 `CODEX_MODE=stub`。

工作台进程每次新起一个 `codex app-server`（harness），不会接管后台那个 Codex 窗口。同一用户下的 `codex login`（`~/.codex/auth.json`）或 `.env` 里的 `OPENAI_API_KEY` 才会注入。请用下面任一方式：

```bash
codex login
# 或把 key 放进仓库根目录 .env（已 gitignore）：
# OPENAI_API_KEY=sk-...
```

有 key 时按 app-server 协议调用 `account/login/start`，不会只看 `account/read` 就报 `codex_unavailable`。

**Docker：**

```bash
# 二选一：宿主机先 codex login（compose 会挂载 ~/.codex），或：
# export OPENAI_API_KEY=sk-...
docker compose up --build
```

同样是 http://127.0.0.1:8765。宿主机上“已经运行的 Codex 进程”不能跨容器复用；
Compose 会安装 Codex CLI，并挂载 `${HOME}/.codex`、透传 `OPENAI_API_KEY`。

## 远程 Claw / MediaCrawler MCP

真实运行默认使用远程 Streamable HTTP MCP；本地 `claw-server.ts` 只在 `CODEX_MODE=stub`、`CLAW_MODE=mock` 或显式测试模式使用。复制 `.env.example` 为 `.env`，配置：

```bash
CLAW_MODE=remote
MEDIACRAWLER_MCP_URL=http://你的采集服务/mcp
MEDIACRAWLER_MCP_TOKEN=...
```

`scripts/start.sh` 和直接运行 `backend/src/index.ts` 都会读取仓库根目录 `.env`；修改后必须重启 Host。
缺少 URL 或 Token 时会在创建远程任务前返回“远程采集服务未配置”，不会留下一个永久停在“正在分配”的采集任务。

也可以直接使用交付的 `mcp_server.md`。加载优先级为：环境变量 → `MEDIACRAWLER_MCP_CONFIG_FILE`
指定的 Markdown → 仓库根目录 `mcp_server.md` → Cursor 当前项目最新上传的 `mcp_server*.md`。
Markdown 中需包含 `/mcp` 地址和 `Authorization: Bearer ...`；该文件已加入忽略规则，不会提交 Token。

MediaCrawler 服务的自动入库地址设置为：

```text
http://你的工作台地址:8765/api/integrations/mediacrawler/creators
```

达人发现执行链：

```text
Lead Skill 生成采集计划
→ Host 校验平台/模式/关键词或 ID
→ 自动调用远程 start_crawl
→ 持久化轮询 status/logs
→ get_creators 分页读取
→ platform + platform_creator_id 去重入库
→ creator_snapshots + 确定性基础评分
→ 右侧候选达人结果
```

远程服务同一时间只运行一个采集任务，工作台通过数据库锁拒绝第二个并发启动。采集结果只包含平台身份、昵称、粉丝和近期播放；没有可靠联系方式的新达人只进入候选推荐，不生成或推测邮箱。

## 远程 KOL Claw MCP

评分、建联话术、每日任务和预算仍可走另一套 Streamable HTTP MCP（`analyze_creator` 等）。**达人主数据、负责人绑定和状态更新不在这里**，已改走 Starry KOL MCP。复制 `.env.example` 为 `.env`，或直接放入 Cursor 的 `mcpServers` JSON：

```json
{
  "mcpServers": {
    "kol-claw": {
      "type": "streamableHttp",
      "url": "http://your-kol-claw-host:9093/mcp",
      "headers": {
        "Authorization": "Bearer <KOLCLAW_MCP_KEY>"
      }
    }
  }
}
```

加载优先级：环境变量 → `KOLCLAW_MCP_CONFIG_FILE` → 仓库根目录 `mcp_kolclaw.json` / `kol-claw.json` / `mcp.json` → Cursor 当前项目上传的 kol-claw 配置。JSON 和 Markdown 中的占位 Token（如 `<KOLCLAW_MCP_KEY>`）会被忽略。这些文件已加入忽略规则，不会提交密钥。

## 远程 Starry KOL MCP

品牌邮箱、邮件会话、草稿预览，以及红人库查询 / 画像 / 负责人 / 入库走同一套 Streamable HTTP MCP（`starry-kol-mcp`，兼容旧名 `email-mcp`）。不要和 MediaCrawler / KOL Claw 混用。

打 `https://dev-api.askstarry.com/starry/email-agent/mcp` 时必须同时带两个头：

- `X-MCP-API-KEY`：MCP 客户端密钥（如 `email-agent-mcp-dev`）
- `Authorization: Bearer <JWT>`：Starry 登录用户（payload 里的 `user_id`）。邮箱 ACL 和红人可见范围按这个用户算，不是灵工网页登录账号。

只带 API Key 时，网关返回「登录过期」；只带 JWT 时返回缺 `X-MCP-API-KEY`。复制 `.env.example` 为 `.env`，或把 Cursor 的 `mcpServers` JSON 放到已忽略的配置文件：

```json
{
  "mcpServers": {
    "email-mcp": {
      "type": "streamableHttp",
      "url": "https://dev-api.askstarry.com/starry/email-agent/mcp",
      "headers": {
        "X-MCP-API-KEY": "<STARRY_KOL_MCP_API_KEY>",
        "Authorization": "Bearer <STARRY_USER_JWT>"
      }
    }
  }
}
```

对应环境变量：`STARRY_KOL_MCP_URL` / `STARRY_KOL_MCP_API_KEY` / `STARRY_KOL_MCP_BEARER`（兼容 `EMAIL_MCP_*`）。**已存在的环境变量不会被 JSON 覆盖。** 加载顺序：环境变量 → `STARRY_KOL_MCP_CONFIG_FILE` → 仓库根目录 `mcp_starry_kol.json` / `starry-kol-mcp.json` / `mcp_email.json` / `mcp.json`。JSON 和 Markdown 中的占位 Key 会被忽略。这些文件已加入忽略规则，不要把 JWT 提交进仓库。改完后必须重启 Host。

灵工 `/admin` 只能开关 `starrykol` 连接器、给员工授 `read/write`，以及授权 `email_compose` 等技能。不能在管理端粘贴 JWT，也不能改 Starry 的邮箱权限或红人可见范围——那些在 Starry 后台，按 JWT 的 `user_id` 生效。

写信 / 画像 Skill 的 Codex turn 查询链：`pageKolProfiles` → `getKolProfileDetail`（含红人负责人）→ `listKolPlatformData`。更新负责人走 `updateKolProfile`。`decryptKolContact` 属于敏感操作，只有「解密达人联系方式」技能会调用。默认只预览草稿；用户明确回复「确认发送」后才会由 Gateway 调用 `sendEmailNow`。

## 多用户管理与个人数据

- 管理端 `/admin`：员工、技能授权、连接器与访问级别、审批角色、考试下发、留存策略和审计。
- 个人设置 `/settings`：资料、偏好、密码、Markdown 记忆、Cookie 选择、数据占用和会话导出/归档/删除。
- 密码使用 Node `scrypt` 加盐哈希；登录使用 HttpOnly、SameSite=Lax Cookie，生产 HTTPS 下加 Secure。
- 连接器只保存 `credential_ref`，不保存或回显明文密钥。
- 分享链接只读、默认 24 小时、可撤销；默认排除内部过程、中文内部稿、审批字段和私有路径。
- 会话删除会清理消息、草稿、运行箱和可归属附件；不可变 `stage_transitions` 作为合规记录保留。

常用生产配置：

```bash
export APP_ORIGIN=https://your-workbench.example.com
export AUTH_MODE=enabled
export MAX_ATTACHMENT_BYTES=10485760
./scripts/start.sh
```

**开发分体：** 先起 API `cd backend && LINGONG_DATA=../data npx tsx src/index.ts`（默认 8765），再 `cd frontend && npm run dev`（Vite 4177，代理 `/api`）。

运行时不需要 Python。Host / Gateway / Worker / MCP / mock 都在 `backend/`（Hono + better-sqlite3）。

## 被 mock 的东西

| 组件 | 行为 |
| --- | --- |
| Starry Email Agent | 进程内 `/mock/starry`。`…/stage` 只给 Host confirm-stage；`…/conversations/{id}/send` 只给 Gateway。 |
| KOL Claw 0.1.0 | `/mock/claw`。Worker 只读；`POST /ingestions/mediacrawler` 仅 Host。 |
| Codex app-server | **默认真实** `codex app-server`（stdio JSONL，**无** `jsonrpc:2.0`）。Handshake：`initialize` → `initialized` → `account/read`（必要时 `account/login/start` `{type:apiKey}`）→ `skills/extraRoots/set` → `skills/config/write`（一份 SKILL.md）→ `thread/start\|resume` → `turn/start` `{type:skill,name,path}`。一任务一箱，turn 结束杀进程。后台另有 Codex 进程不算已登录。`CODEX_MODE=stub` 仅测试。MCP 线才带 `jsonrpc:2.0`。 |
| 企业邮 / 企微 | 无真实 secret。企微模板卡与「工作审批」共用 `approval_id` / `chain_id`。文案只有「允许发送」或「确认阶段」。 |
| 考试门 | 默认「鄢棽/Sriphy」已通过。学习考试页可切「未过考试 / 无发信权」演示 403。 |

Worker **没有** SMTP、企微 secret、阶段库凭据，也不能发信 / 改正式阶段 / 解密 / ingest。

## QA 点击路径

侧栏品牌必须是 **灵工 工作**，**没有** LiTime logo / 广告语。首页画布里是紧凑横向锁：官方 PNG 在左、英文/中文广告语在右，再下面是 **今天有什么工作要处理？**。首页按线索、商机、谈判、履约、增长、管理完整展示常见 KOL 任务；首页无右侧工作台，进入任务会话后才显示产物工作台。

三条原则：对话干活；点按钮进对话出 Markdown / 黄条 / 清单；**发送 ≠ 推进阶段**。

### KOL 建联发信（T3，@ 技能）

1. 首页点 **KOL 建联发信**（旧文案「KOL 建联发言」同样走 `intent=kol`）。  
   起会话并 `POST /api/sessions/:id/messages`：`{ "text": "KOL 建联发信", "act": "ask", "intent": "kol", "model_tier": "default" }`。无 handle 也起箱，Skill 名是文件夹 `kol`。
2. 工作台输入框打 **`/`**（`@` 同样可用）：弹出技能列表（含 KOL 建联发信）。点选后插入 `/KOL 建联发信` 芯片，发送带 `intent: "kol"`。占位符：**输入 / 使用技能**。
3. **添加资料**（回形针）把文件写到 `LINGONG_DATA/uploads/`，发送带 `attachments: [{name,path}]`，Worker `CONTEXT.md` 里有路径和摘录。不是假上传。
4. 底栏 **技能** → `/skills`，点技能卡 **使用** 走同一 ask。**连接器** → `/admin`。

### 记状态 / 推进（T2，Skill 建议 + 人确认）

1. 任务目录或流水线点击 **提出阶段变更**，通过 `confirm_stage` Skill 分析证据。
2. 中间展示分析摘要与操作过程；右侧出现候选阶段确认块：当前阶段、具体目标、理由和证据。
3. 选 `已回复-有兴趣 / INTERESTED`，填理由，点 **确认写入正式阶段**。
4. 成功只出文本 + Starry 生命周期 / 阶段。**没有**邮件草稿，没有发送。
5. 非法边 400；终态无出边；`expected_version` 冲突 409。每次迁移追加证据化历史，不只覆盖当前状态。

### 催大纲（T7，先看阶段）

1. `@母婴小课`（内容策划）点 **催大纲** → 邮件 Markdown，`keep_stage`。发送不改阶段。
2. `@小美妆日记`（初步接触）点 **催大纲** → **400**，不起箱。会话里红色错误：当前阶段 vs 允许的「已签收-测试中 / 内容策划」。不会消失成成功 Toast。

### 寄样地址核对（T6，无仓库）

1. `@小美妆日记` 点 **寄样地址核对**：缺电话 / 邮编 → **催补邮件**。没有 WMS、没有出库按钮、没有仓库 Host。
2. `@数码老张` 点 **寄样地址核对**：六项齐全 → **仅文本「可以出库」**，不出邮件。

### 发货通知（T9）

1. `@小美妆日记` 点 **发货通知**（口令无运单号）→ **422**，补全（运单号 + 承运商必填，ETA 可选），**不起箱**。
2. 补全后提交，或口令：`给@小美妆日记 发货通知 运单号 SF123456789CN 承运商 SF` → 邮件脚注 **已发货**。发送不自动改阶段。

### 写报价信（T5）

1. 写报价信落草稿。发送不等于改阶段，正式阶段仍是 **报价待确认 / QUOTE_PENDING**。
2. 口令 `金额 200`：Cc 空点发送 → 400；Cc 填内部同事后可发。
3. 费用审批走「费用审批」技能与规则引擎，不再走报价金额档 / 企微令牌。

### 校验并发送原文（PEP）

邮件结果点 **校验并发送原文**。状态：`draft → validating → blocked_* | waiting_approval → sending → sent | send_failed`。

失败留在会话错误 + 红字，并写下一步。**不会**只弹成功 Toast。

演示 403：打开 **学习考试** → 「未过考试」或「无发信权」→ 再发送。测完切回「鄢棽/Sriphy · 已通过」。

From 只能选授权品牌邮箱。一档时锁定文案 **「已按品牌和权限锁定」**。MIME 只用英文原文。发送路径不调用 confirm-stage。

### 未绑定来信（T1）

首页点 **看阶段与在途**。出现 **未绑定来信**：发件人、邮箱、主题、时间、摘要、候选 KOL、搜索、新建、暂缓。黄条 **「无法判断，请人选阶段」**。不自动合并、不 `propose_stage`、不会写「已自动记入」。绑定仍留在本会话，不 resume 另一条线程。`inbound_extract` 不进技能市场。

### 写跟进信（T4，阶段不变）

1. 流水线仍是侧栏资产页；首页“流水线复盘”是 Skill 任务，不再直接跳转资产页。
2. `@小美妆日记` 点 **写跟进信**，或首页选择 **写阶段跟进邮件**。
3. 灰色气泡 + 英文原文 Markdown。三颗按钮：**一键翻译中文（内部）**、**校验并发送原文**、**确认推进阶段**（须选具体目标码）。
4. 发送后阶段仍是 **初步接触**。再选目标并确认，才变成 **已回复-有兴趣**。

### 页面约束（P0）

| 页 | 期望 |
| --- | --- |
    | 管理配置 | 产品经理可用 **sriphy.yan@amperetime.com** / **鄢棽** / `sriphy`，密码 `123456789`。跟进邮箱在个人设置绑定，不在连接器里贴 JWT。登录后可编辑 SOP、把技能分给组织 / 小队 / 个人。飞书多维表 / 本地文件夹标「本期隐藏」。`test` 账号已取消。 |
| 定时任务 | 只有 **T8 失联与延期扫描**。 |
| 技能市场 | 只有官方 KOL 技能。无经营复盘 / 数据清洗 / 周报。 |
| 最近会话 | 不出现加班申请 / 华北渠道（或标「平台示例·非本期」且不可点）。 |
| 工作审批 | 只有报价令牌，无加班 / 删文件壳。 |
| 流水线 | 按 Lead / Opportunity / Negotiation / Execution / Settlement-Growth 分组；旁路与终态单列台账。 |

## 架构要点

代码与 Skill 地图、Codex harness 步骤见 `docs/90-codebase-handbook.md`。

- 固定按钮 `POST { text, model_tier, intent, collaboration_id, attachments? }`。Host 再校验；前端 intent 不能跳过 PEP。
- 意图：`stage_mail` `confirm_stage` `quote_confirm` `content_nudge` `stage_read` `addr_check` `ship_notice` `kol` `risk_scan` `creator_profile`。`KOL 建联发信` / `建联发言` / `@KOL 建联发信` 都是 `kol`。`达人画像` / `创作者画像` 走 `creator_profile`（Host 快照，MCP 审批拦住时不现场拉数）。自由文本里的报价 / 金额 / rate / CPM 升为 T5，不走 T4。
- `POST /api/drafts/:id/send`：PEP → Gateway → Starry send。**绝不** confirm-stage。`keep_stage=true`。
- `POST /api/sessions/:id/confirm-stage`：必须带具体 `stage_code` + `expected_version`。**绝不**发信。
- 正式阶段为 15 个主阶段；能力域是 Codex Profile，不是独立运行时。旁路与终态单列。
- 首页任务目录的每一项都映射到独立 `SKILL.md`，统一执行 Skill → Thread → Turn → Item；中间只显示安全分析摘要和操作过程，结构化结果进入右侧工作台。

## 测试

```bash
cd backend && npm test
# API 合同测试强制 CODEX_MODE=stub。默认进程仍是真 Codex。
cd frontend && npx playwright install chromium && npx playwright test
# Playwright 自己起 CODEX_MODE=stub 的 8876 端口，不复用 start.sh 的 real Codex。
```

没有登录时，点「写跟进信」应看到 Codex 安装/登录错误，正文里不能出现模板句 `Following up — LiTime collab kit`。登录后应是模型写的英文原文。

API 合同测试覆盖发信门禁、阶段闸门，以及「无 Codex 不合成假信」。
