import WorkspaceActions from "./WorkspaceActions";
import { reviewApi, reviewHeaders,reviewCompany } from "../../reviews/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import PublicationPanel from "./PublicationPanel";
import KnowledgeScopePanel from './KnowledgeScopePanel';
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { KB_DOC_JOB_KIND_LABEL, KB_DOC_JOB_STATUS_LABEL, formatKbTime, kbDocProgressText,kbDocStatusLabel } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";
import { errorMessage, formatBytes, useKbData } from "./shared";

export default function DocumentRail({ id, path, reload, notify,mode="detail",onMode,onRevision,onDirty }: {
  mode?:string;onMode?:(mode:"detail"|"edit"|"review")=>void;onRevision?:(id:string)=>void;onDirty?:(dirty:boolean)=>void;
  id: string; path: string; reload: () => void; notify: (message: string) => void; fail: (cause: unknown) => void;
}) {
  const load = useCallback(() => api.adminKnowledgeDocument(id), [id]);
  const { data, error, loading, reload: refresh } = useKbData(load);
  const { ask, dialog, open: confirming } = useAdminConfirm();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const lock = useRef(false);
  const [replacement,setReplacement]=useState<File|null>(null);
  const [scopeReady,setScopeReady]=useState(false);
  const doc = data?.document;
  const processing = Boolean(doc && ["uploaded", "normalizing", "indexing"].includes(doc.status));
  const progress = doc ? kbDocProgressText(doc) : "";
  const previousStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!doc) return;
    if (previousStatus.current && previousStatus.current !== doc.status) reload();
    previousStatus.current = doc.status;
  }, [doc?.status, reload]);

  // Follow only a real persisted job; changing selection cleans up the timer.
  useEffect(() => {
    if (!processing || loading || error || busy || confirming) return;
    const timer = window.setTimeout(refresh, 3000);
    return () => window.clearTimeout(timer);
  }, [processing, loading, error, busy, confirming, refresh]);

  const run = async (action: "start" | "retry" | "cancel", message: string, propagate = false) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    try {
      const result = await api.adminKnowledgeDocumentAction(id, action);
      notify(`${message} · 回执 ${result.document.id} · ${formatKbTime(result.document.updated_at)}`);
      refresh();
      reload();
    } catch (cause) {
      setActionError(errorMessage(cause));
      if (propagate) throw cause;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  async function replace(file:File) {
    if(!doc)return;
    setBusy(true);setActionError("");
    try {
      const form=new FormData();form.append("file",file);form.append("updated_at",doc.updated_at);
      const response=await fetch(`/api/admin/knowledge/documents/${encodeURIComponent(id)}/draft-file`,{method:"PUT",headers:reviewHeaders(),body:form});
      const body=await response.json();if(!response.ok)throw new Error(body.detail?.message || body.detail || "替换失败");
      notify("草稿原件已替换，尚未解析或发布");setReplacement(null);onDirty?.(false);refresh();reload();onMode?.("detail");
    }catch(cause){setActionError(errorMessage(cause));}finally{setBusy(false);}
  }
  async function revision() {
    setBusy(true);setActionError("");
    try {const r=await reviewApi<{document_id:string}>(`/admin/knowledge/documents/${encodeURIComponent(id)}/revision`,{});onRevision?.(r.document_id);setBusy(false);}
    catch(cause){setActionError(errorMessage(cause));setBusy(false);}
  }
  const blocked = busy || loading || Boolean(error) || confirming;
  // 本视口唯一的实底 L1（DESIGN §1 不变量 1 / §4.2）：由「当前状态唯一可推进的动作」决定。
  // 审批/发布面板接管时（或确认弹窗打开时）资料侧全部降为 L3 文字按钮，避免同视口多个实底。
  const publicationMounted = Boolean(doc && ["pending_review", "published"].includes(doc.status) && (scopeReady || mode === "review"));
  const primary: "start" | "retry" | "revision" | "save" | null = mode === "edit"
    ? "save"
    : confirming || publicationMounted
      ? null
      : data?.actions?.start
        ? "start"
        : data?.actions?.retry
          ? "retry"
          : data?.actions?.revision
            ? "revision"
            : null;
  const cta = (action: "start" | "retry" | "revision") => (primary === action ? "btn work" : "kbv-text-action");
  return <>
    {dialog}
    <div className="kbv-rail-body kbv-document-body" aria-busy={busy || loading}>
      {loading && !data && <p role="status">正在读取资料…</p>}
      {error && <div className="kbv-document-notice" role="alert"><KbvIcon name="status" /><span>{error}</span><button className="kbv-text-action" disabled={loading} onClick={refresh}>重新检查</button></div>}
      {actionError && !confirming && <p className="error" role="alert">{actionError}</p>}
      {doc && data && <>
        <h2 className="kbv-document-title">{doc.title}</h2>
        <span className="kbv-status">{doc.publication_label || kbDocStatusLabel(doc.status)} · v{doc.current_version || 1}</span>
        {mode!=="review" && <dl className="kbw-properties"><div><dt>维护人</dt><dd>{doc.created_by || "未记录"}</dd></div><div><dt>文件大小</dt><dd>{doc.size_bytes ? formatBytes(Number(doc.size_bytes)) : "—"}</dd></div><div><dt>创建时间</dt><dd>{formatKbTime(doc.created_at)}</dd></div><div><dt>更新时间</dt><dd>{formatKbTime(doc.updated_at)}</dd></div>{doc.published_at && <div><dt>发布时间</dt><dd>{formatKbTime(doc.published_at)}</dd></div>}</dl>}
        {path && <div className="kbv-document-path" aria-label="资料分类">{path.split(" / ").map((part, index) => <span key={`${index}-${part}`}>{part}</span>)}</div>}
        {mode!=="review" && <section className="kbv-document-source">
          <h3>非结构化 PDF</h3>
          <p>{doc.filename}</p>
          <a className="kbv-link-plain" href={`/api/admin/knowledge/documents/${encodeURIComponent(id)}/file${reviewCompany()?"?company="+encodeURIComponent(reviewCompany()):""}`} target="_blank" rel="noreferrer"><KbvIcon name="file" />查看 PDF 原件<span className="sr-only">（新窗口打开）</span></a>
        </section>}
        {doc.error && <div className="kbv-document-notice" role="alert"><KbvIcon name="status" /><span>{doc.error}</span><button className="kbv-text-action" disabled={blocked} onClick={refresh}>重新检查</button></div>}
        {processing && <p role="status" className="kbv-document-progress">{progress || "等待加工服务处理已提交的资料"} · 自动刷新中</p>}
        {doc.status === "draft" && <><p>原件已保存，尚未解析；不会参与员工问答。</p>{mode==="edit" && <label>替换草稿原件<input type="file" disabled={blocked} accept=".pdf,application/pdf" onChange={e=>{const file=e.currentTarget.files?.[0];if(file){setReplacement(file);onDirty?.(true);}}} />{replacement && <p>{replacement.name}</p>}</label>}</>}
        {doc.status === "cancelled" && <p>加工已取消，可重试恢复；未发布资料不参与员工问答。</p>}
        {mode!=='review' && <KnowledgeScopePanel key={id} id={id} onReady={setScopeReady} onDirty={onDirty} onChanged={()=>{refresh();reload();}} />}
        {["pending_review", "published"].includes(doc.status) && (scopeReady || mode==='review') && <PublicationPanel key={id} id={id} mode={mode==="review"?"review":"detail"} ownsPrimary={mode!=="edit"} onInitiate={()=>onMode?.("review")} onSubmitted={()=>onMode?.("detail")} onDirty={onDirty} notify={notify} refreshDocument={() => { refresh(); reload(); }} />}
        {mode!=="review" && <WorkspaceActions><div className="kbv-document-actions">
      <div className="kbv-actions">
        {data.actions?.start && mode!=="edit" && <button className={cta("start")} data-kbv-doc-action="start" disabled={blocked} onClick={() => void run("start", "已提交解析，范围核对与审批通过后自动发布")}>{busy ? "提交中…" : "解析并提取范围"}</button>}

        {data.actions?.edit && mode!=="edit" && <button className="kbv-text-action" disabled={blocked} onClick={()=>onMode?.("edit")}>替换草稿原件</button>}
        {mode==="edit" && <><button className="btn" disabled={blocked} onClick={()=>onMode?.("detail")}>取消编辑</button><button className={primary==="save" ? "btn work":"kbv-text-action"} disabled={blocked || !replacement} onClick={()=>replacement && void replace(replacement)}>{busy?"保存中…":"保存"}</button></>}
        {data.actions?.retry && <button className={cta("retry")} data-kbv-doc-action="retry" disabled={blocked} onClick={() => void run("retry", "已提交重试，完成后待审核")}>{busy ? "提交中…" : "重试加工"}</button>}
        {data.actions?.cancel && <button className="btn" data-kbv-doc-action="cancel" disabled={blocked} onClick={() => void run("cancel", "已提交取消加工")}>取消加工</button>}
        {data.actions?.revision && <button className={cta("revision")} disabled={blocked} onClick={()=>void revision()}>创建新版本草稿</button>}
        <button className="kbv-text-action" disabled={busy || loading || confirming} onClick={refresh}>{loading ? "检查中…" : "刷新资料"}</button>
      </div>
        </div></WorkspaceActions>}
        {mode!=="review" && <><details className="kbv-document-history" open={processing || doc.status==="failed"}>
          <summary>加工记录与来源</summary>
          {doc.created_by && <p>维护责任人：{doc.created_by}</p>}
          {!data.jobs.length ? <p className="muted">暂无加工记录。</p> : <ul>{data.jobs.map(job => <li key={job.id}>
            {KB_DOC_JOB_KIND_LABEL[job.kind] || job.kind} · {KB_DOC_JOB_STATUS_LABEL[job.status] || job.status}
            {job.progress_total > 0 ? ` · ${job.progress_done}/${job.progress_total}` : ""}
            {` · 第 ${job.attempt} 次 · ${formatKbTime(job.finished_at || job.started_at || job.created_at)}`}
            {job.error ? ` · ${job.error}` : ""}
          </li>)}</ul>}
          {data.text_preview && <pre className="kbv-body">{data.text_preview.text}</pre>}
        </details>
        <div className="kbv-document-links">
          <Link to="/admin/knowledge/ingest">查看加工进度与恢复操作 <span aria-hidden="true">→</span></Link>
          <Link to={`/admin/knowledge/bases/${encodeURIComponent(doc.base_id)}`}>查看知识库与管理端试算 <span aria-hidden="true">→</span></Link>
        </div></>}
      </>}
    </div>

  </>;
}
