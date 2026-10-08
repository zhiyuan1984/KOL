import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePostgresPool, postgresPool, postgresTransaction } from "../src/postgres/pool.js";

let connect: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/isolated_mock";
  connect = vi.spyOn(postgresPool(), "connect");
  vi.useFakeTimers();
});
afterEach(async () => { vi.restoreAllMocks(); await closePostgresPool(); vi.useRealTimers(); });
function client() { return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }; }
const conflict = () => Object.assign(new Error("serialization failure"), { code: "40001" });
function provide(c: ReturnType<typeof client>) { connect.mockResolvedValueOnce(c as never); }

describe("PostgreSQL transaction bounded retry", () => {
  it("rolls back 40001, then commits a retry and releases both clients", async () => {
    const first = client(); const second = client();
    provide(first); provide(second);
    const action = vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce("ok");
    const result = postgresTransaction(action);
    await vi.runAllTimersAsync();
    expect(await result).toBe("ok");
    expect(action).toHaveBeenCalledTimes(2);
    expect(first.query).toHaveBeenCalledWith("ROLLBACK");
    expect(second.query).toHaveBeenCalledWith("COMMIT");
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.release).toHaveBeenCalledTimes(1);
  });
  it("stops after three retries and preserves the exhausted error", async () => {
    const clients = Array.from({ length: 4 }, client);
    for (const c of clients) provide(c);
    const error = conflict();
    const action = vi.fn().mockRejectedValue(error);
    const result = postgresTransaction(action).catch(e => e);
    await vi.runAllTimersAsync();
    expect(await result).toBe(error);
    expect(action).toHaveBeenCalledTimes(4);
    for (const c of clients) expect(c.release).toHaveBeenCalledTimes(1);
  });
  it("does not retry non-serialization errors", async () => {
    const c = client(); provide(c);
    const error = Object.assign(new Error("unique violation"), { code: "23505" });
    const action = vi.fn().mockRejectedValue(error);
    await expect(postgresTransaction(action)).rejects.toBe(error);
    expect(action).toHaveBeenCalledTimes(1);
    expect(c.query).toHaveBeenCalledWith("ROLLBACK");
    expect(c.release).toHaveBeenCalledTimes(1);
  });
  it("supports explicitly disabling serialization retries", async () => {
    const c = client(); provide(c);
    const action = vi.fn().mockRejectedValue(conflict());
    await expect(postgresTransaction(action, { maxRetries: 0 })).rejects.toMatchObject({ code: "40001" });
    expect(action).toHaveBeenCalledTimes(1);
    expect(c.release).toHaveBeenCalledTimes(1);
  });
});
