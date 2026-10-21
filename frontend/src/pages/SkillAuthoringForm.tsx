import {useEffect,useState,useRef} from 'react';
import {Alert,Button,Checkbox,Form,Input,Select} from 'antd';
import {Link} from 'react-router-dom';
import {api} from '../api';
import {HorizontalForm,ActionGroup,PropertyList} from '../components/InformationLayout';
import {OntologyObjectPicker} from '../components/OntologyObjectPicker';
import type {SkillAuthoring,SkillAuthoringOptions,SkillAuthoringState,SkillAuthoringCheck} from '../../../shared/skill-authoring';
import './skill-authoring.css';
const blankAuthoring=():SkillAuthoring=>({version:1,company:null,mode:'business',general_scope:'',purpose:'',use_when:'',expected_result:'',recovery:'',objects:[]});
const newId=()=>`skill_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`;
const emptySpec=()=>({id:newId(),title:'',body:'',description:'',mcp:[],capabilities:[],authoring:blankAuthoring()}) as Record<string,unknown>;
type InputField={key:string;label:string;kind:string;required:boolean;[key:string]:unknown};
export function SkillAuthoringForm({mode,skillId,onSaved,onClose,onDirtyChange}:{mode:'new'|'import'|'edit'|'clone';skillId?:string;onSaved:(id:string)=>void;onClose:()=>void;onDirtyChange:(dirty:boolean)=>void}){
 const [spec,setSpec]=useState<Record<string,unknown>>(emptySpec),[stamp,setStamp]=useState<string|null>(null),[options,setOptions]=useState<SkillAuthoringOptions|null>(null),[error,setError]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[check,setCheck]=useState<SkillAuthoringCheck|null>(null),[loading,setLoading]=useState(!!skillId),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[editable,setEditable]=useState(true),[optionsBusy,setOptionsBusy]=useState(false),[operation,setOperation]=useState('');
 const authoring=(spec.authoring as SkillAuthoring)||blankAuthoring(),context=spec.context as {requires:string[];prefers:string[]}|undefined,fields=spec.input_schema as InputField[]|undefined;
 const hydrate=(state:SkillAuthoringState,clone=false)=>{
  const source=state.spec;const meta=(source.authoring as SkillAuthoring)||{...blankAuthoring(),purpose:String(source.description||''),objects:(source.ontology as Array<{object:string;revision:number;actions?:string[]}>||[]).map(r=>({...r,actions:r.actions||[]}))};
  setSpec({...source,...(clone?{id:newId(),title:String(source.title||'')+'（副本）'}:{}),authoring:structuredClone(meta)});setStamp(clone?null:state.stamp);setEditable(clone||state.editable);setWarnings(state.warnings||[]);setDirty(false);setCheck(null);
 };
 useEffect(()=>{let active=true;if(skillId){setLoading(true);void api.skillAuthoring(skillId).then(state=>{if(active)hydrate(state,mode==='clone');}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});}return()=>{active=false;};},[skillId,mode]);
 const optionsRequest=useRef(0);
 const loadOptions=async(company?:string)=>{const request=++optionsRequest.current;setOptionsBusy(true);try{const result=await api.skillAuthoringOptions(company);if(request!==optionsRequest.current)return;setOptions(result);if(!company&&result.company)setSpec(old=>(old.authoring as SkillAuthoring).company?old:({...old,authoring:{...(old.authoring as SkillAuthoring),company:result.company}}));}catch(e){if(request===optionsRequest.current)setError(e instanceof Error?e.message:'业务目录读取失败');}finally{if(request===optionsRequest.current)setOptionsBusy(false);}};
 useEffect(()=>{void loadOptions(authoring.company||undefined);return()=>{optionsRequest.current++;};},[authoring.company]);
 useEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
 useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
 const change=(patch:Record<string,unknown>)=>{setSpec(old=>({...old,...patch}));setDirty(true);setCheck(null);};
 const changeAuthoring=(patch:Partial<SkillAuthoring>)=>change({authoring:{...authoring,...patch}});
 const candidate=()=>{const metadata={...spec,authoring,description:authoring.purpose.trim().slice(0,200)||String(spec.description||spec.title||''),ontology:authoring.objects.filter(o=>o.revision!==null).map(o=>({object:o.object,revision:o.revision!,...(o.actions.length?{actions:o.actions}:{})}))};return metadata;};
 const run=async(fn:()=>Promise<void>,reason='正在保存技能草稿…')=>{setBusy(true);setOperation(reason);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);setOperation('');}};
 const save=()=>run(async()=>{if(!String(spec.title||'').trim()||!String(spec.body||'').trim())throw Error('请填写技能名称和工作方法');const result=await api.saveSkillAuthoring(candidate(),stamp,mode==='edit'?skillId:undefined);setDirty(false);onDirtyChange(false);onSaved(result.id);});
 const inspect=()=>run(async()=>setCheck(await api.checkSkillAuthoring(candidate())),'正在核对正式版本与能力依赖…');
 const upload=(file:File)=>run(async()=>{const parsed=await api.parseSkillUpload(file);hydrate({...parsed,spec:{...parsed.spec,id:parsed.spec.id||newId()}});setDirty(true);},'正在解析上传文件，尚未保存…');
 const capabilities=(spec.capabilities as Array<{id:string;version:number;optional?:boolean}>)||[],legacy=Array.isArray(spec.mcp)?spec.mcp:[];
 const updateFields=(next:InputField[])=>change({input_schema:next,required_inputs:next.filter(f=>f.required).map(f=>f.key)});
 return <section className="skill-authoring" data-skill-authoring>
  <header className="skill-authoring-head"><h2>{mode==='edit'?'编辑业务配置':mode==='clone'?'复用为新技能':'创建技能草稿'}</h2><ActionGroup><Button type="primary" htmlType="submit" form="skill-authoring-form" loading={busy} disabled={loading||!editable}>保存技能草稿</Button><Button type="text" disabled={busy||loading} onClick={()=>void inspect()}>检查依赖与复用范围</Button><Button type="text" onClick={onClose} disabled={busy}>返回技能详情</Button></ActionGroup></header>
  <p>填写用途和工作方法，核对业务对象、当前上下文与所需能力。保存不会发布，也不会装配到 Agent。</p>
  {error&&<Alert type="error" title={error} showIcon/>}{busy&&<p role="status">{operation}</p>}{optionsBusy&&<p role="status">正在读取当前公司可用对象及已发布能力…</p>}{loading&&<p role="status">正在读取原技能及草稿…</p>}
  {!editable&&<Alert type="info" title="内置技能的依赖由原版本资产维护；请使用“复用为新技能”创建候选，不覆盖原技能。"/>}
  {warnings.map((warning,i)=><p className="muted" key={i}>{warning}</p>)}
  {mode==='import'&&<div className="skill-authoring-upload"><label>上传 SKILL.md<Input type="file" aria-label="选择技能文件" accept=".md,text/markdown" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);}}/></label><p>文件只解析为待核对内容；不会执行其中的授权、跳审或凭据请求。</p></div>}
  <HorizontalForm id="skill-authoring-form" disabled={busy||loading||!editable} onFinish={()=>void save()}>
   <Form.Item label="技能名称"><Input aria-label="技能名称" value={String(spec.title||'')} maxLength={80} onChange={e=>change({title:e.target.value})}/></Form.Item>
   <Form.Item label="用途"><Input.TextArea aria-label="技能用途" value={authoring.purpose} autoSize={{minRows:2,maxRows:6}} onChange={e=>changeAuthoring({purpose:e.target.value})}/></Form.Item>
   <Form.Item label="适用条件"><Input.TextArea aria-label="适用条件" value={authoring.use_when} autoSize={{minRows:2,maxRows:5}} onChange={e=>changeAuthoring({use_when:e.target.value})}/></Form.Item>
   <Form.Item label="适用方式"><Select aria-label="适用方式" value={authoring.mode} options={[{value:'business',label:'关联业务对象'},{value:'general',label:'通用分析、翻译或方法'}]} onChange={mode=>changeAuthoring({mode})}/></Form.Item>
   <Form.Item label="定义所属公司"><Select aria-label="定义所属公司" placeholder="选择本人有效组织所属公司" loading={optionsBusy} value={authoring.company||undefined} options={options?.companies.map(c=>({value:c.id,label:c.name}))||[]} onChange={company=>changeAuthoring({company})}/></Form.Item>
   {authoring.mode==='general'?<Form.Item label="通用适用范围">{authoring.objects.length>0&&<><p>仍保留 {authoring.objects.length} 个原业务对象，需明确处理后再发布。</p><Button type="text" onClick={()=>changeAuthoring({objects:[]})}>清除原对象，使用通用范围</Button></>}<Input.TextArea aria-label="通用适用范围" value={authoring.general_scope} autoSize={{minRows:2,maxRows:5}} onChange={e=>changeAuthoring({general_scope:e.target.value})}/></Form.Item>:<Form.Item label="业务对象" className="ui-field-stacked"><OntologyObjectPicker options={options?.objects||[]} value={authoring.objects} disabled={busy||!editable||optionsBusy} onChange={objects=>changeAuthoring({objects})}/><Link to="/admin/ontology" target="_blank">维护业务定义与公司正式版本</Link></Form.Item>}
   <Form.Item label="必要上下文"><Select aria-label="必要上下文" mode="multiple" optionFilterProp="label" value={context?.requires||[]} options={options?.contexts.map(c=>({value:c.key,label:c.label}))||[]} onChange={requires=>change({context:{requires,prefers:(context?.prefers||[]).filter(k=>!requires.includes(k))}})}/></Form.Item>
   <Form.Item label="推荐上下文"><Select aria-label="推荐上下文" mode="multiple" optionFilterProp="label" value={context?.prefers||[]} options={options?.contexts.filter(c=>!context?.requires.includes(c.key)).map(c=>({value:c.key,label:c.label}))||[]} onChange={prefers=>change({context:{requires:context?.requires||[],prefers}})}/><p>必要项缺失会阻止启动；推荐项缺失如实提示。邮件/会话内容仍由原实时上下文链读取。</p>{context===undefined&&<Button type="text" onClick={()=>change({context:{requires:[],prefers:[]}})}>确认不依赖页面上下文</Button>}</Form.Item>
   <Form.Item label="所需能力" className="ui-field-stacked">{legacy.length>0?<><Alert type="info" title={`保留文件中的 ${legacy.length} 项旧工具声明。依赖仍走原登记与挂载检查。`}/><Button type="text" onClick={()=>change({mcp:[]})}>改用稳定能力（清除旧工具声明）</Button></>:<Select aria-label="所需业务能力" mode="multiple" optionFilterProp="label" value={capabilities.map(c=>`${c.id}@${c.version}`)} options={options?.capabilities.map(c=>({value:`${c.id}@${c.version}`,label:`${c.name} · v${c.version} · ${c.risk}${c.asynchronous?' · 异步作业':''}`}))||[]} onChange={values=>change({capabilities:values.map(value=>{const [id,version]=value.split('@');const original=capabilities.find(c=>c.id===id&&c.version===Number(version));return {id,version:Number(version),...(original?.optional?{optional:true}:{})};})})}/>}</Form.Item>
   <Form.Item label="输入引导" className="ui-field-stacked">{fields?.map((field,i)=><div className="skill-authoring-input" key={field.key}><Input aria-label={`输入名称 ${i+1}`} value={field.label} onChange={e=>updateFields(fields.map((f,n)=>n===i?{...f,label:e.target.value}:f))}/><Checkbox checked={field.required} onChange={e=>updateFields(fields.map((f,n)=>n===i?{...f,required:e.target.checked}:f))}>必填</Checkbox><Button type="text" onClick={()=>updateFields(fields.filter((_,n)=>n!==i))}>移除</Button></div>)}{!fields&&Array.isArray(spec.required_inputs)&&spec.required_inputs.length>0?<p>保留原文件的必填输入声明，详细契约仍可在技能详情维护。</p>:<Button type="text" onClick={()=>updateFields([...(fields||[]),{key:'input_'+crypto.randomUUID().replaceAll('-','').slice(0,8),label:'',kind:'text',required:false}])}>添加文本输入</Button>}</Form.Item>
   <Form.Item label="工作方法" className="ui-field-stacked"><Input.TextArea aria-label="工作方法" value={String(spec.body||'')} autoSize={{minRows:8,maxRows:24}} maxLength={32000} onChange={e=>change({body:e.target.value})}/></Form.Item>
   <Form.Item label="成果要求"><Input.TextArea aria-label="成果要求" value={authoring.expected_result} autoSize={{minRows:2,maxRows:6}} onChange={e=>changeAuthoring({expected_result:e.target.value})}/></Form.Item>
   <Form.Item label="失败恢复"><Input.TextArea aria-label="失败恢复" value={authoring.recovery} autoSize={{minRows:2,maxRows:6}} onChange={e=>changeAuthoring({recovery:e.target.value})}/></Form.Item>
  </HorizontalForm>
  {check&&<div aria-label="依赖检查结果"><h3>{check.ready?'当前声明依赖已核对，仍需测试与发布':'有待处理项，可保存草稿'}</h3>{check.issues.map((issue,i)=><p key={i}>{issue}</p>)}<PropertyList items={check.reuse.map(r=>({key:r.layer,label:r.layer,value:r.detail}))}/></div>}
  <details><summary>技能标识</summary><p>标识自动生成，保存后保持稳定。上传文件保留原标识；冲突时请明确另存为新技能。</p><Input aria-label="技能标识" disabled={mode==='edit'||busy} value={String(spec.id||'')} onChange={e=>change({id:e.target.value})}/></details>
 </section>;
}
