import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { KnowledgeDocumentRow } from "../../api";
import { knowledgeArchiveConfirm, knowledgeDocumentDeleteConfirm, knowledgeDocumentPublishConfirm, knowledgeProposalRejectConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import {
  HIDE_REASONS,
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  KB_DOC_ACTION,
  brandLabel,
  formatKbTime,
  hideReasonLabel,
  kbExpiryLabel,
  kbFeedbackActionLabel,
  kbFeedbackReasonLabel,
  kindLabel,
  proposalKindLabel,
  proposalStatusLabel,
  statusLabel,
} from "../../knowledgeCopy";
import {
  entryPath,
  expirySoon,
  textValue,
  useKbData,
  type KbAssetRow,
  type KbFeed,
  type Row,
} from "./shared";

type FeedbackRow = {
  user_id: string;
  knowledge_id: string;
  title?: string;
  reason?: string;
  reason_note?: string;
  deprecated_at?: string;
  handled_at?: string;
  handled_by?: string;
  handle_action?: string;
  handle_note?: string;
};

function feedbackKey(row: FeedbackRow): string {
  return `${row.user_id}::${row.knowledge_id}`;
}

/** 待处置：有什么在等我决定？—— 视口 0 个实底 CTA，动作一律行内链接式。 */
export default function ReviewView({ notify, fail }: KbFeed) {
  const { ask, dialog } = useAdminConfirm();
  const load = useCallback(async () => {
    const [review, rows, proposals, feedback, documents] = await Promise.all([
      api.adminKnowledgeReview(),
      api.adminKnowledge(),
      api.adminKnowledgeProposals(),
      api.adminKnowledgeFeedback().catch(() => [] as Row[]),
      api.adminKnowledgeDocuments({ status: "pending_review" }).catch(() => ({ documents: [] as KnowledgeDocumentRow[] })),
    ]);
    return {
      review,
      rows: rows as KbAssetRow[],
      proposals,
      feedback: feedback as unknown as FeedbackRow[],
      pendingDocuments: documents.documents || [],
    };
  }, []);
  const { data, error, loading, reload } = useKbData(load);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
    } catch (cause) {
      fail(cause);
    }
  };

  const review = data?.review || [];
  const drafts = (data?.rows || []).filter((row) => row.status === "draft");
  const expiring = (data?.rows || []).filter((row) => expirySoon(row.expires_at));
  const proposals = data?.proposals || [];
  const feedback = data?.feedback || [];
  const pendingDocuments = data?.pendingDocuments || [];
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of feedback) {
      const reason = String(row.reason || "");
      map.set(reason, (map.get(reason) || 0) + 1);
    }
    return map;
  }, [feedback]);

  const handleFeedback = (row: FeedbackRow, action: "to_revision" | "archive" | "ignore"): Promise<void> => {
    const note = (notes[feedbackKey(row)] || "").trim();
    const id = row.knowledge_id;
    const message = action === "to_revision"
      ? "已转修订：生成新草稿版本，仍需重新审批才生效。"
      : action === "archive"
        ? "已归档并记入反馈处置。"
        : "已忽略并留档。";
    return run(
      () => api.adminKnowledgeFeedbackHandle(id, { user_id: row.user_id, action, note }),
      message,
    );
  };

  return (
    <>
      {dialog}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && !data && <p className="muted" role="status">正在加载待处置…</p>}

      <article className="panel" data-admin-knowledge-review>
        <div className="admin-section-head">
          <div>
            <h2>待审批</h2>
            <p className="muted">待审和草稿要点「审批发布」才会进员工知识库；点「查看」进条目详情执行。</p>
          </div>
          <span className="muted" role="status">{review.length} 条</span>
        </div>
        {review.map((row) => (
          <article className="admin-row" key={row.id} data-admin-knowledge-id={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p className="muted">
                {kindLabel(row.kind)} · {statusLabel(row.status)} · {brandLabel(row.brand)} · 第 {row.current_version || 1} 版
                {row.base_name ? ` · ${row.base_name}` : ""}
              </p>
            </div>
            <Link className="kbadmin-action-link" to={entryPath(row.id)}>{KB_ADMIN_ACTION.viewDetail}</Link>
          </article>
        ))}
        {!review.length && <p className="muted">{KB_ADMIN_EMPTY.review}</p>}
      </article>

      <article className="panel" data-admin-knowledge-drafts>
        <div className="admin-section-head">
          <div>
            <h2>草稿</h2>
            <p className="muted">草稿还没发布。编辑会写新版本；彻底删除只对草稿开放，且不可撤销。</p>
          </div>
          <span className="muted" role="status">{drafts.length} 条</span>
        </div>
        {drafts.map((row) => (
          <article className="admin-row" key={row.id} data-admin-knowledge-id={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p className="muted">
                {kindLabel(row.kind)} · {brandLabel(row.brand)} · 第 {row.current_version || 1} 版
                {row.base_name ? ` · ${row.base_name}` : ""}
              </p>
            </div>
            <div className="kbadmin-row-actions">
              <Link className="kbadmin-action-link" to={entryPath(row.id)}>{KB_ADMIN_ACTION.edit}</Link>
            </div>
          </article>
        ))}
        {!drafts.length && <p className="muted">{KB_ADMIN_EMPTY.drafts}</p>}
      </article>

      <article className="panel" data-admin-kb-pending-documents>
        <div className="admin-section-head">
          <div>
            <h2>待审资料（非结构化）</h2>
            <p className="muted">发布后才参与检索；审批前可用「重新加工」重跑规整与索引。</p>
          </div>
          <span className="muted" role="status">{pendingDocuments.length} 份</span>
        </div>
        {pendingDocuments.map((doc) => (
          <article className="admin-row" key={doc.id} data-admin-kb-pending-doc={doc.id}>
            <div>
              <strong>{doc.title}</strong>
              <p className="muted">
                {doc.base_name || doc.base_id} · 更新于 {formatKbTime(doc.updated_at) || "—"}
                {doc.error ? ` · ${doc.error}` : ""}
              </p>
            </div>
            <div className="kbadmin-row-actions">
              <Link className="kbadmin-action-link" to={`/admin/knowledge?document=${encodeURIComponent(doc.id)}`}>查看资料与提交审批</Link>
              <button
                className="kbadmin-action-link"
                type="button"
                data-admin-kb-doc-reprocess={doc.id}
                onClick={() => run(() => api.adminKnowledgeDocumentAction(doc.id, "reprocess"), "已重新加工；完成后回到待审。")}
              >
                {KB_DOC_ACTION.reprocess}
              </button>
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
            </div>
          </article>
        ))}
        {!pendingDocuments.length && <p className="muted">没有待审资料。</p>}
      </article>

      <article className="panel" data-admin-knowledge-proposals>
        <div className="admin-section-head">
          <div>
            <h2>隔离提案</h2>
            <p className="muted">演化走隔离队列。批准只留档，不改线上技能说明，也不会立刻改线上邮件。</p>
          </div>
        </div>
        {proposals.map((proposal: Row) => (
          <article className="admin-row" key={String(proposal.id)} data-admin-kb-proposal={String(proposal.id)}>
            <div>
              <strong>{proposalKindLabel(String(proposal.kind || ""))}</strong>
              <p className="muted">
                {proposalStatusLabel(String(proposal.status || ""))}
                {String(proposal.profile || "") === "shadow" ? " · 隔离队列" : ""}
                {textValue(proposal.reject_reason || proposal.proposed_diff)
                  ? ` · ${textValue(proposal.reject_reason || proposal.proposed_diff).replace(/SKILL\.md/g, "线上技能说明").replace(/生产 /g, "线上")}`
                  : ""}
              </p>
            </div>
            {proposal.status === "pending" ? (
              <div className="kbadmin-row-actions">
                <button
                  className="kbadmin-action-link"
                  type="button"
                  data-kb-proposal-approve={String(proposal.id)}
                  onClick={() => void run(
                    () => api.reviewKnowledgeProposal(String(proposal.id), "approve"),
                    "已批准（未改线上技能说明）。",
                  )}
                >
                  {KB_ADMIN_ACTION.approveProposal}
                </button>
                <button
                  className="kbadmin-action-link kbadmin-action-danger"
                  type="button"
                  data-kb-proposal-reject={String(proposal.id)}
                  onClick={() => ask(
                    knowledgeProposalRejectConfirm(proposalKindLabel(String(proposal.kind || ""))),
                    (reason) => run(
                      () => api.reviewKnowledgeProposal(String(proposal.id), "reject", reason),
                      "已否决并留档。",
                    ),
                  )}
                >
                  {KB_ADMIN_ACTION.rejectProposal}
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {!proposals.length && <p className="muted">{KB_ADMIN_EMPTY.proposals}</p>}
      </article>

      <article className="panel" data-admin-kb-expiry>
        <div className="admin-section-head">
          <div>
            <h2>到期提醒</h2>
            <p className="muted">到期只做提示，不会自动下线或删除；续期或归档请到条目详情里决定。</p>
          </div>
          <span className="muted" role="status">{expiring.length} 条</span>
        </div>
        {expiring.map((row) => (
          <article className="admin-row" key={row.id} data-admin-kb-expiry-row={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p className="muted">
                {kbExpiryLabel(row.expires_at)} · 更新于 {formatKbTime(row.updated_at)}
              </p>
            </div>
            <Link className="kbadmin-action-link" to={entryPath(row.id)}>{KB_ADMIN_ACTION.viewDetail}</Link>
          </article>
        ))}
        {!expiring.length && <p className="muted">{KB_ADMIN_EMPTY.expiry}</p>}
      </article>

      <article className="panel" data-admin-kb-feedback>
        <div className="admin-section-head">
          <div>
            <h2>员工反馈处置</h2>
            <p className="muted">
              数字是本组织内隐藏该原因的次数（按账号计），不是拦截次数，也不改已发信。
              处置只有转修订 / 归档 / 忽略，不会让模型自动改主文档。
            </p>
          </div>
          <span className="muted" role="status">共 {feedback.length} 条</span>
        </div>
        <div className="kbadmin-reason-row">
          {HIDE_REASONS.map((reason) => (
            <span className="kbadmin-reason" key={reason.code} data-admin-kb-reason={reason.code}>
              <strong>{hideReasonLabel(reason.code)}</strong>
              <span className="muted">{counts.get(reason.code) || 0} 条</span>
            </span>
          ))}
          {!feedback.length && <span className="muted">{KB_ADMIN_EMPTY.feedbackAggregate}</span>}
        </div>

        {!feedback.length && !loading ? <p className="muted">{KB_ADMIN_EMPTY.feedback}</p> : null}
        {feedback.map((row) => {
          const handled = Boolean(row.handled_at);
          const key = feedbackKey(row);
          return (
            <article
              className="admin-row"
              key={key}
              data-admin-kb-feedback-row={key}
              data-admin-kb-feedback-handled={handled ? "1" : "0"}
            >
              <div>
                <Link className="kbadmin-title-link" to={entryPath(row.knowledge_id)}>
                  {row.title || row.knowledge_id}
                </Link>
                <p className="muted">
                  {row.user_id} · {kbFeedbackReasonLabel(row.reason)}
                  {row.reason_note ? ` · 备注：${row.reason_note}` : ""}
                  {` · ${formatKbTime(row.deprecated_at) || "—"}`}
                </p>
                {handled ? (
                  <p className="kbadmin-handled" data-admin-kb-handled={key}>
                    {kbFeedbackActionLabel(row.handle_action)} · {row.handled_by || "—"} · {formatKbTime(row.handled_at) || "—"}
                    {row.handle_note ? ` · 备注：${row.handle_note}` : ""}
                  </p>
                ) : (
                  <details className="kbadmin-feedback-actions" data-admin-kb-feedback-form={key}>
                    <summary>处置</summary>
                    <label className="field">处置备注（可空）
                      <input
                        value={notes[key] || ""}
                        data-admin-kb-feedback-note={key}
                        onChange={(event) => setNotes((current) => ({ ...current, [key]: event.target.value }))}
                      />
                    </label>
                    <div className="kbadmin-row-actions">
                      <button
                        className="kbadmin-action-link"
                        type="button"
                        data-admin-kb-feedback-revision={key}
                        onClick={() => handleFeedback(row, "to_revision")}
                      >
                        {KB_ADMIN_ACTION.toRevision}
                      </button>
                      <button
                        className="kbadmin-action-link kbadmin-action-danger"
                        type="button"
                        data-admin-kb-feedback-archive={key}
                        onClick={() => ask(
                          knowledgeArchiveConfirm(row.title || row.knowledge_id),
                          () => handleFeedback(row, "archive"),
                        )}
                      >
                        {KB_ADMIN_ACTION.archive}
                      </button>
                      <button
                        className="kbadmin-action-link"
                        type="button"
                        data-admin-kb-feedback-ignore={key}
                        onClick={() => handleFeedback(row, "ignore")}
                      >
                        {KB_ADMIN_ACTION.ignore}
                      </button>
                    </div>
                    <p className="muted admin-note">
                      转修订生成新草稿（仍需审批）；归档从解析与员工面移除；忽略只留档。
                    </p>
                  </details>
                )}
              </div>
            </article>
          );
        })}
      </article>
    </>
  );
}
