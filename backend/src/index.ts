import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { authDisabled } from "./auth.js";
import { failStuckPlans } from "./host/today-brief.js";
import { failInterruptedTaskRuns } from "./host/task-run-recovery.js";
import { credentialVaultReady } from "./runtime/credentials.js";
import { startStarryHomeLibrarySync } from "./starrykol/library-sync.js";
import { startFollowedMailSync } from "./starrykol/mail-sync.js";

const port = Number(process.env.LINGONG_PORT || "8765");

// Nothing can be running before the first request, so any planning row still
// open here lost its process. Failing them at boot keeps a dead 今日规划 from
// capturing every later entry and hanging the 思考过程 card forever.
const stuck = failStuckPlans("Host 重启时该规划仍在运行");
if (stuck.length) {
  console.warn(`未完成的规划运行已标记失败：${stuck.join("、")}`);
}

// Task runs are executed by children of this process; a fresh boot means any
// row still marked running lost its worker. Close it instead of showing
// "进行中 / 任务开始处理" forever.
const interrupted = failInterruptedTaskRuns("Host 重启时该运行仍在执行");
if (interrupted.length) {
  console.warn(`中断的任务运行已标记失败：${interrupted.join("、")}`);
}

// The credential vault is optional for read-only deployments, but without it
// every "save a connector secret" answers 503; say so once at boot.
if (!authDisabled() && !credentialVaultReady()) {
  console.warn("未配置 RUNTIME_CREDENTIAL_MASTER_KEY（或格式无效）：凭据保险库不可用，含密钥的连接器保存 / 测试 / 发现都会 503。");
}

const app = createApp();
void startStarryHomeLibrarySync().catch((error) => {
  console.error("Starry 红人库启动同步失败", error);
});
void startFollowedMailSync().catch((error) => {
  console.error("Starry 关注红人邮件同步失败", error);
});
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`灵工 工作 → http://127.0.0.1:${info.port}`);
});
