import type {AgentOrganizationUnit,AgentOrganizationState,AgentBrowseFilters,AgentBrowseResult,AgentFacetOption} from '../../../shared/agent-organization.js';
export const defaultAgentFilters:AgentBrowseFilters={query:'',status:'all',binding:'all',draft:'all',level1:'',level2:'',level3:'',ownership:'all'};
type BrowseRow={id:string;name:string;description:string;status:string;draft:unknown;bindings:unknown[];organization:AgentOrganizationState};

export function organizationPath(unitId:string,company:string,units:AgentOrganizationUnit[]){
 const byId=new Map(units.map(unit=>[unit.id,unit])),path:AgentOrganizationUnit[]=[],issues:string[]=[],visited=new Set<string>();
 let id:string|null=unitId;
 while(id){
  if(visited.has(id)){issues.push('组织关系存在循环');break;}visited.add(id);
  const unit=byId.get(id);if(!unit){issues.push('组织上级关系缺失');break;}
  path.unshift(unit);if(unit.company_id!==company){issues.push('组织路径跨越公司');break;}
  if(unit.status!=='active')issues.push('归属部门或上级已归档');
  id=unit.parent_id===company?null:unit.parent_id;
 }
 if(path.some((unit,i)=>unit.level!==i+1))issues.push('组织层级关系待核对');
 return {path,valid:!issues.length,issues:[...new Set(issues)]};
}
export function normalizeAgentFilters(input:Partial<AgentBrowseFilters>):AgentBrowseFilters{
 const next={...defaultAgentFilters,...input};
 next.query=String(next.query||'').trim().slice(0,200);
 for(const key of ['level1','level2','level3'] as const)next[key]=String(next[key]||'').slice(0,200);
 for(const [key,allowed] of [['status',['all','draft','published','disabled']],['binding',['all','bound','unbound']],['draft',['all','with','without']],['ownership',['all','assigned','unassigned','invalid']]] as const)
  if(!(allowed as readonly string[]).includes(next[key]))next[key]='all';
 return next;
}
export function agentBrowse<T extends BrowseRow>(all:T[],units:AgentOrganizationUnit[],input:Partial<AgentBrowseFilters>={}):AgentBrowseResult<T>{
 const filters=normalizeAgentFilters(input);
 const valid=units.filter(unit=>organizationPath(unit.id,unit.company_id,units).valid);
 for(const [axis,level] of [['level1',1],['level2',2],['level3',3]] as const){
  if(filters[axis]&&!valid.some(unit=>unit.id===filters[axis]&&unit.level===level)){
   filters[axis]='';if(axis==='level1'){filters.level2='';filters.level3='';}if(axis==='level2')filters.level3='';
  }
 }
 if(filters.level1&&filters.level2&&!organizationPath(filters.level2,valid.find(unit=>unit.id===filters.level2)!.company_id,units).path.some(unit=>unit.id===filters.level1)){filters.level2='';filters.level3='';}
 if(filters.level3){const unit=valid.find(unit=>unit.id===filters.level3)!;const path=organizationPath(unit.id,unit.company_id,units).path;if((filters.level1&&!path.some(unit=>unit.id===filters.level1))||(filters.level2&&!path.some(unit=>unit.id===filters.level2)))filters.level3='';}
 const matches=(row:T,f:AgentBrowseFilters)=>{
  const assignment=row.organization.assignment;
  return (!f.query||`${row.name} ${row.description}`.toLocaleLowerCase().includes(f.query.toLocaleLowerCase()))
   &&(f.status==='all'||row.status===f.status)
   &&(f.binding==='all'||(f.binding==='bound'?row.bindings.length>0:row.bindings.length===0))
   &&(f.draft==='all'||(f.draft==='with'?Boolean(row.draft):!row.draft))
   &&(f.ownership==='all'||(f.ownership==='unassigned'?!assignment:f.ownership==='invalid'?Boolean(assignment&&!assignment.valid):Boolean(assignment?.valid)))
   &&(['level1','level2','level3'] as const).every(axis=>!f[axis]||Boolean(assignment?.valid&&assignment.path.some(unit=>unit.id===f[axis])));
 };
 const count=(key:keyof AgentBrowseFilters,value:string)=>all.filter(row=>matches(row,{...filters,[key]:value})).length;
 const facets={} as AgentBrowseResult<T>['facets'];
 for(const [key,options] of [['status',[['all','全部'],['draft','未发布'],['published','已发布'],['disabled','已停用']]],['binding',[['all','全部'],['bound','已有绑定'],['unbound','尚未绑定']]],['draft',[['all','全部'],['with','有草稿'],['without','无草稿']]],['ownership',[['all','全部'],['assigned','已设置'],['unassigned','未设置归属'],['invalid','归属待核对']]]] as const)
  facets[key]=options.map(([value,label])=>({value,label,count:count(key,value)}));
 for(const [axis,level] of [['level1',1],['level2',2],['level3',3]] as const){
  const options:AgentFacetOption[]=valid.filter(unit=>unit.level===level).filter(unit=>{
   const path=organizationPath(unit.id,unit.company_id,units).path;
   return (level===1||!filters.level1||path.some(item=>item.id===filters.level1))&&(level<3||!filters.level2||path.some(item=>item.id===filters.level2));
  }).sort((a,b)=>a.display_name.localeCompare(b.display_name,'zh-CN')).map(unit=>({value:unit.id,label:unit.display_name,parent_id:unit.parent_id,path:organizationPath(unit.id,unit.company_id,units).path.map(item=>item.display_name).join(' / '),count:count(axis,unit.id)}));
  facets[axis]=[{value:'',label:'全部',count:count(axis,'')},...options];
 }
 const rows=all.filter(row=>matches(row,filters));return {rows,total:rows.length,filters,facets};
}
