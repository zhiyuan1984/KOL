/**
 * discovery_brief/v1 validation. Missing ranking → rank_failed.
 * Never treat half-parsed JSON as a cover artifact.
 */
import type { Json } from "./types.js";

export const DISCOVERY_BRIEF_SCHEMA = "discovery_brief/v1";
export const DISCOVERY_SPEC_SCHEMA = "discovery_spec/v1";

/** Single source for the two enums, so the output schema and the validator cannot drift. */
export const DISCOVERY_BRIEF_BANDS = ["high", "mid", "low", "uncertain"] as const;
export const DISCOVERY_BRIEF_RECOMMENDS = ["ingest", "ignore", "need_human"] as const;

const BANDS = new Set<string>(DISCOVERY_BRIEF_BANDS);
const RECOMMENDS = new Set<string>(DISCOVERY_BRIEF_RECOMMENDS);

/**
 * Output schema for the `discovery_brief` turn.
 *
 * The generic `TASK_RESULT_OUTPUT_SCHEMA` in worker/runner.ts is
 * `additionalProperties: false` with no `brief` key, so a model that obeys it can
 * never produce what `validateDiscoveryBrief` reads — every Home run ended in
 * `rank_failed`「发现简报缺少可校验结构。」 while the model had in fact followed its
 * schema. Keep this in lockstep with the validator below:
 * tests/discovery-brief-contract.test.ts asserts the pair, and the band/recommend
 * enums are built from the same arrays the validator uses.
 */
export const DISCOVERY_BRIEF_OUTPUT_SCHEMA: Json = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["task_result"] },
    title: { type: "string" },
    summary: { type: "string" },
    recommended_actions: { type: "array", items: { type: "string" } },
    brief: {
      type: "object",
      properties: {
        schema: { type: "string", enum: [DISCOVERY_BRIEF_SCHEMA] },
        headline: { type: "string" },
        counts: {
          type: "object",
          properties: {
            raw: { type: "number" },
            after_host_filter: { type: "number" },
            shown: { type: "number" },
            dropped: { type: "number" },
          },
          required: ["raw", "after_host_filter", "shown", "dropped"],
          additionalProperties: false,
        },
        ranking: {
          type: "array",
          items: {
            type: "object",
            properties: {
              candidate_id: { type: "string" },
              score: { type: "number" },
              band: { type: "string", enum: [...DISCOVERY_BRIEF_BANDS] },
              why: { type: "array", items: { type: "string" } },
              gaps: { type: "array", items: { type: "string" } },
              fit: { type: "string" },
              recommend: { type: "string", enum: [...DISCOVERY_BRIEF_RECOMMENDS] },
            },
            required: ["candidate_id", "score", "band", "why", "gaps", "fit", "recommend"],
            additionalProperties: false,
          },
        },
        dropped: {
          type: "array",
          items: {
            type: "object",
            properties: {
              candidate_id: { type: "string" },
              reason: { type: "string" },
            },
            required: ["candidate_id", "reason"],
            additionalProperties: false,
          },
        },
        gaps: { type: "array", items: { type: "string" } },
        next_actions: { type: "array", items: { type: "string" } },
      },
      required: ["schema", "headline", "counts", "ranking", "dropped", "gaps", "next_actions"],
      additionalProperties: false,
    },
  },
  required: ["type", "title", "summary", "recommended_actions", "brief"],
  additionalProperties: false,
};

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

function briefOf(value: unknown): Record<string, unknown> | null {
  const row = asObject(value);
  if (!row) return null;
  if (row.schema === DISCOVERY_BRIEF_SCHEMA) return row;
  return row.brief && typeof row.brief === "object" ? asObject(row.brief) : null;
}

function rankingSize(brief: Record<string, unknown>): number {
  return Array.isArray(brief.ranking) ? brief.ranking.length : 0;
}

/**
 * The model opens with an acknowledgement `task_result` and then the real result, and the
 * turn's output schema makes every `task_result` carry a `brief` — so the first match is a
 * stub (headline「处理中」, zero counts). Prefer the last candidate that actually ranks
 * someone, else the last one that carries a brief at all.
 */
function extractBriefCandidate(value: unknown): unknown {
  const root = asObject(value);
  if (!root) return null;
  const direct = briefOf(root);
  if (!Array.isArray(root.items)) return direct;
  const found = root.items
    .map(briefOf)
    .filter((brief): brief is Record<string, unknown> => Boolean(brief));
  if (!found.length) return direct;
  const ranked = found.filter((brief) => rankingSize(brief) > 0);
  const chosen = ranked.length ? ranked[ranked.length - 1] : found[found.length - 1];
  return chosen || direct;
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
