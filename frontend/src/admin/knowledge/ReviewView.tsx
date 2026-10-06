import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { kbExpiryLabel, kbStatusCounts, kbStatusSegments, proposalKindLabel, proposalStatusLabel } from "../../knowledgeCopy";
import { expirySoon, type KbAssetRow, type Row } from "./shared";

type Props = {
  rows: KbAssetRow[];
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

type QueueKey = "documents" | "expiry" | "feedback" | "proposals";

/**
 * 管理工作区的唯一治理入口：状态是同一对象（知识资产）的生命周期分解，因此用分布条表达；
 * 跨对象的待办（待审资料 / 到期 / 反馈 / 提案）是并列的队列行。
 * 有筛选轴的下钻写成链接（可复制、可后退），没有筛选轴的（反馈、提案）在页内展开自身列表。
 */
export default function ReviewView({ rows }: Props) {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [proposals, setProposals] = useState<Row[]>([]);
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [handling, setHandling] = useState("");
  const [expanded, setExpanded] = useState<QueueKey | null>(null);

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

  const statusCounts = useMemo(() => kbStatusCounts(rows), [rows]);
  const segments = useMemo(() => kbStatusSegments(statusCounts), [statusCounts]);
  const pendingDocuments = rows.filter((row) => row.asset_type === "document" && row.status === "pending_review");
  const expiring = rows.filter((row) => expirySoon(row.expires_at));
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

  /** 队列行：有筛选轴的走链接，没有筛选轴的展开自身的页内列表（缺口见 DESIGN §9.2 登记）。 */
  const queueRows: Array<{ key: QueueKey; label: string; value: number; hint: string; to?: string }> = [
    { key: "documents", label: "待审资料（非结构化）", value: pendingDocuments.length, hint: "PDF 解析完成，等待发布审批", to: "/admin/knowledge?view=pending&asset=document" },
    { key: "expiry", label: "30 天内到期", value: expiring.length, hint: expiring[0]?.expires_at ? kbExpiryLabel(expiring[0].expires_at) : "需要续期或归档", to: "/admin/knowledge?expiring=1" },
    { key: "feedback", label: "员工反馈待处置", value: unresolvedFeedback.length, hint: "尚未处置的隐藏与没帮助反馈" },
    { key: "proposals", label: "隔离提案", value: pendingProposals.length, hint: "建议尚未进入正式知识库" },
  ];

  return (
    <section className="kb-governance-dashboard" data-admin-knowledge-review data-admin-kb-dashboard aria-label="知识治理驾驶舱">
      <div className="kb-governance-heading">
        <h2>治理驾驶舱 <span>状态是同一条知识资产的生命周期；点任一段或任一行，到列表里按该条件继续处理。</span></h2>
      </div>

      {/* 状态分布（DESIGN §9.2）：同一对象的生命周期用分段条，段宽按计数成比例，不拆成并列 KPI 卡。 */}
      <section className="kbadmin-status" data-admin-kb-status aria-label="知识资产状态">
        <div className="kbadmin-status-head">
          <h3>知识资产状态</h3>
          <span className="muted">共 {statusCounts.total} 条</span>
        </div>
        <div className="kbadmin-status-bar" role="group" aria-label="按状态下钻">
          {segments.map((segment) => (
            <Link
              key={segment.key}
              className={`kbadmin-status-seg is-${segment.key}`}
              data-kb-status={segment.key}
              to={`/admin/knowledge?view=${segment.view}`}
              style={{ flexGrow: segment.value }}
            >
              <span data-ds-stat-label>{segment.label}</span>
              <span className="kbadmin-status-count" data-ds-stat-value>{segment.value}</span>
            </Link>
          ))}
        </div>
      </section>

      <nav className="kbadmin-queue" data-admin-kb-queue aria-label="待处置队列">
        {queueRows.map((row) => (row.to ? (
          <Link key={row.key} className="kbadmin-queue-row" data-kb-queue={row.key} to={row.to} title={row.hint}>
            <span className="kbadmin-queue-label">{row.label}</span>
            <span className="kbadmin-queue-count">{row.value}</span>
            <span className="kbadmin-queue-go">查看 →</span>
          </Link>
        ) : (
          <button
            key={row.key}
            type="button"
            className="kbadmin-queue-row"
            data-kb-queue={row.key}
            title={row.hint}
            aria-expanded={expanded === row.key}
            onClick={() => setExpanded(expanded === row.key ? null : row.key)}
          >
            <span className="kbadmin-queue-label">{row.label}</span>
            <span className="kbadmin-queue-count">{row.value}</span>
            <span className="kbadmin-queue-go">{expanded === row.key ? "收起" : "展开"}</span>
          </button>
        )))}
      </nav>

      {expanded === "feedback" ? (
        <section className="kbadmin-queue-panel" data-admin-kb-feedback aria-label="员工反馈处置">
          {feedbackNotice ? <p role="status" className="kb-governance-receipt">{feedbackNotice}</p> : null}
          {!unresolvedFeedback.length ? <p className="muted">当前没有待处置反馈。</p> : (
            <div className="kbadmin-queue-list">
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
                      return <button type="button" key={action} className="kbv-text-action" disabled={Boolean(handling)} onClick={() => void handleFeedback(row, action)}>
                        {handling === key ? "处理中…" : ({ to_revision: "转修订", archive: "归档", ignore: "忽略" } as const)[action]}
                      </button>;
                    })}
                  </div>
                </article>;
              })}
            </div>
          )}
        </section>
      ) : null}

      {expanded === "proposals" ? (
        <section className="kbadmin-queue-panel" data-admin-kb-proposals aria-label="隔离提案">
          {!pendingProposals.length ? <p className="muted">当前没有待决提案。</p> : (
            <div className="kbadmin-queue-list">
              {pendingProposals.map((proposal) => (
                <article key={String(proposal.id)} data-admin-kb-proposal={String(proposal.id)}>
                  <div>
                    <strong>{proposalKindLabel(String(proposal.kind || ""))}</strong>
                    <p className="muted">
                      {proposalStatusLabel(String(proposal.status || ""))}
                      {String(proposal.reject_reason || proposal.proposed_diff || "")
                        ? ` · ${String(proposal.reject_reason || proposal.proposed_diff).slice(0, 80)}`
                        : ""}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="muted">批准或否决在提案所属技能/评价页完成；这里只汇总待决数量。</p>
        </section>
      ) : null}
    </section>
  );
}
