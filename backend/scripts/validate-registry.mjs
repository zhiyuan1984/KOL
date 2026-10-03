// 本体三表目录校验：config/objects-registry.yaml、config/event-catalog.yaml、config/ticket-types.yaml
// 用法：node scripts/validate-registry.mjs [--require-all]
//   --require-all：三份文件必须齐备（发布门禁用）；默认允许缺文件并告警（目录分批落地时）。
// 设计契约：docs/superpowers/specs/2026-10-01-ontology-three-tables-design.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..", "..");
const requireAll = process.argv.includes("--require-all");
const errors = [];
const warnings = [];

function readJsonYaml(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${relative} 必须为 JSON 兼容 YAML：${error.message}`);
    return undefined;
  }
}

function isStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() !== "");
}

const OBJECT_GROUPS = new Set(["A", "B", "C"]);
const OBJECT_LAYERS = new Set(["platform", "kol_business", "org_governance"]);
const OBJECT_STATUSES = new Set(["built", "partial", "not_built", "unknown"]);
const PROPERTY_KINDS = new Set(["base", "derived"]);
const PROPERTY_TYPES = new Set(["text", "enum", "datetime", "amount", "number", "reference", "boolean", "structured"]);
const EVENT_CATEGORIES = new Set(["human_action", "authorized_auto", "external_fact", "system_job", "derived", "legacy"]);
const EVENT_STATUSES = new Set(["built", "partial", "designed", "retired"]);
const TICKET_CHANNEL_FALLBACK = 1;

// 对象 code 全集（见设计契约 §2）
const REQUIRED_CODES = new Set([
  "task", "work_item", "session_thread", "run_record", "artifact",
  "expert", "agent", "digital_team", "skill", "workflow", "knowledge", "skill_market",
  "connector", "mcp_tool", "account_binding",
  "approval_config", "audit_record", "config_version", "cost_event",
  "auto_job", "notification", "exam", "file", "remote_use", "user_pref",
  "memory_entry", "business_event", "kol_index", "follow_index", "mail_summary", "task_summary",
  "creator_candidate", "kol_profile", "collaboration", "follow_relation", "follow_task", "email",
  "quote", "contract", "sample", "content", "settlement", "approval", "risk", "project", "campaign",
  "mailbox", "crawl_batch", "report",
  "company", "org_unit", "user", "membership", "brand", "region", "brand_scope", "region_scope",
  "responsibility", "role", "skill_grant", "skill_tool_binding", "credential_ref", "approval_assignment",
]);
const REQUIRED_B_IDS = Array.from({ length: 18 }, (_, index) => `B${index + 1}`);
const REQUIRED_PROPERTY_SECTIONS = [
  ...Array.from({ length: 15 }, (_, index) => `2.${index + 1}`),
  ...Array.from({ length: 7 }, (_, index) => `3.${index + 1}`),
  ...Array.from({ length: 6 }, (_, index) => `4.${index + 1}`),
];
const BUILTIN_TASK_TYPES = ["today_plan", "todo_plan", "today_analyze", "discovery_crawl"];
const KNOWN_WORK_ITEM_SOURCES = new Set([
  "manual", "text", "schedule", "discovery", "home_discovery", "planning", "kol-analyze-enqueue", "ai",
]);

function skillIds() {
  const dir = path.join(root, "backend", "skills");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
}

// ---------- 1. 对象注册表 ----------
const registry = readJsonYaml("config/objects-registry.yaml");
let registryCodes = new Set();
if (registry === null) {
  const message = "config/objects-registry.yaml 不存在";
  if (requireAll) errors.push(message); else warnings.push(message);
} else if (registry !== undefined) {
  const objects = Array.isArray(registry.objects) ? registry.objects : null;
  if (!objects) errors.push("objects-registry：objects 必须是非空数组");
  else {
    const seenIds = new Set();
    const seenCodes = new Set();
    for (const object of objects) {
      const where = `objects-registry[${object?.id ?? "?"}]`;
      if (typeof object?.id !== "string" || !object.id) errors.push(`${where}：缺少 id`);
      else if (seenIds.has(object.id)) errors.push(`${where}：id 重复`);
      else seenIds.add(object.id);
      if (typeof object?.code !== "string" || !/^[a-z][a-z0-9_]*$/.test(object.code)) errors.push(`${where}：code 必须为小写 snake_case`);
      else if (seenCodes.has(object.code)) errors.push(`${where}：code 重复`);
      else seenCodes.add(object.code);
      if (typeof object?.name !== "string" || !object.name) errors.push(`${where}：缺少 name`);
      if (!OBJECT_GROUPS.has(object?.group)) errors.push(`${where}：group 必须是 A/B/C`);
      if (!OBJECT_LAYERS.has(object?.layer)) errors.push(`${where}：layer 非法`);
      if (typeof object?.stable_id !== "string" || !object.stable_id) errors.push(`${where}：缺少 stable_id`);
      if (!isStringArray(object?.clauses)) errors.push(`${where}：clauses 必须是非空字符串数组`);
      if (typeof object?.source_ref !== "string" || !object.source_ref.startsWith("对象清单 ")) errors.push(`${where}：source_ref 必须指向《对象清单》章节`);
      if (!OBJECT_STATUSES.has(object?.implementation_status)) errors.push(`${where}：implementation_status 非法`);
      if (!Array.isArray(object?.carrier)) errors.push(`${where}：carrier 必须是数组`);
      if (object?.authority_source_status === "blank") {
        if (object.authority_source != null) errors.push(`${where}：来源空白时 authority_source 必须为 null`);
      } else if (object?.authority_source_status === "defined") {
        if (typeof object.authority_source !== "string" || !object.authority_source) errors.push(`${where}：来源已定义时必须填写 authority_source`);
      } else {
        errors.push(`${where}：authority_source_status 必须是 defined/blank`);
      }
      if (object?.properties !== undefined && !Array.isArray(object.properties)) {
        errors.push(`${where}：properties 必须是数组`);
      } else {
        for (const property of object.properties || []) {
          const pWhere = `${where}.properties[${property?.name ?? "?"}]`;
          if (typeof property?.name !== "string" || !property.name) errors.push(`${pWhere}：缺少 name`);
          if (!PROPERTY_KINDS.has(property?.kind)) errors.push(`${pWhere}：kind 非法`);
          if (!PROPERTY_TYPES.has(property?.biz_type)) errors.push(`${pWhere}：biz_type 非法`);
          if (typeof property?.lineage !== "string" || !property.lineage) errors.push(`${pWhere}：缺少 lineage`);
          if (typeof property?.rule !== "string" || !property.rule) errors.push(`${pWhere}：缺少 rule`);
          if (!isStringArray(property?.clauses)) errors.push(`${pWhere}：clauses 必须是非空字符串数组`);
          if (typeof property?.source_ref !== "string" || !property.source_ref.startsWith("属性清单 ")) errors.push(`${pWhere}：source_ref 必须指向《属性清单》章节`);
        }
      }
    }
    for (const id of REQUIRED_B_IDS) if (!seenIds.has(id)) errors.push(`objects-registry：缺少 B 组编号 ${id}`);
    for (const code of REQUIRED_CODES) if (!seenCodes.has(code)) errors.push(`objects-registry：缺少对象 code ${code}`);
    registryCodes = seenCodes;
    const sections = new Set();
    for (const object of objects) {
      for (const property of object?.properties || []) {
        const match = /属性清单 §(\d+\.\d+)/.exec(String(property?.source_ref || ""));
        if (match) sections.add(match[1]);
      }
    }
    for (const section of REQUIRED_PROPERTY_SECTIONS) {
      if (!sections.has(section)) errors.push(`objects-registry：属性清单 §${section} 未登记任何属性`);
    }
    console.log(`objects-registry：${objects.length} 个对象，${objects.reduce((sum, o) => sum + (o?.properties?.length || 0), 0)} 条属性`);
  }
}

// ---------- 2. 事件目录 ----------
const catalog = readJsonYaml("config/event-catalog.yaml");
if (catalog === null) {
  const message = "config/event-catalog.yaml 不存在";
  if (requireAll) errors.push(message); else warnings.push(message);
} else if (catalog !== undefined) {
  const events = Array.isArray(catalog.events) ? catalog.events : null;
  if (!events) errors.push("event-catalog：events 必须是非空数组");
  else {
    const seen = new Set();
    const sections = new Set();
    for (const event of events) {
      const where = `event-catalog[${event?.code ?? "?"}]`;
      if (typeof event?.code !== "string" || !/^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$/.test(event.code)) {
        errors.push(`${where}：code 必须为点分层级小写码`);
      } else if (seen.has(event.code)) errors.push(`${where}：code 重复`);
      else seen.add(event.code);
      if (typeof event?.name !== "string" || !event.name) errors.push(`${where}：缺少事实句 name`);
      if (!EVENT_CATEGORIES.has(event?.category)) errors.push(`${where}：category 非法`);
      if (typeof event?.object_type !== "string" || !event.object_type) errors.push(`${where}：缺少 object_type`);
      else if (registryCodes.size && !registryCodes.has(event.object_type)) errors.push(`${where}：object_type 不在对象注册表 code 集`);
      if (!Array.isArray(event?.payload)) errors.push(`${where}：payload 必须是数组`);
      if (!isStringArray(event?.clauses)) errors.push(`${where}：clauses 必须是非空字符串数组`);
      if (!EVENT_STATUSES.has(event?.status)) errors.push(`${where}：status 非法`);
      if (event?.status === "built" && (typeof event?.carrier !== "string" || !event.carrier)) errors.push(`${where}：built 必须登记 carrier`);
      const ref = /事件清单 §(\d+)/.exec(String(event?.source_ref || ""));
      if (!ref) errors.push(`${where}：source_ref 必须指向《事件清单》章节`);
      else sections.add(ref[1]);
    }
    for (const section of ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]) {
      if (!sections.has(section)) errors.push(`event-catalog：事件清单 §${section} 未登记任何事件`);
    }
    if (events.length < 90) warnings.push(`event-catalog：事件数 ${events.length}，少于预期的 ~100，请核对事件清单是否全量提取`);
    console.log(`event-catalog：${events.length} 条事件`);
  }
}

// ---------- 3. 票型目录 ----------
const tickets = readJsonYaml("config/ticket-types.yaml");
if (tickets === null) {
  const message = "config/ticket-types.yaml 不存在";
  if (requireAll) errors.push(message); else warnings.push(message);
} else if (tickets !== undefined) {
  const kinds = Array.isArray(tickets.kinds) ? tickets.kinds : null;
  const channels = Array.isArray(tickets.channels) ? tickets.channels : null;
  if (!kinds) errors.push("ticket-types：kinds 必须是非空数组");
  if (!channels) errors.push("ticket-types：channels 必须是非空数组");
  if (kinds && channels) {
    const knownTypes = new Set([...skillIds(), ...BUILTIN_TASK_TYPES]);
    const kindCodes = new Set();
    const matched = new Set();
    for (const kind of kinds) {
      const where = `ticket-types.kind[${kind?.code ?? "?"}]`;
      if (typeof kind?.code !== "string" || !/^[a-z][a-z0-9_]*$/.test(kind.code)) errors.push(`${where}：code 非法`);
      else if (kindCodes.has(kind.code)) errors.push(`${where}：code 重复`);
      else kindCodes.add(kind.code);
      if (typeof kind?.name !== "string" || !kind.name) errors.push(`${where}：缺少 name`);
      const list = kind?.match?.task_type;
      if (list !== undefined && !Array.isArray(list)) errors.push(`${where}：match.task_type 必须是数组`);
      for (const type of list || []) {
        if (!knownTypes.has(type)) errors.push(`${where}：task_type "${type}" 不存在于 backend/skills 或内置类型`);
        else matched.add(type);
      }
      if (!isStringArray(kind?.clauses)) warnings.push(`${where}：建议补 clauses`);
    }
    for (const required of ["service", "follow_up", "approval", "risk", "crawl", "discovery", "planning", "general"]) {
      if (!kindCodes.has(required)) errors.push(`ticket-types：缺少票型 ${required}`);
    }
    if (!kindCodes.has("general")) errors.push("ticket-types：必须保留 general 兜底票型");
    const channelCodes = new Set();
    let fallbackCount = 0;
    for (const channel of channels) {
      const where = `ticket-types.channel[${channel?.code ?? "?"}]`;
      if (typeof channel?.code !== "string" || !/^[a-z][a-z0-9_]*$/.test(channel.code)) errors.push(`${where}：code 非法`);
      else if (channelCodes.has(channel.code)) errors.push(`${where}：code 重复`);
      else channelCodes.add(channel.code);
      if (typeof channel?.name !== "string" || !channel.name) errors.push(`${where}：缺少 name`);
      if (channel?.fallback === true) {
        fallbackCount += 1;
        if (typeof channel?.order !== "number") errors.push(`${where}：fallback 渠道必须声明 order`);
      } else if (typeof channel?.order !== "number") {
        warnings.push(`${where}：建议声明 order（渠道匹配顺序）`);
      }
      const list = channel?.match?.task_type;
      if (list !== undefined && !Array.isArray(list)) errors.push(`${where}：match.task_type 必须是数组`);
      for (const type of list || []) {
        if (!knownTypes.has(type)) errors.push(`${where}：task_type "${type}" 不存在于 backend/skills 或内置类型`);
      }
      for (const source of channel?.match?.source || []) {
        if (!KNOWN_WORK_ITEM_SOURCES.has(source)) errors.push(`${where}：source "${source}" 不是已知 tickets.source 取值`);
      }
    }
    if (fallbackCount !== TICKET_CHANNEL_FALLBACK) errors.push("ticket-types：必须恰有一个 fallback 渠道");
    for (const required of ["email", "system", "agent", "human"]) {
      if (!channelCodes.has(required)) errors.push(`ticket-types：缺少渠道 ${required}`);
    }
    const uncovered = [...knownTypes].filter((type) => !matched.has(type));
    if (uncovered.length) warnings.push(`ticket-types：${uncovered.length} 个 task_type 未显式归类（将落入 general 兜底）：${uncovered.join(", ")}`);
    console.log(`ticket-types：${kinds.length} 个票型，${channels.length} 个渠道`);
  }
}

// ---------- 输出 ----------
for (const warning of warnings) console.warn(`warn: ${warning}`);
for (const error of errors) console.error(`error: ${error}`);
if (errors.length) {
  console.error(`\nvalidate-registry 失败：${errors.length} 个错误，${warnings.length} 个告警`);
  process.exit(1);
}
console.log(`\nvalidate-registry 通过（${warnings.length} 个告警）`);
