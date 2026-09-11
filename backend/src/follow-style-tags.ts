import { audit, getConn, nowIso } from "./db.js";
import { HttpFail } from "./host/errors.js";
import type { Json, Row } from "./types.js";

export type FollowStyleTag = {
  id: string;
  label: string;
  custom?: boolean;
  reason?: string;
};

export const FOLLOW_STYLE_PRESETS: FollowStyleTag[] = [
  { id: "cautious", label: "犹豫谨慎" },
  { id: "slow_reply", label: "回复慢" },
  { id: "price_sensitive", label: "价格敏感" },
  { id: "fast_decide", label: "决策快" },
  { id: "needs_approval", label: "需上级拍板" },
  { id: "missing_materials", label: "材料不齐" },
];

const MUTEX_GROUPS = [["cautious", "fast_decide"]];

const PRESET_BY_ID = new Map(FOLLOW_STYLE_PRESETS.map((tag) => [tag.id, tag]));
const PRESET_BY_LABEL = new Map(FOLLOW_STYLE_PRESETS.map((tag) => [tag.label, tag]));

export const FOLLOW_STYLE_HINTS: Record<string, string> = {
  cautious: "对方犹豫谨慎，跟进不要催，给选择空间。",
  slow_reply: "对方回复慢，间隔可以拉长，不要连发催促。",
  price_sensitive: "对方价格敏感，报价和对比要写清楚，避免突然抬价。",
  fast_decide: "对方决策快，信要短、要点明确、方便拍板。",
  needs_approval: "对方需上级拍板，材料要完整、便于转发。",
  missing_materials: "对方材料不齐，这封信优先补齐资料而不是推进成交。",
};

const MAX_TAGS = 8;

function slugCustom(label: string): string {
  const compact = label.replace(/\s+/g, "").slice(0, 12);
  return `custom:${compact}`;
}

export function followStylePreset(idOrLabel: string): FollowStyleTag | undefined {
  const raw = String(idOrLabel || "").trim();
  if (!raw) return undefined;
  return PRESET_BY_ID.get(raw) || PRESET_BY_LABEL.get(raw);
}

export function parseFollowStyleTags(raw: unknown): FollowStyleTag[] {
  if (raw == null || raw === "") return [];
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return normalizeFollowStyleTags(String(raw).split(/[、,，]/));
    }
  }
  if (!Array.isArray(value)) return [];
  return normalizeFollowStyleTags(value);
}

export function serializeFollowStyleTags(tags: FollowStyleTag[]): string {
  return JSON.stringify(tags.map((tag) => ({
    id: tag.id,
    label: tag.label,
    ...(tag.custom ? { custom: true } : {}),
  })));
}

function asTag(input: unknown): FollowStyleTag | null {
  if (typeof input === "string") {
    const preset = followStylePreset(input);
    if (preset) return { ...preset };
    const label = input.trim().slice(0, 12);
    if (!label || /[<>]/.test(label)) return null;
    if (/^(DELAY|CONTENT|LOST_CONTACT|EXCEPTION_HANDLING)$/i.test(label)) return null;
    return { id: slugCustom(label), label, custom: true };
  }
  if (!input || typeof input !== "object") return null;
  const row = input as { id?: unknown; label?: unknown; custom?: unknown; reason?: string };
  const label = String(row.label || "").trim().slice(0, 12);
  const id = String(row.id || "").trim();
  const preset = followStylePreset(id) || followStylePreset(label);
  if (preset) return { ...preset, ...(row.reason ? { reason: String(row.reason) } : {}) };
  if (!label) return null;
  return {
    id: id.startsWith("custom:") ? id : slugCustom(label),
    label,
    custom: true,
    ...(row.reason ? { reason: String(row.reason) } : {}),
  };
}

export function normalizeFollowStyleTags(input: unknown): FollowStyleTag[] {
  const incoming = Array.isArray(input) ? input : [input];
  const tags: FollowStyleTag[] = [];
  for (const item of incoming) {
    const tag = asTag(item);
    if (!tag) continue;
    if (tags.some((row) => row.id === tag.id || row.label === tag.label)) continue;
    for (const group of MUTEX_GROUPS) {
      if (!group.includes(tag.id)) continue;
      for (const other of group) {
        if (other === tag.id) continue;
        const idx = tags.findIndex((row) => row.id === other);
        if (idx >= 0) tags.splice(idx, 1);
      }
    }
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

export function mergeFollowStyleTags(current: FollowStyleTag[], incoming: unknown, mode: "replace" | "add" = "replace"): FollowStyleTag[] {
  if (mode === "add") return normalizeFollowStyleTags([...current, ...(Array.isArray(incoming) ? incoming : [incoming])]);
  return normalizeFollowStyleTags(incoming);
}

export function followStylePromptLine(tags: FollowStyleTag[]): string {
  if (!tags.length) return "";
  const labels = tags.map((tag) => tag.label).join("、");
  const hints = tags.map((tag) => FOLLOW_STYLE_HINTS[tag.id]).filter(Boolean);
  return [`跟进风格：${labels}。`, ...hints].join("");
}

const SUGGEST_RULES: { id: string; reason: string; pattern: RegExp }[] = [
  { id: "cautious", reason: "往来偏谨慎", pattern: /犹豫|谨慎|再想想|再考虑|还在考虑|不太确定|need to think|not sure|still considering|a bit hesitant/i },
  { id: "slow_reply", reason: "回复偏慢", pattern: /回复慢|几天没回|一直没回|很久没回|been busy|slow to reply|haven't replied/i },
  { id: "price_sensitive", reason: "对价格敏感", pattern: /太贵|预算有限|再便宜|price sensitive|too expensive|over budget|can you do better on (the )?price/i },
  { id: "fast_decide", reason: "决策偏快", pattern: /马上确认|可以直接签|立刻合作|let's do it|confirmed, let's proceed|ready to sign/i },
  { id: "needs_approval", reason: "需上级拍板", pattern: /问经理|问老板|上级拍板|内部审批|ask my manager|need approval|run it by/i },
  { id: "missing_materials", reason: "材料还不齐", pattern: /媒体包还没|资料不齐|还没媒体包|don't have (a |my )?media kit|media kit isn't ready/i },
];

export function suggestFollowStyleTags(text: string, current: FollowStyleTag[] = []): FollowStyleTag[] {
  const body = String(text || "");
  if (!body.trim()) return [];
  const have = new Set(current.map((tag) => tag.id));
  const out: FollowStyleTag[] = [];
  for (const rule of SUGGEST_RULES) {
    if (have.has(rule.id)) continue;
    if (!rule.pattern.test(body)) continue;
    const preset = PRESET_BY_ID.get(rule.id);
    if (!preset) continue;
    out.push({ ...preset, reason: rule.reason });
  }
  return normalizeFollowStyleTags(out);
}

export function isFollowStyleTagCommand(text: string): boolean {
  return /^(?:给\s*@\S+\s*)?(?:打标签|跟进标签)/.test(String(text || "").trim());
}

export function parseFollowStyleTagCommand(text: string): { handle: string | null; labels: string[] } {
  const raw = String(text || "").trim();
  const handleMatch = /@([^\s，,]+)/.exec(raw);
  const handle = handleMatch ? handleMatch[1].replace(/^@+/, "") : null;
  const cut = raw.replace(/^[\s\S]*?(?:打标签|跟进标签)\s*/, "");
  const labels = cut
    .split(/[、,，]/)
    .flatMap((part) => part.trim().split(/\s+/))
    .map((item) => item.replace(/^@\S+$/, "").trim())
    .filter(Boolean);
  return { handle, labels };
}

export function readFollowStyleTags(col: { follow_style_tags?: unknown } | null | undefined): FollowStyleTag[] {
  if (!col) return [];
  return parseFollowStyleTags(col.follow_style_tags);
}

export function writeFollowStyleTags(
  collaborationId: string,
  incoming: unknown,
  opts: { mode?: "replace" | "add"; actor?: string } = {},
): { tags: FollowStyleTag[]; previous: FollowStyleTag[]; collaboration: Row } {
  const row = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(collaborationId) as Row | undefined;
  if (!row) throw new HttpFail(404, "collaboration not found");
  const previous = readFollowStyleTags(row);
  const tags = mergeFollowStyleTags(previous, incoming, opts.mode || "replace");
  getConn().prepare("UPDATE collaborations SET follow_style_tags=? WHERE id=?").run(serializeFollowStyleTags(tags), collaborationId);
  audit(opts.actor || "demo", "follow_style_tags.update", {
    collaboration_id: collaborationId,
    handle: row.handle,
    tags: tags.map((tag) => tag.label),
    mode: opts.mode || "replace",
    at: nowIso(),
  });
  const collaboration = { ...row, follow_style_tags: serializeFollowStyleTags(tags) };
  return { tags, previous, collaboration };
}

export function followStyleCardPayload(col: Row, tags: FollowStyleTag[], previous: FollowStyleTag[]): Json {
  const added = tags.filter((tag) => !previous.some((row) => row.id === tag.id));
  const removed = previous.filter((tag) => !tags.some((row) => row.id === tag.id));
  const handle = String(col.handle || col.display_name || "");
  const summary = !tags.length && previous.length
    ? `已清除 @${handle} 的跟进标签。不改正式阶段。`
    : added.length
      ? `已给 @${handle} 打上 ${added.map((tag) => tag.label).join("、")}。不改正式阶段。`
      : tags.length
        ? `@${handle} 当前跟进标签：${tags.map((tag) => tag.label).join("、")}。`
        : `给 @${handle} 选择跟进标签后保存。不改正式阶段。`;
  return {
    type: "task_result",
    title: "跟进标签",
    summary,
    sections: [
      {
        title: "当前标签",
        items: tags.length ? tags.map((tag) => tag.label) : ["暂无跟进标签"],
      },
    ],
    follow_style_tags: tags,
    follow_style_presets: FOLLOW_STYLE_PRESETS,
    recommended_actions: tags.length ? [] : FOLLOW_STYLE_PRESETS.slice(0, 3).map((tag) => ({
      label: `打上 ${tag.label}`,
      prompt: `给 @${handle} 打标签 ${tag.label}`,
    })),
    persistent: true,
    skill: "follow_style_tags",
    added: added.map((tag) => tag.label),
    removed: removed.map((tag) => tag.label),
  };
}
