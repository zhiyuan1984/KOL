import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_MODES, HOME_MODE_LABELS } from "../home/modes";
import { ADMIN_NAV_GROUPS, ADMIN_SECTIONS, adminTabOf } from "./adminNav";

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

describe("admin sidebar parity", () => {
  it("keeps the nine governance entries in one contract", () => {
    expect(ADMIN_SECTIONS).toEqual([
      "employees",
      "data",
      "agents",
      "skills",
      "knowledge",
      "approvals",
      "exams",
      "connectors",
      "kol",
    ]);
    expect(ADMIN_NAV_GROUPS.map((group) => group.rows.length)).toEqual([2, 1, 1, 4, 1]);
    expect(ADMIN_NAV_GROUPS.flatMap((group) => group.rows.map((row) => row.label))).toEqual([
      "员工",
      "数据",
      "数字员工治理",
      "技能",
      "知识",
      "审批",
      "考试",
      "连接器枢纽",
      "配置",
    ]);
    for (const group of ADMIN_NAV_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      for (const row of group.rows) {
        expect(row.href.startsWith("/admin")).toBe(true);
        expect(row.icon.length).toBeGreaterThan(0);
      }
    }
    expect(adminTabOf("/admin")).toBe("employees");
    expect(adminTabOf("/admin/connectors/conn_a")).toBe("connectors");
    expect(adminTabOf("/admin/unknown")).toBe("employees");
  });

  it("renders the admin entries inside the employee sidebar shell", () => {
    // 同一外壳：唯一 head、唯一 foot、同一 nav-group / nav-link / Ico 解剖。
    expect(WORKBENCH.match(/className="sidebar-head"/g)).toHaveLength(1);
    expect(WORKBENCH.match(/className="sidebar-foot"/g)).toHaveLength(1);
    expect(WORKBENCH).toContain("ADMIN_NAV_GROUPS.map(");
    expect(WORKBENCH).toContain("data-admin-nav={row.id}");
    expect(WORKBENCH).toContain("data-admin-tab={row.id}");
    // 分簇只给读屏，不发明可见组标题（ia-information-architecture.md §4）。
    expect(WORKBENCH).toContain('className="nav-group" aria-label={group.label}');
    // 管理面不渲染员工开工条目，窄视口顶栏也不跳员工开工入口。
    expect(WORKBENCH).toContain("showAdminNav");
    expect(WORKBENCH).toContain("<strong>管理</strong>");
  });

  it("keeps the admin console free of its own nav column and brand block", () => {
    const admin = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pages/AdminConsole.tsx"),
      "utf8",
    );
    expect(admin).not.toContain("admin-nav");
    expect(admin).not.toContain("BrandLockup");
    expect(admin).not.toContain("AccountBar");
    expect(admin).toContain('data-admin-ia="governance"');
  });
});

describe("brand lockups", () => {
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
