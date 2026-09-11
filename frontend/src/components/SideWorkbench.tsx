import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  CrawlJob,
  EmailCard,
  Message,
  StartCrawlInput,
  Task,
  TaskEvent,
  TaskResultCard,
  TaskResultMetric,
  TaskResultSection,
} from "../api";
import {
  ConfirmStageArtifact,
  DraftArtifact,
  InboundArtifact,
  KolMailCard,
  OverdueArtifact,
  StageFromDraft,
  storeComposerDraft,
  SupplementArtifact,
} from "./ChatBlocks";
import Markdown from "./Markdown";
import { api } from "../api";
import CrawlArtifact, { crawlCandidates } from "./CrawlArtifact";
import { SuggestedFollowTags } from "./FollowStyleTags";
import { fieldLabel } from "../labels";
import type { SessionMailRow } from "./AgentTaskList";

export type TabId = "result" | "mail" | "draft" | "stage" | "inbound" | "approval" | "overdue" | "ship";

const TAB_LABEL: Record<TabId, string> = {
  result: "结果",
  mail: "邮件",
  draft: "草稿",
  stage: "阶段",
  inbound: "来信",
  approval: "审批",
  overdue: "在途",
  ship: "补全",
};

function lastOf(messages: Message[], kind: string): Message | undefined {
  return [...messages].reverse().find((m) => m.kind === kind);
}

function messageIndex(messages: Message[], id?: string): number {
  if (!id) return -1;
  return messages.findIndex((message) => message.id === id);
}

function isLaterThan(messages: Message[], later?: Message, earlier?: Message): boolean {
  if (!later || !earlier) return false;
  return messageIndex(messages, later.id) > messageIndex(messages, earlier.id);
}

function activeSupplement(messages: Message[]): Message | undefined {
  const ship = lastOf(messages, "supplement_card");
  if (!ship) return undefined;
  const compose = [...messages].reverse().find((message) => {
    if (message.kind === "email_card") return true;
    if (message.kind !== "task_result_card") return false;
    return isComposeResultCard(message.payload as unknown as TaskResultCard);
  });
  return isLaterThan(messages, compose, ship) ? undefined : ship;
}

function afterLastUser(messages: Message[]): Message[] {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === "me") {
      start = i;
      break;
    }
  }
  return messages.slice(start);
}

function pickPrimaryTab(round: Message[], extras: { crawl?: boolean; focusedMail?: boolean; ship?: boolean }): TabId {
  if (extras.focusedMail) return "result";
  if (extras.ship) return "ship";
  for (const message of [...round].reverse()) {
    if (message.kind === "email_card") {
      const hasComposeResult = round.some((row) => row.kind === "task_result_card" && isComposeResultCard(row.payload as unknown as TaskResultCard));
      return hasComposeResult ? "mail" : "draft";
    }
    if (message.kind === "confirm_stage_card") return "stage";
    if (message.kind === "inbound_card" || message.kind === "kol_mail_card") return "inbound";
    if (message.kind === "supplement_card") return "ship";
    if (message.kind === "task_result_card") {
      return isComposeResultCard(message.payload as unknown as TaskResultCard) ? "mail" : "result";
    }
    if (message.kind === "steps" && String(message.payload.title || "").includes("失联")) return "overdue";
    if (message.payload.approval_id || String(message.payload.text || "").includes("当前等待")) return "approval";
  }
  if (extras.crawl) return "result";
  return "result";
}

function displayValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(" · ");
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${fieldLabel(key)}：${displayValue(item)}`)
    .join(" · ");
}

function actionPrompt(
  action: string | { label?: string; title?: string; description?: string; prompt?: string; href?: string },
  index: number,
): { label: string; prompt: string; href?: string } {
  if (typeof action === "string") return { label: action, prompt: action };
  const label = action.label || action.title || action.description || `建议 ${index + 1}`;
  return { label, prompt: action.prompt || action.description || label, href: action.href };
}

function isComposeResultCard(card: TaskResultCard): boolean {
  const title = String(card.title || "");
  if (title === "邮件草稿" || title === "邮件已发送" || title === "写合作邮件") return true;
  if (card.compose_loop && typeof card.compose_loop === "object") return true;
  const sections = Array.isArray(card.sections) ? card.sections : [];
  return sections.some((section) => {
    const name = String(section.title || section.heading || "");
    if (/收发说明|预览正文|已发正文|往来依据|本封要点|建联要点|跟进要点|评估要点|报价要点|谈判要点|方案要点|合同要点|寄样资料|发货要点|测试要点|内容要点|审核要点|排期要点|发布要点|结算要点/.test(name)) return true;
    const blob = `${name} ${JSON.stringify(section.items || [])}`;
    return name === "摘要数据" && /发件邮箱|邮件主题|state：SENT|SYNC_SENT/.test(blob);
  });
}

const COMPOSE_INTERMEDIATE_SECTION = /^(KOL 智能体|本阶段 SOP|生命周期)/;

function composeResultSections(card: TaskResultCard, sections: TaskResultSection[]): TaskResultSection[] {
  if (!isComposeResultCard(card)) return sections;
  return sections.filter((section) => {
    const title = String(section.title || section.heading || "");
    if (title === "摘要数据") return false;
    return !COMPOSE_INTERMEDIATE_SECTION.test(title);
  });
}

function composeResultActions(
  card: TaskResultCard,
  actions: Array<string | { label?: string; title?: string; description?: string; prompt?: string; href?: string }>,
): Array<string | { label?: string; title?: string; description?: string; prompt?: string; href?: string }> {
  if (!isComposeResultCard(card)) return actions;
  const gap = card.compose_loop && typeof card.compose_loop === "object" ? card.compose_loop.gap : null;
  const cleaned = actions.filter((action) => {
    const label = typeof action === "string" ? action : (action.label || action.title || action.prompt || "");
    return !/补全发件|后再执行|记状态|费用审批|提出阶段变更/.test(label);
  });
  if (cleaned.length) return cleaned;
  if (String(card.title || "") === "邮件已发送") return ["再写一封"];
  if (gap && gap.field) {
    return [{ label: gap.result_action || gap.label || "补全后再确认发送", prompt: gap.prompt || "", title: gap.label }];
  }
  return ["核对预览后回复「确认发送」"];
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

function ResultActions({
  actions,
  sessionId,
  onPrefill,
}: {
  actions: Array<string | { label?: string; title?: string; description?: string; prompt?: string; href?: string }>;
  sessionId: string;
  onPrefill?: (text: string) => void;
}) {
  if (!actions.length) return null;
  return (
    <section className="result-actions">
      <h3>建议下一步</h3>
      <ol>
        {actions.map((action, index) => {
          const item = actionPrompt(action, index);
          return (
            <li key={index}>
              {item.href ? (
                <Link to={item.href}>{item.label}</Link>
              ) : onPrefill ? (
                <button
                  type="button"
                  onClick={() => {
                    storeComposerDraft(sessionId, { text: item.prompt });
                    onPrefill(item.prompt);
                  }}
                >
                  {item.label}
                </button>
              ) : item.label}
              {typeof action !== "string" && action.description && (action.label || action.title) && <small>{action.description}</small>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function GenericResultArtifact({
  card,
  sessionId,
  onPrefill,
  stacked = false,
  collaborationId,
  handle,
  onRefresh,
}: {
  card: TaskResultCard;
  sessionId: string;
  onPrefill?: (text: string) => void;
  stacked?: boolean;
  collaborationId?: string;
  handle?: string;
  onRefresh?: () => void;
}) {
  const rawSections: TaskResultSection[] = Array.isArray(card.sections)
    ? card.sections
    : Object.entries(card.sections || {}).map(([title, content]) => ({
        title,
        content: displayValue(content),
      }));
  const sections = composeResultSections(card, rawSections).filter((section) => section.title !== "建议跟进标签" && section.heading !== "建议跟进标签");
  const metrics: TaskResultMetric[] = Array.isArray(card.metrics)
    ? card.metrics
    : Object.entries(card.metrics || {}).map(([label, value]) => ({ label, value }));
  const rawActions = card.recommended_actions || card.actions || [];
  const actions = composeResultActions(
    card,
    card.suggested_follow_tags?.length
      ? rawActions.filter((action) => !/打标签/.test(typeof action === "string" ? action : String(action.prompt || action.label || "")))
      : rawActions,
  );

  return (
    <article className="artifact task-result" data-kind="task-result-card">
      <header>
        {stacked ? null : <div className="page-kicker">任务结果</div>}
        <h2>{card.title || "分析结果"}</h2>
        {card.summary && <p className="task-result-summary">{card.summary}</p>}
      </header>
      {metrics.length > 0 && (
        <dl className="result-metrics">
          {metrics.map((metric, index) => (
            <div key={`${metric.label || metric.name}-${index}`}>
              <dt>{metric.label || metric.name ? fieldLabel(String(metric.label || metric.name)) : `指标 ${index + 1}`}</dt>
              <dd>{displayValue(metric.value)}</dd>
              {(metric.detail || metric.change != null) && <small>{metric.detail || displayValue(metric.change)}</small>}
            </div>
          ))}
        </dl>
      )}
      {sections.map((section, index) => (
        <section className="result-section" key={`${section.title || section.heading}-${index}`}>
          <h3>{section.title || section.heading || `详情 ${index + 1}`}</h3>
          {(section.content || section.body || section.summary) && <Markdown>{section.content || section.body || section.summary || ""}</Markdown>}
          {section.items && (
            <ul>
              {section.items.map((item, itemIndex) => <li key={itemIndex}>{displayValue(item)}</li>)}
            </ul>
          )}
        </section>
      ))}
      {stacked ? null : <ResultActions actions={actions} sessionId={sessionId} onPrefill={onPrefill} />}
      <SuggestedFollowTags
        tags={(card.suggested_follow_tags || []).map((tag) => ({
          id: String(tag.id || tag.label || ""),
          label: String(tag.label || tag.id || ""),
          reason: tag.reason,
        }))}
        collaborationId={collaborationId}
        sessionId={sessionId}
        handle={handle}
        onPrefill={onPrefill}
        onApplied={() => onRefresh?.()}
      />
    </article>
  );
}

export default function SideWorkbench({
  sessionId,
  messages,
  status,
  onRefresh,
  onPosted,
  task,
  crawlJob,
  crawlEvents = [],
  crawlBusy = false,
  crawlError = "",
  onStartCrawl,
  onStopCrawl,
  onPrefill,
  crawlAdmin = false,
  onRetryCrawlUpload,
  onClearCrawlHistory,
  focusedMail = null,
  officialStage = "",
  collaborationId = "",
  handle = "",
}: {
  sessionId: string;
  messages: Message[];
  status: string;
  onRefresh: () => void;
  onPosted: (msgs: Message[]) => void;
  task?: Task | null;
  crawlJob?: CrawlJob | null;
  crawlEvents?: TaskEvent[];
  crawlBusy?: boolean;
  crawlError?: string;
  onStartCrawl?: (input: StartCrawlInput) => Promise<void>;
  onStopCrawl?: () => Promise<void>;
  onPrefill?: (text: string) => void;
  crawlAdmin?: boolean;
  onRetryCrawlUpload?: () => Promise<void>;
  onClearCrawlHistory?: () => Promise<void>;
  focusedMail?: SessionMailRow | null;
  officialStage?: string;
  collaborationId?: string;
  handle?: string;
}) {
  const round = afterLastUser(messages);
  const draftMsg = lastOf(round, "email_card");
  const draft = draftMsg ? (draftMsg.payload as unknown as EmailCard) : null;
  const stageMsg = lastOf(round, "confirm_stage_card");
  const resultMsg = lastOf(round, "task_result_card");
  const messageResult = resultMsg?.payload;
  const embeddedMessageResult = messageResult && (
    (messageResult.task_result && typeof messageResult.task_result === "object" && messageResult.task_result)
    || (messageResult.crawl_result && typeof messageResult.crawl_result === "object" && messageResult.crawl_result)
  );
  const taskResult = task && ((task.task_result || task.crawl_result) as TaskResultCard | undefined);
  const result = resultMsg
    ? (embeddedMessageResult || messageResult) as TaskResultCard
    : (!draft && !stageMsg ? (taskResult || null) : null);
  const candidates = crawlCandidates(crawlJob, result, messageResult, task);
  const hasCrawlArtifact = candidates.length > 0 && !draft && !stageMsg;
  const inboundMsg = lastOf(round, "inbound_card");
  const shipMsg = activeSupplement(round);
  const overdueMsg = [...round]
    .reverse()
    .find((m) => m.kind === "steps" && String(m.payload.title || "").includes("失联"));
  const approvalLine = [...round].reverse().find((m) =>
    Boolean(m.payload.approval_id) ||
    String(m.payload.text || "").includes("当前等待")
  );
  const mailMsgs = (() => {
    const inbound = round.filter((m) =>
      m.kind === "kol_mail_card" && String(m.payload.direction || "inbound") !== "outbound"
    );
    const confirmable = inbound.filter((m) => {
      const judgment = m.payload.judgment && typeof m.payload.judgment === "object"
        ? m.payload.judgment as { auto_propose?: boolean; suggested_stage?: string }
        : {};
      return Boolean(judgment.auto_propose || judgment.suggested_stage || (Array.isArray(m.payload.targets) && m.payload.targets.length));
    });
    if (round.length !== messages.length) return inbound;
    return confirmable.length ? confirmable : inbound.slice(-1);
  })();
  const primary = pickPrimaryTab(round, {
    crawl: hasCrawlArtifact,
    focusedMail: Boolean(focusedMail),
    ship: Boolean(shipMsg),
  });
  const hasRoundResult = Boolean(
    focusedMail || draft || stageMsg || result || hasCrawlArtifact || inboundMsg || shipMsg || overdueMsg || approvalLine || mailMsgs.length,
  );

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ui:right-collapsed") === "true");
  const [share, setShare] = useState<{ url?: string; expires_at?: string } | null>(null);
  const [toolStatus, setToolStatus] = useState("");
  const sideRef = useRef<HTMLElement>(null);

  const toggle = () => {
    setCollapsed((value) => {
      localStorage.setItem("ui:right-collapsed", String(!value));
      void api.savePreferences({ right_workbench_collapsed: !value }).catch(() => undefined);
      return !value;
    });
  };

  const copyArtifact = async () => {
    const safeDraft = draft ? { ...draft, body_zh_internal: undefined, approval_id: undefined } : null;
    const content = result
      ? JSON.stringify(result, null, 2)
      : safeDraft
        ? `${safeDraft.subject}\n\n${safeDraft.body}`
        : JSON.stringify(messages.filter((m) => !["approval"].includes(m.kind)), null, 2);
    await navigator.clipboard.writeText(content);
    setToolStatus("已复制公开内容");
  };

  const createShare = async () => {
    try {
      const result = await api.shareSession(sessionId);
      const url = result.url || (result.token ? `${location.origin}/share/${result.token}` : "");
      setShare({ url, expires_at: result.expires_at });
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

  return (
    <aside ref={sideRef} className={"side-workbench" + (collapsed ? " collapsed" : "")} data-workbench>
      <div className="artifact-toolbar" aria-label="产物工具栏">
        <button className="icon-btn" onClick={toggle} aria-label={collapsed ? "展开工作台" : "收起工作台"}>{collapsed ? "‹" : "›"}</button>
        {!collapsed && <>
          <a className="icon-btn" href={`/api/sessions/${sessionId}/export?format=md`} download aria-label="下载 Markdown">↓ MD</a>
          <a className="icon-btn" href={`/api/sessions/${sessionId}/export?format=json`} download aria-label="下载 JSON">↓ JSON</a>
          {draft?.draft_id && <a className="icon-btn" href={`/api/drafts/${draft.draft_id}/export?format=eml`} download aria-label="下载邮件草稿">.eml</a>}
          <button className="icon-btn" onClick={() => void copyArtifact()}>复制</button>
          <button className="icon-btn" onClick={() => window.open(`/s/${sessionId}`, "_blank", "noopener")}>打开</button>
          <button className="icon-btn" onClick={() => void createShare()}>分享</button>
        </>}
      </div>
      {collapsed ? <span className="collapsed-label">本轮结果</span> : <>
      <div className="side-head">
        <div className="page-kicker">本轮结果 · {TAB_LABEL[primary]}</div>
        <div className="side-status">
          <i className={"status-dot " + status} />
          <span data-agent-status={status}>
            {status === "running" ? "处理中" : status === "waiting_approval" ? "待审批" : "待命"}
          </span>
        </div>
      </div>
      {(toolStatus || share) && <div className="share-status" role="status">{toolStatus}{share?.expires_at && <> · {new Date(share.expires_at).toLocaleString()} 过期</>}{share?.url && <><input className="share-url" aria-label="分享链接" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} /><button className="link-button" onClick={() => void navigator.clipboard.writeText(share.url || "").then(() => setToolStatus("分享链接已复制")).catch(() => setToolStatus("请手动复制链接"))}>复制链接</button></>}{share && <button className="link-button" onClick={() => void api.revokeShare(sessionId).then(() => { setShare(null); setToolStatus("分享已撤销"); }).catch((e) => setToolStatus(String(e)))}>撤销</button>}</div>}
      {!hasRoundResult && (
        <p className="muted">本轮结果会出现在这里。中间是处理过程。</p>
      )}
      <div className="side-body" data-round-results>
        {focusedMail ? (
          <section data-tab="result" aria-selected={primary === "result"} data-mail-focus>
            <MailBodyArtifact mail={focusedMail} />
          </section>
        ) : (
          <>
            {hasCrawlArtifact && onStartCrawl && onStopCrawl && onPrefill && (
              <section data-tab="result" aria-selected={primary === "result"}>
                <CrawlArtifact
                  job={crawlJob}
                  events={crawlEvents}
                  candidates={candidates}
                  busy={crawlBusy}
                  error={crawlError}
                  onStart={onStartCrawl}
                  onStop={onStopCrawl}
                  onPrefill={onPrefill}
                  showControls={false}
                  isAdmin={crawlAdmin}
                  onRetryUpload={onRetryCrawlUpload}
                  onClearHistory={onClearCrawlHistory}
                />
              </section>
            )}
            {result && !candidates.length && (
              <section
                data-tab={isComposeResultCard(result) ? "mail" : "result"}
                data-compose-loop={isComposeResultCard(result) ? "true" : undefined}
                aria-selected={primary === "mail" || primary === "result"}
              >
                <GenericResultArtifact
                  card={result}
                  sessionId={sessionId}
                  onPrefill={onPrefill}
                  stacked={isComposeResultCard(result)}
                  collaborationId={collaborationId}
                  handle={handle}
                  onRefresh={onRefresh}
                />
                {draft && isComposeResultCard(result) ? <DraftArtifact card={draft} onRefresh={onRefresh} /> : null}
                {isComposeResultCard(result) ? (
                  <ResultActions
                    actions={composeResultActions(result, result.recommended_actions || result.actions || [])}
                    sessionId={sessionId}
                    onPrefill={onPrefill}
                  />
                ) : null}
              </section>
            )}
            {draft && !(result && isComposeResultCard(result)) && (
              <section data-tab="draft" aria-selected={primary === "draft"}>
                <DraftArtifact card={draft} onRefresh={onRefresh} />
              </section>
            )}
            {stageMsg && (
              <section data-tab="stage" aria-selected={primary === "stage"}>
                <ConfirmStageArtifact payload={stageMsg.payload} sessionId={sessionId} onRefresh={onRefresh} />
              </section>
            )}
            {!stageMsg && draft && draft.targets && draft.targets.length > 0 && (
              <section data-tab="stage" aria-selected={primary === "stage"}>
                <StageFromDraft card={draft} sessionId={sessionId} onRefresh={onRefresh} />
              </section>
            )}
            {inboundMsg && (
              <section data-tab="inbound" aria-selected={primary === "inbound"}>
                <InboundArtifact payload={inboundMsg.payload} onRefresh={onRefresh} />
              </section>
            )}
            {mailMsgs.map((mailRow) => (
              <section key={mailRow.id} data-tab="inbound" aria-selected={primary === "inbound"}>
                <KolMailCard
                  payload={mailRow.payload}
                  sessionId={sessionId}
                  officialStage={officialStage}
                  onRefresh={onRefresh}
                  createdAt={mailRow.created_at}
                  messageId={mailRow.id}
                  showSubject
                  showStage
                />
              </section>
            ))}
            {shipMsg && (
              <section data-tab="ship" aria-selected={primary === "ship"}>
                <SupplementArtifact payload={shipMsg.payload} sessionId={sessionId} onPosted={onPosted} />
              </section>
            )}
            {overdueMsg && (
              <section data-tab="overdue" aria-selected={primary === "overdue"}>
                <OverdueArtifact payload={overdueMsg.payload} />
              </section>
            )}
            {approvalLine && (
              <section data-tab="approval" aria-selected={primary === "approval"}>
                <article className="artifact">
                  <Markdown>
                    {`### 费用审批\n\n${String(approvalLine.payload.text || result?.summary || "请到「工作审批」处理。")}\n\n> 审批人由规则引擎计算。中间档同意不执行副作用。`}
                  </Markdown>
                  {typeof approvalLine.payload.approval_id === "string" && approvalLine.payload.approval_id && (
                    <p><Link to={`/approvals?id=${String(approvalLine.payload.approval_id)}`}>打开工作审批</Link></p>
                  )}
                </article>
              </section>
            )}
          </>
        )}
        {hasRoundResult && result && String(result.title) !== "邮件已发送" && draft?.status !== "sent" && status !== "running" && (
          <p className="muted" data-result-revise-hint>要改这份结果，在下方说明要改哪一段。点芯片或说「再写一封」会开新任务。</p>
        )}
      </div>
      </>}
    </aside>
  );
}
