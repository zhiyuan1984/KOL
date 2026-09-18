/**
 * Home AI发现 client against landed /api/home/discovery/* (runs, not batches).
 * 404 → fallback template / empty runs. Never fabricate candidates.
 */
import { api, type TaskEvent } from "../api";
import {
  asDiscoveryTemplate,
  fallbackDiscoveryTemplate,
  type DiscoveryBrief,
  type DiscoveryTemplate,
} from "./discoveryTemplate";

export type HomeDiscoveryEmptyKind = "idle" | "filtered" | "down";

export type HomeDiscoveryRun = {
  id: string;
  headline: string;
  raw_count: number | null;
  shortlist_count: number | null;
  status: string;
  work_item_id?: string;
  session_id?: string;
  brief_version: number;
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
  run_id?: string;
};

export type HomeDiscoveryRunResult = {
  run_id: string;
  work_item_id?: string;
  session_id?: string;
  agent_status?: string;
  brief_version: number;
  missing: boolean;
};

export type HomeDiscoveryIngestItem = {
  id: string;
  handle?: string;
  status?: string;
  ok?: boolean;
  message?: string;
};

export type HomeDiscoveryIngestResult = {
  run_id?: string;
  ingested: HomeDiscoveryIngestItem[];
  failed: HomeDiscoveryIngestItem[];
  claimed: false;
  pending_approval: boolean;
  approval_status?: string | null;
  org_approval?: Record<string, unknown> | null;
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

function briefVersionOf(value: unknown, fallback = 1): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
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

export type IngestFailureKind = "missing" | "needs_confirmation" | "brief_mismatch" | "other";

function errorPayload(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") return {};
  const payload = (error as { payload?: unknown }).payload;
  const detail = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).detail
    : undefined;
  const fromDetail = detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as Record<string, unknown>
    : {};
  const fromPayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  return { ...fromPayload, ...fromDetail };
}

export function ingestFailureKind(error: unknown): IngestFailureKind {
  if (isMissingEndpoint(error)) return "missing";
  const payload = errorPayload(error);
  const code = asString(payload.code || payload.status);
  const status = httpStatus(error);
  if (status === 422 || code === "needs_confirmation") return "needs_confirmation";
  if (status === 409 || code === "brief_version_mismatch") return "brief_mismatch";
  return "other";
}

export function ingestFailureBriefVersion(error: unknown): number | null {
  const payload = errorPayload(error);
  return nullableNumber(payload.brief_version);
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

function workItemIdOf(row: Record<string, unknown>): string {
  return asString(row.work_item_id || row.task_id || asRecord(row.work_item).id);
}

function sessionIdOf(row: Record<string, unknown>): string {
  return asString(row.session_id || asRecord(row.session).id);
}

export function asHomeRun(row: unknown): HomeDiscoveryRun | null {
  const item = asRecord(row);
  const id = asString(item.id || item.run_id);
  if (!id) return null;
  const brief = asRecord(item.brief);
  return {
    id,
    headline: asString(item.headline || brief.headline || item.title || item.summary),
    raw_count: nullableNumber(item.raw_count ?? item.original_count ?? item.received_count),
    shortlist_count: nullableNumber(item.shortlist_count ?? item.candidate_count ?? item.ranked_count),
    status: asString(item.status || "succeeded") || "succeeded",
    work_item_id: workItemIdOf(item) || undefined,
    session_id: sessionIdOf(item) || undefined,
    brief_version: briefVersionOf(item.brief_version ?? brief.version),
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
    in_library: Boolean(
      item.in_library || item.in_starry || item.already_in_pool || item.already_in_library,
    ),
    status: asString(item.status || "suggested") || "suggested",
    run_id: asString(item.run_id) || undefined,
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

export async function loadDiscoveryRuns(): Promise<OptionalGet<HomeDiscoveryRun[]>> {
  try {
    const raw = await api.homeDiscoveryRuns();
    const row = asRecord(raw);
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(row.runs)
        ? row.runs
        : Array.isArray(row.items)
          ? row.items
          : [];
    return {
      data: list.map(asHomeRun).filter(Boolean) as HomeDiscoveryRun[],
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

export async function loadDiscoveryRun(runId: string): Promise<OptionalGet<HomeDiscoveryRun | null>> {
  try {
    const raw = await api.homeDiscoveryRun(runId);
    const row = asRecord(raw);
    const parsed = asHomeRun(row.run || raw);
    return {
      data: parsed,
      status: 200,
      missing: false,
      down: false,
    };
  } catch (error) {
    if (isMissingEndpoint(error)) {
      return { data: null, status: httpStatus(error) || 404, missing: true, down: false };
    }
    return { data: null, status: httpStatus(error) || 502, missing: false, down: true };
  }
}

export async function loadDiscoveryCandidates(runId: string): Promise<OptionalGet<HomeDiscoveryCandidate[]>> {
  try {
    const raw = await api.homeDiscoveryRunCandidates(runId);
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
  });
  const row = asRecord(raw);
  return {
    run_id: asString(row.run_id || row.id || asRecord(row.run).id),
    work_item_id: workItemIdOf(row) || workItemIdOf(asRecord(row.run)) || undefined,
    session_id: sessionIdOf(row) || sessionIdOf(asRecord(row.run)) || undefined,
    agent_status: asString(row.agent_status || row.status) || "running",
    brief_version: briefVersionOf(row.brief_version ?? asRecord(row.run).brief_version),
    missing: false,
  };
}

function ingestItem(row: unknown): HomeDiscoveryIngestItem {
  const rec = asRecord(row);
  const status = asString(rec.status);
  return {
    id: asString(rec.candidate_id || rec.id),
    handle: asString(rec.handle) || undefined,
    status: status || undefined,
    ok: status ? status !== "failed" : rec.ok !== false,
    message: asString(rec.message || asRecord(rec.error).message) || undefined,
  };
}

export async function ingestHomeDiscovery(input: {
  run_id: string;
  candidate_ids: string[];
  expected_brief_version: number;
}): Promise<HomeDiscoveryIngestResult> {
  const raw = await api.ingestHomeDiscovery({
    run_id: input.run_id,
    candidate_ids: input.candidate_ids,
    expected_brief_version: input.expected_brief_version,
    confirmed: true,
  });
  const row = asRecord(raw);
  const items = (Array.isArray(row.items) ? row.items : []).map(ingestItem);
  const ingested = items.filter((item) => item.status !== "failed");
  const failedFromItems = items.filter((item) => item.status === "failed");
  const legacyIngested = (Array.isArray(row.ingested) ? row.ingested : []).map(ingestItem);
  const legacyFailed = (Array.isArray(row.failed) ? row.failed : []).map((item) => ({
    ...ingestItem(item),
    ok: false,
  }));
  const org = row.org_approval && typeof row.org_approval === "object"
    ? asRecord(row.org_approval)
    : null;
  const orgPending = Boolean(
    org && (org.required === true || org.pending === true || asString(org.status) === "pending"),
  );
  return {
    run_id: asString(row.run_id) || input.run_id,
    ingested: ingested.length ? ingested : legacyIngested,
    failed: failedFromItems.length ? failedFromItems : legacyFailed,
    claimed: false,
    pending_approval: Boolean(
      row.status === "needs_confirmation" || row.pending_approval || orgPending,
    ) && row.status !== "completed",
    approval_status: asString(row.approval_status || row.status) || (orgPending ? "pending" : null),
    org_approval: org,
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

export function runHeadline(run: HomeDiscoveryRun | null, fallback = "发现结果"): string {
  return asString(run?.headline) || fallback;
}

export function runCountsLabel(run: HomeDiscoveryRun | null, visible: number): string {
  const raw = run?.raw_count;
  const shortlist = run?.shortlist_count ?? visible;
  const rawLabel = raw == null || raw <= 0 ? "无" : String(raw);
  const shortLabel = shortlist == null || shortlist < 0 ? "无" : String(shortlist);
  return `原始 ${rawLabel} · 入围 ${shortLabel}`;
}
