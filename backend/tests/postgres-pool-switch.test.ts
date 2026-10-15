import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ends: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("pg", () => ({
  types: { setTypeParser: vi.fn() },
  Pool: class {
    end = vi.fn(async () => undefined);
    on() { return this; }
    constructor() { state.ends.push(this.end); }
  },
}));
let closePostgresPool: typeof import("../src/postgres/pool.js").closePostgresPool;
let postgresPool: typeof import("../src/postgres/pool.js").postgresPool;
beforeEach(async () => {
  // setup.ts preloads the real pool; isolate this unit test's fake module.
  vi.resetModules();
  ({ closePostgresPool, postgresPool } = await import("../src/postgres/pool.js"));
});
const originalUrl = process.env.DATABASE_URL;
afterEach(async () => {
  await closePostgresPool();
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
  state.ends.length = 0;
});

describe("native PostgreSQL pool switch ownership", () => {
  it("rejects a live URL switch without closing a pool in the background or exposing credentials", async () => {
    process.env.DATABASE_URL = "postgresql://fixture:synthetic-password@localhost/owned_one";
    const first = postgresPool();
    expect(postgresPool()).toBe(first);
    process.env.DATABASE_URL = "postgresql://fixture:other-synthetic-password@localhost/owned_two";
    expect(() => postgresPool()).toThrow("await closePostgresPool()");
    expect(state.ends).toHaveLength(1);
    expect(state.ends[0]).not.toHaveBeenCalled();
    try { postgresPool(); } catch (error) {
      expect(String(error)).not.toContain("synthetic-password");
      expect(String(error)).not.toContain("owned_two");
    }
    await closePostgresPool();
    expect(state.ends[0]).toHaveBeenCalledTimes(1);
    expect(postgresPool()).not.toBe(first);
    expect(state.ends).toHaveLength(2);
  });

  it("explicit closure owns and awaits the end promise", async () => {
    process.env.DATABASE_URL = "postgresql://fixture@localhost/owned_close";
    postgresPool();
    let release!: () => void;
    state.ends[0].mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    let completed = false;
    const closing = closePostgresPool().then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    release();
    await closing;
    expect(completed).toBe(true);
  });
});
