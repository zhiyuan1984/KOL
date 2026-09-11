import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { startStarryHomeLibrarySync } from "./starrykol/library-sync.js";
import { startFollowedMailSync } from "./starrykol/mail-sync.js";

const port = Number(process.env.LINGONG_PORT || "8765");
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
