import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePostgresPool, postgresPool, postgresTransaction } from "../src/postgres/pool.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
let connect: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/isolated_mock";
  connect = vi.spyOn(postgresPool(), "connect");
  vi.useFakeTimers();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closePostgresPool();
  vi.useRealTimers();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});
function client() {
  return { query: vi.fn(async (sql: string) => ({ rows: [], command: sql.split(" ")[0], rowCount: 0 })), release: vi.fn() };
}
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
  it("retries a PostgreSQL deadlock only after rollback and releases both clients", async () => {
    const first = client(); const second = client();
    provide(first); provide(second);
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const action = vi.fn().mockRejectedValueOnce(deadlock).mockResolvedValueOnce("ok");
    const pending = postgresTransaction(action);
    await vi.runAllTimersAsync();
    expect(await pending).toBe("ok");
    expect(action).toHaveBeenCalledTimes(2);
    expect(first.query).toHaveBeenCalledWith("ROLLBACK");
    expect(second.query).toHaveBeenCalledWith("COMMIT");
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.release).toHaveBeenCalledTimes(1);
  });
  it("rejects a ROLLBACK command returned by COMMIT rather than announcing success", async () => {
    const c = client();
    c.query.mockImplementation(async sql => ({ rows: [], command: sql === "COMMIT" ? "ROLLBACK" : sql.split(" ")[0], rowCount: 0 }));
    provide(c);
    const action = vi.fn().mockResolvedValue("must-not-escape");
    await expect(postgresTransaction(action)).rejects.toThrow("rolled back rather than committed");
    expect(action).toHaveBeenCalledTimes(1);
    expect(c.release).toHaveBeenCalledTimes(1);
  });
  it("does not rerun side effects after an ambiguous connection failure on COMMIT", async () => {
    const c = client();
    const failure = Object.assign(new Error("connection lost on COMMIT"), { code: "ECONNRESET" });
    c.query.mockImplementation(async sql => {
      if (sql === "COMMIT") throw failure;
      return { rows: [], command: sql.split(" ")[0], rowCount: 0 };
    });
    provide(c);
    const action = vi.fn().mockResolvedValue("pending-outcome");
    await expect(postgresTransaction(action)).rejects.toBe(failure);
    expect(action).toHaveBeenCalledTimes(1);
    expect(c.release).toHaveBeenCalledTimes(1);
  });
});
