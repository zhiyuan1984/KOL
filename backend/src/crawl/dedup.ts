/**
 * AI发现三层去重（2026-10-08 设计 `your_files/discovery-dedup-score-design.md`）。
 *
 * 身份键（精确键）：`(platform, 归一化 platform_creator_id)`。
 * BIZ-15：KOL 只用平台 + 稳定外部 ID 识别；昵称/邮箱相似不能认定为同一对象，
 * 因此跨平台同一真人不自动合并（只在 handle 跨平台相同时标「疑似同一人」）。
 *
 * 三层：
 *  1. 批次内：同一次落盘按精确键内存去重；
 *  2. 跨运行（池）：PG `kol_creator_pool` 为基准，`window_days` 内命中去重，
 *     超窗口允许重新入池（画像变了值得再看一次）；
 *  3. 跨业务：`kol_leads` / `kol_cooperations`(经 lead) / `kol_follow_index(active)`，
 *     命中标状态，前端降权折叠，不重复建档。
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { postgresPool } from "../postgres/pool.js";
import type { Json } from "../types.js";

export const DEFAULT_DEDUP_WINDOW_DAYS = 30;

/** 精确键归一化：平台小写 + 外部 ID 去空白小写。 */
export function normalizeCreatorKey(platform: unknown, creatorId: unknown): string {
  const p = String(platform || "").trim().toLowerCase();
  const id = String(creatorId || "").trim().toLowerCase();
  return `${p}:${id}`;
}

export function isUsableCreatorKey(key: string): boolean {
  const [p, id] = key.split(":");
  return Boolean(p && id && p !== ":" && key !== ":");
}

export type DedupSighting = {
  platform: string;
  platform_creator_id: string;
  handle?: string | null;
  display_name?: string | null;
  profile_snapshot?: Json;
};

export type PoolMatch = {
  id: string;
  platform: string;
  platform_creator_id: string;
  last_seen_at: string;
  seen_count: number;
  days_since_seen: number;
};

/**
 * 第一层：批次内去重。保留每键第一条（调用方保证按"数据最新"排序），
 * 返回去重后的列表与被滤掉的条目（含原因）。
 */
export function dedupeBatch<T>(
  items: T[],
  keyFn: (item: T) => string,
): { unique: T[]; duplicates: Array<{ item: T; key: string }> } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: Array<{ item: T; key: string }> = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!isUsableCreatorKey(key) || seen.has(key)) {
      duplicates.push({ item, key });
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return { unique, duplicates };
}

/** 跨平台疑似同一人：归一化 handle 相同但平台不同。只标记，不合并。 */
export function suspectSamePersonAcrossPlatforms(
  items: Array<{ platform: string; handle?: string | null }>,
): Array<{ handle: string; platforms: string[] }> {
  const byHandle = new Map<string, Set<string>>();
  for (const item of items) {
    const handle = String(item.handle || "").trim().toLowerCase().replace(/^@+/, "");
    if (!handle) continue;
    const platform = String(item.platform || "").trim().toLowerCase();
    if (!byHandle.has(handle)) byHandle.set(handle, new Set());
    byHandle.get(handle)!.add(platform);
  }
  const out: Array<{ handle: string; platforms: string[] }> = [];
  for (const [handle, platforms] of byHandle) {
    if (platforms.size > 1) out.push({ handle, platforms: [...platforms] });
  }
  return out;
}

function poolRowToMatch(row: Record<string, unknown>): PoolMatch {
  const lastSeen = String(row.last_seen_at || "");
  const days = lastSeen ? Math.max(0, (Date.now() - new Date(lastSeen).getTime()) / 86_400_000) : 0;
  return {
    id: String(row.id),
    platform: String(row.platform),
    platform_creator_id: String(row.platform_creator_id),
    last_seen_at: lastSeen,
    seen_count: Number(row.seen_count || 0),
    days_since_seen: days,
  };
}

/** 第二层：查池。返回 key → 池记录（无记录表示全新）。 */
export async function lookupPoolMatches(
  client: PoolClient,
  keys: string[],
): Promise<Map<string, PoolMatch>> {
  const usable = [...new Set(keys)].filter(isUsableCreatorKey);
  const out = new Map<string, PoolMatch>();
  if (!usable.length) return out;
  const platforms = usable.map((key) => key.split(":")[0]);
  const ids = usable.map((key) => key.slice(key.indexOf(":") + 1));
  const { rows } = await client.query(
    `SELECT id, platform, platform_creator_id, normalized_creator_id, last_seen_at, seen_count
       FROM kol_creator_pool
      WHERE (platform, normalized_creator_id) IN (
        SELECT lower(p), i FROM unnest($1::text[], $2::text[]) AS t(p, i)
      )`,
    [platforms, ids],
  );
  for (const row of rows) {
    out.set(
      normalizeCreatorKey(row.platform, row.normalized_creator_id),
      poolRowToMatch(row as Record<string, unknown>),
    );
  }
  return out;
}

export type PoolVerdict =
  | { kind: "new" }
  | { kind: "duplicate_within_window"; match: PoolMatch }
  | { kind: "seen_outside_window"; match: PoolMatch };

/** 按窗口给 verdict：窗口内命中去重，超窗口允许重新入池。 */
export function poolVerdict(match: PoolMatch | undefined, windowDays: number): PoolVerdict {
  if (!match) return { kind: "new" };
  if (match.days_since_seen <= windowDays) return { kind: "duplicate_within_window", match };
  return { kind: "seen_outside_window", match };
}

/**
 * 记录本次见到的候选（幂等 upsert）：新行插入；已存在行刷新画像快照、
 * `last_seen_at` 与 `seen_count`。被去重的也记录（审计可展开）。
 */
export async function recordPoolSightings(
  client: PoolClient,
  sightings: DedupSighting[],
): Promise<void> {
  for (const sighting of sightings) {
    const key = normalizeCreatorKey(sighting.platform, sighting.platform_creator_id);
    if (!isUsableCreatorKey(key)) continue;
    const platform = key.split(":")[0];
    const normalizedId = key.slice(key.indexOf(":") + 1);
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO kol_creator_pool
         (id, platform, platform_creator_id, normalized_creator_id, handle, display_name, profile_snapshot, first_seen_at, last_seen_at, seen_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8,1)
       ON CONFLICT (platform, normalized_creator_id) DO UPDATE SET
         handle = COALESCE(EXCLUDED.handle, kol_creator_pool.handle),
         display_name = COALESCE(EXCLUDED.display_name, kol_creator_pool.display_name),
         profile_snapshot = EXCLUDED.profile_snapshot,
         last_seen_at = EXCLUDED.last_seen_at,
         seen_count = kol_creator_pool.seen_count + 1`,
      [
        `pool_${randomUUID()}`,
        platform,
        String(sighting.platform_creator_id).trim(),
        normalizedId,
        sighting.handle?.trim() || null,
        sighting.display_name?.trim() || null,
        JSON.stringify(sighting.profile_snapshot ?? {}),
        now,
      ],
    );
  }
}

export type BusinessMatch = {
  key: string;
  /** already_lead | already_cooperating | already_followed */
  kinds: string[];
  lead_id?: string;
};

/**
 * 第三层：跨业务比对。按精确键查线索 / 合作（经 lead）/ 有效跟进。
 * leads 用 account_handle 比对（handle 可变，同时用 creator_id 兜底）。
 */
export async function lookupBusinessMatches(
  client: PoolClient,
  sightings: DedupSighting[],
): Promise<Map<string, BusinessMatch>> {
  const out = new Map<string, BusinessMatch>();
  const usable = sightings.filter((sighting) =>
    isUsableCreatorKey(normalizeCreatorKey(sighting.platform, sighting.platform_creator_id)),
  );
  if (!usable.length) return out;
  const touch = (key: string, kind: string, leadId?: string) => {
    const current = out.get(key) || { key, kinds: [] as string[] };
    if (!current.kinds.includes(kind)) current.kinds.push(kind);
    if (leadId && !current.lead_id) current.lead_id = leadId;
    out.set(key, current);
  };
  const platforms = usable.map((sighting) => String(sighting.platform).trim().toLowerCase());
  const ids = usable.map((sighting) => String(sighting.platform_creator_id).trim().toLowerCase());
  const handles = usable.map((sighting) => String(sighting.handle || "").trim().toLowerCase());
  // 线索：platform + (account_handle = creator_id 或 handle)
  const leadRows = (
    await client.query(
      `SELECT id, lower(platform) AS platform, lower(account_handle) AS account_handle
         FROM kol_leads
        WHERE NOT is_archived
          AND lower(platform) = ANY($1::text[])
          AND (lower(account_handle) = ANY($2::text[]) OR lower(account_handle) = ANY($3::text[]))`,
      [platforms, ids, handles],
    )
  ).rows as Array<{ id: string; platform: string; account_handle: string }>;
  for (const sighting of usable) {
    const key = normalizeCreatorKey(sighting.platform, sighting.platform_creator_id);
    const hit = leadRows.find(
      (row) =>
        row.platform === key.split(":")[0] &&
        (row.account_handle === key.slice(key.indexOf(":") + 1) ||
          row.account_handle === String(sighting.handle || "").trim().toLowerCase()),
    );
    if (hit) touch(key, "already_lead", hit.id);
  }
  // 合作：经 lead 关联
  const leadIds = [...new Set([...out.values()].map((match) => match.lead_id).filter(Boolean) as string[])];
  if (leadIds.length) {
    const coopRows = (
      await client.query(`SELECT DISTINCT lead_id FROM kol_cooperations WHERE lead_id = ANY($1::text[])`, [
        leadIds,
      ])
    ).rows as Array<{ lead_id: string }>;
    const coopLeadIds = new Set(coopRows.map((row) => row.lead_id));
    for (const match of out.values()) {
      if (match.lead_id && coopLeadIds.has(match.lead_id)) touch(match.key, "already_cooperating", match.lead_id);
    }
  }
  // 有效跟进（排他认领）：kol_follow_index active
  const followRows = (
    await client.query(
      `SELECT lower(p.platform) AS platform, p.platform_creator_id
         FROM kol_follow_index f
         JOIN kol_profile_index p ON p.company_id = f.company_id AND p.kol_uid = f.kol_uid
        WHERE f.status = 'active'
          AND lower(p.platform) = ANY($1::text[])
          AND lower(p.platform_creator_id) = ANY($2::text[])`,
      [platforms, ids],
    )
  ).rows as Array<{ platform: string; platform_creator_id: string }>;
  for (const row of followRows) {
    touch(normalizeCreatorKey(row.platform, row.platform_creator_id), "already_followed");
  }
  return out;
}

export type DedupOutcome = {
  key: string;
  /** new | duplicate_within_window | seen_outside_window */
  pool: PoolVerdict["kind"];
  days_since_seen: number | null;
  business: string[];
  /** duplicate_within_window 或命中业务对象时为 true：前端默认折叠。 */
  suppressed: boolean;
};

/**
 * 一次跑通三层（供落盘路径调用）：
 * 归一化 → 批次内去重 → 池比对 → 业务比对 → 写池。
 * 返回每条的去重结论；写池包含被去重的（审计可展开）。
 */
export async function dedupeSightings(
  sightings: DedupSighting[],
  windowDays: number = DEFAULT_DEDUP_WINDOW_DAYS,
  client?: PoolClient,
): Promise<{ outcomes: DedupOutcome[]; batch_duplicates: number }> {
  const release = !client;
  const owned = client || (await postgresPool().connect());
  try {
    const { unique, duplicates } = dedupeBatch(sightings, (sighting) =>
      normalizeCreatorKey(sighting.platform, sighting.platform_creator_id),
    );
    const keys = unique.map((sighting) => normalizeCreatorKey(sighting.platform, sighting.platform_creator_id));
    const poolMatches = await lookupPoolMatches(owned, keys);
    const businessMatches = await lookupBusinessMatches(owned, unique);
    await recordPoolSightings(owned, unique);
    const outcomes: DedupOutcome[] = unique.map((sighting) => {
      const key = normalizeCreatorKey(sighting.platform, sighting.platform_creator_id);
      const verdict = poolVerdict(poolMatches.get(key), windowDays);
      const business = businessMatches.get(key)?.kinds || [];
      const suppressed = verdict.kind === "duplicate_within_window" || business.length > 0;
      return {
        key,
        pool: verdict.kind,
        days_since_seen: verdict.kind === "new" ? null : Math.round(verdict.match.days_since_seen),
        business,
        suppressed,
      };
    });
    return { outcomes, batch_duplicates: duplicates.length };
  } finally {
    if (release) (owned as PoolClient).release();
  }
}
