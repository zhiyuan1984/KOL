import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_MODES, HOME_MODE_LABELS } from "../home/modes";
import { ADMIN_HIDDEN_SECTIONS, ADMIN_NAV_GROUPS, ADMIN_SECTIONS, adminTabOf } from "./adminNav";

const WORKBENCH = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./Workbench.tsx"),
  "utf8",
);

function todayNavOrder(source: string): string[] {
  const start = source.indexOf('aria-label="今日"');
  // 精确截到今日组自己的 </nav>，不依赖下一个分组的 label（KOL业务等新分组插在今日之后不应影响本断言）。
  const end = source.indexOf("</nav>", start);
  const cluster = start >= 0 && end > start ? source.slice(start, end) : "";
  return [...cluster.matchAll(/data-nav="([^"]+)"/g)].map((match) => match[1]);
}

describe("今日 sidebar IA", () => {
  it("locks 今日组 to 工作台 / 进行中 / 定时任务 / 通讯", () => {
    expect(todayNavOrder(WORKBENCH)).toEqual([
      "new-task",
      "running",
      "cron",
      "mail",
    ]);
    // 用户 2026-10-12 口径：菜单文字「新任务」改为「工作台」（data-nav 与 href 不变）。
    expect(WORKBENCH).toContain('>工作台</span>');
  });

  it("merges 线索管理 / 合作项目 into one 业务地图 entry", () => {
    expect(WORKBENCH).toContain('data-nav="business-map"');
    expect(WORKBENCH).toContain('>业务地图</span>');
    expect(WORKBENCH).not.toContain('data-nav="leads"');
    expect(WORKBENCH).not.toContain('data-nav="cooperations"');
  });

  it("uses the product-cased Agent label in the employee navigation", () => {
    expect(WORKBENCH).toContain('aria-label="Agent"');
    expect(WORKBENCH).toContain('title="Agent"');
    expect(WORKBENCH).toContain('>Agent</span>');
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
  it("keeps the admin navigation contract for 业务地图 / 知识库 / Agent / 本体域 / 主数据", () => {
    expect(ADMIN_SECTIONS).toEqual([
      "employees",
      "overview",
      "lead-funnel",
      "project-delivery",
      "connectors",
      "knowledge",
      "agents",
      "ontology",
      "business-domains",
      "approval-types",
      "skills",
      "exams",
      "master-data",
      "data",
      "cost",
      "scheduling",
      "work-orders",
      "audit",
      "kol",
      "approvals",
    ]);
    expect(ADMIN_HIDDEN_SECTIONS).toEqual(["approvals"]);
    expect(ADMIN_NAV_GROUPS.map((group) => group.rows.length)).toEqual([3, 6, 1, 1, 7]);
    expect(ADMIN_NAV_GROUPS.flatMap((group) => group.rows.map((row) => row.label))).toEqual([
      "员工",
      "工作战报",
      "业务地图",
      "连接器",
      "知识库",
      "Agent",
      "本体",
      "业务域地图",
      "评审流程",
      "技能",
      "考试",
      "主数据",
      "数据",
      "成本",
      "调度监控",
      "工单治理",
      "审计中心",
      "配置",
    ]);
    // 资产簇内「连接器 / 知识库 / Agent / 本体 / 业务域地图」同组且顺序固定；「审批」已从菜单去掉（隐藏分节）。
    const assetIds = ADMIN_NAV_GROUPS.find((group) => group.label === "资产")!.rows.map((row) => row.id);
    expect(assetIds).toEqual(["connectors", "knowledge", "agents", "ontology", "business-domains", "approval-types"]);
    expect(ADMIN_NAV_GROUPS.flatMap((group) => group.rows.map((row) => row.id))).not.toContain("approvals");
    // 「业务地图」一行映射两个看板路由（侧栏高亮与面板分节共用）。
    const businessMap = ADMIN_NAV_GROUPS.flatMap((group) => group.rows).find((row) => row.id === "business-map");
    expect(businessMap?.sections).toEqual(["lead-funnel", "project-delivery"]);
    for (const group of ADMIN_NAV_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      for (const row of group.rows) {
        expect(row.href.startsWith("/admin")).toBe(true);
        expect(row.icon.length).toBeGreaterThan(0);
      }
    }
    expect(adminTabOf("/admin")).toBe("employees");
    expect(adminTabOf("/admin/overview")).toBe("overview");
    expect(adminTabOf("/admin/audit")).toBe("audit");
    expect(adminTabOf("/admin/approval-types")).toBe("approval-types");
    expect(adminTabOf("/admin/connectors/conn_a")).toBe("connectors");
    expect(adminTabOf("/admin/lead-funnel")).toBe("lead-funnel");
    expect(adminTabOf("/admin/project-delivery")).toBe("project-delivery");
    expect(adminTabOf("/admin/business-domains")).toBe("business-domains");
    expect(adminTabOf("/admin/master-data")).toBe("master-data");
    expect(adminTabOf("/admin/approvals")).toBe("approvals"); // 隐藏深链分节
    expect(adminTabOf("/admin/unknown")).toBe("employees");
  });

  it("keeps the admin Agent entry on the employee Agent glyph", () => {
    const agents = ADMIN_NAV_GROUPS.flatMap((group) => group.rows).find((row) => row.id === "agents");
    expect(agents?.label).toBe("Agent");
    // 图标与员工端 Agent 条目同一描边路径（ADR-2026-10-04）：两处字符串应始终一致。
    expect(agents).toBeDefined();
    expect(WORKBENCH).toContain(agents!.icon);
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
