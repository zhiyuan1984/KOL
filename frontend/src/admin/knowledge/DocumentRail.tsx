import { Alert } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ProjectTheme } from "../../components/ProjectTheme";
import { PropertyList } from "../../components/InformationLayout";
import { api } from "../../api";
import { reviewApi, reviewCompany, reviewHeaders } from "../../reviews/api";
import PublicationPanel from "./PublicationPanel";
import KnowledgeScopePanel from "./KnowledgeScopePanel";
import DocumentReader from "./DocumentReader";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { formatKbTime } from "../../knowledgeCopy";
import { errorMessage, formatBytes, useKbData } from "./shared";
import WorkspaceActions from "./WorkspaceActions";

export default function DocumentRail({ id, path, reload, notify, mode = "detail", onMode, onRevision, onDirty }: {
  mode?: string;
  onMode?: (mode: "detail" | "edit" | "review") => void;
  onRevision?: (id: string) => void;
  onDirty?: (dirty: boolean) => void;
  id: string;
  path: string;
  reload: () => void;
  notify: (message: string) => void;
  fail: (cause: unknown) => void;
}) {
  const load = useCallback(() => api.adminKnowledgeDocument(id), [id]);
  const { data, error, failureStatus, loading, reload: refresh } = useKbData(load);
  const { dialog, open: confirming } = useAdminConfirm();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const lock = useRef(false);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [scopeReady, setScopeReady] = useState(false);
  const doc = data?.document;
  const mediaLabel = ({ pdf: "PDF", image: "图片", audio: "音频", video: "视频", pptx: "演示文稿" } as Record<string, string>)[doc?.media_type || ""] || "资料";
  const processing = Boolean(doc && ["uploaded", "normalizing", "indexing"].includes(doc.status));
  const transientReadFailure = !failureStatus || [408, 429].includes(failureStatus) || failureStatus >= 500;
  const previousStatus = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!doc) return;
    if (previousStatus.current && previousStatus.current !== doc.status) reload();
    previousStatus.current = doc.status;
  }, [doc?.status, reload]);

  // Follow the persisted document job only. Scope handoff polling is independently bounded in KnowledgeScopePanel.
  useEffect(() => {
    if (!processing || loading || (error && !transientReadFailure) || busy || confirming) return;
    const timer = window.setTimeout(refresh, error ? 8000 : 3000);
    return () => window.clearTimeout(timer);
  }, [processing, loading, error, transientReadFailure, busy, confirming, refresh]);

  const run = async (action: "start" | "retry" | "cancel", message: string) => {
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
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  async function replace(file: File) {
    if (!doc) return;
    setBusy(true);
    setActionError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("updated_at", doc.updated_at);
      const response = await fetch(`/api/admin/knowledge/documents/${encodeURIComponent(id)}/draft-file`, { method: "PUT", headers: reviewHeaders(), body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail?.message || body.detail || "替换失败");
      notify("草稿原件已替换，尚未解析或发布");
      setReplacement(null);
      onDirty?.(false);
      refresh();
      reload();
      onMode?.("detail");
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revision() {
    setBusy(true);
    setActionError("");
    try {
      const result = await reviewApi<{ document_id: string }>(`/admin/knowledge/documents/${encodeURIComponent(id)}/revision`, {});
      onRevision?.(result.document_id);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const blocked = busy || loading || Boolean(error) || confirming;
  const blockedReason = busy ? "正在等待当前操作回执。" : loading ? "正在读取资料的最新状态。" : error ? "资料读取失败；重新检查后才能执行操作。" : confirming ? "确认窗口打开时不能重复提交。" : "";
  // 本视口唯一的实底 L1 仍由当前服务端允许的推进动作决定；范围候选不是发布成功。
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
  const cta = (action: "start" | "retry" | "revision") => primary === action ? "btn work" : "kbv-text-action";

  return <ProjectTheme>
    {dialog}
    <div className="kbv-rail-body kbv-document-body" aria-busy={busy || loading}>
      {loading && !data ? <p role="status">正在读取资料…</p> : null}
      {error ? <Alert type="error" showIcon title="资料读取失败" description={error} action={<button className="kbv-text-action" disabled={loading} onClick={refresh}>重新检查</button>} /> : null}
      {actionError && !confirming ? <p className="error" role="alert">{actionError}</p> : null}
      {doc && data ? <>
        <h2 className="kbv-document-title">{doc.title}</h2>
        <span className="kbv-status">资料版本 v{doc.current_version || 1}</span>
        {mode !== "review" ? <PropertyList className="kbpilot-properties" items={[
          { key: "owner", label: "维护人", value: doc.created_by, emptyText: "未记录" },
          { key: "size", label: "文件大小", value: doc.size_bytes ? formatBytes(Number(doc.size_bytes)) : "—" },
          { key: "created", label: "创建时间", value: formatKbTime(doc.created_at) },
          { key: "updated", label: "更新时间", value: formatKbTime(doc.updated_at) },
          ...(doc.published_at ? [{ key: "published", label: "发布时间", value: formatKbTime(doc.published_at) }] : []),
        ]} /> : null}
        {path ? <div className="kbv-document-path" aria-label="资料分类">{path.split(" / ").map((part, index) => <span key={`${index}-${part}`}>{part}</span>)}</div> : null}
        {mode !== "review" ? <section className="kbv-document-source">
          <h3>非结构化{mediaLabel === "PDF" ? " PDF" : mediaLabel}</h3>
          <p>{doc.filename}</p>
        </section> : null}
        {mode === "edit" && doc.status === "draft" ? <label className="kbv-document-replacement">
          替换草稿原件
          <input type="file" disabled={blocked}
            accept=".pdf,.pptx,.png,.jpg,.jpeg,.gif,.webp,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.mp4,.mov,.webm,.mkv"
            onChange={event => { const file = event.currentTarget.files?.[0]; if (file) { setReplacement(file); onDirty?.(true); } }} />
          {replacement ? <p>{replacement.name}</p> : null}
        </label> : null}
        {mode !== "review" ? <KnowledgeScopePanel
          key={`scope:${id}`}
          id={id}
          documentStatus={doc.status}
          documentJob={doc.latest_job}
          documentJobs={data.jobs}
          documentError={doc.error}
          refreshToken={`${doc.status}:${doc.updated_at}:${doc.latest_job?.id}:${doc.latest_job?.status}`}
          onReady={setScopeReady}
          onDirty={onDirty}
          onChanged={() => { refresh(); reload(); }}
          reader={<DocumentReader id={id} title={doc.title} mediaType={doc.media_type} artifacts={doc.artifacts} company={reviewCompany()} textPreview={data.text_preview} sourceRevision={`${doc.current_version}:${doc.updated_at}`} />}
        /> : null}
        {["pending_review", "published"].includes(doc.status) && (scopeReady || mode === "review") ? <PublicationPanel key={`publication:${id}`} id={id} mode={mode === "review" ? "review" : "detail"} ownsPrimary={mode !== "edit"} onInitiate={() => onMode?.("review")} onSubmitted={() => onMode?.("detail")} onDirty={onDirty} notify={notify} refreshDocument={() => { refresh(); reload(); }} /> : null}
        {mode !== "review" ? <WorkspaceActions><div className="kbv-document-actions"><div className="kbv-actions">
          {data.actions?.start && mode !== "edit" ? <button className={cta("start")} data-kbv-doc-action="start" disabled={blocked} onClick={() => void run("start", "已提交解析；候选范围需核对，审批与发布仍是独立步骤")}>{busy ? "提交中…" : "解析并提取范围"}</button> : null}
          {data.actions?.edit && mode !== "edit" ? <button className="kbv-text-action" disabled={blocked} onClick={() => onMode?.("edit")}>替换草稿原件</button> : null}
          {mode === "edit" ? <><button className="btn" disabled={blocked} onClick={() => onMode?.("detail")}>取消编辑</button><button className={primary === "save" ? "btn work" : "kbv-text-action"} disabled={blocked || !replacement} onClick={() => replacement && void replace(replacement)}>{busy ? "保存中…" : "保存"}</button></> : null}
          {data.actions?.retry ? <button className={cta("retry")} data-kbv-doc-action="retry" disabled={blocked} onClick={() => void run("retry", "已提交重试，完成后待审核")}>{busy ? "提交中…" : "重试加工"}</button> : null}
          {data.actions?.cancel ? <button className="btn" data-kbv-doc-action="cancel" disabled={blocked} onClick={() => void run("cancel", "已提交取消加工")}>取消加工</button> : null}
          {data.actions?.revision ? <button className={cta("revision")} disabled={blocked} onClick={() => void revision()}>创建新版本草稿</button> : null}
          <button className="kbv-text-action" disabled={busy || loading || confirming} onClick={refresh}>{loading ? "检查中…" : "刷新资料"}</button>
        </div>{blockedReason ? <p role="note">{blockedReason}</p> : null}</div></WorkspaceActions> : null}
        {mode !== "review" ? <div className="kbv-document-links">
          <Link to="/admin/knowledge/ingest">查看加工进度与恢复操作 <span aria-hidden="true">→</span></Link>
          <Link to={`/admin/knowledge/bases/${encodeURIComponent(doc.base_id)}`}>查看知识库与管理端试算 <span aria-hidden="true">→</span></Link>
        </div> : null}
      </> : null}
    </div>
  </ProjectTheme>;
}
