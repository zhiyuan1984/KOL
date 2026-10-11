import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Button, Checkbox, Drawer, Input, Modal, Pagination, Spin, Table, Tabs, Tooltip, type TableProps } from "antd";
import { InfoCircleOutlined, LoadingOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, WarningOutlined } from "@ant-design/icons";
import CronTheme from "../cron/CronTheme";
import { DEFAULT_TIME_ZONE, compactFrequency, formatExactTime, formatNextTime, fromZonedInput, toZonedInput } from "../cron/cronTime";
import { PLAN_VIEWS, TERMINAL_RUNS, actionAllowed, isAttention, orderedIds, planLabel, receiptLabel, resultLabel, runStatusLabel, searchedJobs, viewCounts } from "../cron/cronModel";
import "../cron/cron-workspace.css";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, type CronJob, type CronRun } from "../api";
import ComposerDock, { type ComposerSubmit } from "../components/ComposerDock";
import type { ComposerChip, ComposerDraftStash, ComposerObjectRef, ComposerScope } from "../composer/types";

type ScheduleKind = "recurring" | "interval" | "once";
type Editor = {
  title: string;
  customCron?: string;
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

function editorFor(job?: CronJob | null): Editor {
  const schedule = (job?.condition?.schedule || {}) as Record<string, unknown>;
  const parts = String(job?.cron_expr || "0 9 * * *").split(" ");
  const zone = job?.timezone || DEFAULT_TIME_ZONE;
  const common = /^\d+ \d+ (\*|\d+) \* (\*|[0-6])$/.test(String(job?.cron_expr || "0 9 * * *"));
  return {
    customCron: job?.cron_expr && !common && (!schedule.kind || schedule.kind === "recurring") ? job.cron_expr : undefined,
    title: job?.title || "", kind: (schedule.kind as ScheduleKind) || "recurring",
    repeat: (schedule.repeat as Editor["repeat"]) || (parts[2] !== "*" ? "monthly" : parts[4] !== "*" ? "weekly" : "daily"),
    weekday: String(schedule.weekday || (parts[4] !== "*" ? parts[4] : "1")),
    monthday: String(schedule.monthday || (parts[2] !== "*" ? parts[2] : "1")),
    time: `${String(parts[1] || "9").padStart(2, "0")}:${String(parts[0] || "0").padStart(2, "0")}`,
    minutes: String(schedule.interval_minutes || 60), once: toZonedInput(String(schedule.once_at || ""), zone),
    start: toZonedInput(String(schedule.start_at || ""), zone), end: toZonedInput(String(schedule.end_at || ""), zone),
    zone,
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
    if (receipt.source === "postgresql_formal_tickets") {
      if (!items.length) return "当前没有逾期的正式工单。";
      return items.map(item => {
        const row = item as Record<string, unknown>;
        return [String(row.title || row.ticket_id || "未记录标题"), row.stage_label ? String(row.stage_label) : "", row.due_at ? `到期 ${formatExactTime(String(row.due_at))}（北京时间）` : ""].filter(Boolean).join(" · ");
      }).join("\n");
    }
    if (!items.length) return "当前没有需要扫描的在途逾期合作。";
    return items.map((item) => {
      const row = item as { handle?: string; days_in_stage?: number; stage_label?: string };
      return `@${row.handle || "?"} · ${row.stage_label || ""} · 已停留 ${row.days_in_stage ?? "?"} 天`;
    }).join("\n");
  }
  if (receipt.handler_key === "daily-task-snapshot") {
    const counts = (receipt.counts || {}) as Record<string, number>;
    const labels: Record<string, string> = { greet: "问候", follow: "跟进", quote: "报价", negotiate: "谈判" };
    const known = Object.entries(labels).filter(([key]) => typeof counts[key] === "number");
    const values = known.filter(([key]) => counts[key] !== 0).map(([key, label]) => `${label} ${counts[key]}`).join(" · ");
    const summary = values || (known.length ? "快照暂无待办。" : "本回执未记录快照数量。");
    return `${summary}${receipt.gap ? `\n${String(receipt.gap)}` : ""}`;
  }
  if (receipt.handler_key === "ownership-release") return `已释放 ${Number(receipt.released_count || 0)} 条，跳过 ${Number(receipt.skipped_count || 0)} 条。`;
  if (receipt.handler_key === "discovery-search") {
    if (receipt.crawl_job_id) return `采集需求 ${String(receipt.crawl_job_id)} 已进入排队${receipt.queue_position != null ? `（第 ${Number(receipt.queue_position)} 位）` : ""}。${String(receipt.note || "候选由采集流水线回填，不自动创建合作或认领。")}`;
    return String(receipt.reason || "本次未提交采集。");
  }
  return JSON.stringify(receipt, null, 2);
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
        <button type="button" className="btn secondary" disabled={saving} onClick={() => void save()}>
          {saving ? "保存中…" : "保存模板"}
        </button>
        {message && <span className="muted" role="status">{message}</span>}
      </div>
    </div>
  );
}

function CronWorkbench() {
  const { jobId } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const isNew = jobId === "new";
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const query = params.get("q") || "";
  const filter = PLAN_VIEWS.some(view => view.key === params.get("status")) ? params.get("status")! : "all";
  const attentionOnly = params.get("attention") === "1";
  const pageNumber = Math.max(1, Number.parseInt(params.get("page") || "1") || 1);
  const [inputQuery, setInputQuery] = useState(query);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [sort, setSort] = useState<"name" | "next-asc" | "next-desc">("name");
  const [detail, setDetail] = useState<CronJob | null>(null);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<CronRun | null>(null);
  const [watching, setWatching] = useState<Record<string, CronRun>>({});
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [refreshError, setRefreshError] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<Editor>(() => editorFor());
  const [text, setText] = useState("");
  const [objectRefs, setObjectRefs] = useState<ComposerObjectRef[]>([]);
  const [editorBaseline, setEditorBaseline] = useState("");
  const [composerTouched, setComposerTouched] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [modal, modalContext] = Modal.useModal();
  const [mobile, setMobile] = useState(() => matchMedia("(max-width: 860px)").matches);
  const listRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ scroll: number; focus: string } | null>(null);
  const loadedRoute = useRef(location.pathname);
  const restoringDirtyRoute = useRef(false);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const initialLoadStarted = useRef(false);
  const snapshot = JSON.stringify({ editor, text, objectRefs });
  const dirty = (isNew || editing) && (!!editorBaseline && snapshot !== editorBaseline || composerTouched);
  dirtyRef.current = dirty;
  const dirtyRouteRef = useRef(location.pathname);
  if (isNew || editing) dirtyRouteRef.current = loadedRoute.current;

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => {
    const media = matchMedia("(max-width: 860px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { setInputQuery(query); }, [query]);
  useEffect(() => {
    const preventUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, []);

  const setListParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(patch)) value == null || value === "" ? next.delete(key) : next.set(key, value);
    nav({ pathname: location.pathname, search: next.toString() ? `?${next}` : "", hash: location.hash }, { replace: true, state: location.state });
  };
  const updateRow = (job: CronJob) => {
    setJobs(current => current.some(row => row.id === job.id) ? current.map(row => row.id === job.id ? job : row) : [...current, job]);
    setOrder(current => current.includes(job.id) ? current : [...current, job.id]);
  };
  const loadJobs = async (initial = false) => {
    if (initial) setLoadState("loading");
    setListError("");
    try {
      const data = await api.cronJobs();
      if (!mountedRef.current) return;
      const rows = Array.isArray(data.jobs) ? data.jobs : [];
      setJobs(rows);
      setOrder(current => initial || !current.length ? orderedIds(rows, "name") : [...current.filter(id => rows.some(row => row.id === id)), ...orderedIds(rows.filter(row => !current.includes(row.id)), "name")]);
      setLoadState("ok");
    } catch (cause) {
      if (!mountedRef.current) return;
      setListError(cause instanceof Error ? cause.message : "无法加载定时任务");
      if (initial) setLoadState("error");
    }
  };
  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadJobs(true);
  }, []);

  const restoreListOrigin = () => {
    const origin = originRef.current;
    if (!origin) return;
    if (listRef.current) listRef.current.scrollTop = origin.scroll;
    document.querySelector<HTMLElement>(`[data-cron-focus="${CSS.escape(origin.focus)}"]`)?.focus({ preventScroll: true });
  };
  const closeDrawer = () => {
    if (busy.save) return;
    const close = () => { dirtyRef.current = false; setComposerTouched(false); setEditing(false); nav(`/cron${location.search}`, { replace: true }); };
    if (dirtyRef.current) modal.confirm({ title: "放弃未保存的内容？", content: "当前任务内容和时间设置尚未保存。", okText: "放弃并返回", cancelText: "继续编辑", onOk: close });
    else close();
  };
  useEffect(() => {
    if (restoringDirtyRoute.current && loadedRoute.current === location.pathname) {
      restoringDirtyRoute.current = false;
      return;
    }
    if (loadedRoute.current !== location.pathname && dirtyRef.current) {
      const attempted = `${location.pathname}${location.search}${location.hash}`;
      const previous = `${dirtyRouteRef.current}${location.search}`;
      restoringDirtyRoute.current = true;
      nav(previous, { replace: true });
      modal.confirm({ title: "放弃未保存的内容？", content: "返回将丢弃当前任务草稿。", okText: "放弃并返回", cancelText: "继续编辑", onOk: () => { dirtyRef.current = false; setEditing(false); setComposerTouched(false); nav(attempted, { replace: true }); } });
      return;
    }
    loadedRoute.current = location.pathname;
    setDetailError(""); setDetail(null); setRuns([]); setSelectedRun(null); setComposerTouched(false); setEditing(isNew);
    if (isNew) {
      const fresh = editorFor();
      setEditor(fresh); setText(""); setObjectRefs([]); setEditorBaseline(JSON.stringify({ editor: fresh, text: "", objectRefs: [] }));
      return;
    }
    if (!jobId) {
      if (originRef.current) requestAnimationFrame(restoreListOrigin);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api.cronJob(jobId).then(data => {
      if (cancelled) return;
      setDetail(data.job); setRuns(Array.isArray(data.runs) ? data.runs : []); setSelectedRun(data.runs?.[0] || null);
      const fresh = editorFor(data.job);
      const composer = (data.job.condition?.composer || {}) as ComposerSubmit;
      setEditor(fresh); setText(composer.text || ""); setObjectRefs(composer.object_refs || []);
      setEditorBaseline(JSON.stringify({ editor: fresh, text: composer.text || "", objectRefs: composer.object_refs || [] }));
      for (const run of data.runs || []) if (!TERMINAL_RUNS.has(run.status)) setWatching(current => ({ ...current, [run.job_id]: run }));
    }).catch(cause => { if (!cancelled) setDetailError(cause instanceof Error ? cause.message : "无法加载任务详情"); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [jobId, detailRevision]);

  useEffect(() => {
    if (location.hash !== "#cron-receipt" || !detail) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>("[data-cron-receipt-panel]");
      const body = target?.closest<HTMLElement>(".ant-drawer-body");
      if (target && body) { body.scrollTop = Math.max(0, target.offsetTop - body.offsetTop); target.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [detail?.id, location.hash]);

  const acceptRun = (run: CronRun, job?: CronJob) => {
    setWatching(current => ({ ...current, [run.job_id]: run }));
    setRuns(current => current.some(item => item.id === run.id) ? current.map(item => item.id === run.id ? run : item) : detail?.id === run.job_id ? [run, ...current] : current);
    setSelectedRun(current => current?.id === run.id ? run : current);
    if (job) { updateRow(job); if (detail?.id === job.id) setDetail(job); }
    setRefreshError(current => ({ ...current, [run.job_id]: false }));
  };
  const watchSignature = Object.values(watching).filter(run => !TERMINAL_RUNS.has(run.status)).map(run => run.id).join("|");
  useEffect(() => {
    if (!watchSignature) return;
    let cancelled = false, pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void Promise.all(Object.values(watching).filter(run => !TERMINAL_RUNS.has(run.status)).map(async run => {
        try { const data = await api.cronRun(run.id); if (!cancelled) acceptRun(data.run, data.job); }
        catch { if (!cancelled) setRefreshError(current => ({ ...current, [run.job_id]: true })); }
      })).finally(() => { pending = false; });
    }, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [watchSignature, detail?.id]);

  const openDetail = (job: CronJob, receipt = false) => {
    originRef.current = { scroll: listRef.current?.scrollTop || 0, focus: `${receipt ? "receipt" : "title"}:${job.id}` };
    nav(`/cron/${encodeURIComponent(job.job_key || job.id)}${location.search}${receipt ? "#cron-receipt" : ""}`);
  };
  const setRowBusy = (id: string, value: boolean) => setBusy(current => ({ ...current, [id]: value }));
  const changeStatus = async (job: CronJob, status: string) => {
    if (busy[job.id]) return;
    setRowBusy(job.id, true); setRowError(current => ({ ...current, [job.id]: "" }));
    try { const result = await api.patchCronJob(job.id, { status }); updateRow(result.job); if (detail?.id === job.id) setDetail(result.job); }
    catch (cause) { setRowError(current => ({ ...current, [job.id]: cause instanceof Error ? cause.message : "无法更新计划状态" })); }
    finally { setRowBusy(job.id, false); }
  };
  const runNow = async (job: CronJob) => {
    if (busy[job.id] || !actionAllowed(job, "run_now")) return;
    setRowBusy(job.id, true); setRowError(current => ({ ...current, [job.id]: "" }));
    try {
      const result = await api.runCronJob(job.id);
      const response = result.run ? { run: result.run, job: result.job } : await api.cronRun(result.run_id);
      const run = response.run;
      acceptRun(run, response.job);
      if (detail?.id === job.id) setSelectedRun(run);
    } catch (cause) { setRowError(current => ({ ...current, [job.id]: cause instanceof Error ? cause.message : "无法立即运行；请核对回执后重试" })); }
    finally { setRowBusy(job.id, false); }
  };
  const save = async (composer: ComposerSubmit) => {
    if (busy.save) return;
    if (!editor.title.trim()) { setDetailError("请填写任务名称"); return; }
    let schedule: Record<string, unknown>, cronExpr: string;
    try {
      new Intl.DateTimeFormat("zh-CN", { timeZone: editor.zone }).format(new Date());
      const start = fromZonedInput(editor.start, editor.zone), end = fromZonedInput(editor.end, editor.zone);
      if (start && end && Date.parse(end) <= Date.parse(start)) throw new Error("生效结束必须晚于生效开始");
      schedule = { kind: editor.kind, ...(start ? { start_at: start } : {}), ...(end ? { end_at: end } : {}) };
      if (editor.kind === "recurring") {
        if (editor.customCron) cronExpr = editor.customCron;
        else {
          if (!/^\d{2}:\d{2}$/.test(editor.time)) throw new Error("请选择有效执行时间");
          const [hour, minute] = editor.time.split(":").map(Number);
          if (hour > 23 || minute > 59) throw new Error("执行时间无效");
          if (editor.repeat === "monthly" && (!Number.isInteger(Number(editor.monthday)) || Number(editor.monthday) < 1 || Number(editor.monthday) > 31)) throw new Error("每月日期须为 1–31");
          cronExpr = `${minute} ${hour} ${editor.repeat === "monthly" ? editor.monthday : "*"} * ${editor.repeat === "weekly" ? editor.weekday : "*"}`;
          Object.assign(schedule, { repeat: editor.repeat, ...(editor.repeat === "weekly" ? { weekday: editor.weekday } : {}), ...(editor.repeat === "monthly" ? { monthday: editor.monthday } : {}) });
        }
      } else if (editor.kind === "interval") {
        const minutes = Number(editor.minutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600) throw new Error("间隔须为 1–525600 的整数分钟");
        schedule.interval_minutes = minutes; cronExpr = "0 0 * * *";
      } else {
        const once = fromZonedInput(editor.once, editor.zone);
        if (!once) throw new Error("请填写单次执行时间");
        schedule.once_at = once; cronExpr = "0 0 * * *";
      }
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : "执行时间格式无效"); return; }
    setRowBusy("save", true); setDetailError("");
    try {
      const body = { title: editor.title.trim(), cron_expr: cronExpr!, timezone: editor.zone, condition: { ...(detail?.condition || {}), schedule: schedule!, composer: { ...composer, object_refs: objectRefs } } };
      const job = detail ? (await api.patchCronJob(detail.id, body)).job : await api.createCronJob({ ...body, handler_key: "ai-task", status: "draft" });
      dirtyRef.current = false; setComposerTouched(false); setEditing(false); setEditorBaseline(snapshot);
      updateRow(job); setDetail(job);
      nav(`/cron/${encodeURIComponent(job.job_key || job.id)}${location.search}`, { replace: isNew });
      if (!isNew) setDetailRevision(value => value + 1);
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : "保存失败，草稿内容已保留"); }
    finally { setRowBusy("save", false); }
  };

  const matching = useMemo(() => searchedJobs(jobs, query, attentionOnly), [jobs, query, attentionOnly]);
  const counts = viewCounts(matching);
  const filtered = matching.filter(job => filter === "all" || job.status === filter);
  const index = new Map(order.map((id, i) => [id, i]));
  const visible = [...filtered].sort((a, b) => (index.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (index.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const effectivePage = Math.min(pageNumber, Math.max(1, Math.ceil(visible.length / 20)));
  const hasAttention = searchedJobs(jobs, query, true).length > 0;
  const nextCell = (job: CronJob) => <span className="cron-next-value" title={job.status === "published" ? formatExactTime(job.next_run_at) : undefined}>{job.status === "published" ? job.next_run_at ? formatNextTime(job.next_run_at) : "暂无下次时间" : "—"}</span>;
  const resultCell = (job: CronJob) => {
    const current = watching[job.id];
    const activeStatus = current && !TERMINAL_RUNS.has(current.status) ? current.status : job.active_run_status;
    return <span className="cron-result-cell">
      {activeStatus && <span className="cron-live-state"><LoadingOutlined aria-hidden="true" />{runStatusLabel(activeStatus)}{job.last_terminal_status && <span className="cron-result-separator">；上次</span>}</span>}
      {(!activeStatus || job.last_terminal_status) && <span data-result={job.last_terminal_status || "none"}>{isAttention(job.last_terminal_status) && <WarningOutlined aria-hidden="true" />}{resultLabel(job)}</span>}
      {isAttention(job.last_terminal_status) && <Button type="link" className="cron-receipt-link" data-cron-focus={`receipt:${job.id}`} onClick={() => openDetail(job, true)}>查看回执</Button>}
    </span>;
  };
  const rowActions = (job: CronJob, inDrawer = false) => <div className="cron-inline-actions">
    {actionAllowed(job, "pause") && <Button type="text" data-cron-pause disabled={busy[job.id]} onClick={() => void changeStatus(job, "paused")}>暂停计划</Button>}
    {actionAllowed(job, "resume") && <Button type="text" data-cron-pause disabled={busy[job.id]} onClick={() => void changeStatus(job, "published")}>恢复计划</Button>}
    {actionAllowed(job, "run_now") && <Button type="text" data-cron-run-now disabled={busy[job.id]} aria-busy={busy[job.id]} loading={busy[job.id]} onClick={() => void runNow(job)}>立即运行</Button>}
    {!inDrawer && (job.execution_capability?.ready === false || !job.allowed_actions) && <Tooltip title={job.execution_capability?.reason || "执行能力暂未核验，请查看详情"}><Button type="text" className="cron-capability-hint" onClick={() => openDetail(job)}><InfoCircleOutlined aria-hidden="true" />{job.execution_capability?.ready === false ? "能力未就绪" : "查看详情"}</Button></Tooltip>}
    {!inDrawer && !actionAllowed(job, "pause") && !actionAllowed(job, "resume") && !actionAllowed(job, "run_now") && job.execution_capability?.ready === true && <span className="cron-secondary">{job.system ? "管理员管理" : job.allowed_actions?.run_reason || "请查看详情"}</span>}
    {rowError[job.id] && <Tooltip title={rowError[job.id]}><Button type="text" className="cron-row-error" aria-label={`查看${job.title}操作失败原因`} onClick={() => openDetail(job)}><WarningOutlined /></Button></Tooltip>}
    {refreshError[job.id] && !inDrawer && <Tooltip title="运行状态刷新失败，当前可能是旧状态"><WarningOutlined className="cron-row-error" role="status" /></Tooltip>}
  </div>;
  const columns: TableProps<CronJob>["columns"] = [
    { title: "任务", key: "task", width: "26%", ellipsis: true, render: (_, job) => <div className="cron-task-cell"><Button type="link" className="cron-task-name" data-cron-focus={`title:${job.id}`} onClick={() => openDetail(job)} title={job.title}>{job.title}</Button>{job.system && <span className="cron-secondary">系统</span>}</div> },
    { title: "频率", key: "frequency", width: "15%", ellipsis: true, render: (_, job) => <span title={compactFrequency(job)}>{compactFrequency(job)}</span> },
    { title: "计划状态", key: "status", width: "9%", render: (_, job) => <span className="cron-plan-state" data-status={job.status}>{planLabel(job.status)}</span> },
    { title: "下次运行", key: "next", width: "16%", sorter: true, sortOrder: sort === "name" ? null : sort === "next-asc" ? "ascend" : "descend", render: (_, job) => nextCell(job) },
    { title: "最近结果", key: "result", width: "19%", render: (_, job) => resultCell(job) },
    { title: "操作", key: "actions", width: "15%", render: (_, job) => rowActions(job) },
  ];
  const empty = loadState === "loading" ? <div className="cron-empty-state" role="status">正在读取任务列表…</div> : <div className="cron-empty-state" data-cron-state="empty"><p>{jobs.length ? "没有符合条件的任务。" : "还没有定时任务。"}</p>{jobs.length > 0 && <Button type="text" onClick={() => setListParams({ q: null, status: null, attention: null, page: null })}>清除筛选</Button>}</div>;
  const list = <div className="cron-list-body" ref={listRef} data-cron-state={loadState} aria-busy={loadState === "loading"}>
    {loadState === "error" ? <div className="cron-read-error" role="alert"><p>{listError}</p><Button type="text" onClick={() => void loadJobs(true)}>重新读取</Button></div> : mobile ? <>
      {loadState === "loading" ? <Spin /> : visible.length === 0 ? empty : <ul className="cron-mobile-list">{visible.slice((effectivePage - 1) * 20, effectivePage * 20).map(job => <li key={job.id} data-cron-job={job.job_key} data-cron-status={job.status}>
        <div className="cron-mobile-title"><Button type="link" className="cron-task-name" data-cron-focus={`title:${job.id}`} onClick={() => openDetail(job)}>{job.title}</Button>{job.system && <span className="cron-secondary">系统</span>}<span className="cron-plan-state" data-status={job.status}>{planLabel(job.status)}</span></div>
        <div className="cron-mobile-meta"><span>{compactFrequency(job)}</span><span>下次 {nextCell(job)}</span></div>
        <div className="cron-mobile-result">{resultCell(job)}{rowActions(job)}</div>
      </li>)}</ul>}
      <Pagination current={effectivePage} total={visible.length} pageSize={20} size="small" showSizeChanger={false} hideOnSinglePage onChange={page => setListParams({ page: String(page) })} />
    </> : <Table<CronJob> size="small" rowKey="id" columns={columns} dataSource={visible} loading={loadState === "loading"} tableLayout="fixed"
      locale={{ emptyText: empty }} onRow={job => ({ "data-cron-job": job.job_key, "data-cron-status": job.status } as React.HTMLAttributes<HTMLTableRowElement>)}
      pagination={{ current: effectivePage, pageSize: 20, total: visible.length, hideOnSinglePage: true, showSizeChanger: false, showTotal: total => `共 ${total} 个任务` }}
      onChange={(pagination, _filters, sorter, extra) => {
        if (extra.action === "sort") {
          const field = Array.isArray(sorter) ? sorter[0] : sorter;
          const nextSort = field.order === "ascend" ? "next-asc" : field.order === "descend" ? "next-desc" : "name";
          setSort(nextSort); setOrder(orderedIds(jobs, nextSort)); setListParams({ page: null });
        } else setListParams({ page: String(pagination.current || 1) });
      }} />}
  </div>;
  const edit = isNew || editing && detail?.handler_key === "ai-task";
  const editField = <K extends keyof Editor>(key: K, value: Editor[K]) => setEditor(current => ({ ...current, [key]: value }));
  const beginEdit = () => { setEditorBaseline(snapshot); setComposerTouched(false); setEditing(true); };
  const capabilityNotice = detail?.execution_capability?.ready === false ? detail.execution_capability.reason || "当前执行能力未就绪，需要人工接管。" : !detail?.execution_capability ? "执行能力暂未核验，不能据计划状态判断自动执行可用。" : null;
  const composerEditor = <div className="cron-editor-footer">
    <h3>任务内容</h3>
    <div onChangeCapture={() => setComposerTouched(true)} onClickCapture={event => { if ((event.target as HTMLElement).closest("button") && !(event.target as HTMLElement).closest(".composer-submit")) setComposerTouched(true); }}>
      <ComposerDock key={detail?.id || "new"} variant="workspace" value={text} onChange={setText} onSubmit={payload => void save(payload)} disabled={busy.save} initialDraft={detail ? composerDraft(detail) : { text: "" }} objectRefs={objectRefs} onObjectRefsChange={setObjectRefs} submitLabel={isNew ? "保存为草稿" : "保存更改"} />
    </div>
    {detailError && <p className="cron-row-error" role="alert">{detailError}</p>}
  </div>;
  const viewTools = <div className="cron-view-tools">{(hasAttention || attentionOnly) && <Checkbox checked={attentionOnly} onChange={event => setListParams({ attention: event.target.checked ? "1" : null, page: null })}>最近失败／待接管</Checkbox>}<span className="cron-secondary">北京时间</span><Button type="text" icon={<ReloadOutlined />} aria-label="刷新定时任务列表" onClick={() => void loadJobs()} /></div>;

  return <div className="list-page cron-workspace" data-cron-page>
    {modalContext}
    <header className="cron-workspace-toolbar"><h1>定时任务</h1><div className="cron-workspace-tools">
      <Input.Search id="cron-search" aria-label="搜索任务" placeholder="搜索任务" allowClear value={inputQuery} enterButton={<Button type="default" aria-label="执行任务搜索" icon={<SearchOutlined aria-hidden="true" />} />} onChange={event => setInputQuery(event.target.value)} onSearch={(value, _event, info) => setListParams({ q: info?.source === "clear" ? null : value.trim(), page: null })} />
      <Button type="primary" icon={<PlusOutlined />} disabled={!!jobId} onClick={() => { originRef.current = { scroll: listRef.current?.scrollTop || 0, focus: "new" }; nav(`/cron/new${location.search}`); }} data-cron-focus="new">新建定时任务</Button>
    </div></header>
    {listError && loadState === "ok" && <div className="cron-stale-notice" role="status">读取失败，当前列表可能是旧状态。<Button type="text" onClick={() => void loadJobs()}>重试</Button></div>}
    <Tabs type="line" activeKey={filter} onChange={key => setListParams({ status: key === "all" ? null : key, page: null })} destroyOnHidden
      tabBarExtraContent={mobile ? undefined : viewTools}
      items={PLAN_VIEWS.map(view => ({ key: view.key, label: <span>{view.label}{loadState === "ok" && <span className="cron-view-count">{counts[view.key]}</span>}</span>, children: view.key === filter ? <>{mobile && viewTools}{list}</> : null }))} />
    <Drawer open={!!jobId} onClose={closeDrawer} keyboard={!busy.save} maskClosable={!busy.save} rootClassName="cron-workspace-drawer" size="default" title={isNew ? "新建定时任务" : detail?.title || "任务详情"}
      afterOpenChange={open => { if (!open && !jobId) requestAnimationFrame(restoreListOrigin); }} extra={<Button type="text" disabled={busy.save} onClick={closeDrawer}>返回定时任务列表</Button>} footer={edit ? composerEditor : null} destroyOnHidden>
      <section data-cron-detail={detail?.job_key || (isNew ? "new" : jobId)} className="cron-drawer-content">
        {detailLoading && <Spin tip="读取任务详情" />}
        {!detailLoading && detailError && !edit && <div role="alert" className="cron-read-error">{detailError}<Button type="text" onClick={() => setDetailRevision(value => value + 1)}>重新读取</Button></div>}
        {edit ? <fieldset className="cron-workspace-editor" disabled={busy.save} aria-label="任务时间设置">
          <label>任务名称<Input value={editor.title} maxLength={120} onChange={event => editField("title", event.target.value)} /></label>
          <label>执行方式<select value={editor.kind} onChange={event => setEditor(current => ({ ...current, kind: event.target.value as ScheduleKind, customCron: undefined }))}><option value="recurring">周期</option><option value="interval">间隔</option><option value="once">单次</option></select></label>
          <div className="cron-editor-schedule">
            {editor.kind === "recurring" && (editor.customCron ? <p className="cron-secondary">保留已有自定义频率：{editor.customCron}。切换执行方式才会替换该计划。</p> : <>
              <label>周期<select value={editor.repeat} onChange={event => editField("repeat", event.target.value as Editor["repeat"])}><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
              {editor.repeat === "weekly" && <label>星期<select value={editor.weekday} onChange={event => editField("weekday", event.target.value)}>{["日", "一", "二", "三", "四", "五", "六"].map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label>}
              {editor.repeat === "monthly" && <label>日期<input type="number" min="1" max="31" value={editor.monthday} onChange={event => editField("monthday", event.target.value)} /></label>}
              <label>时间<input type="time" value={editor.time} onChange={event => editField("time", event.target.value)} /></label>
            </>)}
            {editor.kind === "interval" && <label>每隔多少分钟<input type="number" min="1" max="525600" value={editor.minutes} onChange={event => editField("minutes", event.target.value)} /></label>}
            {editor.kind === "once" && <label>执行时间<input type="datetime-local" value={editor.once} onChange={event => editField("once", event.target.value)} /></label>}
          </div>
          <p className="cron-secondary">按 {editor.zone === DEFAULT_TIME_ZONE ? "北京时间" : editor.zone} 执行。{isNew ? "先保存草稿，核对内容与范围后再发布。当前 AI 自动执行能力尚未就绪，不承诺自动完成。" : "保存将更新后续触发的配置，不改变已有回执。"}</p>
          <details className="cron-fold"><summary>高级时间设置</summary><div className="cron-editor-schedule"><label>生效开始<input type="datetime-local" value={editor.start} onChange={event => editField("start", event.target.value)} /></label><label>生效结束<input type="datetime-local" value={editor.end} onChange={event => editField("end", event.target.value)} /></label><label>调度时区<Input value={editor.zone} onChange={event => editField("zone", event.target.value)} /></label></div></details>
          {detail && <Button type="text" onClick={() => { const cancel = () => { setEditor(editorFor(detail)); const composer = (detail.condition?.composer || {}) as ComposerSubmit; setText(composer.text || ""); setObjectRefs(composer.object_refs || []); setComposerTouched(false); setEditing(false); dirtyRef.current = false; }; if (dirtyRef.current) modal.confirm({ title: "放弃未保存的内容？", okText: "放弃编辑", cancelText: "继续编辑", onOk: cancel }); else cancel(); }}>取消编辑</Button>}
        </fieldset> : detail && <>
          <div className="cron-detail-summary"><span className="cron-plan-state" data-status={detail.status}>{planLabel(detail.status)}</span><span className="cron-secondary">{detail.system ? "系统任务" : "个人任务"}</span></div>
          {capabilityNotice && <div className="cron-capability-notice" role="status"><InfoCircleOutlined aria-hidden="true" /><span><strong>执行能力未就绪</strong> · {capabilityNotice}</span></div>}
          {detail.system && !actionAllowed(detail, "edit") && <p className="cron-secondary">此系统任务由管理员管理，员工不能修改计划。</p>}
          <div className="cron-detail-actions">{rowActions(detail, true)}{actionAllowed(detail, "edit") && detail.handler_key === "ai-task" && <Button type="text" onClick={beginEdit}>编辑</Button>}{actionAllowed(detail, "publish") && <Button type="primary" disabled={busy[detail.id]} onClick={() => modal.confirm({ title: "核对并启用此任务？", content: <><p>{detail.title} · {compactFrequency(detail)}</p><p>执行范围：{String(detail.scope?.label || "按已授权范围")}</p><p>{detail.execution_capability?.ready === false ? "执行能力未就绪：启用计划不会解除阻断，运行仍可能需要人工接管。" : "仅按既有权限和已发布范围触发，不代表业务已完成。"}</p></>, okText: "发布并启用", cancelText: "继续核对", onOk: () => changeStatus(detail, "published") })}>发布并启用</Button>}</div>
          {rowError[detail.id] && <p className="cron-row-error" role="alert">{rowError[detail.id]}</p>}
          {selectedRun ? <article className="cron-result-panel" data-cron-receipt-panel id="cron-receipt" tabIndex={-1}><h3>最近执行</h3><p className="cron-run-meta"><span data-result={selectedRun.status}>{isAttention(selectedRun.status) && <WarningOutlined aria-hidden="true" />}{receiptLabel(selectedRun)}</span><span className="cron-secondary">{formatExactTime(selectedRun.finished_at || selectedRun.started_at || selectedRun.scheduled_for)}</span></p>
            {refreshError[detail.id] && <div role="status" className="cron-stale-notice">运行状态暂时无法刷新，当前可能是旧状态。<Button type="text" onClick={() => void api.cronRun(selectedRun.id).then(data => acceptRun(data.run, data.job)).catch(() => setRefreshError(current => ({ ...current, [detail.id]: true })))}>重试</Button></div>}
            <pre>{receiptText(selectedRun)}</pre>{selectedRun.session_id && <Link to={`/s/${encodeURIComponent(selectedRun.session_id)}`}>打开执行会话</Link>}
          </article> : <p className="cron-secondary">还没有运行回执。</p>}
          <dl className="cron-detail-fields"><div><dt>频率</dt><dd>{compactFrequency(detail)}</dd></div><div><dt>下次运行（北京时间）</dt><dd>{detail.status === "published" ? detail.next_run_at ? formatExactTime(detail.next_run_at) : "暂无下次时间" : "—"}{detail.status === "published" && !detail.next_run_at && <p className="cron-secondary">计划可能尚未生效、已结束或没有可执行的下一时间；请核对生效区间。</p>}</dd></div><div><dt>执行范围</dt><dd>{String(detail.scope?.label || "按已授权范围")}</dd></div><div><dt>生效区间</dt><dd>{formatExactTime(String(detail.condition?.schedule && (detail.condition.schedule as Record<string, unknown>).start_at || ""))} 至 {formatExactTime(String(detail.condition?.schedule && (detail.condition.schedule as Record<string, unknown>).end_at || ""))}</dd></div></dl>
          {detail.handler_key === "ai-task" && <details className="cron-fold"><summary>任务内容与范围</summary><p className="cron-task-content">{String((detail.condition?.composer as ComposerSubmit | undefined)?.text || "未填写任务内容")}</p><p className="cron-secondary">任务提交不等于业务完成。正式副作用仍须执行授权、确认及审批闸门。</p></details>}
          {detail.handler_key === "discovery-search" && <details className="cron-fold"><summary>系统发现模板</summary><DiscoveryTemplateEditor job={detail} admin={actionAllowed(detail, "edit")} onSaved={job => { updateRow(job); setDetail(job); }} /></details>}
          <details className="cron-fold" data-cron-timeline><summary>运行记录（{runs.length}）</summary>{runs.length === 0 ? <p className="cron-secondary">还没有运行记录。</p> : <ol className="cron-history">{runs.map(run => <li key={run.id}><Button type="link" data-cron-run={run.id} data-cron-run-status={run.status} onClick={() => setSelectedRun(run)}>{receiptLabel(run)} · {run.trigger === "manual" ? "手动" : "定时"} · {formatExactTime(run.scheduled_for)}</Button>{run.session_id && <Link to={`/s/${encodeURIComponent(run.session_id)}`}>查看执行</Link>}</li>)}</ol>}</details>
          <details className="cron-fold"><summary>技术诊断</summary><dl className="cron-detail-fields"><div><dt>处理器</dt><dd>{detail.handler_key}</dd></div><div><dt>调度时区</dt><dd>{detail.timezone || "未指定"}（下次运行按北京时间展示）</dd></div><div><dt>Cron</dt><dd>{detail.cron_expr || "—"}</dd></div><div><dt>配置版本</dt><dd>{detail.published_rev || 1}</dd></div><div><dt>执行身份</dt><dd>{detail.execute_identity || detail.execute_as || "—"}</dd></div><div><dt>副作用类型</dt><dd>{String(detail.handler?.side_effect || "未登记")}</dd></div></dl><pre className="cron-raw-receipt">{JSON.stringify({ schedule: detail.condition?.schedule || detail.schedule, receipt: selectedRun?.receipt, error_code: selectedRun?.error_code }, null, 2)}</pre></details>
        </>}
      </section>
    </Drawer>
  </div>;
}

export default function Cron() { return <CronTheme><CronWorkbench /></CronTheme>; }
