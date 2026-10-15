#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scriptRoot, sha256, writeJson } from "./development-lib.mjs";

const preflight = path.join(scriptRoot, "scripts", "development-preflight.mjs");
const verify = path.join(scriptRoot, "scripts", "development-verify.mjs");
const sourceRegistry = JSON.parse(fs.readFileSync(path.join(scriptRoot, "config", "development-skill-registry.yaml"), "utf8"));

function mkdir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function copy(relative, root) {
  const source = path.join(scriptRoot, relative);
  const target = path.join(root, relative);
  mkdir(target);
  fs.copyFileSync(source, target);
}
function output(file) { return fs.readFileSync(file, "utf8"); }
function run(label, script, args, expected = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  if (result.status !== expected) {
    throw new Error(`${label} expected exit ${expected}, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kol-development-execution-"));
  for (const relative of [
    "AGENTS.md", "docs/AGENTS.md", "docs/CONSTITUTION.md", "docs/TECHNOLOGY.md", "docs/DESIGN.md", "docs/ia-information-architecture.md",
    "frontend/AGENTS.md", "backend/AGENTS.md",
    "frontend/package.json", "frontend/src/styles.css", "config/development-task-routes.yaml", "config/development-skill-registry.yaml", "schemas/development-task.schema.json"
  ]) copy(relative, root);
  for (const skill of sourceRegistry.skills) {
    for (const dependency of skill.dependencies) copy(dependency, root);
    const skillFile = path.join(root, skill.skill_file);
    mkdir(skillFile);
    fs.writeFileSync(skillFile, `---\nname: ${skill.id}\ndescription: Fixture skill for deterministic governance execution tests.\n---\n\nUse the registered template.\n`, "utf8");
    for (const template of skill.templates) {
      const target = path.join(root, template);
      mkdir(target);
      writeJson(target, { schema_version: 1, kind: path.basename(template, ".json"), status: "draft", owner: "fixture-owner", requirement_refs: [], subject: {}, decisions: {}, verification: {} });
    }
  }
  return root;
}
function preflightKnowledge(root, name = "knowledge") {
  const out = path.join(root, name);
  run("knowledge preflight", preflight, ["--root", root, "--task-id", "knowledge-governance-test", "--intent", "知识提炼,异步任务,文档预览", "--path", "frontend/src/admin/knowledge/DocumentRail.tsx", "--path", "backend/src/knowledge/knowledge-job.ts", "--out", out]);
  return { out, contract: JSON.parse(output(path.join(out, "task-contract.json"))) };
}
function makeDelivery(root, out, contract) {
  const artifacts = [];
  for (const requirement of contract.required_outputs.filter((item) => item.fulfillment === "delivery")) {
    const relative = `${requirement.id}.json`;
    const file = path.join(out, relative);
    const value = {
      schema_version: 1,
      kind: requirement.id,
      status: "complete",
      owner: requirement.owner_roles[0],
      requirement_refs: contract.requirement_refs,
      subject: { task_id: contract.task.id, output: requirement.id },
      decisions: { fixture_decision: `complete ${requirement.id}` },
      verification: { fixture: "prepared-for-verify" },
      task_id: contract.task.id,
      summary: `fixture ${requirement.id}`,
      status_claims: requirement.id === "state-and-action-map" ? [{ subject: "job:fixture", fact: "extraction", value: "running" }] : []
    };
    writeJson(file, value);
    artifacts.push({ id: requirement.id, file: relative, sha256: sha256(output(file)), status: "complete" });
  }
  const checks = [];
  for (const requirement of contract.required_checks) {
    const evidenceRelative = `evidence/${requirement.id}.txt`;
    const evidenceFile = path.join(out, evidenceRelative);
    mkdir(evidenceFile);
    fs.writeFileSync(evidenceFile, `${requirement.id} fixture evidence\n`, "utf8");
    const machine = requirement.type === "machine";
    checks.push({
      id: requirement.id,
      type: requirement.type,
      status: "passed",
      ...(machine ? { command: "node --test fixture", exit_code: 0 } : { reviewer: "fixture reviewer", reviewed_at: "2026-10-15T09:00:00.000Z" }),
      evidence: [{ file: evidenceRelative, sha256: sha256(output(evidenceFile)), kind: machine ? "test-report" : "source-compare" }]
    });
  }
  const delivery = {
    schema_version: "1.0.0",
    kind: "development-delivery-record",
    task_contract: { file: "task-contract.json", sha256: sha256(output(path.join(out, "task-contract.json"))) },
    artifacts,
    checks
  };
  const file = path.join(out, "development-delivery.json");
  writeJson(file, delivery);
  return { file, delivery };
}
function verifyDelivery(root, out, deliveryFile, expected = 0) {
  return run("delivery verify", verify, ["--root", root, "--contract", path.join(out, "task-contract.json"), "--delivery", deliveryFile, "--out", path.join(out, "verify-report.json")], expected);
}

function positiveCase() {
  const root = fixture();
  const { out, contract } = preflightKnowledge(root);
  const skillIds = new Set(contract.governance.skills.map((item) => item.id));
  for (const id of ["governed-task-routing", "ux-task-and-state-design", "responsive-page-layout", "antd-component-engineering", "document-fidelity-viewing", "async-job-observability", "ui-evidence-verification"]) assert(skillIds.has(id), `knowledge route must load ${id}`);
  assert(contract.governance.must_read.includes("frontend/AGENTS.md"));
  assert(contract.governance.must_read.includes("backend/AGENTS.md"));
  const delivery = makeDelivery(root, out, contract);
  const result = verifyDelivery(root, out, delivery.file);
  assert.match(result.stdout, /records-present-not-automatically-judged/, "verify must distinguish supplied manual records from automated judgement");
}
function missingSkillCase() {
  const root = fixture();
  fs.rmSync(path.join(root, ".agents/skills/governed-task-routing/SKILL.md"));
  run("missing skill", preflight, ["--root", root, "--task-id", "missing-skill", "--intent", "ui", "--path", "frontend/src/App.tsx", "--out", path.join(root, "out")], 1);
}
function missingDependencyCase() {
  const root = fixture();
  fs.rmSync(path.join(root, "docs/ia-information-architecture.md"));
  run("missing dependency", preflight, ["--root", root, "--task-id", "missing-dependency", "--intent", "navigation", "--path", "frontend/src/App.tsx", "--out", path.join(root, "out")], 1);
}
function backendOnlyCase() {
  const root = fixture();
  const out = path.join(root, "backend-only");
  run("backend-only preflight", preflight, ["--root", root, "--task-id", "backend-only", "--intent", "backend api", "--path", "backend/src/security/session.ts", "--out", out]);
  const contract = JSON.parse(output(path.join(out, "task-contract.json")));
  assert.deepEqual(contract.governance.skills.map((item) => item.id), ["governed-task-routing"], "unrelated backend change must not load all UI skills");
  assert(contract.matched_routes.some((route) => route.id === "backend-unrelated-change"), "backend-only route must be selected");
}
function conflictCase() {
  const root = fixture();
  const { out, contract } = preflightKnowledge(root, "conflict");
  const { file, delivery } = makeDelivery(root, out, contract);
  const artifact = delivery.artifacts.find((item) => item.id === "state-and-action-map");
  const artifactFile = path.join(out, artifact.file);
  const value = JSON.parse(output(artifactFile));
  value.status_claims.push({ subject: "job:fixture", fact: "extraction", value: "not-started" });
  writeJson(artifactFile, value);
  artifact.sha256 = sha256(output(artifactFile));
  writeJson(file, delivery);
  verifyDelivery(root, out, file, 1);
}
function missingArtifactCase() {
  const root = fixture();
  const { out, contract } = preflightKnowledge(root, "missing-artifact");
  const { file, delivery } = makeDelivery(root, out, contract);
  fs.rmSync(path.join(out, delivery.artifacts[0].file));
  verifyDelivery(root, out, file, 1);
}
function skippedEvidenceCase() {
  const root = fixture();
  const { out, contract } = preflightKnowledge(root, "skipped-evidence");
  const { file, delivery } = makeDelivery(root, out, contract);
  delivery.checks[0].status = "skipped";
  writeJson(file, delivery);
  verifyDelivery(root, out, file, 1);
}
function sourceHashTamperCase() {
  const root = fixture();
  const { out, contract } = preflightKnowledge(root, "hash-tamper");
  const { file } = makeDelivery(root, out, contract);
  fs.appendFileSync(path.join(root, ".agents/skills/governed-task-routing/SKILL.md"), "\nTampered after preflight.\n", "utf8");
  verifyDelivery(root, out, file, 1);
}

function binaryEvidenceCase() {
  const root = fixture();
  const { out, contract } = preflightKnowledge(root, "binary-evidence");
  const { file, delivery } = makeDelivery(root, out, contract);
  const humanCheck = delivery.checks.find(check => check.type === "human-browser");
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 255, 254, 128]);
  const evidenceFile = path.join(out, "evidence", "binary-fixture.png");
  fs.writeFileSync(evidenceFile, bytes);
  humanCheck.evidence = [{ file: "evidence/binary-fixture.png", sha256: sha256(bytes), kind: "screenshot" }];
  writeJson(file, delivery);
  verifyDelivery(root, out, file);
  fs.appendFileSync(evidenceFile, Buffer.from([0]));
  verifyDelivery(root, out, file, 1);
}

positiveCase();
missingSkillCase();
missingDependencyCase();
backendOnlyCase();
conflictCase();
missingArtifactCase();
skippedEvidenceCase();
sourceHashTamperCase();
binaryEvidenceCase();
console.log("development execution tests passed: positive path plus missing-skill, missing-dependency, backend-only, status-conflict, missing-artifact, skipped-evidence, and source-hash-tamper cases");
