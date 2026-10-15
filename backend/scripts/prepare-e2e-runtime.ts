import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAS } from "../src/config.js";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { assertDisposableTestDatabase } from "../src/seed.js";
import { assertRuntimeSkill } from "../src/runtime/execution.js";
import { ensureManagedAgents } from "../src/runtime/managed-agents.js";
import {
  canUseAgent,
  createAgentBinding,
  ensureOrganizationTree,
  syncUserOrganization,
} from "../src/runtime/organization-tree.js";
import { ensureRuntimeSchema, getAgentSkills, setAgentSkill } from "../src/runtime/store.js";

const COMPANY_ID = "company:amperetime";
const TEST_UNIT_ID = "org:lt_team";
const FIXTURE_SOURCE = "test:prepare-e2e-runtime";
const RUNTIME_AGENTS = ["agent:kol", "agent:workspace-planner"] as const;
type RuntimeAgentId = (typeof RUNTIME_AGENTS)[number];

type DemoActorSpec = {
  userId: string;
  username: string;
  name: string;
  brands: string[];
};

const DEMO_ACTORS: readonly DemoActorSpec[] = [
  {
    userId: PERSONAS.sriphy.id,
    username: PERSONAS.sriphy.handle,
    name: PERSONAS.sriphy.name,
    brands: PERSONAS.sriphy.brands,
  },
  {
    userId: PERSONAS.employee.id,
    username: PERSONAS.employee.handle,
    name: PERSONAS.employee.name,
    brands: PERSONAS.employee.brands,
  },
];

export type PreparedE2EActor = {
  userId: string;
  username: string;
  personRef: string;
  bindingIds: Record<RuntimeAgentId, string>;
};

export type PreparedE2ERuntime = {
  actors: readonly PreparedE2EActor[];
};

/** This fixture is intentionally unavailable outside the isolated stub-runtime test harness. */
function assertFixtureEnvironment(): void {
  if (process.env.CODEX_MODE !== "stub" || process.env.AUTH_MODE !== "disabled" || process.env.NODE_ENV !== "test") {
    throw new Error("prepareE2ERuntime requires CODEX_MODE=stub, AUTH_MODE=disabled, and NODE_ENV=test");
  }
}

/** Create only the two declared test accounts; never import an external directory or organization account set. */
async function ensureNativeTestUser(actor: DemoActorSpec): Promise<void> {
  const db = getConn();
  const usernameOwner = (await db.query<{ id: string }>("SELECT id FROM users WHERE username=$1", [actor.username])).rows[0];
  if (usernameOwner && usernameOwner.id !== actor.userId) {
    throw new Error(`refusing to claim fixture username already owned by ${usernameOwner.id}`);
  }
  const now = nowIso();
  await db.query(`INSERT INTO users
    (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8)
    ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,
      roles=EXCLUDED.roles,brands=EXCLUDED.brands,site=EXCLUDED.site,active=1,updated_at=EXCLUDED.updated_at`, [
    actor.userId,
    actor.username,
    actor.name,
    "fixture-not-for-login",
    JSON.stringify(["employee"]),
    JSON.stringify(actor.brands),
    TEST_UNIT_ID,
    now,
  ]);
}

/** Use the governed CAS API; never synthesize release hashes or write runtime rows directly. */
async function ensureEnabledAgentSkill(agentId: string, skillId: string): Promise<void> {
  const current = (await getAgentSkills(agentId)).find((row) => row.skill_id === skillId);
  if (!current) {
    await setAgentSkill(agentId, skillId, true, 0);
    return;
  }
  if (Number(current.enabled) !== 1) await setAgentSkill(agentId, skillId, true, Number(current.version));
}

async function assertDefaultAssembly(agentId: string, skillId: string): Promise<void> {
  const skill = (await getAgentSkills(agentId)).find((row) => row.skill_id === skillId);
  if (!skill || Number(skill.enabled) !== 1) {
    throw new Error(`runtime default assembly is missing enabled ${agentId} -> ${skillId}`);
  }
}

/**
 * Prepare only explicit CI personas for native runtime authorization assertions.
 * It neither seeds workbench data nor weakens runtime publication/binding checks.
 */
export async function prepareE2ERuntime(): Promise<PreparedE2ERuntime> {
  assertFixtureEnvironment();
  await assertDisposableTestDatabase();

  // Bootstrap the formal organization facts before creating `jeffrey`, so the
  // fixture account remains its own synced test person rather than claiming a
  // registry account by username.
  await ensureOrganizationTree();
  for (const actor of DEMO_ACTORS) await ensureNativeTestUser(actor);

  await ensureManagedAgents();
  await ensureRuntimeSchema();

  // These are schema-owned defaults. Verify them instead of reproducing their
  // bootstrap metadata or fabricating release_hash values.
  await assertDefaultAssembly("agent:kol", "risk_scan");
  await assertDefaultAssembly("agent:workspace-planner", "today_plan");
  // crawler_collect is a KOL default but can be disabled by an earlier test;
  // restore only this explicit E2E fixture capability through its CAS API.
  await ensureEnabledAgentSkill("agent:kol", "crawler_collect");

  const actors: PreparedE2EActor[] = [];
  for (const actor of DEMO_ACTORS) {
    const personRef = await syncUserOrganization(actor.userId, TEST_UNIT_ID);
    const bindingIds = {} as Record<RuntimeAgentId, string>;
    for (const agentId of RUNTIME_AGENTS) {
      const binding = await createAgentBinding({
        agent_id: agentId,
        target_type: "person",
        target_id: personRef,
        company_id: COMPANY_ID,
        reason: "isolated native E2E runtime fixture",
        source: FIXTURE_SOURCE,
      });
      if (!(await canUseAgent(actor.userId, agentId))) {
        throw new Error(`fixture actor is not eligible for ${agentId}: ${actor.userId}`);
      }
      bindingIds[agentId] = binding.id;
    }
    actors.push({ userId: actor.userId, username: actor.username, personRef, bindingIds });
  }

  const kolActor = actors.find((actor) => actor.userId === PERSONAS.sriphy.id);
  if (!kolActor) throw new Error("KOL fixture actor is missing");
  // This validates the real published lifecycle, Agent assembly, and person →
  // Agent binding chain. It is deliberately not a test-only authorization bypass.
  for (const skillId of ["crawler_collect", "risk_scan"]) {
    await assertRuntimeSkill({
      agentId: "agent:kol",
      skillId,
      userId: kolActor.userId,
      runId: `prepare-e2e-runtime:${skillId}`,
    });
  }

  return { actors };
}

function isMain(): boolean {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    await prepareE2ERuntime();
    console.log("prepare-e2e-runtime: sriphy and usr_lingong are eligible for agent:kol and agent:workspace-planner");
  } finally {
    await resetConn();
  }
}
