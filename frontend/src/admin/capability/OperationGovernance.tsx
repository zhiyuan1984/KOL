import {useCallback,useEffect,useState} from 'react';
import {Button,Form,Input,InputNumber,Select,Checkbox,Table,Tag,Alert,Modal} from 'antd';
import {Link} from 'react-router-dom';
import {api} from '../../api';
import {HorizontalForm,ActionGroup,PropertyList} from '../../components/InformationLayout';
import {useAdminConfirm} from '../../components/ConfirmDialog';
import type {OperationDefinition,OperationRow,OperationHistory,OperationPreview} from '../../../../shared/capability-governance';
import './operations.css';

const statusNames={draft:'草稿',published:'已发布',disabled:'已停用',bundled_baseline:'随平台发布的基线'};
const blank=():OperationDefinition=>({id:'',version:1,name:'',description:'',effect:'read',risk:'R1',asynchronous:false,inputSchema:{type:'object',properties:{},additionalProperties:false},implementation:{connector:'',tool:'',version:1}});
const json=(value:unknown)=>JSON.stringify(value??{},null,2);
const message=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试';
export function OperationGovernance({connectors}:{connectors:Array<{id?:unknown;label?:unknown}>}){
  const [rows,setRows]=useState<OperationRow[]>([]),[selected,setSelected]=useState<OperationRow|null>(null),[edit,setEdit]=useState<OperationDefinition>(blank),[schema,setSchema]=useState(()=>json(blank().inputSchema)),[mapping,setMapping]=useState('{}'),[result,setResult]=useState('{}');
  const [history,setHistory]=useState<OperationHistory[]>([]),[preview,setPreview]=useState<OperationPreview|null>(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[receipt,setReceipt]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[loaded,setLoaded]=useState(false);
  const {ask,dialog:node,open:confirmOpen}=useAdminConfirm();
  const load=useCallback(async()=>{const data=await api.capabilityOperations();setRows(data.operations);setLoaded(true);return data.operations;},[]);
  useEffect(()=>{let current=true;void api.capabilityOperations().then(data=>{if(current){setRows(data.operations);setLoaded(true);}}).catch(e=>{if(current)setError(message(e));});return()=>{current=false;};},[]);
  useEffect(()=>{let current=true;setHistory([]);if(selected)void api.capabilityOperationHistory(selected.id,selected.version).then(data=>{if(current)setHistory(data.versions);}).catch(e=>{if(current)setError(message(e));});return()=>{current=false;};},[selected]);
  const open=(row:OperationRow|null,definition?:OperationDefinition)=>{
    const apply=()=>{const op=definition||row?.draft||row?.published||blank();setSelected(row);setEdit(structuredClone(op));setSchema(json(op.inputSchema||blank().inputSchema));const {connector:_c,tool:_t,version:_v,...adapter}=op.implementation;setMapping(json(adapter));setResult(json(op.result));setPreview(null);setDirty(false);setError('');setReceipt('');};
    if(dirty)Modal.confirm({title:'放弃未保存的编辑？',content:'已保存的草稿仍保留。',onOk:apply,okText:'放弃编辑',cancelText:'继续编辑'});else apply();
  };
  const change=(patch:Partial<OperationDefinition>)=>{setEdit(old=>({...old,...patch}));setDirty(true);setPreview(null);};
  const changeImplementation=(patch:Partial<OperationDefinition['implementation']>)=>change({implementation:{...edit.implementation,...patch}});
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setReceipt('');try{await fn();}catch(e){setError(message(e));}finally{setBusy(false);}};
  const save=()=>run(async()=>{
    const output=JSON.parse(result),definition={...edit,inputSchema:JSON.parse(schema),implementation:{...edit.implementation,...JSON.parse(mapping)},...(Object.keys(output).length?{result:output}:{})};
    if(!Object.keys(output).length)delete definition.result;
    await api.saveCapabilityOperation({definition,expectedRevision:selected?.revision||0,reason});
    const all=await load();const row=all.find(r=>r.id===definition.id&&r.version===definition.version)!;setSelected(row);setEdit(row.draft!);setDirty(false);setPreview(null);setReceipt('草稿已保存，执行仍使用原正式版本。');
  });
  const prepare=(action:string,targetVersion?:string)=>run(async()=>{if(!selected)throw Error('请先保存草稿或选择已登记能力');if(dirty)throw Error('请先保存编辑，再核对生效内容');setPreview(await api.prepareCapabilityOperation({id:selected.id,version:selected.version,expectedRevision:selected.revision,action,targetVersion}));});
  const commit=()=>{if(!preview)return;const snapshot=preview,commandId=crypto.randomUUID();setPreview(null);ask({kind:'capability-publish',title:'确认能力配置生效',object:`${snapshot.id} @ ${snapshot.version}`,scope:snapshot.used_by.map(s=>s.title+(s.optional?'（可选）':'')).join('、')||'尚无已登记技能引用',change:`动作：${snapshot.action}；修订：${snapshot.revision} → ${snapshot.revision+1}`,consequence:snapshot.notice,confirmLabel:'确认生效',requireReason:true,confirmTone:'primary'},async why=>{await api.commitCapabilityOperation({token:snapshot.token,commandId,confirmed:true,reason:why});setPreview(null);const all=await load();const row=all.find(r=>r.id===snapshot.id&&r.version===snapshot.version)!;setSelected(row);setDirty(false);setReceipt('配置已生效，回执与历史已保存。');});};
  return <section className="operation-governance" data-operation-governance>
    <header className="connector-hub-head"><div><Link to="/admin/connectors">← 连接器</Link><h2>可执行能力</h2></div><Button type="text" onClick={()=>open(null)} disabled={busy}>注册能力</Button></header>
    <p>登记稳定业务动作及接口映射。凭据在连接器中维护；草稿不生效，能力发布不授予使用权限。</p>
    {error&&<Alert type="error" title={error} showIcon action={<Button type="text" onClick={()=>void run(async()=>{await load();})}>重新读取</Button>}/>}
    {receipt&&<p role="status">{receipt}</p>}
    <div className="operation-columns"><div className="operation-list"><Table size="small" loading={!loaded&&!error} rowKey={r=>`${r.id}@${r.version}`} dataSource={rows} pagination={false} columns={[
      {title:'能力',render:(_,r:OperationRow)=><Button type="link" onClick={()=>open(r)} disabled={busy}>{r.published?.name||r.draft?.name||r.id} · v{r.version}</Button>},
      {title:'状态',render:(_,r:OperationRow)=><><Tag>{statusNames[r.status]}</Tag>{r.draft&&r.status!=='draft'&&<span> · 有草稿</span>}</>},
    ]}/></div>
    <div className="operation-editor"><h3>{selected?`${selected.id} @ ${selected.version}`:'注册新能力'}{dirty?' · 未保存':''}</h3>
    <HorizontalForm disabled={busy} onFinish={()=>void save()}>
      <Form.Item label="能力标识"><Input aria-label="能力标识" value={edit.id} disabled={!!selected} onChange={e=>change({id:e.target.value})}/></Form.Item>
      <Form.Item label="协议版本"><InputNumber aria-label="协议版本" min={1} precision={0} value={edit.version} disabled={!!selected} onChange={v=>change({version:Number(v)})}/></Form.Item>
      <Form.Item label="名称"><Input aria-label="能力名称" value={edit.name} onChange={e=>change({name:e.target.value})}/></Form.Item>
      <Form.Item label="用途与边界"><Input.TextArea aria-label="用途与边界" value={edit.description} autoSize={{minRows:2,maxRows:5}} onChange={e=>change({description:e.target.value})}/></Form.Item>
      <Form.Item label="副作用"><Select aria-label="副作用" value={edit.effect} options={[{value:'read',label:'只读'},{value:'draft',label:'生成草稿'},{value:'write',label:'正式写入'}]} onChange={v=>change({effect:v})}/></Form.Item>
      <Form.Item label="风险等级"><Select aria-label="风险等级" value={edit.risk} options={['R1','R2','R3'].map(value=>({value,label:value}))} onChange={v=>change({risk:v})}/></Form.Item>
      <Form.Item label="执行方式"><Checkbox checked={edit.asynchronous} onChange={e=>change({asynchronous:e.target.checked})}>异步作业（必须复用已有进度、取消及恢复机制）</Checkbox></Form.Item>
      <Form.Item label="连接器"><Select aria-label="能力连接器" value={edit.implementation.connector||undefined} options={connectors.map(c=>({value:String(c.id),label:String(c.label||c.id)}))} onChange={v=>changeImplementation({connector:v})}/></Form.Item>
      <Form.Item label="工具名称"><Input aria-label="工具名称" value={edit.implementation.tool} onChange={e=>changeImplementation({tool:e.target.value})}/></Form.Item>
      <Form.Item label="实现版本"><InputNumber aria-label="实现版本" min={1} precision={0} value={edit.implementation.version} onChange={v=>changeImplementation({version:Number(v)})}/></Form.Item>
      <Form.Item label="输入 schema" className="ui-field-stacked"><Input.TextArea aria-label="输入 schema" value={schema} autoSize={{minRows:4,maxRows:12}} onChange={e=>{setSchema(e.target.value);setDirty(true);setPreview(null);}}/></Form.Item>
      <Form.Item label="参数映射 JSON" className="ui-field-stacked"><Input.TextArea aria-label="参数映射 JSON" value={mapping} autoSize={{minRows:3,maxRows:10}} onChange={e=>{setMapping(e.target.value);setDirty(true);setPreview(null);}}/></Form.Item>
      <Form.Item label="结果映射 JSON" className="ui-field-stacked"><Input.TextArea aria-label="结果映射 JSON" value={result} autoSize={{minRows:2,maxRows:10}} onChange={e=>{setResult(e.target.value);setDirty(true);setPreview(null);}}/></Form.Item>
      <Form.Item label="变更原因"><Input aria-label="变更原因" value={reason} onChange={e=>setReason(e.target.value)}/></Form.Item>
      <ActionGroup><Button type={preview||confirmOpen?"text":"primary"} htmlType="submit" loading={busy}>保存草稿</Button><Button type="text" onClick={()=>void prepare('publish')} disabled={!selected?.draft||dirty||busy}>核对发布</Button><Button type="text" danger onClick={()=>void prepare('disable')} disabled={!selected?.published||selected.status==='disabled'||dirty||busy}>核对停用</Button>{selected&&<Button type="text" onClick={()=>open(null,{...edit,version:edit.version+1})}>注册新协议版本</Button>}</ActionGroup>
    </HorizontalForm>
    {selected&&<><PropertyList items={[{key:'revision',label:'治理修订',value:selected.revision},{key:'status',label:'正式状态',value:statusNames[selected.status]},{key:'consumers',label:'引用技能',value:selected.used_by.map(s=>s.title+(s.optional?'（可选）':'')).join('、')||'无'}]}/><h3>发布历史</h3>{history.length?history.map(v=><div key={v.receipt_id} className="operation-history"><span>修订 {v.revision} · {v.action} · {v.reason}</span>{v.definition&&<Button type="text" disabled={busy||dirty} onClick={()=>void prepare('restore',v.receipt_id)}>核对回滚到此版本</Button>}</div>):<p>尚无治理发布记录；随平台发布的基线不冒充历史快照。</p>}</>}
    </div></div>
    <Modal className="operation-preview" open={!!preview} title="核对能力生效内容" onCancel={()=>setPreview(null)} footer={<Button onClick={commit}>继续确认生效</Button>} width="var(--dialog-w-lg)">
      {preview&&<><p>{preview.notice}</p><p>受影响技能：{preview.used_by.map(s=>s.title+(s.optional?'（可选）':'')).join('、')||'无'}</p><h4>当前正式内容</h4><pre className="operation-json">{preview.previous?json(preview.previous):'null'}</pre><h4>生效后内容（停用时为 null）</h4><pre className="operation-json">{preview.next?json(preview.next):'null'}</pre><p>确认有效期至 {new Date(preview.expiresAt).toLocaleString()}</p></>}
    </Modal>{node}
  </section>;
}
