import { expect, it, vi } from "vitest";
import { trackBackgroundWork, drainBackgroundWork } from "../src/background-work.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";

it("keeps the caller non-blocking while shutdown awaits completion", async () => {
  let release!: (value: number) => void;
  const tracked = trackBackgroundWork(new Promise<number>((resolve) => { release = resolve; }), "test.gated");
  let drained = false;
  const shutdown = drainBackgroundWork().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  release(42);
  await shutdown;
  expect(await tracked).toBe(42);
});

it("also drains work registered by an already-running callback", async () => {
  let release!: () => void;
  trackBackgroundWork(Promise.resolve().then(() => {
    trackBackgroundWork(new Promise<void>((resolve) => { release = resolve; }), "test.child");
  }), "test.parent");
  let drained = false;
  const shutdown = drainBackgroundWork().then(() => { drained = true; });
  await Promise.resolve();
  await Promise.resolve();
  expect(drained).toBe(false);
  release();
  await shutdown;
});

it("surfaces original background failures rather than silently accepting teardown", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const reason = new Error("fixture background audit failed");
  try {
    trackBackgroundWork(Promise.reject(reason), "test.failure");
    await expect(drainBackgroundWork()).rejects.toMatchObject({ errors: [reason] });
    await expect(drainBackgroundWork()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[background-work] task failed", { label: "test.failure", error_type: "Error" });
  } finally { log.mockRestore(); }
});

it("does not declare an unfinished callback complete after the close deadline", async () => {
  let release!: () => void;
  trackBackgroundWork(new Promise<void>((resolve) => { release = resolve; }), "test.timeout");
  await expect(drainBackgroundWork(10)).rejects.toThrow("database close deadline");
  release();
  await expect(drainBackgroundWork()).resolves.toBeUndefined();
});

it("allows a pending native PG write to finish before closing its pool", async () => {
  const pool = postgresPool();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let receipt: number | undefined;
  trackBackgroundWork(gate.then(async () => {
    receipt = (await pool.query<{ receipt: number }>("SELECT 42::int AS receipt")).rows[0]?.receipt;
  }), "test.pg.write");
  let closed = false;
  const closing = closePostgresPool().then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  await closing;
  expect(receipt).toBe(42);
});
