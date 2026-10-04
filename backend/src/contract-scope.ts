import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { managedAgent } from "./runtime/managed-agents.js";

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
  id: string;
  version?: string;
  status: string;
  owner_ref: string;
  organization_scope: string[];
  brand_scope: string[];
  region_scope: string[];
  kind?: "platform" | "business";
  execution_scope?: string;
  /** Runtime capabilities are declared by an Agent, never inferred from an Expert UI manifest. */
  skills?: string[];
  /** Managed connector ids that this Agent may declare against its Skills. */
  connectors?: string[];
  /** Legacy field retained for employee-view compatibility; it is not a credential source. */
  mcp_servers?: string[];
};

type RuntimeAgentScope = {
  agent_id: string;
  agent_version: string | null;
  status: string;
  kind: "platform" | "business";
  execution_scope: string;
  company_ids: string[];
  organization_scope: string[];
  brand_scope: string[];
  region_scope: string[];
  owner_ref: string;
  owner_principal_ref: string | null;
  department_head_scope_policy: ScopeRegistry["department_head_scope_policy"] | null;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function readJsonYaml<T>(relative: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf8")) as T;
}
function manifestPath(agentId: string): string {
  if (!/^agent:[a-z][a-z0-9-]*$/.test(agentId)) throw new Error(`invalid runtime agent id: ${agentId}`);
  return `agents/${agentId.slice("agent:".length)}/manifest.yaml`;
}
function agentManifest(agentId: string): AgentManifest {
  const manifest = readJsonYaml<AgentManifest>(manifestPath(agentId));
  if (manifest.id !== agentId) throw new Error(`runtime agent manifest id mismatch: ${agentId}`);
  return manifest;
}

/**
 * Bounded, configuration-only declaration used to seed Runtime bindings at
 * startup. Experts describe an employee-facing entry point; only this Agent
 * manifest is allowed to declare an executable Agent → Skill relationship.
 */
export type RuntimeAgentBindingManifest = {
  id: string;
  version: string;
  status: string;
  kind: "platform" | "business";
  skills: string[];
  connectors: string[];
};

export function runtimeAgentBindingManifest(agentId: string): RuntimeAgentBindingManifest {
  const manifest = agentManifest(agentId);
  const strings = (value: unknown, field: string) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`runtime agent manifest ${field} must be a string array: ${agentId}`);
    }
    return [...new Set(value.map((item) => item.trim()))];
  };
  return {
    id: manifest.id,
    version: manifest.version || "0",
    status: manifest.status,
    kind: manifest.kind || "business",
    skills: strings(manifest.skills, "skills"),
    // `connectors` is the canonical Runtime field. Existing `mcp_servers`
    // remains a transitional declaration only so it cannot silently wire a
    // vendor endpoint into a Worker.
    connectors: strings(manifest.connectors, "connectors"),
  };
}

const cached = new Map<string, RuntimeAgentScope>();
function buildScope(agentId: string): RuntimeAgentScope {
  const org = readJsonYaml<ScopeRegistry>("config/org-registry.yaml");
  const brands = readJsonYaml<BrandRegistry>("config/brand-registry.yaml");
  const agent = agentManifest(agentId);
  const owner = (org.responsibilities || []).find((item) => item.id === agent.owner_ref);
  if (!owner && !agent.owner_ref.startsWith("system:")) {
    throw new Error(`unregistered agent owner: ${agent.owner_ref}`);
  }
  for (const id of agent.organization_scope) {
    if (!(org.organization_units || []).some((item) => item.id === id)) throw new Error(`unregistered agent organization: ${id}`);
  }
  for (const id of agent.brand_scope) {
    if (!(brands.brands || []).some((item) => item.id === id)) throw new Error(`unregistered agent brand: ${id}`);
  }
  for (const id of agent.region_scope) {
    if (!(brands.regions || []).includes(id)) throw new Error(`unregistered agent region: ${id}`);
  }
  return {
    agent_id: agent.id,
    agent_version: agent.version || null,
    status: agent.status,
    kind: agent.kind || "business",
    execution_scope: agent.execution_scope || "organization",
    company_ids: (org.companies || []).map((item) => item.id),
    organization_scope: [...agent.organization_scope],
    brand_scope: [...agent.brand_scope],
    region_scope: [...agent.region_scope],
    owner_ref: agent.owner_ref,
    owner_principal_ref: owner?.principal_ref || null,
    department_head_scope_policy: org.department_head_scope_policy || null,
  };
}

/** Scope sent to every Codex CONTEXT; Host remains the authority for decisions. */
export function runtimeAgentScopeContext(agentId: string): RuntimeAgentScope {
  if (agentId.startsWith("agent_")) {
    const agent = managedAgent(agentId);
    // Managed agents do not inherit KOL business scope from a static manifest.
    // Resource scope is resolved by each skill at the execution gate.
    return { agent_id: agent.id, agent_version: String(agent.version), status: agent.status,
      kind: "platform", execution_scope: "skill-resources", company_ids: [], organization_scope: [],
      brand_scope: [], region_scope: [], owner_ref: "system:managed-agent", owner_principal_ref: null,
      department_head_scope_policy: null };
  }
  const known = cached.get(agentId);
  if (known) return known;
  const scope = buildScope(agentId);
  cached.set(agentId, scope);
  return scope;
}

/** Backward-compatible KOL business-agent scope helper. */
export function kolAgentScopeContext(): RuntimeAgentScope {
  return runtimeAgentScopeContext("agent:kol");
}

export function clearContractScopeCache(): void { cached.clear(); }

/** Employee-facing Agent views are configuration published with the KOL Agent manifest. */
export function kolAgentManifest(): Record<string, unknown> {
  return readJsonYaml<Record<string, unknown>>(manifestPath("agent:kol"));
}

export function agentPublishState(): { status: string; employee_submission: boolean; state: string } {
  const agent = readJsonYaml<AgentManifest & { publish_gate?: { state?: string; employee_submission?: boolean } }>(manifestPath("agent:kol"));
  return {
    status: agent.status,
    employee_submission: agent.publish_gate?.employee_submission === true,
    state: agent.publish_gate?.state || "unknown",
  };
}

let submissionOverride: boolean | null = null;

/** Tests only. Temporarily stub the KOL Agent publish gate without rewriting the manifest. */
export function setAgentSubmissionOverride(value?: boolean | null): void {
  submissionOverride = value === undefined ? null : value;
}

export function agentSubmissionAllowed(mode = process.env.CODEX_MODE || "real"): boolean {
  if (String(mode).toLowerCase() === "stub") return true;
  if (submissionOverride != null) return submissionOverride;
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
