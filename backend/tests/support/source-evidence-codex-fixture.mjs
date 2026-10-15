#!/usr/bin/env node
import readline from "node:readline";

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const scopeFromPrompt = (text) => {
  const marker = "数据：";
  const encoded = String(text || "").slice(String(text || "").indexOf(marker) + marker.length);
  const data = JSON.parse(encoded);
  const evidence = Array.isArray(data.evidence) ? data.evidence : [];
  const ids = evidence.map((item) => String(item?.id || "")).filter(Boolean);
  if (!ids.length) throw new Error("scope fixture received no source evidence IDs");
  return {
    summary: "仅覆盖已提供的上传原文摘录。",
    entities: [],
    topics: [{ label: "原文范围", evidence_ids: ids }],
    question_types: ["overview"],
    limitations: ["仅覆盖收录资料"],
    unverified_notes: [],
  };
};

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const { id, method, params } = message;
  if (method === "initialize") return send({ id, result: { protocolVersion: "1" } });
  if (method === "initialized") return;
  if (method === "account/read") return send({ id, result: { account: { type: "chatgpt", email: "stub-scope@example.invalid" }, requiresOpenaiAuth: true } });
  if (method === "thread/start") return send({ id, result: { thread: { id: "source-evidence-scope" } } });
  if (method === "turn/start") {
    try {
      const input = Array.isArray(params?.input) ? params.input : [];
      const prompt = input.find((part) => part?.type === "text")?.text;
      const scope = scopeFromPrompt(prompt);
      send({ id, result: { turn: { id: "source-evidence-turn" } } });
      send({ method: "item/completed", params: { item: { id: "scope-result", type: "agentMessage", text: JSON.stringify(scope) } } });
      send({ method: "turn/completed", params: { turn: { id: "source-evidence-turn", status: "completed" } } });
    } catch (error) {
      send({ id, error: { message: error instanceof Error ? error.message : String(error) } });
    }
    return;
  }
  send({ id, result: {} });
});
