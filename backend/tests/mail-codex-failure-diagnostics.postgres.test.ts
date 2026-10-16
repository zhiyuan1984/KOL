import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {freshTestDatabase} from "./support/pg.js";
import {closePostgresPool,postgresPool} from "../src/postgres/pool.js";
const control=vi.hoisted(()=>({code:"codex_translation_unusable"}));
vi.mock("../src/host/mail-summary.js",async(importOriginal)=>{
 const actual=await importOriginal<typeof import("../src/host/mail-summary.js")>();
 return {...actual,remoteMailAnalysisEnabled:()=>true,summarizeWithCodexAppServer:async()=>["明确合成的邮件摘要，不是生产模型回执。"]};
});
vi.mock("../src/starrykol/translate-zh.js",async(importOriginal)=>{
 const actual=await importOriginal<typeof import("../src/starrykol/translate-zh.js")>();
 return {...actual,translateMailBodyZhResumable:async()=>({error:control.code})};
});
beforeEach(async()=>{await freshTestDatabase();});
afterEach(async()=>{await closePostgresPool();});
describe("safe real Codex diagnostics retain native PG failure receipts (synthetic provider)",()=>{
 it.each(["codex_timeout","codex_auth_or_access_failed","codex_request_failed","codex_thread_missing","codex_empty_result","codex_translation_unusable"])("retains %s rather than misclassifying it as generic outage",async(code)=>{
  control.code=code;const at="2026-10-16T00:00:00Z";const box="failure-test@example.test";
  await postgresPool().query("INSERT INTO kol_mail_threads(id,conversation_id,subject,mailbox,peer_email,created_at,updated_at,last_at) VALUES('diag_thread','diag_conversation','synthetic',$1,'synthetic@peer.test',$2,$2,$2)",[box,at]);
  await postgresPool().query("INSERT INTO kol_mail_items(id,thread_id,conversation_id,provider_message_id,direction,subject,body_text,occurred_at,created_at) VALUES('diag_item','diag_thread','diag_conversation','synthetic_provider','inbound','synthetic','This is a synthetic English source needing translation.',$1,$1)",[at]);
  const {runMailMemoryIncrement}=await import("../src/host/mail-memory-job.js");
  const stats=await runMailMemoryIncrement(box);
  expect(stats.errors).toBeGreaterThan(0);expect(stats.translated).toBe(0);
  expect(stats.error_types?.[code]).toBe(stats.errors);
  const item=(await postgresPool().query("SELECT memory_error,translation_source,translation_zh FROM kol_mail_items WHERE id='diag_item'")).rows[0];
  expect(item).toMatchObject({memory_error:code,translation_source:"pending"});expect(item.translation_zh||"").toBe("");
  const run=(await postgresPool().query("SELECT status,errors,translated FROM kol_mail_memory_runs WHERE id=$1",[stats.native_run_id])).rows[0];
  expect(run).toMatchObject({status:"failed",errors:stats.errors,translated:0});
 });
});
