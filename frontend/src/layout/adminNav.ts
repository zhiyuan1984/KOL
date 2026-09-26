/** 管理端左侧菜单条目：与员工端侧栏共用同一外壳（head / nav-group / nav-link / foot），
 *  只让「菜单文字内容」不同——条目、href、图标与分簇住在这一份。
 *  依据 docs/superpowers/specs/2026-09-26-admin-sidebar-shell-parity.md。 */

export type AdminNavRow = {
  id: string;
  label: string;
  href: string;
  /** 24×24 描边路径，与 Workbench 的 Ico 同口径（stroke 1.85、currentColor）。 */
  icon: string;
  end?: boolean;
};

export type AdminNavGroup = {
  /** 只给读屏；侧栏不出现可见组标题（ia-information-architecture.md §4）。 */
  label: string;
  rows: AdminNavRow[];
};

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: "治理日常",
    rows: [
      {
        id: "employees",
        label: "员工",
        href: "/admin",
        icon: "M12 3a5 5 0 0 1 0 10 5 5 0 0 1 0-10 M20 21a8 8 0 0 0-16 0",
        end: true,
      },
      {
        id: "data",
        label: "数据",
        href: "/admin/data",
        icon: "M21 5a9 3 0 0 1-18 0a9 3 0 0 1 18 0 M3 5v14a9 3 0 0 0 18 0V5 M3 12a9 3 0 0 0 18 0",
      },
    ],
  },
  {
    label: "数字员工",
    rows: [
      {
        id: "agents",
        label: "数字员工治理",
        href: "/admin/agents",
        icon: "M12 4a3 3 0 0 1 3 3v1h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2V7a3 3 0 0 1 3-3z M9 13h6 M9 16h4",
      },
    ],
  },
  {
    label: "技能",
    rows: [
      {
        id: "skills",
        label: "技能",
        href: "/admin/skills",
        icon: "M8 8h4v4H8z M12 12h4v4h-4z M7 16l-2 2 M17 8l2-2",
      },
    ],
  },
  {
    label: "资产",
    rows: [
      {
        id: "knowledge",
        label: "知识",
        href: "/admin/knowledge",
        icon: "M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z",
      },
      {
        id: "approvals",
        label: "审批",
        href: "/admin/approvals",
        icon: "M7 4h10a2 2 0 0 1 2 2v14H5V6a2 2 0 0 1 2-2z M9 4v3h6V4",
      },
      {
        id: "exams",
        label: "考试",
        href: "/admin/exams",
        icon: "M3 9l9-5 9 5-9 5z M7 12v5c3 2 7 2 10 0v-5 M21 9v6",
      },
      {
        id: "connectors",
        label: "连接器枢纽",
        href: "/admin/connectors",
        icon: "M10 13a5 5 0 0 0 7.1.4l1.5-1.5a5 5 0 1 0-7.1-7.1L10.3 6 M14 11a5 5 0 0 0-7.1-.4L5.4 12.1a5 5 0 1 0 7.1 7.1L13.7 18",
      },
    ],
  },
  {
    label: "平台配置",
    rows: [
      {
        id: "kol",
        label: "配置",
        href: "/admin/kol",
        icon: "M21 4h-7 M10 4H3 M21 12h-9 M8 12H3 M21 20h-5 M12 20H3 M14 2v4 M8 10v4 M16 18v4",
      },
    ],
  },
];

/** `/admin`（含未知段）归到默认分节，与 AdminConsole 的面板归一化一致。 */
export function adminSectionOf(pathname: string): string {
  const rest = String(pathname || "").replace(/^\/admin\/?/, "").split(/[?#]/)[0];
  if (!rest) return "employees";
  const [section] = rest.split("/").filter(Boolean);
  return section || "employees";
}

/** 侧栏条目与面板的合法分节集合（顺序即侧栏顺序）。 */
export const ADMIN_SECTIONS: string[] = ADMIN_NAV_GROUPS.flatMap((group) => group.rows.map((row) => row.id));

/** 路径 → 侧栏高亮与面板共用的分节：未知段回落 employees，两侧归一化一致。 */
export function adminTabOf(pathname: string): string {
  const section = adminSectionOf(pathname);
  return ADMIN_SECTIONS.includes(section) ? section : "employees";
}
