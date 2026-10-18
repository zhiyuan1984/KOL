import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {requirePm} from '../host/auth.js';
import {requireAdmin,authDisabled} from '../auth.js';
import {HttpFail} from '../host/errors.js';
import {skillAuthoringOptions,loadSkillAuthoring,parseSkillUpload,saveSkillAuthoring,checkSkillAuthoring} from '../host/skill-authoring.js';
export const skillAuthoringRouter=new Hono();
skillAuthoringRouter.use('/admin/skill-authoring*',bodyLimit({maxSize:256*1024}));
skillAuthoringRouter.use('/admin/skill-authoring*',async(c,next)=>{if(authDisabled()&&process.env.NODE_ENV!=='test')throw new HttpFail(403,'技能创建需要真实登录');requireAdmin();await requirePm();c.header('Cache-Control','no-store');await next();});
const body=async(c:{req:{json:()=>Promise<unknown>}})=>{let value:unknown;try{value=await c.req.json();}catch{throw new HttpFail(400,'无效 JSON');}if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpFail(400,'无效技能配置');return value as Record<string,unknown>;};
skillAuthoringRouter.get('/admin/skill-authoring/options',async c=>c.json(await skillAuthoringOptions(c.req.query('company'))));
skillAuthoringRouter.post('/admin/skill-authoring/parse',async c=>{
 const data=await c.req.parseBody(),file=data.file;if(!file||typeof file==='string'||Array.isArray(file)||typeof file.text!=='function'||!/\.md$/i.test(String(file.name)))throw new HttpFail(400,'请选择 SKILL.md 文件');
 return c.json(parseSkillUpload(await file.text()));
});
skillAuthoringRouter.post('/admin/skill-authoring/check',async c=>c.json(await checkSkillAuthoring(await body(c))));
skillAuthoringRouter.get('/admin/skill-authoring/:id',async c=>c.json(await loadSkillAuthoring(c.req.param('id'))));
skillAuthoringRouter.post('/admin/skill-authoring',async c=>c.json(await saveSkillAuthoring(await body(c)),201));
skillAuthoringRouter.put('/admin/skill-authoring/:id',async c=>c.json(await saveSkillAuthoring(await body(c),c.req.param('id'))));
