import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type RuntimeActionView } from "../api";
import { useViewMode } from "../viewMode";

const states: Record<string, string> = { pending: "待确认", dispatching: "正在提交；若长时间无回执，请核对远端结果，不要重复提交",
  queued: "已确认，等待执行", running: "正在采集", starting: "正在启动", stopping: "正在停止", failed: "执行失败",
  succeeded: "已执行", rejected: "未执行", uncertain: "结果待核实，不能重复提交", cancelled: "已取消" };

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

function actionLabel(action: RuntimeActionView): string {
  const operation = action.operation === "start_crawl" ? "采集线索" : action.operation === "stop_crawl" ? "停止采集" : "业务操作";
  const state = action.execution && action.state === "pending" ? action.execution.status : action.state;
  if (state === "succeeded") return action.operation === "start_crawl" ? "采集请求已提交" : action.operation === "stop_crawl" ? "停止请求已提交" : "操作已执行";
  return `${operation} · ${states[state] || state}`;
}

export function RuntimeActions({ sessionId, onChange, children }: { sessionId: string; onChange?: (actions: RuntimeActionView[]) => void;
  children?: (actions: RuntimeActionView[], render: (id: string) => ReactNode) => ReactNode }) {
  const { debug } = useViewMode();
  const [actions, setActions] = useState<RuntimeActionView[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => {
    let active = true;
    let loading = false;
    const reload = () => {
      if (loading) return;
      loading = true;
      void api.runtimeActions(sessionId).then((data) => {
      if (active) { setActions(data.actions); changeRef.current?.(data.actions); setError(""); }
    }).catch(() => { if (active) { setActions([]); changeRef.current?.([]); setError("动作读取失败，暂时隐藏旧数据；请刷新核对当前权限和状态。"); } }).finally(() => { loading = false; });
    };
    setActions([]); changeRef.current?.([]); reload();
    const timer = window.setInterval(reload, 5000);
    window.addEventListener("discovery:candidates-refresh", reload);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("discovery:candidates-refresh", reload); };
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
  async function dequeue(action: RuntimeActionView) {
    setBusy(action.id); setError("");
    try {
      await api.dequeueCrawl(action.id);
      const updated = (await api.runtimeActions(sessionId)).actions;
      setActions(updated); changeRef.current?.(updated);
    } catch { setError("无法取消排队，请刷新核对任务状态。"); }
    finally { setBusy(null); }
  }
  const render = (id: string) => {
    const action = actions.find(row => row.id === id);
    if (!action) return null;
    const pending = action.state === "pending" && !action.execution;
    return <article className="artifact runtime-action-card" key={action.id} data-runtime-action={action.id}>
      <header className="runtime-action-heading"><strong>{pending && action.operation === "start_crawl" ? "请确认本次采集范围" : actionLabel(action)}</strong>
        {pending ? <span className="muted">需要确认（L3）· 确认后{action.operation === "start_crawl" ? "启动外部采集" : "执行以上操作"}</span> : null}</header>
      {action.created_at ? <time dateTime={action.created_at}>{new Date(action.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</time> : null}
      {action.progress && action.progress.state !== "pending" ? <p role="status">{action.progress.summary}</p> : null}
      <details className="runtime-action-scope" open={action.state === "pending" && !action.execution}>
      <summary>操作内容与范围</summary>
      <dl className="runtime-action-summary" aria-label="操作内容与范围">
        {Object.entries(action.arguments).map(([key, value]) => <div key={key}><dt>{argumentLabels[key] || key}</dt><dd>{readableValue(value)}</dd></div>)}
      </dl>
      {action.operation === "start_crawl" ? <p className="muted">确认后开始采集，仅保存候选线索。地区、粉丝与均播条件在结果中核对；检索数量不等于候选人数或任务总量上限。</p> : null}
      {debug ? <details><summary>查看提交参数</summary>
        <pre>{JSON.stringify(action.arguments, null, 2)}</pre>
      </details> : null}
      </details>
      {action.blocked_reason ? <p>{action.blocked_reason}</p> : null}
      {action.state === "pending" && !action.execution ? <div>
        <button className="btn ghost" disabled={Boolean(busy) || Boolean(action.blocked_reason)} onClick={() => void submit(action, true)}>{action.operation === "start_crawl" ? "确认开始采集" : "确认执行以上内容"}</button>
        <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void submit(action, false)}>取消</button>
      </div> : null}
      {action.crawl ? <div role="status">
        <p>采集：{action.crawl.state === "succeeded" ? "已结束" : states[action.crawl.state] || "状态待核对"}</p>
        {action.crawl.state === "running" ? <p>正在采集公开资料。{action.crawl.status_json ? "采集服务仍在更新结果。" : "采集服务尚未提供详细进度。"}</p> : null}
        {debug && action.crawl.status_json ? <details><summary>技术进度</summary><pre>{JSON.stringify(action.crawl.status_json, null, 2)}</pre></details> : null}
        {action.crawl.state === "running" ? <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void crawlAction(action, true)}>申请停止采集</button> : null}
        {action.crawl.state === "queued" ? <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void dequeue(action)}>取消排队</button> : null}
        {action.crawl.state === "uncertain" ? <><button className="btn ghost" disabled={Boolean(busy)} onClick={() => void dequeue(action)}>取消等待</button>
          <p className="muted">远端状态未知，取消只释放本地占位，远端任务可能仍在运行。</p></> : null}
        {!action.can_retry && !action.progress && ["failed", "cancelled"].includes(action.crawl.state) ? <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void crawlAction(action, false)}>重新核对并重试</button> : null}
      </div> : null}
      {action.can_retry ? <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void crawlAction(action, false)}>重新核对并重试</button> : null}
      {action.receipt || action.execution ? <details><summary>查看操作记录</summary>
        <dl className="runtime-action-summary"><div><dt>操作</dt><dd>{action.operation === "start_crawl" ? "采集公开红人资料" : action.operation === "stop_crawl" ? "停止采集" : "业务操作"}</dd></div>
          <div><dt>当前结果</dt><dd>{actionLabel(action)}</dd></div>
          {action.actor_name ? <div><dt>操作人</dt><dd>{action.actor_name}</dd></div> : null}
          {action.updated_at ? <div><dt>最近记录时间</dt><dd>{new Date(action.updated_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</dd></div> : null}
          <div><dt>说明</dt><dd>提交请求和采集完成分别记录；候选资料需另行确认加入公海。</dd></div></dl>
        {debug ? <pre>{JSON.stringify(action.receipt, null, 2)}</pre> : null}</details> : null}
    </article>;
  };
  return <section aria-label="任务执行记录" data-runtime-actions>
    {error ? <p role="status">{error}</p> : null}
    {children ? children(actions, render) : actions.slice().reverse().map(action => render(action.id))}
  </section>;
}
