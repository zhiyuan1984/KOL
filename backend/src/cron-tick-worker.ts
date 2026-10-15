import { runCronTickWorker } from "./cron/tick-worker.js";

void runCronTickWorker().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "cron_tick_boot_failed";
  console.error("[cron-tick] fatal", { code });
  process.exitCode = 1;
});
