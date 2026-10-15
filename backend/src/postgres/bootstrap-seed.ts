import type { DatabaseConnection } from "../db.js";
import { nowIso } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { skillCatalog } from "../host/skills-catalog.js";
import type { Row } from "../types.js";
const MAIL_SKILLS = ["email_compose"] as const;
type QuestionTemplateSlot = "potential" | "risk" | "completeness" | "score";
const QUESTION_TEMPLATE_TAG_PREFIX = "pool-question:";
export async function seedDirectory(db: DatabaseConnection): Promise<void> {
  (await db.query("INSERT INTO orgs (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", ["org_litime","LiTime"]));
  (await db.query("INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", ["team_kol","org_litime","KOL 建联小队"]));
  (await db.query("INSERT INTO directory_users (id, handle, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", ["sriphy","sriphy","鄢棽","product_manager"]));
  (await db.query("INSERT INTO directory_users (id, handle, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", ["usr_lead","lead","陈组长","operator"]));
  (await db.query("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", ["mem_sriphy_org","sriphy","org","org_litime"]));
  (await db.query("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", ["mem_sriphy_team","sriphy","team","team_kol"]));
  // 2026-10-05 登录账户切换为黄启友：目录与范围行与「演示管理员」保持一致
  // （memberScopeIds 按 handle 取知识/技能范围；鄢棽原有行保留不动）。
  (await db.query("INSERT INTO directory_users (id, handle, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", ["jeffrey","jeffrey","黄启友","product_manager"]));
  (await db.query("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", ["mem_jeffrey_org","jeffrey","org","org_litime"]));
  (await db.query("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", ["mem_jeffrey_team","jeffrey","team","team_kol"]));
  (await db.query("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", ["mem_lead_org","lead","org","org_litime"]));
  (await db.query("INSERT INTO directory_users (id, handle, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", ["usr_lingong","lingong","林工","employee"]));
  (await db.query("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", ["mem_lingong_org","lingong","org","org_litime"]));
  const ts = nowIso();
  const ins = "INSERT INTO skill_grants (id, skill_id, scope, scope_id, granted_by, granted_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING";
  for (const s of await skillCatalog()) {
    (await db.query(ins, [`gr_org_${s.id}`,s.id,"org","org_litime","sriphy",ts]));
  }
}

export async function seedKnowledge(conn: DatabaseConnection): Promise<void> {
  const now = "2026-01-01T00:00:00.000Z";
  const actor = "system";
  const policies: Array<{
    id: string;
    title: string;
    body: string;
    tags: string;
    skill_id: string;
  }> = [
    {
      id: "kb_followup",
      title: "跟进信模板（阶段保持）",
      body: "Follow-up must keep official stage. Never imply a new commercial commitment. Sign with brand mailbox.",
      tags: "email_compose,policy",
      skill_id: "email_compose",
    },
    {
      id: "kb_quote",
      title: "报价信与审批带",
      body: "报价走写合作邮件。发送不等于改阶段。金额与审批在 Starry 邮件预览里由人确认。",
      tags: "email_compose,policy",
      skill_id: "email_compose",
    },
    {
      id: "kb_addr",
      title: "地址核验口径",
      body: "姓名/电话/完整地址/国家邮编/SKU/数量。齐全才可以出库。不调用 WMS。",
      tags: "email_compose,policy",
      skill_id: "email_compose",
    },
    {
      id: "kb_nudge",
      title: "内容催更门槛",
      body: "催大纲用写合作邮件。发送不等于改阶段。",
      tags: "email_compose,policy",
      skill_id: "email_compose",
    },
  ];
  const mails: Array<{
    id: string;
    title: string;
    skill_id: (typeof MAIL_SKILLS)[number];
    brand: string;
    subject: string;
    body_en: string;
    placeholders: string[];
    stage_codes: string[];
    tags: string;
  }> = [
    {
      id: "kb_mail_kol",
      title: "首封建联",
      skill_id: "email_compose",
      brand: "LT",
      subject: "LiTime Mini 12V — weekend van test",
      body_en:
        "Hi,\n\nWe would love to send a LiTime Mini 12V for a weekend van test. Happy to share the spec sheet whenever you have a slot.\n\nBest,\nLiTime Creator Desk\n",
      placeholders: ["[发件邮箱]", "[收件邮箱]", "[主题]"],
      stage_codes: ["INITIAL_CONTACT"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_followup",
      title: "阶段跟进",
      skill_id: "email_compose",
      brand: "LT",
      subject: "Following up — LiTime collab kit",
      body_en:
        "Hi,\n\nJust a quick follow-up on the LiTime collab kit we mentioned last week. Happy to share the spec sheet or a short unboxing angle whenever you have a slot.\n\nBest,\nLiTime Creator Desk\n",
      placeholders: ["[红人或合作]"],
      stage_codes: ["INITIAL_CONTACT", "INTERESTED"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_quote",
      title: "报价确认",
      skill_id: "email_compose",
      brand: "LT",
      subject: "LiTime collaboration quote — USD [金额USD] per hour",
      body_en:
        "Hi,\n\nPlease find the LiTime collaboration quote at USD [金额USD] per hour.\n\nReply to this thread if this rate works.\n\nBest,\nLiTime Creator Desk\n",
      placeholders: ["[红人]", "[金额USD]"],
      stage_codes: ["QUOTE_PENDING", "NEGOTIATING"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_addr",
      title: "地址催补",
      skill_id: "email_compose",
      brand: "LT",
      subject: "Need shipping details for the sample kit",
      body_en:
        "Hi,\n\nBefore we can ship the sample, please reply with your recipient name, phone, full address, country, postal code, SKU and quantity.\n\nBest,\nCreator Desk\n",
      placeholders: ["[红人或合作]"],
      stage_codes: ["SAMPLE_PENDING"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_nudge",
      title: "催大纲",
      skill_id: "email_compose",
      brand: "RO",
      subject: "Outline check-in — family camping power",
      body_en:
        "Hi,\n\nChecking in on the family camping power outline. A one-pager with shot list and publish window would help us lock the sample kit.\n\nBest,\nRenogy Creator Desk\n",
      placeholders: ["[红人或合作]"],
      stage_codes: ["TESTING", "CONTENT_PLANNING"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_ship",
      title: "发货通知",
      skill_id: "email_compose",
      brand: "LT",
      subject: "Sample shipped — [运单号]",
      body_en:
        "Hi,\n\nYour sample kit is on the way.\nTracking: [运单号]\nCarrier: [承运商]\n\nBest,\nCreator Desk\n",
      placeholders: ["[运单号]", "[承运商]"],
      stage_codes: ["SHIPPED"],
      tags: "email_compose,mail_template",
    },
  ];
  const questions: Array<{
    id: string;
    slot: QuestionTemplateSlot;
    title: string;
    body: string;
  }> = [
    {
      id: "kb_q_pool_potential",
      slot: "potential",
      title: "公海 · 高潜KOL分析提问模板",
      body: "请基于公开资料分析这些 KOL 的合作潜力，逐条说明判断依据与资料缺口。",
    },
    {
      id: "kb_q_pool_risk",
      slot: "risk",
      title: "公海 · 高风险KOL分析提问模板",
      body: "请基于公开资料分析这些 KOL 的合作风险，逐条说明判断依据与资料缺口。",
    },
    {
      id: "kb_q_pool_completeness",
      slot: "completeness",
      title: "公海 · 资料完整度检查提问模板",
      body: "请检查这些 KOL 的公开资料完整度，列出待补充项与补齐来源。",
    },
    {
      id: "kb_q_pool_score",
      slot: "score",
      title: "公海 · KOL评分提问模板",
      body: "请对这些 KOL 的公开资料做潜力/风险评分，说明口径、依据与置信度。",
    },
  ];

  // 演示语料属于分层迁移前的存量：与历史行一样归入默认结构化库（未分类/未分类/历史知识）。
  const base = (await conn.query<Row>("SELECT id FROM knowledge_bases WHERE kind='structured' AND status='active' ORDER BY CASE WHEN code='legacy' THEN 0 ELSE 1 END,id LIMIT 1")).rows[0];
  if (!base) throw new HttpFail(400, { code: "knowledge_base_required", message: "没有可用的结构化知识库" });
  const baseId = String(base.id);
  const upsert = "INSERT INTO knowledge\n     (id,title,body,tags,in_market,kind,skill_id,brand,lang,subject,body_en,placeholders,stage_codes,status,current_version,published_version,created_by,approved_by,approved_at,base_id,source_body,created_at,updated_at)\n     VALUES ($1,$2,$3,$4,1,$5,$6,$7, 'en', $8,$9,$10,$11,'published',1,1,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (id) DO NOTHING RETURNING id";
  const hasVersion = "SELECT 1 FROM knowledge_versions WHERE knowledge_id=$1 AND version=1";
  const insVer = "INSERT INTO knowledge_versions\n     (id,knowledge_id,version,title,body,subject,body_en,placeholders,stage_codes,skill_id,brand,lang,kind,status,created_by,created_at,note)\n     VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,'en',$11,'published',$12,$13,$14)";

  for (const p of policies) {
    const inserted = await conn.query(upsert, [p.id,p.title,p.body,p.tags,"policy",p.skill_id,"*","","","[]","[]",actor,actor,now,baseId,p.body,now,now]);
    if (!inserted.rowCount) continue;
    if (!(await conn.query(hasVersion, [p.id])).rows[0]) {
      (await conn.query(insVer, [`kv_${p.id}_1`,p.id,p.title,p.body,"","","[]","[]",p.skill_id,"*","policy",actor,now,"seed policy v1"]));
    }
  }
  for (const m of mails) {
    const inserted = await conn.query(upsert, [m.id,m.title,m.body_en,m.tags,"mail_template",m.skill_id,m.brand,m.subject,m.body_en,JSON.stringify(m.placeholders),JSON.stringify(m.stage_codes),actor,actor,now,baseId,m.body_en,now,now]);
    if (!inserted.rowCount) continue;
    if (!(await conn.query(hasVersion, [m.id])).rows[0]) {
      (await conn.query(insVer, [`kv_${m.id}_1`,m.id,m.title,m.body_en,m.subject,m.body_en,JSON.stringify(m.placeholders),JSON.stringify(m.stage_codes),m.skill_id,m.brand,"mail_template",actor,now,"seed mail_template v1"]));
    }
  }
  for (const q of questions) {
    const inserted = await conn.query(upsert, [q.id,q.title,q.body,`${QUESTION_TEMPLATE_TAG_PREFIX}${q.slot},kol-pool`,"question_template","","*","","","[]","[]",actor,actor,now,baseId,q.body,now,now]);
    if (!inserted.rowCount) continue;
    if (!(await conn.query(hasVersion, [q.id])).rows[0]) {
      (await conn.query(insVer, [`kv_${q.id}_1`,q.id,q.title,q.body,"","","[]","[]","","*","question_template",actor,now,"seed question v1"]));
    }
  }
}
