/**
 * Overseas AI发现 crawl keywords.
 *
 * YouTube / Instagram / Facebook search needs usable English terms.
 * Employee `request.keywords` and plan copy stay as submitted (often Chinese).
 * Region chips become soft EN hints only — MediaCrawler has no geo filter.
 */

export const OVERSEAS_NICHE_MAP: ReadonlyArray<{ zh: string; en: readonly string[] }> = [
  { zh: "户外电源", en: ["portable power station"] },
  { zh: "户外露营", en: ["camping outdoors"] },
  { zh: "装备评测", en: ["gear review"] },
  { zh: "房车旅行", en: ["van life", "RV travel"] },
  { zh: "房车露营", en: ["van life", "RV camping"] },
  { zh: "徒步旅行", en: ["hiking"] },
  { zh: "家庭旅行", en: ["family travel"] },
  { zh: "户外评测", en: ["outdoor review"] },
  { zh: "太阳能", en: ["solar power"] },
  { zh: "储能", en: ["energy storage"] },
  { zh: "露营", en: ["camping"] },
];

export const DISCOVERY_FILLERS = [
  "寻找",
  "尋找",
  "找一下",
  "找",
  "达人",
  "達人",
  "网红",
  "網紅",
  "博主",
  "KOL",
  "kol",
  "请",
  "請",
  "一下",
] as const;

export const REGION_SEARCH_HINTS: Record<string, string> = {
  us: "USA",
  ca: "Canada",
  eu: "Europe",
  au: "Australia",
  na: "North America",
  sea: "Southeast Asia",
};

const REGION_WORDS = [
  "北美",
  "美国",
  "美國",
  "加拿大",
  "欧洲",
  "歐洲",
  "澳洲",
  "澳大利亚",
  "澳大利亞",
  "东南亚",
  "東南亞",
];

const NICHES_LONGEST_FIRST = [...OVERSEAS_NICHE_MAP].sort((a, b) => b.zh.length - a.zh.length);
const FILLERS_LONGEST_FIRST = [...DISCOVERY_FILLERS].sort((a, b) => b.length - a.length);
const REGION_HINT_VALUES = new Set(Object.values(REGION_SEARCH_HINTS));

function cjkCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) || []).length;
}

function letterCount(text: string): number {
  return (text.match(/[A-Za-z]/g) || []).length;
}

export function isPrimarilyCjk(text: string): boolean {
  const cjk = cjkCount(text);
  return cjk > 0 && cjk >= letterCount(text);
}

function uniquePush(out: string[], seen: Set<string>, value: string): void {
  const text = String(value || "").trim();
  if (!text) return;
  const key = text.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(text);
}

export function stripDiscoveryFillers(text: string): string {
  let out = String(text || "");
  for (const filler of FILLERS_LONGEST_FIRST) {
    out = out.split(filler).join("");
  }
  return out.replace(/\s+/g, " ").trim();
}

function stripRegionWords(text: string): string {
  let out = text;
  for (const word of REGION_WORDS) {
    out = out.split(word).join("");
  }
  return out.replace(/[的了与和及]/g, "").replace(/\s+/g, " ").trim();
}

function expandOne(token: string): string[] {
  const raw = String(token || "").trim();
  if (!raw) return [];
  const exact = OVERSEAS_NICHE_MAP.find((item) => item.zh === raw);
  if (exact) return [...exact.en];

  if (!isPrimarilyCjk(raw)) return [raw];

  const stripped = stripDiscoveryFillers(raw);
  if (!stripped) return [];

  const exactAfter = OVERSEAS_NICHE_MAP.find((item) => item.zh === stripped);
  if (exactAfter) return [...exactAfter.en];

  const expansions: string[] = [];
  let remainder = stripped;
  for (const niche of NICHES_LONGEST_FIRST) {
    if (!remainder.includes(niche.zh)) continue;
    expansions.push(...niche.en);
    remainder = remainder.split(niche.zh).join("");
  }
  remainder = stripRegionWords(stripDiscoveryFillers(remainder));
  if (expansions.length) return expansions;
  if (remainder && !isPrimarilyCjk(remainder)) return [remainder];
  return [];
}

export function expandOverseasSearchKeywords(input: {
  keywords?: readonly string[];
  directions?: readonly string[];
  region?: string;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...(input.directions || []), ...(input.keywords || [])]) {
    for (const part of expandOne(item)) uniquePush(out, seen, part);
  }
  const region = String(input.region || "all").trim().toLowerCase();
  if (region && region !== "all" && REGION_SEARCH_HINTS[region]) {
    uniquePush(out, seen, REGION_SEARCH_HINTS[region]);
  }
  if (out.length) return out;
  for (const item of [...(input.keywords || []), ...(input.directions || [])]) {
    uniquePush(out, seen, String(item || "").trim());
  }
  return out;
}

/** Employee empty-result copy. Search terms only — no collector / job jargon. */
export function emptyDiscoveryHint(searchKeywords: readonly string[]): string {
  const shown = searchKeywords.map((item) => String(item || "").trim()).filter(Boolean);
  if (!shown.length) return "这次计划没有找到红人线索，可换关键词再试。";
  const product = shown.filter((item) => !REGION_HINT_VALUES.has(item));
  const label = (product.length ? product : shown).slice(0, 2).join(" / ");
  return `按「${label}」没有找到线索，可换词再试。`;
}
