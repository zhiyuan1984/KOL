import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(backendDir, "..");
const errors = [];
const warnings = [];

function readJsonYaml(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
  try { return JSON.parse(text); } catch (error) {
    throw new Error(`${path.relative(root, file)} must be JSON-compatible YAML: ${error.message}`);
  }
}

function load(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { errors.push(`missing contract: ${relative}`); return null; }
  try { return readJsonYaml(file); } catch (error) { errors.push(error.message); return null; }
}

function requireId(value, prefix, label) {
  if (typeof value !== "string" || !value.startsWith(prefix)) errors.push(`${label} must use ${prefix} canonical id`);
}

function files(dir, extension) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute).filter((name) => name.endsWith(extension)).map((name) => path.join(absolute, name));
}

const org = load("config/org-registry.yaml");
const brands = load("config/brand-registry.yaml");
const agent = load("agents/kol/manifest.yaml");
const workflows = new Map(files("workflows", ".yaml").map((file) => [readJsonYaml(file).id, readJsonYaml(file)]));
const policies = new Map(files("policies", ".yaml").map((file) => [readJsonYaml(file).id, readJsonYaml(file)]));
const schemas = new Map(files("schemas", ".json").map((file) => [path.basename(file, ".schema.json"), JSON.parse(fs.readFileSync(file, "utf8"))]));
const traceabilityFile = path.join(root, "specs", "traceability.json");
const traceability = fs.existsSync(traceabilityFile) ? JSON.parse(fs.readFileSync(traceabilityFile, "utf8")) : null;
const uxTraceabilityFile = path.join(root, "specs", "ux-traceability.json");
const uxSpecFile = path.join(root, "specs", "UX-KOL.md");
const uxTraceability = fs.existsSync(uxTraceabilityFile) ? JSON.parse(fs.readFileSync(uxTraceabilityFile, "utf8")) : null;

if (org) {
  for (const company of org.companies || []) requireId(company.id, "company:", "company");
  for (const unit of org.organization_units || []) {
    requireId(unit.id, "org:", "organization unit");
    if (unit.parent && !String(unit.parent).startsWith("org:") && !String(unit.parent).startsWith("company:")) errors.push(`organization parent is not canonical: ${unit.id}`);
  }
  for (const resp of org.responsibilities || []) {
    requireId(resp.id, "resp:", "responsibility");
    if (!String(resp.principal_ref || "").startsWith("user:")) errors.push(`responsibility principal must be user ref: ${resp.id}`);
  }
}

const brandIds = new Set((brands?.brands || []).map((brand) => brand.id));
const regionIds = new Set(brands?.regions || []);
if (brands) {
  for (const brand of brands.brands || []) requireId(brand.id, "brand:", "brand");
  for (const region of brands.regions || []) requireId(region, "region:", "region");
}

if (agent) {
  if (agent.id !== "agent:kol") errors.push("KOL manifest id must be agent:kol");
  if (agent.status === "pilot-not-production") warnings.push("KOL manifest is not production eligible");
  const publishable = ["published", "production"].includes(agent.status);
  if (agent.publish_gate?.employee_submission !== publishable) errors.push("agent publish_gate must match employee submission status");
  if (!agent.publish_gate?.state) errors.push("agent publish_gate.state is required");
  requireId(agent.owner_ref, "resp:", "agent owner_ref");
  const respIds = new Set((org?.responsibilities || []).map((item) => item.id));
  if (!respIds.has(agent.owner_ref)) errors.push(`agent owner is not registered: ${agent.owner_ref}`);
  for (const unit of agent.organization_scope || []) {
    requireId(unit, "org:", "agent organization_scope");
    if (!(org?.organization_units || []).some((item) => item.id === unit)) errors.push(`agent organization is not registered: ${unit}`);
  }
  for (const brand of agent.brand_scope || []) {
    requireId(brand, "brand:", "agent brand_scope");
    if (!brandIds.has(brand)) errors.push(`agent brand is not registered: ${brand}`);
  }
  for (const region of agent.region_scope || []) {
    requireId(region, "region:", "agent region_scope");
    if (!regionIds.has(region)) errors.push(`agent region is not registered: ${region}`);
  }
  for (const skill of agent.skills || []) {
    const file = path.join(root, "backend", "skills", skill, "SKILL.md");
    if (!fs.existsSync(file)) errors.push(`agent Skill is missing: ${skill}`);
  }
  for (const workflow of agent.workflows || []) if (!workflows.has(workflow)) errors.push(`agent workflow is missing: ${workflow}`);
  for (const policy of agent.policies || []) if (!policies.has(policy)) errors.push(`agent policy is missing: ${policy}`);
  for (const schema of agent.schemas || []) if (!schemas.has(schema)) errors.push(`agent schema is missing: ${schema}`);
  for (const evaluation of agent.evals || []) {
    const file = path.join(root, evaluation);
    if (!fs.existsSync(file)) errors.push(`agent evaluation set is missing: ${evaluation}`);
    else if (fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length < 8) errors.push(`evaluation set must have at least 8 cases: ${evaluation}`);
  }
}

const expertDir = path.join(root, "experts");
const expertFiles = fs.existsSync(expertDir)
  ? fs.readdirSync(expertDir).map((name) => path.join(expertDir, name, "manifest.yaml")).filter((file) => fs.existsSync(file))
  : [];
if (!expertFiles.length) errors.push("missing contract: experts/<id>/manifest.yaml");
const experts = [];
const publishedExperts = [];
for (const file of expertFiles) {
  let expert = null;
  try { expert = readJsonYaml(file); } catch (error) { errors.push(error.message); continue; }
  experts.push(expert);
  requireId(expert.id, "expert:", `${path.relative(root, file)} id`);
  for (const field of ["title", "role", "goal"]) {
    if (typeof expert[field] !== "string" || !expert[field].trim()) errors.push(`expert ${expert.id || file} is missing ${field}`);
  }
  if (!expert.publish_gate?.state) errors.push(`expert ${expert.id || file} publish_gate.state is required`);
  if (!Array.isArray(expert.available_agents) || !expert.available_agents.length) {
    errors.push(`expert ${expert.id || file} must declare available_agents`);
  } else {
    for (const agentId of expert.available_agents) {
      if (agentId !== "agent:kol") errors.push(`expert ${expert.id || file} references unknown agent: ${agentId}`);
    }
  }
  if (expert.permissions && expert.permissions.declaration !== "read-only") {
    errors.push(`expert ${expert.id || file} permissions must be a read-only declaration`);
  }
  for (const policy of expert.permissions?.policy_refs || []) {
    if (!policies.has(policy)) errors.push(`expert ${expert.id || file} policy ref is missing: ${policy}`);
  }
  for (const unit of expert.organization_scope || []) {
    requireId(unit, "org:", "expert organization_scope");
    if (!(org?.organization_units || []).some((item) => item.id === unit)) errors.push(`expert organization is not registered: ${unit}`);
  }
  for (const brand of expert.brand_scope || []) {
    requireId(brand, "brand:", "expert brand_scope");
    if (!brandIds.has(brand)) errors.push(`expert brand is not registered: ${brand}`);
  }
  for (const region of expert.region_scope || []) {
    requireId(region, "region:", "expert region_scope");
    if (!regionIds.has(region)) errors.push(`expert region is not registered: ${region}`);
  }
  if (String(expert.publish_gate?.state || "") === "published") publishedExperts.push(expert);
}

if (publishedExperts.filter((item) => item.id === "expert:kol").length !== 1) {
  errors.push("exactly one published ExpertManifest expert:kol is required");
}
if (publishedExperts.some((item) => item.id !== "expert:kol")) {
  errors.push("only expert:kol may be published in this contract set");
}

if (!uxTraceability || !Array.isArray(uxTraceability.entries)) {
  errors.push("specs/ux-traceability.json is required");
} else if (!fs.existsSync(uxSpecFile)) {
  errors.push("specs/UX-KOL.md is required");
} else {
  const uxText = fs.readFileSync(uxSpecFile, "utf8");
  for (const entry of uxTraceability.entries) {
    if (typeof entry.id !== "string" || !uxText.includes(entry.id)) errors.push(`UX contract is missing from UX-KOL.md: ${entry.id}`);
    if (!Array.isArray(entry.fs) || entry.fs.length === 0) errors.push(`UX trace has no FS mapping: ${entry.id}`);
    if (!Array.isArray(entry.tests) || entry.tests.length === 0) errors.push(`UX trace has no test mapping: ${entry.id}`);
    if (!Array.isArray(entry.e2e) || entry.e2e.length === 0) errors.push(`UX trace has no E2E mapping: ${entry.id}`);
    for (const fsId of entry.fs || []) if (!traceability?.entries?.some((item) => item.fs === fsId)) errors.push(`UX trace references unknown FS: ${entry.id} -> ${fsId}`);
  }
}

const specFiles = files("specs", ".md").filter((file) => path.basename(file).startsWith("FS-"));
if (specFiles.length < 8) errors.push(`at least 8 KOL FS files are required, found ${specFiles.length}`);
if (!traceability || !Array.isArray(traceability.entries)) errors.push("specs/traceability.json is required");
else {
  const traced = new Set(traceability.entries.map((entry) => entry.fs));
  for (const file of specFiles) {
    const id = path.basename(file).split("-").slice(0, 3).join("-");
    const text = fs.readFileSync(file, "utf8");
    if (!traced.has(id)) errors.push(`spec has no traceability entry: ${id}`);
    for (const marker of ["范围", "输入", "输出", "BR-", "TEST-", "EVAL-"]) {
      if (!text.includes(marker)) errors.push(`spec ${id} is missing ${marker}`);
    }
  }
}

for (const [id, workflow] of workflows) {
  if (!id) errors.push("workflow id is required");
  for (const step of workflow.steps || []) if (!agent?.skills?.includes(step) && !agent?.policies?.includes(step)) warnings.push(`workflow ${id} references non-agent step ${step}`);
  for (const writeStep of workflow.write_steps || []) if (!agent?.policies?.includes(writeStep)) errors.push(`workflow ${id} write step is not an agent policy: ${writeStep}`);
}

for (const [id, policy] of policies) {
  if (policy.id !== id) errors.push(`policy filename/id mismatch: ${id}`);
  if (policy.side_effect !== true) errors.push(`policy ${id} must declare side_effect: true`);
  if (!policy.gateway || !Array.isArray(policy.mcp_tools) || !policy.mcp_tools.length) errors.push(`policy ${id} needs gateway and MCP tool allowlist`);
  if (policy.requires_confirmation !== true) errors.push(`policy ${id} must require confirmation`);
  const allowedServers = new Set(["starrykol", "mediacrawler"]);
  for (const tool of policy.mcp_tools || []) if (!allowedServers.has(String(tool).split(".")[0])) errors.push(`policy ${id} references unregistered MCP server: ${tool}`);
}

if (process.argv.includes("--production")) {
  if (agent?.status !== "production") errors.push("production compilation requires agent status=production");
  if ((org?.companies || []).some((company) => company.status !== "active")) errors.push("production compilation requires an active company binding");
  if ((brands?.brands || []).some((brand) => brand.status !== "active")) errors.push("production compilation requires all brands to be active in the external registry");
}

const result = { status: errors.length ? "invalid" : "valid", errors, warnings, agent: agent?.id || null, expert: publishedExperts[0]?.id || null, expertCount: experts.length, policyCount: policies.size, workflowCount: workflows.size, schemaCount: schemas.size, uxTraceCount: uxTraceability?.entries?.length || 0 };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
