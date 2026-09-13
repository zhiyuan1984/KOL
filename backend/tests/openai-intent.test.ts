import { describe, expect, it } from "vitest";
import {
  classifyTaskIntent,
  codexRecognizeThreadConfig,
  extractRemoteIntentText,
  intentLlmModel,
  intentOutputSchema,
  parseIntentVerdict,
  setIntentLlmFetch,
  stubClassifyIntent,
} from "../src/tasks/openai-intent.js";
import { sanitizeIntentEntities } from "../src/tasks/recognize.js";

const LARRY = "larry.zhao@amperetime.com";
const QQ = "100705721@qq.com";
const FIRST_TOUCH = `首封建联 发件: ${LARRY} 收件: ${QQ} 主题: LiTime MCP 连通测试`;

function lunaResponse(verdict: Record<string, unknown>) {
  return new Response(JSON.stringify({
    output_text: JSON.stringify(verdict),
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(verdict) }] }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("gpt-5.6 Luna intent verdict", () => {
  it("drops invented catalog ids", () => {
    const verdict = parseIntentVerdict(JSON.stringify({
      task_type: "not_a_skill",
      confidence: 0.99,
      entities: {},
      clarification_kind: "none",
    }));
    expect(verdict.task_type).toBeNull();
    expect(verdict.clarification_kind).toBe("direction");
  });

  it("reads email_compose slots from a fenced JSON blob", () => {
    const verdict = parseIntentVerdict(`\`\`\`json
{"task_type":"email_compose","confidence":0.96,"entities":{"mailboxEmail":"${LARRY}","to":["${QQ}"],"subject":"LiTime MCP 连通测试"},"missing_fields":[],"clarification_kind":"none"}
\`\`\``);
    expect(verdict).toMatchObject({
      task_type: "email_compose",
      clarification_kind: "none",
      entities: { mailboxEmail: LARRY, to: [QQ], subject: "LiTime MCP 连通测试" },
    });
  });

  it("drops emails the user did not write", () => {
    const cleaned = sanitizeIntentEntities({
      mailboxEmail: "henry.wei@amperetime.com",
      to: [QQ, "invented@example.com"],
      subject: "keep",
    }, FIRST_TOUCH);
    expect(cleaned.mailboxEmail).toBeUndefined();
    expect(cleaned.to).toEqual([QQ]);
  });

  it("lets the bound mailbox fill From when it is omitted", () => {
    const cleaned = sanitizeIntentEntities({
      mailboxEmail: LARRY,
      to: [QQ],
    }, `首封建联 收件: ${QQ} 主题: 测试`, LARRY);
    expect(cleaned.mailboxEmail).toBe(LARRY);
    expect(cleaned.to).toEqual([QQ]);
  });

  it("stub-classifies the operator sentence as compose with no missing fields", () => {
    const verdict = stubClassifyIntent(FIRST_TOUCH);
    expect(verdict).toMatchObject({
      task_type: "email_compose",
      clarification_kind: "none",
      missing_fields: [],
    });
    expect(verdict.entities.mailboxEmail).toBe(LARRY);
    expect(verdict.entities.to).toEqual([QQ]);
  });

  it("stub-classifies vague mailbox language as direction", () => {
    const verdict = stubClassifyIntent("帮我看一下邮箱情况");
    expect(verdict.task_type).toBeNull();
    expect(verdict.clarification_kind).toBe("direction");
    expect(verdict.alternatives.map((row) => row.task_type)).toEqual([
      "email_mailbox_list",
      "email_conversation_list",
      "email_compose",
    ]);
  });

  it("uses a Codex-strict intent schema so turn/start can complete", () => {
    const schema = intentOutputSchema(["email_compose", "creator_discovery"]) as {
      required?: string[];
      additionalProperties?: boolean;
      properties?: { entities?: { required?: string[]; additionalProperties?: boolean } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining([
      "task_type", "confidence", "entities", "missing_fields", "clarification_kind", "alternatives", "reason_zh",
    ]));
    expect(schema.required).toHaveLength(Object.keys(schema.properties || {}).length);
    expect(schema.properties?.entities?.additionalProperties).toBe(false);
    expect((schema.properties?.entities?.required || []).length).toBeGreaterThan(0);
  });

  it("does not pin the Luna model name onto the Codex recognize thread", () => {
    const prev = process.env.CODEX_MODEL;
    delete process.env.CODEX_MODEL;
    try {
      expect(codexRecognizeThreadConfig()).toEqual({ mcp_servers: {} });
      expect(codexRecognizeThreadConfig()).not.toHaveProperty("model", "gpt-5.6-luna");
    } finally {
      if (prev === undefined) delete process.env.CODEX_MODEL;
      else process.env.CODEX_MODEL = prev;
    }
  });

  it("defaults to gpt-5.6-luna, not gpt-4o", () => {
    const prev = process.env.INTENT_LLM_MODEL;
    delete process.env.INTENT_LLM_MODEL;
    try {
      expect(intentLlmModel()).toBe("gpt-5.6-luna");
    } finally {
      if (prev === undefined) delete process.env.INTENT_LLM_MODEL;
      else process.env.INTENT_LLM_MODEL = prev;
    }
  });

  it("reads Luna Responses output_text", () => {
    expect(extractRemoteIntentText({
      output_text: JSON.stringify({ task_type: "email_compose", confidence: 1, clarification_kind: "none" }),
    })).toContain("email_compose");
  });

  it("uses GPT-5.6 Luna Responses when OPENAI_API_KEY is set", async () => {
    const prevMode = process.env.INTENT_LLM_MODE;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevModel = process.env.INTENT_LLM_MODEL;
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENAI_API_KEY = "sk-test-intent";
    delete process.env.INTENT_LLM_MODEL;
    let hit = "";
    let model = "";
    setIntentLlmFetch(async (input, init) => {
      hit = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model?: string } : {};
      model = String(body.model || "");
      return lunaResponse({
        task_type: "email_compose",
        confidence: 0.95,
        entities: { mailboxEmail: LARRY, to: [QQ], subject: "LiTime MCP 连通测试" },
        missing_fields: [],
        clarification_kind: "none",
      });
    });
    try {
      const verdict = await classifyTaskIntent(FIRST_TOUCH);
      expect(hit).toMatch(/\/responses$/);
      expect(hit).not.toMatch(/chat\/completions/);
      expect(model).toBe("gpt-5.6-luna");
      expect(verdict).toMatchObject({
        task_type: "email_compose",
        clarification_kind: "none",
      });
    } finally {
      setIntentLlmFetch();
      if (prevMode === undefined) delete process.env.INTENT_LLM_MODE;
      else process.env.INTENT_LLM_MODE = prevMode;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevModel === undefined) delete process.env.INTENT_LLM_MODEL;
      else process.env.INTENT_LLM_MODEL = prevModel;
    }
  });
});
