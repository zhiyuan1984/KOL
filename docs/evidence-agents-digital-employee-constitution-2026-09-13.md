# Agents「我的智能体」宪法审查：是否为数字员工页（2026-09-13）

对照基准：`origin/main` @ `aeb76fc`（2026-09-13 远程最新）。只读、无代码改动、无 LIVE。本文件是审查记录，不是实施单。

**事实 vs 建议：** 带「事实」的段落只陈述仓库现状；带「建议」的段落是未实施选项。

---

## 一行结论

`宪法冲突成立`

用户判断成立：当前 `/agents`「我的智能体」不是 `DigitalEmployee` 页，而是 Codex Profile + Agent `employee_views` + Skill 意图的拼盘任务启动器；工作页复用首页 board 推荐/红人/待办，违背员工端对象抽象。旧 CTA「用此智能体开始 / 在会话里用」已不在树里；现行 CTA 仍以 Skill 意图开工。`19` 四页法律（Home / Pipeline / Chat / Admin）甚至没有把 `/agents` 列为员工主表面，与 `00`/`02` 的数字员工对象并存条款间张力。

---

## 冲突矩阵

| # | 条款 | 现状（事实） | 判定 |
|---|---|---|---|
| 1 | `00-platform-charter.md` L5、L17：像配置岗位一样创建数字员工；声明式业务层首项是 `DigitalEmployee`，再才是 Agent / Workflow / Skill / Policy | 全仓库无 `DigitalEmployee` / `digital_employee` 实现。员工 `/agents` 标题是「我的智能体」，数据是 Profile + manifest `entries`/`teams` + Home board + session/task。管理端「员工」是真人 `users`，不是数字员工 | **冲突** |
| 2 | `04-ux-ui-system.md` L9、L49 `UX-COPY-ENGINE`：员工端隐藏 MCP / Codex / Thread / Skill 时序；只看任务、结果、证据 | 默认视图已藏 Codex/MCP 词（E2E 断言）。但英雄区链到 `/skills`「技能目录」，开工 CTA 锁 `intent`/`skillId`，说明书页再链技能目录。侧栏把「技能目录」放在员工「智能体」组 | **冲突**（引擎词部分合规，Skill 作为员工对象不合规） |
| 3 | `04` L13 + `19` L78–L87：员工端只有四页主表面（Home / Pipeline / Chat / Admin）；跨页复制 IA 违约 | `/agents` 仍是侧栏一级入口。工作页「推荐下一步」读 `GET /api/home/board` 的 recommendations / kols / tasks，与首页「今天推荐」同源 | **冲突** |
| 4 | `05-agent-workflow-skill-policy.md` L5–L8：Agent = 发布包；Skill = 可复用意图契约；Policy = 范围与闸门。层次分离 | 员工页把 Codex 能力域 Profile、manifest 入口（带 `skillId`）、团队步骤（Skill 序列）和 session 运行态铺在同一路由。开工 = `createSession` + `storePending({ intent })` | **冲突** |
| 5 | `14-implementation-contract.md` L29、L40–L56：`agents/<id>/manifest.yaml` 是 Agent 发布入口，含 skills / workflows / policies / mcp，不是员工岗位名册 | `GET /api/agent-manifest` 只投影 `employee_views.entries/teams`。entries 是「KOL/审批/爬虫智能体」+ `skillId`。无 DigitalEmployee schema，无岗位/知识范围/可用 Agent 字段 | **部分合规 / 对象错位**：manifest 确是发布入口；投影的是 Skill 入口图，不是数字员工 |
| 6 | `19` L76 P0「Agents 是工作入口」+ L42–L47 禁止教练式「下一步」 | 工作页第一节就是「推荐下一步」，空态再推技能目录。该 P0 把 `/agents` 写成启动器，与 `00`/`02` 岗位对象和 `19` 自己的四页表互相打架 | **条款内冲突**；现状站在「启动器」一侧，仍不是数字员工 |
| 7 | `00` L27 / `04` L29 / `19` L49–L53：发送 ≠ 阶段；一句安静说明即可 | 英雄区、团队 summary、Chat 都写「发送不等于改阶段」。不变量本身正确，但 Agents 英雄区把它和「技能目录」绑在同一句开工说明里 | **不变量未破；文案位置过噪** |

---

## 用户判断核实

> 当前 `/agents`「我的智能体」不是数字员工页，而是 Agent/Profile/Skill 拼盘任务启动器，与首页重复并违背员工端抽象。

| 分句 | 成立？ | 证据 |
|---|---|---|
| 不是数字员工页 | **成立** | `DigitalEmployee` 只出现在 `docs/00` L17、`docs/01` L13、`docs/02` L5。代码/schema/API 零命中。页标题与侧栏是「我的智能体」（`Agents.tsx` L220；`Workbench.tsx` L208–L210） |
| Agent / Profile / Skill 拼盘 | **成立** | 同页消费 `api.profiles()`（Codex 六域）、`useAgentManifest()`（entries/teams + skillId）、Home board 推荐（intent=Skill）、失败任务的 `skill_id`。说明书 tab 渲染 Profile 卡并链 `/skills` |
| 任务启动器 | **成立** | 主 CTA 走 `startAgentWork` → `api.createSession` + `storePending({ text, intent })`（`agentWork.ts` L350–L383）。团队「从第一步开始」同样 `createSession` + 预填 `step.prompt`（`Agents.tsx` L165–L181） |
| 与首页重复 | **成立** | Agents 工作页 `buildAgentNextSteps({ recommendations, kols, tasks, entries })`（`Agents.tsx` L103–L110）。Home「今天推荐」读同一 `workbench.recommendations`（`Home.tsx` L1476–L1492；`home-board.ts` `buildRecommendedTasks` L449–L499） |
| 违背员工端抽象 | **成立** | 员工对象应是岗位数字员工（`02` L5）或今日任务（`04` L9、`19` L84 Home）。现状对象是 Skill 意图 + Codex Profile + 会话 |
| 「用此智能体开始 / 在会话里用」 | **已不在树** | `git log -S` 只打到 `c5b5323`（Reframe employee Agents page as a work surface）之前。现行 CTA 见下节 |

---

## 用户四层 IA 与宪法

用户主张：首页 / 数字员工 / 数字部门 / 管理端。

| 用户层 | 与宪法 | 说明 |
|---|---|---|
| 首页 | **一致** | `19` L84 Home = 「现在做什么」；`04` L15–L17 任务驱动 |
| 数字员工 | **对象层一致，页面层不一致** | `00`/`02` 把 `DigitalEmployee` 写成声明式业务对象。`19` L78–L87 员工主表面只有 Home / Pipeline / Chat / Admin，没有数字员工页。`19` L76 又把 `/agents` 写成「工作入口」 |
| 数字部门 | **名称未入宪** | 宪章组织树是真人 `OrganizationUnit`（`01` L8–L17：center / department / team）。`AgentTeams` / manifest `teams` 是 Skill 步骤编组，不是数字部门。把「建联小队」当成部门会再塌一层 |
| 管理端 | **一致** | `04` L9、`19` L87 Admin = 组织 / 授权 / 连接器 / Trace / 审计。现状管理端「员工」是真人账号（`AdminConsole.tsx` L61–L62、L95–L110），Skill/MCP 在管理端是对的 |

**IA 结论（事实）：** 用户四层更贴近 `00`/`01`/`02`/`05` 的对象分层；`19`/`04`（2026-09-13 Pipeline 修订后）的页面法律是任务四页，不承认数字员工/数字部门为对等主表面。两套宪法文本已经打架。采纳用户 IA 必须先改 `19` 四页表与 `04` L13，不能只改前端。

**不把用户 IA 解释成可以再加第五个启动器。** 若将来有数字员工页，它应是岗位对象 + 卡片运行态，而不是第三份「今天推荐」。

---

## 逐条证据

### 1. `docs/00-platform-charter.md` 数字员工愿景

- L5：愿景拆成三句——配置**岗位（数字员工）**、编排 **Skill**、发布 **Agent**。三者不是同一物。
- L17：声明式业务层顺序是 `Digital Employee、Agent、Workflow、Skill、Policy`。
- L20：体验层只有「员工端业务工作台、管理端资产/Trace」，没有「员工端技能图鉴」。
- L27：发送、阶段变更、导入、解密、删除不得隐式合并（与英雄区那句相关，但不授权把 Skill 当员工）。

### 2. `docs/04-ux-ui-system.md` 员工端隐藏 Skill / MCP / Codex

- L3：员工完成业务任务，不是学习引擎。
- L9：员工端展示任务 / 品牌 / KOL / SOP / 草稿 / 待确认 / 结果 / 证据 / 下一步 / 异常接管；**隐藏** MCP、Codex、Thread、Skill 时序、原始堆栈、连接器配置。
- L13（`origin/main` 新增）：四页分工以 `19` 为准；Pipeline 不得复用首页待办桶或会话技能启动器。Agents 工作页同样在复用首页待办/推荐，违约形态与 Pipeline 曾被禁止的那种相同。
- L15：首页推荐只锁定/预填 Skill，不自动执行——这是 Home 的规则，不是「再做一页 Skill 启动器」的授权。
- L29：发送 ≠ 阶段。
- L49 `UX-COPY-ENGINE`：员工端不出现 MCP / Codex / Thread / Skill / 原始堆栈。

默认 `/agents` E2E 已断言 body 不含 `Codex` / `Starry KOL MCP`（`frontend/e2e/workbench.spec.ts` L1489–L1490）。**词藏了，对象没藏：** 英雄区 L222–L224 仍写「技能仍走技能目录」。

### 3. `docs/05-agent-workflow-skill-policy.md` 层次分离

- L5 **Agent**：岗位目标、角色语气、知识和可用能力的**发布包**。
- L6 **Workflow**：入口、步骤、分支、完成条件。
- L7 **Skill**：一个可复用业务意图的契约。
- L8 **Policy**：范围、风险、审批、白名单。
- L10：Agent 不拥有独立运行时。
- L43：业务入口必须是已发布 Skill；前端不得直接发信或改阶段。

「入口是 Skill」指 Host 执行入口，不是员工 IA 的一级对象。把 Skill 步骤编成「智能体团队」给员工点，是把第 3 层抬到第 1 层。

### 4. `docs/14-implementation-contract.md` Agent manifest 作为发布入口

- L29：必备资产 `agents/<agent-id>/manifest.yaml`。
- L40–L56：最低结构是 `id/version/owner_ref/organization_scope/brand_scope/skills/workflows/policies/mcp_servers`。
- L60：员工端消费**业务字段**，管理端消费 Trace。

实现（事实）：

- 发布包存在：`agents/kol/manifest.yaml` L1–L20（`id: agent:kol`，skills/workflows/policies/mcp）。
- 员工投影：同文件 L21–L54 `employee_views.entries[]` / `teams[]`，每条带 `skillId` 或 `steps[].skillId`。
- API：`backend/src/routers/tasks.ts` `tasks.get("/agent-manifest")` L180–L191，只回 `id/version/status/publish_gate/entries/teams`。
- 读取：`backend/src/contract-scope.ts` `kolAgentManifest()` L69–L72。
- `docs/17-code-conformance-scan.md` L114 把「员工端 Agent 目录已迁移到 employee_views」标成已修复——这固化的是**目录**，不是数字员工。

### 5. `frontend/src/pages/Agents.tsx` 数据源、文案、CTA

**数据源（L62–L70，事实）：**

| 调用 | API | 用途 |
|---|---|---|
| `api.profiles()` | `GET /api/profiles` | 说明书 tab：Codex 六域 |
| `api.connectors()` | 连接器列表 | 仅 `debug` 远程图例 |
| `api.sessions()` | `GET /api/sessions` | 运行中 / 最近在用 |
| `api.homeBoard()` | `GET /api/home/board` | 推荐、红人、待办 →「推荐下一步」 |
| `api.tasks({ status: "failed" })` | `GET /api/tasks?status=failed` | 失败列表 |
| `useAgentManifest()` | `GET /api/agent-manifest` | 团队 tab；下一步不足 3 条时用 `entries` 垫目录 |

**不再调用** `api.skills()`。`docs/evidence-wait-status-plan-2026-09-13.md` L316 写「加载 profiles / skills / connectors / manifest、不调用 sessions」——相对当前树**过期**。

**文案（事实）：**

- L219–L224：kicker「智能体」；h1「我的智能体」；「从今天的合作开工。说明书收在后面，技能仍走技能目录。发送不等于改阶段。」
- L38–L41 tab：工作 / 团队 / 说明书。
- L264「推荐下一步」；L294「最近在用」；L332「运行中」；L357「失败」。
- L396：「预设编组，不是群聊。每一步仍走已发布动作。」
- L451：说明书「要开工请回到工作或去技能目录」。

**CTA（事实；用户点名的旧文案已不在）：**

| 用户点名 | 现状 |
|---|---|
| 用此智能体开始 | 无。下一步按钮用 `step.cta`：`写邮件` / `补画像` / `分析回复` / `风险扫描` / `记状态` / `开始` / `回到会话` / `接着做`（`agentWork.ts` `ctaForIntent` L181–L187、`stepFromKol` / `stepFromTask`） |
| 在会话里用 | 无。最近会话是「继续」（`Agents.tsx` L306）；运行中是「回到会话」（L344） |
| 技能目录 | **仍在** 英雄区 L223、说明书 L451/L476，侧栏 `Workbench.tsx` L218–L220 |
| 发送不等于改阶段 | **仍在** 英雄区 L224；manifest 团队 summary 也有（`agents/kol/manifest.yaml` L28、L42） |

开工函数：`onStart` → `startAgentWork`（L146–L163）。记住 journey `kind: "skill"`。`startRecent` CTA 文案是「再开一单」（L207）。失败「重试」走已有 `POST /api/tasks/:id/run`（`retryFailedTask`，`agentWork.ts` L302–L317）。

### 6. `frontend/src/pages/AgentTeams.tsx` 是否只是预设编组

**是。** 该文件只有重定向：

```3:5:frontend/src/pages/AgentTeams.tsx
/** Teams live on /agents?tab=teams so employees don't get a second catalog. */
export default function AgentTeams() {
  return <Navigate to="/agents?tab=teams" replace />;
```

团队内容在 `Agents.tsx` L392–L444：遍历 `manifest.teams`，展示 `profileIds` + `steps`（label / skillId / prompt），主按钮「从第一步开始」只开会话并预填第一步 prompt。没有组织单元、没有部门编制、没有数字员工成员、没有运行时编组。文案自己写了「预设编组，不是群聊」。

### 7. 相关 API

| API | 符号 | 员工页角色 | 是不是数字员工 |
|---|---|---|---|
| `GET /api/agent-manifest` | `tasks.get("/agent-manifest")` `backend/src/routers/tasks.ts` L180–L191；客户端 `api.agentManifest` `frontend/src/api.ts` L547 | 团队步骤 + 目录垫片 | 否。Agent 发布包的 `employee_views` |
| `GET /api/profiles` | `misc.get("/profiles")` `backend/src/routers/misc.ts` L171；`publicProfiles()` `backend/src/profiles.ts` L94–L99 | 说明书卡 | 否。`CODEX_PROFILES`（Commander/Lead/…），`harness: "codex-app-server"`。测试：`host-contracts.test.ts` L868–L872「capability domains on one Codex harness」 |
| `GET /api/skills` | `misc.get("/skills")` `misc.ts` L104–L106 | Agents 页不再直接打；`/skills` 与 Composer 仍打 | 否。已授权 Skill 目录 |
| `POST /api/sessions` | `host.post("/sessions")` `backend/src/host/api.ts` L2646–L2667；`api.createSession` `frontend/src/api.ts` L638–L642 | 工作/团队/最近芯片的唯一开工写路径（有 collaboration 则 `openKolSession`） | 否。建会话，不建数字员工，不改阶段 |
| `GET /api/sessions` | `host.get("/sessions")` L2691–L2718；每行 `d.agent_status = sessionStatus(id)` | 运行中 / 最近 | 会话运行态，不是岗位对象 |
| `GET /api/home/board` | `buildWorkbench` `home-board.ts` L472–L499 | 推荐下一步 | 首页投影的复本 |
| `GET /api/tasks?status=failed` | `tasks.get("/tasks")` `tasks.ts` L193+ | 失败重试 | WorkItem，不是数字员工 |

`POST /api/sessions` 只插入 `sessions` 行（title / owner）。副作用闸门仍在会话内的发送卡 / `confirm_stage`。**发送不等于改阶段在 API 层仍然分开**；Agents 页把这句印在启动器上，并不等于它在管阶段。

---

## 与 `docs/evidence-wait-status-plan-2026-09-13.md` 的关系

避免两份审查互相踩：

| 等待态方案（建议，其中运行壳已落地） | 本审查 |
|---|---|
| L4 / L297–L309：Agents 用现有 session / failed task 拼「运行中 / 最近 / 失败」 | **保留。** `Agents.tsx` L113–L132、L292–L388 已接线；5s 轮询 + `visibilitychange`。不要回退 |
| L316–L320（事实段）：页不读 sessions、无运行分区、只 `startSkill` | **过期。** 以本文件第 5 节为准，不要再引用那段当现状 |
| L349–L356：运行态是 session `agent_status` 与 failed work item，不是新状态机 | **仍成立。** 运行态是卡片状态 |
| 未写明员工对象 | **本文件补口：员工端对象是数字员工（宪章），不是技能目录，也不是「推荐下一步」列表** |

**兼容写法（建议，不实施）：** 「运行中 / 最近 / 失败」挂在数字员工卡片上（谁在跑、上次谁用过、谁失败），不要再做成第三份技能目录，也不要为了展示运行态继续堆 Home 推荐。

**禁止的冲突改法：** 为了等状态把 `/agents` 更深地做成 session/task 启动器；或为了数字员工把已落地的运行壳删掉。

---

## 最小改造方案（建议，不实施）

原则：员工端对象 = 数字员工；运行态 = 卡片状态；Skill / Profile / MCP / Codex = 管理端或调试。不 LIVE。不改状态机、不发信、不写阶段。

### FE-only 可做（仍不是真数字员工）

1. **去掉与 Home 重复的启动器。** 删除「推荐下一步」对 `homeBoard.recommendations/kols/tasks` 和 `manifest.entries` 的垫片；空态指向 Home，不指向 `/skills`。
2. **去掉员工主路径上的技能目录 CTA。** 英雄区、说明书、侧栏「智能体」组的 `/skills` 链收进管理端或 `debug`。
3. **说明书 tab 不要再当 Codex Profile 图鉴。** 默认不渲染 `GET /api/profiles`；`harness` 已只在 debug 显示，整卡都应离开员工默认路径。
4. **团队 tab 保持「预设编组」诚实，或从员工侧栏拿掉。** 不能 FE-only 变成数字部门。
5. **保留运行中 / 最近 / 失败壳。** 继续用 `GET /api/sessions` + `GET /api/tasks?status=failed` + 现有 `runTask`。这是卡片状态，不是目录。
6. **不要**用 Profile 或 `employee_views.entries` 冒充数字员工名册（那只是换皮启动器）。
7. **不要**画接管、次数冷却重试、假 `failed` session（与等待态方案相同）。

FE-only 上限：能停止违宪展示，不能产生 `DigitalEmployee` 实体。把 Commander/Lead 改名叫「数字员工」算再违宪。

### 必须后端 / manifest schema（没有这些就没有数字员工页）

1. **`DigitalEmployee` 机器可读资产。** 按 `02` L5：`id`、岗位身份、目标、知识范围、权限、`available_agents[]`、组织/品牌范围。落到 `14` 的必备资产表（新目录或 `agents/*/employees/*.yaml`），校验进 `validate:contracts`。
2. **Agent manifest 保持发布包。** 不要把数字员工塞进 `employee_views.entries[].skillId`。员工 API 应是 `GET /api/digital-employees`（名册 + 范围），运行投影可另挂 `running_since` / `last_session_id` / `last_outcome`（等待态方案 L360–L367 的 session 投影可挂在员工上，不要发明 `sessionStatus=failed`）。
3. **数字部门若要做：** 挂 `OrganizationUnit`（`01`），成员是 DigitalEmployee，不是 Skill 步骤。当前 `employee_views.teams` 不能改名了事。
4. **管理端：** 创建/发布数字员工与发布 Agent 分开。现状 `AdminConsole`「员工」继续管真人；不要混进同一张表。
5. **先改 `19` 四页表 + `04` L13。** 否则前端无法合法增加「数字员工 / 数字部门」主表面。条款冲突不解决，任何 PR 都会被另一份宪法打回。
6. **会话开工仍走已发布 Skill / Host 闸门。** 数字员工页选的是「谁来干」，Chat 里才锁定 Skill。不把 `createSession` 改成写阶段。

### 明确不做

- 本审查不改代码、不改 manifest、不改 API、不改 `19` 正文。
- 不实施上述 FE 或后端方案。
- 不跑 LIVE（不发信、不写阶段、不改远程生命周期）。
- 不把等待态方案的运行壳从 `/agents` 拆掉。
- 不更新 `docs/README.md` 索引（本次只新增本文件）。
