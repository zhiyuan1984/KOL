import {describe,it,expect} from 'vitest';
import {agentBrowse,organizationPath} from '../src/agents/organization-browse.js';
import type {AgentOrganizationUnit} from '../../shared/agent-organization.js';
const units:AgentOrganizationUnit[]=[
 {id:'root',company_id:'company',display_name:'中心',parent_id:'company',level:1,status:'active',org_version:1},
 {id:'department',company_id:'company',display_name:'部门',parent_id:'root',level:2,status:'active',org_version:1},
 {id:'team',company_id:'company',display_name:'小组',parent_id:'department',level:3,status:'active',org_version:1},
 {id:'other',company_id:'company',display_name:'其他中心',parent_id:'company',level:1,status:'active',org_version:1},
];
const row=(id:string,target:string|null,status='published',bindings:unknown[]=[])=>( {id,name:id,description:'岗位',status,draft:null,bindings,organization:{revision:0,system:false,assignment:target?{id:'owner-'+id,company_id:'company',org_unit_id:target,...organizationPath(target,'company',units),assigned_at:'',assigned_by:''}:null}} );
describe('Agent organization facets and invalid paths',()=>{
 it.each(['cycle','missing','company','level','archived'])('rejects %s ancestry without inventing nodes',kind=>{
  const changed=units.map(unit=>({...unit}));
  if(kind==='cycle')changed[0].parent_id='team';
  if(kind==='missing')changed[1].parent_id='missing';
  if(kind==='company')changed[0].company_id='other-company';
  if(kind==='level')changed[1].level=3;
  if(kind==='archived')changed[0].status='archived';
  expect(organizationPath('team','company',changed).valid).toBe(false);
 });
 it('counts direct and descendant ownership once, preserving the other facet axes',()=>{
  const all=[row('直属中心','root'),row('部门岗位','department'),row('小组岗位','team','published',[{}]),row('未设置',null),row('其他','other','disabled')];
  expect(agentBrowse(all,units,{level1:'root'}).rows.map(value=>value.id)).toEqual(['直属中心','部门岗位','小组岗位']);
  expect(agentBrowse(all,units,{level2:'department'}).rows.map(value=>value.id)).toEqual(['部门岗位','小组岗位']);
  expect(agentBrowse(all,units,{level3:'team'}).rows.map(value=>value.id)).toEqual(['小组岗位']);
  const narrowed=agentBrowse(all,units,{level1:'root',binding:'bound'});expect(narrowed.facets.level1.find(value=>value.value==='root')?.count).toBe(1);expect(narrowed.facets.binding.find(value=>value.value==='unbound')?.count).toBe(2);
  expect(agentBrowse(all,units).total).toBe(5);expect(agentBrowse(all,units,{ownership:'unassigned'}).rows.map(value=>value.id)).toEqual(['未设置']);
 });
 it('clears invalid descendant selections after a parent change and retains unrelated filters',()=>{
  const result=agentBrowse([row('岗位','team')],units,{level1:'other',level2:'department',level3:'team',query:'岗位',status:'published'});
  expect(result.filters).toMatchObject({level1:'other',level2:'',level3:'',query:'岗位',status:'published'});
 });
 it('retains real deeper departments and includes them in the three ancestor facets',()=>{
  const directory=[...units,{...units[2],id:'ai-team',display_name:'AI产品组',parent_id:'team',level:4}];
  const path=organizationPath('ai-team','company',directory);expect(path.valid).toBe(true);expect(path.path.map(unit=>unit.level)).toEqual([1,2,3,4]);
  const deeper={...row('AI岗位',null),organization:{revision:1,system:false,assignment:{id:'owner-ai',company_id:'company',org_unit_id:'ai-team',...path,assigned_at:'',assigned_by:''}}};
  const result=agentBrowse([deeper],directory,{level1:'root',level2:'department',level3:'team'});expect(result.rows.map(value=>value.id)).toEqual(['AI岗位']);expect(result.facets.level3.find(value=>value.value==='team')?.count).toBe(1);expect(result.facets.level3.some(value=>value.value==='ai-team')).toBe(false);
 });
});
