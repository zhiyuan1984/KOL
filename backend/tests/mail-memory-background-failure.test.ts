import { afterEach, describe, expect, it, vi } from "vitest";
import { drainBackgroundWork } from "../src/background-work.js";
import * as db from "../src/db.js";
import * as pool from "../src/postgres/pool.js";
import * as summary from "../src/host/mail-summary.js";
import { triggerMailMemoryIncrement } from "../src/host/mail-memory-job.js";

const pendingAuditReleases: Array<() => void> = [];
const pendingAuditSettlements: Promise<unknown>[] = [];

function failNativeConnection(message = "database unavailable") {
  const nativeQuery = vi.fn().mockRejectedValue(new Error(message));
  vi.spyOn(pool, "postgresConnection").mockReturnValue({ query: nativeQuery } as unknown as ReturnType<typeof pool.postgresConnection>);
  return nativeQuery;
}

function pendingAuditQuery(): { pending: Promise<never[]>; finish: () => void } {
  let release!: () => void;
  const pending = new Promise<never[]>((resolve) => { release = () => resolve([]); });
  pendingAuditReleases.push(release);
  pendingAuditSettlements.push(pending);
  return { pending, finish: release };
}

async function flushDetachedWork(): Promise<void> {
  await drainBackgroundWork();
}

afterEach(async () => {
  for (const release of pendingAuditReleases.splice(0)) release();
  await Promise.allSettled(pendingAuditSettlements.splice(0));
  await flushDetachedWork();
  vi.restoreAllMocks();
});

describe("detached mail memory failure", () => {
  it("records a failed increment without blocking the API's synchronous connection", async () => {
    vi.spyOn(summary, "remoteMailAnalysisEnabled").mockReturnValue(true);
    vi.spyOn(db, "getConn").mockImplementation(() => { throw new Error("database unavailable"); });
    const syncAudit = vi.spyOn(db, "audit");
    const nativeQuery = failNativeConnection();
    const { pending, finish } = pendingAuditQuery();
    const query = vi.spyOn(pool, "postgresQuery").mockReturnValue(pending);
    (await triggerMailMemoryIncrement("background-failure-test"));
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(nativeQuery).toHaveBeenCalledOnce();
    expect(syncAudit).not.toHaveBeenCalled();
    (await triggerMailMemoryIncrement("background-failure-test"));
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]?.[2]).toBe("mail_memory.increment_failed");
    finish();
    await pending;
    await flushDetachedWork();
  });

  it("contains an audit failure and releases the mailbox for later retries", async () => {
    vi.spyOn(summary, "remoteMailAnalysisEnabled").mockReturnValue(true);
    vi.spyOn(db, "getConn").mockImplementation(() => { throw new Error("database unavailable"); });
    const nativeQuery = failNativeConnection();
    const query = vi.spyOn(pool, "postgresQuery").mockRejectedValue(new Error("audit database unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    (await triggerMailMemoryIncrement("background-audit-failure-test"));
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(nativeQuery).toHaveBeenCalledOnce();
    await flushDetachedWork();
    (await triggerMailMemoryIncrement("background-audit-failure-test"));
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2));
    expect(query).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]).toEqual(["[mail-memory] increment failed; failure audit unavailable"]);
  });
});
