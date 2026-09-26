import { useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { knowledgeHardDeleteConfirm, knowledgeProposalRejectConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import {
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  brandLabel,
  formatKbTime,
  kbExpiryLabel,
  kindLabel,
  proposalKindLabel,
  proposalStatusLabel,
  statusLabel,
} from "../../knowledgeCopy";
import {
  detailPath,
  errorMessage,
  expirySoon,
  textValue,
  useKbData,
  type KbAssetRow,
  type KbFeed,
  type Row,
} from "./shared";

/** 待办：有什么在等我决定？—— 视口 0 个实底 CTA，动作一律行内链接式。 */
export default function TodoView({ notify, fail }: KbFeed) {
  const { ask, dialog } = useAdminConfirm();
  const load = useCallback(async () => {
    const [review, rows, proposals] = await Promise.all([
      api.adminKnowledgeReview(),
      api.adminKnowledge(),
      api.adminKnowledgeProposals(),
    ]);
    return { review, rows: rows as KbAssetRow[], proposals };
  }, []);
  const { data, error, loading, reload } = useKbData(load);

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

  return (
    <>
      {dialog}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && !data && <p className="muted" role="status">正在加载待办…</p>}

      <article className="panel" data-admin-knowledge-review>
        <div className="admin-section-head">
          <div>
            <h2>待审批</h2>
            <p className="muted">待审和草稿要点「审批发布」才会进员工知识库；点「查看」进详情执行。</p>
          </div>
          <span className="muted" role="status">{review.length} 条</span>
        </div>
        {review.map((row) => (
          <article className="admin-row" key={row.id} data-admin-knowledge-id={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p className="muted">
                {kindLabel(row.kind)} · {statusLabel(row.status)} · {brandLabel(row.brand)} · 第 {row.current_version || 1} 版
              </p>
            </div>
            <Link className="kbadmin-action-link" to={detailPath(row.id)}>{KB_ADMIN_ACTION.viewDetail}</Link>
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
              </p>
            </div>
            <div className="kbadmin-row-actions">
              <Link className="kbadmin-action-link" to={detailPath(row.id)}>{KB_ADMIN_ACTION.edit}</Link>
              <button
                className="kbadmin-action-link kbadmin-action-danger"
                type="button"
                data-kb-hard-delete={row.id}
                onClick={() => ask(
                  knowledgeHardDeleteConfirm(row.title),
                  () => run(() => api.deleteKnowledge(row.id), "草稿已删除。"),
                )}
              >
                彻底删除
              </button>
            </div>
          </article>
        ))}
        {!drafts.length && <p className="muted">{KB_ADMIN_EMPTY.drafts}</p>}
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
            <p className="muted">到期只做提示，不会自动下线或删除；续期或归档请到详情里决定。</p>
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
            <Link className="kbadmin-action-link" to={detailPath(row.id)}>{KB_ADMIN_ACTION.viewDetail}</Link>
          </article>
        ))}
        {!expiring.length && <p className="muted">{KB_ADMIN_EMPTY.expiry}</p>}
      </article>
    </>
  );
}
