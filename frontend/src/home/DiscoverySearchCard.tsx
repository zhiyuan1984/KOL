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

export default function DiscoverySearchCard({ brief, catalog, onChange, schema }: {
  brief: DiscoveryBrief;
  catalog?: Catalog;
  onChange: (brief: DiscoveryBrief) => void;
  schema?: SkillParamField[];
}) {
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
  return <div className="discovery-brief-form">
    <section className="discovery-skill-intro" data-discovery-skill-intro aria-label="AI发现技能说明">
      <div className="discovery-skill-intro-head">
        <span className="discovery-skill-kicker">线索智能体 · AI发现技能</span>
        <strong>先填写发现条件，再核对实际采集参数</strong>
      </div>
      <p>我会按你确认的平台和关键词寻找候选，结果会保留来源、采集时间和无法核验的条件。</p>
      <ol>
        <li>填写平台、地区、方向和关键词</li>
        <li>核对粉丝、均播与期望人数</li>
        <li>确认后才开始异步采集</li>
      </ol>
    </section>
    <SkillParamCard fields={schema?.length ? schema : FALLBACK_FIELDS}
      values={brief as unknown as Record<string, unknown>} optionSets={options}
      tokenFields={TOKEN_FIELDS} pristineValues={PRISTINE_DISCOVERY_VALUES}
      hideTitle compactDiscoveryLayout onFieldChange={update} />
  </div>;
}
