import { expect, test, type Page } from "@playwright/test";

type ClaimMode = "success" | "conflict" | "uncertain";
type Mutation = { method: string; path: string; body: Record<string, unknown> | null };

const avatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#456"/><circle cx="40" cy="32" r="16" fill="#9ab"/></svg>')}`;
const NEW_COUNT = 25;
const OVERDUE_COUNT = 28;
const TOTAL_COUNT = NEW_COUNT + OVERDUE_COUNT;
const primaryUid = "pool-new-00";

/**
 * This deliberately looks like a server snapshot, not an in-memory component
 * fixture. The first page has 24 new and 26 overdue rows; the endpoint facets
 * carry 25 / 28 over the authorized full result, proving badges must not be
 * calculated from whichever 50 rows happen to be rendered.
 */
const poolRows = Array.from({ length: TOTAL_COUNT }, (_, index) => {
  const isNew = index < 24 || index === 50;
  const handle = index === 0 ? "City Prepping" : `Pool Creator ${String(index).padStart(2, "0")}`;
  return {
    id: `pool-${index}`,
    kol_uid: index === 0 ? primaryUid : `pool-${index}`,
    handle,
    display_name: handle,
    platform: "youtube",
    homepage_url: `https://youtube.example/@pool-${index}`,
    avatar_url: avatar,
    followers: 120_000 + index * 1_000,
    avg_plays: 32_000 + index * 100,
    engagement: "0.041",
    direction: index % 2 ? "户外" : "离网电源",
    region: "United States",
    ingested_at: "2026-09-23T00:00:00Z",
    pool_status: "open",
    public_stage: isNew ? "未首次建联" : "14天无回复",
    ...(isNew ? {} : { has_conversation: true, owner_name: null, owner_user_id: null, owner_mailbox: null }),
  };
});

function isNewRow(row: Record<string, unknown>) {
  return !Boolean(row.has_conversation);
}

function matchesPool(row: Record<string, unknown>, query: string, filter: string) {
  const haystack = [row.handle, row.platform, row.direction, row.region].join(" ").toLowerCase();
  if (query && !haystack.includes(query.toLowerCase())) return false;
  if (filter === "new") return isNewRow(row);
  if (filter === "overdue") return !isNewRow(row);
  return true;
}

function followedRow() {
  return {
    id: "follow-pool-new-00",
    follow_id: "follow-pool-new-00",
    kol_uid: primaryUid,
    handle: "City Prepping",
    display_name: "City Prepping",
    platform: "youtube",
    status: "active",
    stage_code: "INITIAL_CONTACT",
    stage_label: "初步接触",
    countdown: false,
    last_interaction_at: null,
  };
}

async function installStatefulPoolFixture(page: Page, claimMode: ClaimMode = "success") {
  const mutations: Mutation[] = [];
  const errors: string[] = [];
  const poolReads: string[] = [];
  let followingReads = 0;
  let claimed = false;
  page.on("pageerror", (error) => errors.push(error.message));

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();
    const rawBody = request.postData();
    const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : null;
    if (method !== "GET") mutations.push({ method, path: pathname, body });

    if (pathname === "/api/kols/pool-new-00/claim" && method === "POST") {
      if (claimMode === "conflict") {
        await route.fulfill({ status: 409, json: { detail: "该对象刚刚被其他员工领取" } });
        return;
      }
      if (claimMode === "uncertain") {
        // Transport reached the command boundary but no release receipt came
        // back: retrying blind would risk a duplicate claim.
        await route.fulfill({ status: 200, json: { ok: true, kol_uid: primaryUid } });
        return;
      }
      claimed = true;
      await route.fulfill({ status: 201, json: {
        entry: "command", kind: "command", creates_session: false, calls_model: false,
        ok: true, created: true, follow: { follow_id: "follow-pool-new-00", kol_uid: primaryUid },
      } });
      return;
    }

    if (pathname === "/api/follows/follow-pool-new-00/release" && method === "POST") {
      claimed = false;
      await route.fulfill({ status: 200, json: {
        entry: "command", kind: "command", creates_session: false, calls_model: false,
        ok: true, follow_id: "follow-pool-new-00", kol_uid: primaryUid, stage_unchanged: true,
      } });
      return;
    }

    if (pathname === "/api/home/pool") {
      poolReads.push(url.search);
      const query = url.searchParams.get("query") || "";
      const filter = url.searchParams.get("filter") || "all";
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || 50);
      const available = poolRows.filter((row) => !claimed || row.kol_uid !== primaryUid);
      const matching = available.filter((row) => matchesPool(row, query, filter));
      await route.fulfill({ json: {
        entry: "memory", kind: "memory", creates_session: false, calls_model: false,
        index: "公海", library: { ok: true, count: TOTAL_COUNT },
        items: matching.slice(offset, offset + limit),
        page: {
          offset, limit, total: available.length, matched: matching.length,
          // The facets are deliberately full-range metadata, never page-local.
          new_count: NEW_COUNT, overdue_count: OVERDUE_COUNT,
          next_offset: offset + limit < matching.length ? offset + limit : null,
        },
      } });
      return;
    }

    if (pathname === "/api/home/following") {
      followingReads += 1;
      if (claimMode === "uncertain" && mutations.some((item) => item.path === `/api/kols/${primaryUid}/claim`)) {
        await route.fulfill({ status: 503, json: { detail: "跟进索引暂时不可读，领取状态待核对" } });
        return;
      }
      await route.fulfill({ json: {
        entry: "memory", kind: "memory", creates_session: false, calls_model: false,
        index: "我的跟进", authority: "kol_follow_index",
        follow_scope: { required: false, bound: false }, kols: claimed ? [followedRow()] : [],
      } });
      return;
    }

    let json: unknown = [];
    if (pathname === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (pathname === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (pathname === "/api/preferences") json = { theme: "light" };
    else if (pathname === "/api/home/board") json = { kols: [], workbench: {}, library: { count: TOTAL_COUNT }, follow_scope: { required: false, bound: false } };
    else if (pathname === "/api/knowledge/question-templates") json = [];
    else if (pathname === "/api/task-definitions") json = [];
    else if (pathname === "/api/tasks" || pathname === "/api/workbench/tasks") json = { items: [], tasks: [], page: { next_cursor: null } };
    else if (pathname === "/api/workbench/plan") json = { planning: false, brief: null, events: [], creates_session: false, calls_model: false };
    else if (pathname === "/api/home/today-tasks" || pathname === "/api/home/todo-tasks") json = { items: [] };
    else if (pathname === "/api/cron/jobs" || pathname === "/api/tickets") json = { items: [], jobs: [], page: { next_cursor: null } };
    if (pathname.endsWith("/events")) {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    }
    await route.fulfill({ json });
  });

  return {
    mutations,
    errors,
    poolReads: () => poolReads.length,
    followingReads: () => followingReads,
  };
}

async function openPool(page: Page) {
  await page.goto("/?tab=pool");
  await expect(page.locator(`[data-pool-kol="${primaryUid}"]`)).toBeVisible({ timeout: 20_000 });
}

function ownershipMutations(mutations: Mutation[]) {
  return mutations.filter((entry) => /\/(claim|release)$/.test(entry.path));
}

test.describe("real Home pool · stateful command receipts", () => {
  test("direct claim sends exactly one confirmed command, refreshes my following, and a successful release restores the candidate", async ({ page }) => {
    const fixture = await installStatefulPoolFixture(page);
    await openPool(page);
    const card = page.locator(`[data-pool-kol="${primaryUid}"]`);

    await card.locator("[data-pool-claim]").click();
    await expect.poll(() => ownershipMutations(fixture.mutations).length).toBe(1);
    expect(ownershipMutations(fixture.mutations)[0]).toMatchObject({
      method: "POST", path: `/api/kols/${primaryUid}/claim`, body: { confirm: true },
    });
    await expect(card.locator("[data-claim-follow-confirm]")).toHaveCount(0);
    await expect(card.locator("[data-pool-release]")).toBeVisible();
    await expect(card.locator("[data-pool-claim]")).toHaveCount(0);
    await expect(card.locator('[data-stage-label]')).toHaveText('我的跟进');
    await expect(card.locator(`[data-pool-select="${primaryUid}"]`)).toBeDisabled();
    await expect(page.locator('[data-pool-select-page-count]')).toHaveText('49');
    await expect.poll(fixture.followingReads).toBeGreaterThan(0);

    await card.locator("[data-pool-release]").click();
    await expect.poll(() => ownershipMutations(fixture.mutations).length).toBe(2);
    expect(ownershipMutations(fixture.mutations)[1]).toMatchObject({
      method: "POST", path: "/api/follows/follow-pool-new-00/release", body: { confirm: true, reason: "manual_release" },
    });
    await expect(card.locator("[data-pool-claim]")).toBeVisible();
    await expect(card.locator("[data-pool-release]")).toHaveCount(0);
    await expect(card.locator('[data-stage-label]')).toHaveText('未首次建联');
    expect(fixture.errors).toEqual([]);
  });

  test("two synchronous clicks remain one claim command and do not manufacture a second receipt", async ({ page }) => {
    const fixture = await installStatefulPoolFixture(page);
    await openPool(page);
    const action = page.locator(`[data-pool-kol="${primaryUid}"] [data-pool-claim]`);
    await action.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => ownershipMutations(fixture.mutations).length).toBe(1);
    await expect(page.locator(`[data-pool-kol="${primaryUid}"] [data-pool-release]`)).toBeVisible();
    expect(fixture.errors).toEqual([]);
  });

  test("a 409 conflict keeps the candidate claim action and never overwrites it with a release receipt", async ({ page }) => {
    const fixture = await installStatefulPoolFixture(page, "conflict");
    await openPool(page);
    const card = page.locator(`[data-pool-kol="${primaryUid}"]`);
    await card.locator("[data-pool-claim]").click();
    await expect(card.getByRole("alert")).toContainText("刚刚被其他员工领取");
    expect(ownershipMutations(fixture.mutations)[0]).toMatchObject({
      method: "POST", path: `/api/kols/${primaryUid}/claim`, body: { confirm: true },
    });
    await expect(card.locator("[data-pool-claim]")).toBeVisible();
    await expect(card.locator("[data-pool-release]")).toHaveCount(0);
    await expect(card).not.toHaveAttribute("data-claimed", "true");
    expect(fixture.errors).toEqual([]);
  });

  test("an uncertain claim outcome offers a scoped refresh instead of allowing blind repeat submission", async ({ page }) => {
    const fixture = await installStatefulPoolFixture(page, "uncertain");
    await openPool(page);
    const card = page.locator(`[data-pool-kol="${primaryUid}"]`);
    await card.locator("[data-pool-claim]").click();
    await expect(card.getByRole("alert")).toContainText("未返回可放回公海的跟进凭据");
    await expect(card.locator("[data-pool-release]")).toHaveCount(0);
    const readsBeforeRefresh = { pool: fixture.poolReads(), following: fixture.followingReads() };
    const refresh = card.getByRole("button", { name: /刷新/ });
    await expect(refresh).toBeVisible();
    await refresh.click();
    await expect.poll(() => fixture.poolReads() > readsBeforeRefresh.pool || fixture.followingReads() > readsBeforeRefresh.following).toBe(true);
    expect(ownershipMutations(fixture.mutations)).toHaveLength(1);
    expect(fixture.errors).toEqual([]);
  });

  test("checkboxes are local selection only; global facet badges come from page metadata", async ({ page }) => {
    const fixture = await installStatefulPoolFixture(page);
    await openPool(page);
    const pane = page.locator("[data-home-pane='pool']");
    await expect(pane.locator("[data-pool-card]")).toHaveCount(50);
    await expect(pane.locator("[data-pool-filter-count='new']")).toHaveText(String(NEW_COUNT));
    await expect(pane.locator("[data-pool-filter-count='overdue']")).toHaveText(String(OVERDUE_COUNT));
    await expect(pane.locator("[data-pool-count]")).toContainText(`共 ${TOTAL_COUNT} 位 · 第 1 / 2 页`);
    await pane.locator(`[data-pool-select="${primaryUid}"]`).check();
    await expect(pane.locator(`[data-pool-select="${primaryUid}"]`)).toBeChecked();
    expect(fixture.mutations).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });

  test("filtering or paging discards a retained release receipt rather than carrying it across a changed result scope", async ({ page }) => {
    for (const change of ["filter", "page"] as const) {
      const fixture = await installStatefulPoolFixture(page);
      await openPool(page);
      const card = page.locator(`[data-pool-kol="${primaryUid}"]`);
      await card.locator("[data-pool-claim]").click();
      await expect(card.locator("[data-pool-release]")).toBeVisible();

      if (change === "filter") await page.locator("[data-pool-filter='new']").click();
      else await page.locator("[data-pool-next]").click();

      await expect.poll(() => fixture.poolReads()).toBeGreaterThan(1);
      await expect(page.locator("[data-pool-release]")).toHaveCount(0);
      expect(ownershipMutations(fixture.mutations)).toHaveLength(1);
      expect(fixture.errors).toEqual([]);
    }
  });
});

test("pool density keeps public status evidence adjacent to the name, uses 32px search and 13px on every row without viewport overflow", async ({ page }, info) => {
  const fixture = await installStatefulPoolFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 900 },
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openPool(page);
    const pane = page.locator("[data-home-pane='pool']");
    const rows = pane.locator("[data-pool-card]");
    await expect(rows.first()).toBeVisible();
    // data-pool-search lives on Ant's native input; assert its enclosing,
    // user-visible shared control rather than the line-height-sized input.
    // Ant 6 names the wrapper `affix-wrapper`; the shared input's pending
    // simple-input branch uses `ant-input-wrapper`, so both remain explicit.
    await expect(pane.locator(".workspace-search-input.ant-input-wrapper, .workspace-search-input.ant-input-affix-wrapper")).toHaveCSS("height", "32px");

    const first = rows.first();
    const adjacency = await first.evaluate((row) => {
      const name = row.querySelector("[data-kol-name]");
      const evidence = row.querySelector("[data-stage-label]");
      if (!name || !evidence) return false;
      return name.parentElement === evidence.parentElement && name.nextElementSibling === evidence;
    });
    expect(adjacency, "public status evidence must immediately follow the object name").toBe(true);

    const typography = await rows.evaluateAll((cards) => cards.map((card) => {
      const row = getComputedStyle(card).fontSize;
      const meta = getComputedStyle(card.querySelector("[data-kol-layout='meta']") as Element).fontSize;
      const state = getComputedStyle(card.querySelector("[data-stage-label]") as Element).fontSize;
      return { row, meta, state, overflow: (card as HTMLElement).scrollWidth > (card as HTMLElement).clientWidth + 1 };
    }));
    expect(typography).toHaveLength(50);
    for (const sample of typography) {
      expect(sample.row).toBe("13px");
      expect(sample.meta).toBe("13px");
      expect(sample.state).toBe("13px");
      expect(sample.overflow).toBe(false);
    }

    const overflow = await pane.evaluate((root) => ({
      document: document.documentElement.scrollWidth > window.innerWidth + 1,
      pane: (root as HTMLElement).scrollWidth > (root as HTMLElement).clientWidth + 1,
      rail: (() => {
        const rail = root.querySelector("[data-scope-task-rail]") as HTMLElement | null;
        return rail ? rail.scrollWidth > rail.clientWidth + 1 : false;
      })(),
    }));
    expect(overflow).toEqual({ document: false, pane: false, rail: false });

    if (viewport.width === 1440 || viewport.width === 390) {
      await page.screenshot({ path: info.outputPath(`pool-density-${viewport.width}.png`), fullPage: true });
    }
  }

  expect(fixture.mutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
