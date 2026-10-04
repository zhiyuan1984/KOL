import { HttpFail } from "../host/errors.js";
import { BY_CODE, FACT_AUTO_MODES, MAIN_STAGES, normalizeStage } from "../stages.js";

export type StageTargetPolicy = {
  target_stage: string;
  required_event_types: string[];
  required_evidence_keys: string[];
  /** Cross-stage writes are intentional only when this is true. Evidence still
   * has to cover every intervening main-stage fact. */
  allow_cross_stage: boolean;
};

export type ParsedWorkOrderStagePolicy = {
  allowed_target_stages: string[];
  targets: Record<string, StageTargetPolicy>;
};

function clean(value: unknown, max = 120): string {
  return String(value ?? "").trim().slice(0, max);
}

function list(value: unknown, maxItems: number, maxChars = 120): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => clean(item, maxChars)).filter(Boolean))].slice(0, maxItems);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Stage targets are template-declared, not inferred from a neighboring-stage
 * graph. `allowed_next_stages` remains readable only for pre-A3 shadow
 * decisions; publication of A3 templates requires the explicit v2 shape.
 */
export function parseWorkOrderStagePolicy(value: unknown): ParsedWorkOrderStagePolicy {
  const raw = record(value);
  const targetNames = list(raw.allowed_target_stages ?? raw.allowed_next_stages, 12)
    .map((item) => normalizeStage(item))
    .filter((item) => Boolean(BY_CODE[item]));
  const config = record(raw.targets ?? raw.target_policies);
  const targets: Record<string, StageTargetPolicy> = {};
  for (const target of targetNames) {
    const entry = record(config[target]);
    targets[target] = {
      target_stage: target,
      required_event_types: list(entry.required_event_types ?? entry.event_types, 20),
      required_evidence_keys: list(entry.required_evidence_keys ?? entry.evidence_keys, 20),
      allow_cross_stage: entry.allow_cross_stage === true,
    };
  }
  return { allowed_target_stages: [...new Set(targetNames)], targets };
}

export function stagePolicyTarget(value: unknown, target: string | null | undefined): StageTargetPolicy | null {
  const normalized = normalizeStage(clean(target));
  const parsed = parseWorkOrderStagePolicy(value);
  return parsed.targets[normalized] || null;
}

export function stagePolicyPublicationError(stagePolicy: unknown, triggerEventTypes: unknown): string | null {
  const parsed = parseWorkOrderStagePolicy(stagePolicy);
  if (!parsed.allowed_target_stages.length) return "template_stage_policy_required";
  const templateEvents = new Set(list(triggerEventTypes, 30));
  for (const target of parsed.allowed_target_stages) {
    const targetPolicy = parsed.targets[target];
    const stage = BY_CODE[target];
    if (!stage || stage.terminal || !stage.main || !FACT_AUTO_MODES.has(stage.advancementMode)) return "template_stage_target_not_auto_eligible";
    if (!targetPolicy?.required_event_types.length || !targetPolicy.required_evidence_keys.length) return "template_stage_evidence_policy_required";
    if (targetPolicy.required_event_types.some((eventType) => !templateEvents.has(eventType))) return "template_stage_event_not_declared";
  }
  return null;
}

export function mainStageIndex(code: string | null | undefined): number {
  return MAIN_STAGES.findIndex((stage) => stage.code === normalizeStage(clean(code)));
}

/** The stage evidence must be monotonic; a return/correction stays a human command. */
export function isForwardMainStage(from: string | null | undefined, to: string | null | undefined): boolean {
  const fromIndex = mainStageIndex(from);
  const toIndex = mainStageIndex(to);
  return fromIndex >= 0 && toIndex > fromIndex;
}

export function stagePolicyError(status: number, code: string): never {
  throw new HttpFail(status, { code });
}
