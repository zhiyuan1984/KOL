/** Only the E2E launcher may seed the database it just created. Never a production setup path. */
import "../src/config.js";
import { hashPassword } from "../src/auth.js";
import { pgCreateFirstUser } from "../src/postgres/auth-pg.js";
import { closePostgresPool, requiredPostgresUrl } from "../src/postgres/pool.js";
import { seedAll } from "../src/seed.js";
import { ensureRuntimeSchema } from "../src/runtime/store.js";
import { ensureManagedAgents } from "../src/runtime/managed-agents.js";
import { createAgentBinding, syncUserOrganization } from "../src/runtime/organization-tree.js";

const owned = String(process.env.E2E_OWNED_DATABASE || "");
const url = new URL(requiredPostgresUrl());
if (process.env.NODE_ENV !== "test" || process.env.E2E_MODE !== "stub" ||
    !/^lingong_e2e_[0-9]+_[0-9]+$/.test(owned) || decodeURIComponent(url.pathname.slice(1)) !== owned) {
  throw new Error("E2E account seeding is restricted to an explicitly self-created isolated stub database");
}
try {
  await seedAll();
  await ensureRuntimeSchema();
  await ensureManagedAgents();
  const userId = "usr_e2e_admin";
  await pgCreateFirstUser({
    id: userId,
    username: process.env.E2E_TEST_USERNAME || "jeffrey",
    name: "Isolated browser acceptance account",
    passwordHash: await hashPassword(process.env.E2E_TEST_PASSWORD || "123456789"),
    brands: ["LT", "RO", "PQ"], site: "org:lt_team", email: "", phone: "", now: new Date().toISOString(),
  });
  const person = await syncUserOrganization(userId, "org:lt_team");
  for (const agentId of ["agent:kol", "agent:workspace-planner"]) {
    await createAgentBinding({ agent_id: agentId, target_type: "person", target_id: person,
      company_id: "company:amperetime", source: "isolated-e2e-fixture" });
  }
  console.log("[e2e] authenticated test account and explicit Agent qualifications seeded");
} finally {
  await closePostgresPool();
}
