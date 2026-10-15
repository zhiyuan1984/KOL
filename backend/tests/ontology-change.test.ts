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
import { assertOntologyChangeAllowed, ONTOLOGY_CHANGE_SCOPES, ontologyRegistryBaseline } from "../src/routers/ontology.js";

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
    expect(router).not.toContain("getConn");
    expect(router).toContain("ontology_change_target_required");
    expect(router).toContain("target_digest");
    expect(router).toContain('ontology.get("/admin/ontology/registries"');
  });

  it("has a release check that records an explicit bootstrap receipt once and warns (never blocks) on changed registries without matching PG approvals", () => {
    const gate = source("backend/scripts/check-ontology-release.ts");
    expect(gate).toContain("ontology_release_ledger");
    expect(gate).toContain("approval_not_claimed: true");
    expect(gate).toContain("target_digest");
    expect(gate).toContain("仅提醒");
    // 2026-10-15：审批只提醒、不阻断部署（部署等审批是死锁）。禁止用环境开关绕过——
    // 提醒本身是代码写死的，不存在开关；不要再加 SKIP/DISABLE/BYPASS。
    expect(gate).not.toMatch(/SKIP_?ONTOLOGY|DISABLE_?ONTOLOGY|BYPASS_?ONTOLOGY/i);
  });

  it("invokes the release check before asset replacement and records its factual baseline only after health", () => {
    const deploy = source("scripts/deploy.sh");
    expect(deploy).toContain('"$ONTOLOGY_GATE" "$ROOT/backend/scripts/check-ontology-release.ts"');
    expect(deploy).toContain('"$ONTOLOGY_GATE" "$ROOT/backend/scripts/check-ontology-release.ts" --record');
    expect(deploy.indexOf("检查本体 registry 发布状态")).toBeLessThan(deploy.indexOf("构建前端 → frontend/"));
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
    fs.copyFileSync(
      path.join(root, "backend/scripts/check-ontology-release.ts"),
      path.join(worktree, "backend/scripts/check-ontology-release.ts"),
    );
    fs.symlinkSync(path.join(root, "backend/node_modules"), path.join(worktree, "backend/node_modules"));
  });

  afterAll(async () => {
    await closePostgresPool();
    if (worktree) execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "pipe" });
    if (database) {
      await maintenance.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]);
      await maintenance.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await maintenance.end();
    if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldDatabaseUrl;
  });

  it("records a factual bootstrap without claiming CEO approval, warns for an unapproved release, and records only an exactly matched consumed approval", async () => {
    const bootstrap = runGate("--base", "HEAD", "--record");
    expect(bootstrap.status, bootstrap.stderr).toBe(0);
    expect(bootstrap.body).toMatchObject({ status: "pass", mode: "bootstrap_install", receipt: { bootstrap: true, approval_not_claimed: true, ledger_recorded: true } });
    await expect(postgresPool().query("UPDATE ontology_release_ledger SET scope = scope")).rejects.toThrow(/append-only/);
    await expect(postgresPool().query("DELETE FROM ontology_release_ledger")).rejects.toThrow(/append-only/);
    await expect(postgresPool().query("TRUNCATE ontology_release_ledger")).rejects.toThrow(/append-only/);

    const eventCatalog = path.join(worktree, "config/event-catalog.yaml");
    fs.appendFileSync(eventCatalog, "\n");
    const warned = runGate("--base", "HEAD");
    expect(warned.status, warned.stderr).toBe(0);
    expect(warned.body).toMatchObject({
      status: "pass",
      receipt: { bootstrap: false, approval_not_claimed: true, ledger_recorded: false },
      approval_authority_unavailable: false,
      approved_scopes: [],
    });
    const firstWarning = (warned.body.unapproved_scopes as Array<Record<string, string>>)[0];
    expect(firstWarning).toMatchObject({ scope: "events" });
    expect(firstWarning.required_base_version).toMatch(/^events:v\d+@(git:[a-f0-9]{40}|sha256:[a-f0-9]{64})$/);
    expect(firstWarning.target_digest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const now = "2032-01-01T00:00:00.000Z";
    const insertConsumedApproval = async (payload: Record<string, string>, fingerprint: string) => {
      const id = `appr_${randomUUID()}`;
      await postgresPool().query(
        `INSERT INTO approvals
         (id,draft_id,brand,amount_usd,status,chain,current_index,uses_left,fingerprint,need_manual_band,wecom_card_id,created_at,chain_id,kind,payload,title,submitted_by,version,updated_at)
         VALUES ($1,'','LT',0,'consumed','[]',0,0,$2,0,$3,$4,$3,'ontology_change',$5,'gate test','test',1,$4)`,
        [id, fingerprint, `card_${randomUUID()}`, now, JSON.stringify(payload)],
      );
      return id;
    };

    // A consumed record is still not a permit when either the scope or target
    // content hash differs. This mirrors the admin-side guard; the deployment
    // tool may warn, but it must not falsely claim that these records approved it.
    await insertConsumedApproval({
      scope: "objects",
      base_version: firstWarning.required_base_version,
      target_digest: firstWarning.target_digest,
    }, "ontology-gate-scope-mismatch");
    await insertConsumedApproval({
      scope: "events",
      base_version: firstWarning.required_base_version,
      target_digest: `sha256:${"0".repeat(64)}`,
    }, "ontology-gate-digest-mismatch");
    await expect(assertOntologyChangeAllowed("events", firstWarning.required_base_version, firstWarning.target_digest)).rejects.toMatchObject({
      status: 403,
      detail: { code: "ontology_change_approval_required" },
    });

    const approvalId = await insertConsumedApproval({
      scope: "events",
      base_version: firstWarning.required_base_version,
      target_digest: firstWarning.target_digest,
    }, "ontology-gate-exact-match");
    const approvalFact = await postgresPool().query<{ id: string; status: string; uses_left: number; version: number; payload: string }>(
      "SELECT id, status, uses_left, version, payload FROM approvals WHERE id = $1",
      [approvalId],
    );
    expect(approvalFact.rows).toEqual([expect.objectContaining({
      id: approvalId,
      status: "consumed",
      uses_left: 0,
      version: 1,
    })]);
    expect(JSON.parse(approvalFact.rows[0].payload)).toEqual({
      scope: "events",
      base_version: firstWarning.required_base_version,
      target_digest: firstWarning.target_digest,
    });
    await expect(assertOntologyChangeAllowed("events", firstWarning.required_base_version, firstWarning.target_digest)).resolves.toBeUndefined();

    const approved = runGate("--base", "HEAD");
    expect(approved.status, approved.stderr).toBe(0);
    expect(approved.body).toMatchObject({
      status: "pass",
      receipt: { bootstrap: false, approval_not_claimed: false, ledger_recorded: false },
      unapproved_scopes: [],
      approved_scopes: [{
        scope: "events",
        approval_id: approvalId,
        base_version: firstWarning.required_base_version,
        target_digest: firstWarning.target_digest,
      }],
    });

    const recorded = runGate("--base", "HEAD", "--record");
    expect(recorded.status, recorded.stderr).toBe(0);
    expect(recorded.body).toMatchObject({
      status: "pass",
      receipt: { bootstrap: false, approval_not_claimed: false, ledger_recorded: true },
      approved_scopes: [{ scope: "events", approval_id: approvalId, target_digest: firstWarning.target_digest }],
    });
    const eventLedger = await postgresPool().query<{ scope: string; content_digest: string; approval_id: string | null; bootstrap: boolean }>(
      "SELECT scope, content_digest, approval_id, bootstrap FROM ontology_release_ledger WHERE scope = 'events' ORDER BY deployed_at DESC, id DESC LIMIT 1",
    );
    expect(eventLedger.rows).toEqual([{
      scope: "events",
      content_digest: firstWarning.target_digest,
      approval_id: approvalId,
      bootstrap: false,
    }]);
  });
});
