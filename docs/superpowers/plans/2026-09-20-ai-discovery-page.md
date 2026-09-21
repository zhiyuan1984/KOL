# AI发现页改版（条件配置 → 任务确认 → 开始检索）Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AI发现 从「Composer 里的条件芯片 + 空面板」改成 AI发现 tab 内的整页三段式工作流：条件配置卡（平台/地区/方向/关键词/粉丝数/均播/期望人数）→ 只读的「发现任务」摘要卡（用户在执行前看到 AI 到底理解成了什么任务）→ 重置条件 / 开始检索。

**Architecture:** 新增一个自包含的展示组件 `DiscoverySearchCard`（纯 props 进出，不动全局状态），由 `Home.tsx` 在 `mode === "discovery"` 时挂在结果区之上；条件真值仍是 `Home` 已有的 `discoveryBrief` 状态 + `discoveryTemplate.ts` 的纯函数（`keywordsForDirections` / `canSubmitDiscovery` / `renderDiscoveryBody`）。提交复用现有 `submitDiscovery`（→ `POST /api/home/discovery/run`）。后端补两处契约修复：阈值字段名别名、方向包单一来源。

**Tech Stack:** React 19 + Vite（`frontend/`）、Hono + SQLite（`backend/`）、vitest（前端测试跑在 backend 的 vitest 配置里）、Playwright（e2e）、纯 CSS（`frontend/src/styles.css`）。

**Spec:** 用户 2026-09-20 提供的「AI发现页｜Figma 线框结构标注稿」。该稿不是仓库文件，可执行要点已逐条抄进下面「Global Constraints」；执行时以 Global Constraints 为准，不要凭记忆还原线框。

---

## Global Constraints

尺寸/间距/默认值/文案逐条来自线框稿，执行时照抄：

- 页面：`Width 1440 / 自适应`；内容容器 `左右 32–48px`、`Max Width 1240px`、居中。
  - **页面底色不重绘**：线框稿的 `#F7F8FA` 是整页底色，但 Home 是五个 tab 共用一个外壳，改底色会连带影响今日/待办/公海/跟进。**保持外壳现有底色，只为新卡片内部用白底 + 描边**。
- Figma 图层名 → 代码命名对照（供设计-研发对齐，代码里不引入 Figma 术语）：
  `Search Task Card → .ai-discovery-card[data-discovery-search-card]`、`Platform/Region/Direction Filter → [data-discovery-filter=...]`、
  `Discovery Task Summary → .ai-discovery-summary[data-discovery-summary]`、`Action Bar → .ai-discovery-actions`。
- 页面标题只有一层：`AI发现`，`20px / 600 / line-height 28`，`margin-bottom 16px`。**不再出现「红人线索」这个第二层标题。**
  - 现状：Home 只在 `mode === "today"` 时渲染 `<h1 data-home-title="today">`；discovery 模式没有 h1，需要补 `<h1 data-home-title="discovery">AI发现</h1>`。
- 主卡（`SearchTaskCard`）：`Padding 32px`、`Radius 16px`、背景 `#FFFFFF`、边框 `1px solid #E8E9EB`、纵向 `gap 24px`。
- 卡头：标题 `红人检索`（20/600/28）+ 副标题 `设置检索条件，快速发现符合要求的红人。`（14/400/`#8A8F98`/22），两者 `gap 4px`，卡头下 `24px`。
- Chip：`Height 36px`、`Padding 0 18px`、`Radius 18px`、边框 `1px solid #E2E4E8`；默认白底 `#24262B` 字；选中用品牌色。
  - **品牌色必须复用现有 token `var(--color-primary)`（`frontend/src/styles.css:11`）和既有 `.btn.work` 类，不要写线框里的 `#D92E6B` 新 hex。**
  - 选中态：`border var(--color-primary)` + 底色 `var(--color-pink-tint)`（`styles.css:13`）+ 字色 `var(--color-primary)`。
- 字段行：`Label Width 88px`；行高 `40px`；方向 chip 允许换行（`row-gap 8px / column-gap 10px`）。
- 平台：`YouTube / Instagram / Facebook`，**默认未选**。
- 地区：`北美 / 欧洲 / 东南亚 / 日韩 / 中东非 / 拉美 / 全球英文`，**默认选中「全球英文」（`global_en`）**，单选。
- 方向：**单选? 否 —— 多选，上限 8**，默认未选；8 个方向按线框替换为：`户外露营 / 房车 / 户外能源 / 自驾旅行 / 离网生活 / 应急备电 / 露营装备 / 船用生活`（顺序即优先级，前三个最重要）。
- 方向与数值条件之间加一条分割线：`height 1px`、`#F0F1F2`、`margin 4px 0`。
- 关键词输入：`Height 44px`、`Radius 10px`、边框 `#DFE1E5`、`fill` 宽；默认值 `户外露营，户外能源`。
- 粉丝数：两个输入框 `[10000] — [2000000]`，各 `W 180px / H 44px`，`gap 12px`，placeholder `最小值` / `最大值`。
- 均播 + 期望人数：同一行 `50% / 50%`，`gap 32px`；左 `近10条均播 ≥ [5000]`，右 `期望人数 [30]`；输入框 `H 44px`。
- 「发现任务」摘要卡：`Padding 24px`、`Radius 12px`、背景 `#FAFAFB`、边框 `1px solid #E6E8EB`；标题 `📄 发现任务`（18px icon 即可）；内容 **2 列网格**，`column-gap 48px / row-gap 14px`；Label `14px #8A8F98`，Value `14px / 500 / #202124`；只给 `全球英文`、`方向` 这类关键值上品牌色，不要整块粉。
  - 摘要行固定顺序：`平台 / 地区 / 方向 / 关键词 / 粉丝 / 近10条均播 / 期望人数`，前 6 项两列排布，`关键词` 通栏。
  - 空值文案：`（未选）` / `（未填）`（沿用 `renderDiscoveryBody` 的既有措辞）。
- 底部 Action Bar：右对齐，`gap 12px`，`height 44px`；`重置条件`（`W 104/ H 44`、白底、边框 `#DFE1E5`、`Radius 10`）+ `开始检索`（`W 120 / H 44`、品牌色、白字、`Radius 10`）。**底部不加说明文案。**
- 「发现任务」摘要必须随上方条件实时联动（上=用户配置，下=AI 将执行的任务摘要）。
- 这一版**必须保留**（与线框稿的「全部删除」有出入，理由见决策 D1）：失败原因、重试、检索中状态、候选列表、入库公海入口。

### 全项目硬约束（沿用现有法律/约定，不得违反）

- 平台只允许 `youtube / instagram / facebook`；禁止 TikTok、抖音、小红书等国内平台（`frontend/src/home/discoveryTemplate.ts:95`、`backend/src/discovery-template.ts:10`）。
- 条件区芯片与请求体不得让自然语言盖过芯片语义（ADR-019）；`平台/地区` 单选、无「全部平台」。
- 本页所有 GET（模板/运行/候选）都是 memory 入口：`creates_session:false / creates_turn:false / calls_model:false`；切换 tab 不得建 session（`frontend/src/home/entryRegistry.ts:32-104`）。
- 采集完成只落 `CreatorCandidate`；入库公海必须走 L3 确认（`POST /api/home/discovery/ingest`），本页不得发信、不得改阶段、不得 follow。
- 不编造 followers / views / email；缺失就是缺失（`backend/skills/discovery_brief/SKILL.md`）。
- 提交仍必须 `canSubmitDiscovery(brief)` 守卫：平台非空 且 关键词非空。

---

## 决策与冲突（开工前必须定，建议按「推荐」执行）

**D1（推荐：保留结果与失败区）。** 线框稿要求把 `红人线索 / 检索没有完成 / 重试` 全部删除、异常区不占高度。但：① 宪法 §5 与 `entryRegistry` 要求「等待诚实」，失败必须可见；② 这一页目前是**唯一**的候选列表与入库公海入口，全删后检索结果无处置身；③ 真实失败已发生两次（`远程采集服务未配置。`、`本机 PATH 上没有 codex`），藏起来会让用户无从判断。**落地方案：条件卡上移（内容整体上移约 180–220px），其下保留结果区**，失败改为结果区内的内联提示（不再是顶部整页横幅），重试按钮留在结果区。
→ 若你坚持全删，请一并指定「检索中/结果/入库公海」的替代落点，否则无法交付。

**D2（推荐：平台改单选）。** 线框稿平台是 `○` 单选且默认未选；当前实现是多选（`togglePlatform` 追加），但后端只取 `spec.platforms[0]` 作为唯一采集平台（`backend/src/home-discovery.ts:976`）——多选会造成「选了 3 个只爬 1 个」的静默偏差。ADR-019 也要求单选。**落地方案：平台改单选**，请求仍发数组（长度 1）。

**D3（推荐：后端为方向包唯一来源）。** 方向包现在两边各一份且内容不同（FE `DISCOVERY_DIRECTION_PACKS` 的英文词才是真正下发给 MediaCrawler 的检索词；BE `DISCOVERY_KEYWORD_PACKS` 从没被 FE 读取）。**落地方案：BE 开始下发 `directions`，FE 信任 API 返回的方向列表（仅当接口缺失时用本地兜底），并加一条守卫测试锁死两边一致。**

---

## 现状（已核实，执行时可直接依赖）

- 条件表单今天在 **Composer** 里：`frontend/src/components/ComposerDock.tsx:1100-1185` 的 `DiscoveryConditionEditor`（模块私有），只有 `平台/地区/方向`，无关键词输入、无粉丝/均播/期望人数输入；**关键词由方向派生**（`:1167-1174` 调 `keywordsForDirections`）。
- AI发现 tab 只渲染 `DiscoveryPanel`（`frontend/src/pages/Home.tsx:1901-1909`），面板内容为「红人线索」标题 + 空态 + 结果/失败/入库；「开始发现」按钮（`DiscoveryPanel.tsx:567-576`）调 `openDiscoveryTemplate()`。
- `openDiscoveryTemplate()`（`Home.tsx:364-415`）**有副作用**：拉模板 + `setText(template.body)` 预填 Composer + 锁 intent + `setMode("discovery")`。新卡片需要的是「只拿 catalog」，不能复用它。
- 提交路径：`onComposer`（`Home.tsx:1285`）→ `:1321-1327` 的 `DISCOVERY_INTENT` 分支 → `submitDiscovery(brief, body, version)`（`Home.tsx:441-470`）。**今天唯一的提交控件是 Composer 的发送按钮。**
- 阈值真 bug：前端发 `min_avg_plays_10` / `expect_count`（`frontend/src/home/discoveryHome.ts:343-344`），后端只读 `min_avg_views_10` / `target_count`（`backend/src/home-discovery.ts:256` / `:242`）→ 近10条均播与期望人数**今天完全无效**，恒为默认 5000 / 30。
- 阈值确实用于过滤：`hostFilterSnapshots`（`backend/src/home-discovery.ts:583-623`）按粉丝区间、`min_avg_views_10`、`target_count` 逐条过滤并封顶。
- 方向包：FE `frontend/src/home/discoveryTemplate.ts:77-86`（8 个 beauty…auto + 英文词）；BE `backend/src/discovery-template.ts:27-68`（同 code、不同英文词），经 `GET /api/home/discovery/template` 的 `keyword_packs` 下发，但 FE `asDiscoveryTemplate` 只读 `row.directions`（BE 没发这个字段）→ 永远走 FE 兜底。
- 样式全部在 `frontend/src/styles.css`：条件区 `:1263-1566`，面板/结果/失败 `:1309-1904`；`composer.css` 里没有 discovery 样式。
- e2e 会被打断的断言（详见 Task 5）：`frontend/e2e/home-discovery-pane.spec.ts` 的 `:76 / :90-105 / :114-122 / :212`，`frontend/e2e/home-four-panel.spec.ts:49-60`。
- 前端单测现状：`frontend/src/home/discoveryTemplate.test.ts` 断言 `directions` 有 8 个且 `beauty` 关键词为 `["beauty","makeup","skincare","cosmetics"]` → Task 2 必须同步改。
- backend vitest 会把前端测试文件一起跑（`backend/vitest.config.ts` 的 `include` 逐条列路径）；**新增前端测试文件必须同时登记到该 include 列表**。

---

## File Structure

**Create**
- `frontend/src/home/DiscoverySearchCard.tsx` — 条件配置卡 + 发现任务摘要 + action bar（纯展示，props 进出）。
- `frontend/src/home/discoveryBriefForm.ts` — 表单数值/文案的纯函数（`clampNumericInput`、`normalizeBrief`、`discoveryTaskSummaryRows`）；放这里是为了能单测（测试环境是 node，无 jsdom，不能测组件）。
- `backend/tests/discovery-packs.test.ts` — 守卫：FE 兜底方向包 === BE 方向包。

**Modify**
- `frontend/src/home/discoveryTemplate.ts` — 方向包换户外域；`defaultDiscoveryBrief()` 改默认（平台空、地区 global_en、方向空、关键词 `户外露营，户外能源`）；`asDiscoveryTemplate` 信任 API 的 `directions`；新增导出 `DISCOVERY_DIRECTION_LABELS`（见 Task 2）。
- `frontend/src/pages/Home.tsx` — 进入 discovery tab 时只拉 catalog（`ensureDiscoveryCatalog`）；渲染 `DiscoverySearchCard`；把 `submitDiscovery` 接到卡片的 `开始检索`。
- `frontend/src/home/DiscoveryPanel.tsx` — 去掉「红人线索」标题与「开始发现」按钮（`data-discovery-start` 迁走），保留失败/检索中/结果/入库。
- `backend/src/discovery-template.ts` — 方向包换户外域；`discoveryTemplate()` 下发 `directions`。
- `backend/src/home-discovery.ts` — `validateSpec` 接受阈值别名（修 D4 的真 bug）。
- `frontend/src/styles.css` — 新增 `ai-discovery-*` 样式块。
- `frontend/src/home/discoveryTemplate.test.ts` — 跟随新包与默认值。
- `frontend/e2e/home-discovery-pane.spec.ts`、`frontend/e2e/home-four-panel.spec.ts` — 对齐新结构。

**不动（明确写下来，避免执行者顺手清理）**
- `frontend/src/components/ComposerDock.tsx` 的 `DiscoveryConditionEditor` 与 Home 的 `parseDiscoveryBody / applyChipOverride / sameClassConflict / mergeDiscoveryBrief / discoveryOverride` 全部保留：它们服务于「+ 菜单 → 发现红人模板」与自然语言 `【发现任务】` 这条既有路径，e2e 仍在覆盖。
- `backend/src/discovery-keywords.ts`（`expandOverseasSearchKeywords`）只服务旧的采集台链路（`/api/discovery/*`），Home 链路不经过它，不在本次改动范围。

---

### Task 1: 修阈值字段名错位（让「近10条均播 / 期望人数」真正生效）

**Files:**
- Modify: `backend/src/home-discovery.ts:241-258`（`validateSpec` 的阈值读取）
- Test: `backend/tests/home-discovery.test.ts`（追加用例；该文件已有 `completeRun(body)` 助手，`:76-90`）

**Interfaces:**
- Consumes: 现有 `validateSpec(body)`；DB 列 `discovery_runs.parameters`（JSON）。
- Produces: `validateSpec` 同时接受 `min_avg_plays_10 ?? min_avg_views_10` 与 `expect_count ?? target_count`，规范化后仍写入 `min_avg_views_10` / `target_count`（后端内部命名不变，避免牵动 `hostFilterSnapshots`）。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/home-discovery.test.ts` 的 `describe("POST /api/home/discovery/run validation")` 里追加：

```ts
  it("honours the frontend threshold names for 均播 and 期望人数", async () => {
    const started = await request("POST", "/api/home/discovery/run", {
      platforms: ["youtube"],
      mode: "search",
      keywords: ["portable power station"],
      min_avg_plays_10: 9000,
      expect_count: 12,
    });
    expect(started.status).toBe(202);
    const run = await request("GET", `/api/home/discovery/runs/${started.body.id}`);
    expect((run.body.run as Json).spec).toMatchObject({
      thresholds: { min_avg_views_10: 9000, target_count: 12 },
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run tests/home-discovery.test.ts -t "honours the frontend threshold names" --reporter=basic`
Expected: FAIL — `thresholds.min_avg_views_10` 实际为 `5000`、`target_count` 为 `30`。

- [ ] **Step 3: 实现别名读取**

`backend/src/home-discovery.ts` 的 `validateSpec`，把 `:242` 与 `:254-257` 换成：

```ts
  const rawThresholds = (body.thresholds && typeof body.thresholds === "object" ? body.thresholds : body) as Json;
  // Frontend ships `min_avg_plays_10` / `expect_count`; the Host columns keep the
  // older names. Read both so the 均播 / 期望人数 inputs are not silently ignored.
  let targetCount = Number(
    rawThresholds.target_count ?? rawThresholds.expect_count ?? DEFAULT_DISCOVERY_THRESHOLDS.target_count,
  );
```

```ts
    thresholds: {
      min_followers: Number(rawThresholds.min_followers ?? DEFAULT_DISCOVERY_THRESHOLDS.min_followers),
      max_followers: Number(rawThresholds.max_followers ?? DEFAULT_DISCOVERY_THRESHOLDS.max_followers),
      min_avg_views_10: Number(
        rawThresholds.min_avg_views_10
          ?? rawThresholds.min_avg_plays_10
          ?? DEFAULT_DISCOVERY_THRESHOLDS.min_avg_views_10,
      ),
      target_count: targetCount,
    },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run tests/home-discovery.test.ts --reporter=basic`
Expected: PASS（16 passed，含新增 1 条）

- [ ] **Step 5: 提交**

```bash
git add backend/src/home-discovery.ts backend/tests/home-discovery.test.ts
git commit -m "fix(discovery): honour frontend 均播/期望人数 threshold names"
```

---

### Task 2: 方向包换户外域 + 后端单一来源

**Files:**
- Modify: `backend/src/discovery-template.ts:27-68`（`DISCOVERY_KEYWORD_PACKS`）、`:112-149`（`discoveryTemplate()` 下发 `directions`）
- Modify: `frontend/src/home/discoveryTemplate.ts:18-26`（`DiscoveryDirectionCode`）、`:77-86`（`DISCOVERY_DIRECTION_PACKS`）、`:101-110`（`defaultDiscoveryBrief`）、`:404-419`（`asDiscoveryTemplate` 的 directions 分支）
- Modify: `frontend/src/home/discoveryTemplate.test.ts:19-46`
- Create: `backend/tests/discovery-packs.test.ts`；并登记进 `backend/vitest.config.ts` 的 `include`
- Test: 同上

**Interfaces:**
- Produces: `DiscoveryDirectionCode` 联合类型扩为 8 个户外 code（下表）；`DISCOVERY_DIRECTION_PACKS` 与 `DISCOVERY_KEYWORD_PACKS` 内容一致（code/label/keywords）；`GET /api/home/discovery/template` 新增 `directions: [{ id, label, keywords }]`（保留 `keyword_packs` 不删，避免破坏外部调用）。
- Produces: `defaultDiscoveryBrief()` 返回 `{ platforms: [], region: "global_en", directions: [], keywords: ["户外露营", "户外能源"], ...DEFAULT_DISCOVERY_THRESHOLDS }`。
- Produces: `GET /api/home/discovery/template` 的 `defaults` 增加 `platforms: []` / `directions: []` / `keywords: ["户外露营", "户外能源"]`。
  **必须加**：`frontend/src/home/discoveryTemplate.ts:429-440` 是拿 API 的 `defaults` 覆盖本地兜底的，`asStringList(defaultsRaw.keywords)` 为空时会退回 `keywordsForDirections(兜底方向)`——方向兜底现在是空数组，会把默认关键词清成 `[]`，卡片上的关键词输入框就变空了。

八个方向（两侧都必须逐字一致；英文词就是真正下发给 MediaCrawler 的检索词）：

| code | label | keywords |
|---|---|---|
| `camping` | 户外露营 | `["camping", "outdoor camping", "camping gear"]` |
| `vanlife` | 房车 | `["van life", "RV travel", "RV living"]` |
| `portable_power` | 户外能源 | `["portable power station", "solar generator", "energy storage"]` |
| `road_trip` | 自驾旅行 | `["road trip", "overland travel", "car camping"]` |
| `off_grid` | 离网生活 | `["off grid living", "off grid solar", "homestead power"]` |
| `backup_power` | 应急备电 | `["backup power", "power outage prep", "emergency power"]` |
| `camp_gear` | 露营装备 | `["camping equipment", "outdoor gear review", "camp kitchen"]` |
| `boat_life` | 船用生活 | `["boat life", "marine power", "sailboat living"]` |

- [ ] **Step 1: 写失败测试（两侧一致性守卫）**

创建 `backend/tests/discovery-packs.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { DISCOVERY_KEYWORD_PACKS, discoveryTemplate } from "../src/discovery-template.js";
import { DISCOVERY_DIRECTION_PACKS, defaultDiscoveryBrief } from "../../frontend/src/home/discoveryTemplate.js";

describe("discovery direction packs", () => {
  it("keeps the frontend fallback identical to the backend packs", () => {
    expect(
      DISCOVERY_DIRECTION_PACKS.map((row) => ({ id: row.code, label: row.label, keywords: row.keywords })),
    ).toEqual(
      DISCOVERY_KEYWORD_PACKS.map((row) => ({ id: row.id, label: row.label, keywords: [...row.keywords] })),
    );
  });

  it("serves the same packs as directions on the template endpoint", () => {
    const template = discoveryTemplate() as Record<string, unknown>;
    expect(template.directions).toEqual(
      DISCOVERY_KEYWORD_PACKS.map((pack) => ({ id: pack.id, label: pack.label, keywords: [...pack.keywords] })),
    );
    expect(template.defaults).toMatchObject({
      platforms: [],
      directions: [],
      keywords: ["户外露营", "户外能源"],
    });
  });

  it("defaults to no platform, 全球英文, no direction and the outdoor keywords", () => {
    expect(defaultDiscoveryBrief()).toMatchObject({
      platforms: [],
      region: "global_en",
      directions: [],
      keywords: ["户外露营", "户外能源"],
    });
  });
});
```

在 `backend/vitest.config.ts` 的 `include` 数组里追加一行（放在其它 `tests/**` 之后即可）：

```ts
      "tests/discovery-packs.test.ts",
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run tests/discovery-packs.test.ts --reporter=basic`
Expected: FAIL（FE 包是 beauty…auto，BE 包关键词不同，`template.directions` 为 `undefined`）。

- [ ] **Step 3: 换后端包、下发 directions、补齐 defaults**

`backend/src/discovery-template.ts` 用上表替换 `DISCOVERY_KEYWORD_PACKS`（`id` 用 code：`camping` / `vanlife` / …），并在 `discoveryTemplate()` 返回值里 `keyword_packs` 相邻处加上：

```ts
    directions: DISCOVERY_KEYWORD_PACKS.map((pack) => ({
      id: pack.id,
      label: pack.label,
      keywords: [...pack.keywords],
    })),
```

同一次改动里补 `defaults`（否则前端会把默认关键词覆盖成空）：

```ts
    defaults: {
      brand: defaultBrand,
      region: defaultRegion,
      platforms: [],
      directions: [],
      keywords: ["户外露营", "户外能源"],
      thresholds: { ...DEFAULT_DISCOVERY_THRESHOLDS },
    },
```

- [ ] **Step 4: 换前端包与默认值，并信任 API 的 directions**

`frontend/src/home/discoveryTemplate.ts`：

1. `DiscoveryDirectionCode` 改为上表 8 个 code 的联合类型。
2. `DISCOVERY_DIRECTION_PACKS` 逐字抄上表（`{ code, label, keywords }`）。
3. `defaultDiscoveryBrief()`：

```ts
export function defaultDiscoveryBrief(): DiscoveryBrief {
  return {
    platforms: [],
    region: "global_en",
    directions: [],
    keywords: ["户外露营", "户外能源"],
    ...DEFAULT_DISCOVERY_THRESHOLDS,
  };
}
```

4. `asDiscoveryTemplate` 的 directions 分支：不再拿本地表当白名单过滤，改为信任 API（保留本地表仅作 label/keywords 兜底）：

```ts
  const directions = Array.isArray(row.directions)
    ? (row.directions as unknown[])
      .map((item) => {
        const rec = asRecord(item);
        const code = String(rec.code || rec.id || "").trim();
        if (!code) return null;
        const local = DISCOVERY_DIRECTION_PACKS.find((pack) => pack.code === code);
        return {
          code: code as DiscoveryDirectionCode,
          label: String(rec.label || local?.label || code),
          keywords: asStringList(rec.keywords).length ? asStringList(rec.keywords) : local?.keywords,
        };
      })
      .filter(Boolean) as Array<DiscoveryOption<DiscoveryDirectionCode>>
    : fallback.directions;
```

5. `asDiscoveryTemplate` 的 defaults 合并（`:429-440`）里，把关键词兜底从「由方向派生」改成「回退本地默认值」，否则 API `defaults` 缺 `keywords` 时会被清空：

```ts
    keywords: asStringList(defaultsRaw.keywords).length
      ? asStringList(defaultsRaw.keywords)
      : fallback.defaults.keywords,
```

（这一改会让 `keywordsForDirections` 在本文件里只剩 `asDiscoveryTemplate` 之外的一处调用者——它仍然是导出的公共函数，`ComposerDock` 与单测都在用，不要删。）

6. `clampDirections`（`:201-211`）同样改为放行 API 已知 code：把 `allowed` 从 `DISCOVERY_DIRECTION_PACKS` 换成「`DISCOVERY_DIRECTION_PACKS` ∪ 传入 catalog 的 code」。实现时给 `clampDirections` 加可选第二参 `options: Array<DiscoveryOption> = DISCOVERY_DIRECTION_PACKS`，并在 `parseDiscoveryBody` / `mergeDiscoveryBrief` 调用处保持默认参数不变（这两处只有本地表可用，行为不变）。

- [ ] **Step 5: 更新前端既有断言**

`frontend/src/home/discoveryTemplate.test.ts`：`:26` 的平台断言不变（平台表没动）；把 `:27` 的地区断言保持不变（地区表没动）；把 `:29` 的 `directions.find(row => row.code === "beauty")` 改为：

```ts
    expect(template.directions.map((row) => row.code)).toEqual([
      "camping", "vanlife", "portable_power", "road_trip",
      "off_grid", "backup_power", "camp_gear", "boat_life",
    ]);
    expect(template.directions.find((row) => row.code === "portable_power")?.keywords).toEqual([
      "portable power station", "solar generator", "energy storage",
    ]);
```

把 `:42-44` 的 `canSubmitDiscovery` 用例改成符合新默认值（默认平台为空 → 不可提交）：

```ts
    expect(canSubmitDiscovery({ platforms: [], keywords: ["beauty"] })).toBe(false);
    expect(canSubmitDiscovery({ platforms: ["youtube"], keywords: [] })).toBe(false);
    expect(canSubmitDiscovery(defaultDiscoveryBrief())).toBe(false); // 平台未选，需先选平台
    expect(canSubmitDiscovery({ ...defaultDiscoveryBrief(), platforms: ["youtube"] })).toBe(true);
```

把 `:45` 的 `toggleDirection(..., "beauty")` 换成 `"camping"`；`:50-52` 的 `applyChipOverride` 用例里 `keywords: beauty` 改成 `keywords: camping`。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd backend && npx vitest run tests/discovery-packs.test.ts ../frontend/src/home/discoveryTemplate.test.ts --reporter=basic`
Expected: PASS（两个文件全绿）

- [ ] **Step 7: 提交**

```bash
git add backend/src/discovery-template.ts backend/tests/discovery-packs.test.ts backend/vitest.config.ts frontend/src/home/discoveryTemplate.ts frontend/src/home/discoveryTemplate.test.ts
git commit -m "feat(discovery): outdoor direction packs with one source of truth"
```

---

### Task 3: 表单纯函数层（可单测的部分）

**Files:**
- Create: `frontend/src/home/discoveryBriefForm.ts`
- Create/Test: `frontend/src/home/discoveryBriefForm.test.ts`（**必须同时登记进 `backend/vitest.config.ts` 的 `include`**）

**Interfaces:**
- Consumes: `DiscoveryBrief`、`DiscoveryTemplate`、`platformLabel/regionLabel/directionLabel`（`frontend/src/home/discoveryTemplate.ts`）。
- Produces: 供 Task 4 的组件使用的三个导出：
  - `export type DiscoverySummaryRow = { key: string; label: string; value: string; wide?: boolean }`
  - `export function discoveryTaskSummaryRows(brief: DiscoveryBrief, catalog?: Pick<DiscoveryTemplate,"platforms"|"regions"|"directions"> | null): DiscoverySummaryRow[]`
  - `export function clampCountInput(raw: string, fallback: number): number`（空串/非法/负数 → fallback，整数化）

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/home/discoveryBriefForm.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { clampCountInput, discoveryTaskSummaryRows } from "./discoveryBriefForm";
import { defaultDiscoveryBrief } from "./discoveryTemplate";

describe("discovery brief form helpers", () => {
  it("renders the 发现任务 summary in the wireframe order with 未选/未填 copy", () => {
    const rows = discoveryTaskSummaryRows(defaultDiscoveryBrief());
    expect(rows.map((row) => row.label)).toEqual([
      "平台", "地区", "方向", "关键词", "粉丝", "近10条均播", "期望人数",
    ]);
    const value = (label: string) => rows.find((row) => row.label === label)?.value;
    expect(value("平台")).toBe("（未选）");
    expect(value("地区")).toBe("全球英文");
    expect(value("方向")).toBe("（未选）");
    expect(value("关键词")).toBe("户外露营，户外能源");
    expect(value("粉丝")).toBe("10000–2000000");
    expect(value("近10条均播")).toBe("≥ 5000");
    expect(value("期望人数")).toBe("30");
    expect(rows.find((row) => row.label === "关键词")?.wide).toBe(true);
  });

  it("reflects chosen chips", () => {
    const rows = discoveryTaskSummaryRows({
      ...defaultDiscoveryBrief(),
      platforms: ["youtube"],
      directions: ["camping", "portable_power"],
      keywords: ["camping", "portable power station"],
    });
    const value = (label: string) => rows.find((row) => row.label === label)?.value;
    expect(value("平台")).toBe("YouTube");
    expect(value("方向")).toBe("户外露营、户外能源");
    expect(value("关键词")).toBe("camping, portable power station");
  });

  it("never lets a numeric field go NaN", () => {
    expect(clampCountInput("", 10000)).toBe(10000);
    expect(clampCountInput("abc", 30)).toBe(30);
    expect(clampCountInput("-5", 30)).toBe(30);
    expect(clampCountInput("12000", 10000)).toBe(12000);
    expect(clampCountInput("12.7", 30)).toBe(12);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx vitest run ../frontend/src/home/discoveryBriefForm.test.ts --reporter=basic`
Expected: FAIL — `Cannot find module './discoveryBriefForm'`

- [ ] **Step 3: 实现**

创建 `frontend/src/home/discoveryBriefForm.ts`：

```ts
import {
  directionLabel,
  platformLabel,
  regionLabel,
  type DiscoveryBrief,
  type DiscoveryTemplate,
} from "./discoveryTemplate";

export type DiscoverySummaryRow = { key: string; label: string; value: string; wide?: boolean };

type Catalog = Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null | undefined;

/** 「发现任务」摘要：上=用户配置，下=AI 将执行的任务摘要；顺序即线框稿顺序。 */
export function discoveryTaskSummaryRows(brief: DiscoveryBrief, catalog?: Catalog): DiscoverySummaryRow[] {
  const platforms = catalog?.platforms;
  const regions = catalog?.regions;
  const directions = catalog?.directions;
  return [
    {
      key: "platforms",
      label: "平台",
      value: brief.platforms.length
        ? brief.platforms.map((code) => platformLabel(code, platforms)).join(" / ")
        : "（未选）",
    },
    { key: "region", label: "地区", value: regionLabel(brief.region, regions) },
    {
      key: "directions",
      label: "方向",
      value: brief.directions.length
        ? brief.directions.map((code) => directionLabel(code, directions)).join("、")
        : "（未选）",
    },
    {
      key: "keywords",
      label: "关键词",
      value: brief.keywords.length ? brief.keywords.join(", ") : "（未填）",
      wide: true,
    },
    { key: "followers", label: "粉丝", value: `${brief.min_followers}–${brief.max_followers}` },
    { key: "plays", label: "近10条均播", value: `≥ ${brief.min_avg_plays_10}` },
    { key: "count", label: "期望人数", value: String(brief.expect_count) },
  ];
}

export function clampCountInput(raw: string, fallback: number): number {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}
```

登记测试文件：在 `backend/vitest.config.ts` 的 `include` 里追加

```ts
      "../frontend/src/home/discoveryBriefForm.test.ts",
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx vitest run ../frontend/src/home/discoveryBriefForm.test.ts --reporter=basic`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/home/discoveryBriefForm.ts frontend/src/home/discoveryBriefForm.test.ts backend/vitest.config.ts
git commit -m "feat(discovery): pure helpers for the AI发现 search card"
```

---

### Task 4: 条件卡组件 + 挂到 AI发现 tab

**Files:**
- Create: `frontend/src/home/DiscoverySearchCard.tsx`
- Modify: `frontend/src/pages/Home.tsx`（新增 `ensureDiscoveryCatalog`；渲染卡片；提交接线）
- Modify: `frontend/src/home/DiscoveryPanel.tsx:358,367,565-580`（去掉标题与「开始发现」按钮）
- Modify: `frontend/src/styles.css`（新增样式块，放在现有 discovery 区块之后）

**Interfaces:**
- Consumes: Task 3 的 `discoveryTaskSummaryRows` / `clampCountInput`；`keywordsForDirections`、`canSubmitDiscovery`、`toggleDirection`、`DEFAULT_DISCOVERY_THRESHOLDS`、`MAX_DISCOVERY_DIRECTIONS`。
- Produces: `export default function DiscoverySearchCard(props: { brief: DiscoveryBrief; catalog?: Pick<DiscoveryTemplate,"platforms"|"regions"|"directions"> | null; busy?: boolean; onChange: (brief: DiscoveryBrief) => void; onSubmit: (brief: DiscoveryBrief) => void; onReset: () => void }): JSX.Element`

- [ ] **Step 1: 写组件**

创建 `frontend/src/home/DiscoverySearchCard.tsx`。关键点（`data-*` 属性名刻意沿用旧的 chip 命名，减少 e2e 改动）：

```tsx
import { useEffect, useState } from "react";
import {
  canSubmitDiscovery,
  DISCOVERY_NO_SIDE_EFFECT,
  keywordsForDirections,
  MAX_DISCOVERY_DIRECTIONS,
  OVERSEAS_DISCOVERY_PLATFORMS,
  DISCOVERY_REGION_OPTIONS,
  DISCOVERY_DIRECTION_PACKS,
  toggleDirection,
  type DiscoveryBrief,
  type DiscoveryDirectionCode,
  type DiscoveryPlatformCode,
  type DiscoveryTemplate,
} from "./discoveryTemplate";
import { clampCountInput, discoveryTaskSummaryRows } from "./discoveryBriefForm";

type Catalog = Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null | undefined;

function parseKeywords(text: string): string[] {
  return text.split(/[,，、]/).map((word) => word.trim()).filter(Boolean);
}

function sameKeywords(text: string, words: string[]): boolean {
  return parseKeywords(text).join("\u0000") === words.join("\u0000");
}

export default function DiscoverySearchCard({
  brief,
  catalog,
  busy = false,
  onChange,
  onSubmit,
  onReset,
}: {
  brief: DiscoveryBrief;
  catalog?: Catalog;
  busy?: boolean;
  onChange: (brief: DiscoveryBrief) => void;
  onSubmit: (brief: DiscoveryBrief) => void;
  onReset: () => void;
}) {
  // 关键词是自由文本：本地保留输入串，方向芯片改了关键词时再同步回来。
  const [keywordText, setKeywordText] = useState(() => brief.keywords.join("，"));
  useEffect(() => {
    setKeywordText((current) => (sameKeywords(current, brief.keywords) ? current : brief.keywords.join("，")));
  }, [brief.keywords]);

  const platforms = catalog?.platforms?.length ? catalog.platforms : OVERSEAS_DISCOVERY_PLATFORMS;
  const regions = catalog?.regions?.length ? catalog.regions : DISCOVERY_REGION_OPTIONS;
  const directions = catalog?.directions?.length ? catalog.directions : DISCOVERY_DIRECTION_PACKS;

  // 平台单选（决策 D2）：点已选平台取消选择。
  const selectPlatform = (code: DiscoveryPlatformCode) => {
    onChange({ ...brief, platforms: brief.platforms[0] === code ? [] : [code] });
  };
  const pickDirection = (code: DiscoveryDirectionCode) => {
    const { directions: next } = toggleDirection(brief.directions, code);
    // 方向变则派生关键词；用户之后手改的关键词以输入框为准（ADR-019）。
    onChange({ ...brief, directions: next, keywords: keywordsForDirections(next, directions) });
  };
  const patch = (next: Partial<DiscoveryBrief>) => onChange({ ...brief, ...next });
  const ready = canSubmitDiscovery(brief);
  const atMax = brief.directions.length >= MAX_DISCOVERY_DIRECTIONS;

  return (
    <section className="ai-discovery-card" data-discovery-search-card>
      <header className="ai-discovery-head">
        <h2>红人检索</h2>
        <p>设置检索条件，快速发现符合要求的红人。</p>
      </header>

      <div className="ai-discovery-field" data-discovery-filter="platform">
        <span className="ai-discovery-label">平台</span>
        <div className="ai-discovery-chips">
          {platforms.map((option) => (
            <button
              key={option.code}
              type="button"
              className="discovery-chip"
              data-discovery-chip={option.code}
              aria-pressed={brief.platforms.includes(option.code)}
              onClick={() => selectPlatform(option.code as DiscoveryPlatformCode)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-discovery-field" data-discovery-filter="region">
        <span className="ai-discovery-label">地区</span>
        <div className="ai-discovery-chips">
          {regions.map((option) => (
            <button
              key={option.code}
              type="button"
              className="discovery-chip"
              data-discovery-chip={option.code}
              aria-pressed={brief.region === option.code}
              onClick={() => patch({ region: option.code as DiscoveryBrief["region"] })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-discovery-field" data-discovery-filter="directions">
        <span className="ai-discovery-label">方向</span>
        <div className="ai-discovery-chips">
          {directions.map((option) => {
            const pressed = brief.directions.includes(option.code as DiscoveryDirectionCode);
            return (
              <button
                key={option.code}
                type="button"
                className="discovery-chip"
                data-discovery-chip={option.code}
                data-discovery-preset={option.code}
                aria-pressed={pressed}
                disabled={atMax && !pressed}
                onClick={() => pickDirection(option.code as DiscoveryDirectionCode)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {atMax ? <span className="discovery-direction-limit">最多添加 {MAX_DISCOVERY_DIRECTIONS} 个方向</span> : null}
      </div>

      <hr className="ai-discovery-divider" />

      <div className="ai-discovery-field" data-discovery-keys>
        <label className="ai-discovery-label" htmlFor="ai-discovery-keywords">关键词</label>
        <input
          id="ai-discovery-keywords"
          className="ai-discovery-input"
          data-discovery-keywords
          value={keywordText}
          placeholder="户外露营，户外能源"
          onChange={(event) => {
            // 中间态（例如刚敲完逗号）留在本地，只有解析得出词时才写回 brief，
            // 否则 join/split 往返会把分隔符吃掉，导致逗号根本打不进去。
            const raw = event.target.value;
            setKeywordText(raw);
            const parsed = parseKeywords(raw);
            if (parsed.length) patch({ keywords: parsed });
          }}
          onBlur={() => {
            const parsed = parseKeywords(keywordText);
            patch({ keywords: parsed });
            setKeywordText(parsed.join("，"));
          }}
        />
      </div>

      <div className="ai-discovery-field" data-discovery-followers>
        <span className="ai-discovery-label">粉丝数</span>
        <div className="ai-discovery-inline">
          <input
            className="ai-discovery-input is-number"
            data-discovery-min-followers
            inputMode="numeric"
            value={String(brief.min_followers)}
            placeholder="最小值"
            onChange={(event) => patch({ min_followers: clampCountInput(event.target.value, brief.min_followers) })}
          />
          <span className="ai-discovery-dash">—</span>
          <input
            className="ai-discovery-input is-number"
            data-discovery-max-followers
            inputMode="numeric"
            value={String(brief.max_followers)}
            placeholder="最大值"
            onChange={(event) => patch({ max_followers: clampCountInput(event.target.value, brief.max_followers) })}
          />
        </div>
      </div>

      <div className="ai-discovery-metrics">
        <div className="ai-discovery-field" data-discovery-plays>
          <span className="ai-discovery-label">近10条均播</span>
          <div className="ai-discovery-inline">
            <span className="ai-discovery-op">≥</span>
            <input
              className="ai-discovery-input is-number"
              data-discovery-min-plays
              inputMode="numeric"
              value={String(brief.min_avg_plays_10)}
              onChange={(event) => patch({ min_avg_plays_10: clampCountInput(event.target.value, brief.min_avg_plays_10) })}
            />
          </div>
        </div>
        <div className="ai-discovery-field" data-discovery-count>
          <span className="ai-discovery-label">期望人数</span>
          <input
            className="ai-discovery-input is-number"
            data-discovery-expect-count
            inputMode="numeric"
            value={String(brief.expect_count)}
            onChange={(event) => patch({ expect_count: clampCountInput(event.target.value, brief.expect_count) })}
          />
        </div>
      </div>

      <section className="ai-discovery-summary" data-discovery-summary aria-label="发现任务">
        <h3>发现任务</h3>
        <dl className="ai-discovery-summary-grid">
          {discoveryTaskSummaryRows(brief, catalog).map((row) => (
            <div key={row.key} className={row.wide ? "is-wide" : undefined} data-discovery-summary-row={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="ai-discovery-summary-note">{DISCOVERY_NO_SIDE_EFFECT}</p>
      </section>

      <div className="ai-discovery-actions">
        <button type="button" className="btn ghost" data-discovery-reset onClick={onReset}>
          重置条件
        </button>
        <button
          type="button"
          className="btn work"
          data-discovery-submit
          disabled={!ready || busy}
          onClick={() => onSubmit(brief)}
        >
          开始检索
        </button>
      </div>
    </section>
  );
}
```

（提交前自查：组件里不应再出现未被使用的 import 或 state。）

- [ ] **Step 2: 给 Home 加 `ensureDiscoveryCatalog` 并渲染卡片**

`frontend/src/pages/Home.tsx`，在 `openDiscoveryTemplate`（`:364`）附近新增一个**无副作用**的 catalog 加载器：

```ts
  /** AI发现 tab 首屏只拉字典（memory GET，零 session / 零模型）。不预填 Composer。 */
  const ensureDiscoveryCatalog = async () => {
    if (discoveryCatalogRef.current) return;
    discoveryCatalogRef.current = true;
    try {
      const template = await loadDiscoveryTemplate();
      setDiscoveryCatalog({ platforms: template.platforms, regions: template.regions, directions: template.directions });
      setDiscoveryVersion(template.version);
      if (!discoveryBrief) setDiscoveryBrief(template.defaults);
    } catch {
      const template = fallbackDiscoveryTemplate();
      setDiscoveryCatalog({ platforms: template.platforms, regions: template.regions, directions: template.directions });
      if (!discoveryBrief) setDiscoveryBrief(template.defaults);
    }
  };
```

配套：`const discoveryCatalogRef = useRef(false);`（放在其它 ref 附近，如 `boardKolsRef` 旁），并在 `Home.tsx` 现有的 `useEffect(() => { if (mode !== "pool") return; ... }, [mode])` 旁边加：

```ts
  useEffect(() => {
    if (mode !== "discovery") return;
    void ensureDiscoveryCatalog();
    // Tab entry only loads the dictionary. Never prefills the Composer here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
```

然后在 `:1901` 的 `mode === "discovery"` 分支里，把卡片渲染在 `DiscoveryPanel` 之前：

```tsx
          {mode === "discovery" ? <h1 data-home-title="discovery">AI发现</h1> : null}
          {mode === "discovery" && discoveryBrief ? (
            <DiscoverySearchCard
              brief={discoveryBrief}
              catalog={discoveryCatalog}
              busy={busy}
              onChange={onDiscoveryBriefChange}
              onSubmit={(next) => void submitDiscovery(next, renderDiscoveryBody(next, discoveryCatalog || undefined), discoveryVersion)}
              onReset={() => setDiscoveryBrief(defaultDiscoveryBrief())}
            />
          ) : null}
```

并补齐 import：`DiscoverySearchCard`；`renderDiscoveryBody` 追加到 `Home.tsx` 已有的 `../home/discoveryTemplate` 导入列表（`Home.tsx:43-54`，该列表已含 `defaultDiscoveryBrief`，只需补 `renderDiscoveryBody` 一个名字）。

注意：`onDiscoveryBriefChange` 会顺带用 `applyChipOverride` 重写 Composer 正文——这是既有行为，保留即可（卡片提交时我们自己传 `renderDiscoveryBody(...)`，不依赖 Composer 文本）。

- [ ] **Step 3: 面板让位（去掉标题与「开始发现」）**

`frontend/src/home/DiscoveryPanel.tsx`：
- 删掉 `:367` 的 `<p className="home-lane-label">红人线索</p>`。
- 删掉 `:565-580` 的 `data-discovery-start` 按钮块（「开始发现」），并让 `showStart` 常量一起删（`:358`）——它的唯一用途是这个按钮。`templateOpen` prop 因此失去用途；**保留 prop 定义与调用点不删**（避免牵动 Home），只在面板内部不再使用它，并在组件上方加一行注释说明它已被条件卡取代。
- `:358` 的 `showResults` 保持原样。

- [ ] **Step 4: 加样式**

`frontend/src/styles.css`，在现有 discovery 区块（约 `:1904`）之后追加。所有颜色走既有 token，尺寸照 Global Constraints：

```css
/* AI发现：条件配置 → 任务确认 → 开始检索 */
.ai-discovery-card {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: 0 auto 24px;
  max-width: 1240px;
  padding: 32px;
  background: var(--bg);
  border: 1px solid #e8e9eb;
  border-radius: 16px;
}
.ai-discovery-head h2 { margin: 0; font-size: 20px; font-weight: 600; line-height: 28px; }
.ai-discovery-head p { margin: 4px 0 0; font-size: 14px; color: var(--color-smoke); line-height: 22px; }
.ai-discovery-field { display: flex; align-items: center; gap: 16px; min-height: 40px; }
.ai-discovery-label { flex: 0 0 88px; font-size: 14px; color: var(--color-graphite); }
.ai-discovery-chips { display: flex; flex-wrap: wrap; gap: 8px 10px; }
.ai-discovery-divider { height: 1px; margin: 4px 0; border: 0; background: #f0f1f2; }
.ai-discovery-input {
  flex: 1; min-width: 0; height: 44px; padding: 0 14px;
  border: 1px solid #dfe1e5; border-radius: 10px; background: var(--bg);
  font-size: 14px; color: var(--color-ink);
}
.ai-discovery-input.is-number { flex: 0 0 180px; }
.ai-discovery-inline { display: flex; align-items: center; gap: 12px; }
.ai-discovery-dash, .ai-discovery-op { color: var(--color-smoke); }
.ai-discovery-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
.ai-discovery-summary {
  padding: 24px; background: #fafafb; border: 1px solid #e6e8eb; border-radius: 12px;
}
.ai-discovery-summary h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
.ai-discovery-summary-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 48px; row-gap: 14px; margin: 0; }
.ai-discovery-summary-grid .is-wide { grid-column: 1 / -1; }
.ai-discovery-summary-grid div { display: flex; gap: 8px; }
.ai-discovery-summary-grid dt { flex: 0 0 auto; margin: 0; font-size: 14px; color: var(--color-smoke); }
.ai-discovery-summary-grid dd { margin: 0; font-size: 14px; font-weight: 500; color: #202124; }
.ai-discovery-summary-note { margin: 12px 0 0; font-size: 12px; color: var(--color-smoke); }
.ai-discovery-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }
.ai-discovery-card .discovery-chip[aria-pressed="true"] {
  border-color: var(--color-primary); background: var(--color-pink-tint); color: var(--color-primary);
}
```

（`.discovery-chip` 的 36px/18px/边框已存在于 `styles.css:1472`，不要重复定义尺寸。）

- [ ] **Step 5: 构建 + 单测 + 手工验收**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors

Run: `cd backend && npx vitest run ../frontend/src/home/discoveryBriefForm.test.ts ../frontend/src/home/discoveryTemplate.test.ts --reporter=basic`
Expected: PASS

Run: `cd frontend && npm run build` → 然后打开 `http://127.0.0.1:8765/?tab=discovery`
Expected：标题「AI发现」只有一层；卡片含平台（未选）/地区（全球英文选中）/方向 8 个（未选）/关键词=户外露营，户外能源/粉丝 10000—2000000/均播 ≥5000/期望人数 30；点 `YouTube` + `户外露营` 后「发现任务」摘要立刻变为 `平台：YouTube`、`方向：户外露营`；`开始检索` 可用；点它 → 面板出现检索中/结果。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/home/DiscoverySearchCard.tsx frontend/src/pages/Home.tsx frontend/src/home/DiscoveryPanel.tsx frontend/src/styles.css
git commit -m "feat(discovery): full-page condition card with 发现任务 summary"
```

---

### Task 5: e2e 对齐

**Files:**
- Modify: `frontend/e2e/home-discovery-pane.spec.ts:64-123, 211-214`
- Modify: `frontend/e2e/home-four-panel.spec.ts:49-60`

**背景：** 这个仓库的 e2e 套件**当前已经是红的**（与本次改动无关的过期选择器：`[data-todo-md]` 在 `frontend/src` 里根本不存在；`workbench.spec.ts:3745` 用的是已被 `data-today-todo` 取代的 `[data-todo-card]`；`home-four-panel.spec.ts:35/553` 断言的「待办」二字出现在今日规划文案里）。**本任务只动 discovery 相关断言，不顺手修其它过期选择器**（那属于另一件事，避免把它拖进这次改版）。

- [ ] **Step 1: 改「tab switch」用例**

`frontend/e2e/home-discovery-pane.spec.ts:75-78`：`[data-discovery-empty='idle']` 与「尚未搜索」保留；`:76` 的 `[data-discovery-start]` 断言改为：

```ts
  await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
  await expect(page.locator("[data-discovery-submit]")).toHaveText("开始检索");
```

- [ ] **Step 2: 改「开始发现 prefills Composer」用例**

该用例（`:84`）原本验证「点开始发现 → 预填 Composer」。现在条件卡直接在页面上，Composer 预填入口只剩「+ 菜单 → 发现红人模板」。改写为两段：

```ts
test("condition card renders in-page without prefilling the Composer", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST") posts.push(new URL(item.url()).pathname);
  });
  await openDiscovery(page);
  await expect(page.locator("[data-discovery-search-card]")).toContainText("红人检索");
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]')).toBeVisible();
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="tiktok"]')).toHaveCount(0);
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="douyin"]')).toHaveCount(0);
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="na"]')).toHaveText("北美");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="jpkr"]')).toHaveText("日韩");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="global_en"]'))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-discovery-keywords]")).toHaveValue("户外露营，户外能源");
  expect(posts.filter((path) => path === "/api/sessions" || path.endsWith("/from-text"))).toEqual([]);
});

test("发现任务 summary follows the chips", async ({ page }) => {
  await openDiscovery(page);
  await page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]').click();
  await page.locator('[data-discovery-filter="directions"] [data-discovery-chip="camping"]').click();
  const row = (key: string) => page.locator(`[data-discovery-summary-row="${key}"] dd`);
  await expect(row("platforms")).toHaveText("YouTube");
  await expect(row("directions")).toHaveText("户外露营");
  await expect(row("region")).toHaveText("全球英文");
  await expect(page.locator("[data-discovery-submit]")).toBeEnabled();
});

test("+ menu still opens the Composer discovery template", async ({ page }) => {
  await openDiscovery(page);
  await page.locator("[data-home] [data-attach]").click();
  const menu = page.getByRole("menu", { name: "添加内容" });
  await expect(menu.getByRole("menuitem", { name: "发现红人模板" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "发现红人模板" }).click();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/【发现任务】/);
  await expect(page.locator("[data-home] [data-discovery-lock-chip]")).toContainText("发现任务");
  await expect(menu).not.toContainText("/admin/connectors");
});
```

（`子`「chips override the body / 缺关键词禁用发送」用例 `:112-123` 改造成提交按钮的守卫断言：把 `[data-home] [data-discovery-chip=...] .chip-x` 换成 `[data-discovery-chip="instagram"]` 的二次点击取消，把 `[data-send]` 换成 `[data-discovery-submit]`：选平台 → 清空关键词 → 断言 `开始检索` 禁用。）

- [ ] **Step 3: 改提交用例**

`:211-214`：`[data-discovery-start]` → 先在卡片里选平台（默认未选），再点 `[data-discovery-submit]`：

```ts
  await openDiscovery(page);
  await page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]').click();
  await page.locator("[data-discovery-submit]").click();
  await expect.poll(() => runPosts).toEqual(["/api/home/discovery/run"]);
```

- [ ] **Step 4: 改 four-panel 用例**

`frontend/e2e/home-four-panel.spec.ts:49-60`：删掉 `:54` 的 `toContainText("红人线索")` 与 `:60` 的 `[data-discovery-start]` 断言，改为：

```ts
  await expect(page.locator("[data-discovery-panel]")).toBeVisible();
  await expect(page.locator("[data-discovery-search-card]")).toContainText("红人检索");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("加入待办");
```

（`:55` 的「尚未搜索」与 `:58-59` 的 `data-discovery-live=false` / `data-discovery-empty='idle'` 保留。）

- [ ] **Step 5: 跑 discovery 相关 e2e**

Run: `cd frontend && npx playwright test home-discovery-pane.spec.ts home-four-panel.spec.ts --workers=1 --reporter=line`
Expected: discovery 两个文件里**与本次改动相关**的用例全绿。`home-four-panel.spec.ts` 的 `:15 / :140 / :325 / :544` 仍会因既有过期选择器失败（`[data-todo-md]` 等），这属于已知的既有红，不阻塞本任务——在提交信息里写明「该文件既有失败与本改动无关」。

- [ ] **Step 6: 提交**

```bash
git add frontend/e2e/home-discovery-pane.spec.ts frontend/e2e/home-four-panel.spec.ts
git commit -m "test(discovery): align e2e with the in-page search card"
```

---

## 验证（全部任务完成后一次过跑）

```bash
cd frontend && npx tsc --noEmit                      # 期望 0 错误
cd frontend && npm run build                          # 产出 dist，后端 8765 直接服务
cd backend && npx vitest run tests/home-discovery.test.ts tests/discovery-packs.test.ts \
  ../frontend/src/home/discoveryTemplate.test.ts ../frontend/src/home/discoveryBriefForm.test.ts --reporter=basic
cd frontend && npx playwright test home-discovery-pane.spec.ts --workers=1 --reporter=line
```

真实链路（需要 `MEDIACRAWLER_MCP_URL/TOKEN` 已配置，当前本机已配好）：

1. 打开 `http://127.0.0.1:8765/?tab=discovery`
2. 平台选 YouTube、方向选 户外能源、关键词保持、期望人数改 5
3. 点「开始检索」→ 面板出现「排队/开始搜索关键词/已收到 N 条/…」；`GET /api/home/discovery/runs` 的 `spec.thresholds.target_count` 必须是 5（这就是 Task 1 的价值）
4. 采完后候选列表出现，勾选 → 入库公海 → L3 确认 → 跳公海

## 风险与回滚

- **方向包换域会改变真实检索词**（下发给远端 MediaCrawler 的就是 `keywords`）。换包后老的 `beauty/tech` 等 code 不再被 FE 生成；DB 里历史 run 的 `parameters.directions` 是旧 code，读取侧 `specOf` 只做字符串透传，不会报错，但历史 run 的详情里方向会显示 code 原文——可接受。
- **平台单选是行为变更**：多选 → 单选。若线上已有用户习惯多选，需产品确认（决策 D2）。
- **默认值变更会牵动自然语言路径**：`defaultDiscoveryBrief()` 的平台默认从 `["youtube"]` 变成 `[]`。`retryDiscoveryRun()`（`Home.tsx:472-482`）在无 `lastDiscoverySubmit` 时会用 `mergeDiscoveryBrief(defaultDiscoveryBrief(), parseDiscoveryBody(prompt))` 重建 brief——如果那段 `【发现任务】` 正文里没有「平台：」行，brief 的平台会是空，提交会被 `canSubmitDiscovery` 挡下并提示「请选择平台并填写关键词后再发送。」。这是有意的（平台不再默认 YouTube），但要在验收时确认提示文案符合预期；若希望保留旧行为，就把 `mergeDiscoveryBrief(defaultDiscoveryBrief(), ...)` 的那一处显式补 `platforms: ["youtube"]`。
- **e2e 基线本来就红**：Task 5 的目标是「discovery 相关断言绿」，不是「整个套件绿」。若要求整套绿，需要先单独修 `[data-todo-md]` / `[data-todo-card]` / 「待办」文案这些过期断言（另开一件事）。
- 回滚粒度按任务：Task 1、Task 2 各自独立（可单独 revert 而不影响 UI）；Task 3/4 必须成对（卡片依赖纯函数层）。
- 工作区注意事项：本仓库当前有并发操作者（`git stash list` 里的 `wip-baseline-check` 存着别人的未提交工作，`HEAD` 在 90871ec 且含部分本会话早前的改动）。**开工前先 `git status` + `git stash list` 确认状态，不要在别人未提交的文件上做无关改动**（`frontend/src/pages/Mail.tsx`、`frontend/src/styles.css` 的 mail 段、`backend/src/routers/mail.ts` 等）。
