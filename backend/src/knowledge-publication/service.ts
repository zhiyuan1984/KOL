import { entryMaterial, authorizeEntry, publishEntry } from "../knowledge/workspace.js";
import { publicationSnapshot } from "../knowledge/publication.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import type {
  ReviewDefinition,
  ReviewInstance,
} from "../../../shared/review.js";
import type {
  KnowledgePublicationCommand,
  KnowledgePublication,
} from "../../../shared/knowledge-publication.js";
import { dataDir } from "../config.js";
import { HttpFail } from "../host/errors.js";
import { postgresTransaction } from "../postgres/pool.js";
import {
  postgresReviewContext,
  postgresReviewCompanies,
} from "../approval/review-postgres-access.js";
import { reviewResolver } from "../approval/review-resolver.js";
import {
  advanceReview,
  validateDefinition,
  validateValues,
} from "../approval/review-engine.js";
import { reviewIntake } from "../approval/review-rollout.js";
import { currentTasks } from "../approval/review-operations.js";
import { pgEnqueueExecutionJob } from "../execution-jobs/postgres-store.js";

type Row = Record<string, any>;
const fail = (status: number, message: string): never => {
  throw new HttpFail(status, { message });
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Row)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export async function publicationLabels(
  actor: string,
): Promise<Map<string, string>> {
  return postgresTransaction(async (db) => {
    const companies = await postgresReviewCompanies(db, actor);
    if (!companies.length) return new Map();
    const rows = (
      await db.query(
        `SELECT DISTINCT ON (p.document_id) p.document_id,p.status,i.status AS review_status
      FROM knowledge_publication_applications p JOIN review_instances i ON i.tenant=p.tenant AND i.id=p.instance_id
      WHERE p.tenant=ANY($1::text[]) ORDER BY p.document_id,p.created_at DESC,p.instance_id DESC`,
        [companies.map((c) => c.id)],
      )
    ).rows;
    const labels: Record<string, string> = {
      reviewing: "审批中",
      approved: "审批通过 · 等待发布",
      blocked: "审批阻塞",
      awaiting_amendment: "待补充材料",
      rejected: "审批已拒绝",
      withdrawn: "已撤回",
      failed: "发布失败",
      published: "已发布",
    };
    const legacyRows=(await db.query("SELECT document_id,review_status,publication_status FROM knowledge_publications WHERE tenant=ANY($1::text[])",[companies.map(c=>c.id)])).rows;
    return new Map([
      ...legacyRows.map(r=>[r.document_id,labels[r.publication_status==='published'?'published':r.review_status] || r.review_status] as [string,string]),
      ...rows.map((r) => [
        r.document_id,
        labels[r.status === "waiting" ? r.review_status : r.status] || r.status,
      ] as [string,string]),
    ]);
  });
}
export async function documentMaterial(db: PoolClient, documentId: string): Promise<any> {
  if(documentId.startsWith("entry:")) return entryMaterial(db, documentId.slice(6));
  const doc = (
    await db.query("SELECT d.*,b.status AS base_status FROM knowledge_documents d JOIN knowledge_bases b ON b.id=d.base_id WHERE d.id=$1 FOR UPDATE OF d", [
      documentId,
    ])
  ).rows[0];
  if (!doc) fail(404, "资料不存在");
  const job = (
    await db.query(
      "SELECT id,status,kind,finished_at FROM knowledge_document_jobs WHERE document_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
      [documentId],
    )
  ).rows[0];
  if (
    doc.base_status !== "active" ||
    doc.status !== "pending_review" ||
    !job ||
    job.kind !== "index" ||
    job.status !== "done"
  )
    fail(409, "资料须完成索引且处于待审批状态");
  const bytes = await fs.readFile(
    path.isAbsolute(doc.source_path)
      ? doc.source_path
      : path.join(dataDir(), doc.source_path),
  );
  const lineage=(await db.query("SELECT root_id,version AS document_version,expected_active_id FROM knowledge_document_lineage WHERE document_id=$1",[documentId])).rows[0];
  const engine = publicationSnapshot({...doc,...lineage});
  const snapshot = {
    engine,
    documentId,
    baseId: doc.base_id,
    title: doc.title,
    filename: doc.filename,
    sourceHash: createHash("sha256").update(bytes).digest("hex"),
    artifacts: doc.artifacts,
    indexJobId: job.id,
    indexFinishedAt: job.finished_at,
    updatedAt: doc.updated_at,
  };
  return { doc, bytes, snapshot, fingerprint: hash(snapshot) };
}
export async function adminDocument(
  db: PoolClient,
  actor: string,
  tenant: string | undefined,
  id: string,
) {
  if(id.startsWith("entry:")) return authorizeEntry(db, actor, tenant, id.slice(6));
  const ctx = await postgresReviewContext(db, actor, tenant);
  if (!ctx.admin) fail(403, "需要知识管理权限");
  const doc = (
    await db.query("SELECT created_by FROM knowledge_documents WHERE id=$1", [
      id,
    ])
  ).rows[0];
  const ownerIds=ctx.people.map(p=>p.id);
  const authorizedOwners=(await db.query("SELECT id,username FROM users WHERE id=ANY($1::text[])",[ownerIds])).rows.flatMap(r=>[r.id,r.username]);
  if (!doc || !authorizedOwners.includes(doc.created_by))
    fail(403, "资料来源缺少当前组织授权依据");
  const legacy=(await db.query("SELECT b.tenant FROM knowledge_documents d JOIN knowledge_publication_bindings b ON b.base_id=d.base_id WHERE d.id=$1",[id])).rows[0];
  if(legacy && legacy.tenant!==ctx.tenant) fail(403,"资料已绑定其他组织的知识库范围");
  const scope=(await db.query("SELECT tenant FROM knowledge_publication_applications WHERE asset_key=$1 ORDER BY created_at,instance_id LIMIT 1",[id])).rows[0];
  if(scope&&scope.tenant!==ctx.tenant) fail(403,"资料已绑定其他组织的发布审批范围");
  return ctx;
}
export async function publicationProjection(
  db: PoolClient,
  tenant: string,
  instanceId: string,
): Promise<KnowledgePublication | null> {
  const row = (
    await db.query(
      `SELECT p.*,i.status AS review_status,i.payload FROM knowledge_publication_applications p
    JOIN review_instances i ON i.tenant=p.tenant AND i.id=p.instance_id WHERE p.tenant=$1 AND p.instance_id=$2`,
      [tenant, instanceId],
    )
  ).rows[0];
  if (!row) return null;
  const snapshot = JSON.parse(row.snapshot);
  const job = (
    await db.query(
      "SELECT id,status,error_summary FROM execution_jobs WHERE tenant_ref=$1 AND job_type='knowledge.publication' AND object_ref_json::jsonb->>'instanceId'=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [tenant, instanceId],
    )
  ).rows[0];
  return {
    tenant,
    instanceId,
    documentId: row.document_id || row.asset_key,
    assetType: row.entry_id ? "entry" : "document",
    assetId: row.entry_id || row.document_id,
    content: row.entry_id ? snapshot.content : undefined,
    version: snapshot.version || snapshot.engine?.document_version,
    releaseMode: row.release_mode,
    canPublish: row.status === "waiting" && row.review_status === "approved" && row.release_mode === "manual" && !row.publication_requested,
    title: snapshot.title,
    filename: snapshot.filename,
    fingerprint: row.fingerprint,
    releaseNote: row.release_note,
    status: row.status,
    reviewStatus: row.review_status,
    blockedReason: JSON.parse(row.payload).blockedReason,
    error: row.error || undefined,
    receipt: row.receipt ? JSON.parse(row.receipt) : undefined,
    job: job
      ? {
          id: job.id,
          status: job.status,
          error: job.error_summary || undefined,
        }
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function publicationOptions(
  actor: string,
  tenant: string | undefined,
  id: string,
) {
  return postgresTransaction(async (db) => {
    const ctx = await postgresReviewContext(db, actor, tenant);
    if (!ctx.admin) fail(403, "需要知识管理权限");
    await adminDocument(db, actor, ctx.tenant, id);
    const legacy=(await db.query("SELECT d.updated_at FROM knowledge_publications p JOIN knowledge_documents d ON d.id=p.document_id WHERE p.document_id=$1 AND p.tenant=$2",[id,ctx.tenant])).rows[0];
    if(legacy && !id.startsWith("entry:")) return {tenant:ctx.tenant,legacy:{updatedAt:legacy.updated_at},templates:[],publication:null,intake:reviewIntake(ctx.tenant)};
    const templates = (
      await db.query(
        `SELECT t.id,v.version,v.definition FROM review_templates t
      JOIN review_versions v ON v.tenant=t.tenant AND v.template_id=t.id AND v.version=t.published_version
      LEFT JOIN review_template_lifecycle l ON l.tenant=t.tenant AND l.template_id=t.id
      WHERE t.tenant=$1 AND COALESCE(l.enabled,1)=1 ORDER BY t.updated_at DESC,t.id`,
        [ctx.tenant],
      )
    ).rows
      .map((t) => ({
        id: t.id,
        version: t.version,
        definition: JSON.parse(t.definition) as ReviewDefinition,
      }))
      .filter((t) => t.definition.subjectType === "knowledge_publication" && t.definition.nodes.some((n) => n.type === "review"));
    const latest = (
      await db.query(
        "SELECT instance_id FROM knowledge_publication_applications WHERE tenant=$1 AND asset_key=$2 AND (entry_id IS NULL OR (snapshot::jsonb->>'version')::integer=(SELECT current_version FROM knowledge WHERE id=entry_id)) ORDER BY created_at DESC,instance_id DESC LIMIT 1",
        [ctx.tenant, id],
      )
    ).rows[0];
    const asset=id.startsWith("entry:")
      ? (await db.query("SELECT status,current_version,published_version FROM knowledge WHERE id=$1",[id.slice(6)])).rows[0]
      : (await db.query("SELECT status FROM knowledge_documents WHERE id=$1",[id])).rows[0];
    const allowed=id.startsWith("entry:") ? asset.status!=="archived" && Number(asset.current_version)!==Number(asset.published_version) : asset.status==="pending_review";
    return {
      tenant: ctx.tenant,
      templates,
      submission:{allowed,reason:allowed?"":asset.status==="published"?"请先创建新版本草稿":asset.status==="archived"?"当前知识已停用":"请先保存原件并完成内容加工"},
      publication: latest
        ? await publicationProjection(db, ctx.tenant, latest.instance_id)
        : null,
      intake: reviewIntake(ctx.tenant),
    };
  });
}
async function prepareMaterial(
  db: PoolClient,
  actor: string,
  tenant: string | undefined,
  id: string,
  command: KnowledgePublicationCommand,
) {
  const ctx = await adminDocument(db, actor, tenant, id);
  const intake = reviewIntake(ctx.tenant);
  if (!intake.allowed) fail(409, intake.reason);
  if (
    !command ||
    typeof command.releaseNote !== "string" ||
    command.releaseNote.length > 2000
  )
    fail(422, "发布说明最多 2000 字");
  if (
    typeof command.templateId !== "string" ||
    !command.templateId ||
    !Number.isInteger(command.templateVersion) ||
    command.templateVersion < 1
  )
    fail(422, "请选择有效审批流程版本");
  const t = (
    await db.query(
      `SELECT v.definition FROM review_templates t JOIN review_versions v ON v.tenant=t.tenant AND v.template_id=t.id AND v.version=t.published_version
    LEFT JOIN review_template_lifecycle l ON l.tenant=t.tenant AND l.template_id=t.id
    WHERE t.tenant=$1 AND t.id=$2 AND t.published_version=$3 AND COALESCE(l.enabled,1)=1 FOR SHARE OF t`,
      [ctx.tenant, command.templateId, command.templateVersion],
    )
  ).rows[0];
  if (!t) fail(409, "流程版本已更新或停用，请重新选择并确认");
  const definition: ReviewDefinition = JSON.parse(t.definition);
  if(definition.organizationUnitId !== undefined && !ctx.organization?.units.some(unit=>unit.id===definition.organizationUnitId)) fail(422,"流程归属组织已归档或不属于当前公司");
  if(definition.subjectType !== "knowledge_publication") fail(422,"请选择独立知识发布审批流程");
  const values = definition.subjectType === "knowledge_publication" ? {...command.values,knowledge_request:`native:${id}`,publication_note:command.releaseNote} : command.values;
  const issues = [
    ...validateDefinition(definition),
    ...validateValues(definition, values),
  ];
  if (issues.length)
    throw new HttpFail(422, { message: "请修正审批表单", issues });
  const material = await documentMaterial(db, id);
  if (
    (
      await db.query(
        "SELECT instance_id FROM knowledge_publication_applications WHERE asset_key=$1 AND status='waiting'",
        [id],
      )
    ).rowCount
  )
    fail(409, "该资料已有审批申请，请查看现有流程");
  if((await db.query("SELECT 1 FROM knowledge_publications WHERE document_id=$1 AND review_status IN ('reviewing','blocked','awaiting_amendment','approved')",[id])).rowCount) fail(409,"该资料已有审批申请，请查看原流程");
  const now = new Date().toISOString();
  const instance: ReviewInstance = {
    id: randomUUID(),
    templateId: command.templateId,
    templateVersion: command.templateVersion,
    version: 1,
    round: 1,
    requester: actor,
    title: `知识发布：${material.doc.title}`.slice(0, 200),
    definition,
    values,
    currentNode: "",
    status: "reviewing",
    tasks: [],
    createdAt: now,
    updatedAt: now,
  };
  advanceReview(
    instance,
    definition.nodes.find((n) => n.type === "start")!.id,
    reviewResolver(ctx),
    now,
  );
  if (instance.status === "blocked") fail(422, instance.blockedReason!);
  if (
    instance.status !== "reviewing" ||
    !instance.tasks.some((t) => t.status === "pending")
  )
    fail(422, "知识发布必须经过独立评审人审批，当前条件路径未包含评审");
  // Attachment references must be owned by this actor in this organization.
  const attachments: string[] = [];
  for (const field of definition.fields.filter(
    (f) => f.type === "attachment",
  )) {
    const ids = command.values[field.id];
    if (Array.isArray(ids))
      for (const attachmentId of ids) {
        const a = (
          await db.query(
            "SELECT id FROM review_attachments WHERE tenant=$1 AND actor=$2 AND id=$3",
            [ctx.tenant, actor, attachmentId],
          )
        ).rows[0];
        if (!a) fail(422, "审批附件不存在或不属于当前组织与发起人");
        attachments.push(String(attachmentId));
      }
  }
  return {
    ctx,
    material,
    instance,
    attachments,
    digest: hash({
      tenant: ctx.tenant,
      actor,
      id,
      command,
      fingerprint: material.fingerprint,
      definition,
      reviewers: instance.tasks.map((t) => t.userId),
    }),
  };
}
export async function preparePublication(
  actor: string,
  tenant: string | undefined,
  id: string,
  command: KnowledgePublicationCommand,
) {
  return postgresTransaction(async (db) => {
    const p = await prepareMaterial(db, actor, tenant, id, command);
    const confirmationId = randomUUID(),
      expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    await db.query(
      "INSERT INTO knowledge_publication_confirmations(id,tenant,actor,document_id,digest,expires_at,request_digest) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        confirmationId,
        p.ctx.tenant,
        actor,
        id,
        p.digest,
        expiresAt,
        hash(command),
      ],
    );
    return {
      confirmationId,
      expiresAt,
      summary: {
        name: p.material.doc.title,
        flow: p.instance.definition.name,
        version: p.instance.templateVersion,
        fingerprint: p.material.fingerprint,
        reviewers: p.instance.tasks.map(
          (t) => p.ctx.people.find((u) => u.id === t.userId)?.name || t.userId,
        ),
        consequence:
          "提交后本次内容、版本及发布说明冻结。审批通过后等待发布；发布前该版本不参与员工问答。",
      },
    };
  });
}
export async function checkPublication(
  actor: string,
  tenant: string | undefined,
  id: string,
  command: KnowledgePublicationCommand,
) {
  return postgresTransaction(async (db) => {
    try {
      const p = await prepareMaterial(db, actor, tenant, id, command);
      return {
        allowed: true,
        reason: "",
        reviewers: p.instance.tasks.map(
          (t) => p.ctx.people.find((u) => u.id === t.userId)?.name || t.userId,
        ),
        fingerprint: p.material.fingerprint,
      };
    } catch (error) {
      if (!(error instanceof HttpFail) || ![409, 422].includes(error.status))
        throw error;
      return {
        allowed: false,
        reason: error.message,
        reviewers: [],
        issues: typeof error.detail === "object" ? (error.detail as Row).issues : [],
        fingerprint: "",
      };
    }
  });
}
async function recoveryMaterial(
  db: PoolClient,
  actor: string,
  tenant: string | undefined,
  id: string,
  operation: "recover" | "publish" = "recover",
) {
  const ctx = await adminDocument(db, actor, tenant, id);
  const p = (
    await db.query(
      "SELECT * FROM knowledge_publication_applications WHERE tenant=$1 AND asset_key=$2 AND status='waiting' FOR UPDATE",
      [ctx.tenant, id],
    )
  ).rows[0];
  if (!p) fail(409, "没有待恢复的发布申请");
  const review = (
    await db.query(
      "SELECT status,version FROM review_instances WHERE tenant=$1 AND id=$2",
      [ctx.tenant, p.instance_id],
    )
  ).rows[0];
  if (review?.status !== "approved") fail(409, "审批尚未通过，不能恢复发布");
  const job = (
    await db.query(
      "SELECT id,status,attempts,updated_at FROM execution_jobs WHERE tenant_ref=$1 AND job_type='knowledge.publication' AND object_ref_json::jsonb->>'instanceId'=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
      [ctx.tenant, p.instance_id],
    )
  ).rows[0];
  if (operation === "publish" ? (p.release_mode !== "manual" || p.publication_requested || Boolean(job)) : (!job || !["failed", "uncertain", "cancelled"].includes(job.status)))
    fail(409, "发布作业仍在处理，请等待服务或查看执行记录");
  const material = await documentMaterial(db, id);
  if (material.fingerprint !== p.fingerprint)
    fail(409, "审批材料已变化，须重新提交审批");
  return {
    ctx,
    p,
    job,
    review,
    digest: hash({
      action: operation,
      tenant: ctx.tenant,
      actor,
      id,
      instanceId: p.instance_id,
      jobId: job?.id,
      jobStatus: job?.status,
      jobUpdatedAt: job?.updated_at,
      jobAttempts: job?.attempts,
      fingerprint: material.fingerprint,
    }),
  };
}
export async function preparePublicationRecovery(
  actor: string,
  tenant: string | undefined,
  id: string,
  operation: "recover" | "publish" = "recover",
) {
  return postgresTransaction(async (db) => {
    const r = await recoveryMaterial(db, actor, tenant, id, operation),
      confirmationId = randomUUID(),
      expiresAt = new Date(Date.now() + 300000).toISOString();
    await db.query(
      "INSERT INTO knowledge_publication_confirmations(id,tenant,actor,document_id,digest,expires_at,operation) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [confirmationId, r.ctx.tenant, actor, id, r.digest, expiresAt, operation],
    );
    return { confirmationId, expiresAt, title: JSON.parse(r.p.snapshot).title };
  });
}
export async function recoverPublication(
  actor: string,
  tenant: string | undefined,
  id: string,
  confirmationId: string,
  key: string,
  operation: "recover" | "publish" = "recover",
) {
  if (typeof key !== "string" || key.length < 8 || key.length > 128)
    fail(422, "缺少有效幂等键");
  return postgresTransaction(async (db) => {
    const c = (
      await db.query(
        "SELECT * FROM knowledge_publication_confirmations WHERE id=$1 AND actor=$2 AND document_id=$3 FOR UPDATE",
        [confirmationId, actor, id],
      )
    ).rows[0];
    if (!c) fail(403, "缺少恢复发布确认");
    if (c.operation !== operation) fail(403, "确认不属于恢复发布操作");
    const ctx = await adminDocument(db, actor, tenant, id);
    if (c.tenant !== ctx.tenant) fail(403, "组织已变化");
    if (c.consumed) {
      if (c.idempotency_key === key) return JSON.parse(c.receipt);
      fail(409, "确认已使用");
    }
    if (c.expires_at < new Date().toISOString()) fail(409, "恢复确认已过期");
    const r = await recoveryMaterial(db, actor, tenant, id, operation);
    if (c.digest !== r.digest) fail(409, "发布作业或材料已变化，请重新确认");
    await db.query("UPDATE knowledge_publication_applications SET publication_requested=1 WHERE tenant=$1 AND instance_id=$2",[ctx.tenant,r.p.instance_id]);
    const result = await pgEnqueueExecutionJob(
      {
        job_type: "knowledge.publication",
        tenant_ref: r.ctx.tenant,
        actor_ref: r.p.actor,
        idempotency_key: `knowledge-publication-recover:${confirmationId}`,
        object_ref: { instanceId: r.p.instance_id },
        risk_level: "high",
        max_attempts: 5,
        payload: { instanceId: r.p.instance_id },
        scope_snapshot: {
          tenant: r.ctx.tenant,
          documentId: id,
          confirmedBy: actor,
        },
      },
      { client: db },
    );
    const receipt = {
      id: randomUUID(),
      status: operation === "publish" ? "publication_submitted" : "recovery_submitted",
      jobId: result.job.id,
      instanceId: r.p.instance_id,
      at: new Date().toISOString(),
    };
    await db.query(
      "UPDATE knowledge_publication_confirmations SET consumed=1,idempotency_key=$2,receipt=$3 WHERE id=$1",
      [confirmationId, key, JSON.stringify(receipt)],
    );
    await db.query(
      "INSERT INTO review_events(id,tenant,resource_id,actor,action,version,detail,created_at) VALUES($1,$2,$3,$4,'knowledge.recover',$5,$6,$7)",
      [
        receipt.id,
        ctx.tenant,
        r.p.instance_id,
        actor,
        r.review.version,
        JSON.stringify(receipt),
        receipt.at,
      ],
    );
    return receipt;
  });
}
export async function submitPublication(
  actor: string,
  tenant: string | undefined,
  id: string,
  command: KnowledgePublicationCommand,
  confirmationId: string,
  idempotencyKey: string,
) {
  if (
    typeof idempotencyKey !== "string" ||
    !idempotencyKey ||
    idempotencyKey.length > 128
  )
    fail(422, "缺少有效幂等键");
  return postgresTransaction(async (db) => {
    const c = (
      await db.query(
        "SELECT * FROM knowledge_publication_confirmations WHERE id=$1 AND actor=$2 AND document_id=$3 FOR UPDATE",
        [confirmationId, actor, id],
      )
    ).rows[0];
    if (!c) fail(403, "缺少当前资料提交确认");
    if (c.operation !== "submit" || c.request_digest !== hash(command))
      fail(409, "确认内容或幂等请求已变化，请重新确认");
    const ctx = await adminDocument(db, actor, tenant, id);
    if (c.tenant !== ctx.tenant) fail(403, "组织已变化，请重新确认");
    if (c.consumed) {
      if (c.idempotency_key === idempotencyKey) return JSON.parse(c.receipt);
      fail(409, "确认已被使用");
    }
    if (c.expires_at < new Date().toISOString())
      fail(409, "确认已过期，请重新检查");
    const p = await prepareMaterial(db, actor, tenant, id, command);
    if (c.digest !== p.digest)
      fail(409, "资料、流程或评审人已变化，请重新检查并确认");
    const i = p.instance,
      now = i.createdAt;
    await db.query("SELECT set_config('knowledge.native_publication_instance',$1,true)",[i.id]);
    await db.query(
      "INSERT INTO review_instances(tenant,id,template_id,template_version,version,requester,status,payload,updated_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)",
      [
        ctx.tenant,
        i.id,
        i.templateId,
        i.templateVersion,
        actor,
        i.status,
        JSON.stringify(i),
        now,
      ],
    );
    await db.query(
      "INSERT INTO knowledge_publication_applications(tenant,instance_id,document_id,actor,snapshot,fingerprint,release_note,created_at,updated_at,entry_id,asset_key,release_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,'manual')",
      [
        ctx.tenant,
        i.id,
        id.startsWith("entry:") ? null : id,
        actor,
        JSON.stringify(p.material.snapshot),
        p.material.fingerprint,
        command.releaseNote,
        now,
        id.startsWith("entry:") ? id.slice(6) : null,
        id,
      ],
    );
    await db.query(
      "INSERT INTO review_revisions(tenant,instance_id,round,material,actor,created_at) VALUES($1,$2,1,$3,$4,$5)",
      [ctx.tenant, i.id, JSON.stringify(i.values), actor, now],
    );
    for (const userId of new Set([actor, ...i.tasks.map((t) => t.userId)]))
      await db.query(
        "INSERT INTO review_participants(tenant,instance_id,user_id) VALUES($1,$2,$3)",
        [ctx.tenant, i.id, userId],
      );
    for (const attachmentId of new Set(p.attachments))
      await db.query(
        "INSERT INTO review_attachment_refs(tenant,instance_id,round,attachment_id) VALUES($1,$2,1,$3)",
        [ctx.tenant, i.id, attachmentId],
      );
    for (const task of i.tasks.filter(
      (t) =>
        t.duty === "cc" ||
        (t.nodeId === i.currentNode && t.status === "pending"),
    )) {
      await db.query(
        "INSERT INTO review_notifications(id,tenant,instance_id,user_id,message,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          hash({
            tenant: ctx.tenant,
            instance: i.id,
            user: task.userId,
            key: `${task.duty === "cc" ? "cc" : "task"}:${task.id}`,
          }),
          ctx.tenant,
          i.id,
          task.userId,
          task.duty === "cc"
            ? "有一项知识发布流程抄送给你（无需评审）"
            : "有一项知识发布评审等待你处理",
          now,
        ],
      );
    }
    for (const task of currentTasks(i).filter(
      (t) => t.status === "pending" && t.dueAt,
    )) {
      const node = i.definition.nodes.find((n) => n.id === task.nodeId)!;
      if (node.operations?.timeout)
        await pgEnqueueExecutionJob(
          {
            job_type: "review.timeout",
            tenant_ref: ctx.tenant,
            actor_ref: actor,
            idempotency_key: `review-timeout:${ctx.tenant}:${task.id}:${task.dueAt}`,
            object_ref: { instanceId: i.id },
            rule_id: i.templateId,
            rule_version: String(i.templateVersion),
            risk_level: "low",
            max_attempts: 3,
            next_attempt_at: task.dueAt,
            payload: { instanceId: i.id, taskId: task.id, dueAt: task.dueAt },
            scope_snapshot: { tenant: ctx.tenant, requester: actor },
          },
          { client: db },
        );
    }
    const receipt = {
      id: randomUUID(),
      instanceId: i.id,
      tenant: ctx.tenant,
      status: "submitted",
      at: now,
    };
    await db.query(
      "INSERT INTO review_events(id,tenant,resource_id,actor,action,version,detail,created_at) VALUES($1,$2,$3,$4,'knowledge.submit',1,$5,$6)",
      [
        receipt.id,
        ctx.tenant,
        i.id,
        actor,
        JSON.stringify({
          receipt,
          fingerprint: p.material.fingerprint,
          releaseNote: command.releaseNote,
        }),
        now,
      ],
    );
    await db.query(
      "UPDATE knowledge_publication_confirmations SET consumed=1,idempotency_key=$2,receipt=$3 WHERE id=$1",
      [confirmationId, idempotencyKey, JSON.stringify(receipt)],
    );
    return receipt;
  });
}

/** Row locks and material comparison protect publication against reprocessing and duplicate delivery. */
export async function executePublication(tenant: string, instanceId: string, job?: ClaimedExecutionJob) {
  return postgresTransaction(async (db) => {
    const p = (
      await db.query(
        "SELECT * FROM knowledge_publication_applications WHERE tenant=$1 AND instance_id=$2 FOR UPDATE",
        [tenant, instanceId],
      )
    ).rows[0];
    if (!p) fail(404, "发布申请不存在");
    if (p.status !== "waiting")
      return p.receipt ? JSON.parse(p.receipt) : { status: p.status };
    const review = (
      await db.query(
        "SELECT status,version FROM review_instances WHERE tenant=$1 AND id=$2 FOR SHARE",
        [tenant, instanceId],
      )
    ).rows[0];
    if (!["approved", "rejected", "withdrawn"].includes(review.status))
      return { status: "waiting", reason: "审批尚未结束" };
    if(review.status === "approved" && p.release_mode === "manual" && !p.publication_requested) return {status:"waiting",reason:"等待确认发布"};
    let status = review.status === "approved" ? "published" : review.status;
    let error: string | undefined;
    if (review.status === "approved") {
      try {
        await adminDocument(db, p.actor, tenant, p.asset_key || p.document_id);
        const material = await documentMaterial(db, p.asset_key || p.document_id);
        if (material.fingerprint !== p.fingerprint)
          fail(409, "审批材料版本已变化，须按新版本重新提交审批");
        if(job){
          const lease=(await db.query("SELECT id FROM execution_jobs WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_until>$3 FOR UPDATE",[job.id,job.worker_id,new Date().toISOString()])).rows[0];
          if(!lease) throw new Error("发布作业租约已失效");
        }
        if(p.entry_id) {
          await db.query("SELECT set_config('knowledge.native_publication_instance',$1,true)",[instanceId]);
          await publishEntry(db, p.entry_id, p.actor, material.snapshot);
        } else {
        const engine = material.snapshot.engine;
        await db.query("SELECT id FROM knowledge_documents WHERE id=$1 FOR UPDATE",[engine.root_id]);
        const active=(await db.query(`SELECT d.id FROM knowledge_documents d LEFT JOIN knowledge_document_lineage l ON l.document_id=d.id WHERE (d.id=$1 OR l.root_id=$1) AND d.status='published' FOR UPDATE OF d`,[engine.root_id])).rows;
        if((active[0]?.id || null)!==engine.expected_active_id) fail(409,"生效版本已变化，请重新申请");
        if(job){
          const lease=(await db.query("SELECT id FROM execution_jobs WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_until>$3 FOR UPDATE",[job.id,job.worker_id,new Date().toISOString()])).rows[0];
          if(!lease) throw new Error("发布作业租约已失效");
        }
        if(active.length) await db.query("UPDATE knowledge_documents SET status='archived',updated_at=$2 WHERE id=$1",[active[0].id,new Date().toISOString()]);
        await db.query("SELECT set_config('knowledge.native_publication_instance',$1,true)",[instanceId]);
        await db.query(
          "UPDATE knowledge_documents SET status='published',published_by=$2,published_at=$3,updated_at=$3 WHERE id=$1",
          [p.document_id, p.actor, new Date().toISOString()],
        );
        }
      } catch (cause) {
        // Infrastructure failures retry through the durable job; domain changes need explicit resubmission.
        if (!(cause instanceof HttpFail)) throw cause;
        status = "failed";
        error =
          typeof cause.detail === "string"
            ? cause.detail
            : (cause.detail as Row)?.message || "发布授权或资料版本已变化";
      }
    }
    const receipt = {
      id: randomUUID(),
      status,
      at: new Date().toISOString(),
      documentId: p.document_id,
      instanceId,
      fingerprint: p.fingerprint,
    };
    await db.query(
      "UPDATE knowledge_publication_applications SET status=$3,error=$4,receipt=$5,updated_at=$6 WHERE tenant=$1 AND instance_id=$2",
      [
        tenant,
        instanceId,
        status,
        error || null,
        JSON.stringify(receipt),
        receipt.at,
      ],
    );
    await db.query(
      "INSERT INTO review_events(id,tenant,resource_id,actor,action,version,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        receipt.id,
        tenant,
        instanceId,
        p.actor,
        `knowledge.${status}`,
        review.version,
        JSON.stringify({ receipt, reason: error }),
        receipt.at,
      ],
    );
    await db.query(
      "INSERT INTO review_notifications(id,tenant,instance_id,user_id,message,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        receipt.id,
        tenant,
        instanceId,
        p.actor,
        status === "published"
          ? "知识发布已完成，可查看发布回执"
          : `知识未发布：${error || status}`,
        receipt.at,
      ],
    );
    return receipt;
  });
}
