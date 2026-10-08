import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EmailCard, Message, Task, TaskResultCard } from "../api";
import { taskResultCardsFrom } from "./ChatBlocks";
import PanelToggleIcon from "./PanelToggleIcon";
import { api } from "../api";
import { stripEngineCopy } from "../employeeCopy";
import type { SessionMailRow } from "./AgentTaskList";
import { taskStatusView, type TaskStatusShape } from "../runViewState";
import { useViewMode } from "../viewMode";
import { stageLabel } from "../labels";
import { isComposeResultCard } from "./ResultArtifact";
import { resultCardOf } from "./StreamArtifact";
import { streamTime } from "../streamOrder";
import AgentAvatar from "./AgentAvatar";
import type { TaskRunView } from "../runViewState";

/** 形状通道的字形：⚠ 只给需要人确认的 R3 等待，✓/✕ 只在真的完成或失败时出现。 */
const STATUS_SHAPE_GLYPH: Record<TaskStatusShape, string> = {
  dot: "•",
  pulse: "•",
  alert: "⚠",
  hollow: "○",
  check: "✓",
  cross: "✕",
  square: "■",
};

/** 结果目录的一行：指向中栏时间流里的那张卡（`data-stream-entry`）。 */
export type ResultEntry = { id: string; kind: string; title: string; detail?: string; time: number };

function clock(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 从时间流的消息里列出智能体的成果；状态与过程不进目录。 */
export function resultEntries(messages: Message[], extra: ResultEntry[] = []): ResultEntry[] {
  const rows: ResultEntry[] = [];
  for (const message of messages) {
    const payload = message.payload as Record<string, unknown>;
    const time = streamTime(message);
    const push = (kind: string, title: string, detail?: string) => rows.push({ id: message.id, kind, title, detail, time });
    if (message.kind === "task_result_card") {
      const card = resultCardOf(message);
      push("result", stripEngineCopy(String(card.title || (isComposeResultCard(card) ? "写合作邮件" : "任务结果"))), stripEngineCopy(String(card.summary || "")).slice(0, 60) || undefined);
    } else if (message.kind === "email_card") {
      const card = payload as unknown as EmailCard;
      push("draft", String(card.status || "") === "sent" ? "已发送的邮件" : "邮件草稿", card.subject || "无主题");
    } else if (message.kind === "confirm_stage_card") {
      const proposed = String(payload.proposed_stage || "");
      const written = String(payload.current_stage || "") === proposed;
      push("stage", "阶段建议", `${stageLabel(proposed) || proposed || "具体阶段"}${payload.rejected ? " · 已驳回" : written ? " · 已写入" : payload.resolved ? " · 已关闭" : " · 待确认"}`);
    } else if (message.kind === "inbound_card") {
      push("inbound", "未绑定来信", String(payload.subject || "无主题"));
    } else if (message.kind === "kol_mail_card") {
      const judgment = payload.judgment && typeof payload.judgment === "object" ? payload.judgment as { suggested_stage?: string; auto_propose?: boolean } : {};
      if (judgment.suggested_stage || judgment.auto_propose) push("inbound", "来信 · 建议改阶段", String(payload.subject || "无主题"));
    } else if (message.kind === "supplement_card" && Array.isArray(payload.fields) && payload.fields.length) {
      push("ship", "待补全", String(payload.title || "补全信息"));
    } else if (message.kind === "steps" && String(payload.title || "").includes("失联")) {
      push("overdue", String(payload.title || "失联与延期清单"));
    } else if (typeof payload.approval_id === "string" && payload.approval_id) {
      push("approval", "费用审批");
    } else if (message.kind === "assistant" && !payload.streaming) {
      for (const card of taskResultCardsFrom(String(payload.text || ""))) {
        push("result", stripEngineCopy(String(card.title || "任务结果")));
      }
    }
  }
  return [...rows, ...extra].sort((a, b) => b.time - a.time);
}

/** 点目录：把中栏滚到那张卡，并短暂标出它（不靠颜色单通道，另有轮廓）。 */
export function locateStreamEntry(id: string): void {
  const target = document.querySelector<HTMLElement>(`[data-stream-entry="${CSS.escape(id)}"]`);
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  target.classList.add("is-located");
  window.setTimeout(() => target.classList.remove("is-located"), 1600);
}

function MailBodyArtifact({ mail }: { mail: SessionMailRow }) {
  const body = String(mail.body || mail.snippet || "").trim();
  return (
    <article className="artifact mail-body" data-kind="mail-body" data-mail-body>
      <h2>{mail.subject || "无主题"}</h2>
      {body
        ? <pre className="mail-body-text">{body}</pre>
        : <p className="muted" data-mail-empty>正文未拉取到，请回到首页点「刷新收取」后再打开。</p>}
    </article>
  );
}

/**
 * 右栏只做两件事：执行中显示当前状态；执行结束后状态文字退场，只列结果目录
 * （标题 + 时间，点击定位到中栏时间流里的卡片）。完整的成果、过程与确认都在中栏。
 */
export default function SideWorkbench({
  sessionId,
  messages,
  status,
  task,
  focusedMail = null,
  resultExtra,
  extraEntries = [],
  statusOverride,
  phase,
  remoteLabel,
  discoveryReturn,
  embedded = false, runView, renderArtifact, artifactExtra,
}: {
  sessionId: string;
  messages: Message[];
  status: string;
  task?: Task | null;
  focusedMail?: SessionMailRow | null;
  resultExtra?: ReactNode;
  /** 页面自己的成果条目（例如采集候选），与消息里的成果一起进目录。 */
  extraEntries?: ResultEntry[];
  /** 采集等子流程给出的更具体状态词，覆盖状态文案但沿用同一投影的语气与形状。 */
  statusOverride?: string;
  /** 运行中的当前阶段（来自 useRunStatus 的过程投影）。 */
  phase?: string;
  /** 调试视图下的远端执行面名称，只出现在调试细节里。 */
  remoteLabel?: string;
  discoveryReturn?: string;
  embedded?: boolean; runView?: TaskRunView;
  renderArtifact?: (message: Message) => ReactNode | undefined; artifactExtra?: ReactNode;
}) {
  const { debug } = useViewMode();
  const statusView = taskStatusView(task, status);
  // 执行中、待人确认、失败是需要员工知道的状态；其余（已完成、待命等）结束后不再占位。
  const showStatus = runView ? runView.key !== "idle" : statusView.live || statusView.needsConfirm || statusView.tone === "failed";
  const entries = resultEntries(messages, extraEntries);
  const primaryArtifactId = [...messages].reverse().find(message => ["email_card", "confirm_stage_card", "supplement_card", "task_result_card"].includes(message.kind))?.id;
  const latestDraft = [...messages].reverse().find((message) => message.kind === "email_card");
  const draft = latestDraft ? latestDraft.payload as unknown as EmailCard : null;
  const latestResult = [...messages].reverse().find((message) => message.kind === "task_result_card");
  const result = latestResult ? resultCardOf(latestResult) : (task?.task_result || task?.crawl_result) as TaskResultCard | undefined;

  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("ui:right-collapsed");
    return saved === null ? window.matchMedia("(max-width: 1199px)").matches : saved === "true";
  });
  const [share, setShare] = useState<{ url?: string; expires_at?: string } | null>(null);
  const [toolStatus, setToolStatus] = useState("");

  const toggle = () => {
    setCollapsed((value) => {
      localStorage.setItem("ui:right-collapsed", String(!value));
      void api.savePreferences({ right_workbench_collapsed: !value }).catch(() => undefined);
      return !value;
    });
  };

  const copyArtifact = async () => {
    const content = draft
      ? [draft.subject, draft.body].filter(Boolean).join("\n\n")
      : result
        ? [result.title, result.summary, result.subject, result.body].filter(Boolean).join("\n\n")
        : "";
    await navigator.clipboard.writeText(content || "暂无可复制的结果");
    setToolStatus("已复制公开内容");
  };

  const createShare = async () => {
    try {
      const created = await api.shareSession(sessionId);
      const url = created.url || (created.token ? `${location.origin}/share/${created.token}` : "");
      setShare({ url, expires_at: created.expires_at });
      let copied = false;
      if (url && navigator.share) {
        await navigator.share({ title: "共享会话", url }).then(() => { copied = true; }).catch(() => undefined);
      } else if (url) {
        await navigator.clipboard.writeText(url).then(() => { copied = true; }).catch(() => undefined);
      }
      setToolStatus(url ? (copied ? "分享链接已创建并复制" : "分享链接已创建，请手动复制") : "分享已创建");
    } catch (e) {
      setToolStatus(e instanceof Error ? e.message : "无法创建分享");
    }
  };

  const Container = embedded ? "div" : "aside";
  return (
    <Container
      className={embedded ? "embedded-workbench" : "side-workbench scope-task-rail" + (collapsed ? " is-collapsed" : "")}
      data-workbench={embedded ? undefined : true}
    >
      {/* 收起/展开按钮＝今日任务右栏同一个控件（24px 图标 + 竖排标签 + 可见焦点环）。 */}
      {!embedded && (!discoveryReturn || collapsed) ? <button
        type="button"
        className="scope-task-rail-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开结果" : "收起结果"}
        title={collapsed ? "展开结果" : "收起结果"}
        data-workbench-toggle
        onClick={toggle}
      >
        <PanelToggleIcon className="scope-task-rail-toggle-icon" />
      </button> : null}
      {discoveryReturn && collapsed ? <Link className="discovery-return is-collapsed-return" to={discoveryReturn} data-session-back-link>返回 AI发现</Link> : null}
      {!embedded && collapsed ? null : <>
      <details className="result-tools"><summary>更多操作</summary>
      <div className="artifact-toolbar" aria-label="产物工具栏">
        {discoveryReturn ? <Link className="discovery-return" to={discoveryReturn} data-session-back-link>返回 AI发现</Link> : null}
        <a className="icon-btn" href={`/api/sessions/${sessionId}/export?format=md`} download aria-label="下载 Markdown">↓ MD</a>
        {debug ? <a className="icon-btn" href={`/api/sessions/${sessionId}/export?format=json`} download aria-label="下载 JSON">↓ JSON</a> : null}
        {draft?.draft_id && <a className="icon-btn" href={`/api/queries/mail.export?draft_id=${encodeURIComponent(draft.draft_id)}&format=eml`} download aria-label="下载邮件草稿">.eml</a>}
        <button className="icon-btn" onClick={() => void copyArtifact()}>复制</button>
        <button className="icon-btn" onClick={() => window.open(`/s/${sessionId}`, "_blank", "noopener")}>打开</button>
        <button className="icon-btn" onClick={() => void createShare()}>分享</button>
        {discoveryReturn && !embedded ? <button type="button" className="icon-btn discovery-inline-toggle" data-workbench-toggle
          aria-label="收起结果" aria-expanded onClick={toggle}><PanelToggleIcon className="scope-task-rail-toggle-icon" /></button> : null}
      </div>
      </details>
      {/* 执行中的状态（DESIGN §8.6）：颜色 + 形状 + 文案三条通道同时变化；结束后退场，只留结果目录。 */}
      {showStatus ? (
        <div className="side-status" data-run-status={statusView.key} data-run-tone={statusView.tone}>
          <AgentAvatar active={runView?.live ?? statusView.live} failed={(runView?.key || statusView.key) === "failed"} />
          <i className={`status-shape is-${statusView.tone}`} aria-hidden>{STATUS_SHAPE_GLYPH[statusView.shape]}</i>
          <span className="side-status-copy" data-agent-status={status} data-workspace-status role="status" aria-live="polite">
            {statusOverride || runView?.label || statusView.copy}
          </span>
          {statusView.live && phase ? <span className="side-status-phase" data-run-phase>{phase}</span> : null}
          {statusView.live ? <span className="side-status-hint">刷新页面不会取消后台执行；过程在中栏，完整成果保存在这里</span> : null}
          {debug && remoteLabel ? (
            <details className="execution-details side-status-debug">
              <summary>调试细节</summary>
              <p data-run-remote>{remoteLabel}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {(toolStatus || share) && <div className="share-status" role="status">{toolStatus}{share?.expires_at && <> · {new Date(share.expires_at).toLocaleString()} 过期</>}{share?.url && <><input className="share-url" aria-label="分享链接" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} /><button className="link-button" onClick={() => void navigator.clipboard.writeText(share.url || "").then(() => setToolStatus("分享链接已复制")).catch(() => setToolStatus("请手动复制链接"))}>复制链接</button></>}{share && <button className="link-button" onClick={() => void api.revokeShare(sessionId).then(() => { setShare(null); setToolStatus("分享已撤销"); }).catch((e) => setToolStatus(String(e)))}>撤销</button>}</div>}
      <div className="side-body" data-round-results>
        {resultExtra}
        {focusedMail ? (
          <section data-mail-focus>
            <MailBodyArtifact mail={focusedMail} />
          </section>
        ) : null}
        {renderArtifact ? <>{messages.map(message => {
          const artifact = renderArtifact(message);
          return artifact ? <section key={message.id} aria-selected={message.id === primaryArtifactId} data-result-message={message.id} data-tab={message.kind === "email_card" ? "draft" : "result"}>{artifact}</section> : null;
        })}{artifactExtra}</> : entries.length ? (
          <nav className="result-index" aria-label="结果目录" data-result-index>
            <div className="page-kicker">结果目录</div>
            <ol>
              {entries.map((entry) => (
                <li key={`${entry.kind}:${entry.id}`}>
                  <button type="button" className="result-index-item" data-result-entry={entry.id} data-result-kind={entry.kind} onClick={() => locateStreamEntry(entry.id)}>
                    <span className="result-index-title">{entry.title}</span>
                    {entry.detail ? <span className="result-index-detail">{entry.detail}</span> : null}
                    {entry.time ? <time className="result-index-time" dateTime={new Date(entry.time).toISOString()}>{clock(entry.time)}</time> : null}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        ) : !resultExtra && !focusedMail && !showStatus ? (
          <p className="muted" data-result-index-empty>还没有结果。智能体的过程与成果按时间出现在中栏，这里会列出成果目录。</p>
        ) : null}
      </div>
      </>}
    </Container>
  );
}
