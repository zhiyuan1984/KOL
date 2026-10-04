import type { Json } from "../types.js";

export const START_FIELDS = ["platforms", "crawler_type", "keywords", "specified_ids", "creator_ids", "max_notes_count", "enable_comments", "enable_sub_comments"];
/** Intersect with the actual remote schema, never add switches unsupported by the gateway. */
export function crawlToolPresentation(tool: Json): Json | null {
  const schema = tool.inputSchema as Json;
  if (tool.name === "start_crawl") {
    const properties = schema.properties as Json || {};
    return { ...tool,
      description: `${tool.description || ""}\nOnly propose a confirmed-scope collection. Allowed arguments: ${START_FIELDS.join(", ")}. Region, follower/view thresholds and desired candidate count are post-collection criteria. max_notes_count limits a remote query/mode, NOT the total task or distinct creators; multiple keywords and channel enrichment may perform additional collection. P1 only accepts comments switches set to false. Do not promise a hard task-total limit.`,
      inputSchema: { ...schema,
        properties: Object.fromEntries(START_FIELDS.filter(key => key in properties).map(key => [key, properties[key]])),
        additionalProperties: false,
        allOf: [...(Array.isArray(schema.allOf) ? schema.allOf : []), {
          type: "object", properties: { platforms: { type: "array", minItems: 1, maxItems: 1,
            items: { enum: ["youtube", "instagram", "facebook"] } }, crawler_type: { enum: ["search", "detail", "creator"] },
            max_notes_count: { type: "integer", minimum: 1, maximum: 10000 },
            enable_comments: { const: false }, enable_sub_comments: { const: false } },
          required: ["platforms", "crawler_type"],
          oneOf: [
            { properties: { crawler_type: { const: "search" } }, required: ["keywords"] },
            { properties: { crawler_type: { const: "detail" } }, required: ["specified_ids"] },
            { properties: { crawler_type: { const: "creator" } }, required: ["creator_ids"] },
          ],
        }],
      },
    };
  }
  if (["get_crawl_status", "get_crawl_logs", "get_creators", "stop_crawl"].includes(String(tool.name))) {
    // A fabricated task_id requirement cannot make a global remote endpoint scoped.
    if (!(schema.properties as Json | undefined)?.task_id) return null;
    return { ...tool,
      description: `${tool.description || ""}\nRequires the task_id from a persisted start receipt. Never call without it or read global results.`,
      inputSchema: { ...schema, required: [...new Set([...(Array.isArray(schema.required) ? schema.required : []), "task_id"])] },
    };
  }
  return tool;
}
