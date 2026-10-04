import { useEffect, useRef, useState } from "react";
import { api, type RuntimeActionView } from "../api";

const states: Record<string, string> = { pending: "待确认", dispatching: "正在提交；若长时间无回执，请核对远端结果，不要重复提交",
  queued: "已确认，等待执行", running: "正在采集", starting: "正在启动", stopping: "正在停止", failed: "执行失败",
  succeeded: "已取得回执", rejected: "未执行", uncertain: "结果待核实，不能重复提交", cancelled: "已取消" };

const argumentLabels: Record<string, string> = {
  keywords: "关键词", platforms: "平台", platform: "平台", crawler_type: "采集方式",
  max_notes_count: "单次检索数量", enable_comments: "采集评论", enable_sub_comments: "采集评论回复",
  specified_ids: "指定内容", creator_ids: "指定频道", task_id: "采集任务", confirm: "确认操作",
};
const argumentValues: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook",
  search: "关键词搜索", detail: "指定内容", creator: "指定频道" };
function readableValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (Array.isArray(value)) return value.map(readableValue).join("、") || "未指定";
  if (value === null || value === undefined || value === "") return "未指定";
  if (typeof value === "object") return Object.entries(value).map(([key, child]) => `${argumentLabels[key] || key}：${readableValue(child)}`).join("；");
  return argumentValues[String(value)] || String(value);
}

export function RuntimeActions({ sessionId, onChange }: { sessionId: string; onChange?: (actions: RuntimeActionView[]) => void }) {
  const [actions, setActions] = useState<RuntimeActionView[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => {
    let active = true;
    const reload = () => void api.runtimeActions(sessionId).then((data) => {
      if (active) { setActions(data.actions); changeRef.current?.(data.actions); setError(""); }
    }).catch(() => { if (active) { setActions([]); changeRef.current?.([]); setError("动作读取失败，暂时隐藏旧数据；请刷新核对当前权限和状态。"); } });
    setActions([]); changeRef.current?.([]); reload();
    const timer = window.setInterval(reload, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [sessionId]);
  async function submit(action: RuntimeActionView, confirm: boolean) {
    setBusy(action.id); setError("");
    try {
      if (confirm) await api.confirmRuntimeAction(action.id, action.confirmation_version);
      else await api.cancelRuntimeAction(action.id);
      const updated = (await api.runtimeActions(sessionId)).actions;
      setActions(updated); changeRef.current?.(updated);
    } catch { setError("操作未完成，请刷新核对当前状态；参数或权限变化后需要重新提出动作。"); }
    finally { setBusy(null); }
  }
  async function crawlAction(action: RuntimeActionView, stop: boolean) {
    setBusy(action.id); setError("");
    try {
      if (stop) await api.proposeCrawlStop(action.id); else await api.proposeCrawlRetry(action.id);
      const updated = (await api.runtimeActions(sessionId)).actions;
      setActions(updated); changeRef.current?.(updated);
    } catch { setError("无法提出操作，请刷新核对任务状态和当前权限。"); }
    finally { setBusy(null); }
  }
  if (!actions.length && !error) return null;
  return <section aria-label="待确认动作" data-runtime-actions>
    {error ? <p role="status">{error}</p> : null}
    {actions.map((action) => <article className="artifact risk-l3 runtime-action-card" key={action.id}>
      <strong>L3 · {action.progress?.label || states[action.execution && action.state === "pending" ? action.execution.status : action.state] || action.state}</strong>
      {action.progress && action.progress.state !== "pending" ? <p role="status">{action.progress.summary}</p> : null}
      <p>{action.operation === "start_crawl" ? "采集线索" : action.operation === "stop_crawl" ? "停止采集" : "业务操作"}</p>
      <dl className="runtime-action-summary" aria-label="操作内容与范围">
        {Object.entries(action.arguments).map(([key, value]) => <div key={key}><dt>{argumentLabels[key] || key}</dt><dd>{readableValue(value)}</dd></div>)}
      </dl>
      {action.operation === "start_crawl" ? <p className="muted">确认后开始采集，仅保存候选线索。地区、粉丝与均播条件在结果中核对；检索数量不等于候选人数或任务总量上限。</p> : null}
      <details><summary>查看提交参数</summary>
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
        {!action.can_retry && !action.progress && ["failed", "cancelled"].includes(action.crawl.state) ? <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void crawlAction(action, false)}>重新核对并重试</button> : null}
      </div> : null}
      {action.can_retry ? <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void crawlAction(action, false)}>重新核对并重试</button> : null}
      {action.receipt ? <details><summary>查看回执</summary><pre>{JSON.stringify(action.receipt, null, 2)}</pre></details> : null}
    </article>)}
  </section>;
}
