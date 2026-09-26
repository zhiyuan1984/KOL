import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import {
  api,
  type EmailCard,
  type Message,
  type OperationTraceItem,
  type PendingAsk,
  type ProcessTraceItem,
  type TraceStatus,
} from "../api";
import Markdown from "./Markdown";
import { draftStatusLabel, errorTitle, fieldLabel, friendlyError, stageLabel } from "../labels";
import {
  MISSING_TARGET_STAGE_COPY,
  confirmStageOutcomeCopy,
  type ConfirmStageResult,
} from "../confirmStageFeedback";
import { useViewMode } from "../viewMode";
import { occurredAtMs } from "../mail-time";
import { officialStageReached } from "../journey";
import { MESSAGE_RISK_LABEL, messageRisk, type MessageRisk } from "../agentUx";
import { useConfirmedDraftSend } from "../hooks/useConfirmedDraftSend";
import { applyComposerDraft } from "../composer/draft";

type ThreadRole = "user" | "assistant" | "system";
type ResultShape = "task_result" | "draft" | "confirm" | "send" | "stage";

/** AI Elements Message morphology — role-distinguishable, not a chat-bubble wall. */
function ThreadMessage({
  role,
  result,
  risk,
  children,
  className = "",
  ...attrs
}: {
  role: ThreadRole;
  result?: ResultShape;
  risk?: MessageRisk;
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const bubble = !result && !/\b(error-card|sys-msg)\b/.test(className);
  return (
    <div
      className={[
        "message",
        `is-${role}`,
        bubble && role === "user" ? "bubble me" : "",
        bubble && role === "assistant" ? "bubble assistant" : "",
        result ? "result-card" : "",
        risk ? `risk-${risk.toLowerCase()}` : "",
        className,
      ].filter(Boolean).join(" ")}
      data-role={role}
      data-ai-message
      data-ai-result={result || undefined}
      data-risk={risk}
      {...attrs}
    >
      {risk ? <span className="risk-kicker">{MESSAGE_RISK_LABEL[risk]}</span> : null}
      <div className="message-content">{children}</div>
    </div>
  );
}

type StageTargetOption = {
  code: string;
  label?: string;
  track?: string;
  track_label?: string;
  kind?: string;
  note?: string;
  advancement_mode?: string;
  suggested?: boolean;
};

type StageTrackGroup = { id: string; label: string; items: StageTargetOption[] };

function stageTrackGroups(input: { targets?: StageTargetOption[]; tracks?: StageTrackGroup[] }): StageTrackGroup[] {
  if (Array.isArray(input.tracks) && input.tracks.length) {
    return input.tracks.filter((track) => track.items?.length);
  }
  const buckets = new Map<string, StageTrackGroup>();
  for (const item of input.targets || []) {
    const id = item.track || "main";
    const labelText = item.track_label
      || (id === "branch" ? "分支流程" : id === "exception" ? "异常流程" : "主流程");
    if (!buckets.has(id)) buckets.set(id, { id, label: labelText, items: [] });
    buckets.get(id)!.items.push(item);
  }
  return [...buckets.values()];
}

function StageTrackSelect({
  value,
  onChange,
  groups,
  suggested,
  mail = false,
  disabled = false,
}: {
  value: string;
  onChange: (code: string) => void;
  groups: StageTrackGroup[];
  suggested?: string;
  mail?: boolean;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const items = groups.flatMap((group) => group.items);
  const focusCode = (code: string) => {
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-stage-code="${CSS.escape(code)}"]`)?.focus();
  };
  const selectCode = (code: string) => {
    if (disabled) return;
    onChange(code);
    requestAnimationFrame(() => focusCode(code));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !items.length) return;
    const currentIndex = Math.max(0, items.findIndex((item) => item.code === value));
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectCode(items[(currentIndex + 1) % items.length].code);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectCode(items[(currentIndex - 1 + items.length) % items.length].code);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectCode(items[0].code);
    } else if (event.key === "End") {
      event.preventDefault();
      selectCode(items[items.length - 1].code);
    }
  };
  return (
    <div
      ref={rootRef}
      className="stage-chip-picker"
      data-stage-select
      data-mail-stage-select={mail ? "" : undefined}
      data-value={value}
      role="radiogroup"
      aria-label="目标阶段"
      onKeyDown={onKeyDown}
    >
      {groups.map((group) => (
        <div key={group.id} className="stage-chip-group" data-stage-track={group.id}>
          <p className="stage-chip-group-label">{group.label}</p>
          <div className="stage-chip-row">
            {group.items.map((item) => {
              const selected = item.code === value;
              const isSuggested = item.code === suggested || Boolean(item.suggested);
              return (
                <button
                  key={item.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected || (!value && item.code === items[0]?.code) ? 0 : -1}
                  disabled={disabled}
                  className={`stage-chip${selected ? " is-selected" : ""}${isSuggested ? " is-suggested" : ""}`}
                  data-stage-chip
                  data-stage-code={item.code}
                  onClick={() => selectCode(item.code)}
                >
                  <span className="stage-chip-name">{item.label || stageLabel(item.code)}</span>
                  {isSuggested ? <span className="stage-chip-badge">建议</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function stageOptionNeedsReason(item?: StageTargetOption): boolean {
  return Boolean(item && ["skip", "correct", "exception"].includes(String(item.kind || "")));
}

function StageActionFeedback({ tone, text }: { tone: "info" | "error"; text: string }) {
  if (!text) return null;
  return (
    <div
      className={tone === "error" ? "error" : "muted"}
      data-confirm-stage-feedback
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
    >
      {text}
    </div>
  );
}

function isDuplicateSessionChrome(text: string): boolean {
  const t = String(text || "").trim();
  return /的合作会话。当前阶段：/.test(t)
    || /来信分析只出建议/.test(t)
    || /黄条无确认按钮|正式阶段建议保持/.test(t)
    || /已放到右侧结果/.test(t)
    || /请在右侧结果/.test(t)
    || /已放到右侧[。.]/.test(t)
    || /需要确认阶段时在右侧/.test(t)
    || /只读分析/.test(t) && /右侧/.test(t);
}

export function emailMarkdown(card: EmailCard): string {
  const rows = [
    `| 发件人 | \`${card.from}\` |`,
    `| 收件人 | \`${card.to}\` |`,
    `| 抄送 | \`${card.cc || "—"}\` |`,
    `| 语言 | ${card.lang || "English · 发送为原文"} |`,
    `| 主题 | ${card.subject} |`,
  ];
  if (card.from_locked) rows.push(`| 发件锁定 | ${card.from_lock_text || "已按品牌和权限锁定"} |`);
  if (card.amount_usd != null) {
    rows.push(`| 金额 | ${card.currency || "USD"} ${card.amount_usd}${card.rate_unit === "hour" ? " per hour" : ""} |`);
    if (card.deliverables) rows.push(`| 交付物 | ${card.deliverables} |`);
    if (card.brand) rows.push(`| 品牌 | ${card.brand} |`);
    if (card.cpm != null) rows.push(`| CPM | ${card.cpm} |`);
    if (card.approval_policy) rows.push(`| 审批规则 | ${card.approval_policy} |`);
  }
  rows.push(`| 状态 | ${draftStatusLabel(card.status)} |`);
  const lines = [
    "### 英文原文草稿",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    ...rows,
    "",
    "```",
    card.body || "",
    "```",
  ];
  if (card.footer && !/正式阶段|发送\s*≠|发送不等于/.test(card.footer)) {
    lines.push("", `> ${card.footer}`);
  }
  return lines.join("\n");
}

function knowledgeChipText(card: EmailCard): string {
  const id = String(card.knowledge_id || "").trim();
  if (!id) return "";
  const title = String(card.knowledge_title || "").trim() || `#${id}`;
  const version = card.knowledge_version == null ? "" : ` v${card.knowledge_version}`;
  return `模板：${title}${version}`;
}

function DraftSendMeta({
  card,
  from,
  to,
  cc,
  subject,
}: {
  card: EmailCard;
  from: string;
  to: string;
  cc: string;
  subject: string;
}) {
  const rows: { key: string; label: string; value: string; chips?: string[] }[] = [
    { key: "from", label: "发件人", value: from || "—" },
    { key: "to", label: "收件人", value: to || "—" },
  ];
  if (cc) rows.push({ key: "cc", label: "抄送", value: cc });
  rows.push({ key: "subject", label: "主题", value: subject || "未指定" });
  const statusChips = [draftStatusLabel(card.status)];
  if (card.from_locked) statusChips.push(card.from_lock_text || "已锁定");
  rows.push({ key: "status", label: "状态", value: "", chips: statusChips });
  const knowledgeChip = knowledgeChipText(card);
  return (
    <dl className="draft-send-meta" data-draft-send-meta>
      {rows.map((row) => (
        <div key={row.key} data-draft-meta={row.key}>
          <dt>{row.label}</dt>
          <dd>
            {row.chips?.length
              ? row.chips.map((chip) => <span key={chip} className="chip">{chip}</span>)
              : row.value}
          </dd>
        </div>
      ))}
      {knowledgeChip ? (
        <div data-draft-meta="knowledge">
          <dt>模板</dt>
          <dd><span className="chip" data-draft-knowledge>{knowledgeChip}</span></dd>
        </div>
      ) : null}
    </dl>
  );
}

function pickFromAddr(from: string, opts: { email: string }[]): string {
  if (!opts.length) return String(from || "").trim();
  const wanted = String(from || "").trim().toLowerCase();
  const matched = opts.find((row) => row.email.toLowerCase() === wanted)?.email;
  if (matched) return matched;
  return opts.length === 1 ? opts[0].email : "";
}

function usableInternalZh(zh: string | undefined, english: string): string | null {
  const text = String(zh || "").trim();
  if (!text) return null;
  const stripped = text.replace(/^【内部中文译稿[^\n]*】\s*/u, "").trim();
  const cjk = (stripped.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk < 8) return null;
  if (english.trim() && stripped.replace(/\s+/g, " ") === english.trim().replace(/\s+/g, " ")) return null;
  return text;
}

export function DraftArtifact({
  card,
  onRefresh,
}: {
  card: EmailCard;
  onRefresh: () => void;
}) {
  const [zh, setZh] = useState<string | null>(() => usableInternalZh(card.body_zh_internal, card.body || ""));
  const [cc, setCc] = useState(card.cc || "");
  const opts = card.allowed_from_mailboxes || [];
  const [fromAddr, setFromAddr] = useState(() => pickFromAddr(card.send_from || card.from, opts));
  const [toAddr, setToAddr] = useState(card.to || "");
  const [subject, setSubject] = useState(card.subject || "");
  const [body, setBody] = useState(card.body || "");
  const [err, setErr] = useState(card.send_error || "");
  const [busy, setBusy] = useState<string | null>(null);
  const confirmedSend = useConfirmedDraftSend(onRefresh);
  const sent = card.status === "sent" || !!card.send_disabled;
  const knowledgeChip = knowledgeChipText(card);
  const resolvedFrom = pickFromAddr(fromAddr, opts);
  const fromOptionsKey = opts.map((row) => row.email).join("|");
  const dirty = cc !== (card.cc || "")
    || resolvedFrom !== pickFromAddr(card.send_from || card.from, opts)
    || toAddr !== (card.to || "")
    || subject !== (card.subject || "")
    || body !== (card.body || "");
  const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e);

  useEffect(() => {
    setCc(card.cc || "");
    setFromAddr(pickFromAddr(card.send_from || card.from, card.allowed_from_mailboxes || []));
    setToAddr(card.to || "");
    setSubject(card.subject || "");
    setBody(card.body || "");
    setErr(card.send_error || "");
    const nextZh = usableInternalZh(card.body_zh_internal, card.body || "");
    if (nextZh) setZh(nextZh);
  }, [card.draft_id, card.cc, card.from, card.send_from, card.to, card.subject, card.body, card.send_error, card.body_zh_internal, fromOptionsKey]);

  const persist = async () => {
    await api.patchDraft(card.draft_id, {
      cc,
      from_addr: resolvedFrom,
      to_addr: toAddr,
      subject,
      body_en: body,
    });
  };

  const translate = async () => {
    setBusy("tr");
    setErr("");
    try {
      if (dirty) await persist();
      const r = await api.translate(card.draft_id);
      setZh(r.zh);
      onRefresh();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (sent || !dirty) return;
    setBusy("save");
    setErr("");
    try {
      await persist();
      onRefresh();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const requestSend = () => {
    if (card.send_disabled || busy || confirmedSend.busy) return;
    // Normalized From is saved before showing the exact server-owned snapshot.
    void confirmedSend.requestSend(card.draft_id, async () => { await persist(); });
  };

  return (
    <article className="artifact" data-kind="email-card" data-status={card.status} data-card-id={card.draft_id}>
      {sent ? (
        <div className="draft-editor" data-draft-sent>
          <div className="page-kicker">邮件草稿</div>
          <DraftSendMeta card={card} from={fromAddr} to={toAddr} cc={cc} subject={subject} />
          <pre className="mail-body-text">{body}</pre>
        </div>
      ) : (
        <div className="draft-editor">
          <div className="page-kicker">邮件草稿</div>
          <div className="draft-status-row" data-draft-status>
            <span className="chip">{draftStatusLabel(card.status)}</span>
            {card.from_locked ? <span className="chip">{card.from_lock_text || "已锁定"}</span> : null}
            {knowledgeChip ? <span className="chip" data-draft-knowledge>{knowledgeChip}</span> : null}
          </div>
          {card.amount_usd != null && (
            <p className="draft-meta" data-draft-amount data-compose-amount>
              金额 {card.currency || "USD"} {card.amount_usd}{card.rate_unit === "hour" ? " per hour" : ""}
              {card.deliverables ? ` · ${card.deliverables}` : ""}
              {card.brand ? ` · ${card.brand}` : ""}
            </p>
          )}
          <label className="draft-field">
            <span>发件人</span>
            {opts.length > 1 ? (
              <select disabled={!!busy || confirmedSend.busy} value={resolvedFrom} onChange={(e) => setFromAddr(e.target.value)} data-from-select>
                {opts.map((o) => (
                  <option key={o.email} value={o.email}>
                    {o.brand} · {o.email}
                  </option>
                ))}
              </select>
            ) : (
              <span className="mono draft-static">
                {resolvedFrom || "—"}
                {card.from_locked && <em className="lock"> {card.from_lock_text || "已锁定"}</em>}
              </span>
            )}
          </label>
          <label className="draft-field">
            <span>收件人</span>
            <input disabled={!!busy || confirmedSend.busy} value={toAddr} onChange={(e) => setToAddr(e.target.value)} placeholder="收件邮箱" data-draft-to />
          </label>
          <label className="draft-field">
            <span>抄送</span>
            <input disabled={!!busy || confirmedSend.busy} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="上级 / 同站点 / 相关同事" />
          </label>
          <label className="draft-field">
            <span>主题</span>
            <input
              value={subject}
              disabled={!!busy || confirmedSend.busy}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="邮件主题"
              data-draft-subject
            />
          </label>
          <label className="draft-field">
            <span>正文</span>
            <textarea
              value={body}
              disabled={!!busy || confirmedSend.busy}
              onChange={(e) => setBody(e.target.value)}
              placeholder="英文原文"
              rows={12}
              data-draft-body
            />
          </label>
        </div>
      )}
      {zh && (
        <div className="zh" data-draft-zh>
          <div className="page-kicker">内部中文（不进 SMTP）</div>
          <div className="zh-body">{zh}</div>
        </div>
      )}
      {card.knowledge_id ? <p className="muted" data-draft-template-source title={card.knowledge_id}>模板来源：知识库 · 第 {card.knowledge_version} 版</p> : null}
      <div className="action-row">
        {!sent && (
          <button className="btn ghost" data-draft-save onClick={() => void save()} disabled={!!busy || confirmedSend.busy || !dirty}>
            保存草稿
          </button>
        )}
        <button className="btn ghost" data-email-action="translate" onClick={() => void translate()} disabled={!!busy || confirmedSend.busy}>
          一键翻译中文（内部）
        </button>
        <button className="btn work" data-email-action="send" onClick={requestSend} disabled={!!busy || confirmedSend.busy || !!card.send_disabled || !resolvedFrom.trim() || !toAddr.trim()}>
          确认发送
        </button>
      </div>
      {card.send_disabled && <p className="muted">发送已禁用</p>}
      {!resolvedFrom.trim() && !card.send_disabled && <p className="muted">请先选择发件邮箱。没有明确绑定时不会自动选择邮箱。</p>}
      {!toAddr.trim() && !card.send_disabled && <p className="muted">请先填写收件邮箱。不能解密或编造联系方式。</p>}
      {(err || confirmedSend.error) && (
        <div className="error" data-persistent-error>
          {err || confirmedSend.error}
        </div>
      )}
      {confirmedSend.dialog}
    </article>
  );
}

export function ConfirmStageArtifact({
  payload,
  sessionId,
  onRefresh,
}: {
  payload: Record<string, unknown>;
  sessionId: string;
  onRefresh: () => void;
}) {
  const targets = (payload.targets as StageTargetOption[]) || [];
  const groups = stageTrackGroups({ targets, tracks: payload.tracks as StageTrackGroup[] | undefined });
  const suggested = String(payload.proposed_stage || "");
  const [code, setCode] = useState(() => (
    suggested && targets.some((item) => item.code === suggested) ? suggested : (targets[0]?.code || "")
  ));
  const [reason, setReason] = useState(() => String(payload.reason || ""));
  const [reasonCode, setReasonCode] = useState("HUMAN_CONFIRMED");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const closed = Boolean(payload.locked || payload.resolved || payload.rejected);
  const currentLabel = stageLabel(String(payload.current_stage || ""), String(payload.current_label || "")) || String(payload.current_label || payload.current_stage || "未指定");
  const next = targets.find((item) => item.code === code);
  const nextLabel = next ? (next.label || stageLabel(next.code)) : "";
  const confirm = async () => {
    setErr("");
    setNotice("");
    if (!code) {
      setErr(MISSING_TARGET_STAGE_COPY);
      return;
    }
    if (stageOptionNeedsReason(next) && !reason.trim()) {
      setErr("跳过、纠正或进入异常必须填写原因");
      return;
    }
    setBusy(true);
    try {
      const result = await api.confirmSessionStage(sessionId, {
        stage_code: code,
        collaboration_id: payload.collaboration_id,
        expected_version: payload.expected_version,
        reason,
        reason_code: next?.kind === "correct" ? "STAGE_CORRECTION" : next?.kind === "skip" ? "SKIP_AHEAD" : reasonCode,
        evidence: { source: "stage_workbench", note: reason, kind: next?.kind, track: next?.track },
        recommender: "Commander",
      }) as ConfirmStageResult;
      const outcome = confirmStageOutcomeCopy(result);
      if (outcome.tone === "error") setErr(outcome.text);
      else setNotice(outcome.text);
      onRefresh();
    } catch (e) {
      setErr(friendlyError(e, "阶段确认未完成，请稍后重试"));
    } finally {
      setBusy(false);
    }
  };
  const md = [
    "### 记状态 / 确认阶段",
    "",
    `当前：**${stageLabel(String(payload.current_stage || ""), String(payload.current_label || ""))}**`,
    "",
    "> 系统只建议阶段。确认卡按**主流程 / 分支流程 / 异常流程**列出可选项，由你选定**具体正式阶段**后再确认，不能用「下一阶段」。不寄样或纠正记错请填写原因。必须审批的阶段会进入工作审批。本路径不出邮件、不发信。",
  ].join("\n");
  const reject = async () => {
    setErr("");
    setNotice("");
    if (!reason.trim()) {
      setErr("驳回必须填写备注");
      return;
    }
    setBusy(true);
    try {
      await api.confirmSessionStage(sessionId, {
        rejected: true,
        reason,
        collaboration_id: payload.collaboration_id,
      });
      onRefresh();
    } catch (e) {
      setErr(friendlyError(e, "驳回未完成，请稍后重试"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="artifact risk-l3" data-kind="confirm-stage-card" data-risk="L3">
      <span className="risk-kicker">{MESSAGE_RISK_LABEL.L3}</span>
      <Markdown>{md}</Markdown>
      <div className="stage-diff" data-stage-diff>
        <div className="diff-from">变更前：{currentLabel}</div>
        <div className="diff-to">变更后：{nextLabel || "请选择具体目标阶段"}</div>
      </div>
      {payload.rejected ? <p className="muted" data-stage-rejected>已驳回，正式阶段未改。</p> : null}
      {payload.resolved && !payload.rejected ? <p className="muted" data-stage-resolved>已按确认写入正式阶段。</p> : null}
      <StageTrackSelect value={code} onChange={setCode} groups={groups} suggested={suggested} disabled={closed || busy} />
      <div className="action-row">
        <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} data-reason-code disabled={closed || busy}>
          <option value="HUMAN_CONFIRMED">人工确认</option>
          <option value="REPLY_EVIDENCE">回复证据</option>
          <option value="SKIP_AHEAD">跳过中间阶段</option>
          <option value="STAGE_CORRECTION">纠正记错</option>
          <option value="LOGISTICS_FACT">物流事实</option>
          <option value="PLATFORM_FACT">平台事实</option>
          <option value="FINANCE_APPROVED">财务审批</option>
        </select>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="证据 / 沟通记录" disabled={closed || busy} />
        <button
          className="btn work"
          type="button"
          data-confirm-stage
          onClick={() => void confirm()}
          disabled={closed || busy}
          title={!code && !closed ? MISSING_TARGET_STAGE_COPY : undefined}
        >
          {busy ? "正在写入…"
            : /必须审批|必须审核|审核通过后推进|财务事实/.test(targets.find((item) => item.code === code)?.advancement_mode || "")
              ? "提交审批"
              : "确认写入正式阶段"}
        </button>
        <button className="btn ghost" type="button" data-reject-stage onClick={() => void reject()} disabled={closed || busy}>
          驳回
        </button>
      </div>
      {!code && !closed ? <StageActionFeedback tone="error" text={MISSING_TARGET_STAGE_COPY} /> : null}
      {err && err !== MISSING_TARGET_STAGE_COPY ? <StageActionFeedback tone="error" text={err} /> : null}
      {!err && notice ? <StageActionFeedback tone="info" text={notice} /> : null}
    </article>
  );
}

export function SupplementArtifact({
  payload,
  sessionId,
  onPosted,
}: {
  payload: Record<string, unknown>;
  sessionId: string;
  onPosted: (msgs: Message[]) => void;
}) {
  const fields = (payload.fields as { key: string; label: string; required: boolean; value: string }[]) || [];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value || ""])));
  const intent = String(payload.intent || "ship_notice");
  const go = async () => {
    const handleValue = (vals.handle || String(payload.handle || "")).replace(/^@/, "").trim();
    const to = String(vals.to || "").trim();
    const text = intent === "business_approval"
      ? `费用审批 ${vals.amount || ""} ${vals.currency || ""}`.trim()
      : intent === "content_nudge"
      ? (handleValue ? `给@${handleValue} 催大纲` : "催大纲")
      : to
        ? (handleValue ? `给@${handleValue} ${intent === "kol" ? "KOL 建联发信" : "写跟进邮件"} ${to}` : `${intent} ${to}`)
      : `给${payload.handle ? `@${payload.handle}` : ""} 发货通知 运单号 ${vals.tracking || ""} 承运商 ${vals.carrier || ""} ETA ${vals.eta || ""}`;
    const r = await api.postMessage(sessionId, {
      text,
      intent,
      collaboration_id: payload.collaboration_id as string,
    });
    onPosted(r.messages);
  };
  const heading = String(payload.title || (String(payload.intent) === "content_nudge"
    ? "补全催大纲对象"
    : String(payload.intent) === "business_approval"
      ? "还需要金额和币种"
      : "补全发货信息"));
  return (
    <article className="artifact" data-kind="supplement-card">
      <Markdown>{`### ${heading}\n\n${String(payload.message || "")}`}</Markdown>
      <div className="action-row">
        {fields.map((f) => (
          <input
            key={f.key}
            data-supplement-field={f.key}
            value={vals[f.key] || ""}
            placeholder={`${f.label}${f.required ? " *" : ""}`}
            onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
          />
        ))}
        <button className="btn work" onClick={go}>
          {intent === "business_approval" ? "继续提交" : "提交后起箱"}
        </button>
      </div>
    </article>
  );
}

export function InboundArtifact({ payload, onRefresh }: { payload: Record<string, unknown>; onRefresh: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; handle: string }[]>([]);
  const id = String(payload.inbound_id);
  const cands = (payload.candidates as { id: string; handle: string; score?: number }[]) || [];
  const md = [
    "### 未绑定来信",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    `| 发件人 | ${String(payload.from_name || "")} |`,
    `| 邮箱 | ${String(payload.email || payload.from)} |`,
    `| 主题 | ${String(payload.subject)} |`,
    `| 时间 | ${String(payload.time)} |`,
    "",
    String(payload.summary || ""),
    "",
    "候选 KOL（不自动合并）：",
    ...cands.map((c) => `- @${c.handle}${c.score != null ? ` · ${c.score}` : ""}`),
  ].join("\n");
  return (
    <article className="artifact" data-kind="inbound-card">
      <Markdown>{md}</Markdown>
      <div className="action-row">
        {cands.map((c) => (
          <button key={c.id} className="btn ghost" onClick={() => api.inboundBind(id, c.id).then(onRefresh)}>
            绑定 @{c.handle}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索达人" />
        <button className="btn ghost" onClick={() => api.inboundSearch(id, q).then((r) => setHits(r.kols || []))}>
          搜索
        </button>
        <button className="btn" onClick={() => api.inboundCreate(id, q || "新来信达人").then(onRefresh)}>
          新建合作
        </button>
        {payload.deferred
          ? (
            <button className="btn" onClick={() => api.inboundResume(id).then(onRefresh)}>
              恢复
            </button>
          )
          : (
            <button className="btn ghost" onClick={() => api.inboundDefer(id).then(onRefresh)}>
              暂缓
            </button>
          )}
        {hits.map((h) => (
          <button key={h.id} className="btn ghost" onClick={() => api.inboundBind(id, h.id).then(onRefresh)}>
            绑 @{h.handle}
          </button>
        ))}
      </div>
    </article>
  );
}

export function OverdueArtifact({ payload }: { payload: Record<string, unknown> }) {
  const items = (payload.items as { title: string; meta?: string }[]) || [];
  const md = [`### ${String(payload.title || "在途")}`, "", ...items.map((it) => `- \`${it.title}\`${it.meta ? ` · ${it.meta}` : ""}`)].join(
    "\n",
  );
  return (
    <article className="artifact" data-kind="overdue-list">
      <Markdown>{md}</Markdown>
    </article>
  );
}

function isBoxSteps(m: Message): boolean {
  return m.kind === "steps" && String(m.payload.title || "").includes("箱内");
}

function isOverdueSteps(m: Message): boolean {
  return m.kind === "steps" && String(m.payload.title || "").includes("失联");
}

function safeStatus(status: unknown): TraceStatus {
  const value = String(status || "pending").toLowerCase();
  if (["complete", "completed", "success", "succeeded"].includes(value)) return "done";
  if (["error", "errored"].includes(value)) return "failed";
  if (["active", "in_progress", "processing"].includes(value)) return "running";
  if (["done", "failed", "running", "skipped"].includes(value)) return value as TraceStatus;
  return "pending";
}

function tryParseJson(text: string): unknown | null {
  const raw = String(text || "").trim();
  if (!raw || (raw[0] !== "{" && raw[0] !== "[")) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tryParseJsonFrom(src: string, start: number): { value: unknown; end: number } | null {
  const open = src[start];
  if (open !== "{" && open !== "[") return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const slice = src.slice(start, i + 1);
        const value = tryParseJson(slice);
        return value == null ? null : { value, end: i + 1 };
      }
    }
  }
  return null;
}

function extractJsonValues(text: string): unknown[] {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!raw) return [];
  const values: unknown[] = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && raw[i] !== "{" && raw[i] !== "[") i += 1;
    if (i >= raw.length) break;
    const parsed = tryParseJsonFrom(raw, i);
    if (!parsed) break;
    values.push(parsed.value);
    i = parsed.end;
  }
  return values;
}

function extractJsonBlob(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && tryParseJson(fence[1].trim())) return fence[1].trim();
  if (tryParseJson(raw)) return raw;
  const values = extractJsonValues(raw);
  if (values.length === 1) return JSON.stringify(values[0]);
  if (values.length > 1) return raw.slice(raw.indexOf("{") >= 0 ? raw.indexOf("{") : raw.indexOf("["));
  return null;
}

function isTaskResultPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const type = String(row.type || "");
  if (type === "task_result" || type === "email_card") return true;
  return Boolean(row.title && (row.summary || row.subject || row.body || row.sections || row.draft));
}

function humanizeJsonValue(value: unknown, depth = 0): string {
  if (value == null || depth > 3) return "";
  if (typeof value === "string") {
    const nested = tryParseJson(value);
    return nested == null ? value : humanizeJsonValue(nested, depth + 1);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => humanizeJsonValue(item, depth + 1)).filter(Boolean).slice(0, 8).join("；");
  }
  if (typeof value === "object") {
    const skip = /^(id|tool_call_id|call_id|run_id|span_id|trace_id|raw|debug|payload)$/i;
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !skip.test(key))
      .map(([key, item]) => {
        const next = humanizeJsonValue(item, depth + 1);
        return next ? `${fieldLabel(key)}：${next}` : "";
      })
      .filter(Boolean)
      .slice(0, 8)
      .join("；");
  }
  return "";
}

function humanizeMaybeJson(text: string, fallback = "正在处理"): string {
  const blob = extractJsonBlob(text);
  const parsed = blob ? tryParseJson(blob) : null;
  if (parsed == null) return text;
  return humanizeJsonValue(parsed) || fallback;
}

function jsonFieldRows(value: unknown): { label: string; value: string }[] {
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item, index) => ({
      label: `步骤 ${index + 1}`,
      value: humanizeJsonValue(item),
    })).filter((row) => row.value);
  }
  if (value && typeof value === "object") {
    const skip = /^(id|tool_call_id|call_id|run_id|span_id|trace_id|raw|debug|payload)$/i;
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !skip.test(key))
      .map(([key, item]) => ({ label: fieldLabel(key), value: humanizeJsonValue(item) }))
      .filter((row) => row.value)
      .slice(0, 10);
  }
  const text = humanizeJsonValue(value);
  return text ? [{ label: "说明", value: text }] : [];
}

function looksLikeInferenceJson(text: string): boolean {
  const values = extractJsonValues(text);
  if (values.some(isTaskResultPayload)) return true;
  const blob = extractJsonBlob(text);
  if (!blob) return false;
  const ratio = blob.length / Math.max(String(text || "").trim().length, 1);
  return ratio >= 0.5 || /^```/.test(String(text || "").trim()) || Boolean(tryParseJson(String(text || "").trim()));
}

export function taskResultCardsFrom(text: string): Record<string, unknown>[] {
  return extractJsonValues(text).flatMap((value) => {
    if (isTaskResultPayload(value)) return [value];
    if (Array.isArray(value)) return value.filter(isTaskResultPayload);
    return [];
  });
}

export function resultCardsFromMessages(messages: Message[]): Record<string, unknown>[] {
  return messages.flatMap((message) => {
    if (message.kind === "task_result_card") return [message.payload];
    return taskResultCardsFrom(String(message.payload.text || ""));
  });
}

export function ResultDraftPreview({ card, onRefresh }: { card: Record<string, unknown>; onRefresh?: () => void }) {
  const nested = card.draft && typeof card.draft === "object" ? card.draft as Record<string, unknown> : {};
  const subject = String(card.subject || nested.subject || "").trim();
  const body = String(card.body || nested.body || "").trim();
  const from = String(card.from || nested.from || "").trim();
  const to = String(card.to || nested.to || "").trim();
  const draftId = String(card.draft_id || nested.draft_id || "").trim();
  const actions = (Array.isArray(card.actions) ? card.actions : Array.isArray(card.recommended_actions) ? card.recommended_actions : [])
    .map((item) => typeof item === "string" ? item : String((item as { label?: string }).label || (item as { title?: string }).title || ""))
    .filter(Boolean);
  const confirmedSend = useConfirmedDraftSend(onRefresh);
  const busy = confirmedSend.busy;
  const err = confirmedSend.error;
  const locked = Boolean(card.send_disabled || nested.send_disabled || ["sent", "sending", "send_unknown"].includes(String(card.status || nested.status || "")));
  const requestSend = () => { if (!locked) void confirmedSend.requestSend(draftId); };
  if (!from && !to && !subject && !body && !draftId && !actions.some((item) => /确认发送/.test(item))) return null;
  return (
    <div className="result-draft-preview" data-result-draft>
      {from ? <p data-result-from>发件 {from}</p> : null}
      {to ? <p data-result-to>收件 {to}</p> : null}
      {subject ? <p data-draft-subject>主题 {subject}</p> : null}
      {body ? <pre className="mail-body-text" data-result-body>{body}</pre> : null}
      {!locked && (draftId || actions.some((item) => /确认发送/.test(item))) ? (
        <div className="action-row">
          <button
            type="button"
            className="btn work"
            data-email-action="send"
            onClick={requestSend}
            disabled={busy || !draftId}
          >
            {busy ? "正在发送…" : "确认发送"}
          </button>
        </div>
      ) : null}
      {err ? <p className="error" data-persistent-error>{err}</p> : null}
      {confirmedSend.dialog}
    </div>
  );
}

function StreamResultCard({ card, onRefresh }: { card: Record<string, unknown>; onRefresh?: () => void }) {
  const title = String(card.title || "任务结果");
  const summary = String(card.summary || "");
  const sections = Array.isArray(card.sections) ? card.sections as Record<string, unknown>[] : [];
  return (
    <article className="stream-task-result" data-kind="task-result-card" data-stream-result>
      <strong>{title}</strong>
      {summary ? <p>{summary}</p> : null}
      <ResultDraftPreview card={card} onRefresh={onRefresh} />
      {sections.map((section, index) => {
        const heading = String(section.title || section.heading || "");
        const content = String(section.content || section.body || section.summary || "");
        if (!heading && !content) return null;
        return (
          <section key={`${heading}-${index}`}>
            {heading ? <h4>{heading}</h4> : null}
            {content ? <p>{content}</p> : null}
          </section>
        );
      })}
    </article>
  );
}

function HumanizedInference({ text, debug = false, onRefresh }: { text: string; debug?: boolean; onRefresh?: () => void }) {
  const cards = taskResultCardsFrom(text);
  if (cards.length) {
    return (
      <div data-humanized-inference>
        {cards.map((card, index) => <StreamResultCard key={`${String(card.title || "result")}-${index}`} card={card} onRefresh={onRefresh} />)}
        {debug ? (
          <details className="execution-details">
            <summary>调试原文</summary>
            <pre className="inference-debug-json">{text}</pre>
          </details>
        ) : null}
      </div>
    );
  }
  const blob = extractJsonBlob(text);
  const parsed = blob ? tryParseJson(blob) : null;
  if (parsed == null) {
    const cleaned = stripEngineCopy(text);
    if (!debug && /[{[]/.test(cleaned)) return <p>正在整理结果</p>;
    return <Markdown>{cleaned}</Markdown>;
  }
  if (!debug) {
    const title = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? String((parsed as Record<string, unknown>).title || (parsed as Record<string, unknown>).summary || "")
      : "";
    return <p>{title && /[\u4e00-\u9fff]/.test(title) ? title : "正在整理结果"}</p>;
  }
  const rows = jsonFieldRows(parsed);
  return (
    <div data-humanized-inference>
      {rows.length ? (
        <dl className="inference-fields">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>正在处理这项工作</p>
      )}
      {blob ? (
        <details className="execution-details">
          <summary>调试原文</summary>
          <pre className="inference-debug-json">{blob}</pre>
        </details>
      ) : null}
    </div>
  );
}

const TRACE_LABELS: Record<string, string> = {
  creator_discovery: "正在检查达人信息",
  lead: "正在查看最近沟通",
  commander: "正在分析合作历史",
  execution: "正在生成建议",
  kol: "正在准备达人建联",
  pipeline_review: "正在复盘流水线",
  "preparing skill execution": "正在准备这项工作",
  "preparing parallel execution": "正在同时处理几项工作",
  "evaluating mailbox call strategy": "正在选择发件方式",
  "preparing stage recommendation json": "正在整理阶段建议",
  "handling draft preview failure": "邮件预览未完成",
  "preparing skill": "正在准备这项工作",
  "preparing task": "准备任务",
  "calling capabilities": "正在调用系统能力",
  calling: "正在调用系统能力",
  queued: "已排队",
  pending: "已排队",
  running: "进行中",
  in_progress: "进行中",
  "远程mcp调用": "正在调用系统能力",
};

const TOOL_LABELS: Record<string, string> = {
  get_collaboration: "读取合作资料",
  previewemaildraft: "生成邮件预览",
  pageriskconversations: "查询风险会话",
  summarizeriskconversations: "汇总风险会话",
  pagekolprofiles: "查询红人资料",
  getcreator: "查询达人详情",
  updatecreatorprofile: "更新达人画像",
  sendemaildraft: "发送邮件草稿",
  "claw.start_crawl": "启动远程采集",
  "claw.get_crawl_status": "查询远程采集状态",
  "claw.stop_crawl": "停止远程采集",
};

function humanizeToolName(name: string) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const short = raw.replace(/^(starrykol|starry)\./i, "");
  return TOOL_LABELS[raw.toLowerCase()]
    || TOOL_LABELS[short.toLowerCase()]
    || (/[\u4e00-\u9fff]/.test(short) ? short : "");
}

function stripEngineCopy(text: string) {
  return String(text || "")
    .replace(/\b(?:starrykol|starry)\.[A-Za-z0-9_.]+\b/g, "")
    .replace(/\b(?:MCP|Codex|Thread|Skill)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isToolId(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/\b(?:starrykol|starry)\./i.test(raw)) return true;
  if (/^[a-z]+(?:[A-Z][a-zA-Z]+)+$/.test(raw)) return true;
  if (/^[a-z]+_[a-z0-9_]+$/i.test(raw) && !/[\u4e00-\u9fff]/.test(raw)) return true;
  return false;
}

function isHarnessLabel(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (/preparing |evaluating |handling |calling capabilities|parallel execution|skill execution|mailbox call|stage recommendation|draft preview/i.test(raw)) return true;
  if (/\b(?:mcp|codex|thread|skill)\b/i.test(raw) && !/[\u4e00-\u9fff]/.test(raw)) return true;
  if (/\b(?:starrykol|starry)\./i.test(raw)) return true;
  if (isToolId(raw)) return true;
  return false;
}

function humanizeOneLabel(raw: string) {
  const text = raw.trim();
  if (!text) return "";
  const fromJson = humanizeMaybeJson(text, "");
  if (fromJson && fromJson !== text && !/[{[]/.test(fromJson)) return fromJson;
  const mapped = TRACE_LABELS[text.toLowerCase()];
  if (mapped) return mapped;
  if (/preparing skill/i.test(text)) return "正在准备这项工作";
  if (/parallel execution/i.test(text)) return "正在同时处理几项工作";
  if (/mailbox call/i.test(text)) return "正在选择发件方式";
  if (/stage recommendation/i.test(text)) return "正在整理阶段建议";
  if (/draft preview/i.test(text)) return "邮件预览未完成";
  if (/calling capabilities|remote mcp/i.test(text)) return "正在调用系统能力";
  const tool = humanizeToolName(text);
  if (tool) return tool;
  if (/[\u4e00-\u9fff]/.test(text)) return text.replace(/\b(?:starrykol|starry)\.[A-Za-z0-9_.]+\b/g, "").trim();
  if (/^[a-z0-9_.:/-]+$/i.test(text) || /\b(skill|mcp|codex|thread|json)\b/i.test(text) || isToolId(text)) return "正在处理这项工作";
  return /[\u4e00-\u9fff]/.test(text) ? text : "正在处理这项工作";
}

function humanizeTraceLabel(label: string) {
  const raw = label.trim();
  if (!raw) return "正在处理";
  const parts = raw.split(/\s*[·•|/]\s*/).map((item) => item.trim()).filter(Boolean);
  if (parts.length > 1) {
    const humans = parts.map(humanizeOneLabel).filter((item) => item && !isToolId(item));
    const unique = [...new Set(humans)];
    return unique[0] || "正在处理这项工作";
  }
  return humanizeOneLabel(raw) || "正在处理这项工作";
}

export function employeeProcessLabel(raw: string) {
  const human = stripEngineCopy(humanizeTraceLabel(raw));
  if (!human || /[{[]/.test(human) || isHarnessLabel(human) || /\b(?:starrykol|starry)\./i.test(human)) {
    return "正在处理这项工作";
  }
  return human;
}

function looksLikeJsonLabel(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/^```/.test(raw)) return true;
  return (raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"));
}

/** Reasoning summaries are user-visible prose — do not force「正在处理这项工作」. */
export function employeeReasoningLabel(raw: string) {
  const text = String(raw || "").trim();
  if (!text || looksLikeJsonLabel(text) || looksLikeInferenceJson(text)) return "正在分析…";
  const cleaned = stripEngineCopy(text.replace(/\b(?:reasoning|rsn):[A-Za-z0-9_-]+\b/gi, ""));
  if (!cleaned || looksLikeJsonLabel(cleaned) || /[{[]/.test(cleaned)) return "正在分析…";
  // Employee copy (04 / UX-EMPLOYEE): a jargon-only title is not a summary. Keep real prose.
  if (isHarnessLabel(cleaned) || isToolId(cleaned) || /^[a-z0-9_.:/-]+$/i.test(cleaned)) return "正在分析…";
  return cleaned;
}

export function employeeTraceLabel(raw: string, kind?: string) {
  return kind === "reasoning" ? employeeReasoningLabel(raw) : employeeProcessLabel(raw);
}

function employeeMessageBody(text: string, debug = false, onRefresh?: () => void) {
  if (looksLikeInferenceJson(text) || taskResultCardsFrom(text).length) {
    return <HumanizedInference text={text} debug={debug} onRefresh={onRefresh} />;
  }
  const cleaned = stripEngineCopy(humanizeMaybeJson(text));
  if (!debug && /[{[]/.test(cleaned)) return <p>正在整理结果</p>;
  return <Markdown>{cleaned}</Markdown>;
}

export { humanizeTraceLabel };

function statusMark(status: TraceStatus) {
  if (status === "done") return "✓";
  if (status === "failed") return "!";
  if (status === "skipped") return "–";
  return status === "running" ? "…" : "○";
}

function traceItems(payload: Record<string, unknown>): ProcessTraceItem[] {
  const source = payload.phases || payload.items || [];
  return Array.isArray(source)
    ? source.map((item) => typeof item === "string" ? { label: item, status: "done" } : item as ProcessTraceItem)
    : [];
}

function summaryLines(payload: Record<string, unknown>, items: ProcessTraceItem[]): string[] {
  const supplied = payload.summaries || payload.reasoning_summaries || payload.analysis_summaries;
  const summaries = Array.isArray(supplied) ? supplied.filter((line): line is string => typeof line === "string") : [];
  const fromItems = items
    .filter((item) => item.kind === "reasoning" || Boolean(item.summary || item.reasoning_summary))
    .map((item) => item.summary || item.reasoning_summary || String(item.label || ""))
    .filter((line): line is string => Boolean(line) && line !== "正在分析…");
  const seen = new Set(items.map((item) => String(item.label || "").trim()).filter(Boolean));
  return [...summaries, ...fromItems].filter((line) => {
    const text = line.trim();
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

function operationParts(operation: OperationTraceItem, index: number): { human: string; name: string } {
  const tool = typeof operation.tool === "object" ? operation.tool : null;
  const name = String(operation.name || tool?.name || operation.tool || "").trim();
  const rawHuman = String(operation.tool_label || operation.label || tool?.label || "").trim();
  const human = humanizeTraceLabel(rawHuman || humanizeToolName(name) || `系统能力 ${index + 1}`);
  return { human, name };
}

const LEGACY_PHASE_OPERATIONS = new Set([
  "准备任务上下文",
  "加载任务规则",
  "读取业务数据",
  "生成结构化结果",
  "校验输出结果",
]);

function isLegacyPhaseOperation(operation: OperationTraceItem, legacyTrace: boolean): boolean {
  const tool = typeof operation.tool === "object" ? operation.tool : null;
  const name = String(operation.name || tool?.name || operation.tool || "");
  if (name.startsWith("phase:")) return true;
  const label = String(operation.tool_label || operation.label || tool?.label || "");
  return legacyTrace && !name && LEGACY_PHASE_OPERATIONS.has(label);
}

function formatMailTime(value: unknown): string {
  const ms = occurredAtMs(value);
  return ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "";
}

function mailCardTime(payload: Record<string, unknown>, fallback?: string): string {
  return formatMailTime(payload.occurred_at || payload.sentAt || payload.sendTime || payload.receivedAt)
    || formatMailTime(fallback)
    || "";
}

function replySubjectOf(subject: string): string {
  const clean = String(subject || "").replace(/^(Re:\s*)+/i, "").replace(/^无主题$/, "").trim();
  return clean ? `Re: ${clean}` : "";
}

function isPlaceholderMailbox(email: string): boolean {
  const value = email.trim().toLowerCase();
  if (!value) return false;
  return /@(?:[\w-]+\.)*example\.com$/i.test(value) || /@[\w.-]*\bexample$/i.test(value);
}

function firstRealMailbox(...values: unknown[]): string {
  for (const value of values) {
    const email = String(value || "").trim();
    if (email && !isPlaceholderMailbox(email)) return email;
  }
  return "";
}

export function KolMailCard({
  payload,
  sessionId,
  onRefresh,
  createdAt,
  messageId,
  showSubject = true,
  bodyOnly = false,
}: {
  payload: Record<string, unknown>;
  sessionId?: string;
  officialStage?: string;
  onRefresh?: () => void;
  createdAt?: string;
  messageId?: string;
  showSubject?: boolean;
  bodyOnly?: boolean;
}) {
  const judgment = (payload.judgment && typeof payload.judgment === "object"
    ? payload.judgment
    : {}) as Record<string, unknown>;
  const handle = String(payload.handle || "");
  const collaborationId = String(payload.collaboration_id || "");
  const suggested = String(judgment.suggested_stage || "");
  const inbound = String(payload.direction || "inbound") !== "outbound";
  const subject = String(payload.subject || "").trim() || "无主题";
  const body = String(payload.body || payload.snippet || "").trim();
  const fromName = String(payload.from_name || "").trim();
  const fromEmail = String(payload.from || "").trim();
  const brandBox = inbound
    ? firstRealMailbox(payload.mailbox, payload.to)
    : firstRealMailbox(payload.mailbox, payload.from);
  const kolAddr = inbound ? firstRealMailbox(payload.from) : firstRealMailbox(payload.to);
  const fromLine = [fromName, inbound ? fromEmail : (fromEmail || brandBox)].filter(Boolean).join(" · ");
  const mailbox = inbound ? brandBox : kolAddr;
  const occurred = mailCardTime(payload, createdAt);
  const replySubject = replySubjectOf(subject);
  const suggestedLabel = stageLabel(suggested, String(judgment.suggested_label || ""));
  const currentLabel = stageLabel(String(payload.current_stage || ""), String(payload.current_label || ""));
  const autoAdvanced = payload.auto_advanced && typeof payload.auto_advanced === "object"
    ? payload.auto_advanced as { to_stage?: string; label?: string }
    : null;
  const factSuggestLabel = autoAdvanced
    ? String(autoAdvanced.label || stageLabel(String(autoAdvanced.to_stage || "")) || suggestedLabel)
    : "";
  const suggestText = factSuggestLabel || suggestedLabel;
  const reply = async () => {
    if (!sessionId) return;
    const conversationId = String(payload.conversation_id || "");
    const text = [
      conversationId ? `回复会话 ${conversationId}` : (handle ? `给@${handle} 写跟进邮件` : "写跟进邮件"),
      brandBox ? `发件: ${brandBox}` : "",
      kolAddr ? `收件: ${kolAddr}` : "",
      replySubject ? `主题: ${replySubject}` : "",
    ].filter(Boolean).join(" ");
    applyComposerDraft({
      text,
      intent: "mail_reply",
      chips: [
        { kind: "skill", id: "email_compose", label: "写跟进邮件", write: true },
        ...(handle ? [{ kind: "object" as const, id: handle, label: handle, objectKind: "kol" }] : []),
      ],
      object_refs: [
        ...(conversationId ? [{ kind: "mail", id: conversationId, label: subject }] : []),
        ...(handle ? [{ kind: "kol", id: handle, label: handle }] : []),
      ],
      client_entry: "compose-send",
      scope: { skills: ["email_compose"], intent: "mail_reply" },
    });
  };
  if (bodyOnly) {
    return (
      <article
        className={"bubble assistant kol-mail" + (inbound ? " is-in" : " is-out")}
        data-kind="kol-mail-card"
        data-thread-id={String(payload.conversation_id || "")}
        data-mail-id={messageId || String(payload.provider_message_id || "")}
        data-mail-direction={inbound ? "inbound" : "outbound"}
        data-mail-body-only
      >
        <header className="kol-mail-head">
          <strong>{subject}</strong>
        </header>
        {body
          ? <p className="kol-mail-body">{body}</p>
          : <p className="muted" data-mail-empty>正文未拉取到，请回到首页点「刷新收取」后再打开。</p>}
      </article>
    );
  }
  return (
    <article
      className={"bubble assistant kol-mail" + (inbound ? " is-in" : " is-out")}
      data-kind="kol-mail-card"
      data-thread-id={String(payload.conversation_id || "")}
      data-mail-id={messageId || String(payload.provider_message_id || "")}
      data-mail-direction={inbound ? "inbound" : "outbound"}
    >
      <header className="kol-mail-head">
        <strong>{inbound ? "来信" : "去信"}{showSubject ? ` · ${subject}` : ""}</strong>
        <time className="muted" data-mail-time dateTime={String(payload.occurred_at || createdAt || "")}>
          {occurred || "时间未同步"}
        </time>
      </header>
      {fromLine ? <p className="muted" data-mail-from>发件 {fromLine}</p> : null}
      {mailbox ? <p className="muted" data-mail-to>收件 {mailbox}</p> : null}
      {body
        ? <p className="kol-mail-body">{body}</p>
        : <p className="muted" data-mail-empty>正文未拉取到，请回到首页点「刷新收取」后再打开。</p>}
      {inbound && judgment.reason ? <p className="muted" data-mail-judgment>{String(judgment.reason)}</p> : null}
      {currentLabel ? <p className="muted" data-mail-current-stage>当前 {currentLabel}</p> : null}
      {suggestText ? (
        <p
          className="muted"
          data-mail-suggest
          data-auto-advanced={autoAdvanced ? "suggest" : undefined}
        >
          建议进入 {suggestText}。改阶段请走阶段确认卡，回复不会改阶段。
        </p>
      ) : null}
      <div className="action-row">
        <button type="button" className="btn work" data-mail-reply onClick={() => void reply()} disabled={!sessionId}>
          回复
        </button>
      </div>
    </article>
  );
}

export function ChatThread({
  messages,
  officialStage,
  onRefresh,
}: {
  messages: Message[];
  officialStage?: string;
  onRefresh?: () => void;
}) {
  const { debug } = useViewMode();
  const hasResult = messages.some((m) =>
    ["email_card", "confirm_stage_card", "inbound_card", "supplement_card", "task_result_card", "kol_mail_card"].includes(m.kind)
    || taskResultCardsFrom(String(m.payload.text || "")).length > 0,
  );
  const latestResultId = [...messages].reverse().find((item) => item.kind === "task_result_card")?.id;
  const latestDraftId = [...messages].reverse().find((item) => item.kind === "email_card")?.id;
  const hasDraftCard = Boolean(latestDraftId);
  const latestStageReceiptId = [...messages].reverse().find((item) =>
    /正式阶段已按你的确认更新|已提交阶段审批/.test(String(item.payload.text || "")),
  )?.id;
  let mailPointer = false;
  return (
    <div
      className="chat conversation-content"
      data-session-stream={messages.some((item) => item.payload.streaming) ? "live" : "idle"}
      data-ai-conversation-content
    >
      {messages.map((m) => {
        if (m.kind === "me") {
          return (
            <ThreadMessage key={m.id} role="user" data-kind="me">
              {String(m.payload.text || "")}
            </ThreadMessage>
          );
        }
        if (m.kind === "email_card") {
          if (m.id !== latestDraftId) return null;
          const sent = String(m.payload.status || "") === "sent" || Boolean(m.payload.send_disabled);
          return (
            <ThreadMessage key={m.id} role="assistant" result={sent ? "send" : "draft"} risk="L2" data-kind="email-card-pointer">
              <strong>{sent ? "发送卡" : "邮件草稿"}</strong>
              <p>{sent ? "发送结果已放入结果工作台。" : "草稿已放入结果，核对后再确认发送。"}</p>
            </ThreadMessage>
          );
        }
        if (m.kind === "confirm_stage_card") {
          const proposed = String(m.payload.proposed_stage || "");
          if (m.payload.resolved || officialStageReached(officialStage, proposed)) return null;
          return (
            <ThreadMessage key={m.id} role="assistant" result="stage" risk="L3" data-kind="confirm-stage-pointer">
              <strong>阶段卡</strong>
              <p>请在结果中确认阶段。选定具体正式阶段后再写入，本路径不发信。</p>
            </ThreadMessage>
          );
        }
        if (m.kind === "kol_mail_card") {
          if (mailPointer) return null;
          mailPointer = true;
          return (
            <ThreadMessage key={m.id} role="assistant" risk="L1" data-kind="kol-mail-pointer">
              <p>来信已放入结果。改阶段请走阶段确认卡。</p>
            </ThreadMessage>
          );
        }
        if (m.kind === "inbound_card") {
          return (
            <ThreadMessage key={m.id} role="assistant" risk="L1" data-kind="inbound-pointer">
              <p>未绑定来信已放入结果。请人选，不自动合并、不会「已自动记入」。</p>
            </ThreadMessage>
          );
        }
        if (m.kind === "supplement_card") {
          const intent = String(m.payload.intent || "");
          const title = String(m.payload.title || "");
          const message = String(m.payload.message || "");
          const kind = String(m.payload.clarification_kind || "");
          const fallback = intent === "content_nudge"
            ? "催大纲需要指定红人或合作，请在结果中补全后再起箱。"
            : intent === "business_approval"
              ? "还缺金额或币种，请在结果中补上。"
              : intent === "confirm_stage"
                ? "提出阶段变更需要指定红人或合作。"
                : kind === "direction"
                  ? "请选择最符合你意图的任务，或补充说明后再发。"
                  : message || "还需要补充信息后再继续。";
          const risk = messageRisk("supplement_card", m.payload) || "L2";
          return (
            <ThreadMessage key={m.id} role="assistant" risk={risk} data-kind="supplement" data-clarification={kind || undefined}>
              {title ? <strong>{title}</strong> : null}
              <Markdown>{message || fallback}</Markdown>
            </ThreadMessage>
          );
        }
        if (m.kind === "task_result_card") {
          if (hasDraftCard || m.id !== latestResultId) return null;
          const risk = messageRisk("task_result_card", m.payload) || "L1";
          const title = String(m.payload.title || "任务结果");
          return (
            <ThreadMessage key={m.id} role="assistant" result="task_result" risk={risk} data-kind="task-result-pointer">
              <strong>{title}</strong>
              <p>任务结果已放入结果工作台。</p>
            </ThreadMessage>
          );
        }
        if (m.kind === "job_status") {
          const state = String(m.payload.status || "running");
          if (state === "done" && hasResult) return null;
          return (
            <ThreadMessage
              key={m.id}
              role="assistant"
              className={`job-status job-${state}`}
              data-kind="job-status"
              data-status={state}
            >
              {state === "running" ? "⏳ " : state === "done" ? "✓ " : "⚠ "}
              {employeeMessageBody(String(m.payload.text || ""), debug, onRefresh)}
            </ThreadMessage>
          );
        }
        if (m.kind === "process_trace") {
          const items = traceItems(m.payload);
          const summaries = summaryLines(m.payload, items)
            .map((line) => employeeReasoningLabel(line))
            .filter((line) => line && line !== "正在分析…" && !/[{[]/.test(line));
          const hasThinking = items.some((item) => item.kind === "reasoning" || Boolean(item.summary || item.reasoning_summary));
          return (
            <ThreadMessage
              key={m.id}
              role="assistant"
              className="process-trace process-md"
              data-kind="process-trace"
              data-harness-thinking={hasThinking ? "true" : undefined}
            >
              <strong>{employeeProcessLabel(String(m.payload.title || "处理过程"))}</strong>
              <ul className="trace-list">
                {items.map((item, index) => {
                  const rawLabel = String(
                    item.label || item.summary || item.reasoning_summary || item.title || item.phase || `阶段 ${index + 1}`,
                  );
                  const label = employeeTraceLabel(rawLabel, item.kind);
                  const status = safeStatus(item.status);
                  const streaming = item.kind === "reasoning" && (item.streaming || status === "running");
                  return (
                    <li key={item.id || `${label}-${index}`} data-status={status} data-kind={item.kind || undefined}>
                      <i>{statusMark(status)}</i>
                      <span className={streaming ? "is-streaming" : undefined}>{label}</span>
                    </li>
                  );
                })}
              </ul>
              {summaries.length > 0 && (
                <details open data-reasoning-summaries>
                  <summary>分析摘要</summary>
                  {summaries.map((summary, index) => (
                    looksLikeInferenceJson(summary)
                      ? <HumanizedInference key={`${summary}-${index}`} text={summary} debug={debug} />
                      : <p key={`${summary}-${index}`}>{summary}</p>
                  ))}
                </details>
              )}
            </ThreadMessage>
          );
        }
        if (m.kind === "operation_trace") {
          const source = m.payload.operations || m.payload.items || [];
          const legacyTrace = String(m.payload.title || "") === "操作过程";
          const operations: OperationTraceItem[] = Array.isArray(source)
            ? source
              .map((item) => typeof item === "string" ? { label: item, status: "done" } : item as OperationTraceItem)
              .filter((operation) => !isLegacyPhaseOperation(operation, legacyTrace))
            : [];
          const active = Boolean(m.payload.active);
          const title = employeeProcessLabel(String(m.payload.title || "正在调用系统能力"));
          if (!operations.length && !active) return null;
          return (
            <ThreadMessage key={m.id} role="assistant" className="operation-trace process-md" data-kind="operation-trace">
              <strong>{title}</strong>
              <ul className="trace-list">
                {operations.length
                  ? operations.map((operation, index) => {
                    const { human, name } = operationParts(operation, index);
                    const status = safeStatus(operation.status);
                    const streaming = status === "running";
                    return (
                      <li key={operation.id || name || index} data-status={status} data-mcp-name={debug ? (name || undefined) : undefined}>
                        <i>{statusMark(status)}</i>
                        <span className={streaming ? "is-streaming" : undefined}>{employeeProcessLabel(human)}</span>
                      </li>
                    );
                  })
                  : (
                    <li data-status="running" data-mcp-waiting>
                      <i>…</i>
                      <span className="is-streaming">正在调用系统能力…</span>
                    </li>
                  )}
              </ul>
            </ThreadMessage>
          );
        }
        if (isBoxSteps(m)) return null;
        if (isOverdueSteps(m)) {
          return (
            <ThreadMessage key={m.id} role="assistant" result="task_result">
              <p>失联与延期清单已放入结果。</p>
            </ThreadMessage>
          );
        }
        if (m.kind === "error_card") {
          const status = String(m.payload.status || m.payload.code || "");
          const message = String(m.payload.message || "");
          const transport = /^(502|503|500)$/.test(status) || /请求失败/.test(message);
          if (transport) {
            return (
              <ThreadMessage key={m.id} role="assistant" className="error-card workspace-error" data-kind="error-card" data-persistent-error>
                <strong>当前无法读取数据</strong>
                <p>连接暂时异常，已保留你的任务。</p>
                {debug && (
                <details className="execution-details">
                  <summary>查看详情</summary>
                  <p>{message || status}</p>
                </details>
                )}
              </ThreadMessage>
            );
          }
          const allowed = ((m.payload.allowed as ({ label?: string; code?: string } | string)[]) || [])
            .map((a) => typeof a === "string" ? stageLabel(a) || fieldLabel(a) : (a.label || stageLabel(a.code)))
            .filter(Boolean)
            .join(" / ");
          const md = [
            `**${errorTitle(String(m.payload.status || m.payload.code || ""))}**`,
            "",
            String(m.payload.message || "").replace(/必须指定具体目标 stage_code/g, "必须指定具体目标阶段"),
            m.payload.current_label ? `\n当前 ${String(m.payload.current_label)}；允许 ${allowed}` : "",
            m.payload.next_action ? `\n> 下一步：${m.payload.next_action}` : "",
          ].join("\n");
          return (
            <ThreadMessage key={m.id} role="assistant" className="error-card" data-kind="error-card" data-persistent-error>
              <Markdown>{md}</Markdown>
            </ThreadMessage>
          );
        }
        if (m.kind === "sys_msg") {
          const text = String(m.payload.text || "");
          if (isDuplicateSessionChrome(text)) return null;
          return (
            <ThreadMessage key={m.id} role="system" className="sys-msg" data-kind="sys-msg">
              {employeeMessageBody(text, debug, onRefresh)}
            </ThreadMessage>
          );
        }
        if (m.kind === "steps") return null;
        const text = String(m.payload.text || "");
        if (isDuplicateSessionChrome(text)) return null;
        if (/正式阶段已按你的确认更新|已提交阶段审批/.test(text) && m.id !== latestStageReceiptId) {
          return null;
        }
        const stageReceipt = /正式阶段已按你的确认更新|已提交阶段审批/.test(text);
        return (
          <ThreadMessage
            key={m.id}
            role="assistant"
            result={stageReceipt ? "confirm" : undefined}
            className={m.payload.streaming ? "is-streaming" : ""}
            data-streaming={m.payload.streaming ? "true" : undefined}
          >
            {text ? employeeMessageBody(text, debug, onRefresh) : (m.payload.streaming ? <span className="muted">正在输出…</span> : null)}
          </ThreadMessage>
        );
      })}
    </div>
  );
}

export function useSessionMessages(id: string | undefined) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentStatus, setAgentStatus] = useState<string>("listening");
  const [journey, setJourney] = useState<Record<string, unknown> | null>(null);
  const [collaborationId, setCollaborationId] = useState<string>("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [runQueue, setRunQueue] = useState<{ id: string; text?: string; intent?: string }[]>([]);
  const [err, setErr] = useState("");
  const load = useCallback((sync = false, force = false) => {
    if (!id) return;
    api
      .session(id, { sync, force })
      .then((s) => {
        setErr("");
        setMessages(Array.isArray(s.messages) ? s.messages : []);
        setAgentStatus(String(s.agent_status || "listening"));
        setCollaborationId(String(s.collaboration_id || (s.journey as { collaboration_id?: string } | null)?.collaboration_id || ""));
        setJourney(s.journey && typeof s.journey === "object" ? s.journey as Record<string, unknown> : null);
        setRunQueue(Array.isArray(s.run_queue) ? s.run_queue : []);
        setSessionLoaded(true);
      })
      .catch((e) => {
        setErr(friendlyError(e, "会话暂时无法加载"));
        setSessionLoaded(true);
      });
  }, [id]);
  useEffect(() => {
    if (!id) return;
    setCollaborationId("");
    setJourney(null);
    setRunQueue([]);
    setSessionLoaded(false);
    if (sessionStorage.getItem(`pending:${id}`)) return;
    load(false);
    const syncedKey = `mail-sync:${id}`;
    if (sessionStorage.getItem(syncedKey) !== "1") {
      sessionStorage.setItem(syncedKey, "1");
      load(true);
    }
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/sessions/${encodeURIComponent(id)}/events`);
    const applySnapshot = (raw: string) => {
      try {
        const s = JSON.parse(raw) as {
          messages?: Message[];
          agent_status?: string;
          collaboration_id?: string | null;
          journey?: Record<string, unknown> | null;
          run_queue?: { id: string; text?: string; intent?: string }[];
        };
        setErr("");
        if (Array.isArray(s.messages)) setMessages(s.messages);
        setAgentStatus(String(s.agent_status || "listening"));
        setCollaborationId(String(s.collaboration_id || (s.journey as { collaboration_id?: string } | null)?.collaboration_id || ""));
        setJourney(s.journey && typeof s.journey === "object" ? s.journey : null);
        if (Array.isArray(s.run_queue)) setRunQueue(s.run_queue);
        setSessionLoaded(true);
      } catch {
        /* ignore a bad frame */
      }
    };
    es.addEventListener("snapshot", (event) => applySnapshot((event as MessageEvent).data));
    es.addEventListener("upsert", (event) => {
      try {
        const next = JSON.parse((event as MessageEvent).data).message as Message | undefined;
        if (!next?.id) return;
        setMessages((prev) => {
          const idx = prev.findIndex((item) => item.id === next.id);
          if (idx < 0) return [...prev, next];
          const copy = prev.slice();
          copy[idx] = next;
          return copy;
        });
      } catch {
        /* ignore a bad frame */
      }
    });
    es.addEventListener("status", (event) => {
      try {
        const status = String(JSON.parse((event as MessageEvent).data).agent_status || "listening");
        setAgentStatus(status);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("journey", (event) => {
      try {
        const journeyRow = JSON.parse((event as MessageEvent).data).journey as Record<string, unknown> | null;
        if (journeyRow && typeof journeyRow === "object") {
          setJourney(journeyRow);
          setCollaborationId(String(journeyRow.collaboration_id || ""));
        }
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("queue", (event) => {
      try {
        const queue = JSON.parse((event as MessageEvent).data).queue as { id: string; text?: string; intent?: string }[] | undefined;
        if (Array.isArray(queue)) setRunQueue(queue);
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [id, load]);
  useEffect(() => {
    if (!id || agentStatus !== "running") return;
    const timer = window.setInterval(() => load(false), 800);
    return () => window.clearInterval(timer);
  }, [id, agentStatus, load]);
  return { messages, err, reload: load, setMessages, agentStatus, setAgentStatus, journey, collaborationId, sessionLoaded, runQueue, setRunQueue };
}

export function storePending(sessionId: string, pending: PendingAsk) {
  sessionStorage.setItem(`pending:${sessionId}`, JSON.stringify(pending));
}

export function takePending(sessionId: string): PendingAsk | null {
  const raw = sessionStorage.getItem(`pending:${sessionId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return { text: parsed };
    return parsed as PendingAsk;
  } catch {
    return { text: raw };
  }
}

export function clearPending(sessionId: string): void {
  sessionStorage.removeItem(`pending:${sessionId}`);
}

export type ComposerDraft = {
  text: string;
  intent?: string;
  title?: string;
};

const draftCache = new Map<string, ComposerDraft>();

function parseComposerDraft(raw: string): ComposerDraft {
  try {
    const parsed = JSON.parse(raw) as ComposerDraft | string;
    if (typeof parsed === "string") return { text: parsed };
    if (parsed && typeof parsed.text === "string") return parsed;
  } catch {
    /* treat the raw slot as plain text */
  }
  return { text: raw };
}

export function storeComposerDraft(sessionId: string, draft: ComposerDraft) {
  draftCache.delete(sessionId);
  sessionStorage.setItem(`draft:${sessionId}`, JSON.stringify(draft));
}

/** Consume a template draft. Cached so React StrictMode remounts still see it. */
export function takeComposerDraft(sessionId: string): ComposerDraft | null {
  const cached = draftCache.get(sessionId);
  if (cached) return cached;
  const raw = sessionStorage.getItem(`draft:${sessionId}`);
  if (!raw) return null;
  sessionStorage.removeItem(`draft:${sessionId}`);
  const draft = parseComposerDraft(raw);
  draftCache.set(sessionId, draft);
  return draft;
}

export function clearComposerDraft(sessionId: string) {
  draftCache.delete(sessionId);
  sessionStorage.removeItem(`draft:${sessionId}`);
}
