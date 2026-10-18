import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireTicketPrincipal } from '../ticket-domain/auth.js';
import { HttpFail } from '../host/errors.js';
import { OntologyService } from '../ontology/service.js';

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
