#!/usr/bin/env node
// Protocol fixture, NOT a model and NOT a LIVE production verification.
import fs from "node:fs";
import readline from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
let proxy;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const input = readline.createInterface({ input: process.stdin });
input.on("line", async (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  if (method === "initialize") return send({ id, result: {} });
  if (method === "account/read") return send({ id, result: { account: { type: "chatgpt" }, requiresOpenaiAuth: true } });
  if (method === "thread/resume") return send({ id, error: { message: "stale threads must not be resumed" } });
  if (method === "thread/start") {
    const servers = params.config?.mcp_servers || {};
    if (Object.keys(servers).join() !== "skill_runtime") return send({ id, error: { message: "direct supplier configuration detected" } });
    proxy = servers.skill_runtime;
    const configFile = `${process.env.CODEX_HOME}/config.toml`;
    const inheritedConfig = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : "";
    if (process.env.RUNTIME_FIXTURE_SECRET || /mcp_servers|untrusted\.example/.test(inheritedConfig)) {
      return send({ id, error: { message: "supplier credential or inherited Codex config leaked" } });
    }
    return send({ id, result: { thread: { id: "governed-thread" } } });
  }
  if (method !== "turn/start") return send({ id, result: {} });
  send({ id, result: { turn: { id: "governed-turn" } } });
  const client = new Client({ name: "fake-codex-runtime-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(proxy.url), { requestInit: { headers: proxy.http_headers } }));
    const { tools } = await client.listTools();
    const skill = params.input?.find((entry) => entry?.type === "skill")?.name;
    if (["today_plan", "todo_plan", "today_analyze"].includes(skill)) {
      if (tools.length !== 0) throw new Error("platform planner must not receive connector tools");
      const item = {
        type: "today_brief",
        lead: "优先处理已有的未完成工作。",
        stats: { unfinished: 0, discovery_anomalies: 0, failed_runs: 0 },
        primary: { verb: "open", label: "查看任务", object_id: null, object_type: "task", person_id: null },
        sections: [{ title: "当前工作", body: "当前没有需要外部连接器的数据读取。", items: [] }],
        display_tasks: [],
        analysis_hints: [],
        reasoning: ["只读取 Host 提供的工作区快照", "未调用外部连接器", "按当前任务状态给出建议"],
        source_cursor: { cursor_from: null, cursor_to: "fixture", added: [], removed: [], unchanged: [] },
        increment_summary: "隔离运行夹具。",
      };
      send({ method: "item/completed", params: { item: { type: "agentMessage", text: JSON.stringify(item) } } });
      send({ method: "turn/completed", params: { turn: { id: "governed-turn", status: "completed" } } });
      return;
    }
    if (tools.length !== 1) throw new Error("expected one governed tool");
    const result = await client.callTool({ name: tools[0].name, arguments: { query: "camping" } });
    if (result.isError) throw new Error("tool refused the fixture call");
    const item = { type: "task_result", title: "Local protocol fixture", summary: "Used the governed remote result",
      sections: [{ title: "Result", body: JSON.stringify(result.structuredContent), items: [] }], metrics: [], recommended_actions: [] };
    send({ method: "item/completed", params: { item: { type: "agentMessage", text: JSON.stringify(item) } } });
    send({ method: "turn/completed", params: { turn: { id: "governed-turn", status: "completed" } } });
  } catch (error) {
    send({ method: "turn/completed", params: { turn: { id: "governed-turn", status: "failed", error: { message: error.message } } } });
  } finally { await client.close(); }
});
