import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type TaskCollaborationContext as Context } from "../api";

const reasons: Record<string, string> = {
  dependency_rule_not_published: "尚未发布此动作的依赖规则，请联系流程负责人",
  template_not_published: "工单模板已停用，请复核当前流程",
  prerequisite_binding_missing: "前置工单未完整关联，请核对依赖",
  prerequisite_not_available: "前置工单当前不可访问，请核对归属或授权",
  prerequisite_template_mismatch: "前置工单与已发布规则不符，请重新关联",
  prerequisite_not_completed: "前置工单尚未完成，请先处理该工单",
  review_not_available: "当前审批不可用，请核对审批关联与授权",
  review_not_approved: "审批尚未通过，请到审批详情处理",
  review_template_mismatch: "审批类型或版本不符，请按当前流程重新提交",
  review_content_mismatch: "审批未覆盖当前动作和内容版本，请重新提交审批",
  collaboration_not_available: "合作关系当前不可访问或关联不符，请核对授权",
  artifact_not_available: "产物当前不可用，请核对产物关联",
  artifact_version_conflict: "产物已变化，请复核新版本并重新审批",
};
const statuses: Record<string, string> = { approved: "已通过", reviewing: "审批中", rejected: "已拒绝", withdrawn: "已撤回",
  blocked: "受阻", awaiting_amendment: "待补充", completed: "已完成", in_progress: "处理中", assigned: "已分派",
  accepted: "已受理", waiting_approval: "待审批", waiting_external: "等待外部", cancelled: "已取消" };

/** L1 only. Versions and blockers come from the server, never UI rules. */
export function TaskCollaborationContext({ taskId, titles, onUnavailable, compactEmpty = false }: { taskId: string; titles: Record<string, string>; onUnavailable: () => void; compactEmpty?: boolean }) {
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false, busy = false, cursor = 0;
    let events: Context["events"] = [];
    setContext(null); setError("");
    const read = async () => {
      if (busy || cancelled) return;
      busy = true;
      try {
        let next: Context;
        do {
          next = await api.taskCollaborationContext(taskId, cursor);
          if (cancelled) return;
          events = events.filter(event => event.source_type === "work_order"
            ? next.gates.some(gate => gate.work_order_id === event.source_id)
            : next.gates.some(gate => gate.review?.id === event.source_id && gate.review.company_id === event.company_id));
          const seen = new Map(events.map(event => [String(event.sequence), event]));
          for (const event of next.events) seen.set(String(event.sequence), event);
          events = [...seen.values()].sort((a, b) => Number(a.sequence) - Number(b.sequence)).slice(-100);
          if (next.has_more && next.cursor <= cursor) throw new Error("关联变化补读未取得新游标，请重试");
          cursor = next.cursor;
          setContext({ ...next, events }); setError("");
        } while (next.has_more && !cancelled);
      } catch (cause) {
        if (!cancelled) {
          // Includes scope revocation: never keep private cached events visible.
          events = []; cursor = 0; setContext(null);
          const status = Number((cause as { status?: number })?.status);
          setError([401,403,404].includes(status) ? "审批与工单依赖当前不可访问，请核对关联范围或授权。" : cause instanceof Error ? cause.message : "关联上下文读取失败");
          if ([401,403,404].includes(Number((cause as { status?: number })?.status))) onUnavailable();
        }
      } finally { busy = false; }
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [taskId, retry, onUnavailable]);
  // An authorized empty response is not an error. Keep polling mounted for revocation/changes.
  if (compactEmpty && context && !error && !context.gates.length && !context.events.length) return null;
  return <section aria-label="审批与工单依赖">
    <h3>审批与工单依赖 <small className="muted">只读</small></h3>
    {error ? <p role="alert">{error} <button type="button" className="button" onClick={() => setRetry(value => value + 1)}>重新读取</button></p> : !context ? <p role="status">正在读取当前关联与授权…</p> : <>
      {context.gates.length ? <ol className="task-detail-events">{context.gates.map(gate => <li key={gate.work_order_id}>
        <strong>{titles[gate.work_order_id] || gate.work_order_id}</strong>
        <p>{gate.allowed ? "依赖已满足；实际执行仍须经过当前动作闸门" : gate.blockers.map(reason => reasons[reason] || "依赖校验未通过，请重新读取或联系流程负责人").join("；")}</p>
        {gate.review ? <p><Link to={`/reviews/${encodeURIComponent(gate.review.id)}?reviewCompany=${encodeURIComponent(gate.review.company_id)}`}>审批详情</Link> · {statuses[gate.review.status] || gate.review.status} · 版本 {gate.review.version} · 第 {gate.review.round} 轮</p> : null}
        {gate.prerequisites.length ? <p className="muted">前置：{gate.prerequisites.map(prior => `${titles[prior.id] || prior.id}（${statuses[prior.status] || prior.status}，版本 ${prior.version}）`).join("；")}</p> : null}
      </li>)}</ol> : <p className="muted">尚无当前可访问的子工单。</p>}
      {context.events.length ? <details><summary>关联变化记录</summary><ol className="task-detail-events">{context.events.map(event => <li key={String(event.sequence)}>
        <strong>{event.source_type === "review" ? "审批变化" : "工单变化"}</strong><small>{new Date(event.occurred_at).toLocaleString()} · 版本 {event.source_version}</small>
        <p>{event.before_state?.status ? `${statuses[event.before_state.status] || event.before_state.status} → ` : ""}{statuses[event.after_state.status || ""] || event.after_state.status}</p>
      </li>)}</ol></details> : null}
    </>}
  </section>;
}
