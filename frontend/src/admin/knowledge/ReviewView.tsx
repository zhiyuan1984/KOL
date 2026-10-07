import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { kbExpiryLabel, kbStatusSegments, proposalKindLabel, proposalStatusLabel } from "../../knowledgeCopy";
import { type Row, type WsStats } from "./shared";

type Props = {
  /** 服务端驾驶舱聚合（stats）；未加载时为 undefined，驾驶舱显示加载态。 */
  stats?: WsStats;
  governance?: { family_name?: string; domain_name?: string; base_name: string; document_count: number; scoped_document_count: number; skill_count: number; agent_count: number } | null;
};

type FeedbackRow = {
  user_id?: string;
  knowledge_id?: string;
  title?: string;
  reason?: string;
  reason_note?: string;
  deprecated_at?: string;
  handled_at?: string;
  handle_action?: string;
};

type QueueKey = "documents" | "expiry" | "feedback" | "proposals";
type FeedbackAction = "to_revision" | "archive" | "ignore";
const FEEDBACK_ACTIONS: { code: FeedbackAction; label: string }[] = [
  { code: "to_revision", label: "转修订" },
  { code: "archive", label: "归档" },
  { code: "ignore", label: "忽略" },
];
const waitDays = (iso?: string) => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((Date.now() - t) / 86400000));
};
const feedbackKey = (row: FeedbackRow) => `${row.user_id || ""}::${row.knowledge_id || ""}`;

/**
 * 管理工作区的唯一治理入口：状态是同一对象（知识资产）的生命周期分解，因此用分布条表达；
 * 跨对象的待办（待审资料 / 到期 / 反馈 / 提案）是并列的队列行。
 * 有筛选轴的下钻写成链接（可复制、可后退），没有筛选轴的（反馈、提案）在页内展开自身列表。
 * 计数与最长等待来自服务端 stats（workspace-v1），与点选下钻后的列表同源。
 */
export default function ReviewView({ stats, governance }: Props) {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [proposals, setProposals] = useState<Row[]>([]);
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [handling, setHandling] = useState("");
  const [expanded, setExpanded] = useState<QueueKey | null>(null);
  const [checked, setChecked] = useState<string[]>([]);

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
    void loadGovernance().then(() => { if (!alive) return; });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusCounts = useMemo(() => {
    const s = stats?.status || {};
    const draft = s.draft || 0, pending = s.pending_review || 0;
    const published = s.published || 0, archived = s.archived || 0;
    return { draft, pending, published, archived, total: draft + pending + published + archived };
  }, [stats]);
  const segments = useMemo(() => kbStatusSegments(statusCounts), [statusCounts]);

  const unresolvedFeedback = useMemo(
    () => feedback
      .filter((row) => !row.handled_at)
      // 等得最久的排前面（F）。
      .sort((a, b) => waitDays(b.deprecated_at) - waitDays(a.deprecated_at)),
    [feedback],
  );
  const pendingProposals = useMemo(
    () => proposals.filter((row) => String(row.status || "") === "pending"),
    [proposals],
  );
  const feedbackMaxWait = useMemo(
    () => unresolvedFeedback.reduce((m, row) => Math.max(m, waitDays(row.deprecated_at)), 0),
    [unresolvedFeedback],
  );
  const proposalsMaxWait = useMemo(
    () => pendingProposals.reduce((m, row) => Math.max(m, waitDays(String((row as Row).created_at || ""))), 0),
    [pendingProposals],
  );

  const runFeedback = async (rows: FeedbackRow[], action: FeedbackAction) => {
    if (!rows.length || handling) return;
    setHandling(`batch:${action}`);
    setFeedbackNotice("");
    const failed: string[] = [];
    for (const row of rows) {
      const id = String(row.knowledge_id || "");
      const userId = String(row.user_id || "");
      if (!id || !userId) { failed.push(row.title || id || "?"); continue; }
      try {
        await api.adminKnowledgeFeedbackHandle(id, { user_id: userId, action });
      } catch { failed.push(row.title || id); }
    }
    await loadGovernance();
    setChecked([]);
    setFeedbackNotice(failed.length
      ? `部分处置失败：${failed.slice(0, 3).join("、")}${failed.length > 3 ? ` 等 ${failed.length} 条` : ""}`
      : action === "to_revision" ? `已转入修订草稿 ${rows.length} 条，后续需重新审批发布。`
      : action === "archive" ? `已归档 ${rows.length} 条并记录反馈处置。`
      : `已忽略 ${rows.length} 条并保留处理回执。`);
    setHandling("");
  };
  const toggleCheck = (key: string) =>
    setChecked((current) => current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);

  const waitHint = (days: number) => days > 0 ? `最长等待 ${days} 天` : "暂无待办";
  /** 队列行：有筛选轴的走链接，没有筛选轴的展开自身的页内列表（缺口见 DESIGN §9.2 登记）。 */
  const queueRows: Array<{ key: QueueKey; label: string; value: number; hint: string; to?: string }> = [
    {
      key: "documents", label: "待审资料（非结构化）",
      value: stats?.pending_documents.count ?? 0,
      hint: `PDF 解析完成，等待发布审批。${waitHint(stats?.pending_documents.max_wait_days ?? 0)}`,
      to: "/admin/knowledge?view=pending&asset=document",
    },
    {
      key: "expiry", label: "30 天内到期",
      value: stats?.expiring.count ?? 0,
      hint: stats?.expiring.nearest ? kbExpiryLabel(stats.expiring.nearest) : "需要续期或归档",
      to: "/admin/knowledge?expiring=1",
    },
    {
      key: "feedback", label: "员工反馈待处置",
      value: unresolvedFeedback.length,
      hint: `尚未处置的隐藏与没帮助反馈。${waitHint(feedbackMaxWait)}`,
    },
    {
      key: "proposals", label: "隔离提案",
      value: pendingProposals.length,
      hint: `建议尚未进入正式知识库。${waitHint(proposalsMaxWait)}`,
    },
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
              style={{ flexGrow: Math.max(segment.value, 1) }}
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
            <span className="kbadmin-queue-label">{row.label}<small className="muted">{row.hint}</small></span>
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
            <span className="kbadmin-queue-label">{row.label}<small className="muted">{row.hint}</small></span>
            <span className="kbadmin-queue-count">{row.value}</span>
            <span className="kbadmin-queue-go">{expanded === row.key ? "收起" : "展开"}</span>
          </button>
        )))}
      </nav>

      {governance ? (
        <section className="kbadmin-knowledge-graph" aria-label="产品知识关系图" data-kb-knowledge-graph>
          <div className="kbadmin-status-head"><h3>产品知识关系图</h3><span className="muted">管理端主数据与发布投影</span></div>
          <div className="kbadmin-graph-path">
            <span>{governance.family_name || "未分类"}</span><b>→</b><span>{governance.domain_name || "未分类"}</span><b>→</b><strong>{governance.base_name}</strong>
            <b>→</b><span>文档 {governance.document_count}（范围 {governance.scoped_document_count}）</span><b>→</b><span>技能 {governance.skill_count}</span><b>→</b><span>Agent {governance.agent_count}</span>
          </div>
        </section>
      ) : null}

      {/* 治理子视图入口（D）：分类 / 绑定 / 加工 / 索引健康 ранее只靠直达 URL。 */}
      <nav className="kbadmin-govern" data-admin-kb-govern aria-label="知识治理">
        <span className="muted">治理</span>
        <Link className="kbv-text-action" to="/admin/knowledge/catalog">知识目录</Link>
        <Link className="kbv-text-action" to="/admin/knowledge/bindings">技能绑定</Link>
        <Link className="kbv-text-action" to="/admin/knowledge/ingest">非结构化加工</Link>
      </nav>

      {expanded === "feedback" ? (
        <section className="kbadmin-queue-panel" data-admin-kb-feedback aria-label="员工反馈处置">
          {feedbackNotice ? <p role="status" className="kb-governance-receipt">{feedbackNotice}</p> : null}
          {!unresolvedFeedback.length ? <p className="muted">当前没有待处置反馈。</p> : (
            <>
              {checked.length ? (
                <div className="kbadmin-batch-bar" data-admin-kb-feedback-batch role="toolbar" aria-label="批量处置反馈">
                  <span>已选 {checked.length} 条</span>
                  {FEEDBACK_ACTIONS.map(({ code, label }) => (
                    <button
                      key={code} type="button" className="kbv-text-action"
                      disabled={Boolean(handling)}
                      onClick={() => void runFeedback(unresolvedFeedback.filter((r) => checked.includes(feedbackKey(r))), code)}
                    >{handling === `batch:${code}` ? "处理中…" : `批量${label}`}</button>
                  ))}
                  <button type="button" className="kbv-text-action" onClick={() => setChecked([])}>清除选择</button>
                </div>
              ) : null}
              <div className="kbadmin-queue-list">
                {unresolvedFeedback.map((row) => {
                  const key = feedbackKey(row);
                  const wait = waitDays(row.deprecated_at);
                  return <article key={key} data-admin-kb-feedback-row={key}>
                    <input
                      type="checkbox" aria-label={`选择反馈：${row.title || row.knowledge_id}`}
                      checked={checked.includes(key)} onChange={() => toggleCheck(key)}
                    />
                    <div>
                      <strong>{row.title || row.knowledge_id}</strong>
                      <p className="muted">
                        {row.reason || "员工反馈"}{row.reason_note ? ` · ${row.reason_note}` : ""}
                        {wait ? ` · 等待 ${wait} 天` : ""}
                      </p>
                    </div>
                    <div className="kb-governance-feedback-actions">
                      {FEEDBACK_ACTIONS.map(({ code, label }) => (
                        <button
                          type="button" key={code} className="kbv-text-action"
                          disabled={Boolean(handling)}
                          onClick={() => void runFeedback([row], code)}
                        >{handling ? "处理中…" : label}</button>
                      ))}
                    </div>
                  </article>;
                })}
              </div>
            </>
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
