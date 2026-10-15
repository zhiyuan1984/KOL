import { registerExecutionHandler } from "../execution-jobs/handlers.js";
import { pgExecutionJobPayload } from "../execution-jobs/postgres-store.js";
import { runtimeAction } from "./action-store.js";
import { SkillExecution } from "./execution.js";

registerExecutionHandler("runtime.confirm", async (job, checkpoint) => {
  const payload = pgExecutionJobPayload(job);
  const action = await runtimeAction(String(payload.action_id), String(job.actor_ref));
  const execution = new SkillExecution(action.context_json, undefined, checkpoint);
  try {
    await checkpoint();
    return await execution.confirm(action.id, String(payload.confirmation_version));
  } finally { execution.close(); }
});
