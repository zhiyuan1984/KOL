import { BY_CODE, MAIN_STAGES, NEXT_STAGE, label, type AdvancementMode, type CapabilityDomain } from "./stages.js";
import { stageMailSpec } from "./skills/email-compose-contract.js";

export const SOP_VERSION = "2026-09-08.1";

export type SopPack = {
  sop_id: string;
  version: string;
  skill_id: string;
  stage_code: string;
  stage_label: string;
  domain: CapabilityDomain | null;
  advancement_mode: AdvancementMode;
  inputs: string[];
  evidence: string[];
  completion: string[];
  next_stage: string | null;
  next_action: string;
};

const STAGE_PACK: Record<string, Pick<SopPack, "inputs" | "evidence" | "completion">> = {
  INITIAL_CONTACT: {
    inputs: ["发件邮箱", "收件邮箱", "邮件主题"],
    evidence: ["远端预览草稿", "供应商发送回执 / 消息编号"],
    completion: ["首封已受控发出且有回执", "正式阶段仍停在初步接触"],
  },
  INTERESTED: {
    inputs: ["合作红人", "来信正文"],
    evidence: ["明确兴趣正文", "Thank you 单独出现不能当作有兴趣"],
    completion: ["人确认后才写入已回复-有兴趣", "发送邮件不会修改阶段"],
  },
  EVALUATING: {
    inputs: ["合作红人", "媒体包或近期数据"],
    evidence: ["媒体包 / 粉丝与地域", "评估记录"],
    completion: ["评估完成且人确认后才进入报价待确认"],
  },
  QUOTE_PENDING: {
    inputs: ["合作红人", "报价金额"],
    evidence: ["红人报价或报价单", "询问报价不等于报价已确认"],
    completion: ["报价事实齐备后由人确认进入商务谈判"],
  },
  NEGOTIATING: {
    inputs: ["合作红人", "费用", "交付数量", "授权", "档期"],
    evidence: ["谈判纪要", "对齐后的条款草稿"],
    completion: ["条款对齐后进入方案待确认", "审批未通过不能当作已签约"],
  },
  PLAN_PENDING: {
    inputs: ["合作红人", "方案快照"],
    evidence: ["please confirm 仍是待确认", "有效制度下的审批实例"],
    completion: ["人确认或审批通过后才进入合同签署"],
  },
  CONTRACTING: {
    inputs: ["合作红人", "合同版本"],
    evidence: ["已发送签署与已签署分开记录", "远端合同事实"],
    completion: ["合同已签署后才进入待寄样"],
  },
  SAMPLE_PENDING: {
    inputs: ["姓名", "电话", "地址", "国家", "邮编", "SKU", "数量"],
    evidence: ["地址与型号齐全", "寄样规则未改"],
    completion: ["资料齐备后由人确认发货，阶段才到已发货"],
  },
  SHIPPED: {
    inputs: ["运单号", "承运商"],
    evidence: ["物流发出事实", "发货通知回执"],
    completion: ["物流事实自动到已签收-测试中，不靠邮件发送"],
  },
  TESTING: {
    inputs: ["合作红人", "签收/测试事实"],
    evidence: ["红人确认收到或测试中", "仅物流签收标疑似已签收"],
    completion: ["测试中可催大纲；人确认后才进入内容策划"],
  },
  CONTENT_PLANNING: {
    inputs: ["Brief", "关键卖点"],
    evidence: ["大纲或脚本", "来信 brief"],
    completion: ["对方回 brief 后由人确认进入内容审核"],
  },
  CONTENT_REVIEW: {
    inputs: ["成片或脚本", "审核意见"],
    evidence: ["必须审核的记录", "修改意见"],
    completion: ["审核通过后才进入待发布"],
  },
  PUBLISH_PENDING: {
    inputs: ["发布安排"],
    evidence: ["审核通过事实", "待发布窗口"],
    completion: ["审核通过后推进；发布事实来自平台不是发信"],
  },
  PUBLISHED: {
    inputs: ["平台发布链接或编号"],
    evidence: ["平台已发布事实"],
    completion: ["平台事实自动进入结算中，不靠邮件发送"],
  },
  SETTLING: {
    inputs: ["结算金额", "财务证据"],
    evidence: ["付款或结算单", "审批通过不等于已付款"],
    completion: ["财务事实 / 审批齐备后进入已完成"],
  },
};

export const SOP_PACKS: SopPack[] = MAIN_STAGES.map((stage) => {
  const extra = STAGE_PACK[stage.code];
  return {
    sop_id: stage.code,
    version: SOP_VERSION,
    skill_id: `sop_${stage.code.toLowerCase()}`,
    stage_code: stage.code,
    stage_label: stage.label,
    domain: stage.domain,
    advancement_mode: stage.advancementMode,
    inputs: extra.inputs,
    evidence: extra.evidence,
    completion: extra.completion,
    next_stage: NEXT_STAGE[stage.code] || null,
    next_action: stageMailSpec(stage.code).chip,
  };
});

export function sopPackBySkill(skillId: string): SopPack | undefined {
  return SOP_PACKS.find((row) => row.skill_id === skillId);
}

export function sopPackByStage(stageCode: string): SopPack | undefined {
  return SOP_PACKS.find((row) => row.stage_code === stageCode);
}

export function isSopSkill(value: string | null | undefined): boolean {
  return Boolean(value && sopPackBySkill(value));
}

export const SOP_PHASES = [
  { id: "contact", label: "建联", official: ["INITIAL_CONTACT"] },
  { id: "intent", label: "意向", official: ["INTERESTED"] },
  { id: "evaluate_quote", label: "评估报价", official: ["EVALUATING", "QUOTE_PENDING"] },
  { id: "negotiate", label: "商务谈判", official: ["NEGOTIATING"] },
  { id: "contract", label: "方案签约", official: ["PLAN_PENDING", "CONTRACTING"] },
  { id: "sample", label: "寄样测评", official: ["SAMPLE_PENDING", "SHIPPED", "TESTING"] },
  { id: "content", label: "内容发布", official: ["CONTENT_PLANNING", "CONTENT_REVIEW", "PUBLISH_PENDING", "PUBLISHED"] },
  { id: "settle", label: "结算", official: ["SETTLING"] },
] as const;

export type SopPhaseId = (typeof SOP_PHASES)[number]["id"];

export const SOP_EXCEPTIONS = [
  {
    code: "PAUSED",
    label: "已暂停",
    kind: "bypass" as const,
    inputs: ["合作红人", "暂停理由", "预计重启时间"],
    evidence: ["双方同意暂缓或档期冲突", "later / on hold 不能当成已拒绝"],
    completion: ["人确认后才离开主流程", "回到主流程必须指定具体正式阶段"],
    next_action: "记状态回到具体正式阶段",
  },
  {
    code: "DISPUTED",
    label: "争议中",
    kind: "bypass" as const,
    inputs: ["合作红人", "争议事实", "责任人"],
    evidence: ["样品丢失 / 履约争议记录", "风险扫描只读汇总"],
    completion: ["争议未解除时主流程冻结", "人确认后才回到指定正式阶段"],
    next_action: "风险扫描后记状态",
  },
  {
    code: "LOST",
    label: "已流失",
    kind: "terminal" as const,
    inputs: ["合作红人", "最后回复日期", "失联理由"],
    evidence: ["超过跟进窗口且无有效回复", "Thank you 或已读不能当流失"],
    completion: ["人确认后进入已流失", "终态不可滑回主流程"],
    next_action: "风险扫描",
  },
  {
    code: "REJECTED",
    label: "已拒绝",
    kind: "terminal" as const,
    inputs: ["合作红人", "拒绝正文"],
    evidence: ["明确 not interested / decline", "later 必须挡住，不能写成拒绝"],
    completion: ["人确认后进入已拒绝", "终态不可滑回主流程"],
    next_action: "记状态",
  },
  {
    code: "CANCELLED",
    label: "已取消",
    kind: "terminal" as const,
    inputs: ["合作红人", "取消理由"],
    evidence: ["双方取消或退款事实", "口头取消不能当已写入"],
    completion: ["人确认后进入已取消", "终态不可滑回主流程"],
    next_action: "记状态",
  },
] as const;

export const SOP_EXCEPTION_FLOW = {
  enter: "八段主流程任一阶段都可离开，进入已暂停 / 争议中 / 已流失 / 已拒绝 / 已取消",
  confirm: "来信分析只出建议，人确认后才离开主流程；发送邮件不会修改阶段",
  freeze: "异常未解除时主流程冻结，不能口头滑到下一阶段",
  return: "仅已暂停、争议中可回主流程，必须指定具体正式阶段，不能说「下一阶段」",
  terminal: "已流失、已拒绝、已取消是终态，不可回主流程",
  not_exception: "已完成是结算后的终态，不是异常",
} as const;

export function sopExceptionByStage(stageCode: string) {
  return SOP_EXCEPTIONS.find((row) => row.code === stageCode);
}

export function isExceptionStage(stageCode: string): boolean {
  return Boolean(sopExceptionByStage(stageCode));
}

export function exceptionFlowItems(stageCode?: string) {
  const current = stageCode ? sopExceptionByStage(stageCode) : undefined;
  return [
    SOP_EXCEPTION_FLOW.enter,
    SOP_EXCEPTION_FLOW.confirm,
    SOP_EXCEPTION_FLOW.freeze,
    SOP_EXCEPTION_FLOW.return,
    SOP_EXCEPTION_FLOW.terminal,
    SOP_EXCEPTION_FLOW.not_exception,
    ...SOP_EXCEPTIONS.map((row) => (
      `${current?.code === row.code ? "▶ " : ""}${row.label}：${row.kind === "bypass" ? "旁路，可回主流程" : "终态，不可回"} → ${row.next_action}`
    )),
  ];
}

export function sopPhaseByStage(stageCode: string) {
  return SOP_PHASES.find((phase) => (phase.official as readonly string[]).includes(stageCode));
}

/** Official Chinese name plus the 8-phase grouping, e.g. 已回复-有兴趣（意向）. */
export function stageHeadline(stageCode: string): string {
  const name = label(stageCode);
  const phase = sopPhaseByStage(stageCode);
  if (phase?.label) return `${name}（${phase.label}）`;
  const exception = sopExceptionByStage(stageCode);
  if (exception) return `${name}（异常旁路）`;
  return name;
}

export function sopPhaseTrack(stageCode: string) {
  const current = sopPhaseByStage(stageCode);
  const currentIdx = current ? SOP_PHASES.findIndex((phase) => phase.id === current.id) : -1;
  return SOP_PHASES.map((phase, index) => ({
    id: phase.id,
    label: phase.label,
    official: [...phase.official],
    official_labels: phase.official.map((code) => label(code)),
    state: currentIdx < 0 ? "idle" : index < currentIdx ? "done" : index === currentIdx ? "current" : "idle",
    current: index === currentIdx,
  }));
}

export function stageSopView(stageCode: string) {
  const pack = sopPackByStage(stageCode);
  const phase = sopPhaseByStage(stageCode);
  const exception = sopExceptionByStage(stageCode);
  const done = stageCode === "COMPLETED";
  return {
    stage_code: stageCode,
    stage_label: pack?.stage_label || exception?.label || label(stageCode),
    phase_id: phase?.id || null,
    phase_label: phase?.label || (exception ? "异常旁路" : done ? "已完成" : null),
    advancement_mode: pack?.advancement_mode || BY_CODE[stageCode]?.advancementMode || null,
    inputs: pack?.inputs || (exception ? [...exception.inputs] : []),
    evidence: pack?.evidence || (exception ? [...exception.evidence] : []),
    completion: pack?.completion || (exception ? [...exception.completion] : done ? ["结算事实齐备后进入已完成", "已完成不是异常"] : []),
    next_action: pack?.next_action || exception?.next_action || (done ? "终态" : ""),
    next_stage: pack?.next_stage || null,
    next_stage_label: pack?.next_stage ? label(pack.next_stage) : null,
    version: pack?.version || SOP_VERSION,
    track: sopPhaseTrack(stageCode),
    exception: Boolean(exception),
    exception_kind: exception?.kind || null,
    exception_flow: exceptionFlowItems(stageCode),
  };
}

export function phaseSopSummary() {
  return SOP_PHASES.map((phase) => {
    const packs = phase.official.map((code) => sopPackByStage(code)).filter(Boolean);
    return {
      id: phase.id,
      label: phase.label,
      official: [...phase.official],
      official_labels: phase.official.map((code) => label(code)),
      next_action: packs[0]?.next_action || "",
      completion: packs.flatMap((pack) => pack?.completion || []),
    };
  });
}

export function eightPhaseWalkItems(): string[] {
  return [
    "建联：发出首封后正式阶段仍停在初步接触",
    "意向：人选定「已回复-有兴趣」；Thank you 单独出现不能当有兴趣",
    "评估报价：人选定「合作评估」，再选定「报价待确认」",
    "商务谈判：人选定「商务谈判」",
    "方案签约：人选定「方案待确认」「合同签署」；须审批的先过工作审批",
    "寄样测评：人选定「待寄样」；不寄样可在确认卡分支流程跳到内容策划；物流事实可自动到已发货 / 已签收-测试中",
    "内容发布：人选定内容策划 / 内容审核 / 待发布；平台事实可自动到已发布",
    "结算：人选定「结算中 / 已付款」；财务事实齐备后进入已完成",
    "每一步由人选定具体正式阶段；系统只建议，不能说「下一阶段」",
    "记错阶段可在主流程里纠正回退；发送邮件不会修改阶段",
  ];
}

export function isStageSopSkill(value: string | null | undefined): boolean {
  return value === "stage_sop";
}

export function isSopDisplaySkill(value: string | null | undefined): boolean {
  return isSopSkill(value) || isStageSopSkill(value);
}

export function sopFunnelId(stageCode: string): "reach" | "intent" | "biz" | "sample" | "content" | "settle" {
  if (stageCode === "INITIAL_CONTACT") return "reach";
  if (stageCode === "INTERESTED" || stageCode === "EVALUATING") return "intent";
  if (stageCode === "QUOTE_PENDING" || stageCode === "NEGOTIATING" || stageCode === "PLAN_PENDING" || stageCode === "CONTRACTING") return "biz";
  if (stageCode === "SAMPLE_PENDING" || stageCode === "SHIPPED" || stageCode === "TESTING") return "sample";
  if (stageCode === "SETTLING") return "settle";
  return "content";
}

export function profileForDomain(domain: CapabilityDomain | null): "lead" | "opportunity" | "negotiation" | "execution" | "settlement-growth" {
  if (domain === "Lead") return "lead";
  if (domain === "Opportunity") return "opportunity";
  if (domain === "Negotiation") return "negotiation";
  if (domain === "Settlement-Growth") return "settlement-growth";
  return "execution";
}
