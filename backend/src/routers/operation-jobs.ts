import { Hono } from "hono";
import { scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { pgExecutionJobById, pgExecutionJobPayload, pgExecutionJobPublic, pgRetryFailedExecutionJob } from "../execution-jobs/postgres-store.js";
import { postgresPool } from "../postgres/pool.js";

/** Business packages supply current scope checks; unknown job types stay private. */
export function operationJobsRouter(scopes: Record<string, (payload: Record<string, unknown>) => unknown>): Hono {
  async function authorizedJob(id: string) {
    const actor = scopedUser();
    if (!actor?.active) throw new HttpFail(401, "authentication required");
    const job = await pgExecutionJobById(id);
    if (!job || job.actor_ref !== actor.id || !Object.hasOwn(scopes, String(job.job_type))) throw new HttpFail(404, "job not found");
    scopes[String(job.job_type)](pgExecutionJobPayload(job));
    return job;
  }

  const operationJobs = new Hono();
  operationJobs.get("/jobs/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ job: pgExecutionJobPublic(await authorizedJob(c.req.param("id"))) });
  });
  operationJobs.post("/jobs/:id/retry", async (c) => {
    const job = await authorizedJob(c.req.param("id"));
    const result = await pgRetryFailedExecutionJob(String(job.id), { actor_ref: scopedUser()!.id });
    if (!result.retried) throw new HttpFail(409, { code: result.reason });
    return c.json({ job: pgExecutionJobPublic(result.job!) }, 202);
  });
  operationJobs.post("/jobs/:id/cancel", async (c) => {
    const job = await authorizedJob(c.req.param("id"));
    // Low-risk read jobs stop cooperatively. Already-indexed facts are retained.
    await postgresPool().query(
      `UPDATE execution_jobs SET status='cancelled', terminal_at=$1,updated_at=$1,
         lease_until=NULL,lease_owner=NULL,error_code='cancelled_by_actor',
         error_summary='已取消后续同步；已读取的数据保留，正在执行的请求将在检查点停止'
       WHERE id=$2 AND actor_ref=$3 AND risk_level='low' AND status IN ('queued','retrying','running')`,
      [new Date().toISOString(), job.id, scopedUser()!.id],
    );
    return c.json({ job: pgExecutionJobPublic((await pgExecutionJobById(String(job.id)))!) });
  });
  return operationJobs;
}
