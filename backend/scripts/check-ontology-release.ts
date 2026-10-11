import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePostgresPool, postgresPool, postgresTransaction } from "../src/postgres/pool.js";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(backend, "..");

// 与服务启动使用同一份已有配置；Node 22 原生解析，不执行 shell 内容。
// 已导出的环境变量优先，隔离测试和运维调用不会被 .env 覆盖。
if (fs.existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));

const SCOPES = {
  objects: "config/objects-registry.yaml",
  events: "config/event-catalog.yaml",
  tickets: "config/ticket-types.yaml",
  rules: "config/stage-transitions.json",
} as const;

type Scope = keyof typeof SCOPES;
type Fingerprint = {
  scope: Scope;
  config_path: string;
  registry_version: number;
  content_digest: string;
  git_commit: string | null;
  base_version: string;
};
type ApprovalRow = { id: string; status: string; payload: unknown; created_at?: string };
type ApprovalPayload = { scope?: unknown; base_version?: unknown; target_digest?: unknown; change_ref?: unknown };
type LedgerRow = {
  scope: string;
  registry_version: number | string;
  base_version: string;
  content_digest: string;
  git_commit: string | null;
  approval_id: string | null;
  bootstrap: boolean;
};

type GateResult = {
  scope: Scope;
  config_path: string;
  base: Fingerprint;
  target: Fingerprint;
  approval_id?: string;
  reason?: string;
};

function sha256(content: Buffer | string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function gitCommit(ref: string): string | null {
  try {
    if (!ref || ref.startsWith("-")) return null;
    return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function gitFile(commit: string, relativePath: string): Buffer | null {
  try {
    return execFileSync("git", ["show", `${commit}:${relativePath}`], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function registryVersion(content: Buffer, scope: Scope): number {
  try {
    const value = JSON.parse(content.toString("utf8").replace(/^\uFEFF/, "")) as { version?: unknown };
    const version = Number(value.version);
    if (Number.isInteger(version) && version >= 0) return version;
  } catch {
    // The registry validator gives schema detail; this gate only refuses an
    // unverifiable release baseline and never substitutes a guessed version.
  }
  throw new Error(`${scope}: registry version is unreadable`);
}

function fingerprint(scope: Scope, content: Buffer, commit: string | null): Fingerprint {
  const contentDigest = sha256(content);
  const version = registryVersion(content, scope);
  return {
    scope,
    config_path: SCOPES[scope],
    registry_version: version,
    content_digest: contentDigest,
    git_commit: commit,
    base_version: `${scope}:v${version}@${commit ? `git:${commit}` : contentDigest}`,
  };
}

function targetFingerprint(scope: Scope): Fingerprint {
  const relativePath = SCOPES[scope];
  const content = fs.readFileSync(path.join(root, relativePath));
  const head = gitCommit("HEAD");
  const headContent = head ? gitFile(head, relativePath) : null;
  return fingerprint(scope, content, headContent && sha256(headContent) === sha256(content) ? head : null);
}

function baselineFingerprint(scope: Scope, baseCommit: string): Fingerprint {
  const content = gitFile(baseCommit, SCOPES[scope]);
  if (!content) throw new Error(`${scope}: ${baseCommit} does not contain ${SCOPES[scope]}`);
  return fingerprint(scope, content, baseCommit);
}

function parseArgs(): { baseRef: string | null; baseSource: "--base" | "ONTOLOGY_RELEASE_BASE" | null; record: boolean } {
  let baseRef: string | null = null;
  let record = false;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--record") {
      record = true;
      continue;
    }
    if (arg === "--base") {
      const value = String(process.argv[index + 1] || "").trim();
      if (!value) throw new Error("--base requires the actually deployed Git ref");
      baseRef = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (baseRef) return { baseRef, baseSource: "--base", record };
  const releaseBase = String(process.env.ONTOLOGY_RELEASE_BASE || "").trim();
  return releaseBase
    ? { baseRef: releaseBase, baseSource: "ONTOLOGY_RELEASE_BASE", record }
    : { baseRef: null, baseSource: null, record };
}

function payloadOf(value: unknown): ApprovalPayload {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as ApprovalPayload;
  try {
    return JSON.parse(String(value || "{}")) as ApprovalPayload;
  } catch {
    return {};
  }
}

async function matchingApproval(scope: Scope, baseline: Fingerprint, target: Fingerprint): Promise<{ id: string } | null> {
  // This is intentionally native PostgreSQL, not the retired SQLite-shaped
  // bridge. A missing authority connection blocks changed registry release.
  const result = await postgresPool().query<ApprovalRow>(
    "SELECT id, status, payload, created_at FROM approvals WHERE kind = $1 AND status = $2 ORDER BY created_at DESC",
    ["ontology_change", "consumed"],
  );
  for (const row of result.rows) {
    const payload = payloadOf(row.payload);
    if (payload.scope !== scope) continue;
    if (String(payload.base_version || "") !== baseline.base_version) continue;
    // target_digest is mandatory for new approvals. change_ref is retained as
    // auditable provenance but cannot replace its content binding at release.
    if (String(payload.target_digest || "") !== target.content_digest) continue;
    return { id: String(row.id) };
  }
  return null;
}

/**
 * This ledger is intentionally append-only from the release tool's point of
 * view. It is the deployed registry fact, not an env switch: once it has rows,
 * every later release proves the running Git baseline against it before reading
 * approvals. A DBA can still recover a database, but deleting the ledger is an
 * explicit privileged incident, not a hidden deploy bypass.
 */
async function ensureLedger(): Promise<void> {
  await postgresPool().query(`
    CREATE TABLE IF NOT EXISTS ontology_release_ledger (
      id text PRIMARY KEY,
      scope text NOT NULL,
      registry_version bigint NOT NULL,
      base_version text NOT NULL,
      content_digest text NOT NULL,
      git_commit text,
      approval_id text,
      bootstrap boolean NOT NULL,
      deployed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await postgresPool().query(`
    CREATE OR REPLACE FUNCTION ontology_release_ledger_reject_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'ontology_release_ledger is append-only';
    END;
    $$
  `);
  await postgresPool().query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'ontology_release_ledger'::regclass
          AND tgname = 'prevent_immutable_row_change'
          AND NOT tgisinternal
      ) THEN
        CREATE TRIGGER prevent_immutable_row_change
        BEFORE UPDATE OR DELETE ON ontology_release_ledger
        FOR EACH ROW EXECUTE FUNCTION ontology_release_ledger_reject_mutation();
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'ontology_release_ledger'::regclass
          AND tgname = 'prevent_immutable_table_truncate'
          AND NOT tgisinternal
      ) THEN
        CREATE TRIGGER prevent_immutable_table_truncate
        BEFORE TRUNCATE ON ontology_release_ledger
        FOR EACH STATEMENT EXECUTE FUNCTION ontology_release_ledger_reject_mutation();
      END IF;
    END;
    $$
  `);
  await postgresPool().query(
    "CREATE INDEX IF NOT EXISTS ontology_release_ledger_scope_deployed_idx ON ontology_release_ledger (scope, deployed_at DESC, id DESC)",
  );
}

async function latestLedger(): Promise<Map<Scope, LedgerRow>> {
  const result = await postgresPool().query<LedgerRow>(`
    SELECT DISTINCT ON (scope) scope, registry_version, base_version, content_digest, git_commit, approval_id, bootstrap
    FROM ontology_release_ledger
    ORDER BY scope, deployed_at DESC, id DESC
  `);
  const rows = new Map<Scope, LedgerRow>();
  for (const row of result.rows) {
    if (Object.hasOwn(SCOPES, row.scope)) rows.set(row.scope as Scope, row);
  }
  return rows;
}

function ledgerFingerprint(scope: Scope, row: LedgerRow): Fingerprint {
  const version = Number(row.registry_version);
  if (!Number.isInteger(version) || version < 0 || !/^sha256:[a-f0-9]{64}$/.test(String(row.content_digest))) {
    throw new Error(`${scope}: ontology_release_ledger contains an invalid baseline`);
  }
  return {
    scope,
    config_path: SCOPES[scope],
    registry_version: version,
    content_digest: String(row.content_digest),
    git_commit: row.git_commit ? String(row.git_commit) : null,
    base_version: String(row.base_version),
  };
}

async function recordRelease(items: GateResult[], bootstrap: boolean): Promise<void> {
  await postgresTransaction(async (client) => {
    for (const item of items) {
      await client.query(
        `INSERT INTO ontology_release_ledger
         (id, scope, registry_version, base_version, content_digest, git_commit, approval_id, bootstrap)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(), item.scope, item.target.registry_version, item.target.base_version,
          item.target.content_digest, item.target.git_commit, item.approval_id || null, bootstrap,
        ],
      );
    }
  });
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<number> {
  const { baseRef, baseSource, record } = parseArgs();
  if (!baseRef) {
    print({
      status: "blocked",
      code: "ontology_release_baseline_required",
      message: "缺少实际运行中的 Git 基线。首次安装也必须显式传入 --base <当前运行版本commit>；这不会伪造 CEO 审批。",
      changed_scopes: "unknown",
    });
    return 1;
  }

  const baseCommit = gitCommit(baseRef);
  if (!baseCommit) {
    print({
      status: "blocked",
      code: "ontology_release_base_unavailable",
      message: "--base/ONTOLOGY_RELEASE_BASE 必须解析为本仓库可用 Git commit；不会只比较用户输入字符串。",
      base_ref: baseRef,
    });
    return 1;
  }

  const actualRunning = new Map<Scope, Fingerprint>();
  try {
    for (const scope of Object.keys(SCOPES) as Scope[]) {
      actualRunning.set(scope, baselineFingerprint(scope, baseCommit));
    }
  } catch (error) {
    print({
      status: "blocked",
      code: "ontology_registry_baseline_unreadable",
      message: error instanceof Error ? error.message : String(error),
      base_commit: baseCommit,
    });
    return 1;
  }

  let ledger: Map<Scope, LedgerRow>;
  try {
    await ensureLedger();
    ledger = await latestLedger();
  } catch (error) {
    print({
      status: "blocked",
      code: "ontology_release_ledger_unavailable",
      message: "无法读取或创建 PostgreSQL append-only 发布账本；不能通过环境开关绕过未来本体门禁。",
      error: error instanceof Error ? error.message : String(error),
      base_commit: baseCommit,
    });
    return 1;
  }

  const bootstrap = ledger.size === 0;
  if (!bootstrap && ledger.size !== Object.keys(SCOPES).length) {
    print({
      status: "blocked",
      code: "ontology_release_ledger_incomplete",
      message: "发布账本不是完整的四范围基线；停止部署并人工恢复账本，不能回退到 bootstrap。",
      recorded_scopes: [...ledger.keys()],
    });
    return 1;
  }

  const changed: GateResult[] = [];
  const unchanged: GateResult[] = [];
  try {
    for (const scope of Object.keys(SCOPES) as Scope[]) {
      const actual = actualRunning.get(scope)!;
      const target = targetFingerprint(scope);
      const base = bootstrap ? actual : ledgerFingerprint(scope, ledger.get(scope)!);
      if (!bootstrap && base.content_digest !== actual.content_digest) {
        print({
          status: "blocked",
          code: "ontology_release_ledger_mismatch",
          message: "PG 发布账本基线与当前运行版本的真实 registry 内容不一致；不能相信调用者传入的字符串或继续部署。",
          scope,
          ledger_base_version: base.base_version,
          actual_base_version: actual.base_version,
        });
        return 1;
      }
      const item = { scope, config_path: SCOPES[scope], base, target };
      (base.content_digest === target.content_digest ? unchanged : changed).push(item);
    }
  } catch (error) {
    print({ status: "blocked", code: "ontology_release_target_unreadable", message: error instanceof Error ? error.message : String(error) });
    return 1;
  }

  // The user-authorized installation creates the first factual baseline only
  // after deploy.sh observes health and invokes --record. It has no approval
  // claim. Once ledger rows exist this branch is permanently unavailable to
  // normal releases, including changed catalog files.
  if (bootstrap) {
    if (record) await recordRelease([...changed, ...unchanged], true);
    print({
      status: "pass",
      mode: "bootstrap_install",
      message: record
        ? "首次治理基线已作为 PostgreSQL 发布账本事实记录；未声称 CEO 审批。之后每个 registry 内容变化都会被审批门禁校验。"
        : "首次治理安装获当前用户明确授权。尚未声称 CEO 审批；deploy 成功健康检查后必须用 --record 写入首个治理基线。",
      receipt: { bootstrap: true, approval_not_claimed: true, ledger_recorded: record },
      base_commit: baseCommit,
      base_source: baseSource,
      pre_governance_changes: changed.map((item) => ({ scope: item.scope, prior_base_version: item.base.base_version, target_digest: item.target.content_digest })),
      unchanged_scopes: unchanged.map((item) => item.scope),
    });
    return 0;
  }

  const blocked: GateResult[] = [];
  try {
    for (const item of changed) {
      const approval = await matchingApproval(item.scope, item.base, item.target);
      if (approval) item.approval_id = approval.id;
      else {
        item.reason = "缺少已消费的 PostgreSQL ontology_change 审批，或审批的 scope/base_version/target_digest 与待发布文件不完全一致";
        blocked.push(item);
      }
    }
  } catch (error) {
    print({
      status: "blocked",
      code: "ontology_approval_authority_unavailable",
      message: "registry 已变化但无法读取 PostgreSQL 审批权威记录；不能以环境开关、SQLite 或推测 CEO 批准替代。",
      error: error instanceof Error ? error.message : String(error),
      base_commit: baseCommit,
      changed_scopes: changed.map((item) => item.scope),
    });
    return 1;
  }

  if (blocked.length) {
    print({
      status: "blocked",
      code: "ontology_change_approval_required",
      message: "待发布 registry 变化被阻断：每个范围都必须有同真实基线、同目标内容摘要的已消费审批。",
      base_commit: baseCommit,
      base_source: baseSource,
      blocked_scopes: blocked.map((item) => ({
        scope: item.scope,
        config_path: item.config_path,
        required_base_version: item.base.base_version,
        target_digest: item.target.content_digest,
        reason: item.reason,
      })),
      approved_scopes: changed.filter((item) => item.approval_id).map((item) => ({ scope: item.scope, approval_id: item.approval_id })),
    });
    return 1;
  }

  if (record) await recordRelease([...changed, ...unchanged], false);
  print({
    status: "pass",
    message: "所有待发布 registry 变化均匹配 PostgreSQL 中已消费的范围、真实基线和目标内容摘要审批。",
    receipt: { bootstrap: false, approval_not_claimed: false, ledger_recorded: record },
    base_commit: baseCommit,
    base_source: baseSource,
    approved_scopes: changed.map((item) => ({
      scope: item.scope,
      approval_id: item.approval_id,
      base_version: item.base.base_version,
      target_digest: item.target.content_digest,
    })),
    unchanged_scopes: unchanged.map((item) => item.scope),
  });
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    print({ status: "blocked", code: "ontology_release_gate_error", message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(async () => { await closePostgresPool(); });
