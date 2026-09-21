import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_MODES, HOME_MODE_LABELS } from "../home/modes";

const WORKBENCH = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./Workbench.tsx"),
  "utf8",
);

function todayNavOrder(source: string): string[] {
  const start = source.indexOf('aria-label="今日"');
  const end = source.indexOf('aria-label="数字员工"');
  const cluster = start >= 0 && end > start ? source.slice(start, end) : "";
  return [...cluster.matchAll(/data-nav="([^"]+)"/g)].map((match) => match[1]);
}

describe("今日 sidebar IA", () => {
  it("locks 今日组 to 新工作任务 / 进行中 / 定时任务 / 通讯", () => {
    expect(todayNavOrder(WORKBENCH)).toEqual([
      "new-task",
      "running",
      "cron",
      "mail",
    ]);
  });

  it("keeps AI发现 / 公海 / 我跟进的红人 off the sidebar", () => {
    expect(WORKBENCH).not.toContain('data-nav="discovery"');
    expect(WORKBENCH).not.toContain('data-nav="pool"');
    expect(WORKBENCH).not.toContain('data-nav="followed"');
    expect(WORKBENCH).not.toContain("AI发现");
    expect(WORKBENCH).not.toContain("公海");
    expect(WORKBENCH).not.toContain("我跟进的红人");
    expect(WORKBENCH).not.toContain('to="/?tab=discovery"');
    expect(WORKBENCH).not.toContain('to="/?tab=pool"');
    expect(WORKBENCH).not.toContain('to="/?tab=lifecycle"');
  });

  it("places 公海 as a Home top-bar tab between AI发现 and 我跟进的红人", () => {
    expect(HOME_MODES).toEqual(["today", "todo", "discovery", "pool", "lifecycle"]);
    expect(HOME_MODE_LABELS.pool).toBe("公海");
  });
});

describe("brand lockups", () => {
  it("shows the admin console its own brand lockup", () => {
    const admin = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pages/AdminConsole.tsx"),
      "utf8",
    );
    const navStart = admin.indexOf('className="admin-nav"');
    const navEnd = admin.indexOf("</aside>", navStart);
    const navBlock = admin.slice(navStart, navEnd);
    expect(navBlock).toContain('<BrandLockup variant="sidebar" />');
    expect(navBlock).toContain('className="admin-nav-product"');
  });

  it("keeps exactly one Li Time mark in the employee sidebar", () => {
    const brandStart = WORKBENCH.indexOf("data-sidebar-brand");
    const brandBlock = WORKBENCH.slice(brandStart, WORKBENCH.indexOf("</NavLink>", brandStart));
    const liTimeMarks = brandBlock.match(/Li Time/g) || [];
    expect(liTimeMarks).toHaveLength(0);
    expect(brandBlock).toContain('<BrandLockup variant="sidebar" />');
    expect(brandBlock).toContain("Lucas6.webp");
    expect(brandBlock).not.toContain("灵工 工作");
  });
});
