import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HttpFail } from '../host/errors.js';
import { requireTicketPrincipal } from '../ticket-domain/auth.js';
import { PerformanceService } from '../performance/service.js';
import { postgresPool } from '../postgres/pool.js';

export const performanceRouter=new Hono();
performanceRouter.use('/performance/*',bodyLimit({maxSize:250000}));
performanceRouter.use('/performance/*',async(c,next)=>{
 c.header('Cache-Control','no-store');
 requireTicketPrincipal();
 if(!process.env.DATABASE_URL?.trim())throw new HttpFail(503,{code:'performance_postgres_required',message:'绩效服务需要 PostgreSQL 数据库配置，不会回退到本地存储'});
 const schema=(await postgresPool().query("SELECT to_regclass('performance_commands') AS table_name")).rows[0];
 const approvalColumn=(await postgresPool().query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='performance_assets' AND column_name='approval'")).rowCount;
 if(!schema?.table_name||!approvalColumn)throw new HttpFail(503,{code:'performance_schema_required',message:'绩效数据库尚未迁移，请运行后端 PostgreSQL schema 迁移后重试'});
 try{await next();}catch(error){if((error as {code?:string}).code==='42P01')throw new HttpFail(503,{code:'performance_schema_required',message:'绩效数据库尚未迁移，请运行后端 PostgreSQL schema 迁移后重试'});throw error;}
});
const service=(company?:string)=>new PerformanceService(requireTicketPrincipal(),company);
performanceRouter.get('/performance/overview',async c=>c.json(await service(c.req.header('X-Performance-Company')).overview(c.req.query('admin')==='1')));
performanceRouter.get('/performance/records',async c=>c.json(await service(c.req.header('X-Performance-Company')).list(c.req.query('view')||'mine',c.req.query('cycleId'))));
performanceRouter.get('/performance/records/:id',async c=>c.json(await service(c.req.header('X-Performance-Company')).detail(c.req.param('id'))));
performanceRouter.get('/performance/presets',async c=>c.json(await service(c.req.header('X-Performance-Company')).presets()));
performanceRouter.get('/performance/asset-approvals',async c=>c.json(await service(c.req.header('X-Performance-Company')).assetApprovals()));
performanceRouter.get('/performance/audit',async c=>c.json(await service(c.req.header('X-Performance-Company')).audit()));
performanceRouter.get('/performance/assignments',async c=>c.json(await service(c.req.header('X-Performance-Company')).assignments()));
performanceRouter.post('/performance/commands',async c=>{let b;try{b=await c.req.json();}catch{throw new HttpFail(400,'无效JSON');}if(!b||typeof b!=='object'||Array.isArray(b))throw new HttpFail(400,'无效命令');return c.json(await service(c.req.header('X-Performance-Company')).command(b));});
