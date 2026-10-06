import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { kbExpiryLabel } from "../../knowledgeCopy";
import { expirySoon, type KbAssetRow, type Row } from "./shared";

export type GovernanceTarget = "pending" | "draft" | "documents" | "expiry" | "feedback" | "proposals";

type Props = {
  rows: KbAssetRow[];
  onNavigate: (target: GovernanceTarget, knowledgeIds?: string[]) => void;
};

type FeedbackRow = {
  user_id?: string;
  knowledge_id?: string;
  title?: string;
  reason?: string;
  reason_note?: string;
  handled_at?: string;
  handle_action?: string;
};

/**
 * 管理工作区的唯一治理入口：只给出待办数字与筛选跳转，内容编辑仍在同一工作区完成。
 * 反馈与隔离提案的计数单独读取，避免将治理数据伪装成知识条目。
 */
export default function ReviewView({ rows, onNavigate }: Props) {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [proposals, setProposals] = useState<Row[]>([]);
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [handling, setHandling] = useState("");

  const loadGovernance = async () => {
    const [nextFeedback, nextProposals] = await Promise.all([
      api.adminKnowledgeFeedback().catch(() => [] as Row[]),
      api.adminKnowledgeProposals().catch(() => [] as Row[]),
    ]);
    setFeedback(nextFeedback as unknown as FeedbackRow[]);
    setProposals(nextProposals);
  };

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api.adminKnowledgeFeedback().catch(() => [] as Row[]),
      api.adminKnowledgeProposals().catch(() => [] as Row[]),
    ]).then(([nextFeedback, nextProposals]) => {
      if (!alive) return;
      setFeedback(nextFeedback as unknown as FeedbackRow[]);
      setProposals(nextProposals);
    });
    return () => { alive = false; };
  }, []);

  const pendingEntries = rows.filter((row) => row.asset_type !== "document" && row.status === "pending_review");
  const drafts = rows.filter((row) => row.asset_type !== "document" && row.status === "draft");
  const pendingDocuments = rows.filter((row) => row.asset_type === "document" && row.status === "pending_review");
  const expiring = rows.filter((row) => row.asset_type !== "document" && expirySoon(row.expires_at));
  const unresolvedFeedback = feedback.filter((row) => !row.handled_at);
  const pendingProposals = proposals.filter((row) => String(row.status || "") === "pending");

  const handleFeedback = async (row: FeedbackRow, action: "to_revision" | "archive" | "ignore") => {
    const id = String(row.knowledge_id || "");
    const userId = String(row.user_id || "");
    if (!id || !userId) return;
    const key = `${userId}:${id}:${action}`;
    setHandling(key);
    setFeedbackNotice("");
    try {
      await api.adminKnowledgeFeedbackHandle(id, { user_id: userId, action });
      await loadGovernance();
      setFeedbackNotice(action === "to_revision" ? "已转入修订草稿，后续需重新审批发布。" : action === "archive" ? "已归档知识并记录反馈处置。" : "已忽略并保留处理回执。");
    } catch (error) {
      setFeedbackNotice(error instanceof Error ? error.message : "反馈处置失败，请重试。");
    } finally {
      setHandling("");
    }
  };

  const cards = useMemo(() => [
    { target: "pending" as const, label: "待审批", value: pendingEntries.length, hint: "知识条目等待审批发布", ids: pendingEntries.map((row) => row.id) },
    { target: "draft" as const, label: "草稿", value: drafts.length, hint: "尚未提交审批的知识条目", ids: drafts.map((row) => row.id) },
    { target: "documents" as const, label: "待审资料", value: pendingDocuments.length, hint: "PDF 解析完成，等待发布审批", ids: pendingDocuments.map((row) => row.id) },
    { target: "expiry" as const, label: "30 天内到期", value: expiring.length, hint: expiring[0]?.expires_at ? kbExpiryLabel(expiring[0].expires_at) : "需要续期或归档", ids: expiring.map((row) => row.id) },
    { target: "feedback" as const, label: "员工反馈", value: unresolvedFeedback.length, hint: "尚未处置的隐藏与没帮助反馈", ids: unresolvedFeedback.map((row) => String(row.knowledge_id || "")).filter(Boolean) },
    { target: "proposals" as const, label: "隔离提案", value: pendingProposals.length, hint: "隔离队列中的待决提案", ids: pendingProposals.map((row) => String(row.knowledge_id || "")).filter(Boolean) },
  ], [pendingEntries, drafts, pendingDocuments, expiring, unresolvedFeedback, pendingProposals]);

  return (
    <section className="kb-governance-dashboard" data-admin-knowledge-review data-admin-kb-dashboard aria-label="知识治理驾驶舱">
      <div className="kb-governance-heading">
        <div>
          <p className="page-kicker">治理驾驶舱</p>
          <h2>优先处理需要决策的知识</h2>
        </div>
        <p className="muted">点击数字卡片，在当前工作区筛选对应条目。</p>
      </div>
      <div className="kb-governance-grid">
        {cards.map((card) => (
          <button
            key={card.target}
            type="button"
            className="kb-governance-card"
            data-admin-kb-dashboard-card={card.target}
            onClick={() => onNavigate(card.target, card.ids)}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.hint}</small>
          </button>
        ))}
      </div>
      <details className="kb-governance-feedback" data-admin-kb-feedback>
        <summary>员工反馈处置 <small>{unresolvedFeedback.length} 条待处理</small></summary>
        {feedbackNotice ? <p role="status" className="kb-governance-receipt">{feedbackNotice}</p> : null}
        {!unresolvedFeedback.length ? <p className="muted">当前没有待处置反馈。</p> : (
          <div className="kb-governance-feedback-list">
            {unresolvedFeedback.map((row) => {
              const id = String(row.knowledge_id || "");
              const userId = String(row.user_id || "");
              return <article key={`${userId}:${id}`} data-admin-kb-feedback-row={`${userId}::${id}`}>
                <div>
                  <strong>{row.title || id}</strong>
                  <p className="muted">{row.reason || "员工反馈"}{row.reason_note ? ` · ${row.reason_note}` : ""}</p>
                </div>
                <div className="kb-governance-feedback-actions">
                  {(["to_revision", "archive", "ignore"] as const).map((action) => {
                    const key = `${userId}:${id}:${action}`;
                    return <button type="button" key={action} disabled={Boolean(handling)} onClick={() => void handleFeedback(row, action)}>
                      {handling === key ? "处理中…" : ({ to_revision: "转修订", archive: "归档", ignore: "忽略" } as const)[action]}
                    </button>;
                  })}
                </div>
              </article>;
            })}
          </div>
        )}
      </details>
    </section>
  );
}
