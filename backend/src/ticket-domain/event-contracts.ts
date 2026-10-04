export const FORMAL_BUSINESS_EVENT_TYPES = [
  "mail.reply_verified",
  "mail.commitment_verified",
  "deadline.quote",
  "deadline.contract",
  "deadline.sample",
  "deadline.content",
  "risk.detected",
  "approval_or_material.missing",
] as const;

export type FormalBusinessEventType = typeof FORMAL_BUSINESS_EVENT_TYPES[number];

export const FORMAL_BUSINESS_EVENT_TYPE_SET = new Set<string>(FORMAL_BUSINESS_EVENT_TYPES);

export const FORMAL_BUSINESS_EVENT_LABELS: Record<FormalBusinessEventType, string> = {
  "mail.reply_verified": "已验证邮件回复",
  "mail.commitment_verified": "已验证邮件承诺",
  "deadline.quote": "报价期限",
  "deadline.contract": "合同期限",
  "deadline.sample": "样品期限",
  "deadline.content": "内容期限",
  "risk.detected": "风险事件",
  "approval_or_material.missing": "审批或资料缺失",
};
