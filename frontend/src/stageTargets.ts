/** Product-graph legal targets for Pipeline. Mirrors E + Host `stageConfirmOptions`. COMPLETED is not a node. */

import { MAIN_STAGE_TABS } from "./kolStages";
import type { AdminConfirmCopy } from "./adminConfirm";

export type StageTargetKind = "adjacent" | "skip" | "correct" | "exception" | "return";
export type StageTrackId = "main" | "branch" | "exception";

export type PipelineStageTarget = {
  code: string;
  label: string;
  track: StageTrackId;
  track_label: string;
  kind: StageTargetKind;
  note: string;
};

/** Host kinds of the one product `exception` node. COMPLETED is Host-terminal only. */
export const EXCEPTION_PRODUCT_KINDS = [
  { code: "PAUSED", label: "已暂停", terminal: false },
  { code: "DISPUTED", label: "争议中", terminal: false },
  { code: "LOST", label: "已流失", terminal: true },
  { code: "REJECTED", label: "已拒绝", terminal: true },
  { code: "CANCELLED", label: "已取消", terminal: true },
] as const;

const EXCEPTION_CODES = new Set<string>(EXCEPTION_PRODUCT_KINDS.map((item) => item.code));
const TERMINAL_CODES = new Set<string>([
  "COMPLETED",
  ...EXCEPTION_PRODUCT_KINDS.filter((item) => item.terminal).map((item) => item.code),
]);

const TRACK_LABEL: Record<StageTrackId, string> = {
  main: "主流程（相邻前进或回退）",
  branch: "跨段跳转",
  exception: "异常（一个产品节点，下列是种类）",
};

const SAMPLE_STAGE_CODES = new Set(["SAMPLE_PENDING", "SHIPPED", "TESTING"]);

function mainIndex(code?: string) {
  return MAIN_STAGE_TABS.findIndex((stage) => stage.code === code);
}

function skipNote(from: string, to: string): string {
  const fromIdx = mainIndex(from);
  const toIdx = mainIndex(to);
  if (fromIdx < 0 || toIdx <= fromIdx + 1) return "主流程相邻前进";
  const skipped = MAIN_STAGE_TABS.slice(fromIdx + 1, toIdx).map((stage) => stage.code);
  if (skipped.every((code) => SAMPLE_STAGE_CODES.has(code))) return "不寄样，跳过寄样测评";
  return `跳过 ${MAIN_STAGE_TABS.slice(fromIdx + 1, toIdx).map((stage) => stage.label).join("、")}`;
}

export function isProductExceptionKind(code?: string) {
  return EXCEPTION_CODES.has(String(code || ""));
}

/** Human confirm options from the product graph. Not adjacent-only. Never lists COMPLETED. */
export function pipelineStageTargets(current?: string, exception?: boolean): PipelineStageTarget[] {
  const code = String(current || "");
  if (code === "COMPLETED" || TERMINAL_CODES.has(code)) return [];
  if (exception || isProductExceptionKind(code)) {
    return MAIN_STAGE_TABS.map((item) => ({
      code: item.code,
      label: item.label,
      track: "main" as const,
      track_label: TRACK_LABEL.main,
      kind: "return" as const,
      note: "从异常旁路回到指定主流程阶段",
    }));
  }
  const fromIdx = mainIndex(code);
  const out: PipelineStageTarget[] = [];
  if (fromIdx >= 0) {
    MAIN_STAGE_TABS.forEach((item, index) => {
      if (item.code === code) return;
      if (index === fromIdx + 1) {
        out.push({
          code: item.code,
          label: item.label,
          track: "main",
          track_label: TRACK_LABEL.main,
          kind: "adjacent",
          note: "主流程相邻前进",
        });
        return;
      }
      if (index > fromIdx + 1) {
        out.push({
          code: item.code,
          label: item.label,
          track: "branch",
          track_label: TRACK_LABEL.branch,
          kind: "skip",
          note: skipNote(code, item.code),
        });
        return;
      }
      out.push({
        code: item.code,
        label: item.label,
        track: "main",
        track_label: TRACK_LABEL.main,
        kind: "correct",
        note: "纠正记错的阶段",
      });
    });
  } else {
    for (const item of MAIN_STAGE_TABS) {
      out.push({
        code: item.code,
        label: item.label,
        track: "main",
        track_label: TRACK_LABEL.main,
        kind: "adjacent",
        note: "选定具体正式阶段",
      });
    }
  }
  for (const kind of EXCEPTION_PRODUCT_KINDS) {
    out.push({
      code: kind.code,
      label: kind.label,
      track: "exception",
      track_label: TRACK_LABEL.exception,
      kind: "exception",
      note: kind.terminal ? "异常终态，确认后不可回主流程" : "异常旁路，确认后可再回到指定主流程阶段",
    });
  }
  return out;
}

export function groupedPipelineTargets(current?: string, exception?: boolean): {
  id: StageTrackId;
  label: string;
  items: PipelineStageTarget[];
}[] {
  const items = pipelineStageTargets(current, exception);
  return (["main", "branch", "exception"] as const)
    .map((id) => ({ id, label: TRACK_LABEL[id], items: items.filter((item) => item.track === id) }))
    .filter((group) => group.items.length);
}

export function pipelineStageNeedsReason(target?: PipelineStageTarget) {
  return Boolean(target && ["skip", "correct", "exception", "return"].includes(target.kind));
}

export function pipelineStageConfirm(
  handle: string,
  currentLabel: string,
  target: PipelineStageTarget,
): AdminConfirmCopy {
  const named = `${target.label}（${target.code}）`;
  return {
    kind: "pipeline-stage",
    title: "提出阶段变更",
    object: `@${handle} · ${currentLabel || "当前阶段"} → ${named}`,
    scope: "正式阶段 · confirm_stage（Host 闸门，本页不写库）",
    consequence: pipelineStageNeedsReason(target)
      ? `打开确认卡并带上具体目标 ${target.code}。${target.note}。跳转、回退或进出异常必须在确认卡填写原因。发送不等于改阶段。`
      : `打开确认卡并带上具体目标 ${target.code}。发送不等于改阶段。正式写入仍要在会话里确认。`,
    confirmLabel: "打开确认卡",
  };
}
