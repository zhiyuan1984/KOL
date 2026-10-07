import { useCallback,useState } from "react";
import { Link } from "react-router-dom";
import type { KnowledgeRow,KnowledgeBaseRow } from "../../api";
import { api } from "../../api";
import { reviewApi } from "../../reviews/api";
import { formatKbTime,kindLabel,statusLabel,brandLabel,kbDateOnly } from "../../knowledgeCopy";
import { useKbData,structuredDisplay,type Row,errorMessage,KB_BRANDS } from "./shared";
import EntryEditor from "./EntryEditor";
import EntryView from "./EntryView";
import PublicationPanel from "./PublicationPanel";
import WorkspaceActions from "./WorkspaceActions";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import {stageLabel} from "../../labels";

type Detail={row:KnowledgeRow;versions:Row[];actions:{edit:boolean;revision:boolean;delete:boolean;submit:boolean;archive:boolean}};
export default function WorkspaceEntry({id,bases,mode,onMode,onDirty,onSaved,notify}:{id:string;bases:KnowledgeBaseRow[];mode:string;onMode:(mode:"detail"|"edit"|"review"|"list")=>void;onDirty:(d:boolean)=>void;onSaved:()=>void;notify:(s:string)=>void}) {
  const load=useCallback(()=>reviewApi<Detail>(`/admin/knowledge/workspace-v1/entries/${encodeURIComponent(id)}`),[id]);
  const {data,error,loading,reload}=useKbData(load),[busy,setBusy]=useState(false),[actionError,setActionError]=useState("");
  const confirm=useAdminConfirm();
  const refresh=()=>{reload();onSaved();};
  const revise=async()=>{if(!data||busy)return;setBusy(true);setActionError("");try{await reviewApi(`/admin/knowledge/workspace-v1/entries/${encodeURIComponent(id)}/revision`,{expectedRevision:data.row.updated_at});refresh();onMode("edit");}catch(e){setActionError(errorMessage(e));}finally{setBusy(false);}};
  if(error)return <p role="alert">{error}<button onClick={reload}>重新加载</button></p>;
  if(!data)return <p role="status">正在读取知识…</p>;
  if(!data.row)return <p role="alert">知识数据不完整，请刷新重试。<button onClick={reload}>重新加载</button></p>;
  const row=data.row, version=row.current_version || 1;
  if(mode==="edit")return <EntryEditor row={row} bases={bases} onSaved={()=>{notify("草稿已保存");refresh();onMode("detail");}} onCancel={()=>onMode("detail")} onDirty={onDirty} />;
  return <>{confirm.dialog}
    <header className="kbw-identity"><h2>{row.title}</h2><span className="kbv-status">{String((row as unknown as Row).publication_label || statusLabel(row.status))} · v{version}</span></header>
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {mode!=="review" && <><section><h3>基础信息</h3><dl className="kbw-properties">
      <div><dt>知识标识</dt><dd>{row.id}</dd></div><div><dt>类型</dt><dd>{kindLabel(row.kind)}</dd></div>
      <div className="kbw-wide"><dt>分类</dt><dd>{[row.family_name,row.domain_name,row.base_name].filter(Boolean).join(" / ") || "未分类"}</dd></div>
      <div><dt>品牌 / 语言</dt><dd>{brandLabel(row.brand)} · {row.lang === "zh" ? "中文" : row.lang === "en" ? "英文" : (row.lang || "未记录")}</dd></div><div><dt>维护人</dt><dd>{row.created_by || "未记录"}</dd></div>
      <div><dt>内容模型</dt><dd>{row.base_kind==="unstructured"?"文件知识":"在线知识"}</dd></div><div><dt>到期时间</dt><dd>{row.expires_at ? (kbDateOnly(row.expires_at) || "未设置") : "未设置"}</dd></div>
      <div className="kbw-wide"><dt>适用阶段</dt><dd>{row.stage_codes?.length?row.stage_codes.map(code=>stageLabel(code)).join(" / "):"全阶段"}</dd></div>
      {row.tags && <div><dt>标签</dt><dd>{row.tags}</dd></div>}
    </dl></section><section><h3>知识内容</h3>{structuredDisplay(row.kind,row.structured).map(f=><div className="kbw-content-field" key={f.key}><strong>{f.label}</strong><p className="kbv-body">{f.value}</p></div>)}<p className="kbv-body">{row.body || "暂无正文"}</p></section></>}
    <PublicationPanel id={id} assetType="entry" mode={mode==="review"?"review":"detail"} onInitiate={()=>onMode("review")} onSubmitted={()=>onMode("detail")} onDirty={onDirty} notify={notify} refreshDocument={refresh} />
    {mode!=="review" && row.approved_at && <p>已发布版本审批：{String((row as unknown as Row).approved_by || "未记录")} · {formatKbTime(row.approved_at)}</p>}
    {mode!=="review" && <><section><h3>来源与记录</h3><p>{row.created_by || "在线编辑"} · 创建于 {formatKbTime(row.created_at)} · 更新于 {formatKbTime(row.updated_at)}</p>{row.published_version && row.published_version!==version && <p>原已发布 v{row.published_version} 继续生效。</p>}
      <details><summary>版本、范围与引用记录</summary><div className="kbw-maintenance-actions">{data.actions.archive && <button className="btn" onClick={()=>confirm.ask({kind:"knowledge-archive",title:"确认停用已发布版本",object:`${row.title} · v${version}`,scope:"当前知识",consequence:"停止后续使用，保留历史与审批记录。",confirmLabel:"停用",confirmTone:"danger"},async()=>{await api.archiveKnowledge(id);refresh();})}>停用已发布版本</button>}{row.kind==="mail_template" && KB_BRANDS.filter(b=>b!==row.brand).map(b=><button className="btn" key={b} onClick={()=>void api.transferKnowledgeBrand(id,b).then(()=>{notify("品牌复制提案已提交");refresh();}).catch(e=>setActionError(errorMessage(e)))}>复制到 {brandLabel(b)}</button>)}</div><EntryView id={id} maintenanceOnly notify={notify} fail={e=>setActionError(errorMessage(e))} /></details></section>
      <WorkspaceActions>{data.actions.delete && <button className="btn danger kbw-delete" disabled={busy} onClick={()=>confirm.ask({kind:"knowledge-hard-delete",title:"确认删除草稿",object:`${row.title} · v${version}`,scope:"当前知识草稿",consequence:"删除此未发布知识；不可恢复。",confirmLabel:"删除草稿",confirmTone:"danger"},async()=>{const receipt=await reviewApi<{id:string}>(`/admin/knowledge/workspace-v1/entries/${encodeURIComponent(id)}`,{expectedRevision:row.updated_at},"DELETE");notify(`草稿已删除 · 回执 ${receipt.id}`);onSaved();onMode("list");})}>删除草稿</button>}
        {data.actions.edit && <button className="btn" disabled={loading||busy} onClick={()=>onMode("edit")}>修订</button>}
        {data.actions.revision && <button className="btn" disabled={busy} onClick={()=>void revise()}>{busy?"处理中…":"创建新版本草稿"}</button>}
        <button className="btn" disabled={loading||busy} onClick={refresh}>刷新资料</button>
      </WorkspaceActions></>}
  </>;
}
