import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "../src/db.js";
import * as pool from "../src/postgres/pool.js";
import * as summary from "../src/host/mail-summary.js";
import { triggerMailMemoryIncrement } from "../src/host/mail-memory-job.js";

afterEach(() => vi.restoreAllMocks());

describe("detached mail memory failure", () => {
  it("records a failed increment without blocking the API's synchronous connection", async () => {
    vi.spyOn(summary, "remoteMailAnalysisEnabled").mockReturnValue(true);
    vi.spyOn(db, "getConn").mockImplementation(() => { throw new Error("database unavailable"); });
    const syncAudit = vi.spyOn(db, "audit");
    let finish!: (rows: never[]) => void;
    const pending = new Promise<never[]>(resolve => { finish = resolve; });
    const query = vi.spyOn(pool, "postgresQuery").mockReturnValue(pending);
    triggerMailMemoryIncrement("background-failure-test");
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(syncAudit).not.toHaveBeenCalled();
    triggerMailMemoryIncrement("background-failure-test");
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]?.[2]).toBe("mail_memory.increment_failed");
    finish([]);
    await pending;
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it("contains an audit failure and releases the mailbox for later retries", async () => {
    vi.spyOn(summary, "remoteMailAnalysisEnabled").mockReturnValue(true);
    vi.spyOn(db, "getConn").mockImplementation(() => { throw new Error("database unavailable"); });
    const query = vi.spyOn(pool, "postgresQuery").mockRejectedValue(new Error("audit database unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    triggerMailMemoryIncrement("background-audit-failure-test");
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    triggerMailMemoryIncrement("background-audit-failure-test");
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2));
    expect(query).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]).toEqual(["[mail-memory] increment failed; failure audit unavailable"]);
  });
});
