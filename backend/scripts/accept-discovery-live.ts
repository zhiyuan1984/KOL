/** Explicit bounded acceptance; only usable in the named isolated databases. */
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { getConn } from "../src/db.js";
import { mapUser, withScopedUser } from "../src/auth.js";
import { postgresPool, closePostgresPool } from "../src/postgres/pool.js";
import { createDiscoveryWorkspace } from "../src/crawl/discovery-workspace.js";
import { runtimeAction } from "../src/runtime/action-store.js";
import { runtimeActionOperations } from "../src/runtime/action-operations.js";
import { operationRouter } from "../src/runtime/operations.js";
import { processExecutionJobById } from "../src/execution-jobs/dispatcher.js";
import { runCodex } from "../src/worker/runner.js";
import { SkillExecution } from "../src/runtime/execution.js";
import type { Json, Row } from "../src/types.js";
import "../src/crawl/results.js";

const phase = process.argv.find(a => a.startsWith("--phase="))?.slice(8);
const acceptanceCase = process.argv.find(a => a.startsWith("--case="))?.slice(7);
const quality = process.argv.includes("--authorized-subscriber-acceptance");
const base = path.resolve(process.env.LINGONG_DATA || "");
const root = quality ? path.join(base, acceptanceCase || "invalid") : base;
const database = new URL(process.env.DATABASE_URL || "http://invalid").pathname;
if (!(quality
  ? database === "/tcw_p1_quality_20261004" && ["camping", "empty"].includes(acceptanceCase || "")
  : database === "/tcw_p1_acceptance_20261004" && process.argv.includes("--authorized-camping-5"))
  || !["propose", "execute", "analyze"].includes(phase || "")) {
  throw new Error("Requires isolated database, explicit phase and authorized one-task scope");
}
fs.mkdirSync(root, { recursive: true });
const actor = JSON.parse(fs.readFileSync(path.resolve(base, "../actor.json"), "utf8")).actor;
const user = mapUser(getConn().prepare("SELECT * FROM users WHERE id=? AND active=1").get(actor) as Row);
const keyword = quality && acceptanceCase === "empty" ? "tcw-empty-20261004-6f13e3" : "camping";
const limit = quality && acceptanceCase === "empty" ? 1 : 5;
const scope = { platforms: ["youtube"], crawler_type: "search", keywords: keyword, max_notes_count: limit,
  enable_comments: false, enable_sub_comments: false };
const brief = { platforms: ["youtube"], region: "na", directions: [], keywords: [keyword],
  min_followers: 100, max_followers: 2000000, min_avg_plays_10: 100, expect_count: limit };
const save = (name: string, value: unknown) => fs.writeFileSync(path.join(root, name + ".json"), JSON.stringify(value, null, 2), { mode: 0o600 });
const app = new Hono(); app.route("/", operationRouter(runtimeActionOperations));
async function confirm(id: string) {
  const action = await runtimeAction(id, actor);
  if (action.state !== "pending") throw new Error("action_not_pending_no_reconfirmation");
  const response = await withScopedUser(user, () => app.request("/actions/runtime.confirm", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action_id: id, confirmation_version: action.snapshot }),
  }));
  if (response.status !== 202) throw new Error(`confirmation_rejected_${response.status}`);
}
async function pump() {
  // Only the explicitly authorized cases live here; no production queue/Redis consumer is started.
  const jobs = (await postgresPool().query("SELECT id FROM execution_jobs WHERE status IN ('queued','retrying') AND (next_attempt_at IS NULL OR next_attempt_at::timestamptz<=now()) AND job_type IN ('runtime.confirm','crawler.monitor','crawler.results') ORDER BY created_at LIMIT 5")).rows;
  for (const row of jobs) await processExecutionJobById(row.id, "tcw-p1-acceptance");
}
try {
  if (quality && phase === "propose") {
    const existing = (await postgresPool().query("SELECT state,result_state,args_json FROM runtime_crawl_jobs")).rows;
    if (acceptanceCase === "camping" && existing.length) throw new Error("camping_acceptance_already_started");
    if (acceptanceCase === "empty" && (existing.length !== 1 || existing[0].args_json.keywords !== "camping"
      || existing[0].state !== "succeeded" || existing[0].result_state !== "ready")) {
      throw new Error("first_acceptance_must_be_complete_before_empty_case");
    }
  }
  const workspace = await withScopedUser(user, () => createDiscoveryWorkspace({ request_id: quality
    ? `tcw-20261004-subscriber-${acceptanceCase}-approved` : "tcw-20261004-camping-5-approved",
    text: `仅搜索关键词 ${keyword}，搜索视频参数${limit}，关闭评论及子评论，地区与指标仅核验，不导入、不发信。`, brief }));
  save("workspace", workspace);
  const session = String(workspace.session_id);
  const actions = () => postgresPool().query("SELECT * FROM runtime_actions WHERE session_id=$1 ORDER BY created_at", [session]);
  if (phase === "propose") {
    if ((await actions()).rowCount) throw new Error("existing_actions_do_not_repeat_proposal");
    const result = await withScopedUser(user, () => runCodex(session, "crawler_collect",
      `本次为已授权范围的真实验收。请通过挂载工具仅提出一个采集提案，精确参数 ${JSON.stringify(scope)}。不要启动其他采集，不导入不发信。程序稍后将核对参数并独立确认。`,
      { discovery_brief: brief, skip_user_memory: true }));
    save("proposal-harness", result);
    const proposed = (await actions()).rows;
    save("proposals", proposed.map(r => ({ id:r.id, tool:r.tool_name, state:r.state, args:r.args_json })));
    console.log(JSON.stringify({ phase, harness_status: result.status, actions: proposed.map(r => ({id:r.id,state:r.state,args:r.args_json})) }));
  } else if (phase === "execute") {
    const starts = (await actions()).rows.filter(r => r.tool_name === "start_crawl");
    if (starts.length !== 1) throw new Error("requires_exactly_one_start_proposal");
    const start = starts[0];
    const same = Object.keys(scope).length === Object.keys(start.args_json).length
      && Object.entries(scope).every(([k,v]) => JSON.stringify(v) === JSON.stringify(start.args_json[k]));
    if (!same) throw new Error("proposal_outside_authorized_scope");
    if ((await postgresPool().query("SELECT 1 FROM runtime_crawl_jobs WHERE id=$1", [start.id])).rowCount) throw new Error("already_started_do_not_repeat");
    await confirm(start.id);
    const deadline = Date.now() + 300000;
    let last = "";
    while (Date.now() < deadline) {
      await pump();
      const crawl = (await postgresPool().query("SELECT * FROM runtime_crawl_jobs WHERE id=$1", [start.id])).rows[0];
      const stamp = JSON.stringify({ phase:"progress",task_id:crawl?.remote_task_id,state:crawl?.state,result_state:crawl?.result_state });
      if(stamp!==last){console.log(stamp);last=stamp;}
      if(crawl){save("crawl-receipt",crawl);}
      if(crawl?.result_state === "ready" || ["failed","uncertain","cancelled"].includes(crawl?.state)) break;
      if((await runtimeAction(start.id,actor)).state === "rejected") throw new Error("start_rejected_no_retry");
      await new Promise(resolve => setTimeout(resolve,2000));
    }
    let crawl=(await postgresPool().query("SELECT * FROM runtime_crawl_jobs WHERE id=$1",[start.id])).rows[0];
    if(crawl?.state === "running" && crawl.remote_task_id) {
      const runtime=new SkillExecution(crawl.context_json);
      try {
        const stop=(await runtime.discover()).tools.find(t=>t.remoteName==="stop_crawl");
        if(!stop) throw new Error("owned_task_stop_unavailable");
        const proposed=await runtime.invoke(String(stop.exposed.name),{task_id:crawl.remote_task_id});
        await confirm(String((proposed.structuredContent as Json).action_id)); await pump();
      }finally{runtime.close();}
    }
    crawl=(await postgresPool().query("SELECT * FROM runtime_crawl_jobs WHERE id=$1",[start.id])).rows[0];
    save("crawl-receipt",crawl);
    console.log(JSON.stringify({phase:"collection-ended",task_id:crawl?.remote_task_id,state:crawl?.state,result_state:crawl?.result_state,count:crawl?.result_json?.candidates?.length??null}));
  } else {
    const rows=(await postgresPool().query("SELECT c.* FROM runtime_crawl_jobs c JOIN runtime_actions a ON a.id=c.id WHERE a.session_id=$1",[session])).rows;
    if(rows.length!==1 || rows[0].result_state!=="ready" || !Array.isArray(rows[0].result_json?.candidates)) throw new Error("requires_real_saved_candidates");
    const before=(await actions()).rowCount;
    const result=await withScopedUser(user,()=>runCodex(session,"crawler_collect",
      `请根据已保存的本任务 ${rows[0].remote_task_id} 候选及发现条件形成中文候选简报。若权威任务结果为空，明确没有候选，不编造推荐；读取错误不得称为空。列明订阅数原文与来源、条件差距、无法核验的地区/方向/最近10条均播；采集样本不等于最近10条。只分析已有快照，不重新采集、不导入、不发信。`,
      {discovery_brief:brief,skip_user_memory:true}));
    save("analysis-harness",result);
    if((await actions()).rowCount!==before) throw new Error("analysis_proposed_unexpected_action");
    console.log(JSON.stringify({phase,harness_status:result.status,saved_candidate_count:rows[0].result_json.candidates.length,new_actions:0}));
  }
}catch(error){console.error(JSON.stringify({phase,error:error instanceof Error?error.message:"acceptance_failed"}));process.exitCode=1;}
finally{await closePostgresPool();getConn().close();}
