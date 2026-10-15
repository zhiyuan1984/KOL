import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closePostgresPool,
  currentTransactionClient,
  postgresPool,
  postgresTransaction,
} from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";
import type { Json } from "../src/types.js";

const { pageKolProfilesMock, withStarryConnectorAuthMock } = vi.hoisted(() => ({
  pageKolProfilesMock: vi.fn(),
  withStarryConnectorAuthMock: vi.fn(),
}));

// Only the external Starry boundary is synthetic. PostgreSQL and the pool-sync
// implementation remain real so locks, transactions, and rollback are exercised.
vi.mock("../src/host/starry-connectors.js", () => ({
  pageKolProfiles: pageKolProfilesMock,
}));
vi.mock("../src/starrykol/service.js", () => ({
  withStarryConnectorAuth: withStarryConnectorAuthMock,
}));

const { syncKolProfileIndexPostgres } = await import(
  "../src/postgres/kol-pool-sync.js"
);

const company = "company:pool-sync-concurrency-fixture";
let previousCompany: string | undefined;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type AuthoritySnapshot = {
  profiles: Array<{
    kol_uid: string;
    display_name: string;
    pool_status: string;
    source_version: string;
  }>;
  ownership: Array<{
    kol_uid: string;
    owner_open_id: string;
    owner_mailbox: string;
    source_version: string;
  }>;
  state: {
    state: string;
    source_version: string;
    profile_count: number;
    error: string | null;
    updated_at: string;
    last_success_at: string | null;
    last_attempt_at: string | null;
    last_run_id: string | null;
  };
};

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

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

async function authoritySnapshot(): Promise<AuthoritySnapshot> {
  const pg = postgresPool();
  const profiles = await pg.query<AuthoritySnapshot["profiles"][number]>(
    `SELECT kol_uid,display_name,pool_status,source_version
       FROM kol_profile_index
      WHERE company_id=$1
      ORDER BY kol_uid`,
    [company],
  );
  const ownership = await pg.query<AuthoritySnapshot["ownership"][number]>(
    `SELECT kol_uid,owner_open_id,owner_mailbox,source_version
       FROM starry_profile_ownership
      WHERE company_id=$1
      ORDER BY kol_uid`,
    [company],
  );
  const state = await pg.query<AuthoritySnapshot["state"]>(
    `SELECT state,source_version,profile_count,error,updated_at,last_success_at,last_attempt_at,last_run_id
       FROM starry_ownership_sync_state
      WHERE company_id=$1`,
    [company],
  );
  expect(state.rows).toHaveLength(1);
  return { profiles: profiles.rows, ownership: ownership.rows, state: state.rows[0]! };
}

async function runReceipt(runId: string): Promise<{
  status: string;
  expected_count: number | null;
  fetched_count: number;
  upserted_count: number;
  page_count: number;
  error: string | null;
}> {
  const result = await postgresPool().query<{
    status: string;
    expected_count: number | null;
    fetched_count: number;
    upserted_count: number;
    page_count: number;
    error: string | null;
  }>(
    `SELECT status,expected_count,fetched_count,upserted_count,page_count,error
       FROM kol_pool_sync_runs
      WHERE id=$1`,
    [runId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

beforeEach(async () => {
  previousCompany = process.env.KOL_COMPANY_ID;
  process.env.KOL_COMPANY_ID = company;
  await freshTestDatabase({ reclaimPrevious: true });
  pageKolProfilesMock.mockReset();
  withStarryConnectorAuthMock.mockReset();
  withStarryConnectorAuthMock.mockImplementation(async (action: () => unknown) => {
    // The actual external call is always outside a PostgreSQL transaction.
    expect(currentTransactionClient()).toBeUndefined();
    return action();
  });
});

afterEach(async () => {
  pageKolProfilesMock.mockReset();
  withStarryConnectorAuthMock.mockReset();
  if (previousCompany === undefined) delete process.env.KOL_COMPANY_ID;
  else process.env.KOL_COMPANY_ID = previousCompany;
  await closePostgresPool();
});

describe("PostgreSQL KOL pool snapshot latest-run ownership", () => {
  it("keeps B's ready snapshot when slower A completes successfully after B", async () => {
    const aEnteredApi = deferred<void>();
    const releaseA = deferred<Json>();
    let calls = 0;
    pageKolProfilesMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        aEnteredApi.resolve();
        return releaseA.promise;
      }
      if (calls === 2) return { total: 1, list: [profile("b-current")] };
      throw new Error(`unexpected_fixture_call_${calls}`);
    });

    const slowA = syncKolProfileIndexPostgres(10);
    await aEnteredApi.promise;
    const currentB = await syncKolProfileIndexPostgres(10);
    expect(currentB).toMatchObject({ ok: true, count: 1, pages: 1, expected_count: 1 });
    const bSnapshot = await authoritySnapshot();
    expect(bSnapshot).toMatchObject({
      profiles: [expect.objectContaining({ kol_uid: "b-current", pool_status: "open" })],
      ownership: [expect.objectContaining({ kol_uid: "b-current", owner_open_id: "owner-b-current" })],
      state: expect.objectContaining({ state: "ready", profile_count: 1, last_run_id: currentB.run_id }),
    });

    releaseA.resolve({ total: 1, list: [profile("a-stale-success")] });
    const staleA = await slowA;
    expect(staleA).toMatchObject({
      ok: false,
      count: 1,
      pages: 1,
      expected_count: 1,
      error: "starry_pool_sync_superseded",
    });
    expect(await authoritySnapshot()).toEqual(bSnapshot);
    await expect(runReceipt(currentB.run_id)).resolves.toEqual({
      status: "succeeded",
      expected_count: 1,
      fetched_count: 1,
      upserted_count: 1,
      page_count: 1,
      error: null,
    });
    await expect(runReceipt(staleA.run_id)).resolves.toEqual({
      status: "failed",
      expected_count: 1,
      fetched_count: 1,
      upserted_count: 0,
      page_count: 1,
      error: "starry_pool_sync_superseded",
    });
  });

  it("keeps B's ready snapshot when slower A fails after B", async () => {
    const aEnteredApi = deferred<void>();
    const rejectA = deferred<Json>();
    let calls = 0;
    pageKolProfilesMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        aEnteredApi.resolve();
        return rejectA.promise;
      }
      if (calls === 2) return { total: 1, list: [profile("b-after-a-failure")] };
      throw new Error(`unexpected_fixture_call_${calls}`);
    });

    const slowA = syncKolProfileIndexPostgres(10);
    await aEnteredApi.promise;
    const currentB = await syncKolProfileIndexPostgres(10);
    expect(currentB.ok).toBe(true);
    const bSnapshot = await authoritySnapshot();

    rejectA.reject(new Error("fixture_slow_a_api_failure"));
    const staleA = await slowA;
    expect(staleA).toMatchObject({
      ok: false,
      count: 0,
      pages: 1,
      expected_count: 0,
      error: "fixture_slow_a_api_failure",
    });
    expect(await authoritySnapshot()).toEqual(bSnapshot);
    await expect(runReceipt(staleA.run_id)).resolves.toEqual({
      status: "failed",
      expected_count: null,
      fetched_count: 0,
      upserted_count: 0,
      page_count: 1,
      error: "fixture_slow_a_api_failure",
    });
  });

  it("is idempotent for a stable same-source snapshot and keeps one row per stable UID", async () => {
    pageKolProfilesMock.mockResolvedValue({
      total: 2,
      list: [profile("stable-alpha"), profile("stable-beta")],
    });

    const first = await syncKolProfileIndexPostgres(10);
    const second = await syncKolProfileIndexPostgres(10);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, count: 2, pages: 1, expected_count: 2 });
    const actual = await authoritySnapshot();
    expect(actual.profiles).toHaveLength(2);
    expect(actual.profiles.map((row) => row.kol_uid)).toEqual(["stable-alpha", "stable-beta"]);
    expect(actual.ownership).toHaveLength(2);
    expect(actual.state).toMatchObject({
      state: "ready",
      profile_count: 2,
      last_run_id: second.run_id,
    });
    expect(
      (await postgresPool().query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM kol_profile_index
          WHERE company_id=$1`,
        [company],
      )).rows,
    ).toEqual([{ total: 2 }]);
  });

  it("refuses an ambient transaction before any network call or run/state write", async () => {
    await expect(
      postgresTransaction(async () => {
        expect(currentTransactionClient()).toBeDefined();
        return syncKolProfileIndexPostgres(10);
      }),
    ).rejects.toThrow("refuses ambient PostgreSQL transaction");
    expect(pageKolProfilesMock).not.toHaveBeenCalled();
    expect(withStarryConnectorAuthMock).not.toHaveBeenCalled();
    expect(
      (await postgresPool().query<{ total: number }>(
        "SELECT count(*)::int AS total FROM kol_pool_sync_runs WHERE company_id=$1",
        [company],
      )).rows,
    ).toEqual([{ total: 0 }]);
    expect(
      (await postgresPool().query<{ total: number }>(
        "SELECT count(*)::int AS total FROM starry_ownership_sync_state WHERE company_id=$1",
        [company],
      )).rows,
    ).toEqual([{ total: 0 }]);
  });

  it("rolls back profile, ownership, and ready-state replacement when an ownership write fails", async () => {
    pageKolProfilesMock.mockResolvedValue({ total: 1, list: [profile("baseline")] });
    const baseline = await syncKolProfileIndexPostgres(10);
    expect(baseline.ok).toBe(true);
    const before = await authoritySnapshot();
    const pg = postgresPool();
    await pg.query(`CREATE FUNCTION fixture_reject_pool_owner_write() RETURNS trigger AS $$
      BEGIN
        IF NEW.kol_uid = 'reject-owner' THEN RAISE EXCEPTION 'fixture_pool_sync_owner_rejected'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await pg.query(
      "CREATE TRIGGER fixture_reject_pool_owner_write BEFORE INSERT ON starry_profile_ownership FOR EACH ROW EXECUTE FUNCTION fixture_reject_pool_owner_write()",
    );
    pageKolProfilesMock.mockResolvedValue({
      total: 2,
      list: [profile("new-profile"), profile("reject-owner")],
    });

    const failed = await syncKolProfileIndexPostgres(10);
    expect(failed).toMatchObject({
      ok: false,
      count: 2,
      pages: 1,
      expected_count: 2,
      error: expect.stringContaining("fixture_pool_sync_owner_rejected"),
    });
    const after = await authoritySnapshot();
    expect(after.profiles).toEqual(before.profiles);
    expect(after.ownership).toEqual(before.ownership);
    expect(after.state).toMatchObject({
      state: "failed",
      source_version: before.state.source_version,
      profile_count: before.state.profile_count,
      updated_at: before.state.updated_at,
      last_success_at: before.state.last_success_at,
      last_run_id: failed.run_id,
    });
    await expect(runReceipt(failed.run_id)).resolves.toMatchObject({
      status: "failed",
      expected_count: 2,
      fetched_count: 2,
      upserted_count: 0,
      page_count: 1,
      error: expect.stringContaining("fixture_pool_sync_owner_rejected"),
    });
  });
});
