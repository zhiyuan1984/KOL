import { useCallback, useRef, useState } from "react";
import { api } from "../../api";
import type { KnowledgeDocumentDetail, KnowledgeDocumentRow } from "../../api";
import { knowledgeDocumentArchiveConfirm, knowledgeDocumentDeleteConfirm, knowledgeDocumentPublishConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import {
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  KB_DOC_ACTION,
  KB_DOC_EMPTY,
  KB_DOC_JOB_KIND_LABEL,
  KB_DOC_JOB_STATUS_LABEL,
  KB_INGEST_LEAD,
  formatKbTime,
  jobStatusLabel as rawJobStatusLabel,
  kbDocProgressText,
  kbDocStatusLabel,
} from "../../knowledgeCopy";
import { formatBytes, textValue, useKbData, type KbFeed, type Row } from "./shared";

/** 入库：非结构化资料的 上传 → 规整 → 索引 → 待审 入口；进度与终态全部真实。 */
export default function IngestView({ notify, fail }: KbFeed) {
  const { ask, dialog } = useAdminConfirm();
  const load = useCallback(async () => {
    const [health, bases, documents, raw, jobs] = await Promise.all([
      api.adminKnowledgeIndexHealth().catch((): { ok: boolean; mode: string; code?: string; message?: string; python?: string; pageindex?: string } => ({
        ok: false, mode: "", code: "knowledge_index_unavailable", message: "引擎健康检查失败",
      })),
      api.adminKnowledgeBases({ kind: "unstructured" }),
      api.adminKnowledgeDocuments().catch(() => ({ documents: [] as KnowledgeDocumentRow[] })),
      api.adminKnowledgeRaw(),
      api.adminKnowledgeJobs(),
    ]);
    return { health, bases: bases.bases || [], documents: documents.documents || [], raw, jobs };
  }, []);
  const { data, error, loading, reload } = useKbData(load);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [baseId, setBaseId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [detailId, setDetailId] = useState("");
  const [detail, setDetail] = useState<KnowledgeDocumentDetail | null>(null);

  const health = data?.health;
  const bases = data?.bases || [];
  const documents = data?.documents || [];
  const raw = data?.raw || [];
  const jobs = data?.jobs || [];
  const canUpload = Boolean(health?.ok) && bases.length > 0;

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
      if (detailId) void openDetail(detailId);
    } catch (cause) {
      fail(cause);
    }
  };

  const openDetail = async (id: string) => {
    if (detailId === id) {
      setDetailId("");
      setDetail(null);
      return;
    }
    setDetailId(id);
    setDetail(null);
    try {
      setDetail(await api.adminKnowledgeDocument(id));
    } catch (cause) {
      fail(cause);
    }
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
    try {
      await api.adminKnowledgeDocumentUpload(baseId, file);
      notify("已上传，开始规整与建索引；完成后到「待处置」审批发布。");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (cause) {
      fail(cause);
    } finally {
      setUploading(false);
    }
  };

  const rawName = (id: string) => {
    const hit = raw.find((item) => String(item.id) === id);
    return hit ? textValue(hit.filename || hit.source) || id : id;
  };

  return (
    <>
      {dialog}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && !data && <p className="muted" role="status">正在加载入库数据…</p>}

      <article className="panel" data-admin-kb-doc-upload>
        <div className="admin-section-head">
          <div>
            <h2>上传资料</h2>
            <p className="muted">{KB_INGEST_LEAD}</p>
          </div>
          {health?.ok ? (
            <span className="chip" data-admin-kb-engine-health role="status">
              引擎 PageIndex{health.pageindex && health.pageindex !== health.mode ? ` · ${health.pageindex}` : ""}（{health.mode}）
            </span>
          ) : null}
        </div>
        {health && !health.ok ? (
          <p className="muted admin-note" data-admin-kb-engine-down>
            知识引擎不可用：{String(health.message || health.code || "未知原因")}。安装 Python 侧车
            （backend/tools/pageindex-bridge/README.md）后可上传；在此之前入口灰置，不伪造上传。
          </p>
        ) : null}
        <div className="kbadmin-toolbar">
          <label className="field">知识库（非结构化）
            <select
              data-admin-kb-doc-base
              value={baseId}
              onChange={(event) => setBaseId(event.target.value)}
            >
              <option value="">请选择…</option>
              {bases.map((base) => (
                <option key={base.id} value={base.id}>{base.name}（{base.code}）</option>
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
                disabled={!canUpload}
                onClick={() => fileRef.current?.click()}
              >
                选择文件
              </button>
              <span className="kbadmin-file-name" data-admin-kb-doc-filename>{file ? file.name : "未选择文件"}</span>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".pdf,application/pdf"
                data-admin-kb-doc-file
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </div>
          </div>
          <button
            className="btn work"
            type="button"
            data-admin-kb-doc-upload-submit
            disabled={!canUpload || uploading}
            title={health?.ok ? undefined : "知识引擎不可用"}
            onClick={() => void submitUpload()}
          >
            {uploading ? "上传中…" : KB_DOC_ACTION.submit}
          </button>
        </div>
        {!bases.length && !loading ? <p className="muted">{KB_DOC_EMPTY.bases}</p> : null}
      </article>

      <article className="panel" data-admin-kb-documents>
        <div className="admin-section-head">
          <div>
            <h2>资料</h2>
            <p className="muted">状态与进度来自真实作业；失败可重试，加工中可取消，未发布可删除。</p>
          </div>
          <span className="muted" role="status">{documents.length} 份</span>
        </div>
        {!documents.length && !loading ? <p className="muted">{KB_DOC_EMPTY.documentsAll}</p> : null}
        {documents.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-kb-documents-table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>库</th>
                  <th>状态</th>
                  <th>更新</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const progress = kbDocProgressText(doc);
                  const status = String(doc.status || "");
                  const busy = ["uploaded", "normalizing", "indexing"].includes(status);
                  const removable = ["draft", "uploaded", "pending_review", "failed", "cancelled"].includes(status);
                  const chipClass = status === "published" ? "chip chip-ok" : status === "failed" ? "chip chip-warn" : "chip";
                  return (
                    <tr key={doc.id} data-admin-kb-doc={doc.id} data-admin-kb-doc-status={status}>
                      <td>
                        <button
                          className="kbadmin-title-link"
                          type="button"
                          data-admin-kb-doc-detail={doc.id}
                          onClick={() => void openDetail(doc.id)}
                        >
                          {doc.title}
                        </button>
                        <p className="muted kbadmin-doc-meta">
                          {doc.filename} · {formatBytes(Number(doc.size_bytes || 0))}
                        </p>
                        {doc.error ? <p className="error" data-admin-kb-doc-error>{doc.error}</p> : null}
                      </td>
                      <td>{doc.base_name || doc.base_id}</td>
                      <td>
                        <span className={chipClass} data-admin-kb-doc-status-chip={status}>{kbDocStatusLabel(status)}</span>
                        {progress ? <p className="muted kbadmin-doc-meta" data-admin-kb-doc-progress>{progress}</p> : null}
                      </td>
                      <td>{formatKbTime(doc.updated_at) || "—"}</td>
                      <td>
                        <div className="kbadmin-row-actions">
                          {status === "draft" && <button className="kbadmin-action-link" type="button" onClick={() => void run(() => api.adminKnowledgeDocumentAction(doc.id, "start"), "已开始解析；完成后待审核。")}>开始解析</button>}
                          {["failed", "cancelled"].includes(status) ? (
                            <button
                              className="kbadmin-action-link"
                              type="button"
                              data-admin-kb-doc-retry={doc.id}
                              onClick={() => void run(() => api.adminKnowledgeDocumentAction(doc.id, "retry"), "已重新排队；从失败阶段继续。")}
                            >
                              {KB_DOC_ACTION.retry}
                            </button>
                          ) : null}
                          {busy ? (
                            <button
                              className="kbadmin-action-link kbadmin-action-danger"
                              type="button"
                              data-admin-kb-doc-cancel={doc.id}
                              onClick={() => void run(() => api.adminKnowledgeDocumentAction(doc.id, "cancel"), "已取消；可重试。")}
                            >
                              {KB_DOC_ACTION.cancel}
                            </button>
                          ) : null}
                          {status === "pending_review" ? (
                            <a className="kbadmin-action-link" href={`/admin/knowledge?document=${encodeURIComponent(doc.id)}`}>查看资料与提交审批</a>
                          ) : null}
                          {status === "published" ? (
                            <button
                              className="kbadmin-action-link kbadmin-action-danger"
                              type="button"
                              data-admin-kb-doc-archive={doc.id}
                              onClick={() => ask(
                                knowledgeDocumentArchiveConfirm(doc.title),
                                () => run(() => api.adminKnowledgeDocumentAction(doc.id, "archive"), "已归档：不再参与检索。"),
                              )}
                            >
                              {KB_DOC_ACTION.archive}
                            </button>
                          ) : null}
                          {removable && !["published", "archived"].includes(status) ? (
                            <button
                              className="kbadmin-action-link kbadmin-action-danger"
                              type="button"
                              data-admin-kb-doc-delete={doc.id}
                              onClick={() => ask(
                                knowledgeDocumentDeleteConfirm(doc.title),
                                () => run(() => api.adminKnowledgeDocumentDelete(doc.id), "资料已删除（原文件与索引已清理）。"),
                              )}
                            >
                              {KB_DOC_ACTION.remove}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {detailId ? (
          <section className="kbadmin-doc-detail" data-admin-kb-doc-detail-panel={detailId}>
            <div className="admin-section-head">
              <h3>资料详情</h3>
              <button className="kbadmin-action-link" type="button" onClick={() => { setDetailId(""); setDetail(null); }}>
                {KB_DOC_ACTION.collapse}
              </button>
            </div>
            {!detail ? (
              <p className="muted" role="status">正在加载详情…</p>
            ) : (
              <>
                <p className="muted">
                  {[detail.base?.family_name, detail.base?.domain_name, detail.base?.name].filter(Boolean).join(" / ") || "未归类"}
                  {" · "}{kbDocStatusLabel(detail.document.status)}
                  {detail.document.error ? ` · ${detail.document.error}` : ""}
                </p>
                <p className="kbadmin-row-actions">
                  <a
                    className="kbadmin-action-link"
                    data-admin-kb-doc-open={detail.document.id}
                    href={`/api/admin/knowledge/documents/${encodeURIComponent(detail.document.id)}/file`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {KB_DOC_ACTION.openSource}
                  </a>
                </p>
                <h4 className="kb-subhead">作业历史</h4>
                {!detail.jobs.length ? <p className="muted">{KB_DOC_EMPTY.jobs}</p> : null}
                <ul className="kbadmin-doc-jobs">
                  {detail.jobs.map((job) => (
                    <li key={job.id} data-admin-kb-job={job.id}>
                      {KB_DOC_JOB_KIND_LABEL[job.kind] || job.kind} · {KB_DOC_JOB_STATUS_LABEL[job.status] || job.status}
                      {job.progress_total > 0 ? ` · ${job.progress_done}/${job.progress_total}` : ""}
                      {" · 第 "}{job.attempt}{" 次 · "}{formatKbTime(job.finished_at || job.started_at || job.created_at) || "—"}
                      {job.error ? <span className="error"> · {job.error}</span> : null}
                    </li>
                  ))}
                </ul>
                <h4 className="kb-subhead">留档稿</h4>
                {detail.text_preview ? (
                  <pre className="kbadmin-body" data-admin-kb-doc-preview>{detail.text_preview.text}</pre>
                ) : (
                  <p className="muted">{KB_DOC_EMPTY.preview}</p>
                )}
              </>
            )}
          </section>
        ) : null}
      </article>

      <article className="panel" data-admin-knowledge-ingest>
        <div className="admin-section-head">
          <div>
            <h2>原文库（失败会话留档与旧素材）</h2>
            <p className="muted">
              上传只写原文库；原文不上线，抽取只生成待审草稿。结构化条目请走「目录 → 知识库 → 新建条目」。
            </p>
          </div>
        </div>
        <h3 className="kb-subhead">原文库</h3>
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
      </article>

      <article className="panel" data-admin-kb-jobs>
        <div className="admin-section-head">
          <div>
            <h2>提取作业</h2>
            <p className="muted">状态按服务端真实终态展示；失败可以重试同一份原文，不会伪造完成。</p>
          </div>
          <span className="muted" role="status">{jobs.length} 个作业</span>
        </div>
        {jobs.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-kb-jobs-table>
              <thead>
                <tr>
                  <th>原文</th>
                  <th>状态</th>
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
                      <td>{rawName(String(job.raw_id || ""))}</td>
                      <td>{rawJobStatusLabel(status) || status || "—"}</td>
                      <td>
                        {job.result_knowledge_id
                          ? `已生成待审页 ${String(job.result_knowledge_id)}`
                          : textValue(job.error) || (failed ? "抽取失败" : "等待结果")}
                      </td>
                      <td>{formatKbTime(textValue(job.created_at)) || "—"}</td>
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
      </article>
    </>
  );
}
