import { Link } from "react-router-dom";
import { expertMissionCopy, expertRoleCopy, type Expert } from "../experts";
import Approvals, { approvalSubject, type ApprovalRow } from "./Approvals";

export default function AgentApprover({
  expert,
  onExplainRisk,
  embedded = false,
}: {
  expert: Expert;
  onExplainRisk: (row: ApprovalRow) => void;
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "agent-console approver-page" : "list-page agent-page expert-page approver-page"} data-expert-page="approver" data-expert-kind="governance">
      {!embedded && <div className="expert-hero">
        <Link className="expert-back" to="/agents">← 数字员工</Link>
        <div className="expert-hero-row">
          <div className="expert-hero-copy">
            <h1>{expert.name}</h1>
            <p className="muted">{expertRoleCopy(expert)}</p>
          </div>
        </div>
        <p className="muted">{expertMissionCopy(expert)}</p>
      </div>}
      <Approvals
        embedded
        onExplainRisk={(row) => onExplainRisk(row)}
      />
    </div>
  );
}

export function approverRiskPrompt(row: ApprovalRow): string {
  return `请说明这张审批的风险，不要代我批准：${approvalSubject(row)}`;
}
