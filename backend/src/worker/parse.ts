/**
 * Dify 节点输出 → Item。
 * 从 agent 文本 / box 文件解析 create_draft / propose_stage / list_overdue / create_approval / text。
 * Codex 的 task_result schema 会把 create_draft 嵌进 sections[].body，这里再提升为同级 Item。
 */
import fs from "node:fs";
import path from "node:path";
import type { Json } from "../types.js";

const ALLOWED = new Set([
  "create_draft",
  "propose_stage",
  "list_overdue",
  "create_approval",
  "text",
  "note",
  "task_result",
  "crawl_plan",
  "today_brief",
]);
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gi;

function asDraftItem(obj: unknown): Json | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Json;
  const type = String(rec.type || "");
  if (type && type !== "create_draft") return null;
  const subject = String(rec.subject || "").trim();
  const body = String(rec.body || rec.body_en || rec.bodyText || rec.preview || "").trim();
  const from = String(rec.from || rec.mailboxEmail || "").trim();
  const to = rec.to || rec.recipient || rec.recipientEmail;
  if (type !== "create_draft" && !(subject && body && (from || to))) return null;
  if (!subject && !body) return null;
  return { ...rec, type: "create_draft", ...(body && !rec.body ? { body } : {}) };
}

/** Read a JSON string that may contain raw newlines (Codex nested create_draft in a section body). */
function readQuoted(text: string, quoteAt: number): { value: string; end: number } | null {
  if (text[quoteAt] !== "\"") return null;
  let i = quoteAt + 1;
  let out = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === undefined) break;
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === "u" && /^[0-9a-fA-F]{4}/.test(text.slice(i + 2, i + 6))) {
        out += String.fromCharCode(Number.parseInt(text.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      } else out += next;
      i += 2;
      continue;
    }
    if (ch === "\"") return { value: out, end: i + 1 };
    out += ch;
    i += 1;
  }
  return null;
}

function fieldStringAfter(text: string, from: number, name: string): string {
  const re = new RegExp(`"${name}"\\s*:\\s*"`);
  const slice = text.slice(from);
  const match = re.exec(slice);
  if (!match) return "";
  return readQuoted(text, from + match.index + match[0].length - 1)?.value || "";
}

function fieldNumberAfter(text: string, from: number, name: string): number | null {
  const re = new RegExp(`"${name}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const match = re.exec(text.slice(from));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function fieldBoolAfter(text: string, from: number, name: string): boolean | null {
  const re = new RegExp(`"${name}"\\s*:\\s*(true|false)`);
  const match = re.exec(text.slice(from));
  if (!match) return null;
  return match[1] === "true";
}

/** Codex often nests create_draft JSON inside a section string without escaping quotes or newlines. */
export function extractDraftsFromRawText(text: string): Json[] {
  const out: Json[] = [];
  const seen = new Set<string>();
  const marker = /"type"\s*:\s*"create_draft"/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    const from = match.index;
    const draft = asDraftItem({
      type: "create_draft",
      from: fieldStringAfter(text, from, "from") || fieldStringAfter(text, from, "mailboxEmail"),
      to: fieldStringAfter(text, from, "to") || fieldStringAfter(text, from, "recipient"),
      subject: fieldStringAfter(text, from, "subject"),
      body: fieldStringAfter(text, from, "body"),
      body_zh_internal: fieldStringAfter(text, from, "body_zh_internal"),
      template_id: fieldStringAfter(text, from, "template_id"),
      currency: fieldStringAfter(text, from, "currency"),
      official_stage: fieldStringAfter(text, from, "official_stage"),
      amount_usd: fieldNumberAfter(text, from, "amount_usd"),
      keep_stage: fieldBoolAfter(text, from, "keep_stage"),
    });
    if (!draft || !String(draft.body || "").trim() || !String(draft.subject || "").trim()) continue;
    const key = JSON.stringify(draft);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(draft);
  }
  return out;
}

function scanJsonValues(text: string): unknown[] {
  const t = (text || "").trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    /* scan successive objects, including nested JSON inside a section body */
  }
  const found: unknown[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "{" && t[i] !== "[") continue;
    for (let end = t.length; end > i; end--) {
      try {
        const parsed = JSON.parse(t.slice(i, end));
        if (Array.isArray(parsed)) found.push(...parsed);
        else found.push(parsed);
        i = end - 1;
        break;
      } catch {
        /* keep shrinking */
      }
    }
  }
  return found;
}

function parseLooseJson(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(parseLooseJson);
  if (typeof value === "object") return [value];
  const text = String(value).trim();
  if (!text) return [];
  const start = Math.min(
    ...["{", "["].map((ch) => {
      const at = text.indexOf(ch);
      return at < 0 ? Number.POSITIVE_INFINITY : at;
    }),
  );
  if (!Number.isFinite(start) || start === Number.POSITIVE_INFINITY) return [];
  return scanJsonValues(text.slice(start));
}

/** Lift create_draft JSON that Codex nested inside a task_result section body. */
export function extractNestedCreateDrafts(item: Json): Json[] {
  if (!item || typeof item !== "object") return [];
  const out: Json[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    for (const obj of parseLooseJson(raw)) {
      const draft = asDraftItem(obj);
      if (!draft) continue;
      const key = JSON.stringify(draft);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(draft);
    }
  };
  const sections = Array.isArray(item.sections) ? item.sections as Json[] : [];
  for (const section of sections) {
    add(section.body);
    add(section.content);
    add(section.body_en);
    if (Array.isArray(section.items)) {
      for (const row of section.items) add(row);
    }
    out.push(...extractDraftsFromRawText(String(section.body || section.content || "")).filter((draft) => {
      const key = JSON.stringify(draft);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }
  if (item.type !== "create_draft") {
    add(item.body);
    add(item.summary);
    const top = asDraftItem({
      type: "create_draft",
      from: item.from || item.mailboxEmail,
      to: item.to || item.recipient,
      subject: item.subject,
      body: item.body || item.bodyText,
      body_zh_internal: item.body_zh_internal,
      template_id: item.template_id,
      amount_usd: item.amount_usd,
      currency: item.currency,
      official_stage: item.official_stage,
      keep_stage: item.keep_stage,
    });
    if (top && String(top.subject || "").trim() && String(top.body || "").trim()) {
      const key = JSON.stringify(top);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(top);
      }
    }
    out.push(...extractDraftsFromRawText(String(item.body || item.summary || "")).filter((draft) => {
      const key = JSON.stringify(draft);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }
  return out;
}

export function hasComposeDraftOutput(items: Json[]): boolean {
  return items.some((item) => item.type === "create_draft" || extractNestedCreateDrafts(item).length > 0);
}

function asItems(obj: unknown): Json[] {
  if (obj == null) return [];
  if (Array.isArray(obj)) return obj.flatMap(asItems);
  if (typeof obj === "object") {
    const rec = obj as Json;
    if (ALLOWED.has(String(rec.type))) {
      if (String(rec.type) === "task_result") {
        const nested = extractNestedCreateDrafts(rec);
        return nested.length ? [...nested, rec] : [rec];
      }
      return [rec];
    }
    if (Array.isArray(rec.items)) return asItems(rec.items);
    if (rec.type === "create_draft" || ("body" in rec && "subject" in rec)) {
      if (!rec.type) rec.type = "create_draft";
      if (ALLOWED.has(String(rec.type))) return [rec];
    }
  }
  return [];
}

function tryJson(text: string): Json[] {
  const t = (text || "").trim();
  if (!t) return [];
  try {
    return asItems(JSON.parse(t));
  } catch {
    /* scan */
  }
  const found: Json[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "{" && t[i] !== "[") continue;
    try {
      const obj = JSON.parse(t.slice(i));
      found.push(...asItems(obj));
      break;
    } catch {
      for (let end = t.length; end > i; end--) {
        try {
          found.push(...asItems(JSON.parse(t.slice(i, end))));
          i = end - 1;
          break;
        } catch {
          /* keep shrinking */
        }
      }
    }
  }
  return found;
}

export function parseAgentTexts(texts: string[]): Json[] {
  const items: Json[] = [];
  for (const raw of texts) {
    const t = raw || "";
    for (const m of t.matchAll(FENCE_RE)) {
      items.push(...tryJson(m[1]));
    }
    items.push(...tryJson(t));
    items.push(...extractDraftsFromRawText(t));
  }
  const seen = new Set<string>();
  const out: Json[] = [];
  for (const it of items) {
    const key = JSON.stringify(it);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  const drafts = out.filter((item) => item.type === "create_draft");
  const rest = out.filter((item) => item.type !== "create_draft");
  return drafts.length ? [...drafts, ...rest] : out;
}

export function parseBoxFiles(box: string): Json[] {
  const items: Json[] = [];
  for (const name of ["items.json", "draft.json", "output.json"]) {
    const p = path.join(box, name);
    if (fs.existsSync(p)) {
      try {
        items.push(...asItems(JSON.parse(fs.readFileSync(p, "utf8"))));
      } catch {
        /* skip */
      }
    }
  }
  return items;
}
