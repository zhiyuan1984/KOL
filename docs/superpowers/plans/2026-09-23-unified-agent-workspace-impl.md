# 统一 Agent 工作台：阶段 0/1 收尾与公海·我的红人迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本计划批准后，任务 1 第一步先把它整体落盘到 `docs/superpowers/plans/2026-09-23-unified-agent-workspace-impl.md`，后续执行者以仓库内文件为准。

**Goal:** 按现行规格完成阶段 0/1 收尾，并把「公海 / 我的红人」完整迁移到唯一 `WorkspaceShell`（规格阶段 4），用目标域测试、全量门禁与截图证据证明五模式同壳、零回归、无第二套几何。

**Architecture:** 五个 Home 一级模式共享唯一 `WorkspaceShell`（唯一两栏几何、中栏与右栏各自滚动、右栏折叠按模式记忆）。各模式用各自组合层往插槽注入内容：今日/待办 = `ScopeWorkspace`，AI发现 = `DiscoveryWorkspace`，公海/我的红人 = `ObjectWorkspace`（共享组合层，见设计决策 1）。公海/我的红人的数据、确认与动作状态从 `Home.tsx` 迁入 `usePoolWorkspace` / `useFollowedWorkspace`；`Home.tsx` 只保留模式路由、跨模式共享入口状态与组合。权限、审批、阶段判定、异步作业与回执契约一律不动。

**Tech Stack:** React 19 + react-router 7 + Vite 6 + TypeScript 5.7；样式 = CSS 变量 token（数值唯一来源 `docs/DESIGN.md` → `frontend/src/styles.css`）；单测 = vitest（`backend/vitest.config.ts` 显式 include 前端用例）；E2E = Playwright（stub 模式，`scripts/e2e-server.mjs` 启动，默认端口 8876）。

**Spec:** `docs/superpowers/specs/2026-09-23-unified-agent-workspace.md`（§6 状态机、§9.4/§9.5 模式映射、§11 组件与状态边界、§13 三轴、§15 阶段 0/1/4、§16 文件计划、§17 验收矩阵、§18 回滚、§19 完成定义）。

---

## 全局约束（每个任务都适用）

- **不重写业务规则**（CONST-04）：前端不得重新发明权限、审批链、阶段判定；只实现已定义规则。
- **不伪造**（CONST-10）：不伪造对话、结果、进度、联系人或完成；真实等待必须有原因、状态与恢复入口。
- **副作用独立**：发送 ≠ 推进阶段；领取、释放、入库、阶段确认继续走既有独立确认（L3）与回执路径，**不得合并请求、不得改接口**。
- **不新增依赖、不触碰后端代码与数据**（spec §16 后端行「仅缺失时」，当前无缺失）。
- **数值只住两处**：`docs/DESIGN.md`（语义）与 `frontend/src/styles.css`（token 值）；组件与 CSS 不得散写列宽数值，必须引用 `--workspace-result-rail-*` token。
- **同一视口 0–1 个实底主 CTA**；状态不能只靠颜色；设备适配按宽度 × 高度 × 输入模态三轴，禁止 UA 嗅探。
- **工作区保护**：`backend/skills/today_plan/SKILL.md`、`backend/skills/todo_plan/SKILL.md`、`.stage-SKILL.md.patch`、`.stage1.patch` 是用户既有改动，**不得编辑、不得暂存**；所有 `git add` 必须写显式文件路径，**禁止 `git add -A` / `git add .`**。
- **验证命令（Repository 标准）**：
  - 单测/E2E 过滤：`cd backend && npm test -- home/`（vitest 位置参数按路径子串过滤）；`cd frontend && npm run test:e2e -- home-`（Playwright 按文件名过滤）。
  - 门禁：`cd backend && npm run validate:kol-data && npm run validate:contracts && npm run validate:tb-binding && npm run typecheck && npm test`；`cd frontend && npm run typecheck && npm run build && npm run test:e2e`。
- **测试归属**：修复必须区分「目标域失败（本次改动引入）」「基线失败」「并发 flake」；flake 记录不盲修。新增前端单测文件必须同步追加进 `backend/vitest.config.ts` 的 `include`（本计划默认不新增单测文件）。
- 命令均在 Git Bash 下、仓库根目录或指定子目录执行；提交只做本地 commit，不 push。

---

## 运行环境与验证方法（2026-09-23 实测，命令以此为准）

- E2E 必须**单文件隔离**运行（本机多文件连跑会出现跨文件 flake；后端独立实测 board 0.12s / pool 3ms，慢的是测试环境的并发时序）：

```bash
rm -rf /c/Users/admin/KOL/data-e2e-ws/<run>
cd frontend
LINGONG_DATA="C:/Users/admin/KOL/data-e2e-ws/<run>" E2E_SKIP_BUILD=1 npx playwright test <spec-file> --retries=0
```

  改过 `frontend/src` 后先 `npm run build` 再跑（`E2E_SKIP_BUILD=1` 复用 dist）；一次只跑一个 playwright 进程（端口 8876 独占）。
- 后端单测：`cd backend && npm test -- <filter>`（vitest 路径子串过滤）。
- **既有红/竞态清单（基线实测；保持红、不修、逐条登记）**：`home-pool-follow.spec.ts:230`（分析入队 flow 自报缺人）、`home-chat-send-ne-stage.spec.ts:69/:113`、`home-plan-cache.spec.ts:56/:84`（固有竞态，retries=1 吸收）；`/api/demo/reset` 偶发 ECONNRESET 属连接竞态，隔离+retries=1 下被吸收。
- 任务 7 的「全量门禁」口径修正为：**目标域用例隔离全绿 + 既有红清单逐条对照 + 后端 validate/typecheck/test**；`workbench.spec.ts` 等大文件的 HEAD 既有红不构成本次的通过证据（方法沿用 `docs/superpowers/specs/2026-09-23-discovery-workspace.md` §8）。
- 已完成的基线修复（2026-09-23 实测）：`kolContract.test.ts` 与 `home-pool-follow.spec.ts` 桩的 `kol-analyze-enqueue` kind 由 `think` 更正为 `command`（依据 d68a056 提交说明与后端 `/home/kol-analyze/enqueue` 响应）；`home-pane-parity.spec.ts` 补齐五模式 Chrome/折叠记忆/堆叠与矮视口/键盘用例；`home-four-panel.spec.ts:147/:199` 列宽断言更新为 DESIGN 新几何（rail ≥360、中栏宽于右栏、卡片随右栏）。

---

## 现状核对（2026-09-23 工作区，已未提交改动）

| 项目 | 状态 | 证据 |
|---|---|---|
| IA 改五模式 | ✅ 已改 | `docs/ia-information-architecture.md`：Home 五模式、公海边界、模式导航不在提问框 |
| DESIGN 五模式 + 工作台几何 token | ✅ 已改 | `docs/DESIGN.md`「Home Agent 工作台几何」：`--workspace-result-rail-min/ideal/max/collapsed`、堆叠断点 1100px |
| 决策记录 | ✅ 已建 | `docs/DECISIONS.md` ADR-2026-09-23（公海一级模式、首次建联动作化、BIZ-07 限制登记） |
| BIZ-07 规则空白登记 | ✅ 已登记 | `DECISIONS.md` 限制条 + `docs/BUSINESS.md` §BIZ-07 边界条款 |
| WorkspaceShell 五模式 | ✅ 已扩展 | `frontend/src/home/WorkspaceShell.tsx`：`WorkspacePane = "today" \| "todo" \| "discovery" \| "pool" \| "lifecycle"` |
| 模式导航移出 Composer | ✅ 已做 | `Home.tsx` 的 `quickTaskBar` 作为 `centerHeader` 渲染；`ComposerDock.tsx` 已无模式导航；e2e 断言 `first-outreach` count 0 |
| 右栏 token 化 + 去横向滚动 | ✅ 已做 | `today-plan-board.css` 用 `var(--workspace-result-rail-*)`；TaskBoard `table-layout: fixed` + `overflow-x: hidden`；`styles.css` 断点 981→1101 |
| 公海/我的红人接入壳 | 🟡 部分 | `ObjectWorkspace.tsx`（新）+ `PoolPane/FollowedPane` 的 `embedded` 右栏形态已接；**状态仍在 `Home.tsx`（2337 行）** |
| 死分支 | 🟡 待清 | `PoolPane/FollowedPane` 的 `embedded=false` 旧全宽分支已无调用者 |
| 测试 | 🟡 未跑通验证 | `home-four-panel/home-pane-parity/scopeParity` 已按五模式更新；typecheck 已过（0 错误）；e2e 尚未在本轮跑过 |
| 统一类型/InteractionSurface/ResultRail 抽取（阶段 1#2） | ⏭ 推迟 | 见「设计决策 2」：移到首个真实消费者（阶段 2 今日/待办时间线） |

已被验证的命令：`cd frontend && npm run typecheck` → 无诊断输出（通过）。

---

## 设计决策（本计划内的实施形态与排序，不改验收口径）

1. **`ObjectWorkspace` 保留为公海/我的红人的共享组合层**，不拆成两个薄壳 `PoolWorkspace`/`FollowedWorkspace`。两个模式的差异完全由 props 参数化（标题、文案、storage key、rail 内容），单文件更满足 DRY 与「唯一几何」不变量；若将来两者真正分叉再拆。规格 §15 阶段 4#2 的意图（两模式组合唯一 Shell）由此满足，`scopeParity.test.ts` 已固化该结构。
2. **`InteractionSurface` / `ResultRail` 组件与 `workspace-types/reducer` 抽取推迟**到阶段 2（今日/待办时间线 block 投影）一并做。规格 §11.1 称之为「建议模块」，当前没有消费者；先建无消费者抽象会与阶段 2 的真实形状打架。不改变验收口径。
3. **「切换模式再返回保留草稿 / 结果选择」（§17.1 末条）推迟**到阶段 2 的输入版本/草稿隔离模型；本计划先兑现「折叠状态按模式记忆、互不串台」，并明确记录该推迟项。
4. **本里程碑纯前端 + 文档 + 测试**：不触碰 `backend/`、数据库、schemas、policies。

---

## 任务 1：计划落盘 + 基线整理提交

**Files:**
- Create: `docs/superpowers/plans/2026-09-23-unified-agent-workspace-impl.md`（本计划全文）

- [ ] **1.1 落盘计划**：把本文件（含头部）写入上述路径。
- [ ] **1.2 文档自检**：检查内部链接目标存在（`docs/AGENTS.md` §6：内部链接、条款引用、层级声明、失效历史引用）；`git diff --stat` 复核只新增该文件。
- [ ] **1.3 基线提交**（把 2026-09-23 已完成的阶段 0/1 改动整理为一次提交，作为后续任务干净基线；显式路径，绝不 `-A`）：

```bash
git add docs/DESIGN.md docs/ia-information-architecture.md docs/DECISIONS.md \
  docs/superpowers/specs/2026-09-23-unified-agent-workspace.md \
  docs/superpowers/plans/2026-09-23-unified-agent-workspace-impl.md \
  frontend/src/home/WorkspaceShell.tsx frontend/src/home/ObjectWorkspace.tsx \
  frontend/src/home/ScopeWorkspace.tsx frontend/src/home/DiscoveryWorkspace.tsx \
  frontend/src/home/PoolPane.tsx frontend/src/home/FollowedPane.tsx \
  frontend/src/home/TaskBoard.tsx frontend/src/home/today-plan-board.css \
  frontend/src/home/scopeParity.test.ts frontend/src/styles.css \
  frontend/src/pages/Home.tsx \
  frontend/e2e/home-four-panel.spec.ts frontend/e2e/home-pane-parity.spec.ts
git status --short   # 复核：backend/skills/* 与 .stage*.patch 不在暂存区
git commit -m "feat(home): 五模式接入统一工作台外壳（中栏交互 / 右栏结果）"
```

- [ ] **1.4 验证**：`git show --stat HEAD` 只含上述文件；`git status --short` 中 `backend/skills/today_plan/SKILL.md`、`backend/skills/todo_plan/SKILL.md`、`.stage-SKILL.md.patch`、`.stage1.patch` 仍为未提交且未改动。

> 若用户要求暂缓提交：跳过 1.3/1.4 与后续所有 commit 步骤，其余步骤不变；交付时统一列出待提交文件清单。

---

## 任务 2：目标域基线跑通（先测后改）

**Files:** 无预设改动；如果发现回归，修复落在对应文件并小步提交 `fix(home): …`。

- [ ] **2.1 类型基线**：`cd frontend && npm run typecheck` → 期望 0 错误（已通过，复跑确认）。
- [ ] **2.2 单测基线**：`cd backend && npm test -- home/` → 期望 `../frontend/src/home/*.test.ts` 全绿（scopeParity、homeModel、kolContract、todayPlan、discovery*、displayTasks、surfaceError 等）；记录通过文件数/用例数。
- [ ] **2.3 E2E 基线**：`cd frontend && npm run test:e2e -- home-` → 期望全部 `home-*.spec.ts` 通过（首次运行 e2e-server 会重建前端，耗时属预期）；记录通过数。
- [ ] **2.4 处置失败**：任何失败先归类——(a) 本次迁移引入 → 立即修复并提交；(b) 基线失败/并发 flake → 记录命令、报错与 `test-results/` 证据，不盲修，在任务 7 的门禁记录中区分。
- [ ] **2.5 阶段 0 规范同步复核**（只读核对，不动代码）：IA / DESIGN / DECISIONS / BIZ-07 登记逐项能在库内指认（见「现状核对」表）；有缺口只补文档，并在任务 7.4 一并登记。

---

## 任务 3：五模式骨架不变量测试补强（先建网，再重构）

**Files:**
- Modify: `frontend/e2e/home-pane-parity.spec.ts`
- Modify: `frontend/src/home/scopeParity.test.ts`

- [ ] **3.1 在 parity spec 添加断言 helper**：

```ts
/** 横向溢出量：scrollWidth 超出 clientWidth 的像素数（1px 容差）。 */
async function horizontalOverflow(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => el.scrollWidth - el.clientWidth);
}

/** 五模式共用的 Chrome 断言：同壳、导航不在 Composer、无横向溢出、CTA ≤ 1。 */
async function expectWorkspaceChrome(page: Page, mode: string) {
  const root = page.locator(`[data-home-pane="${mode}"]`);
  await expect(root.locator("[data-scope-ai-workspace]")).toBeVisible({ timeout: 30000 });
  await expect(root.locator("[data-scope-task-rail]")).toBeVisible();
  await expect(root.locator("[data-home-quick-tasks]")).toBeVisible();
  await expect(root.locator(".home-composer-dock")).toBeVisible();
  // 模式导航属于页面导航，不寄生在提问框里；「首次建联」不是第六模式。
  await expect(page.locator(`[data-home-pane="${mode}"] .home-composer-dock [data-home-quick-tasks]`)).toHaveCount(0);
  await expect(root.locator('[data-home-quick-task="first-outreach"]')).toHaveCount(0);
  expect(await horizontalOverflow(page, `[data-home-pane="${mode}"]`)).toBeLessThanOrEqual(1);
  expect(await horizontalOverflow(page, `[data-home-pane="${mode}"] [data-scope-task-rail]`)).toBeLessThanOrEqual(1);
  expect(await filledPrimaryCount(page, `[data-home-pane="${mode}"]`)).toBeLessThanOrEqual(1);
}
```

- [ ] **3.2 将「公海与我的红人 use the same interaction and result shell」用例改为五模式循环**（`["today","todo","discovery","pool","lifecycle"]`）调用 `expectWorkspaceChrome`，保留对象面专有断言：`[data-pool-overview]` / `[data-lifecycle-overview]` 必须位于 `[data-scope-task-rail]` 之内。
- [ ] **3.3 新增「折叠按模式记忆、互不串台」用例**：

```ts
test("rail collapse is remembered per mode and never bleeds across modes", async ({ page }) => {
  await page.goto("/?tab=pool");
  await page.locator('[data-home-pane="pool"] .scope-task-rail-toggle').click();
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toHaveClass(/is-collapsed/);
  await page.reload();
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toHaveClass(/is-collapsed/);
  await page.goto("/?tab=lifecycle");
  await expect(page.locator('[data-home-pane="lifecycle"] [data-scope-task-rail]')).not.toHaveClass(/is-collapsed/);
  await page.goto("/?tab=pool");
  await page.locator('[data-home-pane="pool"] .scope-task-rail-toggle').click();
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).not.toHaveClass(/is-collapsed/);
});
```

- [ ] **3.4 新增「堆叠与矮视口」用例**：

```ts
test("workspace stacks at 1000px and keeps the dock on short viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/?tab=pool");
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toBeVisible({ timeout: 30000 });
  const display = await page.locator('[data-home-pane="pool"] .scope-workspace')
    .evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe("block");
  expect(await horizontalOverflow(page, "html")).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-home-pane="pool"] .scope-task-rail-toggle')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 520 });
  await page.goto("/?tab=lifecycle");
  await expect(page.locator('[data-home-pane="lifecycle"] [data-scope-task-rail]')).toBeVisible({ timeout: 30000 });
  const geometry = await workspaceGeometry(page, "lifecycle");
  expect(geometry.pageScrolls).toBe(false);
  expect(geometry.dockBottom).toBe(520);
});
```

- [ ] **3.5 新增键盘冒烟用例**（右栏开关可聚焦、Enter 切换、aria-expanded 同步）：

```ts
test("rail toggle is keyboard operable", async ({ page }) => {
  await page.goto("/?tab=pool");
  const toggle = page.locator('[data-home-pane="pool"] .scope-task-rail-toggle');
  await expect(toggle).toBeVisible({ timeout: 30000 });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});
```

- [ ] **3.6 单测补强**（`scopeParity.test.ts` 追加一个用例；token 只住 DESIGN→styles.css）：

```ts
it("keeps workspace rail geometry on DESIGN tokens", () => {
  const css = read("../styles.css");
  const boardCss = read("./today-plan-board.css");
  for (const token of [
    "--workspace-result-rail-min",
    "--workspace-result-rail-ideal",
    "--workspace-result-rail-max",
    "--workspace-result-rail-collapsed",
  ]) {
    expect(css).toContain(`${token}:`);
  }
  expect(boardCss).toContain("var(--workspace-result-rail-min)");
  expect(boardCss).not.toMatch(/clamp\(\s*600px/);
  expect(boardCss).toContain("max-width: 1100px");
});
```

- [ ] **3.7 运行**：`cd frontend && npm run test:e2e -- home-pane-parity`（期望全绿）；`cd backend && npm test -- scopeParity`（期望全绿）。若 3.4/3.5 暴露真实缺陷（堆叠/矮视口/键盘），修复 CSS 或组件后复跑——这是改动前修网的正常路径。
- [ ] **3.8 提交**：`git add frontend/e2e/home-pane-parity.spec.ts frontend/src/home/scopeParity.test.ts && git commit -m "test(home): 五模式骨架不变量（无横向溢出 / 折叠记忆 / 堆叠 / 键盘）"`

---

## 任务 4：抽取 `usePoolWorkspace`（行为不变）

**Files:**
- Create: `frontend/src/home/usePoolWorkspace.ts`
- Modify: `frontend/src/pages/Home.tsx`

**Interfaces（新 hook 契约，供任务 5 与后续里程碑复用）：**

```ts
// frontend/src/home/usePoolWorkspace.ts
import { useCallback, useMemo, useState } from "react";
import type { HomeSurface } from "./surfaceError";
import { claimPoolKol, loadHomePool } from "./kolSurfaceApi";
import type { PoolKol } from "./kolContract";

export function usePoolWorkspace(options: {
  /** 共享 board 管线：带首入缓存与 force 刷新，错误按 surface 路由。 */
  loadBoard: (surface: HomeSurface, force?: boolean) => Promise<void>;
  /** board 成功后拿到的公海索引原始行。 */
  boardKols: () => Array<Record<string, unknown>>;
  /** 领取成功后：清理选择并刷新「我的红人」面。 */
  onClaimed: (kolUid: string) => Promise<void>;
}) {
  // state：cards / query / error / claimTarget / claimBusy / claimError
  // 迁移自 Home.tsx：poolCards、poolQuery、poolError、claimTarget、claimBusy、claimError
  // 行为不变地搬运：loadPoolSurface、confirmClaim 主体
  return {
    cards, visibleCards,                    // visibleCards = 按 query 过滤（原 toggleSelectAllPool 内联的过滤逻辑）
    query, setQuery,
    error, setError,                        // applyBoard 失败时由 Home 路由写回
    loadSurface,                            // 原 loadPoolSurface
    ensureLoaded,                           // 原 mode==="pool" effect：loadBoard("pool").then(loadPoolSurface)
    claimTarget, claimBusy, claimError,
    requestClaim, confirmClaim, cancelClaim,
  };
}
```

**符号归属表（迁移自 `Home.tsx`）：**

| 现状符号 | 去向 |
|---|---|
| `poolCards` `poolQuery` `poolError` `claimTarget` `claimBusy` `claimError` `loadPoolSurface` `confirmClaim` | → hook |
| `selectedKolIds`、`toggleSelectedPool`、`toggleSelectAllPool` | **留在 Home**（跨模式共享选择；`toggleSelectAllPool` 改用 `visibleCards`） |
| `loadBoard` / `boardKolsRef` / `followScope` / `retrySurface` / `handoffSurface` / `retryingSurface` | **留在 Home**（board 共享管线，按 §11.4 属「跨模式共享入口状态」） |

- [ ] **4.1 写 hook**：按上面契约搬运；`claimPoolKol` 成功后移除卡片（原逻辑）+ 调 `onClaimed(kolUid)`（Home 传入：清选择 + `loadFollowingSurface()`）。
- [ ] **4.2 Home 接线**：`const poolWorkspace = usePoolWorkspace({ loadBoard, boardKols: () => boardKolsRef.current, onClaimed });`；删除被迁移的 state/函数；`ObjectWorkspace`/`PoolPane` 的 props 改引 hook；`prefillAnalyze("pool", …)`、`interactionFeedback`、handoff 文案不变。
- [ ] **4.3 类型检查**：`cd frontend && npm run typecheck` → 0 错误。
- [ ] **4.4 行为不变证据**：`cd frontend && npm run test:e2e -- home-pool-follow home-surface-failure home-pane-parity home-four-panel` → 全绿（**必须不改断言**）。
- [ ] **4.5 提交**：`git add frontend/src/home/usePoolWorkspace.ts frontend/src/pages/Home.tsx && git commit -m "refactor(home): 公海状态迁入 usePoolWorkspace（行为不变）"`

---

## 任务 5：抽取 `useFollowedWorkspace`（行为不变）

**Files:**
- Create: `frontend/src/home/useFollowedWorkspace.ts`
- Modify: `frontend/src/pages/Home.tsx`（如 props 形态变化，连带 `ObjectWorkspace.tsx` / `FollowedPane.tsx`）

**Interfaces（新 hook 契约）：**

```ts
// frontend/src/home/useFollowedWorkspace.ts
export function useFollowedWorkspace(options: {
  loadBoard: (surface: HomeSurface, force?: boolean) => Promise<void>;
  boardKols: () => Array<Record<string, unknown>>;
  followScope: StarryBinding | null;
  setFollowScope: (scope: StarryBinding | null) => void;
  selectedIds: string[];              // 跨模式选择留在 Home；hook 只做派生与动作
  todoItems: Task[];                  // projectFollowedKolCard 的第二个入参
  openTask: (task: Task) => Promise<void>;  // Home 的共享动作（今日/待办也在用）
  onReleased: () => Promise<void>;    // 释放成功后刷新公海面（Home 传入 poolWorkspace.loadSurface）
}) {
  // 行为不变地搬运 Home.tsx 中「我的红人」的全部状态与动作（见下表）
  return {
    rows, cards, visibleCards,        // followedKols / kolCards / visibleKols
    query, setQuery, stageFilter, setStageFilter, situation, setSituation,
    hoveredId, setHoveredId, focusedId, setFocusedId,
    error, setError,                  // 原 followingError
    followEmptyKind,                  // 派生（入参 followScope + rows + filters）
    confirmStageBusyId, confirmStageFeedback,
    batchPending, runBatch, confirmBatch, cancelBatch,     // 原 pendingBatchCards / runSelectedStageEnter / confirmSelectedStageEnter
    releaseTarget, releaseBusy, releaseError,
    requestRelease, confirmRelease, cancelRelease,
    loadSurface,                      // 原 loadFollowingSurface
    ensureLoaded,                     // 原 mode==="lifecycle" effect
    openDetails,                      // 原 openKol
    runCardAction,                    // 原 runKolCardAction（含 compose / confirm-stage / profile 分支）
    compose,                          // 原 startCompose
    confirmStage,                     // 原 openConfirmStage（openTask 经入参注入）
    openMail,                         // 原 FollowedPane 的 onOpenMail 包装（nav + mailHref）
  };
}
```

**符号归属表（迁移自 `Home.tsx`）：**

| 现状符号 | 去向 |
|---|---|
| `followedKols` `kolQuery` `stageFilter` `situationFilter` `hoveredKolId` `focusedKolId` `followingError` `confirmStageBusyId` `confirmStageFeedback` `pendingBatchCards` `releaseTarget/Busy/Error` | → hook |
| `visibleKols` `kolCards` `selectedKolCards`（派生意）| → hook（`todoItems`、`selectedIds` 入参） |
| `runKolCardAction` `openKol` `startCompose` `openConfirmStage` `runSelectedStageEnter` `confirmSelectedStageEnter` `confirmRelease` `loadFollowingSurface` | → hook |
| `loadBoard` `boardKolsRef` `followScope` `selectedKolIds` `retryingSurface` `handoffSurface` `openTask` `prefillAnalyze` 接线 | **留在 Home** |
| `setSurfaceError(surface, …)` | Home 改为按 surface 调 `poolWorkspace.setError` / `followedWorkspace.setError` |

- [ ] **5.1 写 hook**：按契约搬运；`openConfirmStage` 的 `openTask` 走入参；`storePending` / `rememberJourney` / `nav` / `api.openKolSession` 逻辑与现在逐字一致。
- [ ] **5.2 Home 接线**：`const followedWorkspace = useFollowedWorkspace({ …, onReleased: () => poolWorkspace.loadSurface() });`；删除被迁移的 state/函数；`ObjectWorkspace pane="lifecycle"` 的 props 改引 hook 输出。
- [ ] **5.3 类型检查**：`cd frontend && npm run typecheck` → 0 错误。
- [ ] **5.4 行为不变证据**：`cd frontend && npm run test:e2e -- home-followed-focus home-pool-follow home-surface-failure home-pane-parity home-four-panel home-chat-send-ne-stage` → 全绿（不改断言）。
- [ ] **5.5 提交**：`git add frontend/src/home/useFollowedWorkspace.ts frontend/src/pages/Home.tsx frontend/src/home/ObjectWorkspace.tsx frontend/src/home/FollowedPane.tsx && git commit -m "refactor(home): 我的红人状态迁入 useFollowedWorkspace（行为不变）"`

---

## 任务 6：对象面死分支与死样式清理（阶段 4#5）

**Files:**
- Modify: `frontend/src/home/PoolPane.tsx`
- Modify: `frontend/src/home/FollowedPane.tsx`
- Modify: `frontend/src/home/ObjectWorkspace.tsx`、`frontend/src/pages/Home.tsx`
- Modify: `frontend/src/home/today-plan-board.css`（`frontend/src/styles.css` 如命中旧选择器）
- Modify: `frontend/src/home/scopeParity.test.ts`

- [ ] **6.1 删除 `embedded` 死分支**：`PoolPane`/`FollowedPane` 移除 `embedded` prop 与 `embedded=false` 旧全宽渲染；固定输出 `class="recommend-work followed-kol-pane is-result-rail"`，不再自带 `data-home-pane` / `home-mode-pane`。同步删除 `ObjectWorkspace`/`Home` 的 `embedded` 传参。
- [ ] **6.2 死样式清理（保守：grep 证明无引用才删）**：用 Grep 搜索 `data-home-pane="pool"`、`data-home-pane="lifecycle"`、`home-mode-pane`、`followed-kol-pane`（`frontend/src/styles.css`、`frontend/src/home/*.css`），逐条判定：仅服务旧页面级布局的规则删除；`.scope-task-rail-body > .home-mode-pane` 若失去匹配对象，改挂 `.is-result-rail` 并保留 `width:100%; min-width:0` 声明；每删一批立即跑 6.3 验证。
- [ ] **6.3 验证**：`cd frontend && npm run typecheck && npm run test:e2e -- home-`（全绿）；`cd backend && npm test -- scopeParity`（全绿）。
- [ ] **6.4 单测追加**：`scopeParity.test.ts` 断言两个 pane 不再声明第二套 pane 骨架（如 `expect(pool).not.toContain("embedded")`、`expect(pool).not.toContain('data-home-pane')`，同类断言加到 followed）。
- [ ] **6.5 提交**：`git add frontend/src/home/PoolPane.tsx frontend/src/home/FollowedPane.tsx frontend/src/home/ObjectWorkspace.tsx frontend/src/pages/Home.tsx frontend/src/home/today-plan-board.css frontend/src/styles.css frontend/src/home/scopeParity.test.ts && git commit -m "refactor(home): 移除对象面旧全宽分支与死样式"`（styles.css 未改则从命令中剔除）。

---

## 任务 7：验收证据、全量门禁与文档回填

**Files:**
- Create: `frontend/e2e/workspace-evidence.spec.ts`（按需运行，不拖慢默认门禁）
- Modify: `docs/superpowers/specs/2026-09-23-unified-agent-workspace.md`（追加「实施证据」小节）

- [ ] **7.1 截图证据 spec**（仿 `artifacts/` 既有截图脚本惯例；输出到 `artifacts/review/unified-agent-workspace/`）：

```ts
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "../artifacts/review/unified-agent-workspace");

test("capture pool and lifecycle workspace evidence", async ({ page }) => {
  test.skip(process.env.E2E_EVIDENCE !== "1", "按需证据截屏（E2E_EVIDENCE=1 时运行）");
  fs.mkdirSync(OUT, { recursive: true });
  for (const mode of ["pool", "lifecycle"] as const) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1000, height: 900 }, { width: 1440, height: 520 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`/?tab=${mode}`);
      await expect(page.locator(`[data-home-pane="${mode}"] [data-scope-task-rail]`)).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: path.join(OUT, `${mode}-${viewport.width}x${viewport.height}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?tab=${mode}`);
    await page.locator(`[data-home-pane="${mode}"] .scope-task-rail-toggle`).click();
    await page.screenshot({ path: path.join(OUT, `${mode}-collapsed.png`) });
  }
});
```

- [ ] **7.2 运行并人工检查**：`cd frontend && E2E_EVIDENCE=1 npm run test:e2e -- workspace-evidence`；逐张核对 8 张截图（默认 / 折叠 / 1000 堆叠 / 1440×520 矮视口 × 公海·我的红人）符合 DESIGN 三轴观感；不合格则回到任务 3/6 修 CSS 后重拍。
- [ ] **7.3 全量门禁**（分别在 `backend/`、`frontend/` 下执行）：

```bash
# backend/
npm run validate:kol-data && npm run validate:contracts && npm run validate:tb-binding \
  && npm run typecheck && npm test
# frontend/
npm run typecheck && npm run build && npm run test:e2e
```

  期望：全绿。记录：目标域失败 = 0；如有基线/flake 失败，附 `test-results/` 证据并标明归属（沿用任务 2.4 的分类）。
- [ ] **7.4 文档回填**：
  - 在 spec `2026-09-23-unified-agent-workspace.md` 末尾追加「实施证据（2026-09-23：阶段 0/1 收尾 + 阶段 4）」小节：单元/E2E 清单与通过数、截图路径、各提交 hash、基线记录（任务 2）。
  - 复核 `specs/ux-traceability.json` 两个绑定在本轮全量 e2e 中通过：`SEND_NE_STAGE` → `home-chat-send-ne-stage.spec.ts`、`L3_CONFIRM` → workbench `owner-gate` 用例；**绑定无需修改**，只在证据小节记一句「未受影响」。
  - 对照 §19 完成定义逐条标注本里程碑状态（1✅、2✅、3/4 部分、5✅、6/7 部分、8 部分）与明确推迟项（设计决策 2/3）。
- [ ] **7.5 提交**：`git add frontend/e2e/workspace-evidence.spec.ts docs/superpowers/specs/2026-09-23-unified-agent-workspace.md && git commit -m "docs+test(home): 统一工作台阶段 0/1+4 实施证据"`（截图产物按惯例不入库，只留 spec 引用路径）。

---

## 验收矩阵映射（本计划关闭 / 明确推迟）

| §17 条目 | 本计划 | 依据 |
|---|---|---|
| 17.1 五模式同壳 / 中栏+右栏语义 / 导航不在 Composer / 首次建联非模式 / 每栏单滚动 / 无横向滚动 / ≤1 实底 CTA / 状态多通道 | ✅ 关闭（除末条） | 任务 3 五模式 Chrome 断言 + 既有 parity 用例 |
| 17.1「切换模式再返回保留草稿 / 结果选择」 | ⏭ 推迟（设计决策 3） | 需输入版本/草稿隔离模型，随阶段 2 |
| 17.2 queued/running/needs_input/failed/cancelled/刷新恢复 | 🟡 既有覆盖复核（任务 2.3/7.3） | 不改行为；发现缺口记入阶段 2 计划 |
| 17.2「修改输入使旧 L3 确认失效」 | ⏭ 推迟 | 随结构化澄清与 inputVersion（阶段 2/3） |
| 17.3 AI发现入库 / 领取 / 释放 / 首次建联 / 阶段确认 | ✅ 关闭（验证不回归） | `home-pool-follow`、`home-chat-send-ne-stage`、workbench 全量 |
| 17.4 宽度轴（1440 / 1100 堆叠 / 1000）| ✅ 关闭 | 任务 3.4 + 截图 |
| 17.4 高度轴（矮视口 Composer 不裁切） | ✅ 关闭 | 任务 3.4 + 截图 |
| 17.4 键盘（右栏开关可聚焦/Enter/ARIA） | ✅ 关闭 | 任务 3.5 |
| 17.4 屏幕阅读器全项 / ≤860 抽屉验收 | 🟡 部分（截图 + 现有规则） | 完整 SR 走阶段 6 证据集 |
| 17.5 单元（reducer/澄清版本/action risk） | ⏭ 推迟 | 随阶段 2/3 建单元 |
| 17.5 E2E（shell parity / 双滚动 / 无横向溢出 / 刷新恢复） | ✅ 关闭 | 任务 3 |
| 17.5 业务回归（AI发现/领取/释放/阶段/发送） | ✅ 关闭 | 任务 7.3 全量 |
| 17.5 人工截图（本里程碑关键组合） | ✅ 关闭 | 任务 7.1/7.2 |

---

## 回滚策略（spec §18）

- 本里程碑全部为**前端呈现层 + 文档 + 测试**改动，无后端迁移、无数据变更、无 flag 需求。
- 逐个任务一条提交（任务 1 基线 + 3/4/5/6/7 各自提交），回滚粒度 = 单任务：`git revert <hash>` 或按文件 `git checkout <hash>~1 -- <paths>`。
- 只回退呈现层不影响 L3 回执：已发生的发送、导入、领取、释放、阶段变更继续按真实状态展示（前端不持久化权威事实）。
- 若只回退公海/我的红人形态：恢复 `PoolPane/FollowedPane` 旧全宽分支 + `Home.tsx` 对应段落（任务 6 的提交是独立回滚点）。

## 后续里程碑（另行计划，沿用同一规格）

- **D｜阶段 2 今日/待办**：抽取 `InteractionSurface` / `ResultRail` 与 `workspace-types` / `reducer`（含 ClarificationQuestionView、inputVersion、L3 快照失效）；`TodayPlanProgress + PlanSummary` → 时间线 block；TaskBoard 接 ResultRail；模式草稿与选择隔离（关闭 §17.1 末条）。
- **E｜阶段 3 AI发现**：统一视图模型接入；结果工具栏横向溢出治理；条件修改生成新 input version。
- **F｜阶段 5 首次建联与技能接入**：`WorkspaceCapability` 注册表（延伸 `entryRegistry.ts` 与 backend `host/entry-registry.ts`）；`creator_outreach` 成为公海/我的红人/对象详情的对象动作；L2 草稿 renderer + L3 发送确认与回执组合。
- **G｜阶段 6 清理与发布**：`Home.tsx` 状态数收敛复核；全量死 CSS；无障碍与截图证据全集；发布门禁与三轴人工验收。
