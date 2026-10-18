/**
 * 能力注册表管理端接口（2026-10-07）。
 * 设计：docs/superpowers/specs/2026-10-07-media-transcribe-capability-registry-design.md §2
 */
import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
import {
  listCapabilities,
  registerCapability,
  updateCapability,
  resolveCapability,
} from "../capability/registry.js";
import { knowledgeActorId } from "../host/knowledge.js";
import type { Json } from "../types.js";
import {OperationGovernance} from '../capability/governance.js';
import {authDisabled} from '../auth.js';
import {HttpFail} from '../host/errors.js';
import {bodyLimit} from 'hono/body-limit';

export const capabilityRouter = new Hono();
const operations=()=>{
  if(authDisabled()&&process.env.NODE_ENV!=='test')throw new HttpFail(403,'能力治理需要真实登录');
  const actor=requireAdmin();
  return new OperationGovernance({id:actor.id,username:actor.username,name:actor.name,email:actor.email||null,roles:actor.roles,active:actor.active});
};
capabilityRouter.use('/admin/capability-operations/*',bodyLimit({maxSize:150000}));
const operationBody=async(c:{req:{json:()=>Promise<unknown>}})=>{
  let body:unknown;try{body=await c.req.json();}catch{throw new HttpFail(400,'无效 JSON');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpFail(400,'能力命令必须是 JSON 对象');
  return body as Record<string,unknown>;
};
capabilityRouter.get('/admin/capability-operations',async c=>c.json(await operations().list()));
capabilityRouter.get('/admin/capability-operations/:id/:version/history',async c=>c.json(await operations().history(c.req.param('id'),Number(c.req.param('version')))));
capabilityRouter.post('/admin/capability-operations/drafts',async c=>c.json(await operations().save(await operationBody(c))));
capabilityRouter.post('/admin/capability-operations/prepare',async c=>c.json(await operations().prepare(await operationBody(c))));
capabilityRouter.post('/admin/capability-operations/commit',async c=>c.json(await operations().commit(await operationBody(c))));

capabilityRouter.get("/admin/capabilities", async (c) => {
  requireAdmin();
  const query = c.req.query();
  return c.json({
    capabilities: (await listCapabilities({
      kind: query.kind,
      status: query.status,
      q: query.q,
    })),
  });
});

capabilityRouter.get("/admin/capabilities/resolve", async (c) => {
  requireAdmin();
  const query = c.req.query();
  return c.json({
    capability: (await resolveCapability(String(query.kind || ""), String(query.ref_id || ""))),
  });
});

capabilityRouter.post("/admin/capabilities", async (c) => {
  requireAdmin();
  const input = (await c.req.json()) as Json;
  return c.json(
    { capability: (await registerCapability(input as Parameters<typeof registerCapability>[0], (await knowledgeActorId()))) },
    201,
  );
});

capabilityRouter.patch("/admin/capabilities/:id", async (c) => {
  requireAdmin();
  const input = (await c.req.json()) as Json;
  return c.json({
    capability: (await updateCapability(c.req.param("id"), input as Parameters<typeof updateCapability>[1], (await knowledgeActorId()))),
  });
});
