import { Alert, Button, Collapse, Progress, Steps } from "antd";
import type { ReactNode } from "react";
import { formatKbTime } from "../../knowledgeCopy";
import "./knowledge-pilot.css";

export type TaskProgress = {
  done?: number | null;
  total?: number | null;
  unit?: string;
  last_progress_at?: string;
};

export type TaskJob = {
  id?: string;
  kind?: string;
  status?: string;
  error?: string | null;
  error_summary?: string | null;
  attempt?: number;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  progress?: TaskProgress | null;
  progress_done?: number;
  progress_total?: number;
};

export type TaskHandoff = {
  status?: "pending" | "queued" | "failed" | "none" | string;
  requested_at?: string;
  error?: string;
};

export type TaskRecovery = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
};

export type AsyncTaskInfoProps = {
  documentStatus?: string;
  documentJob?: TaskJob | null;
  scopeState?: "empty" | "candidate" | "checked" | "published" | string;
  scopeJob?: TaskJob | null;
  handoff?: TaskHandoff | null;
  documentError?: string;
  readError?: string;
  readFailureStatus?: number;
  polling?: boolean;
  pollLimitReached?: boolean;
  onRefresh?: () => void;
  recovery?: TaskRecovery | null;
  history?: TaskJob[];
};

type Projection = {
  type: "info" | "success" | "warning" | "error";
  title: string;
  reason: string;
  next: string;
};

const activeStatuses = new Set(["queued", "running", "retrying"]);
const terminalIssueStatuses = new Set(["failed", "uncertain", "cancelled"]);

function errorFor(job?: TaskJob | null) {
  return String(job?.error_summary || job?.error || "").trim();
}

/** Pure state projection keeps UI facts separate from server-side state decisions. */
export function projectAsyncTaskState({
  documentStatus,
  scopeState,
  scopeJob,
  handoff,
  documentError,
  readError,
  readFailureStatus,
  polling,
  pollLimitReached,
}: Pick<AsyncTaskInfoProps, "documentStatus" | "scopeState" | "scopeJob" | "handoff" | "documentError" | "readError" | "readFailureStatus" | "polling" | "pollLimitReached">): Projection {
  const jobStatus = String(scopeJob?.status || "");
  const handoffStatus = String(handoff?.status || "");
  const permissionBlocked = Boolean(readError) && Boolean(readFailureStatus && readFailureStatus >= 400 && readFailureStatus < 500 && ![408, 429].includes(readFailureStatus));

  if (permissionBlocked) return {
    type: "warning",
    title: "无法继续读取加工状态",
    reason: `${readError}。权限错误时已停止自动刷新，避免在无权限状态下重复请求。`,
    next: "请在权限恢复后重新读取当前资料。",
  };
  if (readError) return {
    type: "warning",
    title: "加工状态暂时无法读取",
    reason: polling ? `${readError}。将按有限次数重新读取。` : readError,
    next: pollLimitReached ? "已达到本次自动读取上限，请手动重新读取。" : "可重新读取；服务端状态恢复后会继续显示。",
  };
  if (documentStatus === "failed") return {
    type: "error",
    title: "资料加工失败",
    reason: documentError || "服务端已将资料加工标为失败。",
    next: "请查看失败原因；只有服务端提供“重试加工”时才能恢复。",
  };
  if (documentStatus === "cancelled") return {
    type: "warning",
    title: "资料加工已取消",
    reason: documentError || "该资料没有继续进入规整、索引或范围提炼。",
    next: "若服务端提供“重试加工”，可从已取消的加工状态恢复。",
  };
  if (!scopeJob && documentStatus === "draft") return {
    type: "info", title: "原件草稿已保存，尚未解析",
    reason: "保存原件不等于已启动加工，也不会参与员工问答。",
    next: "只有服务端提供“解析并提取范围”动作时才能开始加工。",
  };
  if (!scopeJob && documentStatus === "uploaded") return {
    type: "info", title: "资料已提交，等待加工服务接管",
    reason: "服务端尚未报告规整或索引作业开始。",
    next: "资料加工完成后，范围提炼是否自动开始以服务端交接状态为准。",
  };
  if (!scopeJob && documentStatus === "normalizing") return {
    type: "info", title: "正在规整原件",
    reason: "当前资料尚未完成可检索的原文规整。",
    next: "规整完成后将建立索引；范围提炼尚未开始。",
  };
  if (!scopeJob && documentStatus === "indexing") return {
    type: "info", title: "正在建立资料索引",
    reason: "范围提炼依赖可用的原文索引。",
    next: "索引完成后，是否自动提炼以服务端持久化交接状态为准。",
  };
  if (activeStatuses.has(jobStatus)) return {
    type: "info",
    title: jobStatus === "queued" ? "范围提炼已排队" : "正在依据原文提炼知识范围",
    reason: "当前阶段由服务端作业状态提供。",
    next: pollLimitReached ? "本次自动读取已到上限，请手动重新读取。" : "完成后会进入范围核对；不会自动发布。",
  };
  if (terminalIssueStatuses.has(jobStatus)) {
    const uncertain = jobStatus === "uncertain";
    return {
      type: uncertain ? "warning" : jobStatus === "cancelled" ? "warning" : "error",
      title: uncertain ? "范围提炼结果待核查" : jobStatus === "cancelled" ? "范围提炼已取消" : "范围提炼失败",
      reason: errorFor(scopeJob) || (uncertain ? "服务端尚未确认本次提炼是否完成。" : "服务端未生成可供核对的范围。"),
      next: uncertain ? "请先核对服务端回执；不要将其当作未开始或已发布。" : "仅在服务端提供恢复动作时继续处理。",
    };
  }
  if (scopeState === "candidate") return {
    type: "info",
    title: "范围待核对",
    reason: "服务端已生成候选范围；候选不等于已发布，也不会自动参与员工问答。",
    next: "请对照原件核对范围后，再使用服务端允许的确认动作。",
  };
  if (scopeState === "checked") return {
    type: "success",
    title: "范围已核对，尚未发布",
    reason: "人工核对已保存；审批与发布仍是独立事实。",
    next: "按现有审批流程提交，审批通过也不等于已发布。",
  };
  if (scopeState === "published") return {
    type: "success",
    title: "范围已发布",
    reason: "当前资料版本的知识范围已按服务端状态发布。",
    next: "可继续查阅原件或创建新版本草稿。",
  };
  if (handoffStatus === "failed") return {
    type: "error",
    title: "索引后的范围提炼交接失败",
    reason: handoff?.error || "服务端未能将索引结果交给范围提炼作业。",
    next: "请重新读取并使用服务端当前允许的恢复操作。",
  };
  if (["pending", "queued"].includes(handoffStatus) && !scopeJob) return {
    type: "info",
    title: "索引完成，等待范围提炼交接",
    reason: handoff?.requested_at ? `服务端在 ${formatKbTime(handoff.requested_at)} 记录了自动提炼意图。` : "服务端已记录自动提炼意图，正在等待持久化作业接管。",
    next: pollLimitReached ? "本次等待已到上限，请重新读取确认是否已入队。" : "将在有限次数内检查持久化交接状态。",
  };
  return {
    type: "info",
    title: "等待范围提炼指令",
    reason: "资料已可供后续核对；服务端尚未确认自动范围提炼意图。",
    next: "可保存解释草稿；只有服务端提供“提炼知识范围”动作时才能发起提炼。",
  };
}

function actualProgress(scopeJob?: TaskJob | null, documentJob?: TaskJob | null) {
  const candidate = scopeJob ? scopeJob.progress : (documentJob ? {
    done: documentJob.progress_done,
    total: documentJob.progress_total,
    // Normalize can mean PDF pages, OCR or audio/video segments. Do not invent
    // a page unit when the legacy document job supplies only a count.
    unit: documentJob.kind === "normalize" ? "处理单元" : "索引单元",
  } : null);
  if (!candidate) return null;
  if (typeof candidate.done !== "number" || typeof candidate.total !== "number") return null;
  const done = candidate.done;
  const total = candidate.total;
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done < 0 || done > total) return null;
  const unit = candidate.unit === "batches" || candidate.unit === "batch" ? "批次" : String(candidate.unit || "项");
  return { done, total, unit, lastProgressAt: candidate.last_progress_at };
}

function taskStep(documentStatus?: string, scopeState?: string, scopeJob?: TaskJob | null, handoff?: TaskHandoff | null) {
  if (activeStatuses.has(String(scopeJob?.status || "")) || terminalIssueStatuses.has(String(scopeJob?.status || ""))) return 3;
  if (!scopeJob && documentStatus === "indexing") return 2;
  if (!scopeJob && documentStatus === "normalizing") return 1;
  if (!scopeJob && ["draft", "uploaded"].includes(String(documentStatus))) return 0;
  if (["candidate", "checked", "published"].includes(String(scopeState))) return 4;
  if (!scopeJob && ["pending", "queued", "failed"].includes(String(handoff?.status || ""))) return 3;
  if (documentStatus === "indexing") return 2;
  if (documentStatus === "normalizing") return 1;
  if (documentStatus === "pending_review") return 3;
  return 0;
}

function historyLine(job: TaskJob): ReactNode {
  const kind = job.kind === "normalize" ? "规整" : job.kind === "index" ? "索引" : "范围提炼";
  const status = job.status || "状态未记录";
  const when = formatKbTime(String(job.finished_at || job.started_at || job.created_at || ""));
  const progress = actualProgress(null, job);
  return <li key={`${job.id || kind}:${job.created_at || when}`}>{kind} · {status}{progress ? ` · ${progress.done}/${progress.total} ${progress.unit}` : ""}{when ? ` · ${when}` : ""}{errorFor(job) ? ` · ${errorFor(job)}` : ""}</li>;
}

export default function AsyncTaskInfo({
  documentStatus,
  documentJob,
  scopeState,
  scopeJob,
  handoff,
  documentError,
  readError,
  readFailureStatus,
  polling,
  pollLimitReached,
  onRefresh,
  recovery,
  history = [],
}: AsyncTaskInfoProps) {
  const projection = projectAsyncTaskState({ documentStatus, scopeState, scopeJob, handoff, documentError, readError, readFailureStatus, polling, pollLimitReached });
  const progress = actualProgress(scopeJob, documentJob);
  const current = taskStep(documentStatus, scopeState, scopeJob, handoff);
  const logs = [...history, ...(scopeJob ? [scopeJob] : [])]
    .filter((job, index, all) => all.findIndex((candidate) => `${candidate.id}:${candidate.kind}:${candidate.status}` === `${job.id}:${job.kind}:${job.status}`) === index);

  return <section className="kbpilot-async" aria-label="资料加工状态" aria-live="polite">
    <Alert
      type={projection.type}
      showIcon
      title={projection.title}
      description={<><span>{projection.reason}</span><span className="kbpilot-next"><strong>下一步：</strong>{projection.next}</span></>}
      action={onRefresh ? <Button type="text" size="small" onClick={onRefresh}>重新读取</Button> : undefined}
    />
    <Steps
      className="kbpilot-steps"
      size="small"
      orientation="horizontal"
      responsive={false}
      current={current}
      status={projection.type === "error" ? "error" : projection.type === "warning" ? "wait" : "process"}
      items={[
        { title: "保存原件" },
        { title: "规整原文" },
        { title: "建立索引" },
        { title: "提炼范围" },
        { title: "人工核对" },
      ]}
    />
    {progress ? <div className="kbpilot-progress" aria-label={`真实业务进度：${progress.done}/${progress.total} ${progress.unit}`}>
      <Progress percent={(progress.done / progress.total) * 100} showInfo={false} />
      <span>业务进度：{progress.done}/{progress.total} {progress.unit}{progress.lastProgressAt ? ` · 最近进展 ${formatKbTime(progress.lastProgressAt)}` : ""}</span>
    </div> : activeStatuses.has(String(scopeJob?.status || "")) || ["normalizing", "indexing"].includes(String(documentStatus)) ? <p className="kbpilot-progress-unknown">服务端未提供细分业务进度；不会显示估算百分比。</p> : null}
    {recovery ? <div className="kbpilot-recovery">
      <Button type="text" onClick={recovery.onClick} disabled={recovery.disabled}>{recovery.label}</Button>
      {recovery.disabledReason ? <span role="note">{recovery.disabledReason}</span> : null}
    </div> : null}
    {logs.length ? <Collapse className="kbpilot-history" size="small" ghost items={[{
      key: "history",
      label: "加工记录与来源",
      children: <ul>{logs.map(historyLine)}</ul>,
    }]} /> : null}
  </section>;
}
