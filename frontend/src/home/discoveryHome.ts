/**
 * Home AI发现 client against /api/home/discovery/* (designed contract).
 * 404 → fallback template / empty batches. Never fabricate candidates.
 */
import { api, type TaskEvent } from "../api";
import {
  asDiscoveryTemplate,
  fallbackDiscoveryTemplate,
  type DiscoveryBrief,
  type DiscoveryTemplate,
} from "./discoveryTemplate";

export type HomeDiscoveryEmptyKind = "idle" | "filtered" | "down";

export type HomeDiscoveryBatch = {
  id: string;
  headline: string;
  raw_count: number | null;
  shortlist_count: number | null;
  status: string;
  task_id?: string;
  session_id?: string;
  created_at?: string;
};

export type HomeDiscoveryCandidate = {
  id: string;
  nickname: string | null;
  platform: string | null;
  handle: string | null;
  followers: number | null;
  avg_plays_10: number | null;
  source_url: string | null;
  why: string | null;
  band: string | null;
  in_library: boolean;
  status: string;
  batch_id?: string;
};

export type HomeDiscoveryRunResult = {
  task_id: string;
  session_id?: string;
  batch_id?: string;
  agent_status?: string;
  missing: boolean;
};

export type HomeDiscoveryIngestItem = {
  id: string;
  handle?: string;
  ok?: boolean;
  message?: string;
};

export type HomeDiscoveryIngestResult = {
  batch_id?: string;
  ingested: HomeDiscoveryIngestItem[];
  failed: HomeDiscoveryIngestItem[];
  pending_approval: boolean;
  approval_status?: string | null;
  message?: string;
  missing: boolean;
};

export type OptionalGet<T> = {
  data: T;
  status: number;
  missing: boolean;
  down: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function httpStatus(error: unknown): number {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : 0;
  }
  return 0;
}

export function isMissingEndpoint(error: unknown): boolean {
  const status = httpStatus(error);
  return status === 404 || status === 405;
}

export function isServiceDown(error: unknown): boolean {
  const status = httpStatus(error);
  return status >= 500 || status === 0;
}

export function displayMetric(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "无";
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

export function displayText(value: string | null | undefined): string {
  const text = String(value || "").trim();
  return text || "无";
}

export function asHomeBatch(row: unknown): HomeDiscoveryBatch | null {
  const item = asRecord(row);
  const id = asString(item.id || item.batch_id);
  if (!id) return null;
  return {
    id,
    headline: asString(item.headline || item.title || item.summary),
    raw_count: nullableNumber(item.raw_count ?? item.original_count ?? item.received_count),
    shortlist_count: nullableNumber(item.shortlist_count ?? item.candidate_count ?? item.ranked_count),
    status: asString(item.status || "succeeded") || "succeeded",
    task_id: asString(item.task_id) || undefined,
    session_id: asString(item.session_id) || undefined,
    created_at: asString(item.created_at) || undefined,
  };
}

export function asHomeCandidate(row: unknown): HomeDiscoveryCandidate | null {
  const item = asRecord(row);
  const id = asString(item.id);
  if (!id) return null;
  const followers = nullableNumber(item.followers ?? item.follower_count);
  const plays = nullableNumber(
    item.avg_plays_10 ?? item.avg_views_10 ?? item.last10_avg_plays ?? item.avg_plays,
  );
  return {
    id,
    nickname: asString(item.nickname || item.display_name || item.title) || null,
    platform: asString(item.platform) || null,
    handle: asString(item.handle || item.username) || null,
    followers: followers != null && followers > 0 ? followers : null,
    avg_plays_10: plays != null && plays > 0 ? plays : null,
    source_url: asString(item.source_url || item.url || item.link) || null,
    why: asString(item.why || item.reason || item.summary) || null,
    band: asString(item.band || item.score_band || item.tier) || null,
    in_library: Boolean(item.in_library || item.in_starry || item.already_in_pool),
    status: asString(item.status || "suggested") || "suggested",
    batch_id: asString(item.batch_id) || undefined,
  };
}

export async function loadDiscoveryTemplate(): Promise<DiscoveryTemplate> {
  try {
    const raw = await api.homeDiscoveryTemplate();
    const parsed = asDiscoveryTemplate(raw);
    if (parsed) return parsed;
  } catch (error) {
    if (!isMissingEndpoint(error)) throw error;
  }
  return fallbackDiscoveryTemplate();
}

export async function loadDiscoveryBatches(): Promise<OptionalGet<HomeDiscoveryBatch[]>> {
  try {
    const raw = await api.homeDiscoveryBatches();
    const row = asRecord(raw);
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(row.batches)
        ? row.batches
        : Array.isArray(row.items)
          ? row.items
          : [];
    return {
      data: list.map(asHomeBatch).filter(Boolean) as HomeDiscoveryBatch[],
      status: 200,
      missing: false,
      down: false,
    };
  } catch (error) {
    if (isMissingEndpoint(error)) {
      return { data: [], status: httpStatus(error) || 404, missing: true, down: false };
    }
    return { data: [], status: httpStatus(error) || 502, missing: false, down: true };
  }
}

export async function loadDiscoveryCandidates(batchId?: string): Promise<OptionalGet<HomeDiscoveryCandidate[]>> {
  try {
    const raw = await api.homeDiscoveryCandidates(batchId);
    const row = asRecord(raw);
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(row.candidates)
        ? row.candidates
        : Array.isArray(row.items)
          ? row.items
          : [];
    return {
      data: list.map(asHomeCandidate).filter(Boolean) as HomeDiscoveryCandidate[],
      status: 200,
      missing: false,
      down: false,
    };
  } catch (error) {
    if (isMissingEndpoint(error)) {
      return { data: [], status: httpStatus(error) || 404, missing: true, down: false };
    }
    return { data: [], status: httpStatus(error) || 502, missing: false, down: true };
  }
}

export async function runHomeDiscovery(input: {
  brief: DiscoveryBrief;
  body: string;
  expected_brief_version?: string;
}): Promise<HomeDiscoveryRunResult> {
  const raw = await api.runHomeDiscovery({
    platforms: input.brief.platforms,
    region: input.brief.region,
    directions: input.brief.directions,
    keywords: input.brief.keywords,
    min_followers: input.brief.min_followers,
    max_followers: input.brief.max_followers,
    min_avg_plays_10: input.brief.min_avg_plays_10,
    expect_count: input.brief.expect_count,
    body: input.body,
    expected_brief_version: input.expected_brief_version,
  });
  const row = asRecord(raw);
  return {
    task_id: asString(row.task_id || row.id || asRecord(row.task).id),
    session_id: asString(row.session_id) || undefined,
    batch_id: asString(row.batch_id) || undefined,
    agent_status: asString(row.agent_status) || "running",
    missing: false,
  };
}

export async function ingestHomeDiscovery(input: {
  batch_id?: string;
  candidate_ids: string[];
  expected_brief_version?: string;
}): Promise<HomeDiscoveryIngestResult> {
  const raw = await api.ingestHomeDiscovery({
    batch_id: input.batch_id,
    candidate_ids: input.candidate_ids,
    expected_brief_version: input.expected_brief_version,
  });
  const row = asRecord(raw);
  const ingested = (Array.isArray(row.ingested) ? row.ingested : []).map((item) => {
    const rec = asRecord(item);
    return {
      id: asString(rec.id || rec.candidate_id),
      handle: asString(rec.handle) || undefined,
      ok: rec.ok !== false,
      message: asString(rec.message) || undefined,
    };
  });
  const failed = (Array.isArray(row.failed) ? row.failed : []).map((item) => {
    const rec = asRecord(item);
    return {
      id: asString(rec.id || rec.candidate_id),
      handle: asString(rec.handle) || undefined,
      ok: false,
      message: asString(rec.message) || "未入库",
    };
  });
  return {
    batch_id: asString(row.batch_id) || input.batch_id,
    ingested,
    failed,
    pending_approval: Boolean(row.pending_approval || row.approval_status === "pending"),
    approval_status: asString(row.approval_status) || (row.pending_approval ? "pending" : null),
    message: asString(row.message) || undefined,
    missing: false,
  };
}

export async function loadTaskEvents(taskId: string): Promise<TaskEvent[]> {
  const raw = await api.taskEvents(taskId);
  if (Array.isArray(raw)) return raw;
  const row = asRecord(raw);
  return Array.isArray(row.events) ? row.events as TaskEvent[] : [];
}

export function refreshWorkbenchSessions(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("lingong:sessions-refresh"));
}

export function batchHeadline(batch: HomeDiscoveryBatch | null, fallback = "发现结果"): string {
  return asString(batch?.headline) || fallback;
}

export function batchCountsLabel(batch: HomeDiscoveryBatch | null, visible: number): string {
  const raw = batch?.raw_count;
  const shortlist = batch?.shortlist_count ?? visible;
  const rawLabel = raw == null || raw <= 0 ? "无" : String(raw);
  const shortLabel = shortlist == null || shortlist < 0 ? "无" : String(shortlist);
  return `原始 ${rawLabel} · 入围 ${shortLabel}`;
}
