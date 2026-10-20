import { serve } from "@hono/node-server";

const port = Number(process.env.LINGONG_PORT || "8765");

async function main(): Promise<void> {
  if (process.env.KOL_RUNTIME_MODE === "postgres-only") {
    // The limited worker/control entry remains distinct from the full application.
    const { bootstrapPostgresOnlyRuntime, createPostgresOnlyApp } = await import("./postgres-only-app.js");
    await bootstrapPostgresOnlyRuntime();
    const app = createPostgresOnlyApp();
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
      console.log(`灵工 PostgreSQL-only 工单与调度 → http://127.0.0.1:${info.port}`);
    });
    return;
  }

  // Full application entry, sharing the same native PostgreSQL authority store.
  const [
    { createApp },
    { authDisabled },
    { credentialVaultReady },
    { startStarryHomeLibrarySync },
    { startFollowedMailSync },
  ] = await Promise.all([
    import("./app.js"),
    import("./auth.js"),
    import("./runtime/credentials.js"),
    import("./starrykol/library-sync.js"),
    import("./starrykol/mail-sync.js"),
  ]);

  // Recovery is PostgreSQL-only and covers all task types after planner recovery.
  const { failStaleNativePlans } = await import("./postgres/today-plan-repository.js");
  const { failInterruptedTaskRuns, completeSavedReadTaskRuns } = await import("./host/task-run-recovery.js");
  const stuck = await failStaleNativePlans("Host 重启时该规划仍在运行");
  const interrupted = await failInterruptedTaskRuns("Host 重启时该运行仍在执行");
  const completed = await completeSavedReadTaskRuns();
  if (completed.length) console.info(`已保存成果的只读任务已自动完成：${completed.length} 项`);
  if (stuck.length) console.warn(`未完成的规划运行已标记失败：${stuck.join("、")}`);
  if (interrupted.length) console.warn(`中断的任务运行已标记失败：${interrupted.join("、")}`);

  if (!authDisabled() && !credentialVaultReady()) {
    console.warn("未配置 RUNTIME_CREDENTIAL_MASTER_KEY（或格式无效）：凭据保险库不可用，含密钥的连接器保存 / 测试 / 发现都会 503。");
  }

  const app = (await createApp());
  void startStarryHomeLibrarySync().catch((error) => console.error("Starry 红人库启动同步失败", error));
  void startFollowedMailSync().catch((error) => console.error("Starry 关注红人邮件同步失败", error));
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(`灵工 工作 → http://127.0.0.1:${info.port}`);
  });
}

void main().catch((error) => {
  console.error("后端启动失败", error);
  process.exitCode = 1;
});
