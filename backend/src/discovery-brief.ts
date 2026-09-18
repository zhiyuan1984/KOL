/**
 * discovery_brief/v1 validation. Missing ranking → rank_failed.
 * Never treat half-parsed JSON as a cover artifact.
 */
import type { Json } from "./types.js";

export const DISCOVERY_BRIEF_SCHEMA = "discovery_brief/v1";
export const DISCOVERY_SPEC_SCHEMA = "discovery_spec/v1";

const BANDS = new Set(["high", "mid", "low", "uncertain"]);
const RECOMMENDS = new Set(["ingest", "ignore", "need_human"]);

export type DiscoveryBriefRanking = {
  candidate_id: string;
  score: number;
  band: "high" | "mid" | "low" | "uncertain";
  why: string[];
  gaps: string[];
  fit: string;
  recommend: "ingest" | "ignore" | "need_human";
};

export type DiscoveryBrief = {
  schema: typeof DISCOVERY_BRIEF_SCHEMA;
  headline: string;
  counts: {
    raw: number;
    after_host_filter: number;
    shown: number;
    dropped: number;
  };
  ranking: DiscoveryBriefRanking[];
  dropped: { candidate_id: string; reason: string }[];
  gaps: string[];
  next_actions: string[];
};

export type BriefValidation =
  | { ok: true; brief: DiscoveryBrief }
  | { ok: false; code: "rank_failed"; message: string };

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item ?? "").trim());
}

function extractBriefCandidate(value: unknown): unknown {
  const root = asObject(value);
  if (!root) return null;
  if (root.schema === DISCOVERY_BRIEF_SCHEMA) return root;
  if (root.brief && typeof root.brief === "object") return root.brief;
  const items = Array.isArray(root.items) ? root.items : [];
  for (const item of items) {
    const row = asObject(item);
    if (!row) continue;
    if (row.schema === DISCOVERY_BRIEF_SCHEMA) return row;
    if (row.brief && typeof row.brief === "object") return row.brief;
  }
  return null;
}

export function validateDiscoveryBrief(value: unknown): BriefValidation {
  const raw = extractBriefCandidate(value);
  const brief = asObject(raw);
  if (!brief) {
    return { ok: false, code: "rank_failed", message: "发现简报缺少可校验结构。" };
  }
  if (String(brief.schema || "") !== DISCOVERY_BRIEF_SCHEMA) {
    return { ok: false, code: "rank_failed", message: "发现简报 schema 不是 discovery_brief/v1。" };
  }
  if (!Array.isArray(brief.ranking)) {
    return { ok: false, code: "rank_failed", message: "发现简报缺少 ranking。" };
  }
  const counts = asObject(brief.counts);
  if (!counts) {
    return { ok: false, code: "rank_failed", message: "发现简报缺少 counts。" };
  }
  const ranking: DiscoveryBriefRanking[] = [];
  for (const item of brief.ranking) {
    const row = asObject(item);
    if (!row || !String(row.candidate_id || "").trim()) {
      return { ok: false, code: "rank_failed", message: "发现简报 ranking 条目不完整。" };
    }
    const band = String(row.band || "");
    const recommend = String(row.recommend || "");
    if (!BANDS.has(band) || !RECOMMENDS.has(recommend)) {
      return { ok: false, code: "rank_failed", message: "发现简报 ranking 字段不合法。" };
    }
    const why = asStringList(row.why);
    const gaps = asStringList(row.gaps);
    if (!why || !gaps) {
      return { ok: false, code: "rank_failed", message: "发现简报 ranking 缺少 why/gaps。" };
    }
    ranking.push({
      candidate_id: String(row.candidate_id),
      score: Number(row.score || 0),
      band: band as DiscoveryBriefRanking["band"],
      why,
      gaps,
      fit: String(row.fit || ""),
      recommend: recommend as DiscoveryBriefRanking["recommend"],
    });
  }
  const droppedRaw = Array.isArray(brief.dropped) ? brief.dropped : null;
  if (!droppedRaw) {
    return { ok: false, code: "rank_failed", message: "发现简报缺少 dropped。" };
  }
  const dropped: { candidate_id: string; reason: string }[] = [];
  for (const item of droppedRaw) {
    const row = asObject(item);
    if (!row) continue;
    dropped.push({
      candidate_id: String(row.candidate_id || ""),
      reason: String(row.reason || ""),
    });
  }
  const gaps = asStringList(brief.gaps);
  const nextActions = asStringList(brief.next_actions);
  if (!gaps || !nextActions) {
    return { ok: false, code: "rank_failed", message: "发现简报缺少 gaps/next_actions。" };
  }
  const headline = String(brief.headline || "").trim();
  if (!headline) {
    return { ok: false, code: "rank_failed", message: "发现简报缺少 headline。" };
  }
  return {
    ok: true,
    brief: {
      schema: DISCOVERY_BRIEF_SCHEMA,
      headline,
      counts: {
        raw: Number(counts.raw || 0),
        after_host_filter: Number(counts.after_host_filter || 0),
        shown: Number(counts.shown || 0),
        dropped: Number(counts.dropped || 0),
      },
      ranking,
      dropped,
      gaps,
      next_actions: nextActions,
    },
  };
}

export function emptyDiscoveryBrief(input: {
  headline: string;
  raw: number;
  afterHostFilter: number;
  searchKeywords: string[];
}): DiscoveryBrief {
  return {
    schema: DISCOVERY_BRIEF_SCHEMA,
    headline: input.headline,
    counts: {
      raw: input.raw,
      after_host_filter: input.afterHostFilter,
      shown: 0,
      dropped: input.raw,
    },
    ranking: [],
    dropped: [],
    gaps: input.searchKeywords.length
      ? [`按「${input.searchKeywords.slice(0, 3).join(" / ")}」没有找到线索`]
      : ["这次计划没有找到红人线索"],
    next_actions: ["ignore"],
  };
}

export function publicBrief(brief: DiscoveryBrief): Json {
  return { ...brief };
}
