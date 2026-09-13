import { useCallback, useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
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
import { useViewMode } from "../viewMode";
import { occurredAtMs } from "../mail-time";
import { officialStageReached } from "../journey";
import { MESSAGE_RISK_LABEL, messageRisk, type MessageRisk } from "../agentUx";

function RiskBubble({
  risk,
  children,
  className = "",
  ...attrs
}: { risk: MessageRisk; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bubble assistant risk-${risk.toLowerCase()} ${className}`.trim()} data-risk={risk} {...attrs}>
      <span className="risk-kicker">{MESSAGE_RISK_LABEL[risk]}</span>
      {children}
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
}: {
  value: string;
  onChange: (code: string) => void;
  groups: StageTrackGroup[];
  suggested?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} data-stage-select>
      {groups.map((group) => (
        <optgroup key={group.id} label={group.label} data-stage-track={group.id}>
          {group.items.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label || stageLabel(item.code)}
              {item.code === suggested || item.suggested ? " · 建议" : ""}
              {item.note ? ` · ${item.note}` : item.advancement_mode ? ` · ${item.advancement_mode}` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function stageOptionNeedsReason(item?: StageTargetOption): boolean {
  return Boolean(item && ["skip", "correct", "exception"].includes(String(item.kind || "")));
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
  if (card.official_stage_label || card.official_stage) {
    rows.push(`| 正式阶段 | ${stageLabel(card.official_stage, card.official_stage_label)} |`);
  }
  return [
    "### 英文原文草稿",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    ...rows,
    "",
    "```",
    card.body || "",
    "```",
    "",
    card.footer
      ? `> ${card.footer}。正式阶段建议保持：${card.official_stage_label}。发送 ≠ 推进阶段。`
      : `> 正式阶段建议保持：${card.official_stage_label}。发送 ≠ 推进阶段。失败会留在本会话，不会假装成功。`,
  ].join("\n");
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
  const sent = card.status === "sent" || !!card.send_disabled;
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

  const send = async () => {
    if (card.send_disabled) return;
    setBusy("send");
    setErr("");
    try {
      if (dirty) await persist();
      await api.sendDraft(card.draft_id, { cc, from_addr: resolvedFrom, to_addr: toAddr });
      onRefresh();
    } catch (e) {
      setErr(messageOf(e));
      onRefresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="artifact" data-kind="email-card" data-status={card.status} data-card-id={card.draft_id}>
      {sent ? (
        <Markdown>{emailMarkdown({ ...card, from: fromAddr, to: toAddr, cc, subject, body })}</Markdown>
      ) : (
        <div className="draft-editor">
          <div className="page-kicker">邮件草稿</div>
          <p className="draft-meta" data-draft-subject-preview>
            邮件主题：{subject || "未指定"}
          </p>
          {card.amount_usd != null && (
            <p className="draft-meta" data-draft-amount data-compose-amount>
              金额 {card.currency || "USD"} {card.amount_usd}{card.rate_unit === "hour" ? " per hour" : ""}
              {card.deliverables ? ` · ${card.deliverables}` : ""}
              {card.brand ? ` · ${card.brand}` : ""}
            </p>
          )}
          <label className="draft-field">
            <span>主题</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="邮件主题"
              data-draft-subject
            />
          </label>
          <label className="draft-field">
            <span>正文</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="英文原文"
              rows={12}
              data-draft-body
            />
          </label>
          <p className="muted">
            正式阶段建议保持：{card.official_stage_label || card.official_stage || "不变"}。发送 ≠ 推进阶段。
          </p>
        </div>
      )}
      {zh && (
        <div className="zh" data-draft-zh>
          <div className="page-kicker">内部中文（不进 SMTP）</div>
          <div className="zh-body">{zh}</div>
        </div>
      )}
      <div className="action-row">
        {opts.length > 1 ? (
          <select value={resolvedFrom} onChange={(e) => setFromAddr(e.target.value)} data-from-select disabled={sent}>
            {opts.map((o) => (
              <option key={o.email} value={o.email}>
                {o.brand} · {o.email}
              </option>
            ))}
          </select>
        ) : (
          <span className="mono">
            {resolvedFrom}
            {card.from_locked && <em className="lock"> {card.from_lock_text || "已按品牌和权限锁定"}</em>}
          </span>
        )}
        <input value={toAddr} onChange={(e) => setToAddr(e.target.value)} placeholder="To · 收件邮箱" data-draft-to disabled={sent} />
        <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc · 上级 / 同站点 / 相关同事" disabled={sent} />
        {!sent && (
          <button className="btn ghost" data-draft-save onClick={() => void save()} disabled={!!busy || !dirty}>
            保存草稿
          </button>
        )}
        <button className="btn ghost" data-email-action="translate" onClick={() => void translate()} disabled={!!busy}>
          一键翻译中文（内部）
        </button>
        <button className="btn work" data-email-action="send" onClick={() => void send()} disabled={!!busy || !!card.send_disabled || !resolvedFrom.trim() || !toAddr.trim()}>
          校验并发送原文
        </button>
      </div>
      {card.send_disabled && <p className="muted">发送已禁用</p>}
      {!resolvedFrom.trim() && !card.send_disabled && <p className="muted">请先选择发件邮箱。没有明确绑定时不会自动选择邮箱。</p>}
      {!toAddr.trim() && !card.send_disabled && <p className="muted">请先填写收件邮箱。不能解密或编造联系方式。</p>}
      {err && (
        <div className="error" data-persistent-error>
          {err}
        </div>
      )}
    </article>
  );
}

export function StageFromDraft({
  card,
  sessionId,
  onRefresh,
}: {
  card: EmailCard;
  sessionId: string;
  onRefresh: () => void;
}) {
  const groups = stageTrackGroups({ targets: card.targets, tracks: card.tracks });
  const [target, setTarget] = useState(card.targets?.[0]?.code || groups[0]?.items[0]?.code || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!target) {
      setErr("请选择具体目标阶段，不能用「下一阶段」");
      return;
    }
    const picked = groups.flatMap((group) => group.items).find((item) => item.code === target);
    setBusy(true);
    setErr("");
    try {
      await api.confirmSessionStage(sessionId, {
        stage_code: target,
        collaboration_id: card.collaboration_id,
        expected_version: card.expected_version,
        reason: [picked?.note, "从草稿工作台确认"].filter(Boolean).join("；"),
        reason_code: picked?.kind === "correct" ? "STAGE_CORRECTION" : picked?.kind === "skip" ? "SKIP_AHEAD" : "HUMAN_CONFIRMED",
        evidence: { source: "draft_workbench", draft_id: card.draft_id, kind: picked?.kind, track: picked?.track },
        recommender: "Commander",
      });
      onRefresh();
    } catch (e) {
      setErr(friendlyError(e, "阶段确认未完成，请稍后重试"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="artifact" data-kind="stage-from-draft">
      <Markdown>
        {`### 确认推进阶段\n\n当前正式阶段：**${stageLabel(card.official_stage, card.official_stage_label)}**\n\n> 发送邮件不会修改阶段。请选择具体目标阶段后再确认。`}
      </Markdown>
      <div className="action-row">
        {groups.length > 0 && (
          <StageTrackSelect value={target} onChange={setTarget} groups={groups} />
        )}
        <button className="btn work" data-email-action="confirm-stage" onClick={confirm} disabled={busy}>
          确认推进阶段
        </button>
      </div>
      {err && <div className="error">{err}</div>}
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
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState("HUMAN_CONFIRMED");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const closed = Boolean(payload.locked || payload.resolved || payload.rejected);
  const currentLabel = stageLabel(String(payload.current_stage || ""), String(payload.current_label || "")) || String(payload.current_label || payload.current_stage || "未指定");
  const next = targets.find((item) => item.code === code);
  const nextLabel = next ? (next.label || stageLabel(next.code)) : "";
  const confirm = async () => {
    setErr("");
    if (!code) {
      setErr("请选择具体目标阶段，不能用「下一阶段」");
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
      }) as { mcp_sync?: { error?: boolean; message?: string; skipped?: boolean; reason?: string; updated?: boolean } };
      const mcp = result.mcp_sync;
      if (mcp?.error) {
        setErr(friendlyError(mcp.message || "本地已写入，远程阶段未同步"));
      }
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
      <div className="action-row">
        <StageTrackSelect value={code} onChange={setCode} groups={groups} suggested={suggested} />
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
        <button className="btn work" type="button" data-confirm-stage onClick={() => void confirm()} disabled={closed || busy || !code}>
          {busy ? "正在写入…"
            : /必须审批|必须审核|审核通过后推进|财务事实/.test(targets.find((item) => item.code === code)?.advancement_mode || "")
              ? "提交审批"
              : "确认写入正式阶段"}
        </button>
        <button className="btn ghost" type="button" data-reject-stage onClick={() => void reject()} disabled={closed || busy}>
          驳回
        </button>
      </div>
      {err && <div className="error">{err}</div>}
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

function humanizeTraceLabel(label: string) {
  const raw = label.trim();
  if (!raw) return "正在处理";
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  const mapped: Record<string, string> = {
    creator_discovery: "正在检查达人信息",
    lead: "正在查看最近沟通",
    commander: "正在分析合作历史",
    execution: "正在生成建议",
    kol: "正在准备达人建联",
    pipeline_review: "正在复盘流水线",
  };
  if (mapped[raw]) return mapped[raw];
  if (/^[a-z0-9_.:/-]+$/i.test(raw)) return "正在处理这项工作";
  return raw;
}

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
  const human = String(operation.tool_label || operation.label || tool?.label || "").trim();
  if (human || name) return { human, name };
  return { human: `远程调用 ${index + 1}`, name: "" };
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
  officialStage,
  onRefresh,
  createdAt,
  messageId,
  showSubject = true,
  showStage = true,
  bodyOnly = false,
}: {
  payload: Record<string, unknown>;
  sessionId?: string;
  officialStage?: string;
  onRefresh?: () => void;
  createdAt?: string;
  messageId?: string;
  showSubject?: boolean;
  showStage?: boolean;
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
  const currentStage = String(payload.current_stage || "");
  const currentLabel = stageLabel(currentStage, String(payload.current_label || ""));
  const expectedVersion = payload.expected_version;
  const targets = (Array.isArray(payload.targets) ? payload.targets : []) as StageTargetOption[];
  const groups = stageTrackGroups({ targets, tracks: Array.isArray(payload.tracks) ? payload.tracks as StageTrackGroup[] : [] });
  const defaultPick = suggested && targets.some((item) => item.code === suggested)
    ? suggested
    : "";
  const [picked, setPicked] = useState(defaultPick);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const alreadyThere = officialStageReached(officialStage, picked)
    || officialStageReached(officialStage, suggested);
  const canConfirm = Boolean(
    showStage
    && !payload.auto_advanced
    && !alreadyThere
    && (targets.length || (suggested && judgment.auto_propose)),
  );
  const pickedLabel = stageLabel(picked, targets.find((item) => item.code === picked)?.label || "");
  const reply = async () => {
    if (!sessionId) return;
    const conversationId = String(payload.conversation_id || "");
    const text = [
      conversationId ? `回复会话 ${conversationId}` : (handle ? `给@${handle} 写跟进邮件` : "写跟进邮件"),
      brandBox ? `发件: ${brandBox}` : "",
      kolAddr ? `收件: ${kolAddr}` : "",
      replySubject ? `主题: ${replySubject}` : "",
    ].filter(Boolean).join(" ");
    await api.postMessage(sessionId, {
      text,
      collaboration_id: collaborationId || undefined,
      entities: {
        conversationId: conversationId ? Number(conversationId) : undefined,
        mailboxEmail: brandBox,
        from: brandBox,
        to: kolAddr ? [kolAddr] : [],
        subject: replySubject,
        handle,
        suggested_stage: suggested || undefined,
        prompt: "根据来信写一封简短的跟进回复，先不要发送。",
      },
    });
    onRefresh?.();
  };
  const confirm = async () => {
    if (!sessionId || !canConfirm) return;
    if (!picked) {
      setErr("请选择具体目标阶段，不能用「下一阶段」");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api.confirmSessionStage(sessionId, {
        stage_code: picked,
        collaboration_id: collaborationId || undefined,
        handle: handle || undefined,
        expected_version: expectedVersion,
        reason: String(judgment.reason || targets.find((item) => item.code === picked)?.note || "来信正文"),
        reason_code: "REPLY_EVIDENCE",
        evidence: { source: "kol_mail_card", flags: judgment.flags, snippets: judgment.evidence },
        recommender: "reply_analysis",
      });
      onRefresh?.();
    } catch (e) {
      setErr(friendlyError(e, "阶段确认未完成，请稍后重试"));
    } finally {
      setBusy(false);
    }
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
      className={"bubble assistant kol-mail" + (inbound ? " is-in" : " is-out") + (canConfirm ? " risk-l3" : "")}
      data-kind="kol-mail-card"
      data-thread-id={String(payload.conversation_id || "")}
      data-mail-id={messageId || String(payload.provider_message_id || "")}
      data-mail-direction={inbound ? "inbound" : "outbound"}
      data-risk={canConfirm ? "L3" : undefined}
    >
      {canConfirm ? (
        <span className="risk-kicker">{MESSAGE_RISK_LABEL.L3}</span>
      ) : null}
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
      {payload.auto_advanced ? (
        <p data-auto-advanced>已按事实进入 {String((payload.auto_advanced as { label?: string }).label || suggestedLabel)}</p>
      ) : null}
      {canConfirm ? (
        <div className="stage-diff" data-stage-diff>
          <div className="diff-from">变更前：{currentLabel || "当前阶段"}</div>
          <div className="diff-to">变更后：{pickedLabel || "请选择具体正式阶段"}</div>
        </div>
      ) : null}
      {canConfirm && suggestedLabel ? (
        <p className="muted" data-mail-suggest>建议 {suggestedLabel}。请你选定具体正式阶段，不能用「下一阶段」。</p>
      ) : null}
      <div className="action-row">
        <button type="button" className="btn work" data-mail-reply onClick={() => void reply()} disabled={!sessionId}>
          回复
        </button>
        {canConfirm && groups.length ? (
          <StageTrackSelect value={picked} onChange={setPicked} groups={groups} suggested={suggested} />
        ) : null}
        {canConfirm ? (
          <button type="button" className="btn work" data-mail-confirm onClick={() => void confirm()} disabled={!sessionId || busy || !picked}>
            {busy ? "正在确认…" : "确认写入所选阶段"}
          </button>
        ) : null}
      </div>
      {err ? <div className="error" data-mail-confirm-error>{err}</div> : null}
    </article>
  );
}

export function ChatThread({
  messages,
  officialStage,
}: {
  messages: Message[];
  officialStage?: string;
}) {
  const { debug } = useViewMode();
  const hasResult = messages.some((m) =>
    ["email_card", "confirm_stage_card", "inbound_card", "supplement_card", "task_result_card", "kol_mail_card"].includes(m.kind),
  );
  const latestResultId = [...messages].reverse().find((item) => item.kind === "task_result_card")?.id;
  const latestDraftId = [...messages].reverse().find((item) => item.kind === "email_card")?.id;
  const hasDraftCard = Boolean(latestDraftId);
  const latestStageReceiptId = [...messages].reverse().find((item) =>
    /正式阶段已按你的确认更新|已提交阶段审批/.test(String(item.payload.text || "")),
  )?.id;
  let mailPointer = false;
  return (
    <div className="chat" data-session-stream={messages.some((item) => item.payload.streaming) ? "live" : "idle"}>
      {messages.map((m) => {
        if (m.kind === "me") {
          return (
            <div key={m.id} className="bubble me" data-kind="me">
              {String(m.payload.text || "")}
            </div>
          );
        }
        if (m.kind === "email_card") {
          if (m.id !== latestDraftId) return null;
          return (
            <RiskBubble key={m.id} risk="L2" data-kind="email-card-pointer">
              <Markdown>{"✍️ **邮件已放到右侧结果。** 请核对要点和草稿后再确认发送。发送邮件不会修改阶段。"}</Markdown>
            </RiskBubble>
          );
        }
        if (m.kind === "confirm_stage_card") {
          const proposed = String(m.payload.proposed_stage || "");
          if (m.payload.resolved || officialStageReached(officialStage, proposed)) return null;
          return (
            <RiskBubble key={m.id} risk="L3" data-kind="confirm-stage-pointer">
              <Markdown>{"⚠️ **请在右侧结果确认阶段。** 选定具体正式阶段后再写入，本路径不发信。"}</Markdown>
            </RiskBubble>
          );
        }
        if (m.kind === "kol_mail_card") {
          if (mailPointer) return null;
          mailPointer = true;
          return (
            <RiskBubble key={m.id} risk="L1" data-kind="kol-mail-pointer">
              <Markdown>{"📬 **来信已放到右侧结果。** 需要确认阶段时在右侧操作。"}</Markdown>
            </RiskBubble>
          );
        }
        if (m.kind === "inbound_card") {
          return (
            <RiskBubble key={m.id} risk="L1" data-kind="inbound-pointer">
              <Markdown>{"📬 **未绑定来信已放到右侧结果。** 请人选，不自动合并、不会「已自动记入」。"}</Markdown>
            </RiskBubble>
          );
        }
        if (m.kind === "supplement_card") {
          const intent = String(m.payload.intent || "");
          const title = String(m.payload.title || "");
          const message = String(m.payload.message || "");
          const kind = String(m.payload.clarification_kind || "");
          const fallback = intent === "content_nudge"
            ? "催大纲需要指定红人或合作，请在右侧结果补全后再起箱。"
            : intent === "business_approval"
              ? "还缺金额或币种，请在右侧结果补上。"
              : intent === "confirm_stage"
                ? "提出阶段变更需要指定红人或合作。"
                : kind === "direction"
                  ? "请选择最符合你意图的任务，或补充说明后再发。"
                  : message || "还需要补充信息后再继续。";
          const risk = messageRisk("supplement_card", m.payload) || "L2";
          return (
            <RiskBubble key={m.id} risk={risk} data-kind="supplement" data-clarification={kind || undefined}>
              {title ? <strong>{title}</strong> : null}
              <Markdown>{message || fallback}</Markdown>
            </RiskBubble>
          );
        }
        if (m.kind === "task_result_card") {
          if (hasDraftCard || m.id !== latestResultId) return null;
          const risk = messageRisk("task_result_card", m.payload) || "L1";
          return (
            <RiskBubble key={m.id} risk={risk} data-kind="task-result-pointer">
              <Markdown>{"📋 **任务结果已放到右侧。**"}</Markdown>
            </RiskBubble>
          );
        }
        if (m.kind === "job_status") {
          const state = String(m.payload.status || "running");
          if (state === "done" && hasResult) return null;
          return (
            <div
              key={m.id}
              className={`bubble assistant job-status job-${state}`}
              data-kind="job-status"
              data-status={state}
            >
              {state === "running" ? "⏳ " : state === "done" ? "✓ " : "⚠ "}
              {String(m.payload.text || "")}
            </div>
          );
        }
        if (m.kind === "process_trace") {
          const items = traceItems(m.payload);
          const summaries = summaryLines(m.payload, items);
          const hasThinking = items.some((item) => item.kind === "reasoning" || Boolean(item.summary || item.reasoning_summary));
          return (
            <div
              key={m.id}
              className="bubble assistant process-trace process-md"
              data-kind="process-trace"
              data-harness-thinking={hasThinking ? "true" : undefined}
            >
              <strong>{String(m.payload.title || "处理过程")}</strong>
              <ul className="trace-list">
                {items.map((item, index) => {
                  const label = humanizeTraceLabel(String(
                    item.label || item.summary || item.reasoning_summary || item.title || item.phase || `阶段 ${index + 1}`,
                  ));
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
                    <p key={`${summary}-${index}`}>{summary}</p>
                  ))}
                </details>
              )}
            </div>
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
          const title = String(m.payload.title || "远程MCP调用");
          if (!operations.length && !active) return null;
          return (
            <div key={m.id} className="bubble assistant operation-trace process-md" data-kind="operation-trace">
              <strong>{title}</strong>
              <ul className="trace-list">
                {operations.length
                  ? operations.map((operation, index) => {
                    const { human, name } = operationParts(operation, index);
                    const status = safeStatus(operation.status);
                    const streaming = status === "running";
                    return (
                      <li key={operation.id || name || index} data-status={status} data-mcp-name={name || undefined}>
                        <i>{statusMark(status)}</i>
                        <span className={streaming ? "is-streaming" : undefined}>
                          {human && name && human !== name ? `${human} · ${name}` : (human || name)}
                        </span>
                      </li>
                    );
                  })
                  : (
                    <li data-status="running" data-mcp-waiting>
                      <i>…</i>
                      <span className="is-streaming">等待远程调用…</span>
                    </li>
                  )}
              </ul>
            </div>
          );
        }
        if (isBoxSteps(m)) return null;
        if (isOverdueSteps(m)) {
          return (
            <div key={m.id} className="bubble assistant">
              <Markdown>{"📋 **失联与延期清单已放到右侧结果。**"}</Markdown>
            </div>
          );
        }
        if (m.kind === "error_card") {
          const status = String(m.payload.status || m.payload.code || "");
          const message = String(m.payload.message || "");
          const transport = /^(502|503|500)$/.test(status) || /请求失败/.test(message);
          if (transport) {
            return (
              <div key={m.id} className="error-card workspace-error" data-kind="error-card" data-persistent-error>
                <strong>当前无法读取数据</strong>
                <p>连接暂时异常，已保留你的任务。</p>
                {debug && (
                <details className="execution-details">
                  <summary>查看详情</summary>
                  <p>{message || status}</p>
                </details>
                )}
              </div>
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
            <div key={m.id} className="error-card" data-kind="error-card" data-persistent-error>
              <Markdown>{md}</Markdown>
            </div>
          );
        }
        if (m.kind === "sys_msg") {
          const text = String(m.payload.text || "");
          if (/黄条无确认按钮|正式阶段建议保持/.test(text)) return null;
          return (
            <div key={m.id} className="sys-msg" data-kind="sys-msg">
              <Markdown>{`> ${text}`}</Markdown>
            </div>
          );
        }
        if (m.kind === "steps") return null;
        const text = String(m.payload.text || "");
        if (/正式阶段已按你的确认更新|已提交阶段审批/.test(text) && m.id !== latestStageReceiptId) {
          return null;
        }
        return (
          <div
            key={m.id}
            className={`bubble assistant${m.payload.streaming ? " is-streaming" : ""}`}
            data-streaming={m.payload.streaming ? "true" : undefined}
          >
            {text ? <Markdown>{text}</Markdown> : (m.payload.streaming ? <span className="muted">正在输出…</span> : null)}
          </div>
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
  return { messages, err, reload: load, setMessages, agentStatus, setAgentStatus, journey, collaborationId, sessionLoaded, runQueue };
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
