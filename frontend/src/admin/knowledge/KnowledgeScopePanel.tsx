import { Button, Collapse } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { KnowledgeScope, ScopeDetail } from "../../../../shared/knowledge-scope";
import { reviewApi, reviewCompany } from "../../reviews/api";
import AsyncTaskInfo, { type TaskHandoff, type TaskJob } from "./AsyncTaskInfo";
import { documentAssetUrl } from "./DocumentReader";
import { errorMessage, errorStatus } from "./shared";
import "./knowledge-scope.css";

const states = { empty: "尚未提炼", candidate: "范围待核对", checked: "范围已核对 · 未发布", published: "范围已发布" };
const types: Record<string, string> = { overview: "产品/内容概览", parameter_lookup: "参数查询", conditions: "适用与测试条件", usage: "使用说明", comparison: "资料内比较" };
// Bounded by facts, not a 20-second cutoff: one batch of a long document can
// legitimately take minutes. Handoff and transient read failure have shorter bounds.
const JOB_POLL_LIMIT = 360; // 15 minutes without any new business progress.
const HANDOFF_POLL_LIMIT = 48; // Two minutes awaiting a durable job receipt.
const ERROR_POLL_LIMIT = 8;

type CompatibleScopeJob = NonNullable<ScopeDetail["job"]> & {
  progress?: { done: number; total: number | null; unit: string; last_progress_at?: string };
};
type CompatibleScopeDetail = Omit<ScopeDetail, "job"> & {
  job: CompatibleScopeJob | null;
  handoff?: TaskHandoff | null;
};
type DocumentJob = TaskJob | null | undefined;

export default function KnowledgeScopePanel({
  id,
  documentStatus,
  documentJob,
  documentJobs,
  documentError,
  refreshToken,
  onReady,
  onDirty,
  onChanged,
  reader,
}: {
  id: string;
  documentStatus?: string;
  documentJob?: DocumentJob;
  documentJobs?: TaskJob[];
  documentError?: string;
  refreshToken?: string;
  onReady: (value: boolean) => void;
  onDirty?: (value: boolean) => void;
  onChanged: () => void;
  reader?: ReactNode;
}) {
  const [data, setData] = useState<CompatibleScopeDetail | null>(null);
  const [explanation, setExplanation] = useState("");
  const [scope, setScope] = useState<KnowledgeScope | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [topic, setTopic] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [readFailureStatus, setReadFailureStatus] = useState(0);
  const [consecutiveReadFailures, setConsecutiveReadFailures] = useState(0);
  const [pollAttempts, setPollAttempts] = useState(0);
  const dirtyRef = useRef(false);
  const currentDocument = useRef(id);
  const requestSequence = useRef(0);
  const inflight = useRef(false);
  const endpoint = `/admin/knowledge/documents/${encodeURIComponent(id)}/scope`;

  // Invalidate a late response immediately during render, before effects for the
  // new document begin. The parent also guards dirty navigation at workspace level.
  if (currentDocument.current !== id) {
    currentDocument.current = id;
    requestSequence.current += 1;
    inflight.current = false;
  }

  const load = useCallback(async () => {
    if (inflight.current) return;
    const request = ++requestSequence.current;
    const targetId = id;
    inflight.current = true;
    setChecking(true);
    try {
      const next = await reviewApi<CompatibleScopeDetail>(endpoint);
      if (targetId !== currentDocument.current || request !== requestSequence.current) return;
      setData(next);
      if (!dirtyRef.current) {
        setExplanation(next.explanation);
        setScope(next.scope);
      }
      setError("");
      setReadFailureStatus(0);
      setConsecutiveReadFailures(0);
      const unsettled = ["queued", "running", "retrying", "uncertain"].includes(String(next.job?.status || ""));
      onReady(!dirtyRef.current && !unsettled && (["checked", "published"].includes(next.state) || next.frozen));
    } catch (cause) {
      if (targetId !== currentDocument.current || request !== requestSequence.current) return;
      setError(errorMessage(cause));
      setReadFailureStatus(errorStatus(cause));
      setConsecutiveReadFailures((current) => current + 1);
      onReady(false);
    } finally {
      if (targetId === currentDocument.current && request === requestSequence.current) {
        inflight.current = false;
        setChecking(false);
      }
    }
  }, [endpoint, id, onReady]);

  /* A different stable document ID must never accept a late receipt from the old request. */
  useEffect(() => {
    requestSequence.current += 1;
    inflight.current = false;
    dirtyRef.current = false;
    setData(null);
    setScope(null);
    setExplanation("");
    setError("");
    setReadFailureStatus(0);
    setConsecutiveReadFailures(0);
    setPollAttempts(0);
    setDirty(false);
    onDirty?.(false);
    return () => {
      requestSequence.current += 1;
      inflight.current = false;
    };
  }, [id, onDirty]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  const jobStatus = String(data?.job?.status || "");
  const handoffStatus = String(data?.handoff?.status || "");
  const jobRunning = ["queued", "running", "retrying"].includes(jobStatus);
  const handoffPending = !data?.job && ["pending", "queued"].includes(handoffStatus)
    && (!documentStatus || documentStatus === "pending_review");
  const tracked = Boolean((data && (jobRunning || handoffPending)) || (!data && error));
  const permissionBlocked = readFailureStatus >= 400 && readFailureStatus < 500 && ![408, 429].includes(readFailureStatus);
  const pollLimit = error ? ERROR_POLL_LIMIT : jobRunning ? JOB_POLL_LIMIT : HANDOFF_POLL_LIMIT;
  const pollCount = error ? consecutiveReadFailures : pollAttempts;
  const pollKey = `${id}:${jobStatus}:${handoffStatus}:${data?.job?.progress?.done ?? ""}:${data?.job?.progress?.total ?? ""}:${data?.job?.progress?.last_progress_at ?? ""}`;

  useEffect(() => { setPollAttempts(0); }, [pollKey]);
  useEffect(() => {
    if (!tracked || permissionBlocked || checking || pollCount >= pollLimit) return;
    const timer = window.setTimeout(() => {
      setPollAttempts((current) => current + 1);
      void load();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [tracked, permissionBlocked, checking, pollAttempts, pollCount, pollLimit, load]);

  const manualRead = useCallback(() => {
    setPollAttempts(0);
    setConsecutiveReadFailures(0);
    void load();
  }, [load]);

  const changed = () => {
    dirtyRef.current = true;
    setDirty(true);
    onDirty?.(true);
    onReady(false);
  };
  const save = async (checked: boolean) => {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const next = await reviewApi<CompatibleScopeDetail>(endpoint, { expectedRevision: data.revision, explanation, scope, checked }, "PUT");
      setData(next);
      setScope(next.scope);
      dirtyRef.current = false;
      setDirty(false);
      onDirty?.(false);
      onReady(next.state === "checked" || next.state === "published");
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    if (!data || !data.actions.generate) return;
    setBusy(true);
    setError("");
    try {
      await reviewApi(`${endpoint}-jobs`, { expectedRevision: data.revision });
      setPollAttempts(0);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const editingBlockedReason = !data?.actions.edit
    ? "服务端未提供当前版本的范围编辑动作。"
    : busy ? "正在提交当前操作。"
      : jobRunning || handoffPending ? "范围作业或持久化交接进行中，暂不能修改草稿。"
        : "";
  const edit = Boolean(data?.actions.edit && !busy && !jobRunning && !handoffPending);
  const candidate = data?.state === "candidate";
  const saveDisabledReason = !dirty ? "修改后才能保存范围草稿。" : editingBlockedReason;
  const generateDisabledReason = !data?.actions.generate
    ? "服务端未提供重新提炼动作。"
    : jobStatus === "uncertain"
      ? "当前结果待核查；不能在页面盲目重新提炼。"
    : dirty ? "请先保存或放弃未保存修改，再重新提炼。"
      : jobRunning || handoffPending ? "当前已有范围作业或交接在进行。"
        : busy ? "正在提交当前操作。" : "";
  const checkDisabledReason = !data?.actions.check
    ? "服务端未提供当前候选的核对确认动作。"
      : !scope ? "服务端尚未返回可核对的候选范围。"
      : explanation !== data?.explanation ? "请先保存资料用途解释，再确认已核对原文范围。"
        : busy ? "正在提交当前操作。" : "";
  const latestScopeJob = data?.job as TaskJob | null | undefined;
  const pollLimitReached = tracked && pollCount >= pollLimit;
  const topicRows = scope?.topics.map((item, index) => <div className="kbw-scope-row" key={`${item.label}:${index}`}>
    <input aria-label={`主题 ${index + 1}`} maxLength={200} value={item.label} disabled={!edit} onChange={(event) => {
      setScope({ ...scope, topics: scope.topics.map((current, currentIndex) => currentIndex === index ? { ...current, label: event.target.value } : current) });
      changed();
    }} />
    {item.evidence_ids.map((ref) => {
      const source = scope?.evidence.find((evidence) => evidence.id === ref);
      const page = source?.original_pages[0];
      return source ? <a key={ref} href={`${documentAssetUrl(id, "preview", reviewCompany())}${page ? `#page=${page}` : ""}`} target="_blank" rel="noreferrer">{source.original_pages.length ? `原件第 ${source.original_pages.join("、")} 页` : "查看原件（页码映射缺失）"}</a> : null;
    })}
    {edit ? <Button type="text" onClick={() => { setScope({ ...scope, topics: scope.topics.filter((_, currentIndex) => currentIndex !== index) }); changed(); }}>移除主题</Button> : null}
  </div>) || [];
  const topicContent = topicRows.length > 4 ? <Collapse size="small" ghost items={[{ key: "topics", label: `覆盖主题及依据 · ${topicRows.length}`, children: topicRows }]} /> : <><h4>覆盖主题及依据</h4>{topicRows}</>;

  return <section className="kbw-scope" aria-label="文档知识范围" aria-busy={busy || checking || tracked}>
    <h3>资料解释与知识范围</h3>
    <AsyncTaskInfo
      documentStatus={documentStatus}
      documentJob={documentJob}
      scopeState={data?.state}
      scopeJob={latestScopeJob}
      handoff={data?.handoff}
      documentError={documentError}
      readError={error}
      readFailureStatus={readFailureStatus}
      polling={tracked && !permissionBlocked && !pollLimitReached}
      pollLimitReached={pollLimitReached}
      onRefresh={manualRead}
      history={documentJobs}
    />
    {reader}
    {!data && !error ? <p role="status">正在读取范围…</p> : null}
    {data ? <>
      <label>资料用途解释<textarea maxLength={4000} value={explanation} disabled={!edit} placeholder="资料讲什么、适合回答什么、适用对象和已知限制。解释不会代替原文事实。" onChange={(event) => { setExplanation(event.target.value); changed(); }} /></label>
      {dirty ? <p role="status">当前资料有未保存修改；自动刷新不会覆盖草稿。</p> : null}
      {data.frozen ? <p>本版本材料已冻结。修改原件、解释或知识范围须创建新版本草稿。</p> : null}
      {scope ? <>
        <label>内容范围摘要<textarea maxLength={2000} value={scope.summary} disabled={!edit} onChange={(event) => { setScope({ ...scope, summary: event.target.value }); changed(); }} /></label>
        <p>目录完整性：未确认。回答仅限收录资料，具体答案仍须查询原文。</p>
        {topicContent}
        {edit ? <div className="kbw-scope-row"><input aria-label="新增主题" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="补充有原文支持的主题" /><select aria-label="新增主题原文依据" value={evidenceId} onChange={(event) => setEvidenceId(event.target.value)}><option value="">选择原文依据</option>{scope.evidence.map((evidence) => <option key={evidence.id} value={evidence.id}>{evidence.original_pages.length ? `原件第 ${evidence.original_pages.join("、")} 页` : "页码未映射"} · {evidence.text.slice(0, 35)}</option>)}</select><Button type="text" disabled={!topic.trim() || !evidenceId} onClick={() => { setScope({ ...scope, topics: [...scope.topics, { label: topic.trim(), evidence_ids: [evidenceId] }] }); setTopic(""); changed(); }}>添加主题</Button></div> : null}
        <h4>对象与型号</h4>{scope.entities.map((entity, index) => <div className="kbw-scope-row" key={`${entity.name}:${index}`}><input aria-label={`对象 ${index + 1}`} maxLength={200} disabled={!edit} value={entity.name} onChange={(event) => { setScope({ ...scope, entities: scope.entities.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }); changed(); }} /><span>{entity.evidence_ids.flatMap((ref) => scope.evidence.find((item) => item.id === ref)?.original_pages || []).map((page) => `原件第${page}页`).join("、")}</span>{edit ? <Button type="text" onClick={() => { setScope({ ...scope, entities: scope.entities.filter((_, itemIndex) => itemIndex !== index) }); changed(); }}>移除对象</Button> : null}</div>)}{!scope.entities.length ? <p>原文未明确对象</p> : null}
        <fieldset disabled={!edit}><legend>可支持的问题</legend>{Object.entries(types).map(([type, label]) => <label key={type}><input type="checkbox" checked={scope.question_types.includes(type)} onChange={(event) => { setScope({ ...scope, question_types: event.target.checked ? [...scope.question_types, type] : scope.question_types.filter((current) => current !== type) }); changed(); }} />{label}</label>)}</fieldset>
        <label>条件和范围边界（每行一项）<textarea value={scope.limitations.join("\n")} disabled={!edit} onChange={(event) => { setScope({ ...scope, limitations: event.target.value.split("\n").filter((value) => value.trim()) }); changed(); }} /></label>
        {scope.unverified_notes.length > 0 ? <div role="note"><strong>待证实说明</strong><ul>{scope.unverified_notes.map((note, index) => <li key={`${note}:${index}`}>{note}</li>)}</ul></div> : null}
        {scope.coverage.status === "partial" ? <p role="alert">部分原文无法识别：{scope.coverage.unreadable_pages.join("、") || "页码映射缺口"}。不能声明完整覆盖。</p> : null}
        <Collapse size="small" ghost items={[{ key: "evidence", label: "核对原文摘录", children: scope.evidence.map((evidence) => <section key={evidence.id}><strong>{evidence.original_pages.length ? `原件第 ${evidence.original_pages.join("、")} 页` : "页码未映射"}</strong><pre className="kbv-body">{evidence.text}</pre></section>) }]} />
      </> : null}
      {data.actions.edit ? <div className="kbw-scope-actions">
        <div><Button type="text" disabled={Boolean(saveDisabledReason)} onClick={() => void save(false)}>保存解释与范围草稿</Button>{saveDisabledReason ? <span role="note">{saveDisabledReason}</span> : null}</div>
        <div><Button type="text" disabled={Boolean(generateDisabledReason)} onClick={() => void generate()}>{scope ? "重新提炼范围" : "提炼知识范围"}</Button>{generateDisabledReason ? <span role="note">{generateDisabledReason}</span> : null}</div>
        <div><Button type="text" disabled={Boolean(checkDisabledReason)} onClick={() => void save(true)}>确认已核对原文范围</Button>{checkDisabledReason ? <span role="note">{checkDisabledReason}</span> : null}</div>
      </div> : candidate ? <p role="note">服务端未提供当前候选的范围编辑或核对动作，无法在页面继续处理。</p> : null}
      {!scope && !jobRunning && !handoffPending && !["failed", "uncertain", "cancelled"].includes(jobStatus) && !["failed", "cancelled"].includes(String(documentStatus || "")) ? <p>{documentStatus && ["uploaded", "normalizing", "indexing"].includes(documentStatus) ? "资料仍在规整或索引，范围提炼尚未开始。" : states[data.state] === states.empty ? "当前没有可核对范围；是否自动提炼以服务端交接状态为准。" : "请根据当前服务端状态继续处理。"}</p> : null}
    </> : null}
  </section>;
}
