import type { SkillTemplate, TaskInputField } from "./api";
import type { ComposerDraftStash } from "./composer/types";

/** Short, honest hint for templates whose contract has no required fields. */
export const NO_REQUIRED_INPUTS_COPY = "无需必填参数，可直接提交；可选条件按需填写。";

type SkillTemplateCarrier = {
  id: string;
  ui_template?: SkillTemplate | null;
};

/** Inline DTO on the authorized skill is authoritative over the list projection. */
export function templateForSkill(
  skill: SkillTemplateCarrier | null | undefined,
  templates: SkillTemplate[] = [],
): SkillTemplate | null {
  if (!skill?.id) return null;
  if (skill.ui_template?.skill_id === skill.id) return skill.ui_template;
  return templates.find((template) => template.skill_id === skill.id) || null;
}

/**
 * A template starter is an input contract, never its long-form explanation.
 * Backend normally supplies `starter`; the fallback only lists fields that are
 * both required and have no default so legacy templates stay usable.
 */
export function templateStarter(template: SkillTemplate): string {
  const configured = String(template.starter || "").trim();
  if (configured) return configured;
  const required = template.inputs.filter((field) => field.required && field.default === undefined);
  if (!required.length) return template.title;
  return [template.title, ...required.map((field) => `${field.label}：[${field.label}]`)].join("\n");
}

export function templateInputFields(
  template: SkillTemplate | null | undefined,
  fallback: TaskInputField[] = [],
): TaskInputField[] {
  return template ? template.inputs : fallback;
}

/** Keep natural-language extraction authoritative when an optional field is blank. */
export function nonEmptyTemplateEntities(
  fields: TaskInputField[],
  values: Record<string, unknown>,
  touchedKeys?: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => {
    // Defaults are hints for the server, not explicit employee input. When a
    // form tracks touches, omit untouched defaults so natural-language
    // extraction remains authoritative for the same field.
    if (touchedKeys && !touchedKeys.has(field.key)) return [];
    const value = values[field.key];
    if (value === undefined || value === null || value === "") return [];
    if (Array.isArray(value) && value.length === 0) return [];
    return [[field.key, value]];
  }));
}

export function defaultTemplateValues(fields: TaskInputField[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => (
    field.default === undefined || field.default === null ? [] : [[field.key, field.default]]
  )));
}

/** A published template can only open an editable question draft from the library. */
export function templateQuestionDraft(template: SkillTemplate): ComposerDraftStash {
  return {
    text: templateStarter(template),
    chips: [{ kind: "skill", id: template.skill_id, label: template.title }],
    skill_template: template,
  };
}
