export type JourneyKind = "enter" | "task" | "compose" | "send" | "complete" | "kol" | "pipeline" | "skill";

export type JourneyEvent = {
  kind: JourneyKind;
  skillId?: string;
  skillLabel?: string;
  handle?: string;
  stageCode?: string;
  at: number;
};

export type JourneyGap = {
  id: string;
  title: string;
  reason: string;
};

export type JourneyAction = {
  label: string;
  intent: string;
  prompt: string;
};

export type JourneyGuideModel = {
  funnelId: string;
  stageCode: string;
  stageLabel: string;
  mode: string;
  title: string;
  body: string;
  nextLabel: string;
  nextIntent?: string;
  nextPrompt?: string;
  gaps: JourneyGap[];
};

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

export function sopPhaseByStage(stageCode?: string) {
  if (!stageCode) return undefined;
  return SOP_PHASES.find((phase) => (phase.official as readonly string[]).includes(stageCode));
}

/** Official stage already equals or has passed the suggested target on the main track. */
export function officialStageReached(official?: string, target?: string) {
  const current = String(official || "");
  const goal = String(target || "");
  if (!current || !goal) return false;
  if (current === goal) return true;
  const from = JOURNEY_STAGES.findIndex((row) => row.code === current);
  const to = JOURNEY_STAGES.findIndex((row) => row.code === goal);
  return from >= 0 && to >= 0 && from >= to;
}

export const JOURNEY_STAGES: {
  code: string;
  label: string;
  short: string;
  funnel: string;
  mode: string;
}[] = [
  { code: "INITIAL_CONTACT", label: "初步接触", short: "接触", funnel: "reach", mode: "自动记录" },
  { code: "INTERESTED", label: "已回复-有兴趣", short: "兴趣", funnel: "intent", mode: "AI 建议 + 人确认" },
  { code: "EVALUATING", label: "合作评估", short: "评估", funnel: "intent", mode: "AI 建议 + 人确认" },
  { code: "QUOTE_PENDING", label: "报价待确认", short: "报价", funnel: "biz", mode: "事实触发" },
  { code: "NEGOTIATING", label: "商务谈判", short: "谈判", funnel: "biz", mode: "受控执行" },
  { code: "PLAN_PENDING", label: "方案待确认", short: "方案", funnel: "biz", mode: "必须审批" },
  { code: "CONTRACTING", label: "合同签署", short: "合同", funnel: "biz", mode: "必须审批" },
  { code: "SAMPLE_PENDING", label: "待寄样", short: "寄样", funnel: "sample", mode: "规则 / 人工" },
  { code: "SHIPPED", label: "已发货", short: "发货", funnel: "sample", mode: "物流事实自动" },
  { code: "TESTING", label: "已签收-测试中", short: "测试", funnel: "sample", mode: "物流事实自动" },
  { code: "CONTENT_PLANNING", label: "内容策划", short: "策划", funnel: "content", mode: "AI 建议 + 人确认" },
  { code: "CONTENT_REVIEW", label: "内容审核", short: "审核", funnel: "content", mode: "必须审核" },
  { code: "PUBLISH_PENDING", label: "待发布", short: "待发", funnel: "content", mode: "审核通过后推进" },
  { code: "PUBLISHED", label: "已发布", short: "已发", funnel: "content", mode: "平台事实自动" },
  { code: "SETTLING", label: "结算中 / 已付款", short: "结算", funnel: "settle", mode: "财务事实 / 审批" },
];

const SKILL_TITLE: Record<string, string> = {
  creator_discovery: "达人发现",
  creator_profile: "达人画像",
  creator_library_sync: "达人同步入库",
  email_compose: "写合作邮件",
  confirm_stage: "提出阶段变更",
  business_approval: "费用审批",
  reply_analysis: "回复分析",
  deal_memory: "Deal Memory",
  creator_lifecycle_kanban: "合作生命周期看板",
  risk_scan: "超时/风险扫描",
};

const KNOWN_GAPS: JourneyGap[] = [
  { id: "inbound_push", title: "来信进会话", reason: "没有来信推送，要主动跑邮件会话技能" },
  { id: "reply_in_thread", title: "来信气泡回复", reason: "不能 reply-in-thread，只能再开写邮件技能" },
  { id: "fact_autostage", title: "物流/平台自动流", reason: "运单和公开链接发送后仍不改阶段" },
  { id: "attribution_review", title: "归因复盘", reason: "结算步暂未开放，超时请用风险扫描" },
];

const CANONICAL_SKILLS = [
  "creator_discovery", "creator_profile", "email_compose", "confirm_stage",
  "reply_analysis", "deal_memory", "creator_lifecycle_kanban", "risk_scan",
];

const KEY = "lingong:journey";
const EVENT_NAME = "lingong-journey";

export function skillTitle(id?: string) {
  if (!id) return "";
  return SKILL_TITLE[id] || id;
}

export function stageMeta(code?: string) {
  return JOURNEY_STAGES.find((stage) => stage.code === code);
}

export function rememberJourney(event: Omit<JourneyEvent, "at">) {
  const payload: JourneyEvent = { ...event, at: Date.now() };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function readJourney(): JourneyEvent | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JourneyEvent;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function subscribeJourney(onChange: () => void) {
  window.addEventListener(EVENT_NAME, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT_NAME, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function promptFor(intent: string, handle?: string) {
  const title = skillTitle(intent);
  if (!title) return "";
  if (intent === "email_compose") {
    return handle
      ? `写合作邮件 发件箱 [发件邮箱] 发给 @${handle} 主题：[主题]`
      : "写合作邮件 发件箱 [发件邮箱] 发给 [收件邮箱] 主题：[主题]";
  }
  if (intent === "confirm_stage") return handle ? `记状态 @${handle}` : "提出阶段变更 [红人] 到 [目标阶段]";
  if (handle) return `${title} @${handle}`;
  return title;
}

export function collectJourneyGaps(definitions: { id: string; title?: string; granted?: boolean; in_market?: boolean }[]): JourneyGap[] {
  const byId = new Map(definitions.map((row) => [row.id, row]));
  const gaps = [...KNOWN_GAPS];
  for (const id of CANONICAL_SKILLS) {
    const row = byId.get(id);
    if (!row) {
      gaps.push({ id, title: skillTitle(id) || id, reason: "目录里还没有这个技能" });
      continue;
    }
    if (row.granted === false) {
      gaps.push({ id, title: row.title || skillTitle(id), reason: "当前账号未授权，请管理员在技能授权中开通" });
    }
  }
  const seen = new Set<string>();
  return gaps.filter((gap) => {
    if (seen.has(gap.id)) return false;
    seen.add(gap.id);
    return true;
  });
}

type KolLike = {
  handle: string;
  stage_code?: string;
  stage_label?: string;
  unbound?: boolean;
  exception?: boolean;
  days_in_stage?: number;
  suggested_stage?: string;
};

type TaskLike = {
  title?: string;
  skill?: string;
  skill_id?: string;
  task_type?: string;
  kol_name?: string;
  status?: string;
  priority?: string;
};

function pickFocusKol(kols: KolLike[]): KolLike | undefined {
  const exceptions = kols.filter((kol) => kol.exception);
  if (exceptions.length) return exceptions[0];
  const unbound = kols.filter((kol) => kol.unbound);
  if (unbound.length) return unbound[0];
  return [...kols].sort((a, b) => (b.days_in_stage || 0) - (a.days_in_stage || 0))[0];
}

function openTaskIntent(task?: TaskLike) {
  return String(task?.skill_id || task?.skill || task?.task_type || "");
}

export function buildJourneyGuide(input: {
  event: JourneyEvent | null;
  kols?: KolLike[];
  tasks?: TaskLike[];
  definitions?: { id: string; title?: string; granted?: boolean; in_market?: boolean }[];
}): JourneyGuideModel {
  const kols = input.kols || [];
  const tasks = (input.tasks || []).filter((task) => !["completed", "done"].includes(String(task.status || "")));
  const gaps = collectJourneyGaps(input.definitions || []);
  const event = input.event;
  const focus = (event?.handle && kols.find((kol) => kol.handle === event.handle)) || pickFocusKol(kols);
  const stageCode = event?.stageCode || focus?.stage_code || (focus?.unbound ? "" : "INITIAL_CONTACT");
  const meta = stageMeta(stageCode);

  if (focus?.unbound) {
    return {
      funnelId: "reach",
      stageCode: "",
      stageLabel: "未建联",
      mode: "自动记录",
      title: `先给 @${focus.handle} 补画像`,
      body: "未建联红人还没有生命周期。点卡预填「达人画像」，不要进生命周期页。画像齐了再写合作邮件，系统才应记入初步接触。",
      nextLabel: "达人画像",
      nextIntent: "creator_profile",
      nextPrompt: promptFor("creator_profile", focus.handle),
      gaps,
    };
  }

  if (focus?.exception) {
    return {
      funnelId: "exception",
      stageCode: stageCode || "exception",
      stageLabel: focus.stage_label || "异常",
      mode: "人确认旁路",
      title: `@${focus.handle} 在异常状态`,
      body: "失联、延期、拒绝、暂停要人确认后离开主时间线。不要从异常格自动滑回正式阶段。",
      nextLabel: "风险扫描",
      nextIntent: "risk_scan",
      nextPrompt: promptFor("risk_scan", focus.handle),
      gaps,
    };
  }

  const nextId = openTaskIntent(tasks[0]) || event?.skillId || "email_compose";
  const handle = event?.handle || focus?.handle;
  const body = event?.skillId
    ? "点芯片预填下一步，不要口令「下一阶段」。"
    : "从今日工作点一条任务，或在输入框描述要做的事。";
  const title = event?.kind && event.kind !== "enter"
    ? (event.skillLabel ? `刚做完「${event.skillLabel}」` : "按合作之旅继续")
    : (focus ? `当前在「${meta?.label || focus.stage_label || "初步接触"}」` : "从建联开始这条合作之旅");

  if (!focus && tasks[0]) {
    const intent = openTaskIntent(tasks[0]) || "email_compose";
    return {
      funnelId: meta?.funnel || "reach",
      stageCode: stageCode || "",
      stageLabel: meta?.label || "今日工作",
      mode: meta?.mode || "对话干活",
      title: "先处理今天排在前面的任务",
      body: "首页回答「今天先碰谁」。点任务进会话干活；生命周期页只用来扫谁卡在哪。",
      nextLabel: tasks[0].title || skillTitle(intent),
      nextIntent: intent,
      nextPrompt: tasks[0].title,
      gaps,
    };
  }

  return {
    funnelId: meta?.funnel || "reach",
    stageCode: stageCode || "INITIAL_CONTACT",
    stageLabel: meta?.label || "初步接触",
    mode: meta?.mode || "自动记录",
    title,
    body,
    nextLabel: skillTitle(nextId) || "写合作邮件",
    nextIntent: nextId,
    nextPrompt: promptFor(nextId, handle),
    gaps,
  };
}
