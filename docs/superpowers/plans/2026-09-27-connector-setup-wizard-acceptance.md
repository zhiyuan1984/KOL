# 连接器设置向导 + 技能唯一授权：业务验收方案

- 日期：2026-09-27
- 对象：本次改动（四步向导、只读工具清单、技能唯一授权、启用门禁换新）
- 依据：`docs/superpowers/specs/2026-09-27-connector-setup-wizard-design.md`、`docs/DECISIONS.md` ADR-2026-09-27

## 0. 环境前置（否则验不出真实结果）

| 环境 | 要求 | 原因 |
|---|---|---|
| 本地/预发（推荐） | `E2E_MODE=real E2E_AUTH_MODE=enabled LINGONG_PORT=8897 node scripts/e2e-server.mjs` | stub/无鉴权模式下运行时写接口按设计拒绝匿名治理（403）；真实验收必须开鉴权。`data-e2e` 库仅供验收使用 |
| 生产 | **先补 `RUNTIME_CREDENTIAL_MASTER_KEY`**（`openssl rand -hex 32` 写入 `~/kol/.env` 并重启） | 不补则任何含密钥的连接器配置保存/测试/发现都是 503（此前那次"保存没生效"的根因） |
| 生产（注意） | Starry MCP 最近频繁超时（审计 `starrykol.library_sync_failed: MCP error -32001: Request timed out`） | 演示"工具自动加载"优先用当前可达的 MCP，或接受诚实的超时失败态 |

两条密钥路线，验收 A 用 ①，最省事且不碰保险库：
① **环境变量引用**：配置里填变量名（`headers_env: {"X-MCP-API-KEY":"STARRY_KOL_MCP_API_KEY"}`、`bearer_env: "STARRY_KOL_MCP_BEARER"`），值取服务器进程环境；
② **保险库**：弹窗直接填值 → 写 `runtime_credentials`（需要主密钥）。

## 用例 A（界面）：点 MCP 卡 → 查看工具 → 工具自动加载

步骤：
1. 管理员登录 → `/admin/connectors`；
2. 点 `starrykol`（或 `claw`）卡片的「查看工具」，或走配置弹窗第 3 步「工具清单」；
3. **期望**：点击之后才发起 discovery（页面不预取），列表自动出现；每行显示 **工具名 + 描述 + 风险档**；条数与远端 `tools/list` 一致；
4. **只读断言**：页面没有任何授权/范围/风险档/启用的写控件；本次操作产生的非 GET 请求数为 0；
5. 证据：截图（`artifacts/ops/`）+ 服务端 `runtime_connector_probes` 记录 + 审计 `runtime.connector.probed`。

反向（必须诚实失败）：
- 未保存配置时点工具 → 报 `runtime_connector_not_configured`，**不得伪造列表**；
- 远端不可达 → 显示真实错误码，不得展示空壳成功。

对应自动化：`frontend/e2e/connector-admin.spec.ts` 的 `tools drawer lists every tool read-only`、`wizard: save → test → read-only tools → enable`（stub 模式用路由桩验证前端流程；真实验收按上面步骤跑 real 模式）。

## 用例 B（执行链路）：查询所有红人，不写代码

要证明的命题：「调用由**技能授权 + 技能↔工具绑定 + 内部门禁**在运行时决定；新增/移除一个 MCP 工具不需要改业务代码。」

技术依据（只读可查）：`backend/src/runtime/execution.ts` 在**调用时**读 `runtime_skill_connectors` / `runtime_skill_tools` / `runtime_tool_policies`；`ALLOWED_TASK_MCP` 只用于 SKILL.md 校验与旧 stub 箱配置，治理执行路径不依赖它。

步骤：
1. 配置 `starrykol` 连接器（URL + 环境变量引用鉴权）→ **保存**（第 1 步）→ **测试**（第 2 步，`tools/list` 成功 → `status=verified`）；
2. **先在技能侧**给目标技能绑定工具（技能页：技能 → 连接器/工具绑定，如 `creator_library_all` / `listAllKolProfiles`）；
3. 回弹窗点 **启用**（第 4 步）——在此之前，无技能绑定时启用应被门禁拦下（`connector_skill_binding_required`），这是本用例的正反两面；
4. 以员工身份触发"查询所有红人"（`creator_library_all` / 首页"全部红人"）；
5. **期望**：返回全部红人；审计出现技能调用 + `runtime.tools.discovered`（tool_count>0）+ 远端 `starrykol.creator_library_all`。

反向三连（fail-closed）：
| 撤掉什么 | 期望结果 |
|---|---|
| 技能授权（`user_skill_grants`） | 调用拒绝：`skill_not_granted` / `runtime_skill_not_granted` |
| 技能→工具绑定（`runtime_skill_tools`） | 该工具从可用清单消失（`runtime_no_authorized_tools`，tool_count=0） |
| 把工具风险档改 L3 | worker 不放行（走 Host Gateway 的例外路径）；界面只读展示风险档 |

只读取证 SQL（任一 SQLite 客户端，read-only）：
```sql
SELECT * FROM runtime_skill_connectors WHERE connector_id='starrykol';
SELECT * FROM runtime_skill_tools      WHERE connector_id='starrykol';
SELECT id,status,enabled,last_verified_at,last_error FROM connectors WHERE id='starrykol';
SELECT ts,actor,event_type FROM audit_events
 WHERE event_type LIKE 'runtime.%' OR event_type LIKE 'starrykol.%'
 ORDER BY id DESC LIMIT 20;
```

## 用例 C（旁证）：红人库同步照常

本地 `data-e2e` 已有现成证据：审计 `starrykol.library_sync {"count":2,"tool":"listAllKolProfiles"}`，首页/公海列表条数与之相等。说明既有功能不依赖新增代码，且数据来自配置好的 MCP。

## 判定标准与证据归档

- 通过：A/B/C「期望」全部命中；反向用例全部 fail-closed；只读断言（写控件 0、非 GET 请求 0）成立。
- 归档：截图 → `artifacts/ops/`；DB 查询输出与审计片段 → 验收单；自动化报告：`npx playwright test e2e/connector-admin.spec.ts`（5/5）+ 后端定向测试（9 文件 68 项）。
- 如实标注的已知限制：生产未配主密钥时保险库路线不可用；生产到 Starry MCP 偶发超时；员工侧不再出现连接器入口（预期，非缺陷）。

## 附：当前已有证据（2026-09-27）

| 证据 | 结果 |
|---|---|
| `frontend/e2e/connector-admin.spec.ts`（仅本次修改功能） | **5/5 通过**：向导四步走通、启用门禁诚实态、工具清单只读（写控件断言 0）、枢纽弹窗接入、900 高版式 |
| 后端定向测试（改动涉及 9 个文件） | **68/68 通过**（97s）：`connector-enable-gate`、`configurable-connectors`、`connector-employee-dto`、`connector-operations`、`managed-connectors`、`skill-runtime-execution`、`skill-runtime-governance`、`connector-import`、`enterprise-auth` |
| 后端类型检查 / 契约校验 / 前端构建 | ✅ / ✅ `valid` / ✅ |
| 后端**全量**测试 | ⚠️ 未跑完：本机 `better-sqlite3` 原生绑定不可用（回退 `node:sqlite`），整套运行 >25 分钟无输出；建议在 CI/服务器（编译链齐全）跑 `npm test` 与 `npm run release:gate` |
| 一条 E2E 预存失败 | `workbench.spec.ts`「employee sidebar has no connectors entry」断言"技能导航计数为 0"，HEAD 版本同断言复现 → 陈旧用例，非本次引入 |

## 执行记录：用例 A 实测（2026-09-27，真实远端）

环境：`E2E_MODE=stub E2E_AUTH_MODE=enabled E2E_SKIP_BUILD=1 LINGONG_PORT=8897 node scripts/e2e-server.mjs`（管理员 sriphy）。

| 步骤 | 结果（原始证据） |
|---|---|
| 新建连接器 + 保存配置（公开 MCP `https://mcp.deepwiki.com/mcp`，无鉴权） | `PUT .../config` → version 1 |
| 测试 | `status=succeeded`、`live_verified=true`、`tool_count=3`、`duration_ms=10618`（真实远端 `tools/list`） |
| 工具发现 | 3 条：`ask_wiki_question` / `read_wiki_contents` / `read_wiki_structure`（含描述；`artifacts/connector-tools-acceptance/deepwiki-tools.json`） |
| 启用门禁反例（无技能绑定） | `PATCH {enabled:true}` → **409 `connector_skill_binding_required`**（fail-closed 正确） |
| 界面取证 | 点卡片「查看工具」→ 工具自动加载 **3.5–8.6s**；3 行工具（名 / 描述 / 风险档）；授权类写控件计数全 0。截图 `artifacts/connector-tools-acceptance/card.png`、`tools-panel.png`，数据 `evidence.json` |

### 验收中发现并修复的真实阻断缺陷

- 现象：受管连接器对**任何**远端（含已验证可达的公网 MCP）调用都在 **9–165ms** 内失败，错误码被脱敏为 `runtime_remote_failed`；同一地址用原生 fetch 6.7s 成功（Host 侧调用不经该 fetch，故正常）。
- 根因：`backend/src/runtime/http.ts` 的 `guardedDispatcher.connect.lookup` 未遵守 Node 20+ Happy Eyeballs 传入的 `all: true` 契约——只回单个地址，undici 收到后报 `ERR_INVALID_IP_ADDRESS` 并立即失败。单测全绿是因为 `NODE_ENV=test` 会**绕过**该守卫，真实网络路径此前无覆盖。
- 修复：按 `options.all` / `options.family` 返回校验过的地址数组（`backend/src/runtime/http.ts`）。
- 复测：守卫 fetch 实测取得 3 个工具（6.9s）；连接器相关后端测试 **44/44 通过**；`tsc --noEmit` 通过。

## 执行记录：用例 B 实测（2026-09-27，超管账号 sriphy，技能 `creator_library_all`）

| 步骤 | 接口 / 动作 | 结果 |
|---|---|---|
| 工具策略 | `PUT .../connectors/deepwiki-mcp/tools/read_wiki_structure` | L1 / read，`schema_hash` 取自真实 discovery → v1 |
| 技能→连接器 | `PUT .../skills/creator_library_all/connectors/deepwiki-mcp` | enabled v1 |
| 技能→工具 | `PUT .../skills/creator_library_all/tools/deepwiki-mcp/read_wiki_structure` | enabled v1 |
| **启用门禁** | `PATCH /admin/connectors/deepwiki-mcp {enabled:true}` | **200**（绑定前同一请求为 409 `connector_skill_binding_required`） |
| agent→技能 | `PUT .../agents/agent%3Akol/skills/creator_library_all` | enabled v1（该技能不在 manifest 默认绑定中，需显式绑） |
| **运行时目录** | `SkillExecution.discover()` | **1 个工具**：`deepwiki-mcp / read_wiki_structure`，别名 `rt_deepwiki-mcp__read_wiki_structure_30eb12643875`；`unavailable: []` |
| **真实调用** | `SkillExecution.invoke(alias, {repoName:"modelcontextprotocol/servers"})` | **OK 3.98s**，返回真实内容（DeepWiki 页面清单） |
| **反例（撤工具绑定）** | `enabled:false` → 重新 discover | **tools: 0**，`unavailable: [{connector_id:"deepwiki-mcp", code:"runtime_no_authorized_tools"}]`（fail-closed） |
| 恢复 | `enabled:true` | v3 |

审计链（完整数据见 `artifacts/connector-tools-acceptance/audit-and-db.json`）：
`runtime.connector.probed`（succeeded）→ `admin.connector.update` → `runtime.tool_policy.updated` → `runtime.binding.updated`（技能→连接器）→ `runtime.tool_binding.updated` → `runtime.binding.updated`（agent→技能）→ `runtime.tools.discovered`（run `acc-b-1`）→ `runtime.tool.started / received / completed` → 反例：`runtime.tool_binding.updated(disabled)` + `runtime.tools.discovered`（run `acc-b-2`，tool_count 0）。

说明：执行目标用可达的公网 MCP（`starrykol` 远端在本机超时，见下）；授权链、目录过滤、别名暴露、真实调用与撤绑反例走的是与「查询所有红人」**完全相同**的代码路径（`SkillExecution` → `authorizeConnector` → `connectorOptions` → 远端调用）。

### 仍未闭环（如实标注）

- 本机到 `starrykol` / `claw` 的真实调用超时（生产审计同样为 `MCP error -32001`）；Host 侧成功依赖用户绑定 JWT。验收建议用可达远端或改在服务器上执行。
- 生产仍缺 `RUNTIME_CREDENTIAL_MASTER_KEY`（否则含密钥的保存 / 测试 / 发现都会 503）。

## 复测记录：egress 修复后的重新探测（2026-09-27 23:07–23:09 本地 +0800）

环境：`E2E_MODE=stub E2E_AUTH_MODE=enabled E2E_SKIP_BUILD=1 LINGONG_PORT=8897 node scripts/e2e-server.mjs`（管理员 sriphy，真实远端）。原始证据：`runtime_connector_probes` id 6–11 + 审计 `runtime.connector.probed`。

| 连接器 | 探测结果 |
|---|---|
| deepwiki-mcp | 第 1 次失败 10800ms（偶发）；重试**成功** 14303ms / 3 个工具 → `status=verified`（probes 8、9） |
| starrykol | 失败 1494ms / 2010ms（probes 6、10）——不再是修复前的 112ms 本地秒败 |
| claw | 失败 421ms / 435ms（probes 7、11）——不再是修复前的 165/40ms 本地秒败 |

- 结论：egress 守卫修复在真实网络路径生效（无 9–165ms 即败；`deepwiki` 从本机实测取得 3 个工具）。
- 行为观察（未改代码）：探测端点对每次探测都把 `connectors.enabled` 置 0（`backend/src/routers/connector-operations.ts:77`），已启用的 `deepwiki-mcp` 因此被本次复测顺带停用；已用 `PATCH {enabled:true}` 恢复（200，`status=verified`）。
- 仍未闭环：`starrykol` / `claw` 的失败都发生在远端 HTTP 层（见文末「远程服务器诊断」），不是本机网络或守卫问题。

### 向导「尚未保存配置，无法测试。」误导文案修复（同一晚）

- 根因：配置模式下向导的本地 `version` 状态从不初始化，已有保存配置也被渲染成「尚未保存配置」。
- 修复：`ConnectorConfigCard` 加载后经 `onLoaded` 回传服务端版本，向导采纳且不覆盖本会话保存的新版本；状态行区分「改动后需重新测试」与「已保存、尚未通过测试」两种文案（`frontend/src/admin/connector/ConnectorSetupWizard.tsx`、`ConnectorConfigCard.tsx`）。
- 验证：`tsc --noEmit` ✅；`npm run build` ✅；`npx playwright test e2e/connector-admin.spec.ts` **18/18 通过**（`E2E_AUTH_MODE=enabled`），含新增用例「wizard reads the saved config version back instead of claiming nothing is saved」。
- 顺带修正两处陈旧断言（非本次引入）：`frontend/e2e/connector-admin.spec.ts:579`、`:678` 期待的「配置草稿已保存」已在 `c1aa966` 改为「保存成功：配置草稿已更新（待验证，尚未连通或启用）」；断言更新为当前文案后两项由红转绿。

## 远程服务器诊断与生产 starrykol 修复（2026-09-27 23:14–23:22 +0800）

生产（47.88.94.205，`a5c1990`，23:13 重启，含 egress 守卫修复）上逐层只读实测（诊断脚本输出已脱敏）：

| 层 | 结果 |
|---|---|
| DNS/预检 | PASSED |
| TCP | 连通 15–24ms |
| HTTP（配置 v4–v6，header 名为环境变量名） | **401** `{"code":10141103,"message":"登录过期,亲，请先登录呦！"}` |
| HTTP（改为 `X-MCP-API-KEY` + `Authorization: Bearer` 后，v7） | 鉴权通过；上游 `/starry/email-agent/mcp` 返回 **503 Service Unavailable**（带 requestId，两次重试均 503） |
| 本地同款诊断 | `starrykol` → 上游 503；`claw` → SSE 被远端 400 拒绝；`deepwiki-mcp` → 正常取回 3 个工具 |

- **根因（生产 starrykol 持续秒败 34–72ms）**：连接器配置的两个 header 名写成了环境变量名（`STARRY_KOL_MCP_API_KEY` / `STARRY_KOL_MCP_BEARER`），网关识别不到 → 401 → 被脱敏为 `runtime_remote_failed`。契约要求 `X-MCP-API-KEY` + `Authorization: Bearer`（`docs/07-mcp-data-contract.md:9`，网关要两个头）。
- 23:16 保存的 v5/v6「新凭据」与旧值逐字节相同（sha256 指纹一致）——凭据本身有效（JWT exp 2031-07），不需要更换；需要修的是 header 名。表单留空会保留旧引用，重填相同值只会新增同内容凭据行。
- **已修复**：生产配置 v6 → v7（`PUT /admin/runtime/connectors/starrykol/config`，`headers_secret_refs={"X-MCP-API-KEY": cred_478b…}` + `bearer_secret_ref=cred_c415…`）；401「登录过期」消失。
- **仍未闭环**：Starry 侧 `email-agent` MCP 当前整体 **503**（本地与生产一致、多次重试一致）——待其恢复后重测即应通过。
- 环境更正：生产 `RUNTIME_CREDENTIAL_MASTER_KEY` 现已配置（本次实测保险库可正常解密）；`claw` 生产尚无接入配置（draft），需先补配置再测。
