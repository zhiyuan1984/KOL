/**
 * PEP：确定性分支（From 白名单、考试、Cc、报价抄送）。
 * Codex 不分支业务规则。发送失败走这里，不合成假信。
 */
import { BRAND_MAILBOXES } from "../config.js";
import { getConn } from "../db.js";
import { TEMPLATES, templateAllowedForStage, templateById } from "../email-templates.js";
import type { Json, Row } from "../types.js";
import type { Persona } from "../config.js";
import { isMissingInputDraft } from "./draft-quality.js";
import { currentFingerprint, fingerprint } from "./fingerprint.js";
import { currentUser } from "./persona.js";

export { currentFingerprint, fingerprint, TEMPLATES };

const CHINESE_RE = /[\u4e00-\u9fff]/g;
const CHINESE_TEST = /[\u4e00-\u9fff]/;

export class PepFail extends Error {
  status: string;
  http: number;
  next_action: string;

  constructor(status: string, http: number, message: string, nextAction: string) {
    super(message);
    this.status = status;
    this.http = http;
    this.next_action = nextAction;
  }

  asDict(): Json {
    return {
      status: this.status,
      message: this.message,
      next_action: this.next_action,
      ok: false,
      stage_changed: false,
    };
  }
}

export function stripChinese(text: string): string {
  return (text || "").replace(CHINESE_RE, "");
}

export function containsChinese(text: string): boolean {
  return CHINESE_TEST.test(text || "");
}

export function brandOfMailbox(addr: string): string | null {
  for (const [b, m] of Object.entries(BRAND_MAILBOXES)) {
    if (m.toLowerCase() === (addr || "").toLowerCase()) return b;
  }
  return null;
}

export function allowedFromMailboxes(user: Persona | null, brand: string | null): { brand: string; email: string; authorized: boolean }[] {
  const u = user || currentUser();
  const authorized = new Set(u.brands || []);
  const out: { brand: string; email: string; authorized: boolean }[] = [];
  for (const [b, m] of Object.entries(BRAND_MAILBOXES)) {
    if (brand && b !== brand) continue;
    out.push({ brand: b, email: m, authorized: authorized.has(b) });
  }
  return out.filter((x) => x.authorized);
}

export function normalizeBrandCode(value: unknown): string | null {
  const raw = String(value || "").trim().toUpperCase().replace(/品牌$/, "");
  if (!raw) return null;
  if (raw === "LT" || raw === "LITIME") return "LT";
  if (raw === "RO" || raw === "RENOGY") return "RO";
  if (raw === "PQ" || raw === "POWERQUEEN" || raw === "POWER QUEEN") return "PQ";
  return BRAND_MAILBOXES[raw] ? raw : null;
}

/** Map a Starry/operator mailbox onto an authorized Host PEP From, so the dropdown value matches the whitelist. */
export function resolveAuthorizedFrom(
  fromAddr: string,
  user?: Persona | null,
  preferredBrand?: string | null,
): { email: string; brand: string | null; allowed: { brand: string; email: string; authorized: boolean }[]; matched: boolean } {
  const u = user || currentUser();
  const currentBrand = brandOfMailbox(fromAddr);
  const wanted = currentBrand || normalizeBrandCode(preferredBrand);
  let allowed = allowedFromMailboxes(u, currentBrand);
  if (!allowed.length) allowed = allowedFromMailboxes(u, wanted);
  if (!allowed.length) allowed = allowedFromMailboxes(u, null);
  const normalized = (fromAddr || "").trim().toLowerCase();
  const matched = allowed.find((row) => row.email.toLowerCase() === normalized);
  if (matched) {
    return { email: matched.email, brand: matched.brand, allowed, matched: true };
  }
  const preferred = wanted ? allowed.find((row) => row.brand === wanted) : undefined;
  const pick = preferred || allowed[0];
  return {
    email: pick?.email || fromAddr,
    brand: pick?.brand || currentBrand,
    allowed,
    matched: false,
  };
}

function templateGateOk(skill: string, templateId: string, officialStage: string | null): boolean {
  const allowed = TEMPLATES[skill];
  const spec = templateById(templateId);
  if (allowed) {
    return Boolean(templateId && allowed.includes(templateId) && templateAllowedForStage(templateId, officialStage));
  }
  if (spec) return templateAllowedForStage(templateId, officialStage);
  // MCP compose drafts use `${skill}.v1` and are not in the Host catalog.
  return !templateId || templateId === `${skill}.v1`;
}

function ccOk(cc: string): boolean {
  return (cc || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => p.includes("@"));
}

export function enforceSend(draft: Row, user?: Persona | null, ccOverride?: string | null): Json {
  const u = user || currentUser();
  if (!u.exam_passed) {
    throw new PepFail("blocked_exam", 403, "学习考试未通过：数据安全与最小权限。未发送。", "打开「学习考试」通过后再试");
  }
  const fromAddr = String(draft.from_addr);
  const brand = brandOfMailbox(fromAddr);
  if (!brand) {
    throw new PepFail("blocked_permission", 403, "From 必须是品牌邮箱（LT/RO/PQ）。未发送。", "从授权下拉选择 From");
  }
  if (!(u.brands || []).includes(brand)) {
    throw new PepFail("blocked_permission", 403, "当前账号无权使用该品牌邮箱。未发送。", "切换授权邮箱或找管理员");
  }
  const toAddr = String(draft.to_addr || "").trim();
  if (!toAddr) {
    throw new PepFail("send_failed", 400, "To 为空。未发送。", "补充收件邮箱后再发");
  }
  if (draft.collaboration_id) {
    const row = getConn().prepare("SELECT email FROM collaborations WHERE id = ?").get(draft.collaboration_id) as
      | { email: string }
      | undefined;
    const bound = String(row?.email || "").trim();
    if (row && !bound) {
      getConn().prepare("UPDATE collaborations SET email=? WHERE id=?").run(toAddr, draft.collaboration_id);
    } else if (row && bound.toLowerCase() !== toAddr.toLowerCase()) {
      throw new PepFail("blocked_permission", 403, "To 必须是已绑定合作邮箱。未发送。", "回到该合作重开草稿");
    }
  }
  let body = String(draft.body_en || "");
  let subject = String(draft.subject || "");
  if (!subject.trim() || !body.trim()) {
    throw new PepFail("send_failed", 400, "主题或正文为空。未发送。", "补全 Subject / Body");
  }
  if (isMissingInputDraft(subject, body)) {
    throw new PepFail(
      "send_failed",
      400,
      "这不是可发送的催更邮件：正文在索要合作对象，而不是催大纲。未发送。",
      "指定红人或合作后重新催大纲",
    );
  }
  body = stripChinese(body);
  subject = stripChinese(subject);
  if (containsChinese(body)) {
    throw new PepFail("send_failed", 400, "SMTP 正文禁止中文。未发送。", "只用 English 原文");
  }
  const skill = String(draft.skill || "");
  if (!templateGateOk(skill, String(draft.template_id || ""), draft.official_stage ? String(draft.official_stage) : null)) {
    throw new PepFail("blocked_template", 400, "阶段模板不符，未发送", "用对应技能重新出草稿");
  }
  const cc = ccOverride != null ? ccOverride : String(draft.cc || "");
  const amount = draft.amount_usd as number | null | undefined;
  if (skill === "quote_confirm" && amount != null && amount < 350 && !ccOk(cc)) {
    throw new PepFail("missing_cc", 400, "金额 <$350 必须抄送上级 / 同站点 / 相关同事。未发送。", "在 Cc 填写内部同事后重试");
  }
  return {
    from_addr: fromAddr,
    brand,
    subject,
    body,
    cc,
    zh_stripped: true,
    keep_stage: true,
  };
}
