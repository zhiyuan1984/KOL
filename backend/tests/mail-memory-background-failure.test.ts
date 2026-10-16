import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../src/db.js";
import * as pool from "../src/postgres/pool.js";
import * as summary from "../src/host/mail-summary.js";
import * as nativeMail from "../src/postgres/mail-memory-repository.js";
import { triggerMailMemoryIncrement } from "../src/host/mail-memory-job.js";

let savedIntentLlmMode: string | undefined;
let savedDatabaseUrl: string | undefined;
beforeEach(() => {
  savedIntentLlmMode = process.env.INTENT_LLM_MODE;
  savedDatabaseUrl = process.env.DATABASE_URL;
  // The worker imports this capability once. Set the real-mode test condition
  // directly rather than depending on a namespace spy to rewrite that binding.
  process.env.INTENT_LLM_MODE = "real";
  // The increment now enters native PostgreSQL directly. Make that real entry
  // fail before a connection is obtained, then observe the detached audit path.
  delete process.env.DATABASE_URL;
});
afterEach(() => {
  vi.restoreAllMocks();
  if (savedIntentLlmMode === undefined) delete process.env.INTENT_LLM_MODE;
  else process.env.INTENT_LLM_MODE = savedIntentLlmMode;
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
});

describe("detached mail memory failure", () => {
  it("records a failed increment without blocking the API's synchronous connection", async () => {
    vi.spyOn(summary, "remoteMailAnalysisEnabled").mockReturnValue(true);
    vi.spyOn(db, "getConn").mockImplementation(() => { throw new Error("database unavailable"); });
    vi.spyOn(nativeMail, "createNativeMemoryRun").mockRejectedValue(new Error("database unavailable"));
    const syncAudit = vi.spyOn(db, "audit");
    let finish!: (rows: never[]) => void;
    const pending = new Promise<never[]>(resolve => { finish = resolve; });
    const query = vi.spyOn(pool, "postgresQuery").mockReturnValue(pending);
    (await triggerMailMemoryIncrement("background-failure-test"));
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(syncAudit).not.toHaveBeenCalled();
    (await triggerMailMemoryIncrement("background-failure-test"));
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]?.[2]).toBe("mail_memory.increment_failed");
    finish([]);
    await pending;
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it("contains an audit failure and releases the mailbox for later retries", async () => {
    vi.spyOn(summary, "remoteMailAnalysisEnabled").mockReturnValue(true);
    vi.spyOn(db, "getConn").mockImplementation(() => { throw new Error("database unavailable"); });
    vi.spyOn(nativeMail, "createNativeMemoryRun").mockRejectedValue(new Error("database unavailable"));
    const query = vi.spyOn(pool, "postgresQuery").mockRejectedValue(new Error("audit database unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    (await triggerMailMemoryIncrement("background-audit-failure-test"));
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    (await triggerMailMemoryIncrement("background-audit-failure-test"));
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2));
    expect(query).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]).toEqual(["[mail-memory] increment failed; failure audit unavailable"]);
  });
});
