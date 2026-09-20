import { useEffect, useState } from "react";
import {
  keywordsForDirections,
  MAX_DISCOVERY_DIRECTIONS,
  OVERSEAS_DISCOVERY_PLATFORMS,
  DISCOVERY_REGION_OPTIONS,
  DISCOVERY_DIRECTION_PACKS,
  toggleDirection,
  type DiscoveryBrief,
  type DiscoveryDirectionCode,
  type DiscoveryPlatformCode,
  type DiscoveryTemplate,
} from "./discoveryTemplate";
import { clampCountInput } from "./discoveryBriefForm";

type Catalog = Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null | undefined;

// 平台图标：本地内联 SVG（仓库无 icon 库），画法沿用 Home 里 ChromeIco。
const PLATFORM_ICON_PATHS: Record<string, string> = {
  youtube: "M10 8.6l6 3.4-6 3.4z M21 12c0 2.4-.3 4-.6 4.7a1.8 1.8 0 0 1-1.3 1.2c-1.2.3-7.1.3-7.1.3s-5.9 0-7.1-.3a1.8 1.8 0 0 1-1.3-1.2C3.3 16 3 14.4 3 12s.3-4 .6-4.7a1.8 1.8 0 0 1 1.3-1.2C6.1 5.8 12 5.8 12 5.8s5.9 0 7.1.3a1.8 1.8 0 0 1 1.3 1.2C20.7 8 21 9.6 21 12z",
  instagram: "M7.6 3.8h8.8a3.8 3.8 0 0 1 3.8 3.8v8.8a3.8 3.8 0 0 1-3.8 3.8H7.6a3.8 3.8 0 0 1-3.8-3.8V7.6a3.8 3.8 0 0 1 3.8-3.8z M12 8.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z M17.1 7h.01",
  facebook: "M14.6 8.6H16V5.7h-2.4c-2.1 0-3.5 1.4-3.5 3.5v1.4H8.4v2.9h1.7v5.8h3v-5.8h2.2l.5-2.9h-2.7V9.6c0-.6.3-1 1-1z",
};

function PlatformIco({ code }: { code: string }) {
  const path = PLATFORM_ICON_PATHS[code];
  if (!path) return null;
  return (
    <svg className="discovery-platform-ico" viewBox="0 0 24 24" aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function parseKeywords(text: string): string[] {
  return text.split(/[,，、]/).map((word) => word.trim()).filter(Boolean);
}

function sameKeywords(text: string, words: string[]): boolean {
  return parseKeywords(text).join("\u0000") === words.join("\u0000");
}

export default function DiscoverySearchCard({
  brief,
  catalog,
  onChange,
}: {
  brief: DiscoveryBrief;
  catalog?: Catalog;
  onChange: (brief: DiscoveryBrief) => void;
}) {
  // 关键词是自由文本：本地保留输入串，方向芯片改了关键词时再同步回来。
  const [keywordText, setKeywordText] = useState(() => brief.keywords.join(", "));
  useEffect(() => {
    setKeywordText((current) => (sameKeywords(current, brief.keywords) ? current : brief.keywords.join(", ")));
  }, [brief.keywords]);

  const platforms = catalog?.platforms?.length ? catalog.platforms : OVERSEAS_DISCOVERY_PLATFORMS;
  const regions = catalog?.regions?.length ? catalog.regions : DISCOVERY_REGION_OPTIONS;
  const directions = catalog?.directions?.length ? catalog.directions : DISCOVERY_DIRECTION_PACKS;

  // 平台单选（决策 D2）：点已选平台取消选择。
  const selectPlatform = (code: DiscoveryPlatformCode) => {
    onChange({ ...brief, platforms: brief.platforms[0] === code ? [] : [code] });
  };
  const pickDirection = (code: DiscoveryDirectionCode) => {
    const { directions: next } = toggleDirection(brief.directions, code);
    // 方向变则派生关键词；用户之后手改的关键词以输入框为准（ADR-019）。
    onChange({ ...brief, directions: next, keywords: keywordsForDirections(next, directions) });
  };
  const patch = (next: Partial<DiscoveryBrief>) => onChange({ ...brief, ...next });
  const atMax = brief.directions.length >= MAX_DISCOVERY_DIRECTIONS;

  return (
    <section className="ai-discovery-card" data-discovery-search-card>
      <header className="ai-discovery-head">
        <h2>红人检索</h2>
        <p>设置检索条件，快速发现符合要求的红人。</p>
      </header>

      <section className="ai-discovery-section" data-discovery-section="basics">
        <h3>基础筛选</h3>
        <div className="ai-discovery-rows">
        <div className="ai-discovery-row" data-discovery-filter="platform">
          <span className="ai-discovery-label">平台</span>
          <div className="ai-discovery-chips">
            {platforms.map((option) => (
              <button
                key={option.code}
                type="button"
                className="discovery-chip"
                data-discovery-chip={option.code}
                aria-pressed={brief.platforms.includes(option.code)}
                onClick={() => selectPlatform(option.code as DiscoveryPlatformCode)}
              >
                <PlatformIco code={option.code} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ai-discovery-row" data-discovery-filter="region">
          <span className="ai-discovery-label">地区</span>
          <div className="ai-discovery-chips">
            {regions.map((option) => (
              <button
                key={option.code}
                type="button"
                className="discovery-chip"
                data-discovery-chip={option.code}
                aria-pressed={brief.region === option.code}
                onClick={() => patch({ region: option.code as DiscoveryBrief["region"] })}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ai-discovery-row" data-discovery-filter="directions">
          <span className="ai-discovery-label">方向</span>
          <div className="ai-discovery-chips">
            {directions.map((option) => {
              const pressed = brief.directions.includes(option.code as DiscoveryDirectionCode);
              return (
                <button
                  key={option.code}
                  type="button"
                  className="discovery-chip"
                  data-discovery-chip={option.code}
                  data-discovery-preset={option.code}
                  aria-pressed={pressed}
                  disabled={atMax && !pressed}
                  onClick={() => pickDirection(option.code as DiscoveryDirectionCode)}
                >
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
          {atMax ? <span className="discovery-direction-limit">最多添加 {MAX_DISCOVERY_DIRECTIONS} 个方向</span> : null}
        </div>
        </div>
      </section>

      <section className="ai-discovery-section" data-discovery-section="scale">
        <h3>内容与账号规模</h3>
        <div className="ai-discovery-rows">
        <div className="ai-discovery-row" data-discovery-keys>
          <label className="ai-discovery-label" htmlFor="ai-discovery-keywords">关键词</label>
          <input
            id="ai-discovery-keywords"
            className="ai-discovery-input"
            data-discovery-keywords
            value={keywordText}
            placeholder="camping, portable power station"
            onChange={(event) => {
              // 中间态（例如刚敲完逗号）留在本地，只有解析得出词时才写回 brief，
              // 否则 join/split 往返会把分隔符吃掉，导致逗号根本打不进去。
              const raw = event.target.value;
              setKeywordText(raw);
              const parsed = parseKeywords(raw);
              if (parsed.length) patch({ keywords: parsed });
            }}
            onBlur={() => {
              const parsed = parseKeywords(keywordText);
              patch({ keywords: parsed });
              setKeywordText(parsed.join(", "));
            }}
          />
        </div>

        <div className="ai-discovery-row" data-discovery-followers>
          <span className="ai-discovery-label">粉丝数</span>
          <div className="ai-discovery-inline">
            <input
              className="ai-discovery-input is-number"
              data-discovery-min-followers
              inputMode="numeric"
              value={String(brief.min_followers)}
              placeholder="最小值"
              onChange={(event) => patch({ min_followers: clampCountInput(event.target.value, brief.min_followers) })}
            />
            <span className="ai-discovery-dash">—</span>
            <input
              className="ai-discovery-input is-number"
              data-discovery-max-followers
              inputMode="numeric"
              value={String(brief.max_followers)}
              placeholder="最大值"
              onChange={(event) => patch({ max_followers: clampCountInput(event.target.value, brief.max_followers) })}
            />
          </div>
        </div>

        </div>
      </section>

      <section className="ai-discovery-section" data-discovery-section="effect">
        <h3>内容效果</h3>
        <div className="ai-discovery-rows is-pair">
        <div className="ai-discovery-row" data-discovery-plays>
          <span className="ai-discovery-label">近10条均播</span>
          <div className="ai-discovery-inline">
            <span className="ai-discovery-op">≥</span>
            <input
              className="ai-discovery-input is-number"
              data-discovery-min-plays
              inputMode="numeric"
              value={String(brief.min_avg_plays_10)}
              onChange={(event) => patch({ min_avg_plays_10: clampCountInput(event.target.value, brief.min_avg_plays_10) })}
            />
          </div>
        </div>

        <div className="ai-discovery-row" data-discovery-count>
          <span className="ai-discovery-label">期望人数</span>
          <input
            className="ai-discovery-input is-number"
            data-discovery-expect-count
            inputMode="numeric"
            value={String(brief.expect_count)}
            onChange={(event) => patch({ expect_count: clampCountInput(event.target.value, brief.expect_count) })}
          />
        </div>
        </div>
      </section>
    </section>
  );
}
