import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireTicketPrincipal } from '../ticket-domain/auth.js';
import { HttpFail } from '../host/errors.js';
import { OntologyService } from '../ontology/service.js';
import { WecomOntologySourceService } from '../ontology/wecom-source.js';
import { setupWecomOntologySource } from '../ontology/wecom-setup.js';
import type { WecomPreviewRequest, WecomCommitRequest } from '../../../shared/wecom-ontology.js';

export const ontology = new Hono();
ontology.use('/ontology/workspace/*',bodyLimit({maxSize:1_000_000}));
ontology.use('/ontology/workspace/*',async(c,next)=>{
  c.header('Cache-Control','no-store');requireTicketPrincipal();
  try{await next();}catch(error){
    if(['42P01','42703'].includes((error as {code?:string}).code||''))throw new HttpFail(503,{code:'ontology_schema_required',message:'本体数据表尚未初始化，请运行 PostgreSQL schema 迁移'});
    throw error;
  }
});
const service=(company?:string)=>new OntologyService(requireTicketPrincipal(),company);
const body=async(c:{req:{json:()=>Promise<unknown>}})=>{
  let value:unknown;try{value=await c.req.json();}catch{throw new HttpFail(400,'无效 JSON');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpFail(400,'无效本体命令');
  return value as Record<string,unknown>;
};
ontology.get('/ontology/workspace/catalog',async c=>c.json(await service(c.req.header('X-Ontology-Company')).catalog(c.req.query('admin')==='1')));
ontology.get('/ontology/workspace/history/:code',async c=>c.json(await service(c.req.header('X-Ontology-Company')).history(c.req.param('code'))));
ontology.post('/ontology/workspace/drafts',async c=>c.json(await service(c.req.header('X-Ontology-Company')).save(await body(c))));
ontology.post('/ontology/workspace/prepare',async c=>c.json(await service(c.req.header('X-Ontology-Company')).prepare(await body(c))));
ontology.post('/ontology/workspace/commit',async c=>c.json(await service(c.req.header('X-Ontology-Company')).commit(await body(c))));
ontology.get('/ontology/workspace/scope',async c=>c.json(await service(c.req.header('X-Ontology-Company')).scope()));
ontology.post('/ontology/workspace/scope',async c=>c.json(await service(c.req.header('X-Ontology-Company')).configureScope(await body(c))));
ontology.post('/ontology/workspace/maintenance',async c=>c.json(await service(c.req.header('X-Ontology-Company')).requestMaintenance(await body(c))));
ontology.get('/ontology/workspace/maintenance',async c=>c.json(await service(c.req.header('X-Ontology-Company')).maintenance()));

const sourceService=()=>new WecomOntologySourceService(requireTicketPrincipal());
function explicitCompany(value: unknown, header?: string): string {
  if(typeof value!=='string'||!value.trim())throw new HttpFail(422,{code:'wecom_company_scope_required',message:'请显式选择企业微信来源所属公司'});
  const company=value.trim();
  if(header&&header!==company)throw new HttpFail(409,{code:'wecom_company_scope_mismatch',message:'公司参数与当前本体工作区不一致'});
  return company;
}
ontology.get('/ontology/workspace/wecom/status',async c=>c.json(await sourceService().status(explicitCompany(c.req.query('companyId'),c.req.header('X-Ontology-Company')))));
ontology.post('/ontology/workspace/wecom/preview',async c=>{
  const input=await body(c);const companyId=explicitCompany(input.companyId,c.req.header('X-Ontology-Company'));
  return c.json(await sourceService().preview({...input,companyId} as WecomPreviewRequest));
});
ontology.post('/ontology/workspace/wecom/commit',async c=>{
  const input=await body(c);const companyId=explicitCompany(input.companyId,c.req.header('X-Ontology-Company'));
  return c.json(await sourceService().commit({...input,companyId} as WecomCommitRequest));
});
ontology.get('/ontology/workspace/wecom/snapshot',async c=>c.json(await sourceService().snapshot({
  companyId:explicitCompany(c.req.query('companyId'),c.req.header('X-Ontology-Company')),
  snapshotId:c.req.query('snapshotId'),kind:c.req.query('kind'),cursor:c.req.query('cursor'),pageSize:c.req.query('pageSize'),
})));
ontology.get('/ontology/workspace/wecom/receipt',async c=>c.json(await sourceService().receipt(
  explicitCompany(c.req.query('companyId'),c.req.header('X-Ontology-Company')),c.req.query('commandId')||'',
)));
ontology.post('/ontology/workspace/wecom/setup',async c=>{
  const input=await body(c);const companyId=explicitCompany(input.companyId,c.req.header('X-Ontology-Company'));
  return c.json(await setupWecomOntologySource(requireTicketPrincipal(),{...input,companyId}));
});
