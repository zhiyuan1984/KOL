import { Hono } from "hono";
import { scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { brandScope, leaderMemberUserIds } from "../host/inbound-scope.js";
import { nid } from "../ids.js";
import { requireTicketPrincipal, ticketIsAdmin } from "../ticket-domain/auth.js";
import {
  convertKolLead, createKolCooperation, createKolLead, kolCooperationDetail, kolLeadDetail,
  listKolCooperations, listKolLeads, updateKolCooperation, updateKolLead,
  type KolConvertInput, type KolCooperationInput, type KolLeadInput,
} from "../ticket-domain/kol-leads.js";
import { recordCooperationEvent, recordLeadEvent, type CoopEventInput, type LeadEventInput } from "../ticket-domain/kol-event-bridge.js";

/** KOL 线索 / 合作项目 router。PostgreSQL only；不碰 db.ts 与 legacy /tasks。 */
export const kol = new Hono();

kol.onError((error, c) => {
  if (error instanceof HttpFail) {
    return c.json({ detail: error.detail }, error.status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503);
  }
  console.error(error);
  return c.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
});

function meta() {
  return { request_id: nid("req"), as_of: new Date().toISOString(), schema_version: "kol-api.v1" };
}
function parseLimit(raw: string | undefined, fallback = 50): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) throw new HttpFail(400, "invalid limit");
  return Math.min(100, Math.floor(n));
}
function parseOffset(raw: string | undefined): number {
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new HttpFail(400, "invalid offset");
  return Math.floor(n);
}
function actor() {
  const principal = requireTicketPrincipal();
  return { id: principal.id, isAdmin: ticketIsAdmin(principal) };
}

kol.post("/kol/leads", async (c) => {
  const { id, isAdmin } = actor();
  const body = await c.req.json().catch(() => ({})) as KolLeadInput;
  const result = await createKolLead(id, isAdmin, body, { actorBrands: brandScope(scopedUser()) });
  return c.json({ ...result, ...meta() }, 201);
});

kol.get("/kol/leads", async (c) => {
  const { id, isAdmin } = actor();
  const page = await listKolLeads(id, isAdmin, {
    stage: c.req.query("stage"), source: c.req.query("source"), owner: c.req.query("owner"),
    mine: c.req.query("mine") === "1" || c.req.query("mine") === "true",
    search: c.req.query("search"),
    limit: parseLimit(c.req.query("limit")), offset: parseOffset(c.req.query("offset")),
  }, { leaderMemberIds: leaderMemberUserIds(scopedUser()) });
  return c.json({ ...page, ...meta() });
});

kol.get("/kol/leads/:id", async (c) => {
  const { id, isAdmin } = actor();
  return c.json({
    ...(await kolLeadDetail(id, isAdmin, c.req.param("id"), { leaderMemberIds: leaderMemberUserIds(scopedUser()) })),
    ...meta(),
  });
});

kol.patch("/kol/leads/:id", async (c) => {
  const { id, isAdmin } = actor();
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  return c.json({ ...(await updateKolLead(id, isAdmin, c.req.param("id"), body)), ...meta() });
});

kol.post("/kol/leads/:id/convert", async (c) => {
  const { id, isAdmin } = actor();
  const body = await c.req.json().catch(() => ({})) as KolConvertInput;
  const result = await convertKolLead(id, isAdmin, c.req.param("id"), body);
  return c.json({ ...result, ...meta() }, 201);
});

/** 手动/定时生产者入口：在线索 Task 上记录已核验业务事件（达人回复/跟进到期/索要样品/意向确认/高潜）。 */
kol.post("/kol/leads/:id/lead-events", async (c) => {
  const { id, isAdmin } = actor();
  const body = await c.req.json().catch(() => ({})) as LeadEventInput;
  const result = await recordLeadEvent(id, isAdmin, c.req.param("id"), body);
  return c.json({ ...result, ...meta() }, 202);
});

/** 手动/定时生产者入口：在合作项目 Task 上记录已核验业务事件（合同/样品/脚本/排期/拍摄/验收/发布/结算/异常）。 */
kol.post("/kol/cooperations/:id/coop-events", async (c) => {
  const { id, isAdmin } = actor();
  const body = await c.req.json().catch(() => ({})) as CoopEventInput;
  const result = await recordCooperationEvent(id, isAdmin, c.req.param("id"), body);
  return c.json({ ...result, ...meta() }, 202);
});

kol.post("/kol/cooperations", async (c) => {
  const { id, isAdmin } = actor();
  const body = await c.req.json().catch(() => ({})) as KolCooperationInput;
  const result = await createKolCooperation(id, isAdmin, body);
  return c.json({ ...result, ...meta() }, 201);
});

kol.get("/kol/cooperations", async (c) => {
  const { id, isAdmin } = actor();
  const page = await listKolCooperations(id, isAdmin, {
    stage: c.req.query("stage"), owner: c.req.query("owner"),
    mine: c.req.query("mine") === "1" || c.req.query("mine") === "true",
    search: c.req.query("search"),
    limit: parseLimit(c.req.query("limit")), offset: parseOffset(c.req.query("offset")),
  });
  return c.json({ ...page, ...meta() });
});

kol.get("/kol/cooperations/:id", async (c) => {
  const { id, isAdmin } = actor();
  return c.json({ ...(await kolCooperationDetail(id, isAdmin, c.req.param("id"))), ...meta() });
});

kol.patch("/kol/cooperations/:id", async (c) => {
  const { id, isAdmin } = actor();
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  return c.json({ ...(await updateKolCooperation(id, isAdmin, c.req.param("id"), body)), ...meta() });
});
