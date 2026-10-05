import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ReviewDefinition, ReviewInstance } from "../../shared/review.js";
import { reviewSchema } from "../src/approval/review-schema.js";
import {
  closePostgresPool,
  postgresPool,
  postgresTransaction,
} from "../src/postgres/pool.js";
import { postgresReviewContext } from "../src/approval/review-postgres-access.js";
import { reviewResolver } from "../src/approval/review-resolver.js";
import { decideReview } from "../src/approval/review-engine.js";
import {
  checkPublication,
  preparePublication,
  submitPublication,
  executePublication,
  publicationOptions,
  preparePublicationRecovery,
  recoverPublication,
} from "../src/knowledge-publication/service.js";
import { executionHandler } from "../src/execution-jobs/handlers.js";
import "../src/knowledge-publication/worker.js";
import { Hono } from "hono";
import { withScopedUser, type AppUser } from "../src/auth.js";
import { knowledgePublication } from "../src/routers/knowledge-publication.js";
import { HttpFail } from "../src/host/errors.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL);
describe.skipIf(!configured)(
  "Knowledge publication: native PostgreSQL approval events and material gate",
  () => {
    let maintenance: Pool, files: string, docId: string, source: string;
    const database = `knowledge_test_${randomUUID().replaceAll("-", "")}`;
    const oldUrl = process.env.DATABASE_URL;
    const stamp = "2026-10-05T01:00:00.000Z";
    const definition: ReviewDefinition = {
      schema: "review.definition.v1",
      name: "知识发布审批",
      description: "独立知识发布",
      fields: [],
      nodes: [
        { id: "start", name: "开始", type: "start", next: "review" },
        {
          id: "review",
          name: "审批",
          type: "review",
          mode: "single",
          assignee: { kind: "named", userIds: ["reviewer"] },
          next: "end",
          reject: "any_reject",
        },
        { id: "end", name: "结束", type: "end" },
      ],
    };
    const command = () => ({
      templateId: "knowledge-release",
      templateVersion: 1,
      values: {},
      releaseNote: "更新规格与适用范围",
    });
    beforeAll(async () => {
      maintenance = new Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
      });
      await maintenance.query(`CREATE DATABASE "${database}"`);
      const url = new URL(process.env.TEST_POSTGRES_URL!);
      url.pathname = `/${database}`;
      process.env.DATABASE_URL = url.toString();
      files = await fs.mkdtemp(
        path.join(os.tmpdir(), "knowledge-publication-test-"),
      );
      let baseline = await fs.readFile(
        new URL("../migrations/pg-baseline.sql", import.meta.url),
        "utf8",
      );
      baseline = baseline
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("\\"))
        .map((line) =>
          line.includes("set_config('search_path'")
            ? "SELECT pg_catalog.set_config('search_path', 'public', false);"
            : line,
        )
        .join("\n");
      await postgresPool().query(baseline);
      for (const statement of reviewSchema)
        await postgresPool().query(statement);
      await postgresPool().query(
        "ALTER TABLE approval_role_bindings ADD COLUMN valid_from TEXT, ADD COLUMN valid_to TEXT",
      );
      await postgresPool().query(
        await fs.readFile(
          new URL(
            "../migrations/024_knowledge_publication.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      for (const id of ["admin", "reviewer", "reviewer-two", "outsider"]) {
        await postgresPool().query(
          "INSERT INTO users(id,username,name,password_hash,roles,created_at,updated_at) VALUES($1,$1,$1,'unusable',$2,$3,$3)",
          [
            id,
            JSON.stringify(id === "admin" ? ["admin"] : ["employee"]),
            stamp,
          ],
        );
        await postgresPool().query(
          "INSERT INTO organization_people(person_ref,user_id,display_name,created_at,updated_at) VALUES($1,$2,$2,$3,$3)",
          [`person-${id}`, id, stamp],
        );
      }
      for (const tenant of ["company", "other"])
        await postgresPool().query(
          "INSERT INTO organization_units(id,company_id,display_name,type,level,created_at,updated_at) VALUES($1,$1,$1,'company',1,$2,$2)",
          [tenant, stamp],
        );
      for (const id of ["admin", "reviewer", "reviewer-two", "outsider"])
        await postgresPool().query(
          "INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,created_at,updated_at) VALUES($1,$2,$3,$3,$4,$4)",
          [
            `membership-${id}`,
            `person-${id}`,
            id === "outsider" ? "other" : "company",
            stamp,
          ],
        );
      await postgresPool().query(
        "INSERT INTO review_templates(tenant,id,version,published_version,definition,updated_at) VALUES('company','knowledge-release',1,1,$1,$2)",
        [JSON.stringify(definition), stamp],
      );
      await postgresPool().query(
        "INSERT INTO review_versions(tenant,template_id,version,definition,published_by,published_at) VALUES('company','knowledge-release',1,$1,'admin',$2)",
        [JSON.stringify(definition), stamp],
      );
    }, 60000);
    afterAll(async () => {
      await closePostgresPool();
      process.env.DATABASE_URL = oldUrl;
      if (maintenance) {
        await maintenance.query(
          `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
        );
        await maintenance.end();
      }
      if (files) {
        const target=path.resolve(files);
        if(!target.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(target).startsWith("knowledge-publication-test-")) throw new Error("Test cleanup target escaped its temporary scope");
        await fs.rm(target, { recursive: true, force: true });
      }
    });
    beforeEach(async () => {
      docId = randomUUID();
      source = path.join(files, `${docId}.pdf`);
      await fs.writeFile(source, "%PDF-1.7 isolated original");
      await postgresPool().query(
        "UPDATE users SET active=1 WHERE id IN ('admin','reviewer')",
      );
      await postgresPool().query(
        "UPDATE organization_memberships SET status='active' WHERE id IN ('membership-admin','membership-reviewer')",
      );
      await postgresPool().query(
        "UPDATE review_templates SET published_version=1 WHERE id='knowledge-release'",
      );
      await postgresPool().query(
        "UPDATE review_versions SET definition=$1 WHERE tenant='company' AND template_id='knowledge-release' AND version=1",
        [JSON.stringify(definition)],
      );
      await postgresPool().query(
        "INSERT INTO knowledge_documents(id,base_id,title,filename,media_type,source_path,status,artifacts,created_by,created_at,updated_at) VALUES($1,'specs','储能规格书','spec.pdf','pdf',$2,'pending_review','{}','admin',$3,$3)",
        [docId, source, stamp],
      );
      await postgresPool().query(
        "INSERT INTO knowledge_document_jobs(id,document_id,kind,status,created_at,finished_at) VALUES($1,$2,'index','done',$3,$3)",
        [randomUUID(), docId, stamp],
      );
    });
    async function submit() {
      const prepared = await preparePublication(
        "admin",
        "company",
        docId,
        command(),
      );
      const key = randomUUID();
      const receipt = await submitPublication(
        "admin",
        "company",
        docId,
        command(),
        prepared.confirmationId,
        key,
      );
      return { prepared, key, receipt };
    }
    // Same pure engine and persisted shape used by the existing generic review API.
    async function decision(instanceId: string, action: "approve" | "reject") {
      await postgresTransaction(async (db) => {
        const row = (
          await db.query(
            "SELECT payload FROM review_instances WHERE tenant='company' AND id=$1 FOR UPDATE",
            [instanceId],
          )
        ).rows[0];
        const instance: ReviewInstance = JSON.parse(row.payload);
        const ctx = await postgresReviewContext(db, "reviewer", "company");
        decideReview(
          instance,
          "reviewer",
          action,
          action === "reject" ? "材料不合格" : "",
          reviewResolver(ctx),
          new Date().toISOString(),
        );
        instance.version++;
        instance.updatedAt = new Date().toISOString();
        await db.query(
          "UPDATE review_instances SET status=$2,payload=$3,version=$4,updated_at=$5 WHERE tenant='company' AND id=$1",
          [
            instanceId,
            instance.status,
            JSON.stringify(instance),
            instance.version,
            instance.updatedAt,
          ],
        );
      });
    }
    it("confirmed submit is idempotent; approval commits durable outbox; worker publishes once", async () => {
      const { prepared, key, receipt } = await submit();
      expect(
        await submitPublication(
          "admin",
          "company",
          docId,
          command(),
          prepared.confirmationId,
          key,
        ),
      ).toEqual(receipt);
      await expect(
        submitPublication(
          "admin",
          "company",
          docId,
          { ...command(), releaseNote: "changed" },
          prepared.confirmationId,
          key,
        ),
      ).rejects.toThrow("请求已变化");
      expect(
        (
          await postgresPool().query(
            "SELECT status FROM knowledge_documents WHERE id=$1",
            [docId],
          )
        ).rows[0].status,
      ).toBe("pending_review");
      expect(
        (
          await postgresPool().query(
            "SELECT user_id FROM review_participants WHERE tenant='company' AND instance_id=$1 ORDER BY user_id",
            [receipt.instanceId],
          )
        ).rows.map((r) => r.user_id),
      ).toEqual(["admin", "reviewer"]);
      await decision(receipt.instanceId, "approve");
      const job = (
        await postgresPool().query(
          "SELECT * FROM execution_jobs WHERE object_ref_json::jsonb->>'instanceId'=$1 AND job_type='knowledge.publication'",
          [receipt.instanceId],
        )
      ).rows[0];
      expect(job.status).toBe("queued");
      expect(
        (
          await postgresPool().query(
            "SELECT status FROM execution_outbox WHERE job_id=$1",
            [job.id],
          )
        ).rows[0].status,
      ).toBe("pending");
      const handler = executionHandler("knowledge.publication")!;
      const publication = await handler(
        {
          ...job,
          worker_id: "test",
          lease_until: new Date(Date.now() + 60000).toISOString(),
        },
        async () => {},
      );
      expect(publication.status).toBe("published");
      expect(await executePublication("company", receipt.instanceId)).toEqual(
        publication,
      );
      expect(
        (
          await postgresPool().query(
            "SELECT status,published_by FROM knowledge_documents WHERE id=$1",
            [docId],
          )
        ).rows[0],
      ).toMatchObject({ status: "published", published_by: "admin" });
      expect(
        (
          await postgresPool().query(
            "SELECT COUNT(*)::int AS n FROM review_events WHERE resource_id=$1 AND action='knowledge.published'",
            [receipt.instanceId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("sequential flows notify only the current reviewer", async () => {
      const sequential = structuredClone(definition);
      sequential.nodes[1].mode = "sequential";
      sequential.nodes[1].assignee = {
        kind: "named",
        userIds: ["reviewer", "reviewer-two"],
      };
      await postgresPool().query(
        "UPDATE review_versions SET definition=$1 WHERE tenant='company' AND template_id='knowledge-release'",
        [JSON.stringify(sequential)],
      );
      const { receipt } = await submit();
      const tasks: ReviewInstance = JSON.parse(
        (
          await postgresPool().query(
            "SELECT payload FROM review_instances WHERE id=$1",
            [receipt.instanceId],
          )
        ).rows[0].payload,
      );
      expect(tasks.tasks.map((t) => t.status)).toEqual(["pending", "waiting"]);
      expect(
        (
          await postgresPool().query(
            "SELECT user_id FROM review_notifications WHERE instance_id=$1",
            [receipt.instanceId],
          )
        ).rows.map((r) => r.user_id),
      ).toEqual(["reviewer"]);
    });
    it("reject keeps the document unpublished and records terminal receipt", async () => {
      const { receipt } = await submit();
      await decision(receipt.instanceId, "reject");
      expect(
        (await executePublication("company", receipt.instanceId)).status,
      ).toBe("rejected");
      expect(
        (
          await postgresPool().query(
            "SELECT status FROM knowledge_documents WHERE id=$1",
            [docId],
          )
        ).rows[0].status,
      ).toBe("pending_review");
    });
    it("changed material after approval cannot publish a newer version", async () => {
      const { receipt } = await submit();
      await decision(receipt.instanceId, "approve");
      await fs.writeFile(source, "%PDF-1.7 new unapproved original");
      expect(
        (await executePublication("company", receipt.instanceId)).status,
      ).toBe("failed");
      const projection = await publicationOptions("admin", "company", docId);
      expect(projection.publication?.error).toContain("材料版本已变化");
      expect(
        (
          await postgresPool().query(
            "SELECT status FROM knowledge_documents WHERE id=$1",
            [docId],
          )
        ).rows[0].status,
      ).toBe("pending_review");
    });
    it("revoked publisher authority blocks automatic publishing", async () => {
      const { receipt } = await submit();
      await decision(receipt.instanceId, "approve");
      await postgresPool().query("UPDATE users SET active=0 WHERE id='admin'");
      expect(
        (await executePublication("company", receipt.instanceId)).status,
      ).toBe("failed");
    });
    it("reviewer conflict, departed reviewer, cross-company source and stale confirmation fail closed", async () => {
      const conflict = structuredClone(definition);
      conflict.nodes[1].assignee = { kind: "named", userIds: ["admin"] };
      await postgresPool().query(
        "UPDATE review_versions SET definition=$1 WHERE tenant='company' AND template_id='knowledge-release'",
        [JSON.stringify(conflict)],
      );
      expect(
        (await checkPublication("admin", "company", docId, command())).reason,
      ).toContain("冲突");
      await expect(
        preparePublication("outsider", "other", docId, command()),
      ).rejects.toThrow("知识管理权限");
      await postgresPool().query(
        "UPDATE review_versions SET definition=$1 WHERE tenant='company' AND template_id='knowledge-release'",
        [JSON.stringify(definition)],
      );
      const prepared = await preparePublication(
        "admin",
        "company",
        docId,
        command(),
      );
      await postgresPool().query(
        "UPDATE organization_memberships SET status='ended' WHERE id='membership-reviewer'",
      );
      await expect(
        submitPublication(
          "admin",
          "company",
          docId,
          command(),
          prepared.confirmationId,
          randomUUID(),
        ),
      ).rejects.toThrow("合格评审人");
      expect(
        (
          await postgresPool().query(
            "SELECT COUNT(*)::int AS n FROM knowledge_publications WHERE document_id=$1",
            [docId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("concurrent confirmed submissions create only one active approval", async () => {
      const first = await preparePublication(
          "admin",
          "company",
          docId,
          command(),
        ),
        second = await preparePublication("admin", "company", docId, command());
      const results = await Promise.allSettled([
        submitPublication(
          "admin",
          "company",
          docId,
          command(),
          first.confirmationId,
          randomUUID(),
        ),
        submitPublication(
          "admin",
          "company",
          docId,
          command(),
          second.confirmationId,
          randomUUID(),
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await postgresPool().query(
            "SELECT COUNT(*)::int AS n FROM knowledge_publications WHERE document_id=$1",
            [docId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("uncertain execution requires a fresh confirmation and recovery has an idempotent receipt", async () => {
      const { receipt } = await submit();
      await decision(receipt.instanceId, "approve");
      await postgresPool().query(
        "UPDATE execution_jobs SET status='uncertain',error_summary='worker stopped' WHERE object_ref_json::jsonb->>'instanceId'=$1",
        [receipt.instanceId],
      );
      const prepared = await preparePublicationRecovery(
          "admin",
          "company",
          docId,
        ),
        key = randomUUID();
      const result = await recoverPublication(
        "admin",
        "company",
        docId,
        prepared.confirmationId,
        key,
      );
      expect(
        await recoverPublication(
          "admin",
          "company",
          docId,
          prepared.confirmationId,
          key,
        ),
      ).toEqual(result);
      expect(
        (
          await postgresPool().query(
            "SELECT COUNT(*)::int AS n FROM execution_jobs WHERE object_ref_json::jsonb->>'instanceId'=$1",
            [receipt.instanceId],
          )
        ).rows[0].n,
      ).toBe(2);
      expect(
        (await executePublication("company", receipt.instanceId)).status,
      ).toBe("published");
    });
    it("native HTTP routes enforce identity, organization scope and original-material integrity", async () => {
      const app = new Hono();
      app.route("/api", knowledgePublication);
      app.onError((error, c) =>
        c.json(
          { detail: error.message },
          error instanceof HttpFail ? (error.status as 401 | 403 | 409) : 500,
        ),
      );
      const request = (
        userId: string | undefined,
        url: string,
        body?: unknown,
      ) => {
        const options = body
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Review-Company": "company",
              },
              body: JSON.stringify(body),
            }
          : undefined;
        if (!userId) return app.request(url, options);
        return withScopedUser({ id: userId } as AppUser, () =>
          app.request(url, options),
        );
      };
      expect(
        (
          await request(
            undefined,
            `/api/admin/knowledge/documents/${docId}/publication`,
          )
        ).status,
      ).toBe(401);
      const { receipt } = await submit();
      const sourceUrl = `/api/approvals/v2/instances/${receipt.instanceId}/knowledge-source?company=company`;
    const authorized = await request("reviewer", sourceUrl);
      expect(authorized.status).toBe(200);
      expect(authorized.headers.get("Content-Type")).toBe("application/pdf");
      expect(await authorized.text()).toContain("isolated original");
    expect((await request("outsider", sourceUrl)).status).toBe(403);
    expect((await request("reviewer-two", sourceUrl)).status).toBe(403);
    const invalid=await withScopedUser({id:"admin"} as AppUser,()=>app.request(`/api/admin/knowledge/documents/${docId}/publication/prepare`,{method:"POST",headers:{"Content-Type":"application/json"},body:"[invalid"}));
    expect(invalid.status).toBe(400);
      await fs.writeFile(source, "%PDF changed");
      expect((await request("reviewer", sourceUrl)).status).toBe(409);
    });
  },
);
