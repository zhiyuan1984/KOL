import { postgresPool, postgresTransaction } from "./pool.js";
import type { Json, Row } from "../types.js";

export const NATIVE_OWNERSHIP_POLICY = "biz-06-v1-follow-index-pg-native";

type ReleaseSnapshot = Row & {
  last_effective_mail_at_ts?: string | null;
};

function text(value: unknown): string { return String(value ?? "").trim(); }
function iso(value: unknown): string | null { const v = text(value); return v || null; }

export async function listNativeOwnershipCandidates(input: {
  companyId?: string;
  now?: Date;
  limit?: number;
} = {}): Promise<Row[]> {
  const company = text(input.companyId);
  const now = input.now || new Date();
  const limit = Math.max(1, Math.min(5000, Math.floor(input.limit || 1000)));
  const params: unknown[] = [now.toISOString(), limit];
  const companyClause = company ? "AND company_id=$3" : "";
  if (company) params.push(company);
  const rows = await postgresPool().query<Row>(
    `SELECT * FROM kol_follow_index
      WHERE status='active'
        AND last_effective_mail_at_ts IS NOT NULL
        AND last_effective_mail_at_ts <= ($1::timestamptz - INTERVAL '14 days')
        ${companyClause}
      ORDER BY last_effective_mail_at_ts ASC, id ASC
      LIMIT $2`,
    params,
  );
  return rows.rows;
}

export async function releaseNativeIfUnchanged(input: {
  followId: string;
  expectedOwner: string;
  expectedLastAt: string;
  actor: string;
  cronRunId?: string;
  now?: Date;
}): Promise<Json> {
  const now = input.now || new Date();
  return postgresTransaction(async (client) => {
    const current = (await client.query<ReleaseSnapshot>(
      `SELECT f.*, f.last_effective_mail_at_ts::text AS last_effective_mail_at_ts
         FROM kol_follow_index f WHERE f.id=$1 FOR UPDATE`,
      [input.followId],
    )).rows[0];
    if (!current) return { action: "skip", follow_id: input.followId, reason: "missing" };
    const owner = text(current.employee_id || current.employee_name);
    const currentLast = iso(current.last_effective_mail_at_ts || current.last_effective_mail_at);
    const expectedLast = iso(input.expectedLastAt);
    const base = { follow_id: input.followId, collaboration_id: text(current.collaboration_id) };
    if (text(current.status) !== "active") return { ...base, action: "skip", reason: "already_released" };
    if (owner !== input.expectedOwner) return { ...base, action: "skip", reason: "reassigned", expected_owner: input.expectedOwner, observed_owner: owner };
    if ((currentLast || "") !== (expectedLast || "")) return { ...base, action: "skip", reason: "correspondence_changed", expected_last_at: expectedLast, observed_last_at: currentLast };
    if (!currentLast || !current.last_effective_mail_at_ts) return { ...base, action: "skip", reason: "correspondence_incomplete" };
    const changed = await client.query(
      `UPDATE kol_follow_index
          SET status='released', released_at=$1, released_at_ts=$1::timestamptz,
              release_reason='ownership-release', updated_at=$1, updated_at_ts=$1::timestamptz,
              data_version=data_version+1
        WHERE id=$2 AND status='active'
          AND employee_id=$3 AND last_effective_mail_at_ts=$4::timestamptz`,
      [now.toISOString(), input.followId, text(current.employee_id), currentLast],
    );
    if (!changed.rowCount) return { ...base, action: "skip", reason: "race_lost" };
    await client.query(
      `UPDATE kol_profile_index SET pool_status='open', idle=1, updated_at=$1, updated_at_ts=$1::timestamptz
        WHERE company_id=$2 AND kol_uid=$3`,
      [now.toISOString(), text(current.company_id), text(current.kol_uid)],
    );
    const decisionId = `ord_${input.followId}_${now.getTime()}`;
    await client.query(
      `INSERT INTO kol_ownership_release_decisions
       (id,cron_run_id,follow_id,collaboration_id,decision,reason,expected_owner,expected_last_effective_mail_at,observed_owner,observed_last_effective_mail_at,policy_version,detail,created_at)
       VALUES($1,$2,$3,$4,'release','idle_14_days',$5,$6::timestamptz,$7,$8::timestamptz,$9,$10::jsonb,$11::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [decisionId, input.cronRunId || null, input.followId, text(current.collaboration_id), input.expectedOwner, expectedLast, owner, currentLast, NATIVE_OWNERSHIP_POLICY, JSON.stringify({ actor: input.actor, stage_unchanged: true }), now.toISOString()],
    );
    return { ...base, action: "release", owner_before: owner, policy: NATIVE_OWNERSHIP_POLICY, repository: "postgresql_native" };
  });
}

export async function nativeOwnershipParity(companyId?: string): Promise<Json> {
  const clause = companyId ? "WHERE company_id=$1" : "";
  const args = companyId ? [companyId] : [];
  const result = await postgresPool().query<{ active: string; open_profiles: string; due: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM kol_follow_index WHERE status='active' ${companyId ? "AND company_id=$1" : ""}) AS active,
       (SELECT COUNT(*)::text FROM kol_profile_index WHERE pool_status='open' ${companyId ? "AND company_id=$1" : ""}) AS open_profiles,
       (SELECT COUNT(*)::text FROM kol_follow_index WHERE status='active' AND last_effective_mail_at_ts IS NOT NULL AND last_effective_mail_at_ts <= now()-INTERVAL '14 days' ${companyId ? "AND company_id=$1" : ""}) AS due`,
    args,
  );
  return { repository: "postgresql_native", ...result.rows[0], scope: companyId || "*" };
}
