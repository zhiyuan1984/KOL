import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APPROVAL_KIND_LABEL } from "../src/gateway/wecom.js";
import { fulfillExpenseApproval } from "../src/host/approval-fulfill.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { ONTOLOGY_CHANGE_SCOPES, ontologyRegistryBaseline } from "../src/routers/ontology.js";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(backend, "..");
const source = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("ontology_change approval kind", () => {
  it("is a registered approval kind with a Chinese label", () => {
    expect(APPROVAL_KIND_LABEL.ontology_change).toBe("本体变更");
  });

  it("covers the four registry scopes", () => {
    expect([...ONTOLOGY_CHANGE_SCOPES]).toEqual(["objects", "events", "tickets", "rules"]);
  });

  it("derives a real registry baseline from version plus an exact Git commit or file digest", () => {
    const baseline = ontologyRegistryBaseline("events");
    expect(baseline.registry_version).toBeGreaterThanOrEqual(0);
    expect(baseline.content_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(baseline.base_version).toMatch(/^events:v\d+@(git:[a-f0-9]{40}|sha256:[a-f0-9]{64})$/);
  });

  it("requires authenticated admin, PostgreSQL approval authority and a target digest instead of the app_state PM shortcut", () => {
    const router = source("backend/src/routers/ontology.ts");
    expect(router).toContain('import { requireAdmin } from "../auth.js"');
    expect(router).toContain('import { postgresPool } from "../postgres/pool.js"');
    expect(router).not.toContain("requirePm");
    expect(router).not.toContain("postgresDb");
    expect(router).toContain("ontology_change_target_required");
    expect(router).toContain("target_digest");
    expect(router).toContain('ontology.get("/admin/ontology/registries"');
  });

  it("has a release gate that records an explicit bootstrap receipt once and rejects later changed registries without matching PG approvals", () => {
    const gate = source("backend/scripts/check-ontology-release.ts");
    expect(gate).toContain("ontology_release_ledger");
    expect(gate).toContain("approval_not_claimed: true");
    expect(gate).toContain("ontology_change_approval_required");
    expect(gate).toContain("target_digest");
    expect(gate).not.toMatch(/SKIP_?ONTOLOGY|DISABLE_?ONTOLOGY|BYPASS_?ONTOLOGY/i);
  });

  it("invokes the release gate before asset replacement and records its factual baseline only after health", () => {
    const deploy = source("scripts/deploy.sh");
    expect(deploy).toContain('"$ONTOLOGY_GATE" "$ROOT/backend/scripts/check-ontology-release.ts"');
    expect(deploy).toContain('"$ONTOLOGY_GATE" "$ROOT/backend/scripts/check-ontology-release.ts" --record');
    expect(deploy.indexOf("检查本体 registry 发布门禁")).toBeLessThan(deploy.indexOf("构建前端 → frontend/$BUILD_DIR"));
    expect(deploy.lastIndexOf("record_ontology_release")).toBeGreaterThan(deploy.indexOf("服务已恢复："));
  });
  it("fulfill is a no-op permit like skill_publish (the approval itself is the permit)", async () => {
    const result = await fulfillExpenseApproval({ kind: "ontology_change" } as never);
    expect(result).toMatchObject({ ontology_change: true, sent: false, stage_changed: false });
  });
});

const isolatedPostgres = Boolean(process.env.TEST_POSTGRES_URL);

describe.skipIf(!isolatedPostgres)("ontology release gate (isolated PostgreSQL)", () => {
  let maintenance: Pool;
  let database = "";
  let worktree = "";
  let oldDatabaseUrl: string | undefined;

  const runGate = (...args: string[]) => {
    const result = spawnSync(path.join(root, "backend/node_modules/.bin/tsx"), [
      path.join(worktree, "backend/scripts/check-ontology-release.ts"),
      ...args,
    ], {
      cwd: worktree,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" },
      encoding: "utf8",
    });
    const body = JSON.parse(String(result.stdout || "{}")) as Record<string, unknown>;
    return { status: result.status, body, stderr: String(result.stderr || "") };
  };

  beforeAll(async () => {
    maintenance = new Pool({ connectionString: process.env.TEST_POSTGRES_URL });
    database = `ontology_gate_${randomUUID().replaceAll("-", "")}`;
    await maintenance.query(`CREATE DATABASE "${database}"`);
    const url = new URL(process.env.TEST_POSTGRES_URL!);
    url.pathname = `/${database}`;
    oldDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString();
    await closePostgresPool();
    let baseline = fs.readFileSync(path.join(backend, "migrations/pg-baseline.sql"), "utf8");
    baseline = baseline
      .split(/\r?\n/)
      .filter((line) => !line.startsWith("\\") && !line.startsWith("SET transaction_timeout"))
      .map((line) => line.includes("set_config('search_path'") ? "SELECT pg_catalog.set_config('search_path', 'public', false);" : line)
      .join("\n");
    await postgresPool().query(baseline);

    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "ontology-release-gate-"));
    fs.rmSync(worktree, { recursive: true, force: true });
    execFileSync("git", ["worktree", "add", "--detach", worktree, "HEAD"], { cwd: root, stdio: "pipe" });
    fs.copyFileSync(path.join(root, "backend/scripts/check-ontology-release.ts"), path.join(worktree, "backend/scripts/check-ontology-release.ts"));
    fs.symlinkSync(path.join(root, "backend/node_modules"), path.join(worktree, "backend/node_modules"));
  });
  afterAll(async () => {
    await closePostgresPool();
    if (worktree)
      execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "pipe" });
    if (database) {
      await maintenance.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]);
      await maintenance.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await maintenance.end();
    if (oldDatabaseUrl === undefined)
      delete process.env.DATABASE_URL;
    else
      process.env.DATABASE_URL = oldDatabaseUrl;
  });
  it("records the authorized first baseline without claiming CEO approval, then rejects reuse until one matching consumed approval exists", async () => {
    const bootstrap = runGate("--base", "HEAD", "--record");
    expect(bootstrap.status, bootstrap.stderr).toBe(0);
    expect(bootstrap.body).toMatchObject({ status: "pass", mode: "bootstrap_install", receipt: { bootstrap: true, approval_not_claimed: true, ledger_recorded: true } });
    await expect(postgresPool().query("UPDATE ontology_release_ledger SET scope = scope")).rejects.toThrow(/append-only/);
    await expect(postgresPool().query("DELETE FROM ontology_release_ledger")).rejects.toThrow(/append-only/);
    await expect(postgresPool().query("TRUNCATE ontology_release_ledger")).rejects.toThrow(/append-only/);

    const eventCatalog = path.join(worktree, "config/event-catalog.yaml");
    fs.appendFileSync(eventCatalog, "\n");
    const blocked = runGate("--base", "HEAD");
    expect(blocked.status, blocked.stderr).toBe(1);
    expect(blocked.body.code).toBe("ontology_change_approval_required");
    const firstBlocked = (blocked.body.blocked_scopes as Array<Record<string, string>>)[0];
    expect(firstBlocked.scope).toBe("events");
    const now = "2032-01-01T00:00:00.000Z";
    await postgresPool().query(`INSERT INTO approvals
       (id,draft_id,brand,amount_usd,status,chain,current_index,uses_left,fingerprint,need_manual_band,wecom_card_id,created_at,chain_id,kind,payload,title,submitted_by,version,updated_at)
       VALUES ($1,'','LT',0,'consumed','[]',0,0,'ontology-gate-test',0,$2,$3,$2,'ontology_change',$4,'gate test','test',1,$3)`, [
        `appr_${randomUUID()}`, `card_${randomUUID()}`, now,
        JSON.stringify({ scope: "events", base_version: firstBlocked.required_base_version, target_digest: firstBlocked.target_digest }),
    ]);
    const approved = runGate("--base", "HEAD");
    expect(approved.status, approved.stderr).toBe(0);
    expect(approved.body).toMatchObject({ status: "pass", receipt: { bootstrap: false, approval_not_claimed: false } });

    fs.appendFileSync(eventCatalog, " ");
    const changedAgain = runGate("--base", "HEAD");
    expect(changedAgain.status, changedAgain.stderr).toBe(1);
    expect(changedAgain.body.code).toBe("ontology_change_approval_required");
    const secondBlocked = (changedAgain.body.blocked_scopes as Array<Record<string, string>>)[0];
    expect(secondBlocked.target_digest).not.toBe(firstBlocked.target_digest);
  });
});
