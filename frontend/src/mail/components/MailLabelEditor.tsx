import { useId, useState } from "react";
import type { MailConversation } from "../types";
import type { useMailLabels } from "../useMailLabels";

export function MailLabelEditor({
  actorId, mailbox, conversation, stage, labels,
}: {
  actorId: string;
  mailbox: string;
  conversation: MailConversation | null;
  stage: string;
  labels: ReturnType<typeof useMailLabels>;
}) {
  const inputId = useId();
  const key = `${actorId}\0${mailbox}\0${conversation?.conversation_id || ""}`;
  // Keep unfinished text with its exact object, never transfer it to another mail.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [removal, setRemoval] = useState<{ scope: string; id: string } | null>(null);
  const text = drafts[key] || "";
  const update = (next: string) => setDrafts(previous => ({ ...previous, [key]: next }));
  const saved = labels.data?.labels.filter(label => labels.data?.selected_label_ids.includes(label.id)) || [];
  const removable = removal?.scope === key ? saved.find(label => label.id === removal.id) : null;
  const disabled = labels.loading || labels.saving || !labels.data || !conversation;
  const add = async () => {
    if (!text.trim() || disabled) return;
    const normalized = text.normalize("NFKC").trim().toLowerCase();
    const existing = labels.data?.labels.find(label => label.name.normalize("NFKC").trim().toLowerCase() === normalized);
    const ok = await labels.mutate(existing ? { mode: "add", label_id: existing.id } : { mode: "add", name: text });
    if (ok) setDrafts(previous => ({ ...previous, [key]: "" }));
  };
  return (
    <section className="mr-label-editor" aria-label="会话标签" data-mail-label-editor data-mail-label-object={conversation?.conversation_id || ""}>
      <div className="mr-label-heading">
        <strong>标签</strong>
        <span className="muted">{conversation ? "仅自己可见 · 会话级" : "请选择中栏会话或邮件后打标"}</span>
      </div>
      {conversation ? <p className="mr-label-object muted" data-mail-label-object-copy title={`${conversation.subject} · ${conversation.peer_email}`}>
        当前会话：{conversation.subject} · {conversation.peer_email}
      </p> : null}
      <div className="mr-saved-labels" data-mail-saved-labels>
        {stage ? <span className="mr-saved-label is-system" data-mail-system-label title="来自真实合作事实，手工标签不会改变阶段">阶段 · {stage}</span> : null}
        {saved.map(label => <span className="mr-saved-label" key={label.id} data-mail-saved-label={label.id}>
          {label.name}
          <button type="button" className="mr-label-remove" aria-label={`移除标签 ${label.name}`} disabled={disabled}
            onClick={() => setRemoval({ scope: key, id: label.id })}>×</button>
        </span>)}
      </div>
      {conversation ? <>
        <form className="mr-label-form" onSubmit={event => { event.preventDefault(); void add(); }}>
          <label className="sr-only" htmlFor={inputId}>输入或选择手工标签</label>
          <input id={inputId} list={`${inputId}-labels`} data-mail-label-input placeholder="输入或选择手工标签…"
            maxLength={40} value={text} disabled={labels.loading || labels.saving || !labels.data}
            onChange={event => update(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
          <datalist id={`${inputId}-labels`}>{labels.data?.labels.map(label => <option key={label.id} value={label.name} />)}</datalist>
          <button type="submit" className="btn ghost sm" data-mail-label-confirm disabled={disabled || !text.trim()} aria-busy={labels.saving}>
            {labels.saving ? "保存中…" : "确认打标"}
          </button>
        </form>
        {removable ? <div className="mr-label-confirm" data-mail-label-remove-confirm>
          <span>从此会话移除「{removable.name}」？</span>
          <button type="button" className="btn ghost sm" disabled={disabled} onClick={async () => {
            if (await labels.mutate({ mode: "remove", label_id: removable.id })) setRemoval(null);
          }}>确认移除</button>
          <button type="button" className="btn ghost sm" disabled={labels.saving} onClick={() => setRemoval(null)}>取消</button>
        </div> : null}
      </> : null}
      {labels.loading ? <p className="muted" role="status">正在读取此邮箱标签…</p> : null}
      {labels.error ? <p className="error mr-label-error" role="alert" data-mail-label-error>{labels.error}
        <button type="button" className="btn ghost sm" disabled={labels.loading || labels.saving} onClick={() => void labels.reload()}>重新读取</button>
      </p> : null}
      {labels.notice ? <p className="muted" role="status" data-mail-label-notice>{labels.notice}</p> : null}
    </section>
  );
}
