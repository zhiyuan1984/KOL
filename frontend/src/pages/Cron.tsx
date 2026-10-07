import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, type CronJob, type CronRun } from "../api";
import ComposerDock, { type ComposerSubmit } from "../components/ComposerDock";
import type { ComposerChip, ComposerDraftStash, ComposerObjectRef, ComposerScope } from "../composer/types";
import { useViewMode } from "../viewMode";

const TERMINAL = new Set(["succeeded", "failed", "skipped", "needs_takeover"]);
type ScheduleKind = "recurring" | "interval" | "once";
type Editor = {
  title: string;
  kind: ScheduleKind;
  repeat: "daily" | "weekly" | "monthly";
  weekday: string;
  monthday: string;
  time: string;
  minutes: string;
  once: string;
  start: string;
  end: string;
  zone: string;
};

const statusLabel = (status?: string | null) => ({
  draft: "草稿", published: "进行中", paused: "已暂停", disabled: "未启用",
  queued: "排队中", running: "执行中", succeeded: "已完成",
  failed: "失败", skipped: "已跳过", needs_takeover: "待接管",
} as Record<string, string>)[String(status || "")] || String(status || "—");

const runLabel = (run: CronRun) => run.status === "succeeded" && run.receipt?.handler_key === "ai-task"
  ? "已提交" : statusLabel(run.status);

/** 终端运行状态里需要强提醒的两种：图标 + 文字 + 色块，三者缺一不可（DESIGN.md §3.1、不变量 4）。 */
const RUN_ATTENTION: Record<string, { tone: "danger" | "warning"; label: string }> = {
  failed: { tone: "danger", label: "运行失败" },
  needs_takeover: { tone: "warning", label: "待接管" },
};
const runAttention = (status?: string | null) =>
  (status && RUN_ATTENTION[status]) || null;

function timeLabel(value?: string | null, timeZone?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

function relativeTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = date.getTime() - Date.now();
  const days = Math.round(Math.abs(delta) / 86_400_000);
  if (Math.abs(delta) < 60_000) return delta < 0 ? "刚刚" : "即将执行";
  if (days === 0) return delta < 0 ? "已过期" : "今天";
  if (days === 1) return delta < 0 ? "已过期 1 天" : "明天";
  return delta < 0 ? `已过期 ${days} 天` : `${days} 天后`;
}

function jobStatusLabel(status: string): string {
  return ({ published: "已启用", paused: "已暂停", draft: "草稿", disabled: "未启用" } as Record<string, string>)[status] || statusLabel(status);
}

function localInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const localIso = (value: string) => value ? new Date(value).toISOString() : undefined;

function editorFor(job?: CronJob | null): Editor {
  const schedule = (job?.condition?.schedule || {}) as Record<string, unknown>;
  const parts = String(job?.cron_expr || "0 9 * * *").split(" ");
  return {
    title: job?.title || "", kind: (schedule.kind as ScheduleKind) || "recurring",
    repeat: (schedule.repeat as Editor["repeat"]) || (parts[2] !== "*" ? "monthly" : parts[4] !== "*" ? "weekly" : "daily"),
    weekday: String(schedule.weekday || (parts[4] !== "*" ? parts[4] : "1")),
    monthday: String(schedule.monthday || (parts[2] !== "*" ? parts[2] : "1")),
    time: `${String(parts[1] || "9").padStart(2, "0")}:${String(parts[0] || "0").padStart(2, "0")}`,
    minutes: String(schedule.interval_minutes || 60), once: localInput(String(schedule.once_at || "")),
    start: localInput(String(schedule.start_at || "")), end: localInput(String(schedule.end_at || "")),
    zone: job?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  };
}

function composerDraft(job: CronJob): ComposerDraftStash {
  const composer = (job.condition?.composer || {}) as ComposerSubmit;
  const scope = composer.scope || {};
  const chips: ComposerChip[] = [
    ...(scope.skills || []).map((id) => ({ kind: "skill" as const, id, label: id })),
    ...(scope.knowledge_bases || []).map((id) => ({ kind: "kb" as const, id, label: id })),
    ...(scope.connectors || []).map((connector) => ({
      kind: "connector" as const, id: connector.id, label: connector.label, access: connector.access,
    })),
    ...(scope.expert_id && scope.expert_id !== "expert:kol"
      ? [{ kind: "expert" as const, id: scope.expert_id, label: scope.expert_id }] : []),
    ...(composer.collaboration_id
      ? [{ kind: "project" as const, id: composer.collaboration_id, label: composer.collaboration_id }] : []),
  ];
  return { text: composer.text || "", chips, attachments: composer.attachments,
    model_tier: composer.model_tier, object_refs: composer.object_refs };
}

function receiptText(run?: CronRun | null): string {
  if (!run) return "还没有运行回执。";
  if (run.error_summary) return run.error_summary;
  const receipt = run.receipt || {};
  if (receipt.handler_key === "ai-task") return String(receipt.title || "已提交到今日任务执行系统");
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
  if (receipt.handler_key === "ownership-release") return `已释放 ${Number(receipt.released_count || 0)} 条，跳过 ${Number(receipt.skipped_count || 0)} 条。`;
  if (receipt.handler_key === "discovery-search") {
    if (receipt.crawl_job_id) return `采集需求 ${String(receipt.crawl_job_id)} 已进入排队${receipt.queue_position != null ? `（第 ${Number(receipt.queue_position)} 位）` : ""}。${String(receipt.note || "候选由采集流水线回填，不自动创建合作或认领。")}`;
    return String(receipt.reason || "本次未提交采集。");
  }
  return JSON.stringify(receipt, null, 2);
}

function RunAttentionBadge({ status, jobKey }: { status?: string | null; jobKey: string }) {
  const attention = runAttention(status);
  if (!attention) return null;
  return (
    <>
      <span className="cron-attention" data-attention={attention.tone} role="status">
        <span className="cron-attention-icon" aria-hidden="true">⚠</span>
        {attention.label}
      </span>
      <Link className="link-button cron-attention-link" to={`/cron/${jobKey}#cron-receipt`}>查看回执</Link>
    </>
  );
}

const TEMPLATE_PLATFORMS = [
  { value: "youtube", label: "YouTube" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
];

type SystemTemplate = {
  platform: string;
  keywords: string[];
  filters: Record<string, unknown>;
};

function readSystemTemplate(job: CronJob): SystemTemplate {
  const raw = ((job.condition || {}) as Record<string, unknown>).system_template as Record<string, unknown> | undefined;
  const keywords = Array.isArray(raw?.keywords)
    ? (raw.keywords as unknown[]).map((keyword) => String(keyword).trim()).filter(Boolean)
    : [];
  const filters = raw?.filters && typeof raw.filters === "object" && !Array.isArray(raw.filters)
    ? (raw.filters as Record<string, unknown>)
    : {};
  return { platform: String(raw?.platform || "youtube").toLowerCase(), keywords, filters };
}

/** 发现搜索的系统发现模板：仅管理员可配。关键词为空时定时触发会如实 skipped，不伪造运行。 */
function DiscoveryTemplateEditor({ job, admin, onSaved }: {
  job: CronJob; admin: boolean; onSaved: (job: CronJob) => void;
}) {
  const [platform, setPlatform] = useState(() => readSystemTemplate(job).platform);
  const [keywordsText, setKeywordsText] = useState(() => readSystemTemplate(job).keywords.join("\n"));
  const [maxNotes, setMaxNotes] = useState(() => {
    const value = readSystemTemplate(job).filters.max_notes_count;
    return value != null ? String(value) : "";
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const template = readSystemTemplate(job);
    setPlatform(template.platform);
    setKeywordsText(template.keywords.join("\n"));
    setMaxNotes(template.filters.max_notes_count != null ? String(template.filters.max_notes_count) : "");
    setMessage("");
  }, [job.id]);

  const keywords = useMemo(
    () => keywordsText.split(/[\n,，、]/).map((part) => part.trim()).filter(Boolean).slice(0, 20),
    [keywordsText],
  );

  if (!admin) {
    const template = readSystemTemplate(job);
    return (
      <div className="cron-contract muted" data-discovery-template>
        <h3>系统发现模板</h3>
        <p>平台：{TEMPLATE_PLATFORMS.find((item) => item.value === template.platform)?.label || template.platform} · 关键词 {template.keywords.length} 个{template.keywords.length > 0 && `（${template.keywords.slice(0, 5).join("、")}${template.keywords.length > 5 ? "…" : ""}）`}</p>
        <p>仅管理员可修改模板。</p>
      </div>
    );
  }

  const save = async () => {
    const filters: Record<string, unknown> = {};
    const count = Number(maxNotes);
    if (maxNotes.trim() !== "") {
      if (!Number.isFinite(count) || count <= 0) { setMessage("每次采集笔记数上限须为正整数。"); return; }
      filters.max_notes_count = Math.floor(count);
    }
    setSaving(true);
    setMessage("");
    try {
      const condition = {
        ...((job.condition || {}) as Record<string, unknown>),
        system_template: { platform, keywords, filters, dedup: { dedup_by: "platform_creator_id" } },
      };
      const result = await api.patchCronJob(job.id, { condition });
      onSaved(result.job);
      setMessage("已保存，下次定时触发时按新模板执行。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cron-contract" data-discovery-template>
      <h3>系统发现模板</h3>
      <p className="muted">每天定时按此模板提交采集需求，只产候选，不自动创建合作或认领。关键词为空时将如实跳过，不伪造运行。</p>
      <div className="cron-template-form">
        <label>平台
          <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
            {TEMPLATE_PLATFORMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>关键词（每行一个，最多 20 个）
          <textarea value={keywordsText} rows={4} placeholder={"美妆\n护肤\nskincare"} onChange={(event) => setKeywordsText(event.target.value)} />
        </label>
        <label>每次采集笔记数上限（可选）
          <input type="number" min={1} value={maxNotes} placeholder="不填则不限" onChange={(event) => setMaxNotes(event.target.value)} />
        </label>
      </div>
      <div className="cron-template-actions">
        <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
          {saving ? "保存中…" : "保存模板"}
        </button>
        {message && <span className="muted" role="status">{message}</span>}
      </div>
    </div>
  );
}

export default function Cron() {
  const { jobId } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const isNew = jobId === "new";
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [detail, setDetail] = useState<CronJob | null>(null);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [activeRun, setActiveRun] = useState<CronRun | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const { admin } = useViewMode();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(false);
  const [expertStub, setExpertStub] = useState(false);
  const [editor, setEditor] = useState<Editor>(() => editorFor());
  const [text, setText] = useState("");
  const [objectRefs, setObjectRefs] = useState<ComposerObjectRef[]>([]);
  const [refreshError, setRefreshError] = useState(false);

  const selected = detail;
  const visible = useMemo(() => jobs.filter((job) =>
    (filter === "all" || job.status === filter) &&
    `${job.title} ${job.frequency || ""}`.toLowerCase().includes(query.trim().toLowerCase())), [jobs, query, filter]);
  const updateRow = (job: CronJob) => setJobs((current) =>
    current.some((row) => row.id === job.id) ? current.map((row) => row.id === job.id ? job : row) : [job, ...current]);

  useEffect(() => {
    let cancelled = false;
    api.cronJobs().then((data) => {
      if (cancelled) return;
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setLoadState("ok");
    }).catch((cause) => {
      if (cancelled) return;
      setError(cause instanceof Error ? cause.message : "无法加载定时任务");
      setLoadState("error");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setError("");
    setDetail(null);
    setRuns([]);
    setActiveRun(null);
    setExpertStub(false);
    setEditing(isNew);
    if (isNew) {
      setEditor(editorFor());
      setText("");
      setObjectRefs([]);
      return;
    }
    if (!jobId) return;
    let cancelled = false;
    api.cronJob(jobId).then((data) => {
      if (cancelled) return;
      setDetail(data.job);
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      setActiveRun(data.runs?.[0] || null);
      setEditor(editorFor(data.job));
      const composer = (data.job.condition?.composer || {}) as ComposerSubmit;
      setText(composer.text || "");
      setObjectRefs(composer.object_refs || []);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载任务详情");
    });
    return () => { cancelled = true; };
  }, [jobId, isNew]);

  useEffect(() => {
    if (location.hash !== "#cron-receipt" || !detail) return;
    const target = document.querySelector("[data-cron-receipt-panel]") || document.querySelector("[data-cron-timeline]");
    target?.scrollIntoView({ block: "start" });
  }, [detail, runs, location.hash]);

  useEffect(() => {
    if (!activeRun?.id || TERMINAL.has(activeRun.status)) return;
    const timer = window.setInterval(() => {
      void api.cronRun(activeRun.id).then((data) => {
        setRefreshError(false);
        setActiveRun(data.run);
        setRuns((current) => current.map((run) => run.id === data.run.id ? data.run : run));
        if (data.job) { updateRow(data.job); setDetail(data.job); }
      }).catch(() => setRefreshError(true));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeRun?.id, activeRun?.status]);

  const toggle = async (job: CronJob) => {
    setBusy(job.id);
    setRowError((current) => ({ ...current, [job.id]: "" }));
    try {
      const result = await api.patchCronJob(job.id, { status: job.status === "paused" ? "published" : "paused" });
      updateRow(result.job);
      if (detail?.id === job.id) setDetail(result.job);
    } catch (cause) {
      setRowError((current) => ({ ...current, [job.id]: cause instanceof Error ? cause.message : "无法更新状态" }));
    } finally { setBusy(""); }
  };

  const runNow = async (job: CronJob) => {
    setBusy(job.id);
    setRowError((current) => ({ ...current, [job.id]: "" }));
    try {
      const result = await api.runCronJob(job.id);
      const run = result.run || (await api.cronRun(result.run_id)).run;
      setActiveRun(run);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      if (result.job) updateRow(result.job);
      if (detail?.id === job.id && result.job) setDetail(result.job);
    } catch (cause) {
      setRowError((current) => ({ ...current, [job.id]: cause instanceof Error ? cause.message : "无法立即执行" }));
    } finally { setBusy(""); }
  };

  const refreshRun = async (run: CronRun) => {
    try {
      const data = await api.cronRun(run.id);
      setActiveRun(data.run);
      setRuns((current) => current.map((item) => item.id === data.run.id ? data.run : item));
      if (data.job) { updateRow(data.job); setDetail(data.job); }
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    }
  };

  const save = async (composer: ComposerSubmit) => {
    if (!editor.title.trim()) { setError("请填写任务名称"); return; }
    const [hour, minute] = editor.time.split(":").map(Number);
    const cronExpr = editor.kind === "recurring"
      ? `${minute} ${hour} ${editor.repeat === "monthly" ? editor.monthday : "*"} * ${editor.repeat === "weekly" ? editor.weekday : "*"}`
      : "0 0 * * *";
    let schedule: Record<string, unknown>;
    try {
      schedule = {
        kind: editor.kind, repeat: editor.repeat, weekday: editor.weekday, monthday: editor.monthday,
        interval_minutes: Number(editor.minutes), once_at: localIso(editor.once),
        start_at: localIso(editor.start), end_at: localIso(editor.end),
      };
    } catch {
      setError("执行时间格式无效");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const body = { title: editor.title.trim(), cron_expr: cronExpr, timezone: editor.zone,
        condition: { ...((selected?.condition || {}) as Record<string, unknown>), schedule, composer: { ...composer, object_refs: objectRefs } } };
      const job = selected
        ? (await api.patchCronJob(selected.id, body)).job
        : await api.createCronJob({ ...body, handler_key: "ai-task", status: "draft" });
      updateRow(job);
      setDetail(job);
      setEditing(false);
      nav(`/cron/${job.job_key || job.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存任务");
    } finally { setBusy(""); }
  };

  const edit = isNew || editing && selected?.handler_key === "ai-task";
  return (
    <div className="list-page cron-page" data-cron-page>
      <header className="cron-toolbar">
        <h1>定时任务</h1>
        <label className="sr-only" htmlFor="cron-search">搜索任务</label>
        <input id="cron-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" />
        <label className="sr-only" htmlFor="cron-filter">筛选状态</label>
        <select id="cron-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已启用</option>
          <option value="paused">已暂停</option><option value="disabled">未启用</option>
        </select>
        <Link className="btn primary" to="/cron/new">＋ 新建定时任务</Link>
      </header>

      {loadState === "loading" && <div className="cron-catalog" data-cron-state="loading" aria-busy="true">
        <div className="cron-skeleton" /><div className="cron-skeleton" /><div className="cron-skeleton" />
      </div>}
      {loadState === "error" && <p className="error" role="alert">{error}</p>}
      {loadState === "ok" && <div className="cron-catalog" data-cron-state="ok">
        {visible.length > 0 && <div className="cron-list-head" aria-hidden="true"><span>任务与频率</span><span>计划状态</span><span>运行时间</span><span>操作</span></div>}
        {visible.length === 0 && <div className="muted cron-empty" data-cron-state="empty"><p>{jobs.length ? "没有符合条件的任务。" : "还没有定时任务。"}</p>{!jobs.length && <Link className="btn ghost" to="/cron/new">创建第一个任务</Link>}</div>}
        {visible.map((job) => (
          <div className="cron-row" key={job.id} data-cron-job={job.job_key} data-cron-status={job.status}>
            <Link className="cron-row-main" to={`/cron/${job.job_key || job.id}`}>
              <strong>{job.title}</strong>
              <span className="muted">{job.frequency} · {job.execute_identity}</span>
            </Link>
            <span className="cron-status" data-status={job.status}><span className="cron-field-label">计划</span>{jobStatusLabel(job.status)}{runAttention(job.last_terminal_status)
              ? <RunAttentionBadge status={job.last_terminal_status} jobKey={job.job_key || job.id} />
              : (job.active_run_status && <span className="cron-running-state">运行：{statusLabel(job.active_run_status)}</span>)}</span>
            <span className="cron-next"><span className="cron-field-label">下次运行 · {job.timezone || "时区未指定"}</span>{job.status === "published" ? <><strong>{relativeTime(job.next_run_at)}</strong><small>{timeLabel(job.next_run_at, job.timezone)}</small></> : <small>—</small>}<small><span className="cron-field-label">最近运行</span>{job.handler_key === "ai-task" && job.last_terminal_status === "succeeded" ? "已提交" : statusLabel(job.last_terminal_status)}</small></span>
            <div className="cron-row-actions">
              <button type="button" className="btn ghost" data-cron-pause disabled={busy === job.id || !["published", "paused"].includes(job.status)} onClick={() => void toggle(job)}>{job.status === "paused" ? "开启计划" : "暂停计划"}</button>
              <button type="button" className="btn ghost" data-cron-run-now disabled={busy === job.id || job.status !== "published"} title={job.status !== "published" ? "请先启用此计划" : undefined} onClick={() => void runNow(job)}>{busy === job.id ? "提交中…" : "立即运行"}</button>
            </div>
            {rowError[job.id] && <p className="error cron-row-feedback" role="alert">{rowError[job.id]}</p>}
            {activeRun?.job_id === job.id && <p className="cron-row-feedback" role="status">
              最近运行：{runLabel(activeRun)} · <Link className="link-button" to={`/cron/${job.job_key || job.id}`}>查看回执</Link>
              {activeRun.session_id && <> · <Link to={`/s/${activeRun.session_id}`}>打开执行会话</Link></>}
            </p>}
          </div>
        ))}
      </div>}

      {(selected || isNew) && <section className="cron-detail" data-cron-detail={selected?.job_key || "new"}>
        <div className="cron-detail-head">
          <div><h2>{isNew ? "新建定时任务" : selected?.title}</h2>
            {selected && <p className="muted">{jobStatusLabel(selected.status)} · {selected.execute_identity} · {selected.frequency} · {selected.timezone || "时区未指定"} · 下次 {timeLabel(selected.next_run_at, selected.timezone)}</p>}
          </div>
          <div className="cron-actions">
            {selected && <Link className="btn ghost" to="/cron">返回列表</Link>}
            {selected?.handler_key === "ai-task" && !edit && <button type="button" className="btn ghost" onClick={() => setEditing(true)}>编辑</button>}
            {selected?.status === "draft" && selected.handler_key === "ai-task" && <button type="button" className="btn primary" disabled={busy === selected.id} onClick={() => void (async () => { setBusy(selected.id); try { const result = await api.patchCronJob(selected.id, { status: "published" }); updateRow(result.job); setDetail(result.job); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法启用任务"); } finally { setBusy(""); } })()}>发布并启用</button>}
            {selected && <button type="button" className="btn ghost" data-cron-run-now disabled={busy === selected.id || selected.status !== "published"} title={selected.status !== "published" ? "请先启用此计划" : undefined} onClick={() => void runNow(selected)}>立即运行</button>}
            {selected && <button type="button" className="btn ghost" data-cron-pause disabled={busy === selected.id || selected.status === "disabled"} onClick={() => void toggle(selected)}>{selected.status === "paused" ? "开启" : "暂停"}</button>}
          </div>
        </div>
        {edit ? <>
          <div className="cron-editor">
            <label>任务名称<input value={editor.title} maxLength={120} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
            <div className="cron-schedule">
              <label>执行方式<select value={editor.kind} onChange={(event) => setEditor({ ...editor, kind: event.target.value as ScheduleKind })}>
                <option value="recurring">周期</option><option value="interval">间隔</option><option value="once">单次</option>
              </select></label>
              {editor.kind === "recurring" && <>
                <label>周期<select value={editor.repeat} onChange={(event) => setEditor({ ...editor, repeat: event.target.value as Editor["repeat"] })}>
                  <option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option>
                </select></label>
                {editor.repeat === "weekly" && <label>星期<select value={editor.weekday} onChange={(event) => setEditor({ ...editor, weekday: event.target.value })}>{["日", "一", "二", "三", "四", "五", "六"].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
                {editor.repeat === "monthly" && <label>日期<input type="number" min="1" max="31" value={editor.monthday} onChange={(event) => setEditor({ ...editor, monthday: event.target.value })} /></label>}
                <label>时间<input type="time" value={editor.time} onChange={(event) => setEditor({ ...editor, time: event.target.value })} /></label>
              </>}
              {editor.kind === "interval" && <label>每隔多少分钟<input type="number" min="1" max="525600" value={editor.minutes} onChange={(event) => setEditor({ ...editor, minutes: event.target.value })} /></label>}
              {editor.kind === "once" && <label>执行时间<input type="datetime-local" value={editor.once} onChange={(event) => setEditor({ ...editor, once: event.target.value })} /></label>}
              <label>生效开始<input type="datetime-local" value={editor.start} onChange={(event) => setEditor({ ...editor, start: event.target.value })} /></label>
              <label>生效结束<input type="datetime-local" value={editor.end} onChange={(event) => setEditor({ ...editor, end: event.target.value })} /></label>
            </div>
            <p className="muted">按 {editor.zone} 时间执行。提交内容会使用今日任务的技能、专家、工作空间与连接器能力。{isNew ? "保存后先生成草稿；确认内容与范围后，再发布并启用计划。" : "保存将立即更新此任务；若任务已启用，新配置将用于后续触发。"}</p>
            <h3>任务内容</h3>
            <ComposerDock key={selected?.id || "new"} variant="workspace" value={text} onChange={setText}
              onSubmit={(payload) => void save(payload)} disabled={busy === "save"}
              initialDraft={selected ? composerDraft(selected) : { text: "" }}
              objectRefs={objectRefs} onObjectRefsChange={setObjectRefs} submitLabel={isNew ? "保存为草稿" : "保存更改"} />
            <p className="muted">填写时间与任务内容后，点击提问框中的保存按钮。</p>
          </div>
          {selected && <button type="button" className="btn ghost" onClick={() => setEditing(false)}>取消编辑</button>}
        </> : selected && <>
          <div className="cron-contract muted" data-cron-contract>
            <h3>执行说明</h3>
            <p>执行身份：{selected.execute_identity} · 执行范围：{String((selected.scope as Record<string, unknown> | undefined)?.label || "按已授权范围")}</p>
            <p>副作用类型：{String(selected.handler?.side_effect || "任务提交")} · {selected.handler?.creates_session ? "会创建 Agent 执行会话" : "不创建对话会话"} · 配置版本 {selected.published_rev || 1}</p>
            {selected.handler_key === "ai-task" && <p>任务会提交到今日任务执行系统；提交成功不代表后续任务已完成。</p>}
          </div>
          {selected.handler_key !== "ai-task" && <div className="cron-contract muted">
            <p>条件：{selected.job_key === "ownership-release" ? "连续 14 天无有效往来且归属未续期/未改派" : selected.job_key === "overdue-scan" ? "在途逾期合作" : selected.job_key === "daily-task-snapshot" ? "待问候 / 跟进 / 报价 / 谈判" : "按已发布条件执行"}</p>
            <p>{selected.enabled === false ? "该作业未启用。" : "系统作业按已发布条件执行。"} · 专家 {selected.capability_expert_id}</p>
            <p>重试 {String(selected.retry_policy?.max_attempts || 1)} 次 · 超时后 {String(selected.takeover_policy?.action || "needs_takeover")}</p>
          </div>}
          {selected.handler_key === "discovery-search" && (
            <DiscoveryTemplateEditor
              job={selected}
              admin={admin}
              onSaved={(job) => { updateRow(job); setDetail(job); }}
            />
          )}
          {activeRun && activeRun.job_id === selected.id && <article className="cron-receipt" data-cron-receipt-panel id="cron-receipt">
            <h3>最近执行</h3><p className="muted">{runLabel(activeRun)} · {timeLabel(activeRun.finished_at || activeRun.started_at)}</p>
            {refreshError && !TERMINAL.has(activeRun.status) && <p className="error" role="status">运行状态暂时无法刷新，当前显示的可能是旧状态。<button type="button" className="link-button" onClick={() => void refreshRun(activeRun)}>重试</button></p>}
            <pre>{receiptText(activeRun)}</pre>
            {activeRun.session_id && <Link to={`/s/${activeRun.session_id}`}>查看今日任务执行会话</Link>}
            {selected.handler_key !== "ai-task" && <button type="button" className="btn ghost" data-cron-expert-stub onClick={() => setExpertStub(true)}>请专家解读本次回执</button>}
            {expertStub && <p className="muted" data-cron-expert-stub-note>解读入口尚未开通。本次结果以回执为准，不会打开会话。</p>}
          </article>}
          <div className="cron-timeline" data-cron-timeline>
            <h3>运行记录</h3>
            {runs.length === 0 && <p className="muted">还没有运行记录。</p>}
            <ol>{runs.map((run) => {
              const attention = runAttention(run.status);
              return (
                <li key={run.id} className="cron-timeline-item">
                  {attention && <span className="cron-attention" data-attention={attention.tone}>
                    <span className="cron-attention-icon" aria-hidden="true">⚠</span>
                    {attention.label}
                  </span>}
                  <button type="button" className="link-button" data-cron-run={run.id} data-cron-run-status={run.status} onClick={() => setActiveRun(run)}>
                    {runLabel(run)} · {run.trigger === "manual" ? "手动" : "定时"} · {timeLabel(run.scheduled_for, selected.timezone)}
                  </button>
                  {run.session_id && <> · <Link to={`/s/${run.session_id}`}>查看执行</Link></>}
                </li>
              );
            })}</ol>
          </div>
        </>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>}
    </div>
  );
}
