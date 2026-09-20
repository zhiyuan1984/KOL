import { useEffect, useState } from "react";
import {
  canSubmitDiscovery,
  DISCOVERY_NO_SIDE_EFFECT,
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
import { clampCountInput, discoveryTaskSummaryRows } from "./discoveryBriefForm";

type Catalog = Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null | undefined;

function parseKeywords(text: string): string[] {
  return text.split(/[,，、]/).map((word) => word.trim()).filter(Boolean);
}

function sameKeywords(text: string, words: string[]): boolean {
  return parseKeywords(text).join("\u0000") === words.join("\u0000");
}

export default function DiscoverySearchCard({
  brief,
  catalog,
  busy = false,
  onChange,
  onSubmit,
  onReset,
}: {
  brief: DiscoveryBrief;
  catalog?: Catalog;
  busy?: boolean;
  onChange: (brief: DiscoveryBrief) => void;
  onSubmit: (brief: DiscoveryBrief) => void;
  onReset: () => void;
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
  const ready = canSubmitDiscovery(brief);
  const atMax = brief.directions.length >= MAX_DISCOVERY_DIRECTIONS;

  return (
    <section className="ai-discovery-card" data-discovery-search-card>
      <header className="ai-discovery-head">
        <h2>红人检索</h2>
        <p>设置检索条件，快速发现符合要求的红人。</p>
      </header>

      <div className="ai-discovery-field" data-discovery-filter="platform">
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
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-discovery-field" data-discovery-filter="region">
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
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-discovery-field" data-discovery-filter="directions">
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
                {option.label}
              </button>
            );
          })}
        </div>
        {atMax ? <span className="discovery-direction-limit">最多添加 {MAX_DISCOVERY_DIRECTIONS} 个方向</span> : null}
      </div>

      <hr className="ai-discovery-divider" />

      <div className="ai-discovery-field" data-discovery-keys>
        <label className="ai-discovery-label" htmlFor="ai-discovery-keywords">关键词</label>
        <input
          id="ai-discovery-keywords"
          className="ai-discovery-input"
          data-discovery-keywords
          value={keywordText}
          placeholder="户外露营，户外能源"
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

      <div className="ai-discovery-field" data-discovery-followers>
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

      <div className="ai-discovery-metrics">
        <div className="ai-discovery-field" data-discovery-plays>
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
        <div className="ai-discovery-field" data-discovery-count>
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

      <section className="ai-discovery-summary" data-discovery-summary aria-label="发现任务">
        <h3>发现任务</h3>
        <dl className="ai-discovery-summary-grid">
          {discoveryTaskSummaryRows(brief, catalog).map((row) => (
            <div key={row.key} className={row.wide ? "is-wide" : undefined} data-discovery-summary-row={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="ai-discovery-summary-note">{DISCOVERY_NO_SIDE_EFFECT}</p>
      </section>

      <div className="ai-discovery-actions">
        <button type="button" className="btn ghost" data-discovery-reset onClick={onReset}>
          重置条件
        </button>
        <button
          type="button"
          className="btn work"
          data-discovery-submit
          disabled={!ready || busy}
          onClick={() => onSubmit(brief)}
        >
          开始检索
        </button>
      </div>
    </section>
  );
}
