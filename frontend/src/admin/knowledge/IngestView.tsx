import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { KnowledgeDocumentDetail } from "../../api";
import { knowledgeDocumentArchiveConfirm, knowledgeDocumentDeleteConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import {
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  KB_DOC_ACTION,
  KB_DOC_EMPTY,
  formatKbTime,
  jobStatusLabel as rawJobStatusLabel,
} from "../../knowledgeCopy";
import { Link, useLocation } from "react-router-dom";
import { reviewCompany } from "../../reviews/api";
import IngestDocumentDetails from "./IngestDocumentDetails";
import { formatBytes, textValue, useKbData, type KbFeed, type Row } from "./shared";

/** 入库：非结构化资料的 上传 → 规整 → 索引 → 待审 入口；进度与终态全部真实。 */
/** §9.1 空单元格占位：渲染 — 并降到 --text-quiet，不留白格。 */
const emptyCell = <span className="kb-cell-empty">—</span>;

export default function IngestView({ notify, fail, embedded = false }: KbFeed & { embedded?: boolean }) {
  const { ask, dialog } = useAdminConfirm();
  const location = useLocation();
  const load = useCallback(async () => {
    const [health, bases, documents, raw, jobs] = await Promise.all([
      api.adminKnowledgeIndexHealth().catch((): { ok: boolean; mode: string; code?: string; message?: string; python?: string; pageindex?: string } => ({
        ok: false, mode: "", code: "knowledge_index_unavailable", message: "引擎健康检查失败",
      })),
      api.adminKnowledgeBases({ kind: "unstructured" }),
      api.adminKnowledgeDocuments(),
      api.adminKnowledgeRaw(),
      api.adminKnowledgeJobs(),
    ]);
    return { health, bases: bases.bases || [], documents: documents.documents || [], raw, jobs };
  }, [location.search]);
  const { data, error, loading, reload } = useKbData(load);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [baseId, setBaseId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [tab, setTab] = useState<"documents" | "raw" | "jobs">("documents");
  const [detailError, setDetailError] = useState("");
  const detailRequest = useRef(0);
  const [detailId, setDetailId] = useState("");
  const [detail, setDetail] = useState<KnowledgeDocumentDetail | null>(null);

  const health = data?.health;
  const bases = data?.bases || [];
  const documents = data?.documents || [];
  const raw = data?.raw || [];
  const jobs = data?.jobs || [];
  const canUpload = Boolean(health?.ok) && bases.length > 0;

  useEffect(() => {
    if (!data || !data.documents.some(doc => ["uploaded", "normalizing", "indexing", "pending_review"].includes(doc.status)) && !data.jobs.some(job => ["queued", "running"].includes(String(job.status)))) return;
    const timer = window.setInterval(reload, 5000);
    return () => window.clearInterval(timer);
  }, [data, reload]);

  const refreshDetail = async (id: string) => {
    const request = ++detailRequest.current;
    setDetailError("");
    try {
      const next = await api.adminKnowledgeDocument(id);
      if (detailRequest.current === request) setDetail(next);
    } catch (cause) {
      if (detailRequest.current === request) setDetailError(cause instanceof Error ? cause.message : "详情读取失败");
    }
  };

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
      if (detailId) void refreshDetail(detailId);
    } catch (cause) {
      fail(cause);
    }
  };

  const openDetail = async (id: string, keepOpen = false) => {
    if (detailId === id && !keepOpen) {
      ++detailRequest.current;
      setDetailId("");
      setDetail(null);
      return;
    }
    setDetailId(id);
    setDetail(null);
    await refreshDetail(id);
  };

  const submitUpload = async () => {
    if (!baseId) {
      fail(new Error("先选择非结构化的知识库"));
      return;
    }
    if (!file) {
      fail(new Error("先选择 PDF 文件"));
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setTab("documents");
    try {
      const result = await api.adminKnowledgeDocumentUpload(baseId, file, false, setUploadProgress);
      void openDetail(result.document.id, true);
      notify("已上传，开始规整与建索引；可从资料详情进入加工与审批。");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (cause) {
      fail(cause);
      reload();
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (detailId) void refreshDetail(detailId);
  }, [data, detailId]);

  const rawName = (id: string) => {
    const hit = raw.find((item) => String(item.id) === id);
    return hit ? textValue(hit.filename || hit.source) || id : id;
  };

  const renderDetail = () => {
    const doc = detail?.document;
    return <section id={`kbingest-detail-${detailId}`} className="kbadmin-doc-detail kbingest-file-detail" data-admin-kb-doc-detail-panel={detailId}>
      <div className="kbingest-detail-head">
        <h3>资料详情</h3>
        <button className="kbadmin-action-link" type="button" onClick={() => void openDetail(detailId)}>{KB_DOC_ACTION.collapse}</button>
      </div>
      {detailError ? <p role="alert">{detailError} <button className="kbadmin-action-link" onClick={() => void refreshDetail(detailId)}>重试读取详情</button></p>
        : !detail || !doc ? <p className="muted" role="status">正在加载详情…</p>
        : <IngestDocumentDetails detail={detail} documents={documents} company={reviewCompany()} onOpen={id => void openDetail(id, true)} actions={
          <details className="kbingest-more"><summary>更多操作</summary><div>
            {detail.actions?.start && <button className="kbadmin-action-link" type="button" onClick={() => void run(() => api.adminKnowledgeDocumentAction(doc.id, "start"), "已开始解析；完成后待审核。")}>开始解析</button>}
            {detail.actions?.retry && <button className="kbadmin-action-link" type="button" data-admin-kb-doc-retry={doc.id} onClick={() => void run(() => api.adminKnowledgeDocumentAction(doc.id, "retry"), "已重新排队；从失败阶段继续。")}>{KB_DOC_ACTION.retry}</button>}
            {detail.actions?.cancel && <button className="kbadmin-action-link" type="button" data-admin-kb-doc-cancel={doc.id} onClick={() => void run(() => api.adminKnowledgeDocumentAction(doc.id, "cancel"), "已取消；可重试。")}>{KB_DOC_ACTION.cancel}</button>}
            <button className="kbadmin-action-link" type="button" onClick={() => void refreshDetail(doc.id)}>刷新资料</button>
            {doc.status === "published" && <button className="kbadmin-action-link" type="button" data-admin-kb-doc-archive={doc.id} onClick={() => ask(knowledgeDocumentArchiveConfirm(doc.title), () => run(() => api.adminKnowledgeDocumentAction(doc.id, "archive"), "已归档：不再参与检索。"))}>{KB_DOC_ACTION.archive}</button>}
            {["draft", "uploaded", "pending_review", "failed", "cancelled"].includes(doc.status) && <button className="kbadmin-action-link kbadmin-action-danger" type="button" data-admin-kb-doc-delete={doc.id} onClick={() => ask(knowledgeDocumentDeleteConfirm(doc.title), () => run(() => api.adminKnowledgeDocumentDelete(doc.id), "资料已删除（原文件与索引已清理）。"))}>{KB_DOC_ACTION.remove}</button>}
          </div></details>
        } />}
    </section>;
  };

  return (
    <>
      {dialog}
      {error && <p className="error" role="alert">{error} <button className="kbadmin-action-link" onClick={reload}>重新加载</button></p>}
      {loading && !data && <p className="muted" role="status">正在加载入库数据…</p>}

      {!embedded && <header className="kbingest-head"><Link to="/admin/knowledge" data-admin-kb-home-link>← 返回知识管理</Link><h2>资料入库</h2></header>}
      {!embedded && <article className="kbingest-upload" data-admin-kb-doc-upload>
        <div className="kbadmin-toolbar">
          <label className="field">知识库
            <select
              data-admin-kb-doc-base
              disabled={uploading}
              value={baseId}
              onChange={(event) => setBaseId(event.target.value)}
            >
              <option value="">请选择…</option>
              {bases.map((base) => (
                <option key={base.id} value={base.id}>{base.name}</option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>PDF 文件</span>
            <div className="kbadmin-file-picker">
              <button
                className="btn row-action"
                type="button"
                data-admin-kb-doc-file-pick
                disabled={!canUpload || uploading}
                onClick={() => fileRef.current?.click()}
              >
                选择文件
              </button>
              <span className="kbadmin-file-name" data-admin-kb-doc-filename>{file ? file.name : "未选择文件"}</span>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.mp4,.mov,.webm,.mkv,application/pdf"
                data-admin-kb-doc-file
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </div>
          </div>
          <button
            className="btn work"
            type="button"
            data-admin-kb-doc-upload-submit
            disabled={!canUpload || uploading || !baseId || !file}
            title={health?.ok ? undefined : "知识引擎不可用"}
            onClick={() => void submitUpload()}
          >
            {uploading ? "上传中…" : KB_DOC_ACTION.submit}
          </button>
        </div>
        <div className="kbingest-rule"><span>上传后生成待审资料，审批通过后自动发布并参与检索。</span><details><summary>流程说明</summary><p>先保存原文，再规整、建索引；查看加工结果后提交审批。加工失败可重试，加工中可取消。原文库保留失败会话与旧素材，提取只生成待审草稿；结构化条目在知识库中创建。</p></details></div>
        {health && !health.ok && <p className="muted" data-admin-kb-engine-down>暂时无法上传：{health.message || health.code}。<button className="kbadmin-action-link" onClick={reload}>重新检查</button></p>}
        {file && documents.some(doc => doc.base_id === baseId && doc.filename === file.name) && <p role="status">此知识库已有同名文件，请先核对资料详情；继续上传将创建独立资料。更新版本可在已发布资料详情创建版本草稿。</p>}
        {!bases.length && !loading ? <p className="muted">{KB_DOC_EMPTY.bases}</p> : null}
      </article>}

      <nav className="kbingest-tabs" aria-label="入库内容">
        {([['documents', '资料', documents.length], ['raw', '原文库', raw.length], ['jobs', '提取作业', jobs.length]] as const).map(([key, label, count]) => <button key={key} type="button" aria-pressed={tab === key} aria-controls={`kbingest-${key}`} onClick={() => setTab(key)}>{label} <span>{count}</span></button>)}
      </nav>
      {tab === "documents" && <article id="kbingest-documents" className="kbingest-worktable" data-admin-kb-documents>
        {!documents.length && !loading && !uploading ? <p className="muted">{KB_DOC_EMPTY.documentsAll}</p> : null}
        {documents.length || uploading ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-kb-documents-table>
              <thead>
                <tr>
                  <th scope="col">文件名</th>
                  <th scope="col">资料详情</th>
                </tr>
              </thead>
              <tbody>
                {uploading && file && <tr data-admin-kb-upload-progress><td title={file.name}>{file.name}</td><td role="status">{uploadProgress === 100 ? "正在保存原文与创建作业记录" : `上传中 · ${uploadProgress === null ? "传输进度未获取" : `${uploadProgress}%`}`}</td></tr>}
                {documents.map((doc) => {
                  const status = String(doc.status || "");
                  return (
                    <Fragment key={doc.id}><tr className={detailId === doc.id ? "is-selected" : ""} data-admin-kb-doc={doc.id} data-admin-kb-doc-status={status}>
                      <td>
                        <button
                          className="kbadmin-title-link"
                          type="button"
                          title={doc.filename || doc.title}
                          data-admin-kb-doc-detail={doc.id}
                          aria-expanded={detailId === doc.id}
                          aria-controls={`kbingest-detail-${doc.id}`}
                          onClick={() => void openDetail(doc.id)}
                        >
                          <span aria-hidden="true">{detailId === doc.id ? "▾" : "▸"}</span><span className="kbingest-filename">{doc.filename || doc.title}</span>
                        </button>
                      </td>
                      <td><button className="kbadmin-action-link" type="button" data-admin-kb-doc-details-link={doc.id} aria-expanded={detailId === doc.id} aria-controls={`kbingest-detail-${doc.id}`} onClick={() => void openDetail(doc.id, true)}>资料详情</button></td>
                    </tr>
                    {detailId === doc.id ? <tr className="kbingest-detail-row"><td colSpan={2}>{renderDetail()}</td></tr> : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

      </article>}

      {tab === "raw" && <article id="kbingest-raw" className="kbingest-worktable" data-admin-knowledge-ingest>
        {raw.map((item: Row) => (
          <article className="admin-row" key={String(item.id)} data-admin-kb-raw={String(item.id)}>
            <div>
              <strong>{textValue(item.filename || item.source) || String(item.id)}</strong>
              <p className="muted">
                {textValue(item.source) || "上传"} · {formatKbTime(textValue(item.created_at)) || "—"}
                {textValue(item.uploaded_by) ? ` · ${textValue(item.uploaded_by)}` : ""}
              </p>
            </div>
            <button
              className="kbadmin-action-link"
              type="button"
              data-admin-kb-extract={String(item.id)}
              onClick={() => void run(
                () => api.extractKnowledge(String(item.id)),
                "已抽取为待审草稿，未发布。",
              )}
            >
              {KB_ADMIN_ACTION.extract}
            </button>
          </article>
        ))}
        {!raw.length && !loading ? <p className="muted">{KB_ADMIN_EMPTY.ingestRaw}</p> : null}
      </article>}

      {tab === "jobs" && <article id="kbingest-jobs" className="kbingest-worktable" data-admin-kb-jobs>
        {jobs.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-kb-jobs-table>
              <thead>
                <tr>
                  <th>原文</th>
                  <th>状态 / 进度</th>
                  <th>结果</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job: Row) => {
                  const status = String(job.status || "");
                  const failed = status === "failed";
                  return (
                    <tr key={String(job.id)} data-admin-kb-job={String(job.id)}>
                      <td>{rawName(String(job.raw_id || "")) || emptyCell}</td>
                      <td>{rawJobStatusLabel(status) || status || emptyCell}</td>
                      <td>
                        {/* §15：待审页的内部 ID 不进正文行；有结果就说结果，要追溯走 data-admin-kb-job 与详情。 */}
                        {job.result_knowledge_id
                          ? "已生成待审页"
                          : textValue(job.error) || (failed ? "抽取失败" : "等待结果")}
                      </td>
                      <td>{formatKbTime(textValue(job.created_at)) || emptyCell}</td>
                      <td>
                        {failed && job.raw_id ? (
                          <button
                            className="kbadmin-action-link"
                            type="button"
                            data-admin-kb-retry={String(job.raw_id)}
                            onClick={() => void run(
                              () => api.extractKnowledge(String(job.raw_id)),
                              "已重新提交抽取，仍会生成待审草稿。",
                            )}
                          >
                            {KB_ADMIN_ACTION.retry}
                          </button>
                        ) : (
                          <span className="muted">{job.result_knowledge_id ? "已入待审" : "无需操作"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{KB_ADMIN_EMPTY.ingestJobs}</p>
        )}
      </article>}
    </>
  );
}
