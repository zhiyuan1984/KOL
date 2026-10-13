import { postgresQuery } from "../postgres/pool.js";

export type SkillPersonalRow = { skill_id: string; favorite: boolean; viewed_at: string | null; use_count: number; used_at: string | null };

/** Visibility is supplied by the authenticated Agent projection before any query. */
export async function employeeSkillPreferences(userId: string, visibleIds: string[]): Promise<SkillPersonalRow[]> {
  if (!visibleIds.length) return [];
  const rows = await postgresQuery<{ skill_id: string; favorite: boolean; viewed_at: string | null; use_count: string; used_at: string | null }>(`
    WITH usage AS (
      SELECT skill, COUNT(*) AS use_count, MAX(started_at) AS used_at
      FROM tickets WHERE owner_user_id=$1 AND skill=ANY($2::text[])
        AND started_at IS NOT NULL AND deleted_at IS NULL GROUP BY skill
    )
    SELECT s.skill_id, COALESCE(p.favorite,false) AS favorite, p.viewed_at::text,
      COALESCE(u.use_count,0)::text AS use_count, u.used_at
    FROM unnest($2::text[]) AS s(skill_id)
    LEFT JOIN employee_skill_preferences p ON p.skill_id=s.skill_id AND p.user_id=$1
    LEFT JOIN usage u ON u.skill=s.skill_id
  `, [userId, visibleIds]);
  return rows.map(row => ({ ...row, use_count: Number(row.use_count) }));
}

export async function setEmployeeSkillFavorite(userId: string, skillId: string, favorite: boolean): Promise<void> {
  await postgresQuery(`INSERT INTO employee_skill_preferences(user_id,skill_id,favorite) VALUES($1,$2,$3)
    ON CONFLICT(user_id,skill_id) DO UPDATE SET favorite=EXCLUDED.favorite`, [userId, skillId, favorite]);
}

export async function recordEmployeeSkillView(userId: string, skillId: string): Promise<void> {
  await postgresQuery(`INSERT INTO employee_skill_preferences(user_id,skill_id,viewed_at) VALUES($1,$2,now())
    ON CONFLICT(user_id,skill_id) DO UPDATE SET viewed_at=EXCLUDED.viewed_at`, [userId, skillId]);
}
