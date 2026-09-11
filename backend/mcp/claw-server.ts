/**
 * Dify 工具节点：Claw 只读 MCP。
 * Codex 调这些工具；技能禁止自己打 Claw HTTP。ingest 只允许 Host。
 */
import { parseAllowArg, parseDbArg, serveMcpStdio } from "./stdio.js";
import { CLAW_TOOLS, callClawTool } from "./tools.js";

const db = parseDbArg();
if (db) process.env.LINGONG_DB = db;

serveMcpStdio({
  name: "claw",
  tools: CLAW_TOOLS,
  call: callClawTool,
  allow: parseAllowArg(),
});
