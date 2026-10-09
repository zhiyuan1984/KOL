import { useEffect, useRef, useState } from "react";
import { api, type WorkOrderSuggestion } from "../api";
import { randomUuid } from "../uuid";

const reasons: Record<string, string> = {
  source_event_already_adopted: "该事件已进入正式工单",
  automation_release_disabled: "当前模板执行规则未启用",
  template_not_published: "模板已停用或未发布",
  verified_event_missing: "缺少可核验的事件依据",
  decision_confidence_below_release_threshold: "建议未达到已发布执行门槛",
  merge_target_missing: "当前没有可合并的开放工单",
  task_status_not_executable: "任务当前状态不允许采纳",
  automation_level_not_executable: "此模板尚未接入人工采纳执行",
  routing_policy_not_supported: "当前分派规则不受支持",
  decision_routing_policy_not_released: "建议与已发布分派规则不一致",
};
type Confirmation = { suggestion: WorkOrderSuggestion; action: string; target?: string; key: string };

export function WorkOrderSuggestions({ taskId, onChanged, compactEmpty = false }: { taskId: string; onChanged: () => void; compactEmpty?: boolean }) {
  const [items, setItems] = useState<WorkOrderSuggestion[] | null>(null);
  const [pending, setPending] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentTask = useRef(taskId);
  currentTask.current = taskId;
  useEffect(() => {
    let stopped = false, reading = false;
    const read = async () => {
      if (stopped || reading || submitting.current) return;
      reading = true;
      try {
        const next = await api.workOrderSuggestions(taskId);
        if (stopped) return;
        setItems(next.suggestions); setError("");
        setPending(previous => {
          const receipt = previous ? next.suggestions.find(item => item.decision_id === previous.suggestion.decision_id)?.execution_receipt : null;
          if (receipt) { setNotice(`已核对正式执行回执 ${receipt.id}`); return null; }
          if (previous && !next.suggestions.some(item => item.decision_id === previous.suggestion.decision_id && item.version === previous.suggestion.version)) {
            setNotice("采纳依据已变化，请重新查看并确认。"); return null;
          }
          return previous;
        });
      } catch (cause) {
        if (!stopped) {
          setItems(null); setPending(null);
          setError([401,403,404].includes(Number((cause as { status?: number }).status))
            ? "工单建议当前不可访问，请核对任务归属或授权。" : "建议读取失败，请重新读取。");
        }
      } finally { reading = false; }
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, 15_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [taskId, refresh]);
  useEffect(() => { setItems(null); setPending(null); setNotice(""); setError(""); }, [taskId]);
  const confirm = async () => {
    if (!pending || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const result = await api.adoptWorkOrderSuggestion(pending.suggestion.decision_id, {
        idempotency_key: pending.key, confirmed: true, basis_version: pending.suggestion.version,
        action: pending.action, target_id: pending.target,
      });
      if (!mounted.current || currentTask.current !== taskId) return;
      setPending(null);
      setNotice(result.attempt.status === "merged" ? `已合并事件依据，回执 ${result.attempt.id}`
        : result.attempt.status === "created" ? `已创建正式工单，回执 ${result.attempt.id}`
        : `未写入：${result.attempt.reason_code || "执行条件未满足"}；回执 ${result.attempt.id}`);
      setRefresh(value => value + 1); onChanged();
    } catch (cause) {
      if (!mounted.current || currentTask.current !== taskId) return;
      const status = Number((cause as { status?: number }).status);
      if ([401,403,404,409,422].includes(status)) {
        setPending(null); setItems(null); setRefresh(value => value + 1);
        setNotice("执行条件或权限已变化，请重新查看建议并确认。");
      } else setError("尚未确认提交结果。可用同一请求重试核对回执。");
    } finally { submitting.current = false; setBusy(false); }
  };
  // Hide only a successfully loaded empty module, never loading/errors or adoption receipts.
  if (compactEmpty && items && !items.length && !pending && !notice && !error) return null;
  return <section aria-label="工单建议">
    <h3>工单建议 <small className="muted">未采纳的建议不是正式待办</small></h3>
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error} <button className="btn ghost sm" type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>重新读取</button></p> : null}
    {items?.length ? <ol className="task-detail-events">{items.map(item => <li key={item.decision_id}>
      <strong>{item.template_title || item.template_code} · v{item.template_version}</strong>
      {item.source_event ? <p>事件依据：{item.source_event.summary} <small>来源版本 {item.source_event.source_version || "未提供"} · {item.source_event.evidence_ref}</small></p> : null}
      {item.blockers.length ? <p>{item.blockers.map(code => reasons[code] || "执行条件未满足，请核对当前规则").join("；")}</p> : null}
      {item.execution_receipt ? <p>执行回执：{item.execution_receipt.id} · {item.execution_receipt.status === "merged" ? "依据已合并" : "已创建工单"}</p> : null}
      {item.actions.includes("create") ? <button className="btn ghost sm" type="button" disabled={busy || !!pending} onClick={() => {
        setNotice(""); setPending({ suggestion: item, action: "create", key: `adopt:${randomUuid()}` });
      }}>采纳建单建议</button> : null}
      {item.actions.includes("merge") ? item.candidates.map(target => <p key={target.id}>
        {target.title} · 当前版本 {target.version} <button className="btn ghost sm" type="button" disabled={busy || !!pending} onClick={() => {
          setNotice(""); setPending({ suggestion: item, action: "merge", target: target.id, key: `adopt:${randomUuid()}` });
        }}>合并到此工单</button>
      </p>) : null}
    </li>)}</ol> : items ? <p className="muted">暂无可查看的工单建议。</p> : !error ? <p role="status">正在读取当前建议…</p> : null}
    {pending ? <div role="group" aria-label="确认采纳建议">
      <p><strong>L3 · 确认{pending.action === "merge" ? "合并事件依据" : "创建正式工单"}</strong></p>
      <p>{pending.suggestion.template_title} · v{pending.suggestion.template_version} · {pending.suggestion.source_event?.summary}</p>
      {pending.target ? <p>合并至 {pending.suggestion.candidates.find(target => target.id === pending.target)?.title}，版本 {pending.suggestion.candidates.find(target => target.id === pending.target)?.version}；只追加依据。</p>
        : pending.suggestion.assignment_target ? <p>按已发布分派规则交给任务负责人：{pending.suggestion.assignment_target.name}。</p> : <p>创建建议工单，尚不分派人员。</p>}
      <p className="muted">按当前发布规则执行；不会推进父任务或合作阶段。</p>
      <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? "正在核对并提交…" : error ? "核对回执并重试" : "确认采纳"}</button>
      <button className="btn ghost sm" type="button" disabled={busy} onClick={() => setPending(null)}>返回建议</button>
    </div> : null}
  </section>;
}
