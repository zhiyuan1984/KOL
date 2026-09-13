#!/usr/bin/env node
/**
 * Minimal Codex app-server stand-in for auth tests.
 * First account/read is empty; after account/updated the next read has a chatgpt account.
 * `account/login/start` with apiKey succeeds.
 */
import fs from "node:fs";
import readline from "node:readline";

const mode = process.env.FAKE_CODEX_MODE || "late-chatgpt";
let loggedIn = mode === "already-chatgpt" || mode === "kol-success" || mode === "task-result-success" || mode === "crawl-plan-success" || mode === "recognize-success" || mode === "mail-digest-success";

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function emitReasoning(text, raw = "raw hidden reasoning must not be shown") {
  send({
    method: "item/started",
    params: { item: { id: "rsn_1", type: "reasoning", summary: [] } },
  });
  const size = Math.max(2, Math.ceil(text.length / 4));
  for (let i = 0; i < text.length; i += size) {
    send({
      method: "item/reasoning/summaryTextDelta",
      params: { itemId: "rsn_1", delta: text.slice(i, i + size) },
    });
  }
  send({
    method: "item/completed",
    params: {
      item: {
        id: "rsn_1",
        type: "reasoning",
        summary: [{ type: "summary_text", text }],
        content: [{ type: "reasoning_text", text: raw }],
      },
    },
  });
}

if (mode === "late-chatgpt") {
  setTimeout(() => {
    send({ method: "account/updated", params: { authMode: "chatgpt", planType: "plus" } });
    loggedIn = true;
  }, 200);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (method === "test/hang") return;
  if (method === "initialize") {
    send({ id, result: { protocolVersion: "1" } });
    return;
  }
  if (method === "initialized") return;
  if (method === "account/read") {
    if (loggedIn) {
      send({
        id,
        result: {
          account: { type: "chatgpt", email: "u@example.com", planType: "plus" },
          requiresOpenaiAuth: true,
        },
      });
    } else {
      send({ id, result: { account: null, requiresOpenaiAuth: true } });
    }
    return;
  }
  if (method === "account/login/start") {
    if (params && params.type === "apiKey" && params.apiKey) {
      loggedIn = true;
      send({ id, result: { type: "apiKey" } });
      send({ method: "account/login/completed", params: { loginId: null, success: true, error: null } });
      send({ method: "account/updated", params: { authMode: "apikey" } });
      return;
    }
    send({ id, error: { message: "unsupported login" } });
    return;
  }
  if (method === "thread/start") {
    const dump = String(process.env.FAKE_CODEX_THREAD_START || "").trim();
    if (dump) {
      try {
        fs.writeFileSync(dump, JSON.stringify(params || {}));
      } catch {
        /* test dump is best-effort */
      }
    }
    send({ id, result: { thread: { id: "thr_fake" } } });
    return;
  }
  if (method === "thread/resume") {
    send({ id, result: { thread: { id: "thr_fake" } } });
    return;
  }
  if (method === "thread/fork") {
    send({ id, result: { thread: { id: "thr_child", parentId: params?.threadId } } });
    return;
  }
  if (method === "turn/start") {
    send({ id, result: { turn: { id: "turn_fake" } } });
    if (mode === "kol-success") {
      const item = params?.outputSchema ? {
        type: "create_draft",
        template_id: "kol.first_touch",
        from: "kol.lt@litime.example",
        to: "creator@example.com",
        subject: "LiTime creator collaboration",
        body: "Hi, we'd love to explore a creator collaboration with you.",
        body_zh_internal: "你好，我们希望与你探讨创作者合作。",
        keep_stage: true,
      } : {
        type: "text",
        text: "Unstructured reply",
      };
      emitReasoning("已根据达人定位确定邮件语气与合作切入点。");
      setTimeout(() => {
        send({
          method: "item/completed",
          params: { item: { type: "agentMessage", text: JSON.stringify(item) } },
        });
        send({ method: "turn/completed", params: { turn: { id: "turn_fake", status: "completed" } } });
      }, Number(process.env.FAKE_CODEX_DELAY || 20));
    }
    if (mode === "task-result-success") {
      const item = params?.outputSchema ? {
        type: "task_result",
        title: "流水线复盘",
        summary: "已完成跨能力域复盘。",
        sections: [
          { title: "关键发现", body: "两项合作需要优先处理。", items: ["复核停滞合作"] },
        ],
        metrics: [
          { label: "置信度", value: "0.91", detail: "基于当前证据" },
        ],
        recommended_actions: ["创建后续人工确认任务"],
      } : { type: "text", text: "Unstructured reply" };
      emitReasoning("已汇总各能力域状态并识别停滞合作。", "raw generic reasoning must not be shown");
      setTimeout(() => {
        send({
          method: "item/completed",
          params: { item: { type: "agentMessage", text: JSON.stringify(item) } },
        });
        send({ method: "turn/completed", params: { turn: { id: "turn_fake", status: "completed" } } });
      }, Number(process.env.FAKE_CODEX_DELAY || 20));
    }
    if (mode === "crawl-plan-success") {
      const required = params?.outputSchema?.required || [];
      const strict = ["keywords", "specified_ids", "creator_ids"].every((field) => required.includes(field));
      const item = strict ? {
        type: "crawl_plan",
        title: "YouTube露营达人采集计划",
        summary: "请确认参数后启动远程采集。",
        platform: "youtube",
        mode: "search",
        keywords: ["露营"],
        specified_ids: [],
        creator_ids: [],
        parameters_hint: "search 使用 keywords",
        requires_confirmation: true,
      } : { type: "text", text: "Invalid schema" };
      emitReasoning("已根据平台和关键词整理采集范围。", "raw hidden reasoning must not be shown");
      setTimeout(() => {
        send({
          method: "item/completed",
          params: { item: { type: "agentMessage", text: JSON.stringify(item) } },
        });
        send({ method: "turn/completed", params: { turn: { id: "turn_fake", status: "completed" } } });
      }, Number(process.env.FAKE_CODEX_DELAY || 20));
    }
    if (mode === "recognize-success") {
      const item = {
        task_type: "email_mailbox_list",
        confidence: 0.92,
        clarification_kind: "none",
        entities: {},
        missing_fields: [],
        alternatives: [],
      };
      setTimeout(() => {
        send({
          method: "item/completed",
          params: { item: { type: "agentMessage", text: JSON.stringify(item) } },
        });
        send({ method: "turn/completed", params: { turn: { id: "turn_fake", status: "completed" } } });
      }, Number(process.env.FAKE_CODEX_DELAY || 20));
    }
    if (mode === "mail-digest-success") {
      const item = { digest: "来信明确说想合作，并请品牌补充下一步。" };
      setTimeout(() => {
        send({
          method: "item/completed",
          params: { item: { type: "agentMessage", text: JSON.stringify(item) } },
        });
        send({ method: "turn/completed", params: { turn: { id: "turn_fake", status: "completed" } } });
      }, Number(process.env.FAKE_CODEX_DELAY || 20));
    }
    return;
  }
  send({ id, result: {} });
});
