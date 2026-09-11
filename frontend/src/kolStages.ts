export type KolStageTab = {
  code: string;
  label: string;
  short: string;
  domain?: string;
};

export const MAIN_STAGE_TABS: KolStageTab[] = [
  { code: "INITIAL_CONTACT", label: "初步接触", short: "接触", domain: "Lead" },
  { code: "INTERESTED", label: "已回复-有兴趣", short: "兴趣", domain: "Opportunity" },
  { code: "EVALUATING", label: "合作评估", short: "评估", domain: "Opportunity" },
  { code: "QUOTE_PENDING", label: "报价待确认", short: "报价", domain: "Negotiation" },
  { code: "NEGOTIATING", label: "商务谈判", short: "谈判", domain: "Negotiation" },
  { code: "PLAN_PENDING", label: "方案待确认", short: "方案", domain: "Negotiation" },
  { code: "CONTRACTING", label: "合同签署", short: "合同", domain: "Execution" },
  { code: "SAMPLE_PENDING", label: "待寄样", short: "寄样", domain: "Execution" },
  { code: "SHIPPED", label: "已发货", short: "发货", domain: "Execution" },
  { code: "TESTING", label: "已签收-测试中", short: "测试", domain: "Execution" },
  { code: "CONTENT_PLANNING", label: "内容策划", short: "策划", domain: "Execution" },
  { code: "CONTENT_REVIEW", label: "内容审核", short: "审核", domain: "Execution" },
  { code: "PUBLISH_PENDING", label: "待发布", short: "待发", domain: "Execution" },
  { code: "PUBLISHED", label: "已发布", short: "已发", domain: "Execution" },
  { code: "SETTLING", label: "结算中 / 已付款", short: "结算", domain: "Settlement-Growth" },
];

export const EXCEPTION_TAB: KolStageTab = { code: "exception", label: "异常", short: "异常" };
export const ALL_TAB: KolStageTab = { code: "all", label: "全部", short: "全部" };

/** 全部 + 15 正式阶段 + 异常 = 17 */
export const FOLLOWED_KOL_TABS: KolStageTab[] = [ALL_TAB, ...MAIN_STAGE_TABS, EXCEPTION_TAB];

export const SHORT_STAGE_LABEL: Record<string, string> = Object.fromEntries(
  MAIN_STAGE_TABS.map((stage) => [stage.code, stage.short]),
);

export const FALLBACK_MAIN_STAGES = MAIN_STAGE_TABS.map((stage) => ({
  code: stage.code,
  label: stage.label,
  domain: stage.domain,
}));

export function suggestedStageLabel(kol: { stage_code?: string; unbound?: boolean; exception?: boolean; suggested_stage?: string }): string {
  if (kol.suggested_stage) return kol.suggested_stage;
  if (kol.unbound) return "初步接触";
  if (kol.exception) return "需人选回到主流程";
  const index = MAIN_STAGE_TABS.findIndex((stage) => stage.code === kol.stage_code);
  if (index < 0) return "—";
  if (index === MAIN_STAGE_TABS.length - 1) return "已完成";
  return MAIN_STAGE_TABS[index + 1].label;
}
