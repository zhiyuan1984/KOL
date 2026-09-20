import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { failStuckPlans } from "./host/today-brief.js";
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
