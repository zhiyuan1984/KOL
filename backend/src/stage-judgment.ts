import { BY_CODE, MAIN_STAGES, normalizeStage } from "./stages.js";

export type EvidenceSource = "body" | "attachment" | "fulfillment" | "subject";

export type StageJudgment = {
  suggested_stage: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  evidence: { source: EvidenceSource; snippet: string }[];
  flags: string[];
  auto_propose: boolean;
};

export type StageJudgmentInput = {
  subject?: string;
  body?: string;
  attachments?: string[];
  links?: string[];
  fulfillment?: Record<string, unknown> | null;
  current_stage?: string | null;
};

const WEIGHT: Record<EvidenceSource, number> = {
  body: 4,
  attachment: 3,
  fulfillment: 2,
  subject: 1,
};

type Hit = { stage: string | null; source: EvidenceSource; snippet: string; flag?: string; block?: boolean };

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text || "");
}

function snippet(text: string, pattern: RegExp): string {
  const match = pattern.exec(text || "");
  return (match?.[0] || "").slice(0, 80);
}

function collect(input: StageJudgmentInput): Hit[] {
  const subject = String(input.subject || "");
  const body = String(input.body || "");
  const attach = [...(input.attachments || []), ...(input.links || [])].join("\n");
  const fulfillmentBlob = JSON.stringify(input.fulfillment || {});
  const hits: Hit[] = [];

  const add = (source: EvidenceSource, text: string) => {
    if (!text.trim()) return;
    if (has(text, /\bthank you for (your )?email\b|\bthanks for reaching out\b|^thanks\.?$|^thank you\.?$/i)
      && !has(text, /interested|would love|open to|keen to|happy to collaborate/i)) {
      hits.push({ stage: null, source, snippet: snippet(text, /thank you|thanks/i), flag: "thank_you_only", block: true });
    }
    if (has(text, /not available now|open later|revisit later|maybe next (quarter|month)/i)) {
      hits.push({ stage: "PAUSED", source, snippet: snippet(text, /later|revisit|next/i), flag: "later_not_reject" });
    } else if (has(text, /not interested|unable to collaborate|\bpass\b|decline|not a fit|fully booked/i)) {
      hits.push({ stage: "REJECTED", source, snippet: snippet(text, /not interested|decline|pass|not a fit/i) });
    }
    if (has(text, /on hold|pause|collaboration on hold|not available this month/i)) {
      hits.push({ stage: "PAUSED", source, snippet: snippet(text, /on hold|pause/i) });
    }
    if (has(text, /\bcancel\b|terminate|cancellation|no longer proceed|refund|return product/i)) {
      hits.push({ stage: "CANCELLED", source, snippet: snippet(text, /cancel|terminate|refund/i) });
    }
    if (has(text, /delay|postponed|need more time|reschedule|family emergency|unable to publish/i)) {
      hits.push({ stage: null, source, snippet: snippet(text, /delay|postponed|emergency|reschedule/i), flag: "delay_care", block: true });
    }
    if (has(text, /haven[’']t heard back|no response|just wanted to reconnect|checking in/i)) {
      hits.push({ stage: null, source, snippet: snippet(text, /heard back|no response|checking in/i), flag: "lost_contact" });
    }
    if (has(text, /revision pending|changes not completed|missing update|incorrect information/i)) {
      hits.push({ stage: "CONTENT_REVIEW", source, snippet: snippet(text, /revision|missing update/i), flag: "revision_pending" });
    }
    if (has(text, /affiliate|commission|impact|referral program|creator code|tracking link/i)) {
      hits.push({ stage: null, source, snippet: snippet(text, /affiliate|commission|creator code/i), flag: "affiliate" });
    }
    if (has(text, /usage permission|whitelisting|paid ads|licensing fee|content usage/i)) {
      hits.push({ stage: null, source, snippet: snippet(text, /usage|whitelisting|licensing/i), flag: "content_license" });
    }
    if (has(text, /repeat collaboration|new campaign|returning creator|long-term partnership/i)) {
      hits.push({ stage: null, source, snippet: snippet(text, /repeat|new campaign|returning/i), flag: "repeat_collab" });
    }
    if (has(text, /payment sent|payment processed|\bpaid\b|transaction id/i)) {
      hits.push({ stage: "SETTLING", source, snippet: snippet(text, /payment sent|processed|\bpaid\b/i), flag: "paid" });
    } else if (has(text, /invoice received|amount due|please find (the )?invoice/i)) {
      hits.push({ stage: "SETTLING", source, snippet: snippet(text, /invoice|amount due/i), flag: "invoice_unpaid" });
    }
    if (has(text, /\bnow live\b|\bis live\b|published|posted|video is up|content is live/i)
      || /https?:\/\/\S+/.test(text) && has(text, /youtube|instagram|tiktok|xiaohongshu/i)) {
      hits.push({ stage: "PUBLISHED", source, snippet: snippet(text, /live|published|posted|https?:\/\//i) });
    }
    if (has(text, /scheduled|go live|embargo|publishing schedule|posting date/i)
      && !has(text, /\bnow live\b|published|posted/i)) {
      hits.push({ stage: "PUBLISH_PENDING", source, snippet: snippet(text, /scheduled|embargo|posting date/i) });
    }
    if (has(text, /draft|rough cut|preview|revision|requested changes|content review/i)) {
      hits.push({ stage: "CONTENT_REVIEW", source, snippet: snippet(text, /draft|revision|preview/i) });
    }
    if (has(text, /content brief|talking points|storyboard|filming plan|brand guideline/i)) {
      hits.push({ stage: "CONTENT_PLANNING", source, snippet: snippet(text, /brief|talking points|storyboard/i) });
    }
    if (has(text, /received|arrived|delivered|testing|installation|trial/i)) {
      hits.push({ stage: "TESTING", source, snippet: snippet(text, /received|arrived|testing/i) });
    }
    if (has(text, /shipped|dispatched|tracking number|UPS|FedEx|DHL/i)) {
      hits.push({ stage: "SHIPPED", source, snippet: snippet(text, /shipped|tracking|UPS|FedEx|DHL/i) });
    }
    if (has(text, /shipping address|address confirmation|ZIP code|sample shipping/i)) {
      hits.push({ stage: "SAMPLE_PENDING", source, snippet: snippet(text, /address|ZIP|sample shipping/i) });
    }
    if (has(text, /agreement|contract|docusign|signed|signature|nda/i)) {
      hits.push({ stage: "CONTRACTING", source, snippet: snippet(text, /agreement|contract|signed|docusign/i) });
    }
    if (has(text, /please confirm|final terms|move forward|proceed/i)
      && !has(text, /\bconfirmed\b|\bagreed\b/i)) {
      hits.push({ stage: "PLAN_PENDING", source, snippet: snippet(text, /please confirm|final terms/i), flag: "please_confirm" });
    }
    if (has(text, /\bconfirmed\b|\bagreed\b|agreed rate|final rate/i)) {
      hits.push({ stage: "CONTRACTING", source, snippet: snippet(text, /confirmed|agreed/i) });
    }
    if (has(text, /counteroffer|revised rate|negotiate|within budget|best rate/i)) {
      hits.push({ stage: "NEGOTIATING", source, snippet: snippet(text, /counteroffer|negotiate|revised rate/i) });
    }
    if (has(text, /rate card|collaboration rates|share your .*rate|pricing|quote|fee|compensation/i)
      && !has(text, /confirmed|agreed rate/i)) {
      hits.push({ stage: "QUOTE_PENDING", source, snippet: snippet(text, /rate|quote|pricing|fee/i) });
    }
    if (has(text, /media kit|audience demographics|channel statistics|average views|engagement rate/i)) {
      hits.push({ stage: "EVALUATING", source, snippet: snippet(text, /media kit|demographics|statistics/i) });
    }
    if (has(text, /interested|would love to|open to|happy to collaborate|keen to|tell me more/i)
      || has(text, /有兴趣|愿意合作|希望合作|想要?合作|合作意向|想和.{0,24}合作/)) {
      hits.push({
        stage: "INTERESTED",
        source,
        snippet: snippet(text, /interested|would love|open to|keen|有兴趣|愿意合作|希望合作|想要?合作|合作意向|想和.{0,24}合作/i),
      });
    }
  };

  add("body", body);
  add("attachment", attach);
  add("fulfillment", fulfillmentBlob);
  add("subject", subject);

  const tracking = String(input.fulfillment?.tracking || input.fulfillment?.tracking_number || "");
  if (tracking) {
    hits.push({ stage: "SHIPPED", source: "fulfillment", snippet: `tracking ${tracking}` });
  }
  const publicUrl = String(input.fulfillment?.public_url || input.fulfillment?.live_url || "");
  if (publicUrl) {
    hits.push({ stage: "PUBLISHED", source: "fulfillment", snippet: publicUrl.slice(0, 80) });
  }
  return hits;
}

export function judgeCollaborationStage(input: StageJudgmentInput): StageJudgment {
  const hits = collect(input);
  const flags = [...new Set(hits.map((hit) => hit.flag).filter(Boolean) as string[])];
  const usable = hits.filter((hit) => !hit.block && hit.stage);
  usable.sort((a, b) => WEIGHT[b.source] - WEIGHT[a.source]);
  const best = usable[0];
  const subjectOnly = Boolean(best && best.source === "subject" && !hits.some((hit) => hit.source !== "subject" && hit.stage));
  const blocked = hits.find((hit) => hit.block);

  if (blocked && (blocked.flag === "thank_you_only" || blocked.flag === "delay_care")) {
    return {
      suggested_stage: null,
      confidence: "high",
      reason: blocked.flag === "thank_you_only"
        ? "仅回复感谢或已读，不能识别为有兴趣。"
        : "延期/私人突发应进入关怀型处理，不直接判定违约。",
      evidence: hits.slice(0, 4).map((hit) => ({ source: hit.source, snippet: hit.snippet })),
      flags,
      auto_propose: false,
    };
  }

  if (!best || subjectOnly) {
    return {
      suggested_stage: null,
      confidence: "low",
      reason: subjectOnly
        ? "不要只根据邮件主题判断。正文明确动作优先于主题。"
        : "证据不足，请人选阶段。",
      evidence: hits.slice(0, 4).map((hit) => ({ source: hit.source, snippet: hit.snippet })),
      flags,
      auto_propose: false,
    };
  }

  const suggested = normalizeStage(best.stage as string);
  const current = input.current_stage ? normalizeStage(input.current_stage) : "";
  const known = Boolean(BY_CODE[suggested]);
  const confidence: StageJudgment["confidence"] =
    best.source === "body" || best.source === "attachment" ? "high" : best.source === "fulfillment" ? "medium" : "low";
  const mainIndex = MAIN_STAGES.findIndex((stage) => stage.code === suggested);
  const currentIndex = MAIN_STAGES.findIndex((stage) => stage.code === current);
  const skipAhead = currentIndex >= 0 && mainIndex > currentIndex + 1;
  return {
    suggested_stage: known ? suggested : null,
    confidence: skipAhead ? "medium" : confidence,
    reason: skipAhead
      ? `正文支持 ${suggested}，但相对当前阶段跳档，需人工确认。`
      : `按权重（正文 > 附件和链接 > 履约字段 > 主题）识别为 ${suggested}。`,
    evidence: hits.filter((hit) => hit.stage === best.stage || hit.flag).slice(0, 5)
      .map((hit) => ({ source: hit.source, snippet: hit.snippet })),
    flags,
    auto_propose: confidence === "high" && !skipAhead && !flags.includes("please_confirm") && known
      && suggested !== "REJECTED" && suggested !== "CANCELLED",
  };
}
