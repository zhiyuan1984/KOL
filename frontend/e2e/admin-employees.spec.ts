import { expect, test } from "@playwright/test";

const employee = {
  id: "usr_directory",
  name: "目录员工",
  username: "directory@amperetime.com",
  email: "directory@amperetime.com",
  site: "org:promotion_department",
  position: "KOL 经理",
  manager_user_id: "",
  brands: ["LT", "PQ"],
  roles: ["employee"],
  active: true,
  updated_at: "2026-09-27T10:30:00.000Z",
  mailbox_count: 2,
  kol_count: 2,
  skill_grants: ["email_compose"],
  avatar_url: "/avatars/employees/ye_guanwang.png",
};

test("employee directory filters, shows business bindings, and saves a confirmed tool grant", async ({ page }) => {
  const saved: Array<{ method: string; body: unknown }> = [];
  await page.route("**/api/admin/users", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([employee]) });
  });
  await page.route("**/api/admin/organization-units", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      company: { id: "company:amperetime", display_name: "安培时代" },
      units: [
        { id: "org:promotion_department", display_name: "推广部", type: "department", parent: null, level: 1 },
        { id: "org:market_department", display_name: "市场部", type: "department", parent: null, level: 1 },
      ],
      people: [],
    }) });
  });
  await page.route("**/api/admin/users/usr_directory/context", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      user: employee,
      mailboxes: [
        { mailbox_email: "directory@amperetime.com", mailbox_id: "mailbox_main", owner_name: "目录员工", status: "connected", is_default: true, updated_at: null, synced_at: null, last_error: null },
        { mailbox_email: "brand@amperetime.com", mailbox_id: "mailbox_brand", owner_name: "品牌邮箱", status: "connected", is_default: false, updated_at: null, synced_at: null, last_error: null },
      ],
      kols: [
        { id: "follow_1", kol_uid: "kol_ava", display_name: "Ava Creator", scope_brand: "LT", stage_code: "NEGOTIATING", mailbox_email: "brand@amperetime.com", claimed_at: null },
        { id: "follow_2", kol_uid: "kol_mia", display_name: "Mia Creator", scope_brand: "PQ", stage_code: "OUTREACH", mailbox_email: null, claimed_at: null },
      ],
    }) });
  });
  await page.route("**/api/admin/users/usr_directory/tools", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ tools: [
      { id: "email_compose", label: "写合作邮件", summary: "准备合作邮件草稿", category: "商务", published: true, granted: true, assignable: true },
      { id: "creator_discovery", label: "达人发现", summary: "查找潜在合作达人", category: "建联", published: true, granted: false, assignable: true },
    ] }) });
  });
  await page.route("**/api/admin/users/usr_directory/skills", async (route) => {
    saved.push({ method: route.request().method(), body: route.request().postDataJSON() });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/admin");
  const directory = page.locator("[data-admin-employees]");
  await expect(directory).toBeVisible();
  await expect(directory.getByRole("heading", { name: "员工目录" })).toBeVisible();
  await expect(directory.locator("[data-employee-row='usr_directory']")).toContainText("目录员工");
  await expect(directory.locator("[data-employee-row='usr_directory']")).toContainText("2 个邮箱 · 2 个 KOL");
  await expect(directory.locator("[data-employee-row='usr_directory'] [data-employee-avatar]"))
    .toHaveAttribute("src", "/avatars/employees/ye_guanwang.png");

  await directory.locator("[data-employee-search]").fill("不存在");
  await expect(directory.locator("[data-employee-row]")).toHaveCount(0);
  await directory.locator("[data-employee-search]").fill("");
  await directory.locator("[data-employee-filter='organization']").selectOption("org:promotion_department");
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);
  await directory.locator("[data-employee-filter='brand']").selectOption("PQ");
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);

  await directory.locator("[data-employee-action='edit']").click();
  const edit = page.locator("[data-employee-dialog='edit']");
  await expect(edit).toBeVisible();
  await expect(edit.locator("[data-employee-bindings]")).toContainText("directory@amperetime.com");
  await expect(edit.locator("[data-employee-bindings]")).toContainText("Ava Creator");
  await expect(edit.locator("[data-employee-bindings]")).toContainText("Mia Creator");
  await edit.locator("[data-employee-dialog-close]").click();

  await directory.locator("[data-employee-action='tools']").click();
  const tools = page.locator("[data-employee-dialog='tools']");
  await expect(tools).toBeVisible();
  await expect(tools.locator("[data-employee-tool='email_compose']")).toContainText("已授权");
  await tools.locator("[data-employee-tool='creator_discovery'] input").check();
  await tools.locator("[data-employee-tools-save]").click();
  const confirm = page.locator("[data-admin-confirm='employee-tool-grants']");
  await expect(confirm).toBeVisible();
  await expect(confirm.locator("[data-admin-confirm-change]")).toContainText("达人发现");
  await confirm.locator("[data-admin-confirm-ok]").click();
  await expect.poll(() => saved).toEqual([{ method: "PUT", body: { skills: ["email_compose", "creator_discovery"] } }]);
});
