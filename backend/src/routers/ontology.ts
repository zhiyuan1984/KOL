import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { roleHolder } from "../approval/org.js";
import { defaultOrgSnapshot } from "../approval/snapshot.js";
import { requireAdmin } from "../auth.js";
import { audit } from "../postgres/access.js";
import { createWorkApproval } from "../gateway/wecom.js";
import { HttpFail } from "../host/errors.js";
import { postgresPool } from "../postgres/pool.js";
import type { Employee } from "../approval/types.js";

export const ontology = new Hono();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * 本体变更范围 → 注册表文件。rules 指向阶段转移配置（规则的机器可读载体）。
 * 审宪（CONST-08）：需求=本体变更走统一审批（用户 2026-10-11 决策）；主责=KOL 业务专家（CONST-04，
 * 对象/规则定义权）+ 平台产品经理（载体）；宪法=CONST-02（平台承载、业务专家定义）、CONST-03
 * （确定的规则要有程序执行点）、CONST-05（授权与副作用分离）；基本法=BIZ-01/02（对象与来源口径）、
 * PROD-PLAT-03（配置及版本）。结论=符合：只新增审批 kind 与提交/查询接口，不改审批引擎语义；
 * 文件级变更仍走 Git，审批是治理凭证（一次审批只放行一次变更，base_version 绑定）。
 */
export const ONTOLOGY_CHANGE_SCOPES = ["objects", "events", "tickets", "rules"] as const;
export type OntologyChangeScope = (typeof ONTOLOGY_CHANGE_SCOPES)[number];

const SCOPE_CONFIG_FILE: Record<OntologyChangeScope, string> = {
  objects: "config/objects-registry.yaml",
  events: "config/event-catalog.yaml",
  tickets: "config/ticket-types.yaml",
  rules: "config/stage-transitions.json",
};

const SCOPE_LABEL: Record<OntologyChangeScope, string> = {
  objects: "对象注册表",
  events: "事件目录",
  tickets: "票型目录",
  rules: "规则配置",
};

function digestContent(content: Buffer | string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
function gitCommit(ref: string): string | null {
  try {
    if (!ref || ref.startsWith("-"))
      return null;
    return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  }
  catch {
    return null;
  }
}

function configAtCommit(commit: string, relativePath: string): Buffer | null {
  try {
    return execFileSync("git", ["show", `${commit}:${relativePath}`], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
    });
  }
  catch {
    return null;
  }
}
function registryVersion(content: Buffer, scope: OntologyChangeScope): number {
  try {
    const value = JSON.parse(content.toString("utf8").replace(/^\uFEFF/, "")) as {
      version?: unknown;
    };
    const version = Number(value.version);
    if (Number.isInteger(version) && version >= 0)
      return version;
  }
  catch {
    // The registry validators report schema details separately. A release or an
    // approval request must nevertheless fail closed instead of inventing v0.
  }
  throw new HttpFail(503, {
    code: "ontology_registry_version_unreadable",
    message: `无法读取「${SCOPE_LABEL[scope]}」的真实 registry version；未创建审批、未放行变更。`,
  });
}

export type OntologyRegistryBaseline = {
  scope: OntologyChangeScope;
  config_path: string;
  registry_version: number;
  content_digest: string;
  git_commit: string | null;
  base_version: string;
};

function fingerprintRegistry(scope: OntologyChangeScope, content: Buffer, commit: string | null): OntologyRegistryBaseline {
  const contentDigest = digestContent(content);
  const version = registryVersion(content, scope);
  return {
    scope,
    config_path: SCOPE_CONFIG_FILE[scope],
    registry_version: version,
    content_digest: contentDigest,
    git_commit: commit,
    // The content hash remains part of a Git baseline. It makes an identical
    // version field insufficient to reuse approval for a different payload.
    base_version: `${scope}:v${version}@${commit ? `git:${commit}` : contentDigest}`,
  };
}

/**
 * Actual running registry baseline: version plus the exact committed file when
 * possible, otherwise the actual file-content hash. It deliberately does not
 * accept a caller-supplied base string.
 */
export function ontologyRegistryBaseline(scope: OntologyChangeScope): OntologyRegistryBaseline {
  const relativePath = SCOPE_CONFIG_FILE[scope];
  let content: Buffer;
  try {
    content = fs.readFileSync(path.join(repoRoot, relativePath));
  }
  catch {
    throw new HttpFail(503, {
      code: "ontology_registry_unreadable",
      message: `无法读取「${SCOPE_LABEL[scope]}」注册表；未创建审批、未放行变更。`,
    });
  }
  const head = gitCommit("HEAD");
  const committed = head ? configAtCommit(head, relativePath) : null;
  return fingerprintRegistry(scope, content, committed && digestContent(committed) === digestContent(content) ? head : null);
}

/** Compatibility helper for callers which only need the serialized baseline. */
export function ontologyBaseVersion(scope: OntologyChangeScope): string {
  return ontologyRegistryBaseline(scope).base_version;
}

export type OntologyChangeApprovalSummary = {
  approval_id: string;
  status: string;
  scope: OntologyChangeScope;
  base_version: string;
  target_digest: string;
  change_ref: string;
} | null;

type OntologyApprovalPayload = {
  scope?: unknown;
  base_version?: unknown;
  target_digest?: unknown;
  change_ref?: unknown;
};
type OntologyApprovalRow = {
  id: string;
  status: string;
  payload: unknown;
};
function approvalPayload(value: unknown): OntologyApprovalPayload {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as OntologyApprovalPayload;
  try {
    return JSON.parse(String(value || "{}")) as OntologyApprovalPayload;
  }
  catch {
    return {};
  }
}
/** PostgreSQL is the approval authority. Invalid payloads never become permits. */
export async function ontologyChangeApprovals(scope: OntologyChangeScope): Promise<Exclude<OntologyChangeApprovalSummary, null>[]> {
  const rows = await postgresPool().query<OntologyApprovalRow>("SELECT id, status, payload FROM approvals WHERE kind = $1 ORDER BY created_at DESC", ["ontology_change"]);
  const approvals: Exclude<OntologyChangeApprovalSummary, null>[] = [];
  for (const row of rows.rows) {
    const payload = approvalPayload(row.payload);
    if (payload.scope === scope) {
      approvals.push({
        approval_id: String(row.id),
        status: String(row.status),
        scope,
        base_version: String(payload.base_version || ""),
        target_digest: String(payload.target_digest || ""),
        change_ref: String(payload.change_ref || ""),
      });
    }
  }
  return approvals;
}

/** 某范围最新一条本体变更审批（kind=ontology_change，CEO 终审链）。 */
export async function latestOntologyChangeApproval(scope: OntologyChangeScope): Promise<OntologyChangeApprovalSummary> {
  return (await ontologyChangeApprovals(scope))[0] || null;
}

/**
 * 本体变更门禁（给本体管理页用）：
 * 必须持有该范围「已通过」的本体变更审批（终态 consumed），且审批的 base_version
 * 必须等于提交审批时的基线（一次审批只放行一次变更，应用后即失效）。
 */
export async function assertOntologyChangeAllowed(scope: OntologyChangeScope, baseVersion: string, targetDigest: string): Promise<void> {
  const approval = (await ontologyChangeApprovals(scope)).find((candidate) => candidate.status === "consumed" && candidate.base_version === baseVersion && candidate.target_digest === targetDigest);
  if (approval)
    return;
  throw new HttpFail(403, {
    code: "ontology_change_approval_required",
    message: `「${SCOPE_LABEL[scope]}」变更必须有同范围、同真实基线、同目标内容摘要且已通过的本体变更审批（CEO 终审）。`,
  });
}
function parseScope(value: unknown): OntologyChangeScope {
  const scope = String(value || "").trim();
  if ((ONTOLOGY_CHANGE_SCOPES as readonly string[]).includes(scope))
    return scope as OntologyChangeScope;
  throw new HttpFail(400, {
    code: "ontology_scope_invalid",
    message: `scope 必须为 ${ONTOLOGY_CHANGE_SCOPES.join(" / ")} 之一。`,
  });
}
function parseDigest(value: unknown): string {
  const digest = String(value || "").trim().toLowerCase();
  if (/^sha256:[a-f0-9]{64}$/.test(digest))
    return digest;
  throw new HttpFail(400, {
    code: "ontology_target_digest_invalid",
    message: "target_digest 必须是 sha256:<64位十六进制摘要>。",
  });
}

function targetBinding(scope: OntologyChangeScope, requestedRef: unknown, requestedDigest: unknown): {
  changeRef: string;
  targetDigest: string;
} {
  const changeRef = String(requestedRef || "").trim();
  const suppliedDigest = String(requestedDigest || "").trim() ? parseDigest(requestedDigest) : "";
  if (!changeRef && !suppliedDigest) {
    throw new HttpFail(400, {
      code: "ontology_change_target_required",
      message: "必须提供可解析的 change_ref，或显式提供 target_digest；范围审批不能作为空白变更的通行证。",
    });
  }
  if (!changeRef)
    return { changeRef: "", targetDigest: suppliedDigest };
  const commit = gitCommit(changeRef);
  const content = commit ? configAtCommit(commit, SCOPE_CONFIG_FILE[scope]) : null;
  if (!commit || !content) {
    throw new HttpFail(400, {
      code: "ontology_change_ref_unavailable",
      message: "change_ref 必须解析为本仓库中可读取该 registry 文件的 Git commit。",
    });
  }
  const targetDigest = digestContent(content);
  if (suppliedDigest && suppliedDigest !== targetDigest) {
    throw new HttpFail(400, {
      code: "ontology_target_digest_mismatch",
      message: "target_digest 与 change_ref 指向的 registry 内容不一致。",
    });
  }
  return { changeRef: commit, targetDigest };
}

/**
 * 发起本体变更审批：复用统一审批引擎，kind=ontology_change，CEO 终审单节点。
 * 一次审批只放行一次变更（base_version 绑定提交时的注册表基线）。
 * 文件级变更本身走 Git；审批是治理凭证，不直接写文件。
 */
ontology.post("/admin/ontology/change-approvals", async (c) => {
  const admin = (await requireAdmin());
  const body = (await c.req.json().catch(() => ({}))) as {
    scope?: string;
    title?: string;
    summary?: string;
    change_ref?: string;
    target_digest?: string;
  };
  const scope = parseScope(body.scope);
  const summary = String(body.summary || "").trim();
  if (!summary) {
    throw new HttpFail(400, { code: "ontology_change_summary_required", message: "请填写本次本体变更的说明（改了什么、为什么）。" });
  }
  const base = ontologyRegistryBaseline(scope);
  const target = targetBinding(scope, body.change_ref, body.target_digest);
  const approvals = await ontologyChangeApprovals(scope);
  const pending = approvals.find((approval) => approval.status === "pending");
  if (pending) {
    if (pending.base_version === base.base_version && pending.target_digest === target.targetDigest) {
      return c.json({ scope, approval_id: pending.approval_id, status: "pending", reused: true, base_version: base.base_version, target_digest: target.targetDigest });
    }
    throw new HttpFail(409, {
      code: "ontology_change_approval_pending",
      message: `「${SCOPE_LABEL[scope]}」已有绑定另一基线或目标内容的待审批单；请先完成、驳回或撤回该单，不能复用范围审批。`,
    });
  }
  const org = defaultOrgSnapshot();
  const placeholder = {
    id: admin.id,
    name: admin.name || admin.handle,
    department_id: "",
    position: "",
    manager_id: null,
    status: "active",
    cost_center: "",
    mailboxes: [],
    delegate_to: null,
  } as Employee;
  const ceo = roleHolder(org, "gm", placeholder);
  if (!ceo)
    throw new HttpFail(400, { code: "ceo_not_found", message: "组织架构中未找到 CEO，无法发起本体变更审批。" });
  const title = String(body.title || "").trim() || `本体变更审批：${SCOPE_LABEL[scope]}`;
  const approval = (await createWorkApproval({
    kind: "ontology_change",
    title,
    chain: [ceo.id],
    payload: {
      scope,
      scope_label: SCOPE_LABEL[scope],
      summary,
      change_ref: target.changeRef,
      target_digest: target.targetDigest,
      base_version: base.base_version,
      requester_name: admin.name || admin.handle,
      steps: [{ employee_id: ceo.id, name: ceo.name, role: "CEO" }],
    },
  }));
  if (!approval?.id) {
    throw new HttpFail(400, { code: "empty_approval_chain", message: "审批链为空，无法发起本体变更审批。" });
  }
  (await audit("host", "ontology.change.approval.created", {
    scope, approval_id: approval.id, base_version: base.base_version, target_digest: target.targetDigest, change_ref: target.changeRef,
  }));
  return c.json({
    scope, approval_id: approval.id, status: "pending", base_version: base.base_version,
    target_digest: target.targetDigest, change_ref: target.changeRef, chain: [ceo.id],
  }, 201);
});
/** 查询某范围最新一条本体变更审批（给本体管理页门禁展示用）。 */
ontology.get("/admin/ontology/change-approvals/latest", async (c) => {
  (await requireAdmin());
  const scope = parseScope(c.req.query("scope"));
  return (async () => {
    const latest = await latestOntologyChangeApproval(scope);
    return c.json({ scope, scope_label: SCOPE_LABEL[scope], base_version: ontologyBaseVersion(scope), latest });
  })();
});
/** 管理端只读浏览：数据来自运行中的四份 registry，不提供任何绕过审批的写入口。 */
ontology.get("/admin/ontology/registries", async (c) => {
  (await requireAdmin());
  const registries = ONTOLOGY_CHANGE_SCOPES.map((scope) => {
    const baseline = ontologyRegistryBaseline(scope);
    const raw = fs.readFileSync(path.join(repoRoot, SCOPE_CONFIG_FILE[scope]), "utf8").replace(/^\uFEFF/, "");
    try {
      return { scope, scope_label: SCOPE_LABEL[scope], base_version: baseline.base_version, data: JSON.parse(raw) as unknown };
    }
    catch {
      throw new HttpFail(503, {
        code: "ontology_registry_unreadable",
        message: `无法解析「${SCOPE_LABEL[scope]}」注册表；只读浏览未返回伪造数据。`,
      });
    }
  });
  return c.json({ registries });
});
