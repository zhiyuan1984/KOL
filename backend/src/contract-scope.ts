import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ScopeRegistry = {
  companies?: { id: string; status?: string }[];
  organization_units?: { id: string; parent?: string; brand_scope?: string[] }[];
  responsibilities?: { id: string; principal_ref?: string; org_unit?: string }[];
  confirmed_people?: { display_name: string; role?: string; org_unit?: string; user_ref?: string | null }[];
  department_head_scope_policy?: {
    status?: string;
    company_wide?: boolean;
    brand_scope?: "all" | string[];
    region_scope?: "all" | string[];
    data_actions?: string[];
    high_risk_actions?: string[];
    high_risk_control?: string;
  };
};
type BrandRegistry = { brands?: { id: string; code?: string; status?: string }[]; regions?: string[] };
type AgentManifest = {
  id: string; version?: string; status: string; owner_ref: string;
  organization_scope: string[]; brand_scope: string[]; region_scope: string[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function readJsonYaml<T>(relative: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf8")) as T;
}

let cached: ReturnType<typeof buildScope> | null = null;
function buildScope() {
  const org = readJsonYaml<ScopeRegistry>("config/org-registry.yaml");
  const brands = readJsonYaml<BrandRegistry>("config/brand-registry.yaml");
  const agent = readJsonYaml<AgentManifest>("agents/kol/manifest.yaml");
  const owner = (org.responsibilities || []).find((item) => item.id === agent.owner_ref);
  if (!owner) throw new Error(`unregistered KOL agent owner: ${agent.owner_ref}`);
  for (const id of agent.organization_scope) {
    if (!(org.organization_units || []).some((item) => item.id === id)) throw new Error(`unregistered KOL organization: ${id}`);
  }
  for (const id of agent.brand_scope) {
    if (!(brands.brands || []).some((item) => item.id === id)) throw new Error(`unregistered KOL brand: ${id}`);
  }
  for (const id of agent.region_scope) {
    if (!(brands.regions || []).includes(id)) throw new Error(`unregistered KOL region: ${id}`);
  }
  return {
    agent_id: agent.id,
    agent_version: agent.version || null,
    status: agent.status,
    company_ids: (org.companies || []).map((item) => item.id),
    organization_scope: [...agent.organization_scope],
    brand_scope: [...agent.brand_scope],
    region_scope: [...agent.region_scope],
    owner_ref: agent.owner_ref,
    owner_principal_ref: owner.principal_ref || null,
    department_head_scope_policy: org.department_head_scope_policy || null,
  };
}

/** Scope sent to every Codex CONTEXT; Host remains the authority for decisions. */
export function kolAgentScopeContext(): ReturnType<typeof buildScope> {
  if (!cached) cached = buildScope();
  return cached;
}

export function clearContractScopeCache(): void { cached = null; }

/** Employee-facing Agent views are configuration published with the Agent manifest. */
export function kolAgentManifest(): Record<string, unknown> {
  return readJsonYaml<Record<string, unknown>>("agents/kol/manifest.yaml");
}

export function agentPublishState(): { status: string; employee_submission: boolean; state: string } {
  const agent = readJsonYaml<AgentManifest & { publish_gate?: { state?: string; employee_submission?: boolean } }>("agents/kol/manifest.yaml");
  return {
    status: agent.status,
    employee_submission: agent.publish_gate?.employee_submission === true,
    state: agent.publish_gate?.state || "unknown",
  };
}

export function agentSubmissionAllowed(mode = process.env.CODEX_MODE || "real"): boolean {
  if (String(mode).toLowerCase() === "stub") return true;
  return agentPublishState().employee_submission;
}

/**
 * Department heads are company-wide data-scope principals in the confirmed
 * organization policy. This grants ordinary read/write scope; high-risk
 * actions still require their existing Host Gateway and confirmation gates.
 */
export function departmentHeadAccessForUser(user: { id?: string; name?: string } | null | undefined) {
  if (!user) return null;
  const org = readJsonYaml<ScopeRegistry>("config/org-registry.yaml");
  const policy = org.department_head_scope_policy;
  if (!policy?.company_wide || policy.status !== "confirmed") return null;
  const person = (org.confirmed_people || []).find((item) =>
    item.role === "department_head" && (item.display_name === user.name || Boolean(item.user_ref && item.user_ref === user.id)),
  );
  if (!person) return null;
  return {
    principal_ref: person.user_ref || null,
    org_unit: person.org_unit || null,
    company_wide: true,
    brand_scope: policy.brand_scope || "all",
    region_scope: policy.region_scope || "all",
    data_actions: [...(policy.data_actions || [])],
    high_risk_actions: [...(policy.high_risk_actions || [])],
    high_risk_control: policy.high_risk_control || null,
  };
}
