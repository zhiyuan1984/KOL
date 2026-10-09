import { Descriptions } from "antd";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { KnowledgeDocumentDetail, KnowledgeDocumentRow } from "../../api";
import { formatKbTime, kbDocStatusLabel } from "../../knowledgeCopy";
import { formatBytes } from "./shared";

/** 同名只表示名称相同；仅按稳定 ID 去重，不认定为同一资料或版本。 */
export function sameNameDocuments(document: KnowledgeDocumentRow, documents: KnowledgeDocumentRow[]) {
  const seen = new Set([document.id]);
  return documents.filter(other => {
    if (seen.has(other.id) || other.base_id !== document.base_id || other.filename !== document.filename) return false;
    seen.add(other.id);
    return true;
  });
}

export function documentWorkspaceUrl(id: string, company = "") {
  const params = new URLSearchParams({ stage: "published", mode: "detail", assetType: "document", assetId: id });
  if (company) params.set("reviewCompany", company);
  return `/admin/knowledge?${params}`;
}

export default function IngestDocumentDetails({ detail, documents, company, onOpen, actions }: {
  detail: KnowledgeDocumentDetail;
  documents: KnowledgeDocumentRow[];
  company: string;
  onOpen: (id: string) => void;
  actions?: ReactNode;
}) {
  const doc = detail.document;
  const related = sameNameDocuments(doc, documents);
  const path = [detail.base?.family_name, detail.base?.domain_name, detail.base?.name].filter(Boolean).join(" / ");
  const fileUrl = `/api/admin/knowledge/documents/${encodeURIComponent(doc.id)}/file${company ? `?company=${encodeURIComponent(company)}` : ""}`;
  const mediaLabel = ({ pdf: "PDF", image: "图片", audio: "音频", video: "视频", pptx: "演示文稿" } as Record<string, string>)[doc.media_type] || doc.media_type || "—";
  return <>
    <Descriptions className="kbingest-properties" size="small" column={1} colon={false} items={[
      { key: "file", label: "文件名", children: <span className="kbingest-full-name" title={doc.filename || doc.title}>{doc.filename || doc.title}</span> },
      { key: "base", label: "知识库", children: path || doc.base_name || "未归类" },
      { key: "format", label: "类型 / 大小", children: `${mediaLabel} · ${doc.size_bytes ? formatBytes(doc.size_bytes) : "—"}` },
      { key: "updated", label: "更新时间", children: formatKbTime(doc.updated_at) || "—" },
    ]} />
    {related.length > 0 && <div className="kbingest-related" data-admin-kb-related>
      <div className="kbingest-related-head"><span>同名资料 · {related.length}</span><span>独立记录，未确认版本关系</span></div>
      <ul className="kbingest-related-list">
        {related.map(other => <li key={other.id} data-admin-kb-related-document={other.id}>
          <button className="kbadmin-action-link kbingest-related-name" type="button" title={other.filename || other.title} onClick={() => onOpen(other.id)}>{other.filename || other.title}</button>
          <span className="kbingest-related-meta">{kbDocStatusLabel(other.status)} · {formatKbTime(other.updated_at) || "—"}</span>
        </li>)}
      </ul>
    </div>}
    {doc.error && <p className="kbingest-detail-error error" role="alert" data-admin-kb-doc-error>{doc.error}</p>}
    <div className="kbingest-detail-footer">
      <div className="kbadmin-row-actions">
        <a className="kbadmin-action-link" data-admin-kb-doc-open={doc.id} href={fileUrl} target="_blank" rel="noreferrer">打开原文件<span className="sr-only">（新窗口打开）</span></a>
        <Link className="kbadmin-action-link" data-admin-kb-doc-workspace={doc.id} to={documentWorkspaceUrl(doc.id, company)}>加工与审批</Link>
      </div>
      {actions}
    </div>
  </>;
}
