import {describe,it,expect} from 'vitest';
import {Hono} from 'hono';
import {requiresKnowledgeEntryAuthorization} from '../src/routers/knowledge-route-scope.js';
function appFor(admin=true,allowed=true){
 const app=new Hono(),publication=new Hono(),legacy=new Hono();
 const authorized:string[]=[];
 publication.use('/admin/knowledge/:id/*',async(c,next)=>{
  const id=c.req.param('id') || '';
  if(requiresKnowledgeEntryAuthorization(id)){
   authorized.push(id);
   if(!allowed)return c.json({detail:'知识不在当前组织范围'},404);
  }
  await next();
 });
 legacy.get('/admin/knowledge/feedback',c=>admin?c.json([]):c.json({detail:'需要管理权限'},403));
 legacy.get('/admin/knowledge/proposals',c=>admin?c.json([]):c.json({detail:'需要管理权限'},403));
 legacy.get('/admin/knowledge/index-health',c=>admin?c.json([]):c.json({detail:'需要管理权限'},403));
 legacy.get('/admin/knowledge/extract-jobs',c=>admin?c.json([]):c.json({detail:'需要管理权限'},403));
 legacy.post('/admin/knowledge/:id/feedback-handle',c=>c.json({handled:true}));
 app.route('/api',publication);app.route('/api',legacy);
 return {app,authorized};
}
describe('knowledge collection route scope',()=>{
 for(const route of ['feedback','proposals','extract-jobs','index-health']){
  it(`${route} reaches its collection handler instead of authorizing a fake entry`,async()=>{
   const {app,authorized}=appFor();const result=await app.request(`/api/admin/knowledge/${route}`);
   expect(result.status).toBe(200);expect(await result.json()).toEqual([]);expect(authorized).toEqual([]);
  });
 }
 it('feedback retains its own administrator check',async()=>{
  const {app}=appFor(false);expect((await app.request('/api/admin/knowledge/feedback')).status).toBe(403);
 });
 it('real entry feedback action still authorizes the original entry',async()=>{
  const {app,authorized}=appFor();expect((await app.request('/api/admin/knowledge/entry-1/feedback-handle',{method:'POST'})).status).toBe(200);expect(authorized).toEqual(['entry-1']);
 });
 it('cross-organization entry still cannot be handled',async()=>{
  const {app,authorized}=appFor(true,false);expect((await app.request('/api/admin/knowledge/entry-foreign/feedback-handle',{method:'POST'})).status).toBe(404);expect(authorized).toEqual(['entry-foreign']);
 });
 it('unknown paths are not treated as privileged collection routes',()=>{
  expect(requiresKnowledgeEntryAuthorization('unknown-entry')).toBe(true);expect(requiresKnowledgeEntryAuthorization('feedback-lookalike')).toBe(true);
 });
});
