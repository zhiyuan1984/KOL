import { normalizeStage } from "./stages.js";

export type EmailTemplateKind = "main" | "exception" | "longterm";

export type EmailTemplate = {
  id: string;
  skill: string;
  title: string;
  stage_label: string;
  stages: string[];
  subject: string;
  body_en: string;
  body_zh: string;
  kind: EmailTemplateKind;
  keep_stage: boolean;
};

function tpl(
  id: string,
  skill: string,
  title: string,
  stage_label: string,
  stages: string[],
  subject: string,
  body_en: string,
  body_zh: string,
  kind: EmailTemplateKind = "main",
  keep_stage = true,
): EmailTemplate {
  return { id, skill, title, stage_label, stages, subject, body_en, body_zh, kind, keep_stage };
}

/** Business mail catalog: one template per main-flow stage plus exception / long-term letters. */
export const EMAIL_TEMPLATES: EmailTemplate[] = [
  tpl("kol.first_touch", "kol", "首次建联邮件", "初步接触", ["INITIAL_CONTACT"],
    "Collaboration Opportunity with LiTime",
    "Hi,\n\nWe would love to explore a product collaboration with LiTime. This first note is only to check interest — no commitment yet.\n\nBest,\nLiTime Creator Desk\n",
    "首封建联：只筛选兴趣，不代表红人已同意合作。"),
  tpl("stage_mail.followup", "stage_mail", "阶段跟进邮件", "初步接触/已回复-有兴趣", ["INITIAL_CONTACT", "INTERESTED"],
    "Re: Collaboration Opportunity with LiTime",
    "Hi,\n\nJust a quick follow-up on the LiTime collaboration note. Happy to share the spec sheet whenever you have a slot.\n\nBest,\nLiTime Creator Desk\n",
    "通用跟进：正式阶段保持不变。"),
  tpl("stage_mail.interested", "stage_mail", "兴趣确认跟进", "已回复-有兴趣", ["INTERESTED"],
    "Re: Collaboration Opportunity / Interested in Working with LiTime",
    "Hi,\n\nThanks for the interest. We will collect a few details next so we can evaluate fit — rates and deliverables are not confirmed yet.\n\nBest,\nLiTime Creator Desk\n",
    "红人有兴趣，但报价和交付尚未确认。"),
  tpl("stage_mail.media_kit", "stage_mail", "媒体包与数据收集", "合作评估", ["EVALUATING"],
    "Media Kit and Audience Information Request",
    "Hi,\n\nCould you share a media kit or recent audience stats (views, geo, age/gender) so we can evaluate the collaboration? This is not a rate confirmation yet.\n\nBest,\nLiTime Creator Desk\n",
    "收集数据评估是否合作，尚未进入正式报价。"),
  tpl("stage_mail.rate_request", "stage_mail", "报价收集邮件", "报价待确认", ["QUOTE_PENDING"],
    "Could You Share Your Collaboration Rates?",
    "Hi,\n\nCould you share your collaboration rates and deliverable options? Asking for a quote is not the same as confirming one.\n\nBest,\nLiTime Creator Desk\n",
    "询问报价，不等于报价已确认。"),
  tpl("stage_mail.negotiate", "stage_mail", "报价谈判邮件", "商务谈判", ["NEGOTIATING"],
    "Re: Collaboration Rate and Deliverables",
    "Hi,\n\nThanks for the quote. We would like to align on fee, deliverable count, usage rights and timing before anything is confirmed.\n\nBest,\nLiTime Creator Desk\n",
    "围绕费用、数量、授权和档期谈判。"),
  tpl("stage_mail.plan_confirm", "stage_mail", "合作方案确认邮件", "方案待确认", ["PLAN_PENDING"],
    "LiTime Collaboration Details — Please Confirm",
    "Hi,\n\nPlease confirm the attached collaboration details. A “please confirm” note still means terms are pending until you reply confirmed/agreed.\n\nBest,\nLiTime Creator Desk\n",
    "please confirm 仍是待确认。"),
  tpl("stage_mail.contract", "stage_mail", "合同沟通邮件", "合同签署", ["CONTRACTING"],
    "LiTime x Creator Collaboration Agreement",
    "Hi,\n\nPlease review the collaboration agreement. Sent-for-signature and fully signed are tracked as different facts.\n\nBest,\nLiTime Creator Desk\n",
    "合同已发送与合同已签署要分开识别。"),
  tpl("addr_check.collect", "addr_check", "收件信息确认邮件", "待寄样", ["SAMPLE_PENDING"],
    "LiTime Sample Shipping Confirmation — Address Verification",
    "Hi,\n\nBefore we ship the sample, please confirm full name, phone, address, country, ZIP, SKU and quantity.\n\nBest,\nCreator Desk\n",
    "地址齐全且型号确认后才能发货。"),
  tpl("ship_notice.v1", "ship_notice", "发货通知邮件", "已发货", ["SHIPPED", "SAMPLE_PENDING", "TESTING"],
    "Your LiTime Product Has Shipped",
    "Hi,\n\nYour LiTime product has shipped. Tracking and carrier are in this note.\n\nBest,\nCreator Desk\n",
    "必须识别到运单号或明确 shipped。"),
  tpl("stage_mail.testing", "stage_mail", "收货与测试跟进", "已签收-测试中", ["TESTING"],
    "LiTime Product Delivery and Testing Follow-Up",
    "Hi,\n\nChecking that the sample arrived and testing is underway. Logistics delivered without your confirmation stays “suspected received”.\n\nBest,\nLiTime Creator Desk\n",
    "物流签收但红人未确认时标疑似已签收。"),
  tpl("stage_mail.brief", "stage_mail", "Brief与脚本确认", "内容策划", ["CONTENT_PLANNING"],
    "LiTime Content Brief and Key Talking Points",
    "Hi,\n\nSharing the content brief and key talking points before filming. Please confirm the angle and mandatory mentions.\n\nBest,\nLiTime Creator Desk\n",
    "正式拍摄前确认内容方向。"),
  tpl("content_nudge.outline", "content_nudge", "催大纲", "内容策划/已签收-测试中", ["TESTING", "CONTENT_PLANNING"],
    "Outline check-in — LiTime content",
    "Hi,\n\nChecking in on the outline / shot list so we can lock the publishing window.\n\nBest,\nCreator Desk\n",
    "仅测试中或内容策划阶段可催大纲。"),
  tpl("stage_mail.content_review", "stage_mail", "初稿审核邮件", "内容审核", ["CONTENT_REVIEW"],
    "LiTime Content Review and Feedback",
    "Hi,\n\nThanks for the draft. Please see the requested updates. Revision pending still means review — not published.\n\nBest,\nLiTime Creator Desk\n",
    "有修改意见时仍处于审核阶段。"),
  tpl("stage_mail.publish_schedule", "stage_mail", "发布排期确认", "待发布", ["PUBLISH_PENDING"],
    "LiTime Content Publishing Schedule Confirmation",
    "Hi,\n\nPlease confirm the publishing date, timezone and platform. Scheduled is not the same as live.\n\nBest,\nLiTime Creator Desk\n",
    "必须区分预计发布与已正式上线。"),
  tpl("stage_mail.publish_live", "stage_mail", "内容已发布核对", "已发布", ["PUBLISHED"],
    "Thank You for Publishing — Final Link Check",
    "Hi,\n\nThanks for going live. Please send the public URL so we can check the link, code and delivery completeness.\n\nBest,\nLiTime Creator Desk\n",
    "公开链接或 now live 后进入已发布。"),
  tpl("stage_mail.settlement", "stage_mail", "付款结算邮件", "结算中/已付款", ["SETTLING"],
    "LiTime Collaboration Payment Confirmation",
    "Hi,\n\nPlease send the invoice if it is still outstanding. “Invoice received” means awaiting payment; “payment sent/processed” means paid.\n\nBest,\nLiTime Creator Desk\n",
    "Invoice received 是待付款；payment sent 才是已付款。"),
  tpl("quote_confirm.v1", "quote_confirm", "写报价信", "报价待确认/商务谈判", ["QUOTE_PENDING", "NEGOTIATING"],
    "LiTime collaboration quote",
    "Hi,\n\nPlease find the LiTime collaboration quote. Reply on this thread if this rate works.\n\nBest,\nLiTime Creator Desk\n",
    "品牌报价信，走审批与 Cc 规则。金额按小时单价写 USD n per hour，不要写成套餐总价。"),
  tpl("delay_followup.v1", "delay_followup", "合作延期邮件", "延期风险", [],
    "Update on the Content Timeline",
    "Hi,\n\nThanks for flagging the delay. We can reschedule with care — a private emergency is not treated as a default breach.\n\nBest,\nLiTime Creator Desk\n",
    "私人突发应进入关怀型处理。", "exception"),
  tpl("lost_contact.v1", "lost_contact", "失联跟进", "失联风险", [],
    "Following Up on Our LiTime Collaboration",
    "Hi,\n\nChecking in because we have not heard back. Please reply when you can, or let us know a better contact.\n\nBest,\nLiTime Creator Desk\n",
    "失联需结合最后回复日期，不能只靠关键词。", "exception"),
  tpl("revision_nudge.v1", "revision_nudge", "修改未完成跟进", "内容风险", ["CONTENT_REVIEW", "PUBLISH_PENDING"],
    "Follow-Up on Requested Content Updates",
    "Hi,\n\nA reminder that the requested content updates are still outstanding. Please share the revised cut when ready.\n\nBest,\nLiTime Creator Desk\n",
    "未按反馈完成修改，需提醒负责人继续跟进。", "exception"),
  tpl("affiliate_invite.v1", "affiliate_invite", "联盟项目邀请", "Affiliate开通", [],
    "Join the LiTime Affiliate Program",
    "Hi,\n\nWe would like to invite you to the LiTime Affiliate Program. Joining is not the same as already generating orders.\n\nBest,\nLiTime Creator Desk\n",
    "一次性合作转为长期联盟；开通不等于已有订单。", "longterm"),
  tpl("affiliate_setup.v1", "affiliate_setup", "联盟信息配置", "Affiliate配置中", [],
    "Your LiTime Affiliate Link and Creator Code",
    "Hi,\n\nHere is your affiliate link and creator code. Please confirm tracking works before any promotion.\n\nBest,\nLiTime Creator Desk\n",
    "必须检查 Code 和链接是否可以正常追踪。", "longterm"),
  tpl("content_license.v1", "content_license", "素材授权确认", "授权确认", [],
    "LiTime Content Usage Permission Confirmation",
    "Hi,\n\nPlease confirm usage rights. Organic/social usage and paid ads / whitelisting are tracked separately.\n\nBest,\nLiTime Creator Desk\n",
    "免费自然使用和付费广告授权必须分开识别。", "longterm"),
  tpl("repeat_collab.v1", "repeat_collab", "复投邀请邮件", "二次合作", [],
    "New LiTime Collaboration Opportunity",
    "Hi,\n\nBased on the previous collaboration, we would like to invite you to a new LiTime campaign.\n\nBest,\nLiTime Creator Desk\n",
    "应关联历史合作记录和表现。", "longterm"),
];

const BY_ID = new Map(EMAIL_TEMPLATES.map((row) => [row.id, row]));

export function templateById(id: string | null | undefined): EmailTemplate | undefined {
  return id ? BY_ID.get(String(id)) : undefined;
}

export function templatesForSkill(skill: string): string[] {
  return EMAIL_TEMPLATES.filter((row) => row.skill === skill).map((row) => row.id);
}

export const TEMPLATES: Record<string, string[]> = Object.fromEntries(
  [...new Set(EMAIL_TEMPLATES.map((row) => row.skill))].map((skill) => [skill, templatesForSkill(skill)]),
);

export function pickTemplateForSkill(skill: string, stageCode?: string | null): EmailTemplate {
  const stage = stageCode ? normalizeStage(stageCode) : "";
  const rows = EMAIL_TEMPLATES.filter((row) => row.skill === skill);
  const matches = rows.filter((row) => stage && row.stages.includes(stage));
  const hit = [...matches].sort((a, b) => a.stages.length - b.stages.length)[0] || rows[0];
  if (!hit) {
    return tpl(`${skill}.v1`, skill, skill, "", [], "Follow-up", "Hi,\n\nBest,\nCreator Desk\n", "", "main");
  }
  return hit;
}

export function templateAllowedForStage(templateId: string, stageCode?: string | null): boolean {
  const spec = templateById(templateId);
  if (!spec) return false;
  if (!spec.stages.length) return true;
  const stage = stageCode ? normalizeStage(stageCode) : "";
  if (!stage) return true;
  return spec.stages.includes(stage);
}
