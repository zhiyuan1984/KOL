# AI发现 · 红人线索页改版（框线交付落地）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `?tab=discovery` 从「条件卡 + 长列表」改成框线稿的四段结构：紧凑检索区 → 运行状态卡 → 结果工具栏 → 可展开的线索行，并把行上缺失的字段（推荐分 / 播放粉丝比 / 置信度 / 采集时间 / 匹配理由 / 在库状态 / 来源链接）真正接上数据。

**Architecture:** 数据侧先落地（后端候选投影 + 运行级计数），再做前端。前端沿用现有 `DiscoveryPanel` 作为结果区容器，新增两个展示组件（状态卡、线索行），把候选行渲染从内联 JSX 抽成组件以便展开/二级指标。所有筛选与检索仍是 memory 入口，提交仍只有提问框的提问按钮。

**Tech Stack:** React 19 + Vite（`frontend/`），Hono + SQLite（`backend/`），vitest（前端单测跑在 backend 的 vitest 白名单里），Playwright（e2e），纯 CSS（`frontend/src/styles.css`）。

**Spec:** `docs/figma-kol-discovery-wireframe.md`（用户 2026-09-20 交付的框线稿）。**执行者必须同时读它**：所有尺寸、间距、token、字段规则、Auto Layout、MCP 补充字段的取值以该文件为准，本计划只补充它没写的落点与顺序。

---

## Global Constraints

逐条来自 spec，执行时照它抄数值；本计划只重复会与现状冲突的关键项：

- Frame：内容宽 **1200**、左右留白 **32**（仓库已有 `--content-max:1200px` + `--page-gutter`，见 §现状，不要再造变量）。
- 页面只保留导航里的 `AI发现`；**删除重复页面标题与右上角工具组**（§Frame）。
- 四段结构顺序固定：`Search / Compact` → `Crawl status / Completed` → `Result toolbar` → `Creator lead / Row`（§页面结构）。
- Chip：高 36 / 左右内边距 12 / 间距 8 / 16px 平台图标（§组件 · Platform chip）。
- 候选行：默认紧凑行、最小高 76、点击「查看详情」展开二级指标（§组件 · Creator lead row、§Auto Layout）。
- 批量条：未选中显示 `已选 0 人` 且主按钮禁用；已选中显示 `入库公海（N）`；**批量只入库，不发信、不改阶段、不自动认领**（§组件 · Bulk action bar）。
- 字段规则（§字段规则）**必须逐条落地**：`近10均播` 用有效样本求平均、不足 10 条显示 `N/10 条样本`；`播放/粉丝比` = `view_mean / followers` 以百分比展示；`推荐分` 展示总分且详情里可看构成、不单独靠颜色；`置信度` 来自样本覆盖率（不得写成「关键字段完整度」）；`匹配理由` 缺失时写「暂无足够内容证据」**不得编造**；`采集时间` 用 `collected_at` 显示到分钟；`看来源` 无 URL 时**禁用**并显示「来源链接缺失」。
- Token（§视觉 Token）：字号 12/14/16/18/20、间距 4/8/12/16/20/24/32、圆角输入与按钮 8、容器 14、主色沿用现有玫红、成功用绿色**文字 + 圆点 + 状态文案**三者并存、正文对比度 ≥ 4.5:1、图标按钮必须有可读标签或 `aria-label`。
- 响应式：Tablet 1024 筛选项两列、候选行隐藏次级指标（§Frame）。

### 项目硬约束（沿用，不得违反）

- 平台只允许 `youtube | instagram | facebook`（`frontend/src/home/discoveryTemplate.ts`、`backend/src/discovery-template.ts`）。
- tab 切换只允许 memory GET：零 session / 零 turn / 零模型；提交只走 `POST /api/home/discovery/run`。
- 采集只落 `CreatorCandidate`；入库公海必须走 L3 确认（`POST /api/home/discovery/ingest`）；本页不得发信、改阶段、follow、解密。
- 不编造 followers / views / email / 来源链接；缺失就显示缺失文案。
- 品牌色只用既有 token（`--color-primary` 等），不得引入框线稿之外的新 hex。

---

## 现状（只读勘察结论，执行时可直接依赖）

**候选行渲染**：`frontend/src/home/DiscoveryPanel.tsx:493-554` 内联渲染，字段只有 昵称 / 平台 / `in_library` 芯片 / `账号 {handle} · 粉丝 {followers} · 均播 {avg_plays_10} · 档位 {band}` / `匹配：{why}` / 看来源 / 忽略。**没有**头像、推荐分、播放粉丝比、置信度、采集时间、展开详情、排序说明。工具栏在 `:458-490`（`data-discovery-run-bar` / `data-discovery-select-all` / `data-discovery-ingest`）。

**数据契约**（`backend/src/home-discovery.ts`）：`creator_candidates`（004:47-68 + 009:7-9）有 `platform / platform_creator_id / claw_creator_id / handle / nickname / followers / score / signals / payload / status / order_index / metrics_missing / avg_views_10`。

| spec 字段 | 现状 |
|---|---|
| `collected_at` | **已通到 API**：在 `creator_candidates.payload.collected_at`（`:655`），FE 类型没读 |
| `existing_library_status` | **三个布尔已通**（`already_in_pool` / `already_followed` / `already_in_library`，`:402-404`），FE `asHomeCandidate` 塌成一个 `in_library` 且**丢了 `already_followed`**（`discoveryHome.ts:244-246`） |
| `match_reason` / 推荐分 / 档位 / fit | **半通**：原文在 run 的 brief artifact（`ranking[].{score,band,why,fit}`），`applyRanking`（`:741-748`）只写 `score`+`order_index`，`why/band/fit` 被丢；`publicCandidate` 不投影 → 真实环境永远「匹配：无」 |
| `score` | 列存在、`publicCandidate.score` 已发（`:399`），但 **FE `HomeDiscoveryCandidate` 没有 `score` 字段**（`discoveryHome.ts:28-41`）→ 行上不显示 |
| 播放粉丝比 `view_mean/followers`、置信度 `sample_confidence` | **未通**：只在 `claw_creators.payload.score_details` / `creator_snapshots.score_details`；候选层没有列也不投影（`backend/src/adapters/claw.ts:239,248-252` 是唯一计算点） |
| `profile_url` / `avatar_url` | **未通**；真实 DB 的 `claw_creators.payload` 键集里**没有** URL/头像（爬虫没回）。别的链路有实现可抄：`backend/src/discovery-import.ts:164-177` `profileUrlOf()`、遗留 `backend/src/discovery.ts:372` 的 avatar 读取 |
| `matched_keywords` | **无任何来源**（全仓只有 spec 提到） |
| 原始数量（运行级） | **无列**；`persistFilteredCandidates` 算出的 raw 只回传内存（`:633-723`），`discovery_runs` 无 `raw_count`；只有 `brief.counts.raw`（`rank_failed` 时 brief 为 null） |
| 完成时间 / 耗时 / 入围数量 | **已通**：`completed_at` / `started_at` / `candidate_count` 都在 `publicRun`（`:412-454`），FE 类型缺 `completed_at`/`started_at` |

**额外字段的丢弃点**（要透传必须改这里）：`hostFilterSnapshots()`（`:593-599`）的 SELECT **没有 `c.payload`**；`persistFilteredCandidates()`（`:649-666`）重新构造封闭 payload。即 `claw_creators.payload` 里已有的额外字段到不了候选。

**页面外壳**：`<h1 data-home-title="discovery">AI发现</h1>`（`Home.tsx:1978`，CSS `styles.css:1890-1897`）；右上工具组 `.home-chrome-actions`（`Home.tsx:1866-1915`：search/refresh/external/settings + `ModelTierControl`）**对全部 5 个模式无条件渲染**，`workbench.spec.ts:127` 硬断言 `[data-home-chrome-action]` 恰好 4 个。内容列已存在：`--content-max:1200px`（`styles.css:6816`）、`--page-gutter`（`:6815`）、`.home-stage`/`.home-composer-dock`（`:8700-8718`）；而 `h1[data-home-title]` 与 `.ai-discovery-card` 写的 `max-width:1240px`（`:1893`/`:1903`）**比列宽还大，是失效规则**。

**可抄的既有范式**：可展开行 `frontend/src/home/TodayPlanProgress.tsx:199-227`（`aria-expanded` + 条件渲染）；列表级折叠 `TaskBoard.tsx:208-218`；文字首字母圆头像 `.kol-avatar`（`styles.css:2849-2863`）；图标是本地内联 SVG 组件 `ChromeIco`（`Home.tsx:267-280`）/`Ico`（`Workbench.tsx:11-24`），**仓库无 icon 库**。

**Token 缺口**：字号 16/18/20 无 token（20 是 hardcode）；圆角 8 只有 `--radius-nav`；间距 4/8/12/16/20/24/32 全覆盖；成功色 `--color-success-vivid:#10B981` 存在但**暗色主题未覆写**；无「成功状态」专用类。

---

## 决策与冲突（开工前必读，已按推荐执行；有异议先改这里）

**D1（删标题与工具组只对本页生效）**：`.home-chrome` 是五个模式共用的外壳，且 `workbench.spec.ts:127` 断言 4 个 action。裁定：**在 discovery 模式隐藏 h1 与 `.home-chrome-actions`（含 ModelTierControl）**，其它模式不动（用 `mode === "discovery"` 条件渲染，不删组件）。代价：若你其实要全局删掉工具组，需要再改其它模式与那条 e2e。
顺带记录：discovery 模式下 `data-today-summary`（`0项待处理…`）仍显示，spec 未提及，本次**保留**。

**D2（账号 ID 用 `platform_creator_id`）**：`creator_candidates.handle` 实际是 `nickname` 的副本（`home-discovery.ts:641,674-676`），不是真账号 ID。裁定：行上「账号 ID」渲染 **`platform_creator_id`**（真实存在）；`handle` 列的语义修正另开（代价：若产品要的是 handle 字符串，需再改一列）。

**D3（原始数量落库）**：`brief.counts.raw` 在 `rank_failed` 时为 null，spec 的状态卡却要求恒显「原始数量」。裁定：**新增 `discovery_runs.raw_count` 列**并在 `persistFilteredCandidates` 写入，FE 优先读它、回退 `brief.counts.raw`、再回退「无」。代价：一次 migration。

**D4（匹配理由/推荐分/档位来自 brief 的 join）**：裁定在 `listHomeDiscoveryCandidates(runId)` 里**一次性**读该 run 的 brief artifact，按 `candidate_id` 把 `why/fit/band/score` 合进每条候选（不在 `publicCandidate` 里逐条查，避免 N+1）。代价：brief 缺失（rank_failed）时这些字段为空，FE 必须显示缺失文案而非编造。

**D5（MCP 补充字段：能透传的先透传，缺的按缺失文案渲染）**：`profile_url` / `avatar_url` / `matched_keywords` 今天爬虫不回。裁定：① 后端把 `claw_creators.payload` 透传进候选 payload（改 D-丢弃点），使 MCP 一旦补上字段就能显示；② 前端对三者按 spec 的缺失规则渲染（看来源禁用 +「来源链接缺失」、头像用 `platform_creator_id` 首字母圆、匹配理由缺失写「暂无足够内容证据」）。代价：在爬虫补字段之前，「看来源」在真实数据上仍是禁用态——这是诚实态，不是 bug。

**D6（并发写入）**：本仓库有另一个会话在改 `Home.tsx` / `styles.css`（已发生两次覆盖：`82a9abf`、以及一次未提交重写）。裁定：**T3 起凡是要改 `Home.tsx`/`styles.css` 的任务，先 `git status` 确认没有对方的未提交改动落在同一文件；改动尽量小、立即提交**。代价：若对方再次覆盖，重复劳动。

---

## File Structure

**Create**
- `backend/migrations/011_home_discovery_raw_count.sql` — `discovery_runs.raw_count`（编号 010 已被 `010_mailbox_ui.sql` 占用；落列靠 `backend/src/db.ts` 的 `migrateSchema()` 里 `add(db, "discovery_runs", "raw_count", "INTEGER")`，`.sql` 文件按仓库惯例同步留档，别只写 .sql 不加 `add()`）。
- `frontend/src/home/DiscoveryRunStatusCard.tsx` — 「Crawl status / Completed」单行状态卡。
- `frontend/src/home/DiscoveryLeadRow.tsx` — 「Creator lead / Row」紧凑行 + 展开二级。
- `frontend/src/home/discoveryLeadFields.ts` — 行字段的纯函数（百分比、样本文案、置信度文案、在库三态、采集时间到分钟、缺失文案）。

**Modify**
- `backend/src/home-discovery.ts` — 透传 `claw_creators.payload`；`persistFilteredCandidates` 写 `raw_count`；`publicCandidate` 投影新字段；`listHomeDiscoveryCandidates` join brief 的 ranking。
- `frontend/src/home/discoveryHome.ts` — `HomeDiscoveryCandidate` / `HomeDiscoveryRun` 补字段与容错映射。
- `frontend/src/home/DiscoveryPanel.tsx` — 用新的工具栏/行组件替换内联渲染；挂状态卡。
- `frontend/src/home/DiscoverySearchCard.tsx` — 收敛为 `Search / Compact`（§页面结构 1、§Auto Layout）。
- `frontend/src/pages/Home.tsx` — discovery 模式隐藏 h1 与 chrome actions。
- `frontend/src/styles.css` — 新增 `discovery-*` 样式（含 1024 断点、成功态类），清掉失效的 1240 规则。
- 测试：`backend/tests/home-discovery.test.ts`、`frontend/src/home/discoveryTemplate.test.ts`（`runCountsLabel`）、`frontend/e2e/home-discovery-pane.spec.ts`、`frontend/e2e/home-four-panel.spec.ts`。

**新增单测文件要登记进 `backend/vitest.config.ts` 的 `include`**（前端单测由它白名单执行；`tests/**/*.test.ts` 已覆盖后端新增测试）。

---

### Task 1: 后端候选字段投影（行上要显示的字段真正上线）

**Files:** Modify `backend/src/home-discovery.ts`；Create `backend/migrations/011_home_discovery_raw_count.sql`；Test `backend/tests/home-discovery.test.ts`

**Interfaces:**
- Produces：`GET /api/home/discovery/runs/:id/candidates` 的每条候选新增键——`platform_creator_id`（已有）、`score`、`band`、`fit`、`match_reason`（**字符串**，由 brief 的 `why` 数组 join，规格 §MCP 补充字段 里它是 string）、`view_mean`、`view_median`、`stability`、`view_follower_ratio`、`confidence`（样本覆盖率）、`sample_size`、`recent_views`（原始数组）、`collected_at`、`library_status`（`not_in_library|pool|followed`）、`profile_url`、`avatar_url`、`matched_keywords`。
- Produces：`publicRun` 新增 `raw_count`（数字或 null）。
- 保持：`in_library`（布尔，向后兼容）、`metrics_missing`、`why`（保留旧键，值同 `match_reason`）。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/home-discovery.test.ts` 的候选断言处（现有 `:332-339` 的 `toMatchObject`）扩展为：

```ts
    expect(candidates[0]).toMatchObject({
      platform: "youtube",
      platform_creator_id: "yt-beauty-1",
      nickname: "CleanGlow",
      library_status: "not_in_library",
    });
    expect(candidates[0]).toHaveProperty("score");
    expect(candidates[0]).toHaveProperty("confidence");
    expect(candidates[0]).toHaveProperty("collected_at");
    // brief 的 ranking 必须 join 到候选上，否则行上永远是「匹配：无」
    expect((run.body.run as Json).raw_count).toBeGreaterThan(0);
```

并在同一文件新增一条聚焦用例（造 12 条 `recent_views` 的候选，断言 `confidence === 1`、`sample_size === 10`、`view_follower_ratio` 为数字）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run tests/home-discovery.test.ts --reporter=basic`
Expected: FAIL —— `library_status` / `confidence` / `raw_count` 均不存在。

- [ ] **Step 3: 迁移 + 透传 + 投影**

1. 新建 `backend/migrations/011_home_discovery_raw_count.sql`（编号 010 已被 `010_mailbox_ui.sql` 占用）：

```sql
-- 运行级原始候选数：brief.counts.raw 在 rank_failed 时为 null，状态卡需要恒有数。
-- db.ts migrateSchema() 的 add() 负责实际落列（幂等）；本文件按仓库惯例留档。
```

同时在 `backend/src/db.ts` 的 `migrateSchema()` 里、紧邻既有的 `add(db, "discovery_runs", …)` 行加：

```ts
  add(db, "discovery_runs", "raw_count", "INTEGER");
```

2. `hostFilterSnapshots()` 的 SELECT 补 `c.payload AS claw_payload`，并在返回的 kept 行上带出 `claw_payload`。
3. `persistFilteredCandidates()`：候选 payload 增加透传键（`profile_url` / `avatar_url` / `matched_keywords`，从 `claw_payload` 解析，缺失即不写）；同一处把 `raw` 写进运行行：

```ts
    db.prepare("UPDATE discovery_runs SET raw_count=?, candidate_count=?, updated_at=? WHERE id=?")
      .run(kept.raw, kept.kept.length, nowIso(), run.id);
```

（按现有实现的实际变量名落，不要造新名。）
4. `publicCandidate()` 增加投影：`collected_at`（`payload.collected_at`）、`recent_views`（`payload.recent_views`）、`view_mean`/`view_follower_ratio`/`confidence`/`sample_size`（`payload.score_details` 里同名键，缺失为 null）、`library_status`（三布尔派生：`followed` > `pool` > `not_in_library`）、`profile_url`/`avatar_url`/`matched_keywords`（payload 直传，缺失为 null/空数组）。
5. `listHomeDiscoveryCandidates()`：一次性读取该 run 的 `discovery_brief` artifact，按 `ranking[].candidate_id` 建索引，给每条候选补 `score`（brief 优先，回退列值）、`band`、`fit`、`match_reason`（`why` 数组）、`confidence`（brief 无此字段时留 payload 值）。
6. `publicRun()` 增加 `raw_count: row.raw_count ?? null`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run tests/home-discovery.test.ts tests/mediacrawler.test.ts tests/discovery-brief-contract.test.ts --reporter=basic`
Expected: PASS（`mediacrawler` 那条 `score_details.sample_confidence === 0.3` 必须仍然绿——不要改 `score_details` 的既有形状）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/home-discovery.ts backend/migrations/011_home_discovery_raw_count.sql backend/tests/home-discovery.test.ts
git commit -m "feat(discovery): project the lead fields the result row needs"
```

---

### Task 2: 前端候选/运行类型与容错映射

**Files:** Modify `frontend/src/home/discoveryHome.ts`；Test `frontend/src/home/discoveryTemplate.test.ts`（该文件已覆盖 `asHomeRun` / `asHomeCandidate`）

**Interfaces:**
- Consumes：Task 1 的候选键与 `raw_count`。
- Produces：`HomeDiscoveryCandidate` 增加 `platformCreatorId`、`score`、`band`、`fit`、`matchReason: string`、`viewMean`、`viewMedian`、`stability`、`viewFollowerRatio`、`confidence`、`sampleSize`、`recentViews: number[]`、`collectedAt`、`libraryStatus: "not_in_library" | "pool" | "followed"`、`profileUrl`、`avatarUrl`、`matchedKeywords: string[]`；`HomeDiscoveryRun` 增加 `rawCount`、`startedAt`、`completedAt`。全部缺失即 null/空数组，**不得用 0 或 "" 伪装缺数据**。

- [ ] **Step 1: 写失败测试**

在 `frontend/src/home/discoveryTemplate.test.ts` 追加：

```ts
  it("maps the lead fields without inventing missing values", () => {
    const row = asHomeCandidate({
      id: "c1",
      platform_creator_id: "yt-1",
      followers: 153000,
      score: 88,
      band: "high",
      match_reason: ["名称含 camping"],
      view_mean: 8597,
      view_follower_ratio: 0.056,
      confidence: 1,
      sample_size: 10,
      recent_views: [1, 2, 3],
      collected_at: "2026-09-20T03:43:01.069Z",
      library_status: "followed",
      profile_url: "https://youtube.com/@x",
      avatar_url: "",
      matched_keywords: ["camping"],
    });
    expect(row).toMatchObject({
      platformCreatorId: "yt-1",
      score: 88,
      band: "high",
      matchReason: "名称含 camping",
      viewMean: 8597,
      confidence: 1,
      sampleSize: 10,
      libraryStatus: "followed",
      profileUrl: "https://youtube.com/@x",
    });
    expect(row?.avatarUrl).toBe(null);
    // 旧接口只给三个布尔时也要能派生出三态
    expect(asHomeCandidate({ id: "c2", already_in_pool: true })?.libraryStatus).toBe("pool");
    expect(asHomeCandidate({ id: "c3" })?.libraryStatus).toBe("not_in_library");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run ../frontend/src/home/discoveryTemplate.test.ts --reporter=basic`
Expected: FAIL —— 新键不存在。

- [ ] **Step 3: 实现映射**

在 `asHomeCandidate` 里按别名容错读取（沿用文件既有的 `nullableNumber` / `asString` / `asRecord` 习惯），`libraryStatus` 优先读 `library_status`，否则由 `already_followed` / `already_in_pool` / `already_in_library` 派生；`in_library` 继续保留（`libraryStatus !== "not_in_library"`）。`asHomeRun` 补 `rawCount ← raw_count`、`startedAt ← started_at`、`completedAt ← completed_at`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run ../frontend/src/home/discoveryTemplate.test.ts ../frontend/src/home/discoveryBriefForm.test.ts --reporter=basic`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/home/discoveryHome.ts frontend/src/home/discoveryTemplate.test.ts
git commit -m "feat(discovery): carry the lead fields through the client types"
```

---

### Task 3: 外壳收敛（删重复标题与右上工具组、对齐 1200 列）

**Files:** Modify `frontend/src/pages/Home.tsx`（`~:1866-1915` chrome、`:1978` h1）、`frontend/src/styles.css`（`:1890-1897`、`:1903`、`:682-725`）

- [ ] **Step 1: 条件化 chrome 与标题**

`Home.tsx`：`.home-chrome-actions` 容器与 `<ModelTierControl>` 仅在 `mode !== "discovery"` 时渲染（保持其它模式现状）；`{mode === "discovery" ? <h1 …AI发现…/> : null}` 整行删除。

- [ ] **Step 2: 对齐内容列**

删除 `h1[data-home-title="discovery"]` 与 `.ai-discovery-card` 里失效的 `max-width:1240px`（内容列由 `.home-stage`/`.home-composer-dock` 的 `--content-max:1200px` + `--page-gutter` 决定），确保卡片、状态卡、工具栏、候选列表、提问框左沿一致。

- [ ] **Step 3: 同步测试**

`frontend/e2e/home-four-panel.spec.ts:52` 的 `toHaveText("AI发现")` 改为断言 h1 **count 0**；`home-four-panel.spec.ts:24` 的 tab 文案断言保留（导航入口就是它）。`frontend/e2e/workbench.spec.ts` 的 `expectHomeChromeRow()` 只在 today/todo 场景调用（`:602`/`:634`/`:3770`），discovery 场景若有用例则改为断言 `[data-home-chrome-action]` count 0。

- [ ] **Step 4: 验证**

Run: `cd frontend && npx tsc --noEmit && npx playwright test home-four-panel.spec.ts --workers=1 --reporter=line`
Expected: tsc 0；discovery 段相关断言绿（该文件既有红与本改动无关，逐条区分并如实报告）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/Home.tsx frontend/src/styles.css frontend/e2e/home-four-panel.spec.ts
git commit -m "feat(discovery): one nav entry, no duplicate title or page tools"
```

---

### Task 4: 紧凑检索区（Search / Compact）

**Files:** Modify `frontend/src/home/DiscoverySearchCard.tsx`、`frontend/src/styles.css`

- [ ] **Step 1: 结构调整**

按 spec §页面结构 1 与 §Auto Layout：标题、平台切换、检索条件合并为一个紧凑区（**页面纵向 gap 20**、筛选区 Vertical gap 14；平台 Chip 行 Wrap；条件行 Horizontal gap 10、窄屏 Wrap 成两列）。平台 Chip 按 §组件 · Platform chip 取 高 36 / 左右内边距 12 / 间距 8 / 16px 图标（图标用本地内联 SVG，沿用 `ChromeIco` 的画法，**不引入 icon 库**；`disabled` 态用既有 `disabled` + `aria-disabled` 语义，当前矩阵用不到就不造）。按 §视觉 Token 把输入框与按钮圆角改成 **8**、容器圆角改成 **14**（现在是 input 10 / chip 18 / card 16），字号用 12/14/16/18/20（缺的 token 在 Task 7 补）。保留现有 `data-*`：`data-discovery-search-card`、`data-discovery-filter="platform|region|directions"`、`data-discovery-chip`、`data-discovery-keywords`、`data-discovery-min-followers`、`data-discovery-max-followers`、`data-discovery-min-plays`、`data-discovery-expect-count`（e2e 依赖它们）。

- [ ] **Step 2: 不变量**

仍**没有**任何提交/重置按钮（唯一提交是提问框的提问按钮）；平台单选默认 YouTube；方向多选默认空；`DISCOVERY_NO_SIDE_EFFECT` 文案保留。

- [ ] **Step 3: 验证**

Run: `cd frontend && npx tsc --noEmit && npx playwright test home-discovery-pane.spec.ts --workers=1 --reporter=line`
Expected: tsc 0；discovery e2e 全绿（若因新结构需改断言，改断言而不是放宽）。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/home/DiscoverySearchCard.tsx frontend/src/styles.css
git commit -m "feat(discovery): compact the search block"
```

---

### Task 5: 运行状态卡（Crawl status / Completed）

**Files:** Create `frontend/src/home/DiscoveryRunStatusCard.tsx`；Modify `frontend/src/home/DiscoveryPanel.tsx`（挂载点：结果头之前）、`frontend/src/styles.css`；Test `frontend/src/home/discoveryLeadFields.test.ts`（新建，登记进 `backend/vitest.config.ts` 的 include）

**Interfaces:**
- Consumes：`HomeDiscoveryRun`（`status`/`completedAt`/`startedAt`/`rawCount`/`shortlistCount`）。
- Produces：`export function discoveryRunStatusRows(run: HomeDiscoveryRun | null): Array<{ key: string; label: string; value: string }>`——纯函数，四行：`完成时间`（`completedAt` 到分钟）/`耗时`（`completedAt - startedAt` → `X 分 Y 秒`，缺任一端为「无」）/`原始数量`/`入围数量`；缺失一律「无」，**不得用 0 冒充**。组件只渲染这些行 + 成功态（绿点 + 绿字 + 状态文案三者并存，成功色用 `--color-success-vivid`，并在暗色主题下补一条覆写）。

- [ ] **Step 1: 写失败测试**（`discoveryLeadFields.test.ts`：四行取值、耗时缺一端为「无」、`raw_count` 缺失回退 brief 的 `counts.raw`）
- [ ] **Step 2: 跑测试确认失败**：`cd backend && npx vitest run ../frontend/src/home/discoveryLeadFields.test.ts --reporter=basic`
- [ ] **Step 3: 实现纯函数 + 组件 + 挂载**（`data-discovery-status-card`、`data-run-status-row={key}`）
- [ ] **Step 4: 跑测试确认通过** + `npx tsc --noEmit`
- [ ] **Step 5: 提交** `git commit -m "feat(discovery): crawl status card"`

---

### Task 6: 结果工具栏 + 可展开的线索行

**Files:** Create `frontend/src/home/DiscoveryLeadRow.tsx`；Modify `frontend/src/home/DiscoveryPanel.tsx:454-556`、`frontend/src/styles.css`；Test `frontend/src/home/discoveryLeadFields.test.ts`

**Interfaces:**
- Produces（纯函数，供行与测试共用）：`sampleLabel(candidate)` → `近10均播` 文本（有效样本求平均；不足 10 条时 `N/10 条样本`）；`viewFollowerPercent(candidate)` → 百分比字符串或「无」；`confidenceLabel(candidate)` → 来自 `sampleSize` 的置信度（高/中/低 + 样本数），**不得写「关键字段完整度」**；`matchReasonText(candidate)` → 拼接 `matchReason`，空时「暂无足够内容证据」；`collectedAtMinute(candidate)` → 到分钟；`sourceState(candidate)` → `{ href } | { missing: true }`。
- 行组件 props：`{ candidate, selected, expanded, onToggleSelect, onToggleExpand, onIgnore, libraryLabel }`；一级字段与操作、二级字段按 spec §组件 · Creator lead row。展开用 `aria-expanded` + 条件渲染（抄 `TodayPlanProgress.tsx:199-227`）。

- [ ] **Step 1: 写失败测试**（六个纯函数的正常值 + 缺失值；特别覆盖「不足 10 条样本」「无 URL」「无 matchReason」三种缺失）
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**——工具栏（候选人数、排序说明、多选、`入库公海（N）`；未选中 `已选 0 人` 且主按钮禁用）；列表 `gap 0` + 1px 分隔线（不给每行套卡片）；行最小高 76、默认紧凑、展开转 Vertical。**保留既有钩子**：`data-discovery-candidates`、`data-discovery-candidate`、`data-discovery-candidate-identity/-meta/-reason`、`data-discovery-select`、`data-discovery-select-all`、`data-discovery-ingest`、`data-discovery-ignore`、`data-discovery-source`；新增 `data-lead-expand`、`data-lead-detail`、`data-lead-score`、`data-lead-ratio`、`data-lead-confidence`、`data-lead-collected`、`data-lead-library`。
  ⚠️ `home-discovery-pane.spec.ts:307` 断言 `[data-discovery-panel] .btn.work` **恰好 1 个**——工具栏若新增 `.btn.work`（例如批量按钮的另一种实现）会挂；批量按钮沿用现有那一个。
  ⚠️ 忽略动作今天只写本地 state（`backend/src/routers/home-discovery.ts:67` 的 `POST /candidates/:id/ignore` 从未被调用）——本次**保持本地忽略**，不要顺手改成请求（spec 未要求，且会引入写操作）。
- [ ] **Step 4: 跑测试 + e2e 确认通过**：`npx vitest run ../frontend/src/home/discoveryLeadFields.test.ts --reporter=basic`、`npx playwright test home-discovery-pane.spec.ts --workers=1 --reporter=line`（`:285` 的「原始 40 · 入围 2」文案与 `:287` 的按 handle 定位若受状态卡/行结构影响，按新结构改断言）
- [ ] **Step 5: 提交** `git commit -m "feat(discovery): result toolbar and expandable lead rows"`

---

### Task 7: 响应式、可访问性与收尾

**Files:** Modify `frontend/src/styles.css`、`frontend/src/home/DiscoveryLeadRow.tsx`、`frontend/src/home/DiscoverySearchCard.tsx`

- [ ] **Step 1: 1024 断点**：筛选区两列、候选行隐藏次级指标（新增 `@media (max-width: 1024px)`；现有只有 900/720 两档）。
- [ ] **Step 2: 对比度与 aria**：正文/背景 ≥ 4.5:1（`--color-smoke` 在白底上只有 3.4:1，若用作正文需改用 `--color-graphite`）；所有图标按钮补 `aria-label`（含展开按钮、看来源禁用态、批量条）。
- [ ] **Step 3: 补齐缺失 token 与成功态暗色覆写**：在 `:root` 补字号 16/18/20 三个 token（现有只有 11/12/13/14/15/17/48；20 现在是 hardcode），并给 `--success` 补 `:root[data-theme="dark"]` 与 `@media (prefers-color-scheme: dark)` 的值；本页所有新样式改用 token，不写裸数值字号。
- [ ] **Step 4: 全量验证**（见下方「验证」小节）+ 提交 `git commit -m "polish(discovery): responsive, contrast and labels"`

---

## 验证（全部任务完成后一次过跑）

```bash
cd frontend && npx tsc --noEmit                                  # 期望 0
cd backend  && npx vitest run tests/home-discovery.test.ts tests/mediacrawler.test.ts \
  tests/discovery-brief-contract.test.ts ../frontend/src/home/discoveryTemplate.test.ts \
  ../frontend/src/home/discoveryLeadFields.test.ts --reporter=basic
cd frontend && npm run build
cd frontend && npx playwright test home-discovery-pane.spec.ts --workers=1 --reporter=line
```

真实链路（本机 `8765` 已在跑；**不要点提交**，会触发真实远端采集）：打开 `?tab=discovery`，用已有运行（`drun_e29…`/`drun_691aa182d203`）核对状态卡四行、行上一级字段、展开二级字段、「看来源」在无 URL 时是禁用 +「来源链接缺失」、匹配理由显示真实中文理由（而不是「匹配：无」）。

## 风险与回滚

- **并发写入（最高风险）**：另一会话正在改 `Home.tsx`/`styles.css`。T3/T4/T6 都要动这两个文件。开工前 `git status` 确认；每步立即提交；若被覆盖，按 ledger 的提交记录重放。
- **`handle` 语义**：D2 用 `platform_creator_id` 当账号 ID；若产品要的是 handle 字符串，需要后续修列（`home-discovery.ts:641`）。
- **`profile_url`/`avatar_url`/`matched_keywords` 依赖 MCP 补字段**：本计划只做透传 + 缺失文案；爬虫补上字段前，「看来源」在真实数据上保持禁用态（诚实态）。
- **回滚粒度**：T1（后端）与 T2（类型）必须成对回滚（前后端字段契约）；T3–T7 各自独立，可单独 revert。
- **`home-four-panel.spec.ts` 既有红**：该文件在当前工作树已有与本次无关的失败（today 面板断言），所以它的 discovery 段只能源码对照 + 局部验证，不能声称整套绿——如实报告。
