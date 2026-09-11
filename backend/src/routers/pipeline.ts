import { Hono } from "hono";
import { requireConnector } from "../auth.js";
import { getConn } from "../db.js";
import { collabActions } from "../host/kol-journey.js";
import { restoreOfficialCollaborationStage } from "../starrykol/library-sync.js";
import { BY_CODE, MAIN_STAGES, PIPELINE_COLUMNS, SIDE_STAGES, coarse, label, normalizeStage } from "../stages.js";
import type { Json, Row } from "../types.js";

export const pipeline = new Hono();

pipeline.get("/pipeline", (c) => {
  requireConnector("starry", "read");
  requireConnector("starry", "read");
  const rows = getConn().prepare("SELECT * FROM collaborations").all() as Row[];
  const cols: Record<string, Json[]> = Object.fromEntries(PIPELINE_COLUMNS.map((col) => [col, []]));
  const ledger: Json[] = [];
  for (const r of rows) {
    restoreOfficialCollaborationStage(r);
    const card = {
      ...r,
      stage_label: label(String(r.stage_code)),
      coarse: coarse(String(r.stage_code)),
      capability_domain: BY_CODE[normalizeStage(String(r.stage_code))]?.domain || null,
      advancement_mode: BY_CODE[normalizeStage(String(r.stage_code))]?.advancementMode || null,
      actions: collabActions(r),
      exception: !BY_CODE[normalizeStage(String(r.stage_code))]?.main,
    };
    const bucket = coarse(String(r.stage_code));
    if (bucket == null) ledger.push(card);
    else cols[bucket].push(card);
  }
  return c.json({
    columns: PIPELINE_COLUMNS,
    stages: MAIN_STAGES.map((stage) => ({
      code: stage.code,
      label: stage.label,
      domain: stage.domain,
      advancement_mode: stage.advancementMode,
    })),
    side_stages: SIDE_STAGES.map((stage) => ({
      code: stage.code,
      label: stage.label,
      advancement_mode: stage.advancementMode,
    })),
    groups: cols,
    exceptions: ledger,
    exception_filter: Boolean(Number(c.req.query("exception") || 0)),
    note: "主流程按 15 个正式阶段里程碑对齐；异常 KOL（暂停、流失、拒绝、取消、争议、已完成）单独筛选。",
  });
});
