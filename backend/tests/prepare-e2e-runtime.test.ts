import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { assertRuntimeSkill } from "../src/runtime/execution.js";
import { canUseAgent, revokeAgentBinding } from "../src/runtime/organization-tree.js";
import { getAgentSkills } from "../src/runtime/store.js";
import { prepareE2ERuntime } from "../scripts/prepare-e2e-runtime.js";
import { freshTestDatabase } from "./support/pg.js";

const FIXTURE_ENV = {
  CODEX_MODE: "stub",
  AUTH_MODE: "disabled",
  NODE_ENV: "test",
};

type EnvName = keyof typeof FIXTURE_ENV | "TEST_DB_PREFIX";

async function withEnv(values: Partial<Record<EnvName, string>>, action: () => Promise<void>): Promise<void> {
  const previous = new Map<EnvName, string | undefined>();
  for (const [key, value] of Object.entries(values) as Array<[EnvName, string]>) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    await action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

beforeEach(async () => {
  await freshTestDatabase({ reclaimPrevious: true });
  Object.assign(process.env, FIXTURE_ENV);
});

afterEach(async () => {
  await resetConn();
  Object.assign(process.env, FIXTURE_ENV);
});

describe("prepareE2ERuntime", () => {
  it.each([
    ["NODE_ENV is not test", { NODE_ENV: "production" }, /NODE_ENV=test/],
    ["CODEX_MODE is not stub", { CODEX_MODE: "real" }, /CODEX_MODE=stub/],
    ["AUTH_MODE is not disabled", { AUTH_MODE: "enabled" }, /AUTH_MODE=disabled/],
    ["TEST_DB_PREFIX is not a safe explicit prefix", { TEST_DB_PREFIX: "unsafe-prefix" }, /explicit isolated TEST_DB_PREFIX/],
    ["current database is outside the owned prefix", { TEST_DB_PREFIX: "other_fixture_owner" }, /outside the isolated test database prefix/],
  ] as const)("refuses fixture writes when %s", async (_caseName, values, expected) => {
    const before = (await getConn().query("SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM agent_bindings)::int AS bindings")).rows[0];
    await withEnv(values, async () => {
      await expect(prepareE2ERuntime()).rejects.toThrow(expected);
    });
    expect((await getConn().query("SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM agent_bindings)::int AS bindings")).rows[0]).toEqual(before);
  });

  it("uses only explicit native personas, formal person bindings, and published runtime checks", async () => {
    const prepared = await prepareE2ERuntime();
    const kol = prepared.actors.find((actor) => actor.userId === "sriphy");
    const employee = prepared.actors.find((actor) => actor.userId === "usr_lingong");

    expect(kol).toMatchObject({
      userId: "sriphy",
      username: "jeffrey",
      personRef: "person:user:sriphy",
    });
    expect(employee).toMatchObject({
      userId: "usr_lingong",
      username: "lingong",
      personRef: "person:user:usr_lingong",
    });
    for (const actor of [kol!, employee!]) {
      expect(actor.bindingIds["agent:kol"]).toBe(`binding:agent:kol:person:${actor.personRef}`);
      expect(actor.bindingIds["agent:workspace-planner"]).toBe(`binding:agent:workspace-planner:person:${actor.personRef}`);
      expect(await canUseAgent(actor.userId, "agent:kol")).toBe(true);
      expect(await canUseAgent(actor.userId, "agent:workspace-planner")).toBe(true);
    }

    expect((await getAgentSkills("agent:kol")).find((row) => row.skill_id === "crawler_collect")).toMatchObject({ enabled: 1 });
    expect((await getAgentSkills("agent:workspace-planner")).find((row) => row.skill_id === "today_plan")).toMatchObject({ enabled: 1 });

    await expect(assertRuntimeSkill({
      agentId: "agent:kol",
      skillId: "crawler_collect",
      userId: kol!.userId,
      runId: "prepare-e2e-runtime:test-crawler",
    })).resolves.toMatchObject({ skillVersion: expect.any(String) });
    await expect(assertRuntimeSkill({
      agentId: "agent:kol",
      skillId: "risk_scan",
      userId: kol!.userId,
      runId: "prepare-e2e-runtime:test-risk",
    })).resolves.toMatchObject({ skillVersion: expect.any(String) });
    await expect(assertRuntimeSkill({
      agentId: "agent:workspace-planner",
      skillId: "today_plan",
      userId: kol!.userId,
      runId: "prepare-e2e-runtime:test-planner",
    })).resolves.toMatchObject({ skillVersion: expect.any(String) });
    await expect(assertRuntimeSkill({
      agentId: "agent:kol",
      skillId: "crawler_collect",
      userId: employee!.userId,
      runId: "prepare-e2e-runtime:test-employee-kol",
    })).resolves.toMatchObject({ skillVersion: expect.any(String) });

    // Repeating preparation is idempotent and does not need a synthetic release pin.
    const repeated = await prepareE2ERuntime();
    expect(repeated.actors.find((actor) => actor.userId === kol!.userId)?.bindingIds).toEqual(kol!.bindingIds);
  });

  it("fails closed after the explicit person bindings are revoked", async () => {
    const prepared = await prepareE2ERuntime();
    const kol = prepared.actors.find((actor) => actor.userId === "sriphy")!;

    await expect(revokeAgentBinding(kol.bindingIds["agent:kol"], { reason: "test explicit KOL runtime revocation" })).resolves.toBe(true);
    await expect(revokeAgentBinding(kol.bindingIds["agent:workspace-planner"], { reason: "test explicit planner runtime revocation" })).resolves.toBe(true);
    expect(await canUseAgent(kol.userId, "agent:kol")).toBe(false);
    expect(await canUseAgent(kol.userId, "agent:workspace-planner")).toBe(false);
    await expect(assertRuntimeSkill({
      agentId: "agent:kol",
      skillId: "crawler_collect",
      userId: kol.userId,
      runId: "prepare-e2e-runtime:after-revoke",
    })).rejects.toMatchObject({ detail: { code: "runtime_agent_not_usable" } });
    await expect(assertRuntimeSkill({
      agentId: "agent:workspace-planner",
      skillId: "today_plan",
      userId: kol.userId,
      runId: "prepare-e2e-runtime:planner-after-revoke",
    })).rejects.toMatchObject({ detail: { code: "runtime_agent_not_usable" } });
  });
});
