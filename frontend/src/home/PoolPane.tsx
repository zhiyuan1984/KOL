import type { PoolKol } from "./kolContract";
import { KOL_SELECT_MAX } from "./kolContract";

function formatIngested(value?: string | null): string {
  if (!value) return "入库时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "入库时间未知";
  return `入库 ${date.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" })}`;
}

function PoolKolCard({
  card,
  selected,
  hovered,
  claimBusy,
  onHover,
  onToggleSelect,
  onClaim,
}: {
  card: PoolKol;
  selected: boolean;
  hovered: boolean;
  claimBusy?: boolean;
  onHover: (on: boolean) => void;
  onToggleSelect: (on: boolean) => void;
  onClaim: () => void;
}) {
  const initial = card.identity.display.replace(/^@/, "").slice(0, 1) || "红";
  const chips = [
    card.identity.platform ? { id: "platform", label: card.identity.platform } : null,
    card.direction ? { id: "direction", label: card.direction } : null,
    card.region ? { id: "region", label: card.region } : null,
    card.style ? { id: "style", label: card.style } : null,
    card.idle?.label ? { id: "idle", label: card.idle.label } : null,
  ].filter(Boolean) as { id: string; label: string }[];
  const metrics = [
    card.metrics.followers ? `粉丝 ${card.metrics.followers}` : "",
    card.metrics.avg_plays ? `均播 ${card.metrics.avg_plays}` : "",
    card.metrics.engagement ? `互动 ${card.metrics.engagement}` : "",
  ].filter(Boolean);

  return (
    <article
      className={"followed-kol-card pool-kol-card" + (hovered ? " is-hovered" : "")}
      data-pool-kol={card.kol_uid}
      data-kol-work-card
      data-pool-card
      data-selected={selected ? "true" : undefined}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="kol-band kol-band-identity" data-kol-band="identity">
        <label className="followed-kol-select" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            data-pool-select={card.kol_uid}
            checked={selected}
            onChange={(event) => onToggleSelect(event.target.checked)}
          />
          <span className="sr-only">选择 {card.identity.display}</span>
        </label>
        <span className="kol-avatar" data-kol-avatar aria-hidden>{initial}</span>
        <div className="kol-identity-main">
          <div className="kol-identity-line">
            <strong className="kol-name" data-kol-identity data-kol-name>{card.identity.display}</strong>
            <span className="kol-stage-badge" data-public-stage data-stage-code={card.public_stage?.code || undefined}>
              <span className="kol-stage" data-stage-label>{card.public_stage?.label || "公海"}</span>
            </span>
          </div>
          {chips.length ? (
            <span className="kol-chip-row" data-kol-scope>
              {chips.map((chip) => (
                <span key={chip.id + chip.label} className="kol-chip" data-kol-chip={chip.id} title={chip.label}>
                  {chip.label}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>

      <div className="kol-split" data-kol-split>
        <div className="kol-band kol-band-fact" data-kol-band="fact">
          <div className="kol-state-block" data-pool-public-fields>
            <p className="kol-split-kicker"><span className="kol-split-icon" aria-hidden>◎</span>公开资料</p>
            <p className="kol-mail-digest" data-pool-metrics>
              {metrics.join(" · ") || "暂无公开数据"}
            </p>
            <p className="kol-mail-meta" data-pool-ingested>{formatIngested(card.ingested_at)}</p>
            {card.identity.profile_url ? (
              <p className="kol-mail-meta">
                <a href={card.identity.profile_url} target="_blank" rel="noopener noreferrer" data-pool-profile-link>
                  平台主页
                </a>
              </p>
            ) : null}
          </div>
        </div>
        <div className="kol-band kol-band-recommend" data-kol-band="action">
          <div className="kol-state-block">
            <p className="kol-split-kicker"><span className="kol-split-icon" aria-hidden>✦</span>建联</p>
            <p className="kol-suggestion">领取后进入我的跟进，不等于发信或改阶段。</p>
          </div>
          <div className="kol-band kol-band-actions" data-kol-band="cta">
            <div className="kol-cta-primary">
              <button
                type="button"
                className="btn ghost sm kol-cta-btn kol-cta-work"
                data-pool-claim
                data-home-entry="claim-kol"
                disabled={claimBusy}
                onClick={onClaim}
              >
                {claimBusy ? "正在领取…" : "领取跟进"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function PoolPane({
  cards,
  selectedIds,
  hoveredId,
  query,
  queryDown,
  claimBusyId,
  onQuery,
  onHover,
  onToggleSelect,
  onToggleSelectAll,
  onAnalyzeSelected,
  onClaim,
}: {
  cards: PoolKol[];
  selectedIds: string[];
  hoveredId: string | null;
  query: string;
  queryDown?: boolean;
  claimBusyId?: string | null;
  onQuery: (value: string) => void;
  onHover: (id: string | null) => void;
  onToggleSelect: (id: string, on: boolean) => void;
  onToggleSelectAll: (on: boolean) => void;
  onAnalyzeSelected: () => void;
  onClaim: (card: PoolKol) => void;
}) {
  const selecting = selectedIds.length > 0;
  const visible = cards.filter((card) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [
      card.identity.display,
      card.identity.platform,
      card.direction,
      card.region,
      card.style,
      card.public_stage?.label,
    ].join(" ").toLowerCase().includes(needle);
  });

  return (
    <section className="home-mode-pane recommend-work followed-kol-pane" data-home-pane="pool" data-pool-overview>
      <div className="followed-kol-column" data-pool-column>
        <div className="followed-object-toolbar" data-pool-toolbar data-home-entry="list-pool">
          <label className="followed-object-search">
            <span className="sr-only">搜索公海对象</span>
            <input
              type="search"
              data-pool-search
              value={query}
              placeholder="搜索公海对象"
              onChange={(event) => onQuery(event.target.value)}
            />
          </label>
          <p className="followed-object-count" data-pool-selected-count>
            {selecting ? `已选 ${selectedIds.length} / ${KOL_SELECT_MAX}` : `${visible.length} 人`}
          </p>
          <label className="followed-select-all">
            <input
              type="checkbox"
              data-pool-select-all
              checked={visible.length > 0 && visible.every((card) => selectedIds.includes(card.kol_uid))}
              disabled={!visible.length}
              onChange={(event) => onToggleSelectAll(event.target.checked)}
            />
            <span className="sr-only">全选公海对象</span>
          </label>
          <button
            type="button"
            className={selecting ? "btn work sm" : "btn ghost sm"}
            data-analyze-selected
            data-home-entry="kol-analyze-enqueue"
            disabled={!selecting}
            onClick={onAnalyzeSelected}
          >
            分析已选
          </button>
        </div>

        {visible.length ? (
          <div className="followed-kol-list" data-pool-list data-pool-origin="public">
            {visible.map((card) => (
              <PoolKolCard
                key={card.kol_uid}
                card={card}
                selected={selectedIds.includes(card.kol_uid)}
                hovered={hoveredId === card.kol_uid}
                claimBusy={claimBusyId === card.kol_uid}
                onHover={(on) => onHover(on ? card.kol_uid : null)}
                onToggleSelect={(on) => onToggleSelect(card.kol_uid, on)}
                onClaim={() => onClaim(card)}
              />
            ))}
          </div>
        ) : (
          <div
            className="task-empty"
            data-pool-empty={queryDown ? "down" : cards.length ? "filtered" : "none"}
            data-empty-kind={queryDown ? "service-down" : cards.length ? "filter-empty" : "no-data"}
          >
            <strong>{queryDown ? "公海暂时不可用" : cards.length ? "没有匹配的公海对象" : "公海还没有可领取的红人"}</strong>
            <p>
              {queryDown
                ? "记忆查询失败，没有写入会话。可重试或交给 Agent 分析。"
                : "公海只展示公开资料，不是跟进 Tab 的筛选。领取是建联，不等于发信或改阶段。"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
