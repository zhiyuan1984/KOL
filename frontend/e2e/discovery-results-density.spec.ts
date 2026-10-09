import { expect, test, type Page } from "@playwright/test";

const brief = { platforms: ["youtube"], region: "global_en", directions: [], keywords: ["camping"],
  min_followers: 10000, max_followers: null, min_avg_plays_10: 5000, expect_count: 30 };
const template = { id: "crawler_collect", skill_id: "crawler_collect", version: "1", title: "采集线索",
  inputs: [], steps: [], constraints: [], output: { title: "候选" } };

async function fixture(page: Page, theme = "light") {
  let state = "scoring";
  let inPool = false;
  let followed = false;
  let snapshot = "snapshot";
  let failedImport: string | undefined;
  let runtimeReads = 0;
  const states = new Map<string, string>();
  let failedScore: string | undefined;
  let extraRun = false;
  let scoreGate: Promise<void> | undefined;
  let releaseScore: (() => void) | undefined;
  const writes: string[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === "/api/health") json = { ok: true };
    else if (path === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (path === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (path === "/api/preferences") json = { theme };
    else if (path.includes("/api/tasks/by-session/") || path === "/api/tasks/density") json = { task: { id: "density", session_id: "density", title: "AI发现",
      status: "completed", skill_id: "crawler_collect", input: { discovery_workspace: { kind: "discovery", version: 1,
        agent_id: "lead", profile: "lead", brief, template, submitted_text: "发现候选" } } } };
    else if (path === "/api/sessions/density") json = { agent_status: "listening", messages: [] };
    else if (path === "/api/queries/runtime.actions") {
      runtimeReads++;
      const action = { id: "density-action", skill_id: "crawler_collect", operation: "start_crawl", state: "succeeded",
      arguments: {}, confirmation_version: "v1", receipt: { task_id: "density-crawl" }, crawl: { id: "density-action", state: "succeeded", result_state: "ready", result_json: {
        task_id: "density-crawl", complete: true, captured_at: "2026-10-09T01:00:00Z", candidates: Array.from({ length: 8 }, (_, i) => ({
          id: `account-${i}`, name: `Camping creator ${i + 1}`, platform: "youtube", region: "Canada", followers: 200000, avg_views_10: 15000,
          source_url: `https://youtube.com/channel/account-${i}`, snapshot_version: snapshot, in_pool: inPool && i === 0,
          followed: followed && i === 0,
          followers_evidence: { state: "source_recorded", raw_text: "200K subscribers" },
          assessment: (() => {
            const current = states.get(`account-${i}`) || (i === 0 ? state : "unscored");
            return { state: current === "queued" ? "scoring" : current, execution_state: current === "unscored" ? undefined : current,
              ...(current === "scored" ? { potential_score: 83, risk_score: 25, potential_confidence: 0.8,
                risk_confidence: 0.9, version: "jev-kol-v1", assessed_at: "2026-10-09T01:01:00Z", criteria_summary: "平台 youtube · 关键词 camping" } : {}) };
          })(),
        })) } } };
      json = { actions: extraRun ? [action, { ...action, id: "density-action-2" }] : [action] };
    }
    else if (path.includes("/api/home/discovery/runtime/")) {
      writes.push(path);
      if (path.endsWith("/ingest") && failedImport && path.includes(`/${failedImport}/`)) {
        return route.fulfill({ status: 503, json: { error: "import_creator_uncertain" } });
      }
      if (path.endsWith("/score")) {
        if (scoreGate) await scoreGate;
        const id = path.split("/").at(-2)!;
        if (id === failedScore) return route.fulfill({ status: 503, json: { error: "assessment_unavailable" } });
        states.set(id, "queued");
      }
      if (path.endsWith("/ingest")) inPool = true;
      json = { ok: true };
    } else if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "" });
    await route.fulfill({ json });
  });
  return { writes, setScore: (next: string) => { state = next; }, changeSnapshot: () => { snapshot = "changed"; },
    setCandidateScore: (id: string, next: string) => { states.set(id, next); },
    failScore: (id: string) => { failedScore = id; }, addRun: () => { extraRun = true; },
    holdScores: () => { scoreGate = new Promise<void>(resolve => { releaseScore = resolve; }); },
    releaseScores: () => { releaseScore?.(); scoreGate = undefined; },
    setFollowed: () => { followed = true; },
    failImport: (id: string) => { failedImport = id; }, runtimeReads: () => runtimeReads };
}

test("scores update in place, survive reload and batch import requires confirmation", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/s/density");
  const first = page.locator("[data-discovery-candidate=account-0]");
  await expect(first.locator("[data-candidate-score]")).toHaveText("评分中…");
  await expect(page.getByRole("button", { name: "让线索智能体分析候选" })).toHaveCount(0);
  f.setScore("scored");
  // The crawl is already terminal. Scoring must finish visibly without a
  // refresh, an artificial event, or another scoring request.
  await expect(first.locator("[data-candidate-score]")).toContainText("83");
  expect(f.writes).toEqual([]);
  await page.reload();
  await expect(first.locator("[data-candidate-score]")).toContainText("83");
  await first.locator("summary").click();
  await expect(first).toContainText("规则版本：v1");
  await expect(first).toContainText("关键词 camping");
  await first.getByRole("checkbox").check();
  await page.getByRole("button", { name: "加入公海（1）", exact: true }).click();
  expect(f.writes).toEqual([]);
  await expect(page.getByRole("dialog")).toContainText("account-0");
  await page.getByRole("dialog").getByRole("button", { name: "确认入库公海" }).click();
  await expect(first).toContainText("已加入公海");
  expect(f.writes.filter(p => p.endsWith("/ingest"))).toHaveLength(1);
  expect(f.writes.some(p => /follow|send|stage/.test(p))).toBeFalsy();
  await page.clock.install();
  const settledReads = f.runtimeReads();
  await page.clock.runFor(6000);
  expect(f.runtimeReads()).toBe(settledReads);
});

test("a completed crawl refreshes a scoring failure without another scoring request", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/s/density");
  const score = page.locator("[data-discovery-candidate=account-0] [data-candidate-score]");
  await expect(score).toHaveText("评分中…");
  f.setScore("failed");
  await expect(score).toHaveText("评分失败");
  expect(f.writes).toEqual([]);
});

test("one list entry retries selected failures and leaves other candidates untouched", async ({ page }) => {
  const f = await fixture(page); f.setScore("failed");
  await page.goto("/s/density");
  const first = page.locator("[data-discovery-candidate=account-0]");
  await expect(first.locator("[data-candidate-score]")).toHaveText("评分失败");
  await expect(page.getByRole("button", { name: /开始评分|重试评分/ })).toHaveCount(0);
  await first.getByRole("checkbox").check();
  await page.getByRole("button", { name: "补全评分（1）", exact: true }).click();
  await expect(first.locator("[data-candidate-score]")).toHaveText("排队评分");
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatch(/account-0\/score$/);
});

test("list completion skips successful and active scores, blocks duplicate clicks and reuses results after reload", async ({ page }) => {
  const f = await fixture(page); f.setScore("scored");
  f.setCandidateScore("account-1", "queued");
  f.setCandidateScore("account-2", "scoring");
  f.setCandidateScore("account-3", "failed");
  f.holdScores();
  await page.goto("/s/density");
  await expect(page.locator(".discovery-scoring-progress")).toHaveText("已评分 1 · 排队 1 · 评分中 1 · 失败 1 · 未评分 4");
  const button = page.getByRole("button", { name: "补全评分（5）", exact: true });
  await button.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
  await expect(page.getByRole("button", { name: "正在提交评分…", exact: true })).toBeDisabled();
  await expect.poll(() => f.writes.filter(path => path.endsWith("/score")).length).toBe(1);
  f.releaseScores();
  await expect(page.locator(".discovery-scoring-receipt")).toHaveText("已提交 5 位评分，结果自动更新。");
  expect(f.writes.map(path => path.split("/").at(-2))).toEqual(["account-3", "account-4", "account-5", "account-6", "account-7"]);
  for (let i = 1; i < 8; i++) f.setCandidateScore(`account-${i}`, "scored");
  await expect(page.locator(".discovery-scoring-progress")).toHaveText("已评分 8 · 排队 0 · 评分中 0 · 失败 0 · 未评分 0");
  await page.reload();
  await expect(page.getByRole("button", { name: "补全评分（0）", exact: true })).toBeDisabled();
  expect(f.writes).toHaveLength(5);
  expect(f.writes.some(path => /follow|ingest|send|stage/.test(path))).toBeFalsy();
});

test("one failed submission does not stop selected candidates and can be completed separately", async ({ page }) => {
  const f = await fixture(page); f.setScore("failed"); f.failScore("account-1");
  await page.goto("/s/density");
  for (const id of [0, 1, 2]) await page.locator(`[data-discovery-candidate=account-${id}]`).getByRole("checkbox").check();
  await page.getByRole("button", { name: "补全评分（3）", exact: true }).click();
  await expect(page.locator(".discovery-scoring-receipt")).toHaveText("已提交 2 位评分；1 位提交未确认，请刷新核对后补全。");
  expect(f.writes.map(path => path.split("/").at(-2))).toEqual(["account-0", "account-1", "account-2"]);
  await expect(page.getByRole("button", { name: "补全评分（1）", exact: true })).toBeEnabled();
  f.failScore("");
  await page.getByRole("button", { name: "补全评分（1）", exact: true }).click();
  await expect(page.locator(".discovery-scoring-receipt")).toHaveText("已提交 1 位评分，结果自动更新。");
  expect(f.writes.at(-1)).toMatch(/account-1\/score$/);
});

test("multiple crawl receipts still share one scoring entry", async ({ page }) => {
  const f = await fixture(page); f.addRun();
  await page.goto("/s/density");
  await expect(page.locator("[data-discovery-results-summary]")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^补全评分/ })).toHaveCount(1);
});

test("batch import stops after an uncertain receipt and preserves a partial completion receipt", async ({ page }) => {
  const f = await fixture(page); f.failImport("account-1");
  await page.goto("/s/density");
  for (const id of [0, 1, 2]) await page.locator(`[data-discovery-candidate=account-${id}]`).getByRole("checkbox").check();
  await page.getByRole("button", { name: "加入公海（3）", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认入库公海" }).click();
  await expect(page.locator(".discovery-batch-receipt")).toHaveText("本次已确认加入公海 1 位；2 位未完成。");
  expect(f.writes.filter(p => p.endsWith("/ingest"))).toHaveLength(2);
  expect(f.writes.some(p => p.includes("account-2"))).toBeFalsy();
  await expect(page.getByRole("dialog").getByRole("button", { name: "确认入库公海" })).toBeDisabled();
});

test("a changed candidate version invalidates an open batch confirmation", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/s/density");
  await page.locator("[data-discovery-candidate=account-0]").getByRole("checkbox").check();
  await page.getByRole("button", { name: "加入公海（1）", exact: true }).click();
  f.changeSnapshot();
  await page.evaluate(() => window.dispatchEvent(new Event("discovery:candidates-refresh")));
  await expect(page.getByRole("dialog")).toContainText("候选资料或归属已变化");
  await expect(page.getByRole("dialog").getByRole("button", { name: "确认入库公海" })).toBeDisabled();
  expect(f.writes).toEqual([]);
});

for (const theme of ["light", "dark"]) test(`dense candidates fit desktop, narrow and short viewports in ${theme}`, async ({ page }, info) => {
  const f = await fixture(page, theme); f.setScore("scored");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/s/density");
  const first = page.locator("[data-discovery-candidate=account-0]");
  await expect(first).toBeVisible();
  await page.screenshot({ path: info.outputPath(`discovery-${theme}-desktop.png`), fullPage: true });
  await info.attach("candidate-layout", { body: JSON.stringify(await first.evaluate(el => Array.from(el.children).map(child => ({
    className: child.className, height: child.getBoundingClientRect().height, font: getComputedStyle(child).fontSize,
    lineHeight: getComputedStyle(child).lineHeight, margin: getComputedStyle(child).margin,
  })))), contentType: "application/json" });
  const height = (await first.boundingBox())!.height;
  expect(height).toBeLessThan(120);
  const summary = page.locator("[data-discovery-results-summary]");
  expect((await summary.boundingBox())!.height).toBeLessThan(100);
  for (const [width, height] of [[1024, 589], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect(first).toBeVisible();
    expect(await first.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await first.locator("summary").focus(); await page.keyboard.press("Enter");
    await expect(first.locator("details")).toHaveAttribute("open", "");
    await first.locator("summary").click();
  }
});

test.describe("touch input", () => {
  test.use({ hasTouch: true });
  test("candidate selection, actions and evidence have reachable touch targets", async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/s/density");
    // Main restores this completed session with its candidate results expanded.
    await expect(page).toHaveURL(/\/s\/density$/);
    const first = page.locator("[data-discovery-candidate=account-0]");
    await expect(first).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBeTruthy();
    for (const target of await first.locator(".discovery-candidate-selection, button, summary").all()) {
      const box = (await target.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const scoreButton = (await page.getByRole("button", { name: /^补全评分/ }).boundingBox())!;
    expect(scoreButton.height).toBeGreaterThanOrEqual(44);
    expect(scoreButton.width).toBeGreaterThanOrEqual(44);
    await first.locator(".discovery-candidate-selection").tap();
    await expect(first.getByRole("checkbox")).toBeChecked();
    await first.locator("summary").tap();
    await expect(first.locator("details")).toHaveAttribute("open", "");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
});

test("your followed candidate can retry pool import after confirmation without leaving its session", async ({ page }) => {
  const f = await fixture(page); f.setScore("scored"); f.setFollowed();
  await page.goto("/s/density");
  const first = page.locator("[data-discovery-candidate=account-0]");
  await expect(first.locator(".discovery-candidate-heading .discovery-candidate-state")).toHaveText("已跟进");
  await expect(first.getByRole("button", { name: "跟进", exact: true })).toBeDisabled();
  const retry = first.getByRole("button", { name: "加入公海", exact: true });
  await expect(retry).toBeEnabled();
  await expect(retry).toHaveAttribute("title", /补写 Starry 公海/);
  await retry.click();
  expect(f.writes).toEqual([]);
  await expect(page.getByRole("dialog")).toContainText("account-0");
  const reads = f.runtimeReads();
  await page.getByRole("dialog").getByRole("button", { name: "确认入库公海", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => f.runtimeReads()).toBeGreaterThan(reads);
  await expect(page).toHaveURL(/\/s\/density$/);
  expect(f.writes).toEqual(["/api/home/discovery/runtime/density-action/candidates/account-0/ingest"]);
  await expect(first).toContainText("已跟进");
});
