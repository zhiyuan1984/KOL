import { runExecutionWorker } from "./execution-jobs/worker.js";

void runExecutionWorker().catch((error) => {
  console.error("[execution-worker] fatal", error);
  process.exitCode = 1;
});
