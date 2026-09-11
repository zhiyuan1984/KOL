import { BY_CODE, normalizeStage } from "./stages.js";
import { taskDefinition, type TaskProfileId } from "./tasks/registry.js";

export type ProfileId = TaskProfileId;

export type CodexProfile = {
  id: ProfileId;
  name: "Commander" | "Lead" | "Opportunity" | "Negotiation" | "Execution" | "Settlement-Growth";
  responsibilities: string[];
  defaultWritableScope: string;
  guardrail: string;
  harness: "codex-app-server";
  canDeriveChildThreads: boolean;
};

export const CODEX_PROFILES: CodexProfile[] = [
  {
    id: "commander",
    name: "Commander",
    responsibilities: ["理解目标", "拆解任务", "选择能力档", "汇总", "恢复"],
    defaultWritableScope: "创建任务；不直接修改业务承诺",
    guardrail: "可派生子任务；子任务仍走同一套运行环境，不另起框架",
    harness: "codex-app-server",
    canDeriveChildThreads: true,
  },
  {
    id: "lead",
    name: "Lead",
    responsibilities: ["搜索", "抓取", "去重", "画像", "评分", "建线索"],
    defaultWritableScope: "创建候选线索与达人档案草稿",
    guardrail: "不得直接写正式商机承诺",
    harness: "codex-app-server",
    canDeriveChildThreads: false,
  },
  {
    id: "opportunity",
    name: "Opportunity",
    responsibilities: ["回复解析", "事实抽取", "意愿判断", "商机评分"],
    defaultWritableScope: "写证据和候选阶段",
    guardrail: "候选阶段必须经状态机策略确认后才能成为正式阶段",
    harness: "codex-app-server",
    canDeriveChildThreads: false,
  },
  {
    id: "negotiation",
    name: "Negotiation",
    responsibilities: ["多因素估值", "报价比较", "策略", "反报价草稿", "Deal Memory"],
    defaultWritableScope: "不得越权发送价格承诺",
    guardrail: "不得越权发送价格承诺",
    harness: "codex-app-server",
    canDeriveChildThreads: false,
  },
  {
    id: "execution",
    name: "Execution",
    responsibilities: ["合同", "寄样", "物流", "内容策划与审核", "发布跟踪"],
    defaultWritableScope: "事实状态可按策略自动写入",
    guardrail: "合同与内容审核等受控节点必须遵守审批模式",
    harness: "codex-app-server",
    canDeriveChildThreads: false,
  },
  {
    id: "settlement-growth",
    name: "Settlement-Growth",
    responsibilities: ["归因", "结算", "达人复评", "复投建议"],
    defaultWritableScope: "付款和账户变更必须审批",
    guardrail: "付款和账户变更必须审批",
    harness: "codex-app-server",
    canDeriveChildThreads: false,
  },
];

export const PROFILE_BY_ID = Object.fromEntries(CODEX_PROFILES.map((profile) => [profile.id, profile])) as Record<
  ProfileId,
  CodexProfile
>;

const DOMAIN_PROFILE: Record<string, ProfileId> = {
  Lead: "lead",
  Opportunity: "opportunity",
  Negotiation: "negotiation",
  Execution: "execution",
  "Settlement-Growth": "settlement-growth",
};

export function profileFor(skill: string, stageCode?: string | null): CodexProfile {
  const bySkill = taskDefinition(skill)?.profile;
  if (bySkill) return PROFILE_BY_ID[bySkill];
  const stage = stageCode ? BY_CODE[normalizeStage(stageCode)] : undefined;
  const byDomain = stage?.domain ? DOMAIN_PROFILE[stage.domain] : undefined;
  return PROFILE_BY_ID[byDomain || "commander"];
}

export function publicProfiles(): CodexProfile[] {
  return CODEX_PROFILES.map((profile) => ({
    ...profile,
    responsibilities: [...profile.responsibilities],
  }));
}
