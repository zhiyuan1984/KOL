import { PropertyList, TruncatableText } from "../components/InformationLayout";
import type { LegacyApprovalProjection } from "../api";

export type GovernanceDecision = "approve" | "reject";

export function governanceStatusLabel(approval: LegacyApprovalProjection) {
  if (["consumed", "sent", "approved"].includes(approval.status)) return "审批已通过";
  if (approval.status === "rejected") return "审批已驳回";
  if (approval.status === "withdrawn" || approval.status === "cancelled") return "已撤回";
  if (approval.status === "stale") return "已过期";
  return approval.business_status_label || "待处理";
}

function text(value: unknown, empty = "—") {
  const normalized = String(value ?? "").trim();
  return normalized || empty;
}

/**
 * 平台本体治理审批仍由旧正式账本投影和 /decide 处理；不得传给 v2 命令。
 * 本组件只呈现已经通过服务端可见性过滤的字段和 allowed_actions。
 */
export function GovernanceApprovalDetail({
  approval,
  busy,
  notice,
  onClose,
  onRefresh,
  onDecide,
}: {
  approval: LegacyApprovalProjection;
  busy: boolean;
  notice: string;
  onClose: () => void;
  onRefresh: () => void;
  onDecide: (decision: GovernanceDecision) => void;
}) {
  const payload = approval.payload || {};
  const allowed = new Set(approval.allowed_actions || []);
  const canDecide = approval.status === "pending" && approval.can_decide === true;
  const showApprove = canDecide && allowed.has("approve");
  const showReject = canDecide && allowed.has("reject");
  const path = approval.path || [];
  const chain = approval.chain_detail || [];

  return (
    <section
      className="review-detail governance-approval-detail"
      aria-label="本体治理审批详情"
      data-governance-approval-id={approval.id}
    >
      <header className="review-detail-head">
        <div>
          <h2><TruncatableText text={approval.title || approval.object_label || "本体治理审批"} /></h2>
          <p><span data-review-status={approval.status}>{governanceStatusLabel(approval)}</span> · 平台本体治理</p>
        </div>
        <div className="review-toolbar">
          <button type="button" disabled={busy} onClick={onRefresh}>刷新详情</button>
          <button type="button" disabled={busy} onClick={onClose}>返回列表</button>
        </div>
      </header>
      <div className="review-detail-body">
        <p className="review-responsibility" data-governance-platform-boundary>
          此单属于平台本体治理，不属于当前公司评审；公司切换不会改变本单范围或访问权限。
        </p>
        <section aria-label="本体变更事实（只读）">
          <h3>本体变更事实（只读）</h3>
          <PropertyList
            className="review-property-list"
            labelWidth="short"
            items={[
              { key: "scope", label: "范围", value: text(payload.scope_label || payload.scope) },
              { key: "summary", label: "变更摘要", value: text(payload.summary) },
              { key: "change-ref", label: "变更引用", value: text(payload.change_ref) },
              { key: "base-version", label: "基线版本", value: text(payload.base_version) },
              { key: "target-digest", label: "目标摘要", value: text(payload.target_digest) },
            ]}
          />
        </section>
        <section aria-label="治理审批进度">
          <h3>治理审批进度</h3>
          <p>当前节点：{text(approval.current_node)}{approval.waiting_duration_label ? ` · ${approval.waiting_duration_label}` : ""}</p>
          {path.length > 0 ? (
            <ol className="review-steps-list">
              {path.map((step, index) => (
                <li key={`${step.name}-${index}`} data-current={step.state === "current" || undefined}>
                  <strong>{text(step.name)}</strong><span> · {text(step.role)}</span><span> · {text(step.state_label)}</span>
                </li>
              ))}
            </ol>
          ) : chain.length > 0 ? (
            <ol className="review-steps-list">
              {chain.map((step, index) => <li key={`${step.name}-${index}`}><strong>{text(step.name)}</strong><span> · {text(step.role)}</span></li>)}
            </ol>
          ) : <p className="review-muted">服务端未返回审批链明细。</p>}
        </section>
        {notice && <p role="status" className="governance-approval-notice">{notice}</p>}
      </div>
      <footer className="review-action-bar">
        {(showApprove || showReject) ? (
          <div className="review-toolbar governance-approval-actions" data-governance-approval-actions>
            {showApprove && <button type="button" className={busy ? "" : "primary"} disabled={busy} onClick={() => onDecide("approve")}>同意</button>}
            {showReject && <button type="button" disabled={busy} onClick={() => onDecide("reject")}>驳回</button>}
          </div>
        ) : <p>当前没有可执行动作 · 只读</p>}
      </footer>
    </section>
  );
}
