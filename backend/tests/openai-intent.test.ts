import { describe, expect, it } from "vitest";
import {
  classifyIntentWithJev,
  classifyTaskIntent,
  codexRecognizeThreadConfig,
  extractRemoteIntentText,
  jevIntentModel,
  intentLlmModel,
  intentOutputSchema,
  parseIntentVerdict,
  setJevIntentFetch,
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

function jevResponse(choice: string, confidence: number) {
  return new Response(JSON.stringify({
    model: "typesafe/jev-1.13",
    answers: {
      task_type: {
        type: "choice",
        choice,
        confidence,
        probabilities: { [choice]: confidence },
      },
    },
    usage: { input_tokens: 100, output_tokens: 10, cost: 0.00001 },
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

  it("does not pin the Luna model name onto the Codex recognize or mail-digest thread", () => {
    const prev = process.env.CODEX_MODEL;
    delete process.env.CODEX_MODEL;
    try {
      expect(codexRecognizeThreadConfig()).toEqual({ mcp_servers: {} });
      expect(codexRecognizeThreadConfig()).not.toHaveProperty("model");
      expect(codexRecognizeThreadConfig()).not.toHaveProperty("model", "gpt-5.6-luna");
      process.env.CODEX_MODEL = "gpt-5.4";
      expect(codexRecognizeThreadConfig()).toEqual({ mcp_servers: {}, model: "gpt-5.4" });
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

  it("defaults Jev to a pinned version, not the moving latest alias", () => {
    const previous = process.env.JEV_MODEL;
    delete process.env.JEV_MODEL;
    try {
      expect(jevIntentModel()).toBe("jev-1.13");
    } finally {
      if (previous === undefined) delete process.env.JEV_MODEL;
      else process.env.JEV_MODEL = previous;
    }
  });

  it("sends bounded task choices to OpenRouter System One without entity extraction", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    let hit = "";
    let body: Record<string, unknown> = {};
    setJevIntentFetch(async (input, init) => {
      hit = String(input);
      body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      return jevResponse("email_compose", 0.91);
    });
    try {
      const verdict = await classifyIntentWithJev(FIRST_TOUCH);
      expect(hit).toBe("https://openrouter.ai/api/v1/systemone");
      expect(body.model).toBe("jev-1.13");
      expect(body.state).toEqual({ user_text: FIRST_TOUCH });
      const criteria = ((body.questions as Record<string, { criteria?: Record<string, string> }>).task_type.criteria || {});
      expect(criteria.email_compose).toContain("邮件");
      expect(criteria.clarification).toContain("不能可靠匹配");
      expect(verdict).toMatchObject({
        task_type: "email_compose",
        confidence: 0.91,
        entities: {},
        clarification_kind: "none",
      });
    } finally {
      setJevIntentFetch();
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
    }
  });

  it("uses high-confidence Jev before Luna and does not call the text model", async () => {
    const previousMode = process.env.INTENT_LLM_MODE;
    const previousRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    let lunaCalled = false;
    setJevIntentFetch(async () => jevResponse("email_compose", 0.91));
    setIntentLlmFetch(async () => {
      lunaCalled = true;
      return lunaResponse({ task_type: "creator_discovery", confidence: 0.99, entities: {}, missing_fields: [], clarification_kind: "none" });
    });
    try {
      const verdict = await classifyTaskIntent(FIRST_TOUCH);
      expect(verdict).toMatchObject({ task_type: "email_compose", reason_zh: "Jev 分类" });
      expect(lunaCalled).toBe(false);
    } finally {
      setJevIntentFetch();
      setIntentLlmFetch();
      if (previousMode === undefined) delete process.env.INTENT_LLM_MODE;
      else process.env.INTENT_LLM_MODE = previousMode;
      if (previousRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousRouterKey;
    }
  });

  it("asks for clarification on low-confidence Jev without escalating to Luna", async () => {
    const previousMode = process.env.INTENT_LLM_MODE;
    const previousRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    let lunaCalled = false;
    setJevIntentFetch(async () => jevResponse("email_compose", 0.42));
    setIntentLlmFetch(async () => {
      lunaCalled = true;
      return lunaResponse({ task_type: "email_compose", confidence: 0.99, entities: {}, missing_fields: [], clarification_kind: "none" });
    });
    try {
      const verdict = await classifyTaskIntent("帮我处理一下");
      expect(verdict).toMatchObject({ task_type: null, clarification_kind: "direction" });
      expect(lunaCalled).toBe(false);
    } finally {
      setJevIntentFetch();
      setIntentLlmFetch();
      if (previousMode === undefined) delete process.env.INTENT_LLM_MODE;
      else process.env.INTENT_LLM_MODE = previousMode;
      if (previousRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousRouterKey;
    }
  });

  it("sends medium-confidence Jev to Luna for a second judgment", async () => {
    const previousMode = process.env.INTENT_LLM_MODE;
    const previousRouterKey = process.env.OPENROUTER_API_KEY;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    // The mocked Luna transport still follows the same key-presence gate as
    // production. Set a disposable value so this test is independent of
    // developer/CI credential environments.
    process.env.OPENAI_API_KEY = "sk-test-intent";
    let lunaCalled = false;
    setJevIntentFetch(async () => jevResponse("email_compose", 0.7));
    setIntentLlmFetch(async () => {
      lunaCalled = true;
      return lunaResponse({
        task_type: "creator_discovery",
        confidence: 0.93,
        entities: {},
        missing_fields: [],
        clarification_kind: "none",
      });
    });
    try {
      const verdict = await classifyTaskIntent("帮我找一批户外达人");
      expect(verdict).toMatchObject({ task_type: "creator_discovery", confidence: 0.93 });
      expect(lunaCalled).toBe(true);
    } finally {
      setJevIntentFetch();
      setIntentLlmFetch();
      if (previousMode === undefined) delete process.env.INTENT_LLM_MODE;
      else process.env.INTENT_LLM_MODE = previousMode;
      if (previousRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousRouterKey;
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
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
