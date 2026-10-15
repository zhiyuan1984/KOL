import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";
import type { Json } from "../src/types.js";

const { pageKolProfilesMock, withStarryConnectorAuthMock } = vi.hoisted(() => ({
  pageKolProfilesMock: vi.fn(),
  withStarryConnectorAuthMock: vi.fn((action: () => unknown) => action()),
}));
// This is deliberately a synthetic fixture: the regression never calls Starry or reads customer details.
vi.mock("../src/host/starry-connectors.js", () => ({
  pageKolProfiles: pageKolProfilesMock,
}));
vi.mock("../src/starrykol/service.js", () => ({
  withStarryConnectorAuth: withStarryConnectorAuthMock,
}));

const { syncKolProfileIndexPostgres } = await import(
  "../src/postgres/kol-pool-sync.js"
);
const company = "company:pool-sync-native-fixture";
let previousCompany: string | undefined;

function profile(kolUid: string, fields: Json = {}): Json {
  return {
    kolUid,
    kolName: `Fixture ${kolUid}`,
    platform: "fixture-platform",
    followerCountTenThousands: 2,
    avgVideoViews10: 200,
    avgVideoEngagementRate10: "2.0",
    ownerOpenId: `owner-${kolUid}`,
    ownerMailbox: `${kolUid}@fixture.test`,
    brandCode: "fixture-brand",
    ...fields,
  };
}

async function seedPreviousSnapshot(): Promise<void> {
  const pg = postgresPool();
  await pg.query(
    `INSERT INTO kol_profile_index
      (id,company_id,kol_uid,handle,display_name,platform,followers,avg_plays,engagement,ingest_source,pool_status,idle,source_version,source_batch,created_at,updated_at)
     VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,0,$11,$11,$11,$11)`,
    [
      "old-cache",
      company,
      "fixture-zero",
      "legacy handle",
      "legacy platform",
      "legacy followers",
      "legacy plays",
      "legacy engagement",
      "starry.pageKolProfiles",
      "open",
      "old-version",
    ],
  );
  await pg.query(
    `INSERT INTO starry_profile_ownership(company_id,kol_uid,owner_open_id,owner_mailbox,brand,source_version,synced_at)
     VALUES($1,$2,$3,$4,$5,$6,$6)`,
    [
      company,
      "fixture-zero",
      "old-owner",
      "old-owner@fixture.test",
      "old-brand",
      "old-version",
    ],
  );
  await pg.query(
    `INSERT INTO starry_ownership_sync_state
       (company_id,state,source_version,profile_count,error,updated_at,last_success_at,last_attempt_at,last_run_id)
     VALUES($1,$2,$3,1,NULL,$3,$3,$3,$4)`,
    [company, "ready", "old-version", "old-run"],
  );
}

async function expectPreviousAuthorityPreserved(runId: string): Promise<void> {
  const pg = postgresPool();
  const cache = await pg.query<{ handle: string; source_version: string }>(
    "SELECT handle,source_version FROM kol_profile_index WHERE company_id=$1 AND kol_uid=$2",
    [company, "fixture-zero"],
  );
  expect(cache.rows).toEqual([
    { handle: "legacy handle", source_version: "old-version" },
  ]);
  const ownership = await pg.query<{
    owner_open_id: string;
    source_version: string;
  }>(
    "SELECT owner_open_id,source_version FROM starry_profile_ownership WHERE company_id=$1 AND kol_uid=$2",
    [company, "fixture-zero"],
  );
  expect(ownership.rows).toEqual([
    { owner_open_id: "old-owner", source_version: "old-version" },
  ]);
  const state = await pg.query<{
    state: string;
    source_version: string;
    profile_count: number;
    last_run_id: string;
  }>(
    "SELECT state,source_version,profile_count,last_run_id FROM starry_ownership_sync_state WHERE company_id=$1",
    [company],
  );
  expect(state.rows).toEqual([
    {
      state: "failed",
      source_version: "old-version",
      profile_count: 1,
      last_run_id: runId,
    },
  ]);
}

beforeEach(async () => {
  previousCompany = process.env.KOL_COMPANY_ID;
  process.env.KOL_COMPANY_ID = company;
  await freshTestDatabase({ reclaimPrevious: true });
  pageKolProfilesMock.mockReset();
  withStarryConnectorAuthMock.mockClear();
});

afterEach(async () => {
  pageKolProfilesMock.mockReset();
  withStarryConnectorAuthMock.mockClear();
  if (previousCompany === undefined) delete process.env.KOL_COMPANY_ID;
  else process.env.KOL_COMPANY_ID = previousCompany;
  await closePostgresPool();
});

describe("PostgreSQL-native KOL pool snapshot sync", () => {
  it("registers the new schema, pages a synthetic snapshot, retains blank cache fields, preserves zero metrics, and re-upserts by stable UID", async () => {
    await seedPreviousSnapshot();
    const zero = profile("fixture-zero", {
      kolName: "",
      platform: "",
      followerCountTenThousands: 0,
      avgVideoViews10: 0,
      avgVideoEngagementRate10: 0,
    });
    const alpha = profile("fixture-alpha");
    const beta = profile("fixture-beta");
    pageKolProfilesMock.mockImplementation(async (args: Json) => {
      const pageNo = Number(args.pageNo);
      if (pageNo === 1) return { total: 3, list: [zero, alpha] };
      if (pageNo === 2) return { total: 3, list: [beta] };
      throw new Error(`unexpected_fixture_page_${pageNo}`);
    });

    const first = await syncKolProfileIndexPostgres(2);
    const second = await syncKolProfileIndexPostgres(2);
    expect(first).toMatchObject({
      ok: true,
      count: 3,
      pages: 2,
      expected_count: 3,
    });
    expect(second).toMatchObject({
      ok: true,
      count: 3,
      pages: 2,
      expected_count: 3,
    });
    expect(
      pageKolProfilesMock.mock.calls.map(([args]) => [
        args.pageNo,
        args.pageSize,
      ]),
    ).toEqual([
      [1, 2],
      [2, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(withStarryConnectorAuthMock).toHaveBeenCalledTimes(4);

    const pg = postgresPool();
    const schema = await pg.query<{
      ledger: number;
      table_name: string | null;
    }>(
      `SELECT (SELECT count(*)::int FROM schema_migrations WHERE id=$1) AS ledger,
              to_regclass('public.kol_pool_sync_runs')::text AS table_name`,
      ["20261015_047_pool_sync_native_schema"],
    );
    expect(schema.rows).toEqual([
      { ledger: 1, table_name: "kol_pool_sync_runs" },
    ]);
    const counts = await pg.query<{ total: number; unique_uids: number }>(
      "SELECT count(*)::int AS total,count(DISTINCT kol_uid)::int AS unique_uids FROM kol_profile_index WHERE company_id=$1",
      [company],
    );
    expect(counts.rows).toEqual([{ total: 3, unique_uids: 3 }]);
    const zeroRow = await pg.query<{
      handle: string;
      platform: string;
      followers: string;
      avg_plays: string;
      engagement: string;
    }>(
      "SELECT handle,platform,followers,avg_plays,engagement FROM kol_profile_index WHERE company_id=$1 AND kol_uid=$2",
      [company, "fixture-zero"],
    );
    expect(zeroRow.rows).toEqual([
      {
        handle: "legacy handle",
        platform: "legacy platform",
        followers: "0万",
        avg_plays: "0",
        engagement: "0",
      },
    ]);
    const runs = await pg.query<{
      status: string;
      fetched_count: number;
      upserted_count: number;
      page_count: number;
    }>(
      "SELECT status,fetched_count,upserted_count,page_count FROM kol_pool_sync_runs WHERE company_id=$1 ORDER BY started_at",
      [company],
    );
    expect(runs.rows).toHaveLength(2);
    expect(runs.rows).toEqual(
      expect.arrayContaining([
        {
          status: "succeeded",
          fetched_count: 3,
          upserted_count: 3,
          page_count: 2,
        },
      ]),
    );
  });

  it("rejects a duplicated UID across synthetic pages without replacing the last complete authority snapshot", async () => {
    await seedPreviousSnapshot();
    const duplicate = profile("fixture-duplicate");
    pageKolProfilesMock.mockImplementation(async (args: Json) => {
      if (Number(args.pageNo) === 1) return { total: 2, list: [duplicate] };
      return { total: 2, list: [duplicate] };
    });

    const result = await syncKolProfileIndexPostgres(1);
    expect(result).toMatchObject({
      ok: false,
      count: 1,
      pages: 2,
      expected_count: 2,
      error: "starry_snapshot_duplicate_or_missing_uid",
    });
    await expectPreviousAuthorityPreserved(result.run_id);
    const pg = postgresPool();
    const run = await pg.query<{
      status: string;
      fetched_count: number;
      upserted_count: number;
    }>(
      "SELECT status,fetched_count,upserted_count FROM kol_pool_sync_runs WHERE id=$1",
      [result.run_id],
    );
    expect(run.rows).toEqual([
      { status: "failed", fetched_count: 1, upserted_count: 0 },
    ]);
  });

  it("rejects an omitted total instead of treating null, undefined, or an empty value as a zero-record snapshot", async () => {
    await seedPreviousSnapshot();
    pageKolProfilesMock.mockResolvedValue({ list: [] });

    const result = await syncKolProfileIndexPostgres(2);
    expect(result).toMatchObject({
      ok: false,
      count: 0,
      pages: 1,
      expected_count: 0,
      error: "starry_snapshot_total_missing",
    });
    await expectPreviousAuthorityPreserved(result.run_id);
    expect(withStarryConnectorAuthMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back an injected batch write failure and records failure without deleting the last authority cache or ownership facts", async () => {
    await seedPreviousSnapshot();
    const pg = postgresPool();
    await pg.query(`CREATE FUNCTION fixture_reject_pool_sync_row() RETURNS trigger AS $$
      BEGIN
        IF NEW.kol_uid = 'fixture-reject' THEN RAISE EXCEPTION 'fixture_pool_sync_batch_rejected'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await pg.query(
      "CREATE TRIGGER fixture_reject_pool_sync_row BEFORE INSERT OR UPDATE ON kol_profile_index FOR EACH ROW EXECUTE FUNCTION fixture_reject_pool_sync_row()",
    );
    pageKolProfilesMock.mockResolvedValue({
      total: 2,
      list: [profile("fixture-inserted"), profile("fixture-reject")],
    });

    const result = await syncKolProfileIndexPostgres(2);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("fixture_pool_sync_batch_rejected");
    await expectPreviousAuthorityPreserved(result.run_id);
    const newRows = await pg.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM kol_profile_index WHERE company_id=$1 AND kol_uid=ANY($2::text[])",
      [company, ["fixture-inserted", "fixture-reject"]],
    );
    expect(newRows.rows).toEqual([{ total: 0 }]);
    const run = await pg.query<{
      status: string;
      fetched_count: number;
      upserted_count: number;
      page_count: number;
    }>(
      "SELECT status,fetched_count,upserted_count,page_count FROM kol_pool_sync_runs WHERE id=$1",
      [result.run_id],
    );
    expect(run.rows).toEqual([
      { status: "failed", fetched_count: 2, upserted_count: 0, page_count: 1 },
    ]);
  });
});
