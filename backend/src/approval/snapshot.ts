import type { OrgSnapshot } from "./types.js";

/**
 * Compiled from `邮箱-负责人绑定清单.md` plus the existing 王主管 / 张总 actors.
 * Manager edges are explicit seed facts, not LLM guesses.
 */
export function defaultOrgSnapshot(): OrgSnapshot {
  return {
    units: [
      { id: "org_group", name: "集团", parent_id: null, leader_id: "emp_zhang", level: 0 },
      { id: "org_promo", name: "推广部", parent_id: "org_group", leader_id: "emp_wang", level: 1 },
      { id: "org_pq", name: "PQ品牌组", parent_id: "org_promo", leader_id: "emp_lintong", level: 2 },
      { id: "org_ro", name: "RO品牌组", parent_id: "org_promo", leader_id: "emp_laiyixun", level: 2 },
      { id: "org_lt", name: "LT品牌组", parent_id: "org_promo", leader_id: "emp_zhongjinnian", level: 2 },
      { id: "org_finance", name: "财务部", parent_id: "org_group", leader_id: "emp_finance", level: 1 },
    ],
    employees: [
      {
        id: "emp_zhang", name: "张总", department_id: "org_group", position: "中国区总经理 / GM",
        manager_id: null, status: "active", cost_center: "GM", mailboxes: [], delegate_to: null,
      },
      {
        id: "emp_wang", name: "王主管", department_id: "org_promo", position: "推广部负责人",
        manager_id: "emp_zhang", status: "active", cost_center: "MKT", mailboxes: [], delegate_to: null,
      },
      {
        id: "emp_finance", name: "财务负责人", department_id: "org_finance", position: "财务负责人",
        manager_id: "emp_zhang", status: "active", cost_center: "FIN", mailboxes: [], delegate_to: null,
      },
      {
        id: "emp_lintong", name: "林桐", department_id: "org_pq", position: "PQ品牌组负责人",
        manager_id: "emp_wang", status: "active", cost_center: "PQ", brand: "PQ",
        mailboxes: ["marketingde@ipowerqueen.com", "ipowerqueen.de.marketing@gmail.com", "marketing@ipowerqueen.com"],
        delegate_to: null,
      },
      {
        id: "emp_liyuanyan", name: "黎玉燕", department_id: "org_pq", position: "PQ-US 建联",
        manager_id: "emp_lintong", status: "active", cost_center: "PQ", brand: "PQ",
        mailboxes: ["ipowerqueenmarketing@gmail.com", "affiliate@ipowerqueen.com", "marketing.us@ipowerqueen.com"],
        delegate_to: null,
      },
      {
        id: "emp_laiyixun", name: "赖逸询", department_id: "org_ro", position: "RO品牌组负责人",
        manager_id: "emp_wang", status: "active", cost_center: "RO", brand: "RO",
        mailboxes: ["marketingde@redodopower.com"],
        delegate_to: "emp_lingjiayu",
      },
      {
        id: "emp_chenbingbing", name: "陈冰冰", department_id: "org_ro", position: "RO 建联",
        manager_id: "emp_laiyixun", status: "active", cost_center: "RO", brand: "RO",
        mailboxes: ["lynn@redodopower.com"], delegate_to: null,
      },
      {
        id: "emp_yujiani", name: "余佳妮", department_id: "org_ro", position: "RO 建联",
        manager_id: "emp_laiyixun", status: "active", cost_center: "RO", brand: "RO",
        mailboxes: ["marketing@redodopower.com"], delegate_to: null,
      },
      {
        id: "emp_lingjiayu", name: "凌嘉余", department_id: "org_ro", position: "RO ES/FR 建联",
        manager_id: "emp_laiyixun", status: "active", cost_center: "RO", brand: "RO",
        mailboxes: ["marketing.es@redodopower.com", "marketing.fr@redodopower.com"],
        delegate_to: null,
      },
      {
        id: "emp_zhongjinnian", name: "钟槿年", department_id: "org_lt", position: "LT品牌组负责人",
        manager_id: "emp_wang", status: "active", cost_center: "LT", brand: "LT",
        mailboxes: ["marketing.us@litime.com", "marketing@litime.com"],
        delegate_to: null,
      },
      {
        id: "emp_yeguanwang", name: "叶观旺", department_id: "org_lt", position: "LT-US BD",
        manager_id: "emp_zhongjinnian", status: "active", cost_center: "LT", brand: "LT",
        mailboxes: ["marketing-bd.us@litime.com"], delegate_to: null,
      },
      {
        id: "emp_liweiyu", name: "李伟瑜", department_id: "org_lt", position: "LT 欧洲",
        manager_id: "emp_zhongjinnian", status: "active", cost_center: "LT", brand: "LT",
        mailboxes: ["marketing.de@litime.com"], delegate_to: null,
      },
      {
        id: "emp_gujiarui", name: "古佳睿", department_id: "org_lt", position: "LT 欧洲",
        manager_id: "emp_zhongjinnian", status: "active", cost_center: "LT", brand: "LT",
        mailboxes: ["amperetimemarketing.de@gmail.com"], delegate_to: null,
      },
      {
        id: "emp_zhanggan", name: "张干", department_id: "org_lt", position: "LT-US/AU/CA",
        manager_id: "emp_zhongjinnian", status: "active", cost_center: "LT", brand: "LT",
        mailboxes: ["brandmarketing@litime.com", "marketing.ca@litime.com", "marketing.team@litime.com"],
        delegate_to: null,
      },
      {
        id: "emp_diaochucong", name: "刁楚聪", department_id: "org_lt", position: "LT BD",
        manager_id: "emp_zhongjinnian", status: "active", cost_center: "LT", brand: "LT",
        mailboxes: ["mkt-bd.us@litime.com"], delegate_to: null,
      },
      {
        id: "emp_liuxiaoli", name: "刘小丽", department_id: "org_lt", position: "LT-JP",
        manager_id: "emp_zhongjinnian", status: "active", cost_center: "LT", brand: "LT",
        mailboxes: ["marketing.jp@amperetime.com", "litime.jp@gmail.com"],
        delegate_to: null,
      },
    ],
    relationships: [
      { type: "DEPARTMENT_LEADER", from_id: "org_promo", to_id: "emp_wang" },
      { type: "FINANCE_OWNER", from_id: "org_group", to_id: "emp_finance" },
      { type: "COST_CENTER_OWNER", from_id: "PQ", to_id: "emp_lintong" },
      { type: "COST_CENTER_OWNER", from_id: "RO", to_id: "emp_laiyixun" },
      { type: "COST_CENTER_OWNER", from_id: "LT", to_id: "emp_zhongjinnian" },
    ],
  };
}
