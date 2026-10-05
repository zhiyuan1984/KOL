import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import PublicationPanel from "./PublicationPanel";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { KB_DOC_JOB_KIND_LABEL, KB_DOC_JOB_STATUS_LABEL, formatKbTime, kbDocProgressText } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";
import { errorMessage, useKbData } from "./shared";

export default function DocumentRail({ id, path, reload, notify }: {
  id: string; path: string; reload: () => void; notify: (message: string) => void; fail: (cause: unknown) => void;
}) {
  const load = useCallback(() => api.adminKnowledgeDocument(id), [id]);
  const { data, error, loading, reload: refresh } = useKbData(load);
  const { ask, dialog, open: confirming } = useAdminConfirm();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionTarget, setActionTarget] = useState<HTMLDivElement|null>(null);
  const lock = useRef(false);
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

  const blocked = busy || loading || Boolean(error) || confirming;
  return <>
    {dialog}
    <div className="kbv-rail-head"><h2>资料详情</h2></div>
    <div className="kbv-rail-body kbv-document-body" aria-busy={busy || loading}>
      {loading && !data && <p role="status">正在读取资料…</p>}
      {error && <div className="kbv-document-notice" role="alert"><KbvIcon name="status" /><span>{error}</span><button className="kbv-text-action" disabled={loading} onClick={refresh}>重新检查</button></div>}
      {actionError && !confirming && <p className="error" role="alert">{actionError}</p>}
      {doc && data && <>
        {path && <div className="kbv-document-path" aria-label="资料分类">{path.split(" / ").map((part, index) => <span key={`${index}-${part}`}>{part}</span>)}</div>}
        <section className="kbv-document-source">
          <h3>非结构化 PDF</h3>
          <p>{doc.filename}</p>
          <a className="kbv-link-plain" href={`/api/admin/knowledge/documents/${encodeURIComponent(id)}/file`} target="_blank" rel="noreferrer"><KbvIcon name="file" />查看 PDF 原件<span className="sr-only">（新窗口打开）</span></a>
        </section>
        {doc.error && <div className="kbv-document-notice" role="alert"><KbvIcon name="status" /><span>{doc.error}</span><button className="kbv-text-action" disabled={blocked} onClick={refresh}>重新检查</button></div>}
        {processing && <p role="status" className="kbv-document-progress">{progress || "等待加工服务处理已提交的资料"} · 自动刷新中</p>}
        {doc.status === "draft" && <p>原件已保存，尚未解析；不会参与员工问答。</p>}
        {doc.status === "pending_review" && <p>解析已完成，请核对原件与加工结果后提交审批。</p>}
        {doc.status === "cancelled" && <p>加工已取消，可重试恢复；未发布资料不参与员工问答。</p>}
        {["pending_review", "published"].includes(doc.status) && <PublicationPanel key={id} id={id} notify={notify} actionTarget={actionTarget} refreshDocument={() => { refresh(); reload(); }} />}
        <details className="kbv-document-history">
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
        </div>
      </>}
    </div>
    {doc && <footer className="kbv-rail-foot kbv-document-foot">
      <p className="muted">未发布资料不参与员工问答。</p>
      <div className="kbv-actions">
        <div ref={setActionTarget} className="kbv-publication-primary" />
        {doc.status === "draft" && <button className="btn work" data-kbv-doc-action="start" disabled={blocked} onClick={() => void run("start", "已提交解析，完成后待审核，不自动发布")}>{busy ? "提交中…" : "开始解析"}</button>}

        {["failed", "cancelled"].includes(doc.status) && <button className="btn work" data-kbv-doc-action="retry" disabled={blocked} onClick={() => void run("retry", "已提交重试，完成后待审核")}>{busy ? "提交中…" : "重试加工"}</button>}
        {processing && <button className="btn" data-kbv-doc-action="cancel" disabled={blocked} onClick={() => void run("cancel", "已提交取消加工")}>取消加工</button>}
        <button className="kbv-text-action" disabled={busy || loading || confirming} onClick={refresh}>{loading ? "检查中…" : "刷新资料"}</button>
      </div>
    </footer>}
  </>;
}
