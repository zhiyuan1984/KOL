import { useEffect, useMemo, useState } from "react";
import type {
  CrawlCandidate,
  CrawlJob,
  CrawlMode,
  CrawlPlan,
  CrawlPlatform,
  StartCrawlInput,
  TaskEvent,
} from "../api";

const PLATFORMS: Array<{ value: CrawlPlatform; label: string }> = [
  { value: "xhs", label: "小红书" },
  { value: "dy", label: "抖音" },
  { value: "ks", label: "快手" },
  { value: "bili", label: "哔哩哔哩" },
  { value: "wb", label: "微博" },
  { value: "tieba", label: "贴吧" },
  { value: "zhihu", label: "知乎" },
];

const MODES: Array<{ value: CrawlMode; label: string }> = [
  { value: "search", label: "关键词搜索" },
  { value: "detail", label: "指定内容" },
  { value: "creator", label: "指定创作者" },
];

const STATUS_LABEL: Record<string, string> = {
  starting: "正在启动",
  running: "远程采集中",
  stopping: "正在停止",
  queued: "已排队",
  crawling: "远程采集中",
  uploading: "正在上传结果",
  analyzing: "正在分析候选人",
  result_ready: "结果已就绪",
  error: "任务异常",
  stopped: "已停止",
};

const ACTIVE = new Set(["queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping"]);

function list(value: string): string[] {
  return [...new Set(value.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean))];
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function crawlCandidates(...sources: unknown[]): CrawlCandidate[] {
  for (const source of sources) {
    const root = nestedRecord(source);
    if (!root) continue;
    const candidates = root.creators || root.candidates;
    if (Array.isArray(candidates)) return candidates as CrawlCandidate[];
    for (const key of ["crawl_result", "task_result", "result", "data"]) {
      const nested = nestedRecord(root[key]);
      const found = nested?.creators || nested?.candidates;
      if (Array.isArray(found)) return found as CrawlCandidate[];
    }
  }
  return [];
}

function basicScore(candidate: CrawlCandidate) {
  const supplied = candidate.score_components || candidate.score_details;
  if (supplied && Object.keys(supplied).length) {
    const preferred = [
      ["播放中位数", supplied.view_median],
      ["播放/粉丝比", supplied.view_follower_ratio],
      ["稳定度", supplied.stability],
      ["样本置信度", supplied.sample_confidence],
    ].filter((entry): entry is [string, number] => Number.isFinite(Number(entry[1])))
    return {
      parts: preferred,
      total: Number(candidate.score ?? supplied.score ?? 0),
    };
  }
  const views = Array.isArray(candidate.recent_views)
    ? candidate.recent_views.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, candidate.recent_views.length)
    : Number(candidate.recent_views || 0);
  const followerScore = Math.round(Math.min(50, Math.log10(Math.max(1, Number(candidate.followers || 0))) / 7 * 50));
  const viewScore = Math.round(Math.min(50, Math.log10(Math.max(1, views)) / 8 * 50));
  return { parts: [["粉丝规模", followerScore], ["近期播放", viewScore]] as Array<[string, number]>, total: followerScore + viewScore };
}

function confidence(candidate: CrawlCandidate): string {
  if (candidate.confidence != null) {
    const value = typeof candidate.confidence === "number" && candidate.confidence <= 1
      ? `${Math.round(candidate.confidence * 100)}%`
      : String(candidate.confidence);
    return value;
  }
  const complete = [candidate.creator_id || candidate.id, candidate.nickname, candidate.followers, candidate.recent_views]
    .filter((value) => value != null && value !== "").length;
  return `${Math.round(complete / 4 * 100)}%`;
}

function formatCount(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "—";
}

function recentViews(value: CrawlCandidate["recent_views"]): string {
  if (!Array.isArray(value)) return formatCount(value);
  if (!value.length) return "—";
  const average = value.reduce((sum, item) => sum + Number(item || 0), 0) / value.length;
  return `${formatCount(Math.round(average))}（${value.length} 条均值）`;
}

export default function CrawlArtifact({
  plan,
  job,
  events,
  candidates,
  busy,
  error,
  onStart,
  onStop,
  onPrefill,
  showControls = true,
  isAdmin = false,
  onRetryUpload,
  onClearHistory,
}: {
  plan?: CrawlPlan | null;
  job?: CrawlJob | null;
  events: TaskEvent[];
  candidates: CrawlCandidate[];
  busy: boolean;
  error?: string;
  onStart: (input: StartCrawlInput) => Promise<void>;
  onStop: () => Promise<void>;
  onPrefill: (text: string) => void;
  showControls?: boolean;
  isAdmin?: boolean;
  onRetryUpload?: () => Promise<void>;
  onClearHistory?: () => Promise<void>;
}) {
  const [platform, setPlatform] = useState<CrawlPlatform>(plan?.platform || "xhs");
  const [mode, setMode] = useState<CrawlMode>(plan?.mode || "search");
  const [input, setInput] = useState(
    (plan?.keywords || plan?.specified_ids || plan?.creator_ids || []).join("\n"),
  );
  const [validation, setValidation] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!plan) return;
    setPlatform(plan.platform || "xhs");
    setMode(plan.mode || "search");
    setInput((plan.keywords || plan.specified_ids || plan.creator_ids || []).join("\n"));
    setValidation("");
  }, [plan]);

  useEffect(() => {
    if (!job || !ACTIVE.has(job.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job]);

  const elapsed = useMemo(() => {
    if (job?.elapsed_seconds != null) return Math.max(0, Math.round(job.elapsed_seconds));
    const started = job?.started_at || job?.created_at;
    if (!started) return null;
    return Math.max(0, Math.round((now - new Date(started).getTime()) / 1000));
  }, [job, now]);

  const start = async () => {
    const values = list(input);
    const fieldLabel = mode === "search" ? "关键词" : mode === "detail" ? "内容 ID" : "创作者 ID";
    if (!values.length) {
      setValidation(`请至少填写一个${fieldLabel}，可用换行或逗号分隔。`);
      return;
    }
    setValidation("");
    await onStart({
      platform,
      mode,
      ...(mode === "search" ? { keywords: values } : {}),
      ...(mode === "detail" ? { specified_ids: values } : {}),
      ...(mode === "creator" ? { creator_ids: values } : {}),
      idempotency_key: crypto.randomUUID(),
    });
  };

  return (
    <div className="crawl-artifact" data-crawl-workflow>
      {showControls && <section className="crawl-plan-card" aria-labelledby="crawl-plan-title">
        <div className="page-kicker">远程采集计划</div>
        <h2 id="crawl-plan-title">创作者发现</h2>
        <label>
          平台
          <select value={platform} onChange={(event) => setPlatform(event.target.value as CrawlPlatform)} data-crawl-platform>
            {PLATFORMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <fieldset>
          <legend>采集模式</legend>
          <div className="crawl-mode-options">
            {MODES.map((item) => (
              <label key={item.value}>
                <input
                  type="radio"
                  name="crawl-mode"
                  value={item.value}
                  checked={mode === item.value}
                  onChange={() => { setMode(item.value); setInput(""); setValidation(""); }}
                />
                {item.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          {mode === "search" ? "关键词" : mode === "detail" ? "内容 ID" : "创作者 ID"}
          <textarea
            rows={3}
            value={input}
            onChange={(event) => { setInput(event.target.value); setValidation(""); }}
            placeholder={mode === "search" ? "例如：户外电源，房车旅行" : "每行一个 ID，或使用逗号分隔"}
            data-crawl-input
          />
        </label>
        {validation && <p className="crawl-validation" role="alert">{validation}</p>}
        {error && <p className="crawl-validation" role="alert">{error}</p>}
        <button className="btn work" type="button" onClick={() => void start()} disabled={busy || Boolean(job && ACTIVE.has(job.status))} data-start-crawl>
          {busy ? "正在提交…" : "确认启动"}
        </button>
      </section>}

      {showControls && job && (
        <section className="crawl-status-card" data-crawl-status={job.status}>
          <div className="crawl-status-head">
            <div>
              <div className="page-kicker">远程任务</div>
              <h3>{STATUS_LABEL[job.status] || "状态已更新"}</h3>
            </div>
            {ACTIVE.has(job.status) && (
              <button className="btn ghost" type="button" onClick={() => void onStop()} disabled={busy} data-stop-crawl>
                停止
              </button>
            )}
          </div>
          <dl className="crawl-job-meta">
            <div><dt>采集任务编号</dt><dd>{job.remote_task_id || "—"}</dd></div>
            <div><dt>已用时</dt><dd>{elapsed != null ? `${elapsed} 秒` : "—"}</dd></div>
            <div><dt>最近检查</dt><dd>{job.last_checked_at || job.updated_at ? new Date(job.last_checked_at || job.updated_at || "").toLocaleString("zh-CN") : "—"}</dd></div>
            <div className={job.upload_error || (job.status === "error" && job.error) ? "crawl-job-error" : ""}><dt>采集异常</dt><dd>{job.upload_error || (job.status === "error" && job.error) || "无"}</dd></div>
          </dl>
          {events.length > 0 && (
            <ol className="crawl-event-list" aria-label="采集进度">
              {events.slice(-5).map((event, index) => (
                <li key={event.id || index}>{STATUS_LABEL[String(event.status || event.type)] || String(event.title || event.label || event.message || "进度已更新")}</li>
              ))}
            </ol>
          )}
          {isAdmin && (
            <div className="crawl-admin-actions">
              {(job.upload_error || job.status === "error") && onRetryUpload && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => void onRetryUpload()}>
                  重试上传
                </button>
              )}
              {onClearHistory && (
                <button
                  type="button"
                  className="btn ghost danger-text"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("确认清除远程采集历史？此操作不可撤销，且不会显示或清除任何访问令牌。")) {
                      void onClearHistory();
                    }
                  }}
                >
                  清除采集历史
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {candidates.length > 0 && (
        <section className="crawl-results" data-crawl-candidates>
          <div className="page-kicker">候选创作者结果</div>
          <h3>共 {candidates.length} 位候选人</h3>
          <div className="candidate-table-wrap">
            <table className="candidate-table">
              <thead><tr><th>平台 / 创作者</th><th>粉丝</th><th>近期播放</th><th>基础评分</th><th>置信度</th><th>下一步</th></tr></thead>
              <tbody>
                {candidates.map((candidate, index) => {
                  const id = String(candidate.creator_id || candidate.id || "—");
                  const score = basicScore(candidate);
                  return (
                    <tr key={`${candidate.platform}-${id}-${index}`}>
                      <td><strong>{candidate.nickname || "未命名创作者"}</strong><small>{candidate.platform || job?.platform || "—"} · {id}</small></td>
                      <td>{formatCount(candidate.followers)}</td>
                      <td>{recentViews(candidate.recent_views)}</td>
                      <td><strong>{Math.round(score.total)}</strong><small>{score.parts.map(([label, value]) => `${label} ${Math.round(Number(value))}`).join(" · ")}</small></td>
                      <td>{confidence(candidate)}</td>
                      <td className="candidate-actions">
                        <button type="button" onClick={() => onPrefill(`为 ${candidate.platform || job?.platform || platform} 创作者 ${id}（${candidate.nickname || "未命名"}）创建创作者画像任务`)}>画像</button>
                        <button type="button" onClick={() => onPrefill(`为 ${candidate.platform || job?.platform || platform} 创作者 ${id} 创建创作者评分任务`)}>评分</button>
                        <button type="button" onClick={() => onPrefill(`基于创作者 ${id} 创建合作推荐任务`)}>推荐</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">基础评分由粉丝规模与近期播放确定性计算；置信度表示关键字段完整度。</p>
        </section>
      )}
    </div>
  );
}
