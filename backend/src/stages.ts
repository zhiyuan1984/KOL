export type CapabilityDomain = "Lead" | "Opportunity" | "Negotiation" | "Execution" | "Settlement-Growth";
export type AdvancementMode =
  | "自动记录"
  | "AI 建议 + 人确认"
  | "事实触发"
  | "受控执行"
  | "必须审批"
  | "规则 / 人工"
  | "物流事实自动"
  | "必须审核"
  | "审核通过后推进"
  | "平台事实自动"
  | "财务事实 / 审批"
  | "旁路"
  | "终态";
export type Stage = {
  code: string;
  label: string;
  coarse: CapabilityDomain | null;
  domain: CapabilityDomain | null;
  advancementMode: AdvancementMode;
  main: boolean;
  terminal?: boolean;
};

export const MAIN_STAGES: Stage[] = [
  { code: "INITIAL_CONTACT", label: "初步接触", coarse: "Lead", domain: "Lead", advancementMode: "自动记录", main: true },
  { code: "INTERESTED", label: "已回复-有兴趣", coarse: "Opportunity", domain: "Opportunity", advancementMode: "AI 建议 + 人确认", main: true },
  { code: "EVALUATING", label: "合作评估", coarse: "Opportunity", domain: "Opportunity", advancementMode: "AI 建议 + 人确认", main: true },
  { code: "QUOTE_PENDING", label: "报价待确认", coarse: "Negotiation", domain: "Negotiation", advancementMode: "事实触发", main: true },
  { code: "NEGOTIATING", label: "商务谈判", coarse: "Negotiation", domain: "Negotiation", advancementMode: "受控执行", main: true },
  { code: "PLAN_PENDING", label: "方案待确认", coarse: "Negotiation", domain: "Negotiation", advancementMode: "必须审批", main: true },
  { code: "CONTRACTING", label: "合同签署", coarse: "Execution", domain: "Execution", advancementMode: "必须审批", main: true },
  { code: "SAMPLE_PENDING", label: "待寄样", coarse: "Execution", domain: "Execution", advancementMode: "规则 / 人工", main: true },
  { code: "SHIPPED", label: "已发货", coarse: "Execution", domain: "Execution", advancementMode: "物流事实自动", main: true },
  { code: "TESTING", label: "已签收-测试中", coarse: "Execution", domain: "Execution", advancementMode: "物流事实自动", main: true },
  { code: "CONTENT_PLANNING", label: "内容策划", coarse: "Execution", domain: "Execution", advancementMode: "AI 建议 + 人确认", main: true },
  { code: "CONTENT_REVIEW", label: "内容审核", coarse: "Execution", domain: "Execution", advancementMode: "必须审核", main: true },
  { code: "PUBLISH_PENDING", label: "待发布", coarse: "Execution", domain: "Execution", advancementMode: "审核通过后推进", main: true },
  { code: "PUBLISHED", label: "已发布", coarse: "Execution", domain: "Execution", advancementMode: "平台事实自动", main: true },
  { code: "SETTLING", label: "结算中 / 已付款", coarse: "Settlement-Growth", domain: "Settlement-Growth", advancementMode: "财务事实 / 审批", main: true },
];

export const SIDE_STAGES: Stage[] = [
  { code: "PAUSED", label: "已暂停", coarse: null, domain: null, advancementMode: "旁路", main: false },
  { code: "LOST", label: "已流失", coarse: null, domain: null, advancementMode: "终态", main: false, terminal: true },
  { code: "REJECTED", label: "已拒绝", coarse: null, domain: null, advancementMode: "终态", main: false, terminal: true },
  { code: "CANCELLED", label: "已取消", coarse: null, domain: null, advancementMode: "终态", main: false, terminal: true },
  { code: "DISPUTED", label: "争议中", coarse: null, domain: null, advancementMode: "旁路", main: false },
  { code: "COMPLETED", label: "已完成", coarse: null, domain: null, advancementMode: "终态", main: false, terminal: true },
];

export const STAGES: Stage[] = [...MAIN_STAGES, ...SIDE_STAGES];
export const PIPELINE_COLUMNS: CapabilityDomain[] = ["Lead", "Opportunity", "Negotiation", "Execution", "Settlement-Growth"];

export const BY_CODE: Record<string, Stage> = Object.fromEntries(STAGES.map((s) => [s.code, s]));

export const NEXT_STAGE: Record<string, string | null> = {
  INITIAL_CONTACT: "INTERESTED",
  INTERESTED: "EVALUATING",
  EVALUATING: "QUOTE_PENDING",
  QUOTE_PENDING: "NEGOTIATING",
  NEGOTIATING: "PLAN_PENDING",
  PLAN_PENDING: "CONTRACTING",
  CONTRACTING: "SAMPLE_PENDING",
  SAMPLE_PENDING: "SHIPPED",
  SHIPPED: "TESTING",
  TESTING: "CONTENT_PLANNING",
  CONTENT_PLANNING: "CONTENT_REVIEW",
  CONTENT_REVIEW: "PUBLISH_PENDING",
  PUBLISH_PENDING: "PUBLISHED",
  PUBLISHED: "SETTLING",
  SETTLING: "COMPLETED",
  PAUSED: null,
  DISPUTED: null,
  LOST: null,
  REJECTED: null,
  CANCELLED: null,
  COMPLETED: null,
};

export const LEGACY_STAGE_ALIASES: Record<string, string> = {
  INTEREST_CONFIRMED: "INTERESTED",
  COOPERATION_EVALUATION: "EVALUATING",
  BUSINESS_NEGOTIATION: "NEGOTIATING",
  CONTRACT_SIGNING: "CONTRACTING",
  DELIVERED_TESTING: "TESTING",
  PENDING_PUBLISH: "PUBLISH_PENDING",
  SETTLING_PAID: "SETTLING",
  EXCEPTION_HANDLING: "DISPUTED",
};

export function normalizeStage(code: string): string {
  return LEGACY_STAGE_ALIASES[code] || code;
}

export function label(code: string): string {
  const normalized = normalizeStage(code);
  return BY_CODE[normalized]?.label ?? normalized;
}

/** Coarse SOP / Starry status labels that are not official 15-stage names. */
const COARSE_STAGE_ALIASES: Record<string, string> = {
  建联: "INITIAL_CONTACT",
  待建联: "INITIAL_CONTACT",
  未建联: "INITIAL_CONTACT",
  已建联: "INITIAL_CONTACT",
  已签约: "CONTRACTING",
  已完成: "COMPLETED",
  暂缓: "PAUSED",
  已拒绝: "REJECTED",
  已取消: "CANCELLED",
  已流失: "LOST",
  争议中: "DISPUTED",
  异常处理: "DISPUTED",
  意向: "INTERESTED",
  评估报价: "EVALUATING",
  方案签约: "PLAN_PENDING",
  寄样测评: "SAMPLE_PENDING",
  内容发布: "CONTENT_PLANNING",
  结算: "SETTLING",
};

/** Map a Starry stage code or Chinese label onto the official 15+side codes. */
export function codeFromLabel(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const asCode = normalizeStage(trimmed);
  if (BY_CODE[asCode]) return asCode;
  const compact = trimmed.replace(/\s/g, "");
  const hit = STAGES.find((stage) => stage.label.replace(/\s/g, "") === compact);
  if (hit) return hit.code;
  if (COARSE_STAGE_ALIASES[compact]) return COARSE_STAGE_ALIASES[compact];
  const alias = Object.entries(LEGACY_STAGE_ALIASES).find(([legacy]) => legacy.replace(/_/g, "") === compact);
  return alias ? alias[1] : null;
}

function mainStageIndex(code: string): number {
  return MAIN_STAGES.findIndex((stage) => stage.code === normalizeStage(code));
}

/** Prefer the later main-pipeline stage; keep a local side/terminal stage over a main one. */
export function preferLaterMainStage(a: string | null | undefined, b: string | null | undefined): string {
  const left = a ? normalizeStage(String(a)) : "";
  const right = b ? normalizeStage(String(b)) : "";
  const li = mainStageIndex(left);
  const ri = mainStageIndex(right);
  if (li >= 0 && ri >= 0) return li >= ri ? left : right;
  if (left && BY_CODE[left] && !BY_CODE[left].main) return left;
  return left || right;
}

/**
 * Host official stage is the source of truth. Starry list-all must not regress it:
 * empty/unmapped remote keeps local; main-pipeline never moves backward;
 * a confirmed non-建联 row is not reset by Starry 初步接触.
 */
export function mergeRemoteLibraryStage(
  localCode: string | null | undefined,
  remoteCode: string | null | undefined,
  stageVersion = 0,
): string {
  const local = localCode ? normalizeStage(String(localCode)) : "";
  const remote = remoteCode ? normalizeStage(String(remoteCode)) : "";
  if (!local) return remote || "INITIAL_CONTACT";
  if (!remote) return local;
  const li = mainStageIndex(local);
  const ri = mainStageIndex(remote);
  if (li >= 0 && ri >= 0 && ri < li) return local;
  const confirmed = Number(stageVersion || 0) > 0;
  if (confirmed && local !== "INITIAL_CONTACT" && remote === "INITIAL_CONTACT") return local;
  if (confirmed && li < 0 && ri >= 0) return local;
  return remote;
}

export function coarse(code: string): string | null {
  return BY_CODE[normalizeStage(code)]?.coarse ?? null;
}

export function nextCode(code: string): string | null {
  return NEXT_STAGE[normalizeStage(code)] ?? null;
}

export const LOCKED_PROMISE = new Set<string>();

/** Stages the host may write without a human confirm-stage click. Send path still never writes. */
export const FACT_AUTO_MODES = new Set([
  "自动记录",
  "事实触发",
  "物流事实自动",
  "平台事实自动",
]);

export const APPROVAL_REQUIRED_MODES = new Set<AdvancementMode>([
  "必须审批",
  "必须审核",
  "审核通过后推进",
  "财务事实 / 审批",
]);

export type WorkApprovalKind = "expense" | "stage" | "content" | "settlement";

/** Official stage hops that must queue a work approval before Host writes. */
export function approvalKindForStage(code: string): WorkApprovalKind | null {
  const normalized = normalizeStage(code);
  const mode = BY_CODE[normalized]?.advancementMode;
  if (!mode || !APPROVAL_REQUIRED_MODES.has(mode)) return null;
  if (normalized === "CONTENT_REVIEW" || normalized === "PUBLISH_PENDING") return "content";
  if (normalized === "SETTLING") return "settlement";
  return "stage";
}

/** Fact auto-writes only: next main stage plus side exits. Human confirm uses `legalTargets`. */
export function autoLegalTargets(current: string): string[] {
  const normalized = normalizeStage(current);
  const stage = BY_CODE[normalized];
  if (!stage || stage.terminal) return [];
  if (normalized === "PAUSED" || normalized === "DISPUTED") {
    return MAIN_STAGES.map((s) => s.code);
  }
  const out: string[] = [];
  const nxt = NEXT_STAGE[normalized];
  if (nxt) out.push(nxt);
  for (const code of ["PAUSED", "LOST", "REJECTED", "CANCELLED", "DISPUTED"]) {
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export type StageTrackId = "main" | "branch" | "exception";
export type StageTargetKind = "adjacent" | "skip" | "correct" | "exception" | "return";

export type StageConfirmOption = {
  code: string;
  label: string;
  track: StageTrackId;
  track_label: string;
  kind: StageTargetKind;
  note: string;
  capability_domain: CapabilityDomain | null;
  advancement_mode: AdvancementMode;
};

export const STAGE_TRACK_LABEL: Record<StageTrackId, string> = {
  main: "主流程",
  branch: "分支流程",
  exception: "异常流程",
};

const SAMPLE_STAGE_CODES = new Set(["SAMPLE_PENDING", "SHIPPED", "TESTING"]);
const KIND_ORDER: Record<StageTargetKind, number> = {
  adjacent: 0,
  skip: 1,
  return: 2,
  correct: 3,
  exception: 4,
};

function optionOf(code: string, track: StageTrackId, kind: StageTargetKind, note: string): StageConfirmOption {
  const stage = BY_CODE[code];
  return {
    code,
    label: stage?.label || label(code),
    track,
    track_label: STAGE_TRACK_LABEL[track],
    kind,
    note,
    capability_domain: stage?.domain ?? null,
    advancement_mode: stage?.advancementMode || "旁路",
  };
}

function skippedMainCodes(from: string, to: string): string[] {
  const fromIdx = mainStageIndex(from);
  const toIdx = mainStageIndex(to);
  if (fromIdx < 0 || toIdx <= fromIdx + 1) return [];
  return MAIN_STAGES.slice(fromIdx + 1, toIdx).map((stage) => stage.code);
}

function skipNote(from: string, to: string): string {
  const skipped = skippedMainCodes(from, to);
  if (!skipped.length) return "主流程相邻前进";
  if (skipped.every((code) => SAMPLE_STAGE_CODES.has(code))) {
    return "不寄样，跳过寄样测评";
  }
  return `跳过 ${skipped.map((code) => label(code)).join("、")}`;
}

/**
 * Human confirm options. No adjacent-only constraint: skip, correct, and exception are listed.
 * Automatic fact writes use `autoLegalTargets`, not this list.
 */
export function stageConfirmOptions(current: string): StageConfirmOption[] {
  const normalized = normalizeStage(current);
  const stage = BY_CODE[normalized];
  if (!stage || stage.terminal) return [];
  if (normalized === "PAUSED" || normalized === "DISPUTED") {
    return MAIN_STAGES.map((item) => optionOf(item.code, "main", "return", "从异常旁路回到指定主流程阶段"));
  }
  const fromIdx = mainStageIndex(normalized);
  const out: StageConfirmOption[] = [];
  if (fromIdx >= 0) {
    for (let i = 0; i < MAIN_STAGES.length; i++) {
      const item = MAIN_STAGES[i];
      if (item.code === normalized) continue;
      if (i === fromIdx + 1) {
        out.push(optionOf(item.code, "main", "adjacent", "主流程相邻前进"));
        continue;
      }
      if (i > fromIdx + 1) {
        out.push(optionOf(item.code, "branch", "skip", skipNote(normalized, item.code)));
        continue;
      }
      out.push(optionOf(item.code, "main", "correct", "纠正记错的阶段"));
    }
    const nxt = NEXT_STAGE[normalized];
    if (nxt && !MAIN_STAGES.some((item) => item.code === nxt) && !out.some((item) => item.code === nxt)) {
      out.push(optionOf(nxt, "main", "adjacent", "主流程相邻前进"));
    }
  }
  for (const code of ["PAUSED", "DISPUTED", "LOST", "REJECTED", "CANCELLED"]) {
    const side = BY_CODE[code];
    const note = side?.terminal ? "异常终态，确认后不可回主流程" : "异常旁路，确认后可再回到指定主流程阶段";
    out.push(optionOf(code, "exception", "exception", note));
  }
  out.sort((a, b) => {
    const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kind) return kind;
    const track = Number(a.track === "exception") - Number(b.track === "exception");
    if (track) return track;
    return mainStageIndex(a.code) - mainStageIndex(b.code);
  });
  return out;
}

/** Human confirm: any listed main / branch / exception stage. Not adjacent-only. */
export function legalTargets(current: string): string[] {
  return stageConfirmOptions(current).map((item) => item.code);
}

export function confirmTargetNeedsReason(current: string, target: string): boolean {
  const kind = stageConfirmOptions(current).find((item) => item.code === normalizeStage(target))?.kind;
  return kind === "skip" || kind === "correct" || kind === "exception";
}

export function groupedStageTracks(current: string, proposed?: string | null): {
  id: StageTrackId;
  label: string;
  items: Array<StageConfirmOption & { suggested: boolean }>;
}[] {
  const suggested = proposed ? normalizeStage(proposed) : nextCode(current);
  const buckets: Record<StageTrackId, Array<StageConfirmOption & { suggested: boolean }>> = {
    main: [],
    branch: [],
    exception: [],
  };
  for (const item of stageConfirmOptions(current)) {
    buckets[item.track].push({ ...item, suggested: item.code === suggested });
  }
  return (["main", "branch", "exception"] as StageTrackId[])
    .filter((id) => buckets[id].length)
    .map((id) => ({ id, label: STAGE_TRACK_LABEL[id], items: buckets[id] }));
}

export function confirmTargetViews(current: string, proposed?: string | null): Array<StageConfirmOption & { suggested: boolean }> {
  return groupedStageTracks(current, proposed).flatMap((track) => track.items);
}

const TO_STARRY_STAGE: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_STAGE_ALIASES).map(([starry, local]) => [local, starry]),
);

/**
 * Starry-native write code (physical adapter; ADR-027). Inverse of `LEGACY_STAGE_ALIASES`.
 * Host-local codes stay the read/canonical Host model via `normalizeStage`.
 * Product edges live in `docs/business-rules/stage-transitions.md`, not Starry hop limits.
 */
export function toStarryStage(code: string): string {
  const normalized = normalizeStage(code);
  return TO_STARRY_STAGE[normalized] || normalized;
}

/** Host-local → Starry-native write code. Same mapping as `toStarryStage`. */
export function toLegacyStarryStage(code: string): string {
  return toStarryStage(code);
}

export function confirmTargetKind(current: string, target: string): StageTargetKind | null {
  return stageConfirmOptions(current).find((item) => item.code === normalizeStage(target))?.kind ?? null;
}

export function skippedStagesForConfirm(current: string, target: string): string[] {
  return skippedMainCodes(normalizeStage(current), normalizeStage(target));
}

export type StarryAdjacentWalkKind = "adjacent" | "walk" | "not_forward";

export type StarryAdjacentWalk = {
  from: string;
  to: string;
  hops: string[];
  nativeHops: string[];
  kind: StarryAdjacentWalkKind;
};

/**
 * Physical Starry adapter: remote API currently accepts adjacent-forward hops.
 * NOT product law (ADR-011 abolished; ADR-027). Product graph:
 * `docs/business-rules/stage-transitions.md`. LIVE walk is residual until a
 * follow-up code PR. Empty hops = not a forward main walk for this adapter.
 */
export function planStarryAdjacentWalk(from: string, to: string): StarryAdjacentWalk {
  const start = codeFromLabel(from) || normalizeStage(from);
  const end = codeFromLabel(to) || normalizeStage(to);
  const line = [...MAIN_STAGES.map((stage) => stage.code)];
  if (NEXT_STAGE.SETTLING === "COMPLETED") line.push("COMPLETED");
  const fromIdx = line.indexOf(start);
  const toIdx = line.indexOf(end);
  if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx) {
    return { from: start, to: end, hops: [], nativeHops: [], kind: "not_forward" };
  }
  const hops = line.slice(fromIdx + 1, toIdx + 1);
  return {
    from: start,
    to: end,
    hops,
    nativeHops: hops.map((code) => toLegacyStarryStage(code)),
    kind: hops.length === 1 ? "adjacent" : "walk",
  };
}

export function isStarryAdjacentForward(from: string, to: string): boolean {
  return planStarryAdjacentWalk(from, to).kind === "adjacent";
}

export function completedFromEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.map((item) => normalizeStage(String(item || ""))).filter((code) => Boolean(BY_CODE[code])),
  )];
}

/**
 * Default +1 and side stages, plus a single evidence-backed jump:
 * skip completed intermediates, stop at the first still-open main stage.
 * Later facts do not unlock a target whose required priors are unfinished.
 */
export function legalTargetsWithEvidence(current: string, completed: unknown = []): string[] {
  const base = autoLegalTargets(current);
  const normalized = normalizeStage(current);
  const stage = BY_CODE[normalized];
  if (!stage || stage.terminal) return [];
  if (normalized === "PAUSED" || normalized === "DISPUTED") {
    return MAIN_STAGES.map((s) => s.code);
  }
  const done = new Set(completedFromEvidence(completed));
  const codes = MAIN_STAGES.map((s) => s.code);
  const from = codes.indexOf(normalized);
  if (from < 0) return base;
  let pointer: string | null = null;
  for (let i = from + 1; i < codes.length; i++) {
    if (done.has(codes[i])) continue;
    pointer = codes[i];
    break;
  }
  if (!pointer) {
    const nxt = NEXT_STAGE[normalized];
    if (nxt && !MAIN_STAGES.some((s) => s.code === nxt)) pointer = nxt;
  }
  const out = [...base];
  if (pointer && !out.includes(pointer)) {
    const nxt = NEXT_STAGE[normalized];
    const at = nxt ? out.indexOf(nxt) : -1;
    if (at >= 0) out.splice(at + 1, 0, pointer);
    else out.unshift(pointer);
  }
  return out;
}

export type StageCheckStatus = "已完成" | "进行中" | "未开始" | "不适用" | "被前置挡住";

export type StageCheckItem = {
  code: string;
  label: string;
  status: StageCheckStatus;
  note?: string;
};

/**
 * Consecutive evidenced stages after `current` may be skipped in one confirm.
 * The last consecutive evidenced stage is the pointer (still open to confirm).
 * A later fact with a gap is blocked, not the pointer.
 */
export function evidencedPointer(current: string, evidenced: unknown = []): { pointer: string | null; completed: string[] } {
  const normalized = normalizeStage(current);
  if (!BY_CODE[normalized] || BY_CODE[normalized].terminal) return { pointer: null, completed: [] };
  if (normalized === "PAUSED" || normalized === "DISPUTED") return { pointer: null, completed: [] };
  const facts = new Set(completedFromEvidence(evidenced));
  const codes = MAIN_STAGES.map((s) => s.code);
  const from = codes.indexOf(normalized);
  if (from < 0) return { pointer: NEXT_STAGE[normalized] || null, completed: [] };
  const consecutive: string[] = [];
  for (let i = from + 1; i < codes.length; i++) {
    if (!facts.has(codes[i])) break;
    consecutive.push(codes[i]);
  }
  if (consecutive.length) {
    const pointer = consecutive.pop() as string;
    return { pointer, completed: consecutive };
  }
  return { pointer: NEXT_STAGE[normalized] || null, completed: [] };
}

/** 15-stage checklist: pointer is the earliest still-open main stage. */
export function stageChecklist(
  current: string,
  completed: unknown = [],
  options: { evidenced?: unknown; exception?: string | null; pointer?: string | null } = {},
): StageCheckItem[] {
  const normalized = normalizeStage(current);
  const done = new Set(completedFromEvidence(completed));
  const facts = new Set(completedFromEvidence(options.evidenced ?? completed));
  const codes = MAIN_STAGES.map((s) => s.code);
  const from = codes.indexOf(normalized);
  const pointer = options.pointer
    || evidencedPointer(normalized, [...facts]).pointer
    || NEXT_STAGE[normalized];
  return MAIN_STAGES.map((s, i) => {
    if (options.exception && from >= 0 && i > from) {
      return { code: s.code, label: s.label, status: "被前置挡住", note: `异常未解除：${options.exception}` };
    }
    if (i < from || (done.has(s.code) && s.code !== normalized && s.code !== pointer)) {
      return { code: s.code, label: s.label, status: "已完成" };
    }
    if (s.code === normalized) {
      return { code: s.code, label: s.label, status: "进行中" };
    }
    if (facts.has(s.code) && pointer && codes.indexOf(s.code) > codes.indexOf(pointer)) {
      return { code: s.code, label: s.label, status: "被前置挡住", note: "有证据、被前置挡住" };
    }
    if (s.code === pointer) {
      return { code: s.code, label: s.label, status: "未开始", note: "当前指针" };
    }
    return { code: s.code, label: s.label, status: "未开始" };
  });
}
