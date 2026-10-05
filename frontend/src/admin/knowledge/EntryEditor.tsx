import { useRef, useState } from "react";
import type { KnowledgeBaseRow, KnowledgeRow } from "../../api";
import { reviewApi, ReviewApiError } from "../../reviews/api";
import { KNOWLEDGE_KIND_SPECS, KB_BRANDS, KB_LANGS, kindFields, splitList, type Row } from "./shared";
import { kindLabel,brandLabel } from "../../knowledgeCopy";
import StructuredFields from "./StructuredFields";
import WorkspaceActions from "./WorkspaceActions";

type Props={row?:KnowledgeRow;bases:KnowledgeBaseRow[];onSaved:(row:KnowledgeRow)=>void;onCancel:()=>void;onDirty:(dirty:boolean)=>void};
export default function EntryEditor({row,bases,onSaved,onCancel,onDirty}:Props) {
  const [kind,setKind]=useState(row?.kind || "policy"),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [issues,setIssues]=useState<{path:string;message:string}[]>([]);
  const kindCache=useRef<Record<string,Row>>({[row?.kind || "policy"]:row?.structured || {}});
  const changeKind=(next:string)=>{const current:Row={...kindCache.current[kind]};if(formRef.current){const values=new FormData(formRef.current);for(const field of kindFields(kind)){const v=String(values.get(`structured:${field.key}`)||"");current[field.key]=field.type==="string_list"?splitList(v):v;}}kindCache.current[kind]=current;setKind(next);};
  const formRef=useRef<HTMLFormElement>(null),lock=useRef(false);
  const writable=bases.filter(b=>b.status==="active");
  const defaultBase=row?.base_id || writable.find(b=>b.code==="legacy" && b.kind==="structured")?.id || writable.find(b=>b.kind==="structured")?.id || "";
  const save=async()=>{
    if(lock.current || !formRef.current)return;
    lock.current=true;setBusy(true);setError("");setIssues([]);
    const form=new FormData(formRef.current),structured:Row=kind===row?.kind ? {...row.structured}:{};
    for(const field of kindFields(kind)) {const value=String(form.get(`structured:${field.key}`) || "");structured[field.key]=field.type==="string_list"?splitList(value):value;}
    const input={title:String(form.get("title") || "").trim(),kind,base_id:String(form.get("base_id") || ""),brand:String(form.get("brand")||"*"),lang:String(form.get("lang")||"en"),
      tags:String(form.get("tags")||""),stage_codes:splitList(String(form.get("stage_codes")||"")),body:String(form.get("body")||""),structured,expectedRevision:row?.updated_at};
    try {
      const saved=await reviewApi<KnowledgeRow>(`/admin/knowledge/workspace-v1/entries${row ? "/"+encodeURIComponent(row.id):""}`,input,row?"PUT":"POST");
      onDirty(false);onSaved(saved);
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"保存失败");
      if(cause instanceof ReviewApiError && typeof cause.detail!=="string") {const list=cause.detail.issues || [];setIssues(list);if(list[0]) (formRef.current.elements.namedItem(list[0].path) as HTMLElement|null)?.focus();}
    } finally {lock.current=false;setBusy(false);}
  };
  return <><form ref={formRef} className="kbw-editor" onChange={()=>onDirty(true)} onSubmit={e=>{e.preventDefault();void save();}} aria-busy={busy}>
    <div className="kbw-field-grid">
      <label>标题<input name="title" defaultValue={row?.title || ""} autoFocus aria-invalid={issues.some(i=>i.path==="title")} />{issues.filter(i=>i.path==="title").map(i=><span className="error" key={i.path}>{i.message}</span>)}</label>
      <label>类型<select name="kind" value={kind} onChange={e=>changeKind(e.target.value)}>{KNOWLEDGE_KIND_SPECS.map(s=><option key={s.code} value={s.code}>{kindLabel(s.code)}</option>)}</select></label>
      <label>知识库<select name="base_id" defaultValue={defaultBase}><option value="">请选择知识库</option>{writable.map(b=><option key={b.id} value={b.id}>{[b.family_name,b.domain_name,b.name].filter(Boolean).join(" / ")}</option>)}</select></label>
      <label>适用品牌<select name="brand" defaultValue={row?.brand || "*"}><option value="*">全品牌</option>{KB_BRANDS.map(b=><option key={b} value={b}>{brandLabel(b)}</option>)}</select></label>
      <label>语言<select name="lang" defaultValue={row?.lang || "en"}>{KB_LANGS.map(l=><option key={l} value={l}>{l}</option>)}</select></label>
      <label>标签<input name="tags" defaultValue={row?.tags || ""} /></label>
      <label className="kbw-wide">适用阶段<input name="stage_codes" defaultValue={(row?.stage_codes || []).join(" ")} /></label>
    </div>
    <StructuredFields key={kind} kind={kind} defaults={kindCache.current[kind]} errors={issues} />
    <label>正文<textarea name="body" rows={12} defaultValue={row?.body || ""} /></label>
    {issues.filter(i=>i.path!=="title" && !i.path.startsWith("structured:")).map(i=><p className="error" key={i.path} data-field-error={i.path}>{i.message}</p>)}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="muted">保存仅更新当前草稿，未发布版本不参与员工问答。</p>
  </form><WorkspaceActions><button className="btn" disabled={busy} onClick={onCancel}>取消编辑</button><button className="btn work" disabled={busy} onClick={()=>void save()}>{busy?"保存中…":"保存"}</button></WorkspaceActions></>;
}
