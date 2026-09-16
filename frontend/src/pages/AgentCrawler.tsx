import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type CrawlCandidate,
  type CrawlJob,
  type CrawlMode,
  type CrawlPlatform,
  type StartCrawlInput,
  type Task,
} from "../api";
import { crawlCandidates } from "../components/CrawlArtifact";
import { DiscoveryFollowConfirm } from "../home/DiscoveryFollowConfirm";
import {
  followCandidate,
  listDiscoveryRequests,
  type CreatorCandidate,
  type DiscoveryRequest,
} from "../home/discovery";
import {
  CRAWLER_ANALYSIS_COPY,
  expertMissionCopy,
  expertRoleCopy,
  type Expert,
} from "../experts";

const PLATFORMS: Array<{ value: Extract<CrawlPlatform, "youtube" | "instagram">; label: string }> = [
  { value: "youtube", label: "YouTube" },
  { value: "instagram", label: "Instagram" },
];

const MODES: Array<{ value: CrawlMode; label: string }> = [
  { value: "search", label: "关键词搜索" },
  { value: "detail", label: "指定内容" },
  { value: "creator", label: "指定创作者" },
];

export type CrawlerJobTone = "running" | "confirm" | "failed" | "stopped";

export function crawlerJobTone(status: string): CrawlerJobTone | null {
  const key = String(status || "").toLowerCase();
  if (["starting", "running", "queued", "crawling", "uploading", "analyzing", "stopping"].includes(key)) {
    return "running";
  }
  if (key === "result_ready" || key === "succeeded") return "confirm";
  if (key === "error" || key === "failed") return "failed";
  if (key === "stopped" || key === "cancelled") return "stopped";
  return null;
}

/** UX-05: crawler progress must never say「正在思考」. */
export function crawlerJobStatusCopy(status: string): string {
  const tone = crawlerJobTone(status);
  if (tone === "running") return "采集中";
  if (tone === "confirm") return "待确认候选";
  if (tone === "failed") return "失败";
  if (tone === "stopped") return "已停止";
  return "状态已更新";
}

type ConsoleJob = {
  id: string;
  taskId?: string;
  requestId?: string;
  title: string;
  platform?: string;
  mode?: string;
  status: string;
  statusCopy: string;
  tone: CrawlerJobTone | null;
  error?: string;
  candidates: Array<CrawlCandidate | CreatorCandidate>;
};

function unwrapTask(value: Task | { task: Task }): Task {
  return (value as { task?: Task }).task || (value as Task);
}

function unwrapTasks(value: Task[] | { tasks: Task[] }): Task[] {
  return Array.isArray(value) ? value : value.tasks || [];
}

function unwrapCrawlJob(value: CrawlJob | { crawl_job: CrawlJob; job?: CrawlJob }): CrawlJob {
  return (value as { crawl_job?: CrawlJob; job?: CrawlJob }).crawl_job
    || (value as { job?: CrawlJob }).job
    || value as CrawlJob;
}

function listValues(value: string): string[] {
  return [...new Set(value.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean))];
}

function isCrawlTask(task: Task): boolean {
  const skill = String(task.skill || task.skill_id || task.task_type || "");
  return skill === "creator_discovery"
    || Boolean(task.crawl_plan || task.crawl_result)
    || /采集|发现|crawl|discovery/i.test(String(task.title || ""));
}

function jobFromCrawl(task: Task, job: CrawlJob): ConsoleJob {
  const status = String(job.status || task.status || "");
  return {
    id: String(job.id || task.id),
    taskId: task.id,
    title: String(task.title || `${job.platform || "采集"} ${job.mode || ""}`).trim(),
    platform: job.platform,
    mode: job.mode,
    status,
    statusCopy: crawlerJobStatusCopy(status),
    tone: crawlerJobTone(status),
    error: String(job.upload_error || job.error || "").trim() || undefined,
    candidates: crawlCandidates(job, job.result, job.task_result, job.creators, task.crawl_result, task),
  };
}

function jobFromDiscovery(request: DiscoveryRequest): ConsoleJob {
  const status = String(request.latest_run?.status || request.status || "");
  const tone = crawlerJobTone(status) || (status === "open" ? "running" : null);
  return {
    id: request.id,
    requestId: request.id,
    title: request.title || request.plan_summary || request.keywords.join(" ") || "采集作业",
    platform: request.platforms[0],
    mode: request.mode,
    status,
    statusCopy: crawlerJobStatusCopy(status),
    tone,
    error: request.error || request.latest_run?.error || undefined,
    candidates: [],
  };
}

function candidateKey(candidate: CrawlCandidate | CreatorCandidate, index: number): string {
  return String(
    ("id" in candidate && candidate.id)
    || ("creator_id" in candidate && candidate.creator_id)
    || ("handle" in candidate && candidate.handle)
    || index,
  );
}

function candidateLabel(candidate: CrawlCandidate | CreatorCandidate): string {
  const nickname = String(("nickname" in candidate && candidate.nickname) || "").trim();
  const handle = String(("handle" in candidate && candidate.handle) || "").trim();
  const id = String(("creator_id" in candidate && candidate.creator_id) || ("id" in candidate && candidate.id) || "").trim();
  return nickname || (handle ? `@${handle}` : "") || id || "未命名创作者";
}

function followId(candidate: CrawlCandidate | CreatorCandidate): string {
  return String(("id" in candidate && candidate.id) || "").trim();
}

export default function AgentCrawler({
  expert,
}: {
  expert: Expert;
}) {
  const [platform, setPlatform] = useState<Extract<CrawlPlatform, "youtube" | "instagram">>("youtube");
  const [mode, setMode] = useState<CrawlMode>("search");
  const [input, setInput] = useState("");
  const [jobs, setJobs] = useState<ConsoleJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [validation, setValidation] = useState("");
  const [follow, setFollow] = useState<{ id: string; label: string } | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followErr, setFollowErr] = useState("");
  const loadJobs = async () => {
    setLoading(true);
    try {
      const [taskRows, requests] = await Promise.all([
        api.tasks().then(unwrapTasks).catch(() => [] as Task[]),
        listDiscoveryRequests().catch(() => [] as DiscoveryRequest[]),
      ]);
      const crawlTasks = taskRows.filter(isCrawlTask);
      const fromTasks = await Promise.all(crawlTasks.map(async (task) => {
        try {
          return jobFromCrawl(task, unwrapCrawlJob(await api.crawlJob(task.id)));
        } catch {
          if (task.crawl_result || task.crawl_plan) {
            return jobFromCrawl(task, {
              status: String(task.status || "queued"),
              platform: undefined,
              mode: undefined,
            });
          }
          return null;
        }
      }));
      const fromDiscovery = requests.map(jobFromDiscovery);
      const seen = new Set<string>();
      const merged: ConsoleJob[] = [];
      for (const job of [...fromTasks.filter((row): row is ConsoleJob => Boolean(row)), ...fromDiscovery]) {
        if (seen.has(job.id)) continue;
        seen.add(job.id);
        merged.push(job);
      }
      setJobs(merged);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "无法加载采集作业");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
  }, []);

  const submit = async () => {
    const values = listValues(input);
    const fieldLabel = mode === "search" ? "关键词" : mode === "detail" ? "内容 ID" : "创作者 ID";
    if (!values.length) {
      setValidation(`请至少填写一个${fieldLabel}，可用换行或逗号分隔。`);
      return;
    }
    setValidation("");
    setErr("");
    setBusy(true);
    const body: StartCrawlInput = {
      platform,
      mode,
      ...(mode === "search" ? { keywords: values } : {}),
      ...(mode === "detail" ? { specified_ids: values } : {}),
      ...(mode === "creator" ? { creator_ids: values } : {}),
      idempotency_key: crypto.randomUUID(),
    };
    try {
      const created = unwrapTask(await api.createTask({
        task_type: "creator_discovery",
        title: `采集 ${platform} ${mode === "search" ? values.join(" ") : fieldLabel}`,
        text: values.join(" "),
        entities: { ...body },
      }));
      const started = unwrapCrawlJob(await api.startCrawl(created.id, body));
      setJobs((current) => [jobFromCrawl(created, started), ...current.filter((row) => row.taskId !== created.id)]);
      setInput("");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "采集作业没有提交");
    } finally {
      setBusy(false);
    }
  };

  const confirmFollow = async () => {
    if (!follow) return;
    setFollowBusy(true);
    setFollowErr("");
    try {
      await followCandidate(follow.id);
      setFollow(null);
      await loadJobs();
    } catch (error) {
      setFollowErr(error instanceof Error ? error.message : "确认跟进没有完成");
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <div className="list-page agent-page expert-page crawler-page" data-expert-page="crawler" data-expert-kind="collector">
      <div className="expert-hero">
        <Link className="expert-back" to="/agents">← 数字员工</Link>
        <div className="expert-hero-row">
          <div className="expert-hero-copy">
            <h1>{expert.name}</h1>
            <p className="muted">{expertRoleCopy(expert)}</p>
          </div>
        </div>
        <p className="muted">{expertMissionCopy(expert)}</p>
      </div>

      {err ? (
        <div className="error" role="alert">
          <p>{err}</p>
          <button type="button" className="btn ghost sm" onClick={() => void loadJobs()}>重试</button>
        </div>
      ) : null}

      <section className="panel crawl-plan-card" data-crawl-console aria-labelledby="crawler-new-job">
        <div className="page-kicker">新作业</div>
        <h2 id="crawler-new-job">提交采集作业</h2>
        <p className="muted">只支持 YouTube / Instagram。提交走受控采集接口，不经过模型思考。</p>
        <label>
          平台
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as "youtube" | "instagram")}
            data-crawl-platform
          >
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
                  name="crawler-mode"
                  value={item.value}
                  checked={mode === item.value}
                  data-crawl-mode={item.value}
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
        {validation ? <p className="crawl-validation" role="alert">{validation}</p> : null}
        <button
          className="btn work"
          type="button"
          data-start-crawl
          data-expert-primary={expert.id}
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "正在提交…" : "提交采集作业"}
        </button>
      </section>

      <section className="crawler-jobs" data-crawler-jobs>
        <div className="expert-block">
          <h2>采集作业</h2>
          <p className="muted">采集完成只形成候选。确认后才会跟进或导入，不会显示「已入库」。</p>
        </div>
        {loading ? <p className="muted" data-crawler-loading>正在加载采集作业…</p> : null}
        {!loading && jobs.length === 0 ? (
          <p className="muted" data-crawler-empty>还没有采集作业。</p>
        ) : null}
        {jobs.map((job) => (
          <article
            key={job.id}
            className="panel crawler-job-card"
            data-crawler-job={job.id}
            data-crawler-status={job.status}
            data-crawler-tone={job.tone || "other"}
          >
            <header className="crawler-job-head">
              <div>
                <h3>{job.title}</h3>
                <p className="muted">
                  {[job.platform, job.mode].filter(Boolean).join(" · ")}
                </p>
              </div>
              <strong data-crawler-status-copy={job.statusCopy}>{job.statusCopy}</strong>
            </header>
            {job.error ? <p className="error" role="alert">{job.error}</p> : null}
            {job.candidates.length > 0 ? (
              <ul className="crawler-candidate-list" data-crawler-candidates={job.id}>
                {job.candidates.map((candidate, index) => {
                  const id = followId(candidate);
                  const label = candidateLabel(candidate);
                  return (
                    <li key={candidateKey(candidate, index)} className="crawler-candidate" data-crawler-candidate={id || candidateKey(candidate, index)}>
                      <div>
                        <strong>{label}</strong>
                        <p className="muted">{String(("platform" in candidate && candidate.platform) || job.platform || "")}</p>
                      </div>
                      {id ? (
                        <button
                          type="button"
                          className="btn work sm"
                          data-crawler-follow={id}
                          onClick={() => { setFollowErr(""); setFollow({ id, label }); }}
                        >
                          确认跟进
                        </button>
                      ) : (
                        <p className="muted" data-crawler-follow-disabled>
                          这条候选还没有发现编号，不能确认跟进。
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : job.tone === "confirm" ? (
              <p className="muted">候选已就绪。打开结果后逐条确认跟进，不会自动入库。</p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="panel crawler-analyze" data-crawler-analyze>
        <h2>分析</h2>
        <p className="muted" data-crawler-analyze-disabled>
          {CRAWLER_ANALYSIS_COPY}
        </p>
      </section>

      <DiscoveryFollowConfirm
        open={Boolean(follow)}
        mode="single"
        busy={followBusy}
        error={followErr}
        onCancel={() => { if (!followBusy) { setFollow(null); setFollowErr(""); } }}
        onConfirm={() => void confirmFollow()}
      >
        {follow ? <p>确认跟进「{follow.label}」？这会写入跟进关系，采集结果本身仍是候选。</p> : null}
      </DiscoveryFollowConfirm>
    </div>
  );
}
