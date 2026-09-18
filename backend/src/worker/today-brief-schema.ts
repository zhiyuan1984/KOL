import type { Json } from "../types.js";

/** Codex response_format: every property required; extra keys forbidden. */
export const TODAY_BRIEF_OUTPUT_SCHEMA: Json = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["today_brief"] },
    lead: { type: "string" },
    stats: {
      type: "object",
      properties: {
        unfinished: { type: "number" },
        discovery_anomalies: { type: "number" },
        failed_runs: { type: "number" },
      },
      required: ["unfinished", "discovery_anomalies", "failed_runs"],
      additionalProperties: false,
    },
    primary: {
      type: "object",
      properties: {
        verb: { type: "string" },
        label: { type: "string" },
        object_id: { type: ["string", "null"] },
        object_type: { type: "string" },
        person_id: { type: ["string", "null"] },
      },
      required: ["verb", "label", "object_id", "object_type", "person_id"],
      additionalProperties: false,
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          items: { type: "array", items: { type: "string" } },
        },
        required: ["title", "body", "items"],
        additionalProperties: false,
      },
    },
    display_tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          work_item_id: { type: "string" },
          title: { type: "string" },
          why: { type: "string" },
          rank: { type: "number" },
          verb: { type: "string" },
          label: { type: "string" },
        },
        required: ["work_item_id", "title", "why", "rank", "verb", "label"],
        additionalProperties: false,
      },
    },
    todo_layout: {
      type: "array",
      items: {
        type: "object",
        properties: {
          work_item_id: { type: "string" },
          rank: { type: "number" },
          why: { type: "string" },
        },
        required: ["work_item_id", "rank", "why"],
        additionalProperties: false,
      },
    },
    analysis_hints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          object_id: { type: "string" },
          hint: { type: "string" },
          attach_skill: { type: ["string", "null"] },
        },
        required: ["object_id", "hint", "attach_skill"],
        additionalProperties: false,
      },
    },
    source_cursor: {
      type: "object",
      properties: {
        cursor_from: { type: ["string", "null"] },
        cursor_to: { type: "string" },
        added: { type: "array", items: { type: "string" } },
        removed: { type: "array", items: { type: "string" } },
        unchanged: { type: "array", items: { type: "string" } },
      },
      required: ["cursor_from", "cursor_to", "added", "removed", "unchanged"],
      additionalProperties: false,
    },
    increment_summary: { type: "string" },
  },
  required: [
    "type",
    "lead",
    "stats",
    "primary",
    "sections",
    "display_tasks",
    "todo_layout",
    "analysis_hints",
    "source_cursor",
    "increment_summary",
  ],
  additionalProperties: false,
};
