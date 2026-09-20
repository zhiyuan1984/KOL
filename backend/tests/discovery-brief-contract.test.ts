/**
 * The discovery_brief turn is given an output schema and the Host validates what comes
 * back against `validateDiscoveryBrief`. These two drifted once: the generic task_result
 * schema (`additionalProperties: false`, no `brief`) made the payload the validator needs
 * impossible to emit, so every Home run failed with「发现简报缺少可校验结构。」.
 */
import { describe, expect, it } from "vitest";
import {
  DISCOVERY_BRIEF_BANDS,
  DISCOVERY_BRIEF_OUTPUT_SCHEMA,
  DISCOVERY_BRIEF_RECOMMENDS,
  DISCOVERY_BRIEF_SCHEMA,
  validateDiscoveryBrief,
} from "../src/discovery-brief.js";
import { skillOutputSchema } from "../src/worker/runner.js";

type SchemaNode = {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
  enum?: unknown[];
};

const schema = DISCOVERY_BRIEF_OUTPUT_SCHEMA as SchemaNode;

function nodeAt(...path: string[]): SchemaNode {
  let node: SchemaNode = schema;
  for (const key of path) {
    const next = key === "[]" ? node.items : node.properties?.[key];
    if (!next) throw new Error(`schema has no node at ${path.join(".")}`);
    node = next;
  }
  return node;
}

/** Codex response_format needs every property key in `required` and no open objects. */
function assertStrict(node: SchemaNode, where: string): void {
  if (node.properties) {
    expect(node.additionalProperties, `${where} must be a strict object`).toBe(false);
    expect([...(node.required || [])].sort(), `${where} required keys`).toEqual(Object.keys(node.properties).sort());
    for (const [key, child] of Object.entries(node.properties)) assertStrict(child, `${where}.${key}`);
  }
  if (node.items) assertStrict(node.items, `${where}[]`);
}

describe("discovery_brief output contract", () => {
  it("is the schema the discovery_brief turn is actually served", () => {
    const definition = { output: "task_result" } as Parameters<typeof skillOutputSchema>[1];
    expect(skillOutputSchema("discovery_brief", definition)).toBe(DISCOVERY_BRIEF_OUTPUT_SCHEMA);
  });

  it("declares only strict objects and enums the validator accepts", () => {
    assertStrict(schema, "root");
    expect(nodeAt("brief", "schema").enum).toEqual([DISCOVERY_BRIEF_SCHEMA]);
    expect(nodeAt("brief", "ranking", "[]", "band").enum).toEqual([...DISCOVERY_BRIEF_BANDS]);
    expect(nodeAt("brief", "ranking", "[]", "recommend").enum).toEqual([...DISCOVERY_BRIEF_RECOMMENDS]);
  });

  it("carries every field the validator requires", () => {
    // The validator reads exactly these keys; a schema without them cannot pass.
    expect(nodeAt("brief").required).toEqual(
      expect.arrayContaining(["schema", "headline", "counts", "ranking", "dropped", "gaps", "next_actions"]),
    );
    expect(nodeAt("brief", "counts").required).toEqual(
      expect.arrayContaining(["raw", "after_host_filter", "shown", "dropped"]),
    );
    expect(nodeAt("brief", "ranking", "[]").required).toEqual(
      expect.arrayContaining(["candidate_id", "score", "band", "why", "gaps", "fit", "recommend"]),
    );
  });

  it("validates a payload shaped exactly like the schema", () => {
    const counts = { raw: 32, after_host_filter: 12, shown: 12, dropped: 20 };
    const ranking = [{
      candidate_id: "cr_youtube_1",
      score: 88,
      band: DISCOVERY_BRIEF_BANDS[0],
      why: ["名称含 camping"],
      gaps: ["无邮箱"],
      fit: "户外露营",
      recommend: DISCOVERY_BRIEF_RECOMMENDS[0],
    }];
    const payload = {
      type: "task_result",
      title: "discovery_brief/v1",
      summary: "保留 12 位候选人",
      recommended_actions: ["复核后由 Host 决定是否入库"],
      brief: {
        schema: DISCOVERY_BRIEF_SCHEMA,
        headline: "露营装备 YouTube · 入围 12",
        counts,
        ranking,
        dropped: [{ candidate_id: "cr_youtube_9", reason: "粉丝超出区间" }],
        gaps: [],
        next_actions: ["ingest"],
      },
    };
    const validated = validateDiscoveryBrief(payload);
    expect(validated.ok, JSON.stringify(validated)).toBe(true);
    if (validated.ok) {
      expect(validated.brief.ranking[0].candidate_id).toBe("cr_youtube_1");
      expect(validated.brief.counts.after_host_filter).toBe(12);
    }
  });

  it("picks the real brief when an acknowledgement item comes first", () => {
    const ack = {
      type: "task_result",
      title: "正在生成发现简报",
      summary: "我会按 discovery_brief Skill 排序",
      recommended_actions: [],
      brief: {
        schema: DISCOVERY_BRIEF_SCHEMA,
        headline: "处理中",
        counts: { raw: 0, after_host_filter: 0, shown: 0, dropped: 0 },
        ranking: [],
        dropped: [],
        gaps: [],
        next_actions: [],
      },
    };
    const real = {
      type: "task_result",
      title: "discovery_brief/v1",
      summary: "保留 12 位候选人",
      recommended_actions: ["复核后入库"],
      brief: {
        schema: DISCOVERY_BRIEF_SCHEMA,
        headline: "露营装备 YouTube · 入围 12",
        counts: { raw: 32, after_host_filter: 12, shown: 12, dropped: 20 },
        ranking: [{
          candidate_id: "cr_youtube_1",
          score: 88,
          band: "high",
          why: ["名称含 camping"],
          gaps: [],
          fit: "户外露营",
          recommend: "ingest",
        }],
        dropped: [],
        gaps: [],
        next_actions: ["ingest"],
      },
    };
    const validated = validateDiscoveryBrief({ items: [ack, real] });
    expect(validated.ok, JSON.stringify(validated)).toBe(true);
    if (validated.ok) {
      expect(validated.brief.headline).toBe("露营装备 YouTube · 入围 12");
      expect(validated.brief.counts.after_host_filter).toBe(12);
      expect(validated.brief.ranking).toHaveLength(1);
    }
    // Same two items with no ranking anywhere still resolves to the final one.
    const noRanking = { ...real, brief: { ...real.brief, ranking: [], headline: "空结果" } };
    const fallback = validateDiscoveryBrief({ items: [ack, noRanking] });
    expect(fallback.ok).toBe(true);
    if (fallback.ok) expect(fallback.brief.headline).toBe("空结果");
  });

  it("still rejects the generic task_result the model used to emit", () => {
    const generic = {
      type: "task_result",
      title: "discovery_brief/v1",
      summary: "5 名候选人均通过 Host 过滤",
      sections: [],
      metrics: [{ label: "raw", value: "5", detail: "Host 提供" }],
      recommended_actions: ["ingest"],
    };
    const validated = validateDiscoveryBrief(generic);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.message).toBe("发现简报缺少可校验结构。");
  });
});
