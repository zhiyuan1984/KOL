import { createHash } from "node:crypto";
import { fieldLabel } from "../labels.js";
import type { TaskDefinition, TaskInputField } from "./registry.js";

/** One Skill, one interaction template, one content version. No second editable SOP. */
export type SkillTemplate = {
  id: string;
  kind: "skill_template";
  skill_id: string;
  version: string;
  title: string;
  description: string;
  steps: string[];
  inputs: TaskInputField[];
  starter: string;
  output: { type: string; title: string };
  constraints: string[];
  evidence: string[];
  decisions: string[];
  recovery: string[];
  source: "skill";
  read_only: true;
};

export function skillTemplate(definition: TaskDefinition, runtimeRevision?: string): SkillTemplate {
  const inputs = definition.input_schema || definition.required_inputs.map((key): TaskInputField => ({
    key, label: fieldLabel(key), kind: "text", required: true,
  }));
  const required = inputs.filter((field) => field.required && field.default === undefined);
  const content = {
    id: `skill-template:${definition.id}`,
    kind: "skill_template" as const,
    skill_id: definition.id,
    title: definition.title,
    description: definition.interaction?.purpose || definition.employee_summary || definition.description,
    // Legacy skills remain readable but do not invent execution steps.
    steps: definition.interaction?.steps || [],
    inputs,
    // SKILL.md 手写的 starter 优先（作者措辞即契约）；没写才按必填字段生成占位格式。
    starter: definition.starter?.trim() || [definition.title, ...required.map((field) => `${field.label}：[${field.label}]`)].join("\n"),
    output: { type: definition.result_type || definition.output, title: definition.interaction?.output_title || "任务结果" },
    constraints: definition.interaction?.constraints || [],
    evidence: definition.interaction?.evidence || [],
    decisions: definition.interaction?.decisions || [],
    recovery: definition.interaction?.recovery || [],
    source: "skill" as const,
    read_only: true as const,
  };
  const baseVersion = definition.content_version || createHash("sha256").update(JSON.stringify(content)).digest("hex");
  return { ...content, version: runtimeRevision
    ? createHash("sha256").update(`${baseVersion}\n${runtimeRevision}`).digest("hex") : baseVersion };
}

/** Ignore arbitrary user objects masquerading as published templates. */
export function isSkillTemplateSnapshot(value: unknown, skillId: string): value is SkillTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as SkillTemplate;
  return row.kind === "skill_template" && row.id === `skill-template:${skillId}` && row.skill_id === skillId
    && typeof row.version === "string" && /^[a-f0-9]{64}$/.test(row.version)
    && typeof row.title === "string" && typeof row.description === "string"
    && Array.isArray(row.steps) && Array.isArray(row.inputs) && typeof row.starter === "string"
    && Boolean(row.output) && row.read_only === true && row.source === "skill";
}
