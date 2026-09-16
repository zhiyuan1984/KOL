import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type CronJob, type CronRun } from "../api";

const TERMINAL = new Set(["succeeded", "failed", "skipped", "needs_takeover"]);

function statusLabel(status?: string | null): string {
  return ({
    draft: "草稿",
    published: "已发布",
    paused: "已暂停",
    disabled: "未启用",
    queued: "排队中",
    running: "执行中",
    succeeded: "已完成",
    failed: "失败",
    skipped: "已跳过",
    needs_takeover: "待接管",
  } as Record<string, string>)[String(status || "")] || String(status || "—");
}

function timeLabel(value?: string | null): string {
  if (!value) return "尚未运行";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function receiptText(run?: CronRun | null): string {
  const receipt = run?.receipt;
  if (!receipt) return "还没有回执。";
  if (receipt.handler_key === "overdue-scan") {
    const items = Array.isArray(receipt.items) ? receipt.items : [];
    if (!items.length) return "当前没有需要扫描的在途逾期合作。";
    return items.map((item) => {
      const row = item as { handle?: string; days_in_stage?: number; stage_label?: string };
      return `@${row.handle || "?"} · ${row.stage_label || ""} · 已停留 ${row.days_in_stage ?? "?"} 天`;
    }).join("\n");
  }
  if (receipt.handler_key === "daily-task-snapshot") {
    const counts = (receipt.counts || {}) as Record<string, number>;
    return `问候 ${counts.greet || 0} · 跟进 ${counts.follow || 0} · 报价 ${counts.quote || 0} · 谈判 ${counts.negotiate || 0}`;
  }
  if (receipt.handler_key === "ownership-release") {
    return `已释放 ${Number(receipt.released_count || 0)} 条，跳过 ${Number(receipt.skipped_count || 0)} 条。缺往来时间戳的关系不会被释放。`;
  }
  if (receipt.handler_key === "discovery-search") {
    return "发现搜索未启用，不会调用采集器，也不会伪造运行结果。";
  }
  return JSON.stringify(receipt, null, 2);
}

export default function Cron() {
  const { jobId } = useParams();
  const nav = useNavigate();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const [activeRun, setActiveRun] = useState<CronRun | null>(null);
  const [busy, setBusy] = useState("");
  const [showReceipt, setShowReceipt] = useState(false);
  const [expertStub, setExpertStub] = useState(false);

  const selected = useMemo(
    () => jobs.find((job) => job.id === jobId || job.job_key === jobId) || jobs[0] || null,
    [jobs, jobId],
  );

  const loadJobs = () => api.cronJobs()
    .then((data) => {
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setLoadState("ok");
    })
    .catch((e) => {
      setError(e instanceof Error ? e.message : "无法加载定时任务");
      setLoadState("error");
    });

  useEffect(() => {
    void loadJobs();
  }, []);

  useEffect(() => {
    if (!selected?.id) {
      setRuns([]);
      return;
    }
    let cancelled = false;
    api.cronJobRuns(selected.id)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.runs) ? data.runs : [];
        setRuns(list);
        if (!activeRun) setActiveRun(list[0] || null);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!activeRun?.id || TERMINAL.has(String(activeRun.status))) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void api.cronRun(activeRun.id).then((data) => {
        if (cancelled || !data.run) return;
        setActiveRun(data.run);
        setRuns((current) => current.map((row) => row.id === data.run.id ? data.run : row));
        if (TERMINAL.has(String(data.run.status))) {
          setShowReceipt(true);
          void loadJobs();
        }
      }).catch(() => undefined);
    }, 800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRun?.id, activeRun?.status]);

  const selectJob = (job: CronJob) => {
    setShowReceipt(false);
    setExpertStub(false);
    setActiveRun(null);
    nav(`/cron/${job.job_key || job.id}`);
  };

  const runNow = async () => {
    if (!selected) return;
    setBusy("run");
    setError("");
    setExpertStub(false);
    try {
      const result = await api.runCronJob(selected.id);
      if ("session_id" in result && result.session_id) {
        throw new Error("定时作业不能创建会话");
      }
      const run = await api.cronRun(result.run_id);
      setActiveRun(run.run);
      setRuns((current) => [run.run, ...current.filter((row) => row.id !== run.run.id)]);
      setShowReceipt(true);
      if (!jobId) nav(`/cron/${selected.job_key || selected.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法立即运行");
    } finally {
      setBusy("");
    }
  };

  const togglePause = async () => {
    if (!selected || selected.legal_fields_readonly && selected.job_key === "discovery-search") return;
    if (selected.status === "disabled") return;
    setBusy("pause");
    try {
      const next = selected.status === "paused" ? "published" : "paused";
      const data = await api.patchCronJob(selected.id, { status: next });
      setJobs((current) => current.map((job) => job.id === data.job.id ? data.job : job));
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法更新状态");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="list-page cron-page" data-cron-page>
      <header className="cron-hero">
        <div className="page-kicker">定时</div>
        <h1>定时任务</h1>
        <p className="muted">已发布的后台作业。关闭页面不会停掉到期工作。确定动作不会创建会话。</p>
      </header>

      {loadState === "loading" && (
        <div className="cron-catalog" data-cron-state="loading" aria-busy="true">
          <div className="cron-skeleton" />
          <div className="cron-skeleton" />
          <div className="cron-skeleton" />
        </div>
      )}
      {loadState === "error" && <p className="error" role="alert" data-cron-state="error">{error}</p>}
      {loadState === "ok" && jobs.length === 0 && (
        <p className="muted" data-cron-state="empty">还没有已发布的定时作业。</p>
      )}

      {loadState === "ok" && (
        <div className="cron-catalog" data-cron-state="ok">
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              className={"cron-card" + (selected?.id === job.id ? " is-selected" : "")}
              data-cron-job={job.job_key}
              data-cron-status={job.status}
              onClick={() => selectJob(job)}
            >
              <div className="cron-card-head">
                <h3>{job.title}</h3>
                <span className="cron-status" data-status={job.enabled === false ? "disabled" : job.status}>
                  {job.enabled === false ? "未启用" : statusLabel(job.status)}
                </span>
              </div>
              <p className="muted">执行身份 {job.execute_identity}</p>
              <p className="muted">{job.frequency} · {String((job.scope as { label?: string } | undefined)?.label || "适用于我的授权范围")}</p>
              <p className="muted">下次 {timeLabel(job.next_run_at)} · 上次 {statusLabel(job.last_terminal_status)}</p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <section className="cron-detail" data-cron-detail={selected.job_key}>
          <div className="cron-detail-head">
            <div>
              <h2>{selected.title}</h2>
              <p className="muted">
                {selected.execute_identity} · {selected.frequency} · 专家 {selected.capability_expert_id}
              </p>
            </div>
            <div className="cron-actions">
              <button
                type="button"
                className="btn work"
                data-cron-receipt
                onClick={() => setShowReceipt(true)}
              >
                查看回执
              </button>
              <button
                type="button"
                className="btn ghost"
                data-cron-run-now
                disabled={busy === "run" || selected.enabled === false || selected.status === "disabled"}
                onClick={() => void runNow()}
              >
                {busy === "run" ? "正在运行…" : "立即运行"}
              </button>
              <button
                type="button"
                className="btn ghost"
                data-cron-pause
                disabled={busy === "pause" || selected.status === "disabled"}
                onClick={() => void togglePause()}
              >
                {selected.status === "paused" ? "继续" : "暂停"}
              </button>
            </div>
          </div>

          <div className="cron-contract muted">
            <p>条件：{selected.job_key === "ownership-release" ? "连续 14 天无有效往来且归属未续期/未改派" : selected.job_key === "overdue-scan" ? "在途逾期合作" : selected.job_key === "daily-task-snapshot" ? "待问候 / 跟进 / 报价 / 谈判" : "未启用"}</p>
            <p>重试 {String((selected.retry_policy as { max_attempts?: number })?.max_attempts || 1)} 次 · 超时后 {String((selected.takeover_policy as { action?: string })?.action || "needs_takeover")}</p>
            {selected.enabled === false && <p data-cron-disabled>该作业未启用，不会产生伪造运行。</p>}
          </div>

          {error && <p className="error" role="alert">{error}</p>}

          {showReceipt && (
            <article className="cron-receipt" data-cron-receipt-panel>
              <h3>运行回执</h3>
              <p className="muted">{activeRun ? `${statusLabel(activeRun.status)} · ${timeLabel(activeRun.finished_at || activeRun.started_at)}` : "还没有本次回执"}</p>
              <pre>{receiptText(activeRun)}</pre>
              <button type="button" className="btn ghost" data-cron-expert-stub onClick={() => setExpertStub(true)}>
                请专家解读本次回执
              </button>
              {expertStub && (
                <p className="muted" data-cron-expert-stub-note>
                  解读入口尚未开通。本次结果以回执为准，不会打开会话。
                </p>
              )}
            </article>
          )}

          <div className="cron-timeline" data-cron-timeline>
            <h3>运行记录</h3>
            {runs.length === 0 && <p className="muted">还没有运行记录。</p>}
            <ol>
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    to={`/cron/${selected.job_key || selected.id}`}
                    data-cron-run={run.id}
                    data-cron-run-status={run.status}
                    onClick={() => {
                      setActiveRun(run);
                      setShowReceipt(true);
                    }}
                  >
                    {statusLabel(run.status)} · {run.trigger === "manual" ? "手动" : "定时"} · {timeLabel(run.scheduled_for)}
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}
    </div>
  );
}
