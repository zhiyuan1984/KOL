#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  fail,
  parseArgs,
  readText,
  repoPath,
  scriptRoot,
  sha256,
  validateSchema,
  writeJson
} from "./development-lib.mjs";

function usage() {
  console.error("Usage: node scripts/development-verify.mjs --contract <task-contract.json> --delivery <development-delivery.json> [--out <report.json>] [--root <repository>]");
}

function readJsonFile(file, label, errors) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { errors.push(`${label} is not readable JSON: ${error.message}`); return null; }
}

function externalFile(base, reference, label, errors) {
  if (typeof reference !== "string" || !reference || path.isAbsolute(reference)) { errors.push(`${label} must use a non-empty relative path`); return null; }
  const file = path.resolve(base, reference);
  if (!file.startsWith(`${base}${path.sep}`) && file !== base) { errors.push(`${label} escapes its delivery directory`); return null; }
  if (!fs.existsSync(file)) { errors.push(`${label} is missing: ${reference}`); return null; }
  return file;
}

function verifyHash(file, expected, label, errors) {
  if (!file || typeof expected !== "string") return;
  const actual = sha256(fs.readFileSync(file));
  if (actual !== expected) errors.push(`${label} hash mismatch`);
}

function listSchemaErrors(errors, prefix, schemaErrors) {
  for (const error of schemaErrors) errors.push(`${prefix} schema: ${error}`);
}

function hasNonEmptyObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  const root = path.resolve(args.root || scriptRoot);
  const contractFile = typeof args.contract === "string" ? path.resolve(args.contract) : "";
  const deliveryFile = typeof args.delivery === "string" ? path.resolve(args.delivery) : "";
  if (!contractFile || !deliveryFile) { usage(); fail("contract and delivery are required"); }
  const errors = [];
  const warnings = [];
  const contract = readJsonFile(contractFile, "task contract", errors);
  const delivery = readJsonFile(deliveryFile, "delivery record", errors);
  let schema = null;
  try { schema = JSON.parse(readText(root, "schemas/development-task.schema.json", "development task schema").content); }
  catch (error) { errors.push(error.message); }
  if (schema && contract) listSchemaErrors(errors, "task contract", validateSchema(schema, schema.$defs.taskContract, contract));
  if (schema && delivery) listSchemaErrors(errors, "delivery record", validateSchema(schema, schema.$defs.deliveryRecord, delivery));
  if (!contract || !delivery || !schema) {
    const report = { status: "failed", errors, warnings, machine_verification: { status: "failed", checks: [] }, human_browser_review: { status: "invalid-record", checks: [], note: "No expert review was inferred by this script." } };
    if (args.out) writeJson(path.resolve(args.out), report);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  if (delivery.task_contract?.file !== path.basename(contractFile)) errors.push("delivery record task_contract.file must name the supplied contract file");
  if (delivery.task_contract?.sha256 !== sha256(fs.readFileSync(contractFile, "utf8"))) errors.push("delivery record task contract hash mismatch");
  if (!hasNonEmptyObject(contract.decisions)) errors.push("task contract decisions must not be empty");
  if (contract.status === "draft") errors.push("task contract cannot be draft");

  for (const source of contract.governance?.loaded_files || []) {
    try {
      const actual = readText(root, source.path, "preflight source re-read");
      if (actual.sha256 !== source.sha256) errors.push(`loaded source hash changed: ${source.path}`);
    } catch (error) { errors.push(error.message); }
  }

  const deliveryDir = path.dirname(deliveryFile);
  const expectedOutputs = (contract.required_outputs || []).filter((item) => item.fulfillment === "delivery");
  const expectedOutputIds = new Set(expectedOutputs.map((item) => item.id));
  const artifactById = new Map();
  for (const artifact of delivery.artifacts || []) {
    if (artifactById.has(artifact.id)) errors.push(`delivery has duplicate artifact record: ${artifact.id}`);
    artifactById.set(artifact.id, artifact);
    if (!expectedOutputIds.has(artifact.id)) errors.push(`delivery declares an unexpected artifact: ${artifact.id}`);
  }
  const claims = new Map();
  for (const expected of expectedOutputs) {
    const artifact = artifactById.get(expected.id);
    if (!artifact) { errors.push(`required artifact is missing: ${expected.id}`); continue; }
    if (artifact.status !== "complete") errors.push(`required artifact is not complete: ${expected.id} (${artifact.status})`);
    const file = externalFile(deliveryDir, artifact.file, `artifact ${expected.id}`, errors);
    verifyHash(file, artifact.sha256, `artifact ${expected.id}`, errors);
    const value = file ? readJsonFile(file, `artifact ${expected.id}`, errors) : null;
    if (!value) continue;
    listSchemaErrors(errors, `artifact ${expected.id}`, validateSchema(schema, schema.$defs.artifact, value));
    if (value.kind !== expected.id) errors.push(`artifact kind does not match required output: expected ${expected.id}, got ${value.kind}`);
    if (value.task_id !== contract.task.id) errors.push(`artifact task_id does not match task contract: ${expected.id}`);
    if (value.status === "draft" || !hasNonEmptyObject(value.decisions)) errors.push(`artifact cannot be draft and must contain decisions: ${expected.id}`);
    for (const claim of value.status_claims || []) {
      const key = `${claim.subject}\u0000${claim.fact}`;
      const values = claims.get(key) || new Set();
      values.add(claim.value);
      claims.set(key, values);
    }
  }
  for (const [key, claimValues] of claims) if (claimValues.size > 1) errors.push(`conflicting status claims for ${key.replace("\u0000", " / ")}: ${[...claimValues].join(", ")}`);

  const expectedChecks = new Map((contract.required_checks || []).map((item) => [item.id, item]));
  const checkById = new Map();
  const machineChecks = [];
  const humanChecks = [];
  for (const check of delivery.checks || []) {
    if (checkById.has(check.id)) errors.push(`delivery has duplicate check record: ${check.id}`);
    checkById.set(check.id, check);
    const expected = expectedChecks.get(check.id);
    if (!expected) errors.push(`delivery declares an unexpected check: ${check.id}`);
    else if (check.type !== expected.type) errors.push(`check type does not match contract: ${check.id}`);
    if (check.status !== "passed") errors.push(`check is not passed (failed, skipped, pending, and not-run are blocking): ${check.id} (${check.status})`);
    const evidenceKinds = new Set((check.evidence || []).map((item) => item.kind));
    for (const evidence of check.evidence || []) {
      const evidenceFile = externalFile(deliveryDir, evidence.file, `evidence for ${check.id}`, errors);
      verifyHash(evidenceFile, evidence.sha256, `evidence for ${check.id}`, errors);
    }
    if (check.type === "machine") {
      if (typeof check.command !== "string" || !check.command) errors.push(`machine check command is missing: ${check.id}`);
      if (check.exit_code !== 0) errors.push(`machine check exit_code must be 0: ${check.id}`);
      if (!evidenceKinds.has("test-report")) errors.push(`machine check requires test-report evidence: ${check.id}`);
      machineChecks.push({ id: check.id, status: check.status });
    } else {
      if (typeof check.reviewer !== "string" || !check.reviewer || typeof check.reviewed_at !== "string" || !check.reviewed_at) errors.push(`human or browser check requires named reviewer and review time: ${check.id}`);
      const allowedEvidence = check.type === "human-browser" ? ["screenshot", "browser-record", "source-compare"] : ["source-review", "source-compare"];
      if (![...evidenceKinds].some((kind) => allowedEvidence.includes(kind))) errors.push(`human review evidence is not appropriate for ${check.type}: ${check.id}`);
      humanChecks.push({ id: check.id, status: check.status, reviewer: check.reviewer || null, review_record: check.reviewed_at || null });
    }
  }
  for (const [id] of expectedChecks) if (!checkById.has(id)) errors.push(`required check is missing: ${id}`);

  const report = {
    status: errors.length ? "failed" : "passed",
    task_id: contract.task.id,
    errors,
    warnings,
    machine_verification: { status: errors.length ? "failed" : "passed", checks: machineChecks },
    human_browser_review: {
      status: errors.length ? "invalid-record" : "records-present-not-automatically-judged",
      checks: humanChecks,
      note: "This CLI validates supplied names, hashes, and evidence categories only. It does not claim that an expert reviewed UX or that browser/source fidelity is acceptable."
    }
  };
  if (args.out) writeJson(path.resolve(args.out), report);
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
}

try { main(); }
catch (error) { console.error(`development-verify failed: ${error.message}`); process.exitCode = 1; }
