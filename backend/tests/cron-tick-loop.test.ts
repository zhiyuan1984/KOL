import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cronTickPollMs, runCronTickLoop } from "../src/cron/tick-loop.js";
import { cronMissedRunPolicy } from "../src/cron/tick-worker.js";
import { humanFrequency } from "../src/cron/schedule.js";

const success = { claimed: ["synthetic-run"], stale: false };
afterEach(() => vi.useRealTimers());

describe("Cron durable enqueue resident loop", () => {
  it("requires an explicit historical recovery policy", () => {
    expect(() => cronMissedRunPolicy(undefined)).toThrow("must explicitly");
    expect(() => cronMissedRunPolicy("unknown")).toThrow("must explicitly");
    expect(cronMissedRunPolicy("coalesce")).toBe("coalesce");
    expect(cronMissedRunPolicy("replay")).toBe("replay");
  });

  it("bounds polling configuration without a busy loop", () => {
    expect(cronTickPollMs(undefined)).toBe(5_000);
    expect(cronTickPollMs(Number.NaN)).toBe(5_000);
    expect(cronTickPollMs(-1)).toBe(250);
    expect(cronTickPollMs(1_000_000)).toBe(60_000);
  });

  it("does not enqueue when already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const tick = vi.fn(async () => success);
    const heartbeat = vi.fn(async () => {});
    await runCronTickLoop({ signal: controller.signal, tick, heartbeat });
    expect(tick).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("never overlaps ticks and drains an in-flight tick on stop", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let finish!: (value: typeof success) => void;
    const pending = new Promise<typeof success>((resolve) => { finish = resolve; });
    const tick = vi.fn(() => pending);
    const heartbeat = vi.fn(async () => {});
    const loop = runCronTickLoop({ signal: controller.signal, poll_ms: 250, tick, heartbeat });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(heartbeat).not.toHaveBeenCalled();
    controller.abort();
    finish(success);
    await loop;
    expect(heartbeat).toHaveBeenCalledExactlyOnceWith(success);
  });

  it("cancels idle polling immediately on SIGTERM-equivalent abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const tick = vi.fn(async () => success);
    const loop = runCronTickLoop({ signal: controller.signal, poll_ms: 60_000, tick, heartbeat: async () => {} });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await loop;
    expect(tick).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not emit a success heartbeat for a failed tick and recovers", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const failure = new Error("synthetic database failure");
    const tick = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(success);
    const onError = vi.fn();
    const heartbeat = vi.fn(async () => controller.abort());
    const loop = runCronTickLoop({ signal: controller.signal, poll_ms: 250, tick, heartbeat, on_error: onError });
    await vi.advanceTimersByTimeAsync(250);
    await loop;
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(heartbeat).toHaveBeenCalledExactlyOnceWith(success);
  });

  it("fails visibly after three consecutive failures for systemd restart", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const failure = new Error("synthetic persistent failure");
    const tick = vi.fn(async () => { throw failure; });
    const heartbeat = vi.fn(async () => {});
    const loop = runCronTickLoop({ signal: controller.signal, poll_ms: 250, tick, heartbeat });
    const assertion = expect(loop).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(250 * 2);
    await assertion;
    expect(tick).toHaveBeenCalledTimes(3);
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("binds the Cron service to its enqueue-only entry and makes it a release requirement", () => {
    const unit = readFileSync(new URL("../../ops/systemd/lingong-cron-tick.service", import.meta.url), "utf8");
    const worker = readFileSync(new URL("../../scripts/worker.sh", import.meta.url), "utf8");
    const deploy = readFileSync(new URL("../../scripts/deploy.sh", import.meta.url), "utf8");
    expect(unit).toContain("worker.sh cron-tick");
    expect(unit).not.toMatch(/^Environment=CRON_MISSED_RUN_POLICY=/m);
    expect(worker).toContain('cron-tick) entry="src/cron-tick-worker.ts"');
    expect(deploy).toContain("RUNTIME_UNITS=(lingong lingong-outbox lingong-execution-worker@1 lingong-execution-worker@2 lingong-cron-tick)");
    expect(deploy).toContain('argv[]=$ROOT/scripts/$entry$role ;');
    expect(deploy).toContain("Cron 恢复策略尚未显式配置");
    expect(spawnSync("bash", ["-n", new URL("../../scripts/deploy.sh", import.meta.url).pathname]).status).toBe(0);
    expect(spawnSync("bash", ["-n", new URL("../../scripts/worker.sh", import.meta.url).pathname]).status).toBe(0);
    const activeCheck = deploy.match(/runtime_units_active\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(activeCheck).toBeTruthy();
    const result = spawnSync("bash", ["-c", `RUNTIME_UNITS=(web outbox worker1 worker2 ticker); systemctl() { [ "$3" != ticker ]; }; ${activeCheck}; runtime_units_active`]);
    // Four running services must not mask a failed ticker (systemctl multi-unit
    // is-active returns success if any service is active).
    expect(result.status).toBe(1);
  });

  it("generates business frequencies in Beijing time without an IANA label", () => {
    const frequency = humanFrequency("30 3 * * *", "Asia/Shanghai");
    expect(frequency).toBe("每天 03:30（北京时间）");
    expect(frequency).not.toContain("Asia/Shanghai");
    expect(frequency).not.toContain("上海时间");
  });
});
