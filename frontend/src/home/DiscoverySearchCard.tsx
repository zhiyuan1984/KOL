import { useRef } from "react";
import type { DiscoveryBrief, DiscoveryTemplate } from "./discoveryTemplate";
import {
  defaultDiscoveryBrief,
  DISCOVERY_DIRECTION_PACKS,
  DISCOVERY_REGION_OPTIONS,
  keywordsForDirections,
  MAX_DISCOVERY_DIRECTIONS,
  OVERSEAS_DISCOVERY_PLATFORMS,
} from "./discoveryTemplate";
import SkillParamCard, { type SkillParamField } from "./workspace/SkillParamCard";
import { type KeywordChipFieldHandle } from "./workspace/KeywordChipField";

type Catalog = Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null | undefined;
const TOKEN_FIELDS = ["keywords"];
const PRISTINE_DISCOVERY_VALUES = defaultDiscoveryBrief();

export function mergeDiscoveryKeywords(existing: string[], suggested: string[]): string[] {
  return Array.from(new Set([...existing, ...suggested]));
}

const FALLBACK_FIELDS: SkillParamField[] = [
  { key: "platforms", label: "平台", kind: "multiple", max: 1, options_source: "api:/home/discovery/template#platforms" },
  { key: "region", label: "地区", kind: "single", options_source: "api:/home/discovery/template#regions" },
  { key: "directions", label: "方向", kind: "multiple", max: MAX_DISCOVERY_DIRECTIONS, options_source: "api:/home/discovery/template#directions" },
  { key: "keywords", label: "关键词", kind: "text" },
  { key: "min_followers", label: "粉丝数下限", kind: "number" },
  { key: "max_followers", label: "粉丝数上限", kind: "number" },
  { key: "min_avg_plays_10", label: "近10条均播", kind: "number" },
  { key: "expect_count", label: "期望人数", kind: "number" },
];

export default function DiscoverySearchCard({ brief, catalog, onChange, schema, mode = "edit", submitLabel, submitting = false, onSubmit }: {
  brief: DiscoveryBrief;
  catalog?: Catalog;
  onChange: (brief: DiscoveryBrief) => void;
  schema?: SkillParamField[];
  /** 提交后原位转只读：卡片不消失、数值保留，仅正文不再可编辑。 */
  mode?: "edit" | "ready";
  submitLabel?: string;
  submitting?: boolean;
  /** 传了才渲染卡片底部一行（通用调用方不受影响）。参数是**含未回车草稿**的最新条件，
   *  父方应优先用它提交：flushDraft 的 onChange 与 onSubmit 同一次事件里发生，只读自身 state 会漏掉最后一个词。 */
  onSubmit?: (brief?: DiscoveryBrief) => void;
}) {
  const keywordFieldRef = useRef<KeywordChipFieldHandle | null>(null);
  const options = {
    platforms: catalog?.platforms?.length ? catalog.platforms : OVERSEAS_DISCOVERY_PLATFORMS,
    regions: catalog?.regions?.length ? catalog.regions : DISCOVERY_REGION_OPTIONS,
    directions: catalog?.directions?.length ? catalog.directions : DISCOVERY_DIRECTION_PACKS,
  };
  const update = (key: string, value: unknown) => {
    const next = { ...brief, [key]: value } as DiscoveryBrief;
    // Directions are suggestions; selecting one must not erase employee-entered keywords.
    if (key === "directions") {
      const suggested = keywordsForDirections(value as string[], options.directions);
      const existing = Array.isArray(brief.keywords) ? brief.keywords : [];
      next.keywords = mergeDiscoveryKeywords(existing, suggested);
    }
    onChange(next);
  };
  const submit = () => {
    // 还没回车的草稿也算数：先并进芯片，再把含草稿的条件交给父方提交。
    const flushed = keywordFieldRef.current?.flushDraft();
    const words = flushed ?? (Array.isArray(brief.keywords) ? brief.keywords : []);
    onSubmit?.(words === brief.keywords ? brief : { ...brief, keywords: words });
  };
  return <div className="discovery-brief-form"><SkillParamCard fields={schema?.length ? schema : FALLBACK_FIELDS}
      values={brief as unknown as Record<string, unknown>} optionSets={options}
      tokenFields={TOKEN_FIELDS} pristineValues={PRISTINE_DISCOVERY_VALUES}
      hideTitle compactDiscoveryLayout mode={mode} keywordFieldRef={keywordFieldRef}
      onFieldChange={update}
      footer={onSubmit ? <div className="discovery-card-foot">
        <p className="discovery-card-note" data-discovery-card-note>地区、粉丝与均播用于候选核对，不是远端采集数量限制。</p>
        {mode === "edit" ? <button type="button" className="btn row-action sm" data-discovery-card-submit
          disabled={submitting} aria-busy={submitting || undefined} onClick={submit}>{submitting ? "提交中…" : submitLabel || "提交条件，核对参数"}</button> : null}
      </div> : undefined} />
  </div>;
}
