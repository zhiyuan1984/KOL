#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  dedupe,
  deriveIntents,
  fail,
  makeLoader,
  matchingPaths,
  parseArgs,
  parseSkillFrontmatter,
  repoPath,
  scriptRoot,
  sha256,
  validateSchema,
  values,
  writeJson
} from "./development-lib.mjs";

function usage() {
  console.error("Usage: node scripts/development-preflight.mjs --task-id <id> [--intent <text>] [--path <repo/path>] --out <directory> [--root <repository>]");
}

function parseTrackedJson(loader, relative, purpose) {
  const loaded = loader.load(relative, purpose);
  try { return { ...loaded, value: JSON.parse(loaded.content.replace(/^\uFEFF/, "")) }; }
  catch (error) { fail(`${relative} must be JSON-compatible YAML: ${error.message}`); }
}

function matchRoute(route, intents, changedPaths) {
  const match = route.match || {};
  const intentHits = intents.filter((intent) => (match.intent_any || []).includes(intent));
  const pathHits = matchingPaths(changedPaths, match.path_any || []);
  const hasIntentCondition = (match.intent_any || []).length > 0;
  const hasPathCondition = (match.path_any || []).length > 0;
  const mode = match.mode || "any";
  let selected = false;
  if (mode === "path") selected = pathHits.length > 0;
  else if (mode === "intent") selected = intentHits.length > 0;
  else if (mode === "all") selected = (!hasIntentCondition || intentHits.length > 0) && (!hasPathCondition || pathHits.length > 0);
  else if (mode === "any") selected = intentHits.length > 0 || pathHits.length > 0;
  else fail(`route ${route.id} has unsupported match.mode ${mode}`);
  return { selected, reasons: [...intentHits.map((item) => `intent:${item}`), ...pathHits.map((item) => `path:${item}`)] };
}

function addOutput(target, source, routeId) {
  const previous = target.get(source.id);
  if (previous && previous.fulfillment !== source.fulfillment) fail(`required output ${source.id} has conflicting fulfillment modes`);
  const result = previous || { id: source.id, fulfillment: source.fulfillment, owner_roles: [], route_ids: [] };
  result.owner_roles = dedupe([...result.owner_roles, ...(source.owner_roles || [])]);
  result.route_ids = dedupe([...result.route_ids, routeId]);
  target.set(source.id, result);
}

function addCheck(target, source, routeId) {
  const previous = target.get(source.id);
  if (previous && (previous.type !== source.type || previous.description !== source.description)) fail(`required check ${source.id} has conflicting definitions`);
  const result = previous || { id: source.id, type: source.type, description: source.description, route_ids: [] };
  result.route_ids = dedupe([...result.route_ids, routeId]);
  target.set(source.id, result);
}

function assertTemplate(template, expectedKind, relative) {
  let value;
  try { value = JSON.parse(template.content.replace(/^\uFEFF/, "")); }
  catch (error) { fail(`skill template is not JSON: ${relative}: ${error.message}`); }
  const required = ["schema_version", "kind", "status", "owner", "requirement_refs", "subject", "decisions", "verification"];
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`skill template is missing ${key}: ${relative}`);
  if (value.schema_version !== 1 || value.kind !== expectedKind || value.status !== "draft") fail(`skill template must be schema_version: 1, kind: ${expectedKind}, status: draft: ${relative}`);
  if (!Array.isArray(value.requirement_refs) || typeof value.subject !== "object" || Array.isArray(value.subject) || typeof value.decisions !== "object" || Array.isArray(value.decisions) || typeof value.verification !== "object" || Array.isArray(value.verification)) {
    fail(`skill template must contain requirement_refs plus object subject/decisions/verification fields: ${relative}`);
  }
}

function fileHash(record) {
  return { path: record.path, sha256: record.sha256, bytes: record.bytes, purposes: [...record.purposes].sort() };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  const root = path.resolve(args.root || scriptRoot);
  const taskId = typeof args["task-id"] === "string" ? args["task-id"].trim() : "";
  const out = typeof args.out === "string" ? path.resolve(args.out) : "";
  const rawIntents = [...values(args.intent), ...values(args.intents)];
  const changedPaths = dedupe([...values(args.path), ...values(args.paths)].map((item) => repoPath(root, item).relative));
  if (!taskId || !out || (!rawIntents.length && !changedPaths.length)) { usage(); fail("task-id, out, and at least one intent or path are required"); }

  const loader = makeLoader(root);
  const routesFile = parseTrackedJson(loader, "config/development-task-routes.yaml", "task routing configuration");
  const registryFile = parseTrackedJson(loader, "config/development-skill-registry.yaml", "skill registry");
  const schemaFile = parseTrackedJson(loader, "schemas/development-task.schema.json", "development task schema");
  const routesConfig = routesFile.value;
  const registry = registryFile.value;
  if (routesConfig.schema_version !== "1.0.0" || !routesConfig.core || !Array.isArray(routesConfig.routes)) fail("development-task-routes.yaml has an invalid top-level contract");
  if (registry.schema_version !== "1.0.0" || !Array.isArray(registry.skills)) fail("development-skill-registry.yaml has an invalid top-level contract");

  const intents = deriveIntents(rawIntents, routesConfig.intent_aliases || {});
  const selected = [{ route: routesConfig.core, id: routesConfig.core.id, reasons: ["base:governed-task-contract"] }];
  for (const route of routesConfig.routes) {
    if (!route.id || !route.match || !Array.isArray(route.skills)) fail("every route must have id, match, and skills");
    const result = matchRoute(route, intents, changedPaths);
    if (result.selected) selected.push({ route, id: route.id, reasons: result.reasons });
  }

  const roles = dedupe(selected.flatMap(({ route }) => route.roles || []));
  const clauses = dedupe(selected.flatMap(({ route }) => route.clauses || []));
  const mustRead = dedupe([
    ...selected.flatMap(({ route }) => route.must_read || []),
    ...(roles.includes("frontend") ? ["frontend/AGENTS.md"] : []),
    ...(roles.includes("backend") ? ["backend/AGENTS.md"] : []),
  ]);
  const skillIds = dedupe(selected.flatMap(({ route }) => route.skills || []));
  if (!roles.length || !clauses.length || !skillIds.length) fail("selected routes must provide roles, clauses, and at least the routing skill");

  for (const reading of mustRead) loader.load(reading, "mandatory reading");
  const registryById = new Map();
  for (const skill of registry.skills) {
    if (!skill?.id || registryById.has(skill.id)) fail(`skill registry has a missing or duplicate id: ${skill?.id || "(blank)"}`);
    registryById.set(skill.id, skill);
  }

  const skills = [];
  for (const skillId of skillIds) {
    const entry = registryById.get(skillId);
    if (!entry) fail(`selected skill is not registered: ${skillId}`);
    if (entry.version !== "1.0.0" || !Array.isArray(entry.templates) || !entry.templates.length || !Array.isArray(entry.dependencies) || !entry.dependencies.length) fail(`skill registry entry is incomplete or has unsupported version: ${skillId}`);
    const skillFile = loader.load(entry.skill_file, `skill source ${skillId}`);
    const frontmatter = parseSkillFrontmatter(skillFile.content, skillFile.path);
    if (frontmatter.name !== skillId) fail(`skill frontmatter name does not match registry: ${skillFile.path}`);
    const templates = entry.templates.map((relative) => {
      const loaded = loader.load(relative, `skill template ${skillId}`);
      const expectedKind = path.posix.basename(relative, ".json");
      assertTemplate(loaded, expectedKind, relative);
      return loaded;
    });
    const dependencies = entry.dependencies.map((relative) => loader.load(relative, `skill dependency ${skillId}`));
    skills.push({
      id: skillId,
      version: entry.version,
      skill_file: skillFile.path,
      source_hash: skillFile.sha256,
      template_hashes: templates.map(fileHash),
      dependency_hashes: dependencies.map(fileHash)
    });
  }

  const outputMap = new Map();
  const checkMap = new Map();
  for (const { route, id } of selected) {
    for (const output of route.required_outputs || []) addOutput(outputMap, output, id);
    for (const check of route.checks || []) addCheck(checkMap, check, id);
  }
  const contract = {
    schema_version: 1,
    kind: "task-contract",
    status: "complete",
    owner: "project-manager",
    requirement_refs: clauses,
    subject: { task_id: taskId, intents, paths: changedPaths },
    decisions: {
      route_selection: selected.map(({ id, reasons }) => ({ id, match_reasons: reasons })),
      responsibility_roles: roles,
      mandatory_reading: mustRead,
      required_skill_ids: skillIds
    },
    verification: { preflight: { status: "passed", method: "actual-file-load-and-hash", loaded_file_count: loader.snapshots().length } },
    task: { id: taskId, intents, paths: changedPaths },
    matched_routes: selected.map(({ id, reasons }) => ({ id, match_reasons: reasons })),
    governance: { roles, clauses, must_read: mustRead, skills, loaded_files: loader.snapshots() },
    required_outputs: [...outputMap.values()],
    required_checks: [...checkMap.values()]
  };
  const schemaErrors = validateSchema(schemaFile.value, schemaFile.value.$defs.taskContract, contract);
  if (schemaErrors.length) fail(`generated task contract violates schema:\n${schemaErrors.join("\n")}`);

  fs.mkdirSync(out, { recursive: true });
  const contractFile = path.join(out, "task-contract.json");
  writeJson(contractFile, contract);
  const bundle = {
    schema_version: 1,
    kind: "development-loading-bundle",
    task_contract: { file: "task-contract.json", sha256: sha256(fs.readFileSync(contractFile, "utf8")) },
    instruction: "Provide the included file contents to the development entry point before implementation. The bundle was built from actual reads; do not substitute registry declarations for these contents.",
    files: loader.snapshots(true)
  };
  writeJson(path.join(out, "loading-bundle.json"), bundle);
  console.log(JSON.stringify({ status: "passed", task_id: taskId, routes: contract.matched_routes, skills: skills.map(({ id, version }) => ({ id, version })), outputs: contract.required_outputs.map((item) => item.id), checks: contract.required_checks.map((item) => ({ id: item.id, type: item.type })), out }, null, 2));
}

try { main(); }
catch (error) { console.error(`development-preflight failed: ${error.message}`); process.exitCode = 1; }
