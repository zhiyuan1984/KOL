import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import FollowedKolWorkCard from "../src/components/FollowedKolWorkCard";
import { TaskTheme } from "../src/tasks/TaskTheme";
import { projectFollowedKolCard, type FollowedKolRecord } from "../src/followedKolCard";
import PoolPane from "../src/home/PoolPane";
import type { PoolKol } from "../src/home/kolContract";
import DiscoveryRuntimeCandidate, { type Candidate } from "../src/home/DiscoveryRuntimeCandidate";
import type { DiscoveryBrief } from "../src/home/discoveryTemplate";
import "../src/styles.css";
import "../src/home/followed.css";
import "../src/home/discovery-results.css";
import "../src/home/antd-visual.css";

/** Same geometric data image is used by all standard cards; it intentionally contains no text. */
const GEOMETRIC_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' fill='%231677ff'/%3E%3Ccircle cx='12' cy='9' r='4' fill='%23f7c873'/%3E%3Cpath d='M3 24c1.5-6 5-8 9-8s7.5 2 9 8' fill='%232f7d73'/%3E%3C/svg%3E";
const BROKEN_AVATAR = "data:image/svg+xml;base64,this-is-not-a-valid-image";
const DISPLAY_NAME = "@北美露营与离网电源超长创作者名称用于换行与截断核验";
const LONG_SUMMARY = "创作者已在邮件中确认希望了解合作方案、样品安排与内容排期；这是一段刻意超过两行的互动摘要，用于验证默认摘要不静默丢失，并可通过展开全文读取全部事实。";
const FIXTURE_TIME = "2026-10-09T01:00:00.000Z";

const brief: DiscoveryBrief = {
  platforms: ["youtube"],
  region: "global_en",
  directions: ["camping"],
  keywords: ["camping", "portable power"],
  min_followers: 10_000,
  max_followers: null,
  min_avg_plays_10: 5_000,
  expect_count: 30,
};

const followedRecord: FollowedKolRecord = {
  id: "fixture-followed",
  handle: DISPLAY_NAME.replace(/^@/, ""),
  kol_uid: "fixture-kol",
  avatar_url: GEOMETRIC_AVATAR,
  platform: "YouTube",
  followers: "20万",
  audience_geo: "北美",
  product: "Explorer 1000",
  stage_code: "contacted",
  stage_label: "已建联",
  suggested_stage_code: "interested",
  suggested_stage: "有兴趣",
  days_in_stage: 3,
  days_since_interaction: 15,
  last_interaction_at: FIXTURE_TIME,
  release_due_at: "2026-10-08T01:00:00.000Z",
  overdue: true,
  // Keep the mail fact but no unread interruption: the real mapper then
  // projects its existing confirm-stage action for the busy/disabled test.
  unread_count: 0,
  mail_threads: [{
    conversation_id: "fixture-thread",
    subject: "合作方案与样品安排",
    unread_count: 0,
    last_snippet: LONG_SUMMARY,
    last_direction: "inbound",
    last_at: FIXTURE_TIME,
  }],
};

const poolCard: PoolKol = {
  kol_uid: "fixture-kol",
  identity: { display: DISPLAY_NAME, platform: "YouTube", profile_url: "https://example.test/fixture-kol", avatar_url: GEOMETRIC_AVATAR },
  metrics: { followers: "20万", avg_plays: "1.8万", engagement: "6.2%" },
  direction: "露营 · 离网电源",
  region: "北美",
  ingested_at: FIXTURE_TIME,
  public_stage: { code: "new", label: "未首次建联" },
};

const candidate: Candidate = {
  id: "fixture-kol",
  name: DISPLAY_NAME,
  platform: "youtube",
  source_url: "https://example.test/fixture-kol",
  followers: 200_000,
  avg_views_10: 18_000,
  region: "北美",
  avatar_url: GEOMETRIC_AVATAR,
  direction: "露营 · 离网电源",
  snapshot_version: "fixture-snapshot-v1",
  followers_evidence: {
    state: "source_recorded",
    raw_text: "200K subscribers",
    source_field: "subscriberCount",
    captured_at: FIXTURE_TIME,
    parser_version: "fixture-v1",
  },
  assessment: { state: "scored", potential_score: 83, risk_score: 25, potential_confidence: 0.82, risk_confidence: 0.91, version: "jev-kol-fixture", assessed_at: FIXTURE_TIME, criteria_summary: "平台、公开主页、粉丝、近10条均播与露营方向" },
};

function FollowedFixture() {
  const card = useMemo(() => projectFollowedKolCard(followedRecord), []);
  const [selected, setSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [primaryCalls, setPrimaryCalls] = useState(0);
  return <>
    <output data-fixture-followed-primary>{primaryCalls}</output>
    <FollowedKolWorkCard
      card={card}
      selected={selected}
      actionBusy={busy}
      onOpenDetail={() => undefined}
      onOpenMail={() => undefined}
      onPrimary={() => { setPrimaryCalls(value => value + 1); setBusy(true); }}
      onConfirmStage={() => { setPrimaryCalls(value => value + 1); setBusy(true); }}
      onToggleSelect={setSelected}
    />
  </>;
}

function PoolFixture() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [claimTarget, setClaimTarget] = useState<PoolKol | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [confirmCalls, setConfirmCalls] = useState(0);
  return <>
    <output data-fixture-pool-confirm>{confirmCalls}</output>
    <PoolPane
      cards={[poolCard]}
      totalCount={1}
      isFiltered={false}
      selectedIds={selectedIds}
      query=""
      filter="all"
      sort="default"
      poolLoaded
      onQuery={() => undefined}
      onFilter={() => undefined}
      onToggleSort={() => undefined}
      onToggleSelect={(id, checked) => setSelectedIds(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id))}
      onToggleSelectAll={(ids, checked) => setSelectedIds(checked ? ids : [])}
      claimBusyId={claimBusy ? poolCard.kol_uid : null}
      claimTarget={claimTarget}
      onClaim={setClaimTarget}
      onConfirmClaim={() => { setConfirmCalls(value => value + 1); setClaimBusy(true); }}
      onCancelClaim={() => setClaimTarget(null)}
    />
  </>;
}

function DiscoveryFixture({ row = candidate, edge }: { row?: Candidate; edge?: string }) {
  const [selected, setSelected] = useState(false);
  const [refreshes, setRefreshes] = useState(0);
  return <>
    {!edge ? <output data-fixture-discovery-refresh>{refreshes}</output> : null}
    <DiscoveryRuntimeCandidate
      row={row}
      actionId="fixture-action"
      brief={brief}
      capturedAt={FIXTURE_TIME}
      refresh={() => setRefreshes(value => value + 1)}
      selected={selected}
      onSelect={setSelected}
    />
  </>;
}

function FixtureApp() {
  const query = new URLSearchParams(window.location.search);
  const theme = query.get("theme") === "dark" ? "dark" : "light";
  const containerWidth = Math.max(1, Number(query.get("container")) || 360);
  const zoom = query.get("zoom") === "2" ? "2" : "1";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = `KOL card fixture · ${theme}`;
    return () => { delete document.documentElement.dataset.theme; };
  }, [theme]);

  return <div
    data-fixture-root
    data-theme={theme}
    data-zoom={zoom}
    style={{ "--fixture-card-width": `${containerWidth}px`, "--fixture-stage-width": `${containerWidth * 3 + 32}px` } as React.CSSProperties}
  >
    <main className="kol-card-fixture" data-fixture-container={containerWidth}>
      <p className="fixture-note">隔离渲染：真实三入口组件、同一对象事实；所有动作只到传入回调或由 Playwright 拦截的 /api。</p>
      <section className="fixture-stage" aria-label="统一 KOL 卡片对照">
        <div className="fixture-card-grid" data-fixture-card-grid>
          <section className="fixture-card-host" data-fixture-card="followed"><FollowedFixture /></section>
          <section className="fixture-card-host" data-fixture-card="pool"><PoolFixture /></section>
          <section className="fixture-card-host" data-fixture-card="discovery"><DiscoveryFixture /></section>
        </div>
      </section>
      <section className="fixture-edge-grid" aria-label="头像与长内容边界样本">
        <section className="fixture-card-host" data-fixture-edge="missing-avatar">
          <DiscoveryFixture edge="missing-avatar" row={{ ...candidate, id: "edge-missing", name: "缺失头像 · " + DISPLAY_NAME, avatar_url: null }} />
        </section>
        <section className="fixture-card-host" data-fixture-edge="failed-avatar">
          <DiscoveryFixture edge="failed-avatar" row={{ ...candidate, id: "edge-failed", name: "加载失败头像 · " + DISPLAY_NAME, avatar_url: BROKEN_AVATAR }} />
        </section>
      </section>
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/fixture"]}>
      <TaskTheme><FixtureApp /></TaskTheme>
    </MemoryRouter>
  </StrictMode>,
);
