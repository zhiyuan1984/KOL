import { TypeSafeClient } from "@typesafe-ai/sdk";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const NO_ACTION = "no_action";
const NEEDS_REVIEW = "needs_review";
const ACTIONS = [NO_ACTION, "create", "merge_open_order", "update_next_step", "advance_stage", NEEDS_REVIEW] as const;
const MAX_TEMPLATES = 24;
const MAX_ROUTES = 24;
const MAX_STAGES = 12;

type FetchLike = typeof fetch;
let fetchOverride: FetchLike | null = null;

export type JevWorkOrderTemplateChoice = {
  template_code: string;
  version: number;
  title: string;
  automation_level: "A0" | "A1" | "A2" | "A3" | "L3";
  description?: string;
};

export type JevWorkOrderInput = {
  task: { id: string; title: string; goal: string; status: string; stage_code?: string | null };
  source_event: { id: string; type: string; summary: string; occurred_at?: string | null } | null;
  templates: JevWorkOrderTemplateChoice[];
  routing_policy_codes?: string[];
  /** Template-authorized stage targets. They may be non-adjacent only when the
   * host later proves every required intervening fact. */
  allowed_stage_targets?: string[];
  /** @deprecated Pre-A3 alias retained for shadow-decision compatibility. */
  allowed_next_stages?: string[];
};

type SystemOneAnswer = { choice?: unknown; confidence?: unknown; probabilities?: unknown };
export type JevWorkOrderVerdict = {
  template_code: string | null;
  template_version: number | null;
  action: (typeof ACTIONS)[number];
  routing_policy_code: string | null;
  stage_action: string | null;
  confidence: number;
  probabilities: Record<string, Record<string, number>>;
  model: string;
  prompt_version: "work-order-jev.v1" | "work-order-jev.v2";
  reason: string;
};

export class JevWorkOrderUnavailable extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function setWorkOrderJevFetch(fetcher?: FetchLike): void {
  fetchOverride = fetcher || null;
}

export function workOrderJevEnabled(): boolean {
  const flag = String(process.env.JEV_WORK_ORDER_ENABLED || "").trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(flag)) return false;
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();
  return Boolean(key) && (process.env.NODE_ENV !== "test" || Boolean(fetchOverride) || String(process.env.JEV_WORK_ORDER_TEST_LIVE || "") === "1");
}

export function workOrderJevModel(): string {
  return String(process.env.JEV_MODEL || "jev-1.13").trim() || "jev-1.13";
}

function timeoutMs(): number {
  const configured = Number(process.env.JEV_WORK_ORDER_TIMEOUT_MS || 8_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(10_000, Math.floor(configured))) : 8_000;
}

function clean(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function unique(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return [];
  const output: string[] = [];
  for (const value of values) {
    const item = clean(value, 120);
    if (!item || output.includes(item)) continue;
    output.push(item);
    if (output.length >= max) break;
  }
  return output;
}

function probabilities(answer: SystemOneAnswer | undefined, allowed: string[]): Record<string, number> {
  const source = answer?.probabilities;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    const choice = String(answer?.choice || "");
    return allowed.includes(choice) ? { [choice]: 1 } : {};
  }
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(source as Record<string, unknown>)) {
    const value = Number(raw);
    if (allowed.includes(key) && Number.isFinite(value) && value >= 0) output[key] = value;
  }
  const total = Object.values(output).reduce((sum, value) => sum + value, 0);
  return total > 0 ? Object.fromEntries(Object.entries(output).map(([key, value]) => [key, value / total])) : {};
}

function selection(answer: SystemOneAnswer | undefined, allowed: string[], fallback: string): { choice: string; confidence: number; probabilities: Record<string, number> } {
  const choice = String(answer?.choice || "");
  const confidence = Math.max(0, Math.min(1, Number(answer?.confidence || 0)));
  return {
    choice: allowed.includes(choice) ? choice : fallback,
    confidence,
    probabilities: probabilities(answer, allowed),
  };
}

/**
 * Performs bounded System One choices only. It receives no employee name list,
 * no raw contact data, and no write tool. Host-side policy resolves routing to a
 * person and validates evidence/stage rules before any future executor runs.
 */
export async function judgeWorkOrderWithJev(input: JevWorkOrderInput): Promise<JevWorkOrderVerdict> {
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!key || !workOrderJevEnabled()) throw new JevWorkOrderUnavailable("Jev AI 工单判断未启用或未配置。");
  const templates = input.templates.slice(0, MAX_TEMPLATES).map((template) => ({
    ...template,
    template_code: clean(template.template_code, 120), title: clean(template.title, 200), description: clean(template.description, 300),
  })).filter((template) => template.template_code);
  const codes = templates.map((template) => template.template_code);
  const routes = unique(input.routing_policy_codes, MAX_ROUTES);
  const stages = unique(input.allowed_stage_targets ?? input.allowed_next_stages, MAX_STAGES);
  const client = new TypeSafeClient({
    apiKey: key, baseURL: OPENROUTER_BASE_URL, defaultModel: workOrderJevModel(), timeout: timeoutMs(), retry: { maxRetries: 0 }, logLevel: "off",
    ...(fetchOverride ? { fetch: fetchOverride } : {}),
  });
  try {
    const response = await client.systemOne({
      model: workOrderJevModel(),
      state: {
        task: { id: clean(input.task.id, 120), title: clean(input.task.title, 200), goal: clean(input.task.goal, 800), status: clean(input.task.status, 80), stage_code: clean(input.task.stage_code, 80) || null },
        source_event: input.source_event ? { id: clean(input.source_event.id, 160), type: clean(input.source_event.type, 120), summary: clean(input.source_event.summary, 800), occurred_at: input.source_event.occurred_at || null } : null,
        candidates: templates.map((template) => ({ code: template.template_code, version: template.version, title: template.title, automation_level: template.automation_level, description: template.description })),
        routing_policy_codes: routes,
        allowed_stage_targets: stages,
      },
      questions: {
        template_code: {
          type: "choice",
          instructions: "从已发布候选模板中选择最适用的一个；若证据不足、风险较高或没有适用项，选择 no_action。禁止发明模板。",
          criteria: Object.fromEntries([...templates.map((template) => [template.template_code, `${template.title}；${template.description || "标准化动作"}；自动化等级 ${template.automation_level}`]), [NO_ACTION, "没有已发布模板可由现有事实可靠触发。"]]),
        },
        action: {
          type: "choice",
          instructions: "只根据 task、source_event 和候选模板选择动作；不得假设未提供的合同、金额、联系方式或人员。高风险、缺证据和不确定时选 needs_review 或 no_action。",
          criteria: {
            [NO_ACTION]: "不创建、不更新；当前事实不支持动作。",
            create: "可由已发布标准模板产生一个新的子工单建议。",
            merge_open_order: "应该合并到已有同模板开放工单；本影子阶段只记录建议。",
            update_next_step: "只建议更新一张既有工单的下一步；本影子阶段不写入。",
            advance_stage: "只建议一个候选模板显式授权的目标阶段；该目标可能跨越中间阶段，但仍须宿主逐项核验证据、发布开关和状态版本。",
            [NEEDS_REVIEW]: "需要人工复核、选择模板/路由或补充事实。",
          },
        },
        routing_policy_code: {
          type: "choice",
          instructions: "只可选择已发布路由策略，或 needs_review。不要选择人员姓名、邮箱或自由文本。",
          criteria: Object.fromEntries([...routes.map((route) => [route, `已发布路由策略 ${route}`]), [NEEDS_REVIEW, "没有唯一、有效且授权的已发布路由策略。"]]),
        },
        stage_action: {
          type: "choice",
          instructions: "只可保持当前阶段、选择提供的受控目标阶段或 needs_review。不要假设目标可写入；不得选择取消、验收、合同、费用或外发。宿主会验证目标是否允许自动化、事件证据是否一致，以及跨阶段所需的每一项中间事实。",
          criteria: Object.fromEntries([["keep_current", "保持现有阶段。"], ...stages.map((stage) => [stage, `候选模板显式授权的目标阶段 ${stage}`]), [NEEDS_REVIEW, "证据不足、存在冲突或建议越过人工边界。"]]),
        },
      },
    });
    const answers = response.answers as Record<string, SystemOneAnswer>;
    const template = selection(answers.template_code, [...codes, NO_ACTION], NO_ACTION);
    const action = selection(answers.action, [...ACTIONS], NEEDS_REVIEW);
    const route = selection(answers.routing_policy_code, [...routes, NEEDS_REVIEW], NEEDS_REVIEW);
    const stage = selection(answers.stage_action, ["keep_current", ...stages, NEEDS_REVIEW], NEEDS_REVIEW);
    const chosenTemplate = templates.find((item) => item.template_code === template.choice);
    const resolvedAction = action.choice === "create" && !chosenTemplate ? NEEDS_REVIEW : action.choice;
    return {
      template_code: chosenTemplate?.template_code || null,
      template_version: chosenTemplate?.version || null,
      action: resolvedAction as JevWorkOrderVerdict["action"],
      routing_policy_code: route.choice === NEEDS_REVIEW ? null : route.choice,
      stage_action: ["keep_current", NEEDS_REVIEW].includes(stage.choice) ? null : stage.choice,
      confidence: Math.min(action.confidence, template.confidence || 1, route.confidence || 1, stage.confidence || 1),
      probabilities: { template_code: template.probabilities, action: action.probabilities, routing_policy_code: route.probabilities, stage_action: stage.probabilities },
      model: workOrderJevModel(),
      prompt_version: "work-order-jev.v2",
      reason: resolvedAction === NEEDS_REVIEW ? "Jev 输出无有效受控模板或需要人工复核。" : "Jev 受限枚举判断；尚未执行任何工单写入。",
    };
  } catch (error) {
    if (error instanceof JevWorkOrderUnavailable) throw error;
    throw new JevWorkOrderUnavailable("Jev AI 工单判断不可用；已禁止自动执行。");
  }
}
