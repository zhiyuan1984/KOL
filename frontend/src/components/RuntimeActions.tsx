import { useEffect, useState } from "react";
import { api, type RuntimeActionView } from "../api";

const states: Record<string, string> = { pending: "待确认", dispatching: "正在提交；若长时间无回执，请核对远端结果，不要重复提交",
  queued: "已确认，等待执行", running: "正在采集", starting: "正在启动", stopping: "正在停止", failed: "执行失败",
  succeeded: "已取得回执", rejected: "未执行", uncertain: "结果待核实，不能重复提交", cancelled: "已取消" };

export function RuntimeActions({ sessionId }: { sessionId: string }) {
  const [actions, setActions] = useState<RuntimeActionView[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const reload = () => void api.runtimeActions(sessionId).then((data) => {
      if (active) { setActions(data.actions); setError(""); }
    }).catch(() => { if (active) setError("待确认动作暂时无法读取，请稍后刷新。"); });
    setActions([]); reload();
    const timer = window.setInterval(reload, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [sessionId]);
  async function submit(action: RuntimeActionView, confirm: boolean) {
    setBusy(action.id); setError("");
    try {
      if (confirm) await api.confirmRuntimeAction(action.id, action.confirmation_version);
      else await api.cancelRuntimeAction(action.id);
      setActions((await api.runtimeActions(sessionId)).actions);
    } catch { setError("操作未完成，请刷新核对当前状态；参数或权限变化后需要重新提出动作。"); }
    finally { setBusy(null); }
  }
  async function crawlAction(action: RuntimeActionView, stop: boolean) {
    setBusy(action.id); setError("");
    try {
      if (stop) await api.proposeCrawlStop(action.id); else await api.proposeCrawlRetry(action.id);
      setActions((await api.runtimeActions(sessionId)).actions);
    } catch { setError("无法提出操作，请刷新核对任务状态和当前权限。"); }
    finally { setBusy(null); }
  }
  if (!actions.length && !error) return null;
  return <section aria-label="待确认动作" data-runtime-actions>
    {error ? <p role="status">{error}</p> : null}
    {actions.map((action) => <article className="artifact risk-l3" key={action.id}>
      <strong>L3 · {states[action.execution && action.state === "pending" ? action.execution.status : action.state] || action.state}</strong>
      <p>{action.skill_id} · {action.operation}</p>
      <details open={action.state === "pending"}><summary>核对操作内容与范围</summary>
        <pre>{JSON.stringify(action.arguments, null, 2)}</pre>
      </details>
      {action.blocked_reason ? <p>{action.blocked_reason}</p> : null}
      {action.state === "pending" && !action.execution ? <div>
        <button className="btn ghost" disabled={Boolean(busy) || Boolean(action.blocked_reason)} onClick={() => void submit(action, true)}>确认执行以上内容</button>
        <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void submit(action, false)}>取消</button>
      </div> : null}
      {action.crawl ? <div role="status">
        <p>采集：{states[action.crawl.state] || action.crawl.state} · 任务 {action.crawl.remote_task_id || "等待远端回执"}</p>
        {action.crawl.status_json ? <details><summary>采集进度</summary><pre>{JSON.stringify(action.crawl.status_json, null, 2)}</pre></details> : null}
        {action.crawl.state === "running" ? <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void crawlAction(action, true)}>申请停止采集</button> : null}
        {["failed", "cancelled"].includes(action.crawl.state) ? <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void crawlAction(action, false)}>重新核对并重试</button> : null}
      </div> : null}
      {action.receipt ? <details><summary>查看回执</summary><pre>{JSON.stringify(action.receipt, null, 2)}</pre></details> : null}
    </article>)}
  </section>;
}
