import type { ReviewChoices as Choices, ReviewDefinition } from "../../../shared/review";
import type { ReviewContext } from "./api";

export function ReviewChoices({ definition, candidates, people, values, onChange }: {
  definition: ReviewDefinition; candidates: Choices; people: ReviewContext["people"]; values: Choices; onChange: (choices: Choices) => void;
}) {
  const nodes = definition.nodes.filter(n => n.assignee?.kind === "requester_choice");
  if (!nodes.length) return null;
  return <section className="review-form" aria-label="本次审批人"><h3>本次审批人</h3><p className="review-muted">仅可在已发布范围内选择，必经步骤保持不变。条件分支实际采用的人员以核对路径为准。</p>
    {nodes.map(n => <label key={n.id}>{n.name}<select aria-label={`${n.name}的审批人`} multiple={n.mode !== "single"} value={n.mode === "single" ? values[n.id]?.[0] || "" : values[n.id] || []}
      onChange={e => onChange({ ...values, [n.id]: Array.from(e.target.selectedOptions).map(o => o.value).filter(Boolean) })}>
      {n.mode === "single" && <option value="">请选择审批人</option>}{(candidates[n.id] || []).map(id => <option key={id} value={id}>{people.find(p => p.id === id)?.name || id}</option>)}
    </select>{!(candidates[n.id]?.length) && <span role="status">当前无合格候选人，请联系流程管理员核对规则。</span>}</label>)}
  </section>;
}
