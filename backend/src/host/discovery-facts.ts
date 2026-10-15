/**
 * Discovery memory facts — not a third A/B/C model.
 * Ingest receipts are facts. Scores are inferences.
 * Visibility follows public-sea fields; B.active restricted fields never leak.
 */
import { audit, getConn, nowIso } from "../db.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";
import { memoryCompanyId, publicProfileFields, trimPrivate } from "./kol-memory.js";

export type DiscoveryFactKind =
  | "run_create"
  | "crawl_idle"
  | "brief"
  | "ingest_receipt"
  | "approval_result"
  | "score_inference";

export type DiscoveryFactInput = {
  kind: DiscoveryFactKind;
  object_type: string;
  object_id: string;
  payload?: Json;
  fact_kind?: "fact" | "inference";
  visibility?: "public_sea" | "restricted";
  source_version?: string;
  actor?: string;
  company_id?: string;
};

const SCORE_KEYS = new Set(["score", "score_details", "signals"]);

export function publicSeaPayload(raw: Json = {}): Json {
  const trimmed = trimPrivate({ ...raw });
  for (const key of Object.keys(trimmed)) {
    if (SCORE_KEYS.has(key)) delete trimmed[key];
  }
  if (trimmed.profile && typeof trimmed.profile === "object") {
    trimmed.profile = publicProfileFields(trimmed.profile as Json);
  }
  return trimmed;
}

export async function recordDiscoveryFact(input: DiscoveryFactInput): Promise<Awaited<Json>> {
  const now = nowIso();
  const id = nid("dmf");
  const companyId = input.company_id || memoryCompanyId();
  const factKind = input.fact_kind || (input.kind === "score_inference" ? "inference" : "fact");
  const visibility = input.visibility || "public_sea";
  const payload = visibility === "public_sea" ? publicSeaPayload(input.payload || {}) : (input.payload || {});
  (await getConn().query("INSERT INTO discovery_memory_facts\n     (id,company_id,kind,object_type,object_id,fact_kind,visibility,payload,source_version,created_at)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[id,companyId,input.kind,input.object_type,input.object_id,factKind,visibility,JSON.stringify(payload),input.source_version || null,now]));
  (await audit(input.actor || "host", `discovery.fact.${input.kind}`, {
    fact_id: id,
    object_type: input.object_type,
    object_id: input.object_id,
    fact_kind: factKind,
    visibility,
    sent: false,
    stage_changed: false,
  }));
  return { id, kind: input.kind, fact_kind: factKind, visibility };
}

export async function listDiscoveryFacts(objectType: string, objectId: string): Promise<Awaited<Json[]>> {
  return ((await getConn().query("SELECT * FROM discovery_memory_facts\n      WHERE company_id=$1 AND object_type=$2 AND object_id=$3\n      ORDER BY created_at",[memoryCompanyId(),objectType,objectId])).rows as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    payload: JSON.parse(String(row.payload || "{}")),
  }));
}
