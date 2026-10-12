import type {AgentReleaseCheck} from '../../../../shared/agent-workspace';
import type {AgentWorkspace} from './api';
export default function AgentReleaseChanges({check,data}:{check:AgentReleaseCheck;data:AgentWorkspace|null}){
 const changes=check.changes;
 const skillName=(id:string)=>data?.skills.find(value=>value.id===id)?.label||id;
 const bindingName=(target:{target_type:string;target_id:string})=>target.target_type==='person'?data?.people.find(person=>person.person_ref===target.target_id)?.display_name||target.target_id:data?.units.find(unit=>unit.id===target.target_id)?.display_name||target.target_id;
 const path=(owner:NonNullable<NonNullable<AgentReleaseCheck['changes']>['organization']>['before'])=>owner?.path.map(unit=>unit.display_name).join(' / ')||'未设置组织归属';
 return <>
  <section><h3>本次变更 · 修订草稿 r{check.revision}</h3>{changes?<>
   {changes.name&&<p>名称：{changes.name.before} → {changes.name.after}</p>}
   {changes.description&&<div><p>职责原内容：{changes.description.before||'未填写'}</p><p>职责新内容：{changes.description.after||'未填写'}</p></div>}
   {changes.organization&&<p>组织归属：{path(changes.organization.before)} → {path(changes.organization.after)}</p>}
   {changes.bindings_added.length>0&&<p>新增使用绑定：{changes.bindings_added.map(bindingName).join('、')}</p>}
   {changes.bindings_removed.length>0&&<p>移除使用绑定：{changes.bindings_removed.map(bindingName).join('、')}</p>}
   {!changes.total&&<p>没有配置变更，无需发布。</p>}
   {changes.reason&&<p>配置变更原因：{changes.reason}</p>}
  </>:<><p>{check.content.name}</p><p>{check.content.description}</p></>}
  {([['新增技能',check.added_skills],['移除技能',check.removed_skills],['升级技能',check.updated_skills]] as const).map(([label,ids])=>ids.length>0&&<p key={label}>{label}：{ids.map(skillName).join('、')}</p>)}</section>
  <section><h3>本次影响</h3>{changes&&<><p>新增覆盖 {changes.users_added.length} 人 · 减少覆盖 {changes.users_removed.length} 人</p>{changes.users_added.length>0&&<p>新增人员：{changes.users_added.map(person=>person.display_name||person.user_id).join('、')}</p>}{changes.users_removed.length>0&&<p>减少人员：{changes.users_removed.map(person=>person.display_name||person.user_id).join('、')}</p>}</>}
   <p>发布后 {check.binding_count} 个绑定点 · 覆盖 {check.coverage_count} 个员工账号 · 组织版本 {check.org_version}</p><p className="agent-help">覆盖是使用资格，实际执行仍须通过考试与业务规则。</p>
  </section>
  <section><h3>发布检查</h3>{check.blockers.length?<ul role="alert">{check.blockers.map(value=><li key={value}>{value}</li>)}</ul>:<p>本次候选配置已通过服务端检查。</p>}{check.warnings.length>0&&<details><summary>相关提示 · {check.warnings.length} 项</summary><ul>{check.warnings.map(value=><li key={value}>{value}</li>)}</ul></details>}<p className="agent-help">有效至 {new Date(check.expires_at).toLocaleString('zh-CN',{hour12:false})}。草稿或依据改变后须重新检查。</p></section>
  <details><summary>查看候选配置 · {check.content.skills.length} 项技能</summary><p>{check.content.name}</p><p>{check.content.description}</p>{check.content.skills.map(pin=><p key={pin.skill_id}>{skillName(pin.skill_id)} · {pin.release_hash.slice(0,12)}{pin.knowledge_revision?` · 知识 v${pin.knowledge_revision}`:''}</p>)}</details>
 </>;
}
