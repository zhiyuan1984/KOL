/**
 * CODEX_MODE=stub：仅测试/CI。
 * 仍按 Dify 线走：initialize → extraRoots → skills/config/write → thread/start → turn/start。
 * 读数走 MCP callMcpTool（不直接调 claw/starry HTTP，也不藏成业务函数）。
 * 禁止 sendDraft / sendConversation。
 */
import fs from "node:fs";
import path from "node:path";
import { callMcpTool } from "../../mcp/tools.js";
import { writeBoxCodexConfig } from "../../mcp/codex-config.js";
import { boxDir } from "../config.js";
import { runtimeSkillsRoot, writeRuntimeSkill, writeSkillIntoBox } from "../host/skill-sop.js";
import { audit } from "../db.js";
import { nid } from "../ids.js";
import { profileFor } from "../profiles.js";
import { groupedStageTracks, label, legalTargets, stageChecklist } from "../stages.js";
import type { Json, WorkerResult } from "../types.js";
import { writeAttachmentContext } from "../host/attachments.js";
import { workerSafeExtra } from "../host/knowledge.js";
import { suggestFollowStyleTags, readFollowStyleTags } from "../follow-style-tags.js";
import { approvalBoxGuardrails, persistWorker } from "./common.js";
import { judgeCollaborationStage, type StageJudgmentInput } from "../stage-judgment.js";
import { requireTaskDefinition } from "../tasks/registry.js";
import { expenseFactsFromWorkerItem, hintRequesterFromOrg, readExpenseFactsFromText } from "../approval/plan.js";
import { isSopSkill, isStageSopSkill } from "../sops.js";
import { isEmailMcpTask } from "../starrykol/service.js";
import { isKolClawTask } from "../kolclaw/service.js";
import { collectDealMemoryItems, collectSopItems, collectStageSopItems, completeTurnItems } from "./session-items.js";
import type { WorkerProgress } from "./progress.js";

function attachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const row = item as Json;
      return String(row.name || row.url || row.path || "");
    }
    return "";
  }).filter(Boolean);
}

function judgmentInput(extra: Json, evidence: Json = {}, current?: string | null): StageJudgmentInput {
  return {
    subject: String(extra.subject || evidence.subject || ""),
    body: String(extra.text || extra.raw || extra.body || extra.snippet || evidence.notes || evidence.last_message || ""),
    attachments: attachmentNames(extra.attachments),
    links: Array.isArray(extra.links) ? extra.links.map(String) : [],
    fulfillment: extra.fulfillment && typeof extra.fulfillment === "object"
      ? extra.fulfillment as Record<string, unknown>
      : null,
    current_stage: current || (evidence.stage_code ? String(evidence.stage_code) : null),
  };
}

function writeBox(wid: string, skill: string, prompt: string, extra: Json): string {
  const profile = profileFor(skill);
  const definition = requireTaskDefinition(skill);
  fs.mkdirSync(boxDir(), { recursive: true });
  const box = path.join(boxDir(), wid);
  fs.mkdirSync(box, { recursive: true });
  writeSkillIntoBox(box, skill);
  fs.writeFileSync(
    path.join(box, "CONTEXT.md"),
    `# CONTEXT\n\nprofile: ${profile.name}\nskill: ${skill}\nprompt: ${prompt}\nextra: ${JSON.stringify(workerSafeExtra(extra))}\n`,
    "utf8",
  );
  writeAttachmentContext(box, extra);
  fs.writeFileSync(
    path.join(box, "AGENTS.md"),
    [
      `# 灵工 Codex Profile · ${profile.name}`,
      "所有 Profile 共用同一 Codex app-server harness，不是独立运行时。",
      "读数用 MCP starry.* / claw.*。禁止裸 HTTP。",
      "只写 Item JSON。无 SMTP / WeCom secret / 阶段库凭据。",
      ...(skill === "business_approval" ? approvalBoxGuardrails() : []),
    ].join("\n") + "\n",
    "utf8",
  );
  writeBoxCodexConfig(box, definition.mcp);
  return box;
}

function mcp(log: Json[], server: "starry" | "claw", name: string, args: Json = {}): Json {
  log.push({ method: "mcp/tool/call", params: { server, name } });
  return callMcpTool(server, name, args);
}

function collab(log: Json[], handle?: string | null): Json {
  const row = mcp(log, "starry", "get_collaboration", { handle: handle || "" });
  if (row.found === false) return {};
  return row;
}

function listOverdue(log: Json[]): Json {
  const rows = mcp(log, "claw", "list_overdue", {});
  return {
    type: "list_overdue",
    items: rows.items || [],
  };
}

const TASK_TITLES: Record<string, string> = {
  creator_discovery: "达人发现结果",
  creator_profile: "达人画像",
  creator_scoring: "达人评分",
  reply_analysis: "回复分析",
  deal_memory: "Deal Memory",
  risk_scan: "在途风险扫描",
};

function genericResult(log: Json[], skill: string, col: Json, extra: Json = {}): Json {
  let evidence = col;
  if (["creator_discovery", "creator_profile", "creator_scoring"].includes(skill)) {
    evidence = mcp(log, "claw", "get_creators", {});
  } else if (skill === "risk_scan") {
    evidence = mcp(log, "starry", "list_collaborations", {});
  } else if (!Object.keys(evidence).length) {
    const hinted = String(extra.handle || col.handle || "");
    evidence = hinted ? collab(log, hinted) : {};
  }
  const handle = String(evidence.handle || col.handle || "当前 KOL 组合");
  const title = TASK_TITLES[skill] || `${skill} 结果`;
  const records = Array.isArray(evidence.items)
    ? evidence.items as Json[]
    : Array.isArray(evidence.creators)
      ? evidence.creators as Json[]
      : Object.keys(evidence).length ? [evidence] : [];
  const evidenceItems = records.slice(0, 5).map((record) => {
    const name = String(record.handle || record.name || record.title || record.stage_label || "业务记录");
    const detail = String(record.stage_label || record.status || record.platform || record.days || "").trim();
    return detail ? `${name} · ${detail}` : name;
  });
  if (skill === "creator_discovery") {
    const entities = extra.entities && typeof extra.entities === "object" ? extra.entities as Json : {};
    return {
      type: "crawl_plan",
      title: "达人采集计划",
      summary: "请确认平台、采集模式和参数后再启动；当前尚未发起远程采集。",
      platform: String(entities.platform || ""),
      mode: "search",
      keywords: Array.isArray(entities.keywords) ? entities.keywords : [],
      specified_ids: [],
      creator_ids: [],
      parameters_hint: "search 需要 keywords；detail 需要 specified_ids；creator 需要 creator_ids",
      requires_confirmation: true,
    };
  }
  if (skill === "creator_profile" || skill === "creator_scoring") {
    return {
      type: "task_result",
      title,
      summary: `已基于 ${records.length} 条真实采集或持久化记录生成结果。`,
      sections: [{
        title: skill === "creator_scoring" ? "候选推荐" : "达人资料",
        body: "仅使用平台 ID、昵称、粉丝与最近播放；未推测互动、转化或邮箱。",
        items: records.slice(0, 10).map((record) =>
          `${record.platform || "unknown"}:${record.platform_creator_id || record.id} · ${record.nickname || record.name || record.handle} · score ${record.score || 0}`,
        ),
      }],
      metrics: [{ label: "候选数", value: String(records.length), detail: "真实持久化记录" }],
      recommended_actions: ["复核基础评分", "补充并核验联系方式（contact-needed）"],
      contact_needed: true,
    };
  }
  if (skill === "reply_analysis") {
    const current = String(evidence.stage_code || col.stage_code || "INITIAL_CONTACT");
    const judgment = judgeCollaborationStage(judgmentInput(extra, evidence, current));
    const exception = judgment.flags.includes("delay_care")
      ? "延期"
      : judgment.flags.includes("lost_contact")
        ? "失联"
        : null;
    const completed = judgment.suggested_stage && judgment.suggested_stage !== current
      ? [judgment.suggested_stage]
      : [];
    const checklist = stageChecklist(current, completed, { evidenced: completed, exception });
    const handle = String(evidence.handle || col.handle || "");
    const suggested = suggestFollowStyleTags(String(extra.raw || extra.text || judgment.reason || ""), readFollowStyleTags(col));
    return {
      type: "task_result",
      title,
      summary: judgment.reason,
      sections: [
        {
          title: "十五阶段清单",
          body: "权重：正文明确动作 > 附件和链接 > 履约字段 > 邮件主题。不自动写入正式阶段。",
          items: checklist.map((row) => `${row.label}：${row.status}${row.note ? ` · ${row.note}` : ""}`),
        },
        {
          title: "当前指针",
          items: [
            `建议阶段：${judgment.suggested_stage || "无法判断，请人选"}`,
            `置信度：${judgment.confidence}`,
            ...(judgment.flags.length ? [`标记：${judgment.flags.join("、")}`] : []),
          ],
        },
        ...(suggested.length ? [{
          title: "建议跟进标签",
          items: suggested.map((tag) => `${tag.reason ? `${tag.reason}，` : ""}建议打上「${tag.label}」。不改正式阶段。`),
        }] : []),
      ],
      metrics: [{ label: "自动推进", value: "否", detail: "发送 ≠ 推进阶段" }],
      recommended_actions: exception === "延期"
        ? ["延期关怀"]
        : exception === "失联"
          ? ["失联跟进"]
          : [
            handle ? `写合作邮件 @${handle}` : "写合作邮件",
            "提出阶段变更",
            ...suggested.slice(0, 1).map((tag) => handle ? `给 @${handle} 打标签 ${tag.label}` : `打标签 ${tag.label}`),
          ],
      suggested_follow_tags: suggested,
      judgment,
      checklist,
    };
  }
  return {
    type: "task_result",
    title,
    summary: `${title}已基于只读业务数据完成，未发送消息、未修改正式阶段或业务记录。`,
    sections: [
      {
        title: "关键发现",
        body: `已检查 ${handle} 的当前资料、阶段证据与执行约束。`,
        items: ["证据与建议已分离", "敏感写操作保持待人工确认"],
      },
      {
        title: "判断依据",
        body: `共读取 ${records.length || 1} 条只读业务记录，并按当前 Skill 的规则完成判断。`,
        items: evidenceItems.length ? evidenceItems : [`已核验 ${handle} 的当前业务上下文`],
      },
    ],
    metrics: [
      { label: "置信度", value: "0.86", detail: "基于当前可用证据" },
      { label: "已复核记录", value: String(records.length || 1), detail: "只读业务数据" },
    ],
    recommended_actions: ["复核证据", "按建议创建后续人工确认任务"],
  };
}

function stageProposal(log: Json[], col: Json, extra: Json = {}): Json {
  const c = Object.keys(col).length ? col : collab(log, String(col.handle || extra.handle || ""));
  const current = String(c.stage_code || "INITIAL_CONTACT");
  const entities = extra.entities && typeof extra.entities === "object" ? extra.entities as Json : {};
  const hinted = String(entities.proposed_stage || extra.proposed_stage || "").trim();
  const operatorReason = String(entities.reason || extra.reason || "").trim();
  const judgment = judgeCollaborationStage(judgmentInput(extra, c, current));
  const completed = judgment.suggested_stage && judgment.suggested_stage !== current
    ? [judgment.suggested_stage]
    : [];
  const legal = legalTargets(current);
  const proposed = (hinted && legal.includes(hinted)
    ? hinted
    : (judgment.suggested_stage && legal.includes(judgment.suggested_stage)
      ? judgment.suggested_stage
      : legal[0])) || current;
  return {
    type: "propose_stage",
    collaboration_id: c.id,
    current_stage: current,
    proposed_stage: proposed,
    tracks: groupedStageTracks(current, proposed),
    evidence: {
      source: "skill",
      summary: operatorReason || judgment.reason || `只读证据支持从 ${label(current)}评估推进至 ${label(proposed)}`,
      weight: ["body", "attachment", "fulfillment", "subject"],
      hits: judgment.evidence,
      completed,
    },
    reason: operatorReason || judgment.reason || "基于当前合作记录提出候选阶段；等待人工确认。",
    auto_propose: false,
    flags: judgment.flags,
  };
}

/** Stub stand-in for business_approval/SKILL.md NLU. Real Codex follows the Skill. */
function stubFollowSkillNlu(prompt: string): { amount?: number; currency?: string; requester_name?: string; purpose?: string } {
  return readExpenseFactsFromText(prompt);
}

function stubExpenseItem(extra: Json): Json {
  const prompt = String(extra.raw || extra.text || extra.prompt || "");
  const entities = extra.entities && typeof extra.entities === "object" ? extra.entities as Json : {};
  const fromExtra = expenseFactsFromWorkerItem({
    ...entities,
    amount: extra.amount ?? entities.amount,
    currency: extra.currency ?? entities.currency,
    requester_name: extra.requester_name ?? entities.requester_name,
    requester_id: extra.requester_id ?? entities.requester_id,
    mailbox: extra.mailbox ?? entities.mailbox,
    purpose: extra.purpose ?? entities.purpose,
  });
  const simulated = stubFollowSkillNlu(prompt);
  const hinted = hintRequesterFromOrg(prompt);
  return {
    type: "create_approval",
    skill: "business_approval",
    business_type: "marketing_expense",
    amount: fromExtra.amount ?? simulated.amount,
    currency: fromExtra.currency || simulated.currency || "CNY",
    requester_name: fromExtra.requester_name || simulated.requester_name || hinted?.name,
    requester_id: fromExtra.requester_id || hinted?.id,
    purpose: fromExtra.purpose || simulated.purpose,
  };
}

async function produceItems(
  log: Json[],
  skill: string,
  extra: Json,
  onProgress?: (progress: WorkerProgress) => void,
): Promise<Json[]> {
  const handle = extra.handle as string | undefined;
  const col = handle ? collab(log, handle) : {};
  if (skill === "confirm_stage") return [stageProposal(log, col, extra)];
  if (skill === "deal_memory") return collectDealMemoryItems(col, String(handle || col.handle || ""));
  if (isStageSopSkill(skill)) {
    return collectStageSopItems(String(extra.stage_code || extra.stage || col.stage_code || "INITIAL_CONTACT"), String(handle || col.handle || extra.handle || ""));
  }
  if (isSopSkill(skill)) return collectSopItems(skill);
  if (isEmailMcpTask(skill) || isKolClawTask(skill)) {
    return completeTurnItems(skill, extra, [], log, onProgress);
  }
  if (skill === "risk_scan") return [genericResult(log, skill, col, extra), listOverdue(log)];
  if (skill === "business_approval") {
    return [stubExpenseItem(extra)];
  }
  return [genericResult(log, skill, col, extra)];
}

export async function runStub(
  sessionId: string,
  skill: string,
  prompt: string,
  extra: Json = {},
  onProgress?: (progress: WorkerProgress) => void,
): Promise<WorkerResult> {
  const wid = nid("wrk");
  const profile = profileFor(skill);
  const log: Json[] = [];
  log.push({ method: "initialize", params: { protocol: "codex-app-server", worker_id: wid } });
  log.push({ method: "profile/select", params: { id: profile.id, name: profile.name, harness: profile.harness } });
  log.push({ method: "model/tier", params: { tier: extra.model_tier || "balanced" } });
  const box = writeBox(wid, skill, prompt, extra);
  const skillPath = writeRuntimeSkill(skill);
  const skillsRoot = runtimeSkillsRoot();
  log.push({ method: "skills/extraRoots/set", params: { extraRoots: [skillsRoot] } });
  log.push({ method: "skills/config/write", params: { path: skillPath, enabled: true } });
  log.push({ method: "mcp_servers", params: { names: ["starry", "claw"] } });
  log.push({ method: "thread/start", params: { resume: false, mcp: ["starry", "claw"] } });
  log.push({ method: "turn/start", params: { prompt, skill } });
  const items = await produceItems(log, skill, { ...extra, raw: extra.raw || extra.text || prompt, text: extra.text || prompt }, onProgress);
  audit("worker", "skill.invoked", {
    session_id: sessionId, worker_id: wid, skill, profile: profile.id,
  });
  log.push({ method: "turn/completed", params: { items: items.map((i) => i.type) } });
  for (const i of items) {
    if (["send_mail", "wecom_send", "confirm_stage", "starry_stage"].includes(String(i.type))) {
      throw new Error("worker must not emit send/stage/wecom items");
    }
  }
  const result: WorkerResult = {
    worker_id: wid,
    status: "done",
    skill,
    profile_id: profile.id,
    turn_id: `turn_${wid}`,
    contract_log: log,
    items,
    box_path: box,
  };
  persistWorker(result, sessionId);
  audit("worker", "skill.result", {
    session_id: sessionId,
    worker_id: wid,
    skill,
    profile: profile.id,
    item_types: items.map((item) => String(item.type)),
  });
  return result;
}
