/**
 * Dify 工具节点：Starry 只读 MCP。
 * Codex 调这些工具；技能禁止自己打 Starry HTTP。写 stage / 发信走 Gateway。
 */
import { parseAllowArg, parseDbArg, serveMcpStdio } from "./stdio.js";
import { STARRY_TOOLS, callStarryTool } from "./tools.js";

const db = parseDbArg();
if (db) process.env.LINGONG_DB = db;

serveMcpStdio({
  name: "starry",
  tools: STARRY_TOOLS,
  call: callStarryTool,
  allow: parseAllowArg(),
});
