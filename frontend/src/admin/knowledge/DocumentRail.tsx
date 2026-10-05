import { useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { kbDocStatusLabel } from "../../knowledgeCopy";
import { useKbData } from "./shared";
import PublicationPanel from "./PublicationPanel";
import { reviewHeaders } from "../../reviews/api";

export default function DocumentRail({ id, path, reload, notify, fail }: {
  id: string; path: string; reload: () => void; notify: (message: string) => void; fail: (cause: unknown) => void;
}) {
  const load = useCallback(() => api.adminKnowledgeDocument(id), [id]);
  const { data, error, loading, reload: refresh } = useKbData(load);
  const doc = data?.document;
  const replace = async (file: File) => {
    if(!doc) return;
    try {
      const form=new FormData();form.append("file",file);form.append("updated_at",doc.updated_at);
      const response=await fetch(`/api/admin/knowledge/documents/${encodeURIComponent(id)}/draft-file`,{method:"PUT",headers:reviewHeaders(),body:form});
      const body=await response.json();if(!response.ok) throw new Error(body.detail?.message || body.detail || "替换失败");
      notify("草稿原件已替换，尚未解析或发布。");refresh();reload();
    }catch(cause){fail(cause);}
  };
  const start = async () => {
    try { await api.adminKnowledgeDocumentAction(id, "start"); notify("已开始解析；完成后待审核，不自动发布。"); refresh(); reload(); }
    catch (cause) { fail(cause); }
  };
  return <>
    <div className="kbv-rail-head"><h2>{doc?.title || "文件资料"}</h2></div>
    <div className="kbv-rail-body">
      {loading && <p role="status">正在读取资料…</p>}
      {error && <p role="alert">{String(error)}</p>}
      {doc && <>
        <p>{path}</p><p>{!["pending_review","published","archived"].includes(doc.status) && `${kbDocStatusLabel(doc.status)} · `}非结构化 PDF</p>
        <p>{doc.filename}</p>
        {doc.error && <p role="alert">{doc.error}</p>}
        {doc.status === "draft" && <p>原件已保存，尚未解析；不会参与员工问答。</p>}
        {doc.status === "draft" && <label>替换草稿原件<input type="file" accept=".pdf,application/pdf" onChange={e=>{
          const file=e.currentTarget.files?.[0];e.currentTarget.value="";if(file)void replace(file);
        }} /></label>}
        <a className="kbv-link-plain" href={`/api/admin/knowledge/documents/${encodeURIComponent(id)}/file`} target="_blank" rel="noreferrer">查看 PDF 原件</a>
        {doc.status === "draft" && <button className="btn" type="button" onClick={() => void start()}>解析并准备审批</button>}
        <PublicationPanel id={id} updatedAt={doc.updated_at} reload={()=>{refresh();reload();}} />
        <p><Link to="/admin/knowledge/ingest">查看加工进度与恢复操作 →</Link></p>
        <p><Link to={`/admin/knowledge/bases/${encodeURIComponent(doc.base_id)}`}>查看知识库与管理端试算 →</Link></p>
      </>}
    </div>
  </>;
}
