import {afterEach,describe,expect,it,vi} from "vitest";
import {Job} from "bullmq";
import {PostgresOutboxPublisher} from "../src/queue/outbox-publisher.js";
const state=vi.hoisted(()=>({rows:[] as any[],ids:[] as string[],writes:[] as string[]}));
vi.mock("pg",()=>({Client:class{},Pool:class{
 async connect(){return {release(){},async query(sql:string){if(sql.includes("WITH due"))return {rows:state.rows};state.writes.push(sql);return {rows:[]};}};}
 async end(){}
}}));
vi.mock("ioredis",()=>({Redis:class{disconnect(){}}}));
vi.mock("bullmq",async original=>{
 const actual=await original<typeof import("bullmq")>();
 return {...actual,Queue:class{
 async add(_name:string,_body:unknown,options:{jobId:string}){
   (actual.Job.prototype as any).validateOptions.call({opts:options},{data:"{}"});
   state.ids.push(options.jobId);
 }
 async close(){}
 }};
});
afterEach(()=>{state.rows=[];state.ids=[];state.writes=[];});
describe("durable outbox transport IDs",()=>{
 it("publishes legacy knowledge events with a valid, collision-free, replay-stable BullMQ ID",async()=>{
  const raw="knowledge-publish:company:amperetime:review:dispatch";
  expect(()=>(Job.prototype as any).validateOptions.call({opts:{jobId:`outbox-${raw}`}},{data:"{}"})).toThrow("cannot contain");
  state.rows=[raw,raw.replace(":","%3A")].map(id=>({id,job_id:"approved-job",event_type:"execution.ready",attempts:1}));
  const p=new PostgresOutboxPublisher({databaseUrl:"postgresql://fixture",redisUrl:"redis://fixture"});
  expect(await p.drainOnce()).toBe(2);
  expect(state.ids[0]).not.toContain(":");expect(state.ids[0]).not.toBe(state.ids[1]);
  const first=state.ids[0];await p.drainOnce();expect(state.ids[2]).toBe(first);
  expect(state.writes.filter(sql=>sql.includes("SET status='published'")).length).toBe(4);
  expect(state.writes.some(sql=>sql.includes("SET status='retrying'"))).toBe(false);
  await p.close();
 });
 it("keeps existing UUID transport identifiers stable",async()=>{
  const id="e68767c9-4dcc-4b7e-8faf-371a15decc32";
  state.rows=[{id,job_id:"job",event_type:"execution.ready",attempts:1}];
  const p=new PostgresOutboxPublisher({databaseUrl:"postgresql://fixture",redisUrl:"redis://fixture"});
  await p.drainOnce();expect(state.ids).toEqual([`outbox-${id}`]);await p.close();
 });
});
