import { useId, type ReactNode } from "react";
import type { InstanceView, ReviewContext } from "./api";
import { formatReviewValue } from "./formatReviewValue";
import { AttachmentLinks } from "./ReviewAttachments";
import KnowledgeMaterial from "./KnowledgeMaterial";
import KnowledgeScopeMaterial from './KnowledgeScopeMaterial';
import { reviewActionLabels } from "./ReviewActions";
import { ReviewMaterialChanges } from "./ReviewMaterialChanges";

export const reviewStatusText = { reviewing: "审批中", approved: "审批已通过", rejected: "审批已驳回", withdrawn: "已撤回", blocked: "审批受阻", awaiting_amendment: "等待补充材料" };
const taskText = { pending: "待处理", waiting: "等待前序", approved: "已同意", rejected: "已驳回", cancelled: "已关闭", transferred: "已转交", suspended: "已暂停", superseded: "已被新轮次取代", completed: "已完成" };

export function reviewStatusLabel(i: InstanceView) {
  return i.progress?.approval === "approved" && i.progress.fulfillment === "handling" ? "审批已通过 · 办理中" : reviewStatusText[i.status];
}

export function ReviewDetail({ instance: i, context, actions, close, wide, toggleWide }: {
  instance: InstanceView; context?: ReviewContext; actions: ReactNode;
  close: () => void; wide: boolean; toggleWide: () => void;
}) {
  const person = (id: string) => context?.people.find(p => p.id === id)?.name || id;
  const anchor = useId();
  const jump = (part: string) => { const el = document.getElementById(`${anchor}-${part}`); if (el instanceof HTMLDetailsElement) el.open = true; el?.scrollIntoView({ block: "start" }); };
  const publication = i.knowledgePublication;
  const rounds = [...new Set(i.tasks.map(t => t.round || 1))].sort((a, b) => b - a);
  const renderRound = (round: number) => <ol className="review-steps-list">{i.tasks.filter(t => (t.round || 1) === round).map((t, index) => <li key={t.id || index} data-current={t.status === "pending" || undefined}>
    <details open={t.status === "pending" || undefined}>
      <summary><strong>{i.definition.nodes.find(n => n.id === t.nodeId)?.name || "审批步骤"}</strong><span>{person(t.userId)}</span><span>{taskText[t.status]}</span></summary>
      <p>第 {round} 轮{t.reason ? ` · 意见：${t.reason}` : " · 暂无处理意见"}</p>
      {t.decidedAt && <time dateTime={t.decidedAt}>{new Date(t.decidedAt).toLocaleString()}</time>}
      {t.status === "pending" && t.dueAt && <p>处理期限：{new Date(t.dueAt).toLocaleString()}{Date.parse(t.dueAt) < Date.now() ? " · 已超时" : ""}</p>}
    </details>
  </li>)}</ol>;
  return <section className="review-detail" aria-label="申请详情">
    <header className="review-detail-head">
      <div><h2>{i.title}</h2><p><span data-review-status={i.status}>{reviewStatusLabel(i)}</span> · 流程版本 v{i.templateVersion}</p></div>
      <button onClick={toggleWide} aria-pressed={wide}>{wide ? "恢复列表与详情" : "展开宽视图"}</button>
      <button onClick={close}>返回列表</button>
    </header>
    <nav className="review-detail-nav" aria-label="申请详情导航">{[["content", "申请内容"], ["progress", "审批进度"], ["result", "办理结果"], ["history", "操作记录"]].map(([part, label]) => <button key={part} onClick={() => jump(part)}>{label}</button>)}</nav>
    <div className="review-detail-body">
      {actions && <p className="review-responsibility">当前需要我：{i.progress?.currentResponsibility || i.definition.nodes.find(n => n.id === i.currentNode)?.name || "处理申请"}</p>}
      <ReviewMaterialChanges instance={i} />
      {i.blockedReason && <p role="alert">{i.blockedReason}</p>}
      <section id={`${anchor}-content`} aria-label="申请内容"><h3>申请内容</h3>
          {i.source && <section aria-label="来源材料快照"><h3>来源材料快照 · {i.source.label}</h3><p>{i.source.id} · 材料版本 {i.source.version.slice(0, 12)}</p><p>{i.source.snapshot.brand} · {i.source.snapshot.stage}</p><p>{i.source.snapshot.notes || "未填写备注"}</p></section>}
        <dl className="review-values"><div><dt>发起人</dt><dd>{person(i.requester)}</dd></div><div><dt>发起时间</dt><dd>{new Date(i.createdAt).toLocaleString()}</dd></div>
        {i.definition.fields.filter(f => f.type !== "attachment" && !(f.id === "knowledge_request" && i.definition.subjectType === "knowledge_publication") && !(publication && f.id === "publication_note")).map(f => <div key={f.id} className={f.type === "textarea" ? "review-field-long" : ""}><dt>{f.label}</dt><dd>{formatReviewValue(i.values[f.id])}</dd></div>)}
          {publication && <div className="review-field-long"><dt>发布说明</dt><dd>{publication.releaseNote || "未填写"}</dd></div>}
        </dl>
      </section>
      {(publication || i.definition.fields.some(f => f.type === "attachment")) && <section aria-label="审批材料"><h3>审批材料</h3>
        {publication && <><p>{publication.filename}{publication.version !== undefined && ` · 资料版本 v${publication.version}`} · 材料指纹 {publication.fingerprint.slice(0, 12)} {!publication.content && <a href={`/api/approvals/v2/instances/${encodeURIComponent(i.id)}/knowledge-source?company=${encodeURIComponent(publication.tenant)}`} target="_blank" rel="noreferrer">查看 PDF 原件</a>}</p>
          {publication.content && <><pre className="kbv-body">{publication.content.body}</pre><dl className="review-values">{Object.entries(publication.content.structured).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{formatReviewValue(value)}</dd></div>)}</dl></>}
          {publication.knowledgeScope && <KnowledgeScopeMaterial material={publication.knowledgeScope} fileUrl={`/api/approvals/v2/instances/${encodeURIComponent(i.id)}/knowledge-source?company=${encodeURIComponent(publication.tenant)}`} />}
          <p>业务结果：{{ waiting: i.status === "approved" ? publication.releaseMode === "manual" ? "等待管理员发布" : "等待发布服务" : "等待审批后发布", published: "知识已发布", failed: "知识发布失败", rejected: "未发布（审批已驳回）", withdrawn: "未发布（已撤回）" }[publication.status]}</p>
          {publication.error && <p role="alert">{publication.error}</p>}{publication.receipt && <details><summary>发布回执</summary>{publication.receipt.id}</details>}
        </>}
        {i.definition.fields.filter(f => f.type === "attachment").map(f => <div key={f.id}><strong>{f.label}</strong><AttachmentLinks ids={Array.isArray(i.values[f.id]) ? i.values[f.id] as string[] : []} instanceId={i.id} /></div>)}
      </section>}
      {i.definition.subjectType === "knowledge_publication" && !publication && <KnowledgeMaterial key={i.id} id={i.id} />}
      <section id={`${anchor}-progress`} aria-label="审批进度"><h3>审批进度</h3>{rounds.map(round => round === (i.round || 1) ? <div key={round}>{renderRound(round)}</div> : <details key={round}><summary>第 {round} 轮历史</summary>{renderRound(round)}</details>)}</section>
      <section id={`${anchor}-result`} aria-label="办理结果"><h3>办理结果</h3>
        {i.progress && <p>审批结果：{{ pending: "待完成审批", approved: "已通过", rejected: "已驳回", withdrawn: "已撤回" }[i.progress.approval]} · 办理状态：{{ none: "无人工办理步骤", pending: "等待审批路径进入办理", handling: "办理中", completed: "已完成", cancelled: "已关闭" }[i.progress.fulfillment]}</p>}
        {i.tasks.filter(t => (t.round || 1) === (i.round || 1) && t.duty === "handler").map((t, index) => <p key={t.id || index}>{i.definition.nodes.find(n => n.id === t.nodeId)?.name} · {person(t.userId)} · {taskText[t.status]}{t.reason && ` · 完成证据：${t.reason}`}</p>)}
        {!publication && <p className="review-muted">本申请记录审批与人工办理结果；付款、外发及正式阶段变更以各自业务动作的真实回执为准。</p>}
      </section>
      {(i.revisions?.length || 0) > 1 && <details><summary>历次申请材料</summary>{i.revisions?.map(r => <section key={r.round}><h3>第 {r.round} 轮</h3><dl className="review-values">{i.definition.fields.map(f => <div key={f.id}><dt>{f.label}</dt><dd>{f.type === "attachment" ? <AttachmentLinks ids={(r.values[f.id] as string[]) || []} instanceId={i.id} /> : formatReviewValue(r.values[f.id])}</dd></div>)}</dl></section>)}</details>}
      <details id={`${anchor}-history`}><summary>操作记录</summary><ol className="review-event-list">{[...(i.events || [])].sort((a,b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.version - b.version || a.id.localeCompare(b.id)).map(e => <li key={e.id}><time dateTime={e.created_at}>{new Date(e.created_at).toLocaleString()}</time> · {person(e.actor)} · {({ submit: "提交审批", "knowledge.published": "知识已发布", "knowledge.publish_failed": "知识发布失败" } as Record<string,string>)[e.action] || reviewActionLabels[e.action] || e.action}{e.detail.reason && ` · 意见：${e.detail.reason}`}</li>)}</ol></details>
    </div>
    <footer className="review-action-bar">{actions && <p className="review-muted">当前步骤：{i.definition.nodes.find(n => n.id === i.currentNode)?.name || "等待处理"}</p>}{actions || <p>当前没有可执行动作 · 只读</p>}</footer>
  </section>;
}
