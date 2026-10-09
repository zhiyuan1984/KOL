import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { parsePoolPageOptions, readPublicPoolPage } from "../src/postgres/public-pool.js";
import { freshTestDatabase } from "./support/pg.js";

describe("public pool page contract", () => {
  it("bounds request cost and rejects unknown SQL sort inputs", () => {
    expect(parsePoolPageOptions({})).toEqual({ query: "", filter: "all", sort: "score-desc", offset: 0, limit: 50 });
    const invalid: Record<string, string>[] = [{ limit: "101" }, { limit: "0" }, { offset: "-1" }, { offset: "1.2" },
      { filter: "private" }, { sort: "id; DROP TABLE users" }, { query: "x".repeat(201) }];
    for (const input of invalid) {
      expect(() => parsePoolPageOptions(input)).toThrow("公海分页或筛选参数无效");
    }
  });
});

describe("native PostgreSQL public pool pages", () => {
  beforeAll(async () => { await freshTestDatabase(); });
  beforeEach(async () => {
    await postgresPool().query("DELETE FROM kol_follow_index; DELETE FROM kol_profile_index; DELETE FROM app_state WHERE key='starry_library_sync'");
  });
  afterAll(async () => { await closePostgresPool(); });

  async function seed(count = 123) {
    await postgresPool().query(`INSERT INTO kol_profile_index
      (id, company_id, kol_uid, handle, display_name, platform, homepage_url, followers,
       potential_score, pool_status, public_stage, ingested_at, created_at, updated_at)
      SELECT 'pool_' || n, 'company:amperetime', 'uid_' || n, '测试' || n, '测试' || n, 'youtube',
        'https://youtube.com/@test' || n, n::text, n % 100, 'open', 'INITIAL_CONTACT',
        '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z'
      FROM generate_series(1, $1::integer) n`, [count]);
  }

  it("returns bounded ordered pages without duplicates, private fields or the duplicate kols array", async () => {
    await seed();
    await postgresPool().query("UPDATE kol_profile_index SET pool_status='claimed' WHERE id='pool_123'");
    await postgresPool().query("UPDATE kol_profile_index SET company_id='other' WHERE id='pool_122'");
    await postgresPool().query("INSERT INTO app_state(key,value) VALUES ('starry_library_sync', $1)", [JSON.stringify({ ok: true, count: 500 })]);
    const options = parsePoolPageOptions({ sort: "followers-desc" });
    const first = await readPublicPoolPage(options, "company:amperetime");
    const second = await readPublicPoolPage({ ...options, offset: 50 }, "company:amperetime");
    const last = await readPublicPoolPage({ ...options, offset: 100 }, "company:amperetime");
    expect(first.page).toMatchObject({ total: 121, matched: 121, limit: 50, next_offset: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.kol_uid).toBe("uid_121");
    expect(last.items).toHaveLength(21);
    expect(last.page.next_offset).toBeNull();
    expect(new Set([...first.items, ...second.items, ...last.items].map((row) => row.kol_uid)).size).toBe(121);
    expect(first.library.count).toBe(500);
    expect(first).toMatchObject({ creates_session: false, calls_model: false });
    expect(first).not.toHaveProperty("kols");
    expect(first.items[0]).not.toHaveProperty("assessment_error");
    expect(first.items[0]).not.toHaveProperty("profile_key");
  });

  it("uses the latest release, keeps filters and counts in the same snapshot, and treats wildcard search literally", async () => {
    await seed(3);
    await postgresPool().query(`INSERT INTO kol_follow_index
      (id, company_id, kol_uid, scope_brand, employee_id, status, claimed_at, released_at, release_reason, created_at, updated_at)
      VALUES ('f1', 'company:amperetime', 'uid_1', 'LT', 'employee', 'released', '2026-01-01', '2026-01-02', 'ownership-release', '2026-01-01', '2026-01-02'),
             ('f2', 'company:amperetime', 'uid_2', 'LT', 'employee', 'released', '2026-01-01', '2026-01-02', 'ownership-release', '2026-01-01', '2026-01-02'),
             ('f3', 'company:amperetime', 'uid_2', 'LT', 'employee', 'released', '2026-01-03', '2026-01-04', 'claim_undo', '2026-01-03', '2026-01-04')`);
    const overdue = await readPublicPoolPage(parsePoolPageOptions({ filter: "overdue" }), "company:amperetime");
    expect(overdue.items.map((row) => row.kol_uid)).toEqual(["uid_1"]);
    expect(overdue.items[0]?.public_stage).toBe("14天无回复");
    expect(overdue.page).toMatchObject({ total: 3, matched: 1, new_count: 2, overdue_count: 1 });
    const search = await readPublicPoolPage(parsePoolPageOptions({ query: "测试2" }), "company:amperetime");
    expect(search.items.map((row) => row.kol_uid)).toEqual(["uid_2"]);
    expect(search.page).toMatchObject({ total: 3, matched: 1, new_count: 1, overdue_count: 0 });
    const searchStage = await readPublicPoolPage(parsePoolPageOptions({ query: "测试2", filter: "overdue" }), "company:amperetime");
    expect(searchStage.page).toMatchObject({ total: 3, matched: 0, new_count: 1, overdue_count: 0 });
    // One stored follower becomes the displayed “100.0%”; percent is a literal,
    // so it must not expand to every row as it would with an unescaped LIKE.
    expect((await readPublicPoolPage(parsePoolPageOptions({ query: "%" }), "company:amperetime")).items.map((row) => row.kol_uid)).toEqual(["uid_1"]);
    expect((await readPublicPoolPage(parsePoolPageOptions({ query: "测试_" }), "company:amperetime")).items).toHaveLength(0);
  });

  it("deduplicates public profiles before counting and paging, preferring complete data", async () => {
    await seed(2);
    await postgresPool().query("UPDATE kol_profile_index SET homepage_url='https://youtube.com/@test1/', avatar_url='https://example.com/avatar' WHERE id='pool_2'");
    const result = await readPublicPoolPage(parsePoolPageOptions({}), "company:amperetime");
    expect(result.page.total).toBe(1);
    expect(result.items[0]?.kol_uid).toBe("uid_2");
  });

  it("keeps generated homepage identities and searches for displayed metrics consistent across pages", async () => {
    await seed(3);
    await postgresPool().query("UPDATE kol_profile_index SET homepage_url='https://www.youtube.com/@test1', followers='120000', engagement='0.042' WHERE id='pool_1'");
    await postgresPool().query("UPDATE kol_profile_index SET homepage_url='', handle='test1', display_name='test1', avatar_url='https://example.com/avatar', followers='120000', engagement='0.042' WHERE id='pool_2'");
    const result = await readPublicPoolPage(parsePoolPageOptions({ query: "12万" }), "company:amperetime");
    expect(result.page).toMatchObject({ total: 2, matched: 1 });
    expect(result.items[0]?.kol_uid).toBe("uid_2");
    expect((await readPublicPoolPage(parsePoolPageOptions({ query: "4.2%" }), "company:amperetime")).items[0]?.kol_uid).toBe("uid_2");
  });

  it("sorts numeric follower units and returns counts even for an empty or out-of-range page", async () => {
    await seed(3);
    await postgresPool().query("UPDATE kol_profile_index SET followers=CASE id WHEN 'pool_1' THEN '1.2万' WHEN 'pool_2' THEN '2k' ELSE 'unknown' END");
    const options = parsePoolPageOptions({ sort: "followers-desc" });
    const result = await readPublicPoolPage(options, "company:amperetime");
    expect(result.items.map((row) => row.kol_uid)).toEqual(["uid_1", "uid_2", "uid_3"]);
    const empty = await readPublicPoolPage({ ...options, offset: 50 }, "company:amperetime");
    expect(empty.items).toEqual([]);
    expect(empty.page).toMatchObject({ total: 3, matched: 3, next_offset: null });
  });
});
