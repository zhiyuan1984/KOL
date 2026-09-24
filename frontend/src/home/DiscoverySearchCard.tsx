import type { DiscoveryBrief, DiscoveryTemplate } from "./discoveryTemplate";
import {
  DISCOVERY_DIRECTION_PACKS,
  DISCOVERY_REGION_OPTIONS,
  keywordsForDirections,
  MAX_DISCOVERY_DIRECTIONS,
  OVERSEAS_DISCOVERY_PLATFORMS,
} from "./discoveryTemplate";
import SkillParamCard, { type SkillParamField } from "./workspace/SkillParamCard";

type Catalog = Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null | undefined;
const TOKEN_FIELDS = ["keywords"];

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
    if (key === "directions") next.keywords = keywordsForDirections(value as string[], options.directions);
    onChange(next);
  };
  return <div className="discovery-brief-form"><SkillParamCard fields={schema?.length ? schema : FALLBACK_FIELDS}
    values={brief as unknown as Record<string, unknown>} optionSets={options}
    tokenFields={TOKEN_FIELDS} hideTitle compactDiscoveryLayout onFieldChange={update} /></div>;
}
