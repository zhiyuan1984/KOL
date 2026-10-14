import { randomUUID } from "node:crypto";
import { knowledgeReviewDefinition } from "../../../shared/review.js";
import { ReviewService } from "../../src/approval/review-service.js";
import { reviewContextForActor } from "../../src/approval/review-access.js";
import { postgresDb, pgSerialTransaction } from "../../src/postgres/access.js";
import { executePublication, preparePublication, submitPublication } from "../../src/knowledge-publication/service.js";

/**
 * Test-only adapter for the production native entry-publication workflow.
 *
 * It deliberately creates real confirmation receipts for template publishing,
 * publication submission, and the reviewer decision. It never writes a
 * published version directly or relaxes the database publication trigger.
 */
export async function approveKnowledgeEntry(input: {
  knowledgeId: string;
  actor?: string;
  tenant?: string;
  reviewer?: string;
  releaseNote?: string;
}): Promise<{ instanceId: string; publishedVersion: number }> {
  const actor = input.actor || "sriphy";
  const tenant = input.tenant || "company:amperetime";
  const reviewer = input.reviewer || "pdf-reviewer";
  const adminContext = await reviewContextForActor(postgresDb(), actor, tenant);
  const definition = knowledgeReviewDefinition();
  definition.nodes.find((node) => node.type === "review")!.assignee = {
    kind: "named",
    userIds: [reviewer],
  };

  const template = await pgSerialTransaction(async (db) =>
    new ReviewService(db, adminContext).saveTemplate(undefined, undefined, definition),
  );
  await pgSerialTransaction(async (db) => {
    const service = new ReviewService(db, adminContext);
    const command = { action: "publish" as const, templateId: template.id, expectedVersion: template.version };
    const confirmation = await service.prepare(command);
    await service.execute(command, confirmation.confirmationId, randomUUID());
  });

  const command = {
    templateId: template.id,
    templateVersion: 1,
    values: {},
    releaseNote: input.releaseNote || "已核对发布内容与适用范围",
  };
  const prepared = await preparePublication(actor, tenant, `entry:${input.knowledgeId}`, command);
  const submitted = await submitPublication(actor, tenant, `entry:${input.knowledgeId}`, command, prepared.confirmationId, randomUUID());
  const reviewerContext = await reviewContextForActor(postgresDb(), reviewer, tenant);
  const review = new ReviewService(postgresDb(), reviewerContext);
  const instance = await review.instance(submitted.instanceId);
  const decision = {
    action: "approve" as const,
    instanceId: submitted.instanceId,
    expectedVersion: instance.version,
    reason: "已核对原文和适用范围",
  };
  const confirmation = await review.prepare(decision);
  await review.execute(decision, confirmation.confirmationId, randomUUID());
  await executePublication(tenant, submitted.instanceId);
  const entry = await postgresDb().one("SELECT published_version FROM knowledge WHERE id=$1", input.knowledgeId) as { published_version: number };
  return { instanceId: submitted.instanceId, publishedVersion: Number(entry.published_version) };
}
