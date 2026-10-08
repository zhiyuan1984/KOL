import type { ReviewPreview, ReviewTemplate } from "../../../shared/review";
import type { ReviewContext } from "./api";

export function ReviewSubmissionPreview({ template, preview, people, busy }: { template?: ReviewTemplate; preview?: ReviewPreview; people: ReviewContext["people"]; busy: boolean }) {
  return <aside className="review-detail review-submission-preview" aria-label="申请核对"><header className="review-detail-head"><h2>申请核对</h2><span>R2 · 尚未提交</span></header>
    <div className="review-detail-body"><section><h3>申请事项</h3><p>{preview?.summary.name || template?.definition.name || "请选择审批类型"}{template && ` · 流程 v${template.version}`}</p><p>{template?.definition.description}</p></section>
      <section><h3>谁来处理</h3>{busy ? <p role="status">正在按当前材料和组织规则解析路径…</p> : preview ? <ol className="review-trace">{preview.trace.map((step, index) => <li key={index}><strong>{template?.definition.nodes.find(n => n.id === step.nodeId)?.name || step.nodeId}</strong>
        {step.branch && <span> · {step.branch === "matched" ? "条件满足" : "条件不满足"}</span>}{step.userIds && <p>{step.userIds.map(id => people.find(p => p.id === id)?.name || id).join("、") || "未能解析处理人"}{step.type === "handler" ? " · 办理并登记结果" : step.type === "cc" ? " · 抄送" : ""}</p>}</li>)}</ol>
        : <p className="review-muted">填写材料后点击“核对申请与路径”，查看服务端解析的本次人员和分支。修改材料或选人后需重新核对。</p>}
        {preview?.blockedReason && <p role="alert">{preview.blockedReason}</p>}</section>
      <section><h3>通过后会发生什么</h3><p>{preview?.summary.consequence || (template?.definition.nodes.some(n => n.type === "handler") ? "完成审批后进入已配置的人工办理步骤，办理结果单独登记。" : "按已发布规则记录审批结果。")}</p>
        <p className="review-muted">路径预览不创建申请，也不表示任何人已同意或办理。</p></section>
    </div>
  </aside>;
}
