import { useEffect, useState } from "react";
import type { DiscoveryOption } from "../discoveryTemplate";

export type SkillParamField = {
  key: string;
  label: string;
  kind: "single" | "multiple" | "text" | "number" | "date" | "object";
  required?: boolean;
  options_source?: string;
  options?: Array<string | { code: string; label: string }>;
  prefill?: string;
  reason?: string;
  min?: number;
  max?: number;
  default?: unknown;
};

export type SkillParamValues = Record<string, unknown>;
type ParamOptions = Record<string, DiscoveryOption[]>;
const EMPTY_TOKEN_FIELDS: string[] = [];

function sourceKey(field: SkillParamField): string {
  return field.options_source?.split("#").pop() || "";
}

function displayValue(field: SkillParamField, value: unknown, options: DiscoveryOption[]): string {
  if (field.kind === "object" && value && typeof value === "object") return JSON.stringify(value);
  const values = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
  return values.filter(Boolean).map((code) => options.find((option) => option.code === code)?.label || code).join("、") || "未填写";
}

/** Schema-driven control renderer shared by mode conditions, clarification and read-only summaries. */
export default function SkillParamCard({
  fields,
  values,
  optionSets = {},
  tokenFields = EMPTY_TOKEN_FIELDS,
  mode = "edit",
  errors = {},
  title,
  hideTitle = false,
  compactDiscoveryLayout = false,
  onFieldChange,
}: {
  fields: SkillParamField[];
  values: SkillParamValues;
  optionSets?: ParamOptions;
  tokenFields?: string[];
  mode?: "edit" | "needs_input" | "ready";
  errors?: Record<string, string>;
  title?: string;
  hideTitle?: boolean;
  /** Keep the discovery thresholds compact without changing their API field names. */
  compactDiscoveryLayout?: boolean;
  onFieldChange?: (key: string, value: unknown) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    tokenFields.map((key) => [key, Array.isArray(values[key]) ? (values[key] as unknown[]).join(", ") : String(values[key] || "")]),
  ));
  const [objectDrafts, setObjectDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const key of tokenFields) {
        const normalized = (Array.isArray(values[key]) ? values[key] as unknown[] : []).map(String);
        const draftTokens = String(current[key] || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
        if (draftTokens.join("\u0000") !== normalized.join("\u0000")) next[key] = normalized.join(", ");
      }
      return next;
    });
  }, [tokenFields, values]);

  const optionsFor = (field: SkillParamField) => {
    const key = sourceKey(field);
    if (Object.prototype.hasOwnProperty.call(optionSets, key) && Array.isArray(optionSets[key])) return optionSets[key];
    return (field.options || []).map((option) => typeof option === "string"
      ? { code: option, label: option }
      : { code: option.code, label: option.label });
  };
  const renderField = (field: SkillParamField) => {
    const value = values[field.key];
    const options = optionsFor(field);
    const invalid = Boolean(errors[field.key]);
    if (mode === "ready") return <output className="skill-param-readonly">{displayValue(field, value, options)}</output>;
    if (field.kind === "single" || field.kind === "multiple") {
      if (!options.length) return <span className="skill-param-error" role="status">{field.options_source ? "选项暂不可用，请稍后重试。" : "该字段尚未配置可用选项。"}</span>;
      const selected = field.kind === "multiple" ? (Array.isArray(value) ? value.map(String) : []) : [String(value || "")];
      return <div className="ai-discovery-chips" role={field.kind === "multiple" ? "group" : "radiogroup"} aria-label={field.label}>
        {options.map((option) => {
          const pressed = selected.includes(option.code);
          const maxed = field.max != null && selected.length >= field.max;
          return <button key={option.code} type="button" className="discovery-chip"
            data-discovery-chip={option.code} data-discovery-preset={field.key === "directions" ? option.code : undefined}
            aria-pressed={pressed} disabled={maxed && !pressed}
            onClick={() => onFieldChange?.(field.key, field.kind === "multiple"
              ? (pressed ? selected.filter((item) => item !== option.code) : [...selected, option.code])
              : (pressed ? "" : option.code))}>{option.label}</button>;
        })}
      </div>;
    }
    if (field.kind === "object") {
      const objectText = objectDrafts[field.key] ?? (value && typeof value === "object" ? JSON.stringify(value, null, 2) : "{}");
      return <textarea className="ai-discovery-input" aria-label={field.label} aria-invalid={invalid} value={objectText}
        onChange={(event) => {
          const next = event.target.value;
          setObjectDrafts((current) => ({ ...current, [field.key]: next }));
          try {
            const parsed = JSON.parse(next);
            onFieldChange?.(field.key, parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : next);
          } catch {
            onFieldChange?.(field.key, next);
          }
        }} />;
    }
    if (field.kind === "text") {
      const tokenized = tokenFields.includes(field.key);
      const draft = tokenized ? drafts[field.key] || "" : String(value || "");
      return <input className="ai-discovery-input" aria-label={field.label} aria-invalid={invalid}
        data-discovery-keywords={field.key === "keywords" ? true : undefined} value={draft}
        onChange={(event) => {
          const next = event.target.value;
          if (!tokenized) return onFieldChange?.(field.key, next);
          setDrafts((current) => ({ ...current, [field.key]: next }));
          const words = next.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
          if (words.length) onFieldChange?.(field.key, words);
        }}
        onBlur={tokenized ? () => {
          const words = (drafts[field.key] || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
          onFieldChange?.(field.key, words);
          setDrafts((current) => ({ ...current, [field.key]: words.join(", ") }));
        } : undefined} />;
    }
    if (field.kind === "number") {
      const numberText = String(value ?? "");
      const formattedNumber = compactDiscoveryLayout && numberText !== ""
        ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(numberText))
        : numberText;
      return <input className="ai-discovery-input is-number" type={compactDiscoveryLayout ? "text" : "number"} inputMode="numeric"
      aria-label={field.label} aria-invalid={invalid}
      {...(field.key === "min_followers" ? { "data-discovery-min-followers": true }
        : field.key === "max_followers" ? { "data-discovery-max-followers": true }
        : field.key === "min_avg_plays_10" ? { "data-discovery-min-plays": true }
          : field.key === "expect_count" ? { "data-discovery-expect-count": true } : {})}
      {...(compactDiscoveryLayout ? { pattern: "[0-9,]*" } : { min: field.min, max: field.max })}
      value={formattedNumber}
      onChange={(event) => {
        const next = compactDiscoveryLayout ? event.target.value.replace(/[^0-9]/g, "") : event.target.value;
        const number = next === "" ? undefined : Number(next);
        onFieldChange?.(field.key, number === undefined || Number.isFinite(number) ? number : next);
      }} />;
    }
    return <input className="ai-discovery-input" type="date" aria-label={field.label} aria-invalid={invalid}
      value={String(value || "")} onChange={(event) => onFieldChange?.(field.key, event.target.value)} />;
  };

  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const renderedCompactKeys = new Set(["min_followers", "max_followers", "min_avg_plays_10", "expect_count"]);
  const renderRow = (field: SkillParamField) => <div className="ai-discovery-row" key={field.key} data-skill-param={field.key}>
    <span className="ai-discovery-label">{field.label}{field.required ? " *" : ""}</span>
    <div className="ai-discovery-param-value">
      {renderField(field)}
      {mode !== "ready" && field.reason ? <span className="skill-param-reason">{field.reason}</span> : null}
      {errors[field.key] ? <span className="skill-param-error" role="alert">{errors[field.key]}</span> : null}
      {field.key === "directions" && field.max != null && Array.isArray(values[field.key]) && (values[field.key] as unknown[]).length >= field.max
        ? <span className="discovery-direction-limit">最多添加 {field.max} 个方向</span> : null}
    </div>
  </div>;
  const minFollowers = fieldsByKey.get("min_followers");
  const maxFollowers = fieldsByKey.get("max_followers");
  const minPlays = fieldsByKey.get("min_avg_plays_10");
  const expectCount = fieldsByKey.get("expect_count");
  const hasCompactThresholds = compactDiscoveryLayout && mode !== "ready"
    && Boolean(minFollowers && maxFollowers && minPlays && expectCount);
  return <section className="ai-discovery-card" data-discovery-search-card data-skill-param-card data-param-mode={mode}>
    {!hideTitle ? <header className="ai-discovery-head"><h2>{title || (mode === "ready" ? "已确认参数" : mode === "needs_input" ? "补充必要信息" : "任务参数")}</h2></header> : null}
    <div className="ai-discovery-rows">
      {fields.filter((field) => !hasCompactThresholds || !renderedCompactKeys.has(field.key)).map(renderRow)}
      {hasCompactThresholds && minFollowers && maxFollowers ? <div className="ai-discovery-row is-follower-range" data-skill-param-group="followers_range" role="group" aria-label="粉丝数范围">
        <span className="ai-discovery-label">粉丝数范围</span>
        <div className="ai-discovery-param-value ai-discovery-range-control" role="group" aria-label="粉丝数范围">
          <div className="ai-discovery-inline-field" data-skill-param="min_followers">
            <span className="sr-only">{minFollowers.label}</span>{renderField(minFollowers)}
          </div>
          <span className="ai-discovery-range-separator" aria-hidden="true">—</span>
          <div className="ai-discovery-inline-field" data-skill-param="max_followers">
            <span className="sr-only">{maxFollowers.label}</span>{renderField(maxFollowers)}
          </div>
        </div>
      </div> : null}
      {hasCompactThresholds && minPlays && expectCount ? <div className="ai-discovery-row is-metric-pair" data-skill-param-group="discovery_metrics">
        <div className="ai-discovery-inline-field" data-skill-param="min_avg_plays_10">
          <span className="ai-discovery-label">{minPlays.label}</span>{renderField(minPlays)}
        </div>
        <div className="ai-discovery-inline-field" data-skill-param="expect_count">
          <span className="ai-discovery-label">{expectCount.label}</span>{renderField(expectCount)}
        </div>
      </div> : null}
    </div>
  </section>;
}
