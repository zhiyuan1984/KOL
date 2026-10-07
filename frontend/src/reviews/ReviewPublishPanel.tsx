import type { ReviewCondition, ReviewDefinition, ReviewIssue, ReviewSimulation } from "../../../shared/review";
import type { ReviewContext } from "./api";
import { ReviewForm } from "./ReviewForm";
import { PublishChanges } from "./ReviewChanges";

export const issueStep = (issue: ReviewIssue) => issue.target?.step || (issue.path.startsWith("fields") ? "form" : issue.path.startsWith("nodes") ? "flow" : "basic");
function describeCondition(condition: ReviewCondition, definition: ReviewDefinition): string {
  if ("field" in condition) {
    const operators = { eq: "等于", ne: "不等于", gt: "大于", gte: "大于或等于", lt: "小于", lte: "小于或等于", contains: "包含" };
    const value = typeof condition.value === "object" ? `${condition.value.amount} ${condition.value.currency}` : String(condition.value);
    return `${definition.fields.find(f => f.id === condition.field)?.label || "已删除字段"} ${operators[condition.op]} ${value}`;
  }
  if (condition.op === "not") return `不满足（${describeCondition(condition.condition, definition)}）`;
  return `（${condition.conditions.map(c => describeCondition(c, definition)).join(condition.op === "all" ? "，且 " : "，或 ")}）`;
}
export function ReviewPublishPanel({ definition, context, issues, checkState, onCheck, onIssue, values, onValues, requester, onRequester, result, trialState, onTrial, template, showDiff }: {
  definition: ReviewDefinition; context?: ReviewContext; issues: ReviewIssue[];
  checkState: string; onCheck: () => void; onIssue: (issue: ReviewIssue) => void;
  values: Record<string, unknown>; onValues: (values: Record<string, unknown>) => void;
  requester: string; onRequester: (id: string) => void;
  result?: ReviewSimulation; trialState: string; onTrial: () => void;
  template?: { id: string; version: number; publishedVersion?: number | null; enabled?: boolean };
  showDiff?: boolean;
}) {
  const groups = [["basic", "基本信息与归属"], ["form", "表单配置"], ["flow", "步骤连接与人员规则"]];
  const checked = checkState === "passed" || checkState === "issues";
  const dynamic = definition.nodes.filter(n => n.type === "condition" || n.assignee?.kind === "manager");
  return <div className="review-publish-grid">
      <section aria-label="配置检查" className="review-form">
      <div className="review-section-head"><h2>配置检查</h2><button type="button" onClick={onCheck}>重新检查</button></div>
      <p role="status">{checkState === "checking" ? "正在检查当前配置…" : checkState === "stale" ? "配置已修改，需重新检查" : checkState === "failed" ? "检查服务暂不可用，请重试" : checked ? issues.length ? `还有 ${issues.length} 项配置问题` : "配置检查通过" : "尚未检查"}</p>
      <p className="review-publish-impact">{template?.publishedVersion ? `当前发布版 v${template.publishedVersion}${template.enabled === false ? "（已停用）" : "（供后续新申请使用）"}。发布新版本后，已有申请继续使用其创建时的流程版本。` : "当前尚无发布版本。发布后仅供后续新申请使用；已有申请保持创建时的流程版本。"}</p>
      {groups.map(([step, label]) => {
        const problems = issues.filter(x => issueStep(x) === step);
        return <section key={step} className="review-check-group"><h3>{label} · {checked ? problems.length ? "有问题" : "✓ 已通过" : "待检查"}</h3>
          {!!problems.length && <ul>{problems.map((x, index) => <li key={index}>{x.message} <button type="button" onClick={() => onIssue(x)}>去修改</button></li>)}</ul>}
        </section>;
      })}
      {!!dynamic.length && <div className="review-muted"><strong>建议验证的路径与人员</strong><ul>{dynamic.map(n => <li key={n.id}>{n.name}：{n.type === "condition" ? "分别验证条件满足与不满足的路径" : "按不同测试发起人验证组织负责人"}</li>)}</ul><p>试运行可选；一个样例通过仅说明本次输入可解析，不代表全部路径和员工均已验证。</p></div>}
      {template && showDiff && <details><summary>相对发布版的变更</summary><PublishChanges id={template.id} version={template.version} /></details>}
      <details><summary>功能说明</summary><p>支持表单、条件分支、评审、抄送、征询和办理。转交、加签、补充材料和超时按已配置规则执行。路径试运行不验证实际决定、办理、通知、附件授权或超时执行。</p></details>
    </section>
    <details className="review-trial-section">
      <summary>路径试运行（可选）</summary>
      <section aria-label="路径试运行" className="review-form">
      <p className="review-muted">选择一位员工，查看其发起时会匹配的分支和处理人。不会创建正式申请。</p>
      <label>测试发起人<select value={requester} onChange={e => onRequester(e.target.value)}><option value="">请选择员工</option>{context?.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <ReviewForm fields={definition.fields} values={values} onChange={onValues} preview />
      {definition.fields.filter(f => f.type === "attachment").map(f => <label className="review-check" key={f.id}><input type="checkbox" checked={Array.isArray(values[f.id]) && (values[f.id] as string[]).length > 0} onChange={e => onValues({ ...values, [f.id]: e.target.checked ? ["preview-attachment"] : [] })} />{f.label}：测试为已提供附件（不上传文件，正式附件权限另行校验）</label>)}
      <button type="button" disabled={!checked || issues.length > 0 || !requester} onClick={onTrial}>开始试运行</button>
      {!checked && <small>完成当前配置检查后可试运行。</small>}
      <p role="status">{trialState === "running" ? "正在解析测试路径…" : trialState === "stale" ? "测试输入或配置已修改，需重新试运行" : trialState === "failed" ? "试运行服务暂不可用，请重试" : ""}</p>
      {result && <section aria-label="路径试运行结果"><h3>路径试运行结果 · {result.status === "invalid" ? "测试数据有问题" : result.blockedReason ? "路径阻断" : "路径可解析"}</h3>
        {result.issues.map((x, i) => <p key={i} role="alert">{x.message}</p>)}
        {result.blockedReason && <p role="alert">{result.blockedReason}</p>}
        <ol className="review-trace">{result.trace?.map((entry, index) => <li key={index}>
          <strong>{definition.nodes.find(n => n.id === entry.nodeId)?.name || entry.nodeId}</strong>
          {entry.branch && <span> · {entry.branch === "matched" ? "条件满足" : "条件不满足"} → {definition.nodes.find(n => n.id === entry.next)?.name || entry.next}</span>}
          {entry.inputs && <dl>{Object.entries(entry.inputs).map(([id, value]) => <div key={id}><dt>{definition.fields.find(f => f.id === id)?.label || id}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl>}
          {entry.condition && <p>判断规则：{describeCondition(entry.condition, definition)}</p>}
          {entry.userIds && <p>处理人：{entry.userIds.map(id => context?.people.find(p => p.id === id)?.name || id).join("、") || "无法解析"}{entry.type === "cc" ? " · 无需决定" : " · 本次仅解析，不执行真实处理"}</p>}
          {entry.blockedReason && <p className="review-error">{entry.blockedReason}</p>}
        </li>)}</ol>
      </section>}
      </section>
    </details>
  </div>;
}
