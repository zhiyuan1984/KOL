/**
 * 写合作邮件 Skill 的唯一目录。Host 只加载，不另写 STAGE_MAIL / 口令正则猜种类。
 */
import fs from "node:fs";
import path from "node:path";
import { skillsDir } from "../config.js";
import { normalizeStage } from "../stages.js";

export type StageMailKind =
  | "first_touch"
  | "followup"
  | "media_kit"
  | "quote"
  | "negotiate"
  | "plan"
  | "contract"
  | "address"
  | "ship"
  | "testing"
  | "brief"
  | "review"
  | "schedule"
  | "live"
  | "settle";

export type StageMailSpec = {
  kind: StageMailKind;
  chip: string;
  prompt: string;
  factTitle: string;
  instruction: string;
  templateId: string;
};

export type ComposeGap = {
  field: "amount" | "tracking" | "address" | null;
  label: string;
  placeholder: string;
  prompt: string;
  result_action: string;
};

type ContractFile = {
  letters: Record<string, StageMailSpec>;
  fallback: StageMailSpec;
};

const MARKER = "```email-compose-contract";

function skillFile(): string {
  return path.join(skillsDir(), "email_compose", "SKILL.md");
}

function parseContract(): ContractFile {
  const text = fs.readFileSync(skillFile(), "utf8");
  const start = text.indexOf(MARKER);
  if (start < 0) throw new Error("email_compose SKILL.md missing email-compose-contract block");
  const bodyStart = text.indexOf("\n", start) + 1;
  const end = text.indexOf("```", bodyStart);
  if (end < 0) throw new Error("email_compose contract block is not closed");
  const parsed = JSON.parse(text.slice(bodyStart, end)) as ContractFile;
  if (!parsed?.letters || !parsed.fallback) throw new Error("email_compose contract missing letters");
  return parsed;
}

let cached: { stamp: string; value: ContractFile } | null = null;

export function emailComposeContract(): ContractFile {
  const file = skillFile();
  const stat = fs.statSync(file);
  const stamp = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (cached?.stamp === stamp) return cached.value;
  const value = parseContract();
  cached = { stamp, value };
  return value;
}

export function stageMailSpec(stage = ""): StageMailSpec {
  const code = normalizeStage(stage);
  const contract = emailComposeContract();
  return contract.letters[code] || contract.fallback;
}

export function stageMailSpecByKind(kind: StageMailKind, stage = ""): StageMailSpec {
  const contract = emailComposeContract();
  const code = normalizeStage(stage);
  // Prefer the current official stage when it already publishes this kind
  // (INTERESTED + 写跟进 → stage_mail.interested). Otherwise do not take the
  // first letter in the contract object: INTERESTED is also kind "followup",
  // and that template is illegal to send from INITIAL_CONTACT.
  if (code && contract.letters[code]?.kind === kind) return contract.letters[code];
  if (contract.fallback.kind === kind) return contract.fallback;
  return Object.values(contract.letters).find((row) => row.kind === kind) || contract.fallback;
}

/** Published operator commands from SKILL.md — not inferred from the official stage. */
export function requestedMailKind(raw = ""): StageMailKind | null {
  const text = String(raw || "");
  if (/催大纲/.test(text)) return "testing";
  if (/核对地址|寄样地址核对/.test(text)) return "address";
  if (/发货通知/.test(text)) return "ship";
  if (/发brief|发内容brief/.test(text)) return "brief";
  if (/写跟进/.test(text)) return "followup";
  return null;
}

export function isNamedMailCommand(raw = ""): boolean {
  return Boolean(requestedMailKind(raw));
}

export function isQuoteCompose(stage = ""): boolean {
  return stageMailSpec(stage).kind === "quote";
}

export function stageMailAction(handle: string, stage = ""): { label: string; prompt: string } {
  const spec = stageMailSpec(stage);
  const who = String(handle || "").trim();
  return {
    label: spec.chip,
    prompt: who ? `${spec.prompt} @${who}` : spec.prompt,
  };
}

export function composeGapHint(
  facts: { kind: StageMailKind; amount_usd?: number | null; tracking?: string | null; items?: string[] },
  handle = "",
): ComposeGap {
  const spec = stageMailSpecByKind(facts.kind);
  const who = String(handle || "").trim();
  const at = who ? ` @${who}` : "";
  const items = (facts.items || []).join(" ");
  if (facts.kind === "quote" && facts.amount_usd == null) {
    return {
      field: "amount",
      label: "补上金额",
      placeholder: `${spec.prompt}${at} 金额 [USD]`,
      prompt: "把金额改成 [USD]",
      result_action: "补上金额后再确认发送",
    };
  }
  if (facts.kind === "ship" && !facts.tracking) {
    return {
      field: "tracking",
      label: "补上运单号",
      placeholder: `${spec.prompt}${at} 运单号 [运单号]`,
      prompt: "把运单号改成 [运单号]",
      result_action: "补上运单号后再确认发送",
    };
  }
  if (facts.kind === "address" && /寄样资料未齐/.test(items)) {
    return {
      field: "address",
      label: "补全寄样资料",
      placeholder: `${spec.prompt}${at}`,
      prompt: who ? `${spec.prompt} @${who}` : spec.prompt,
      result_action: "补全寄样资料后再确认发送",
    };
  }
  return {
    field: null,
    label: spec.chip,
    placeholder: who ? `${spec.prompt} @${who}` : spec.prompt,
    prompt: who ? `${spec.prompt} @${who}` : spec.prompt,
    result_action: "核对预览后回复「确认发送」",
  };
}
