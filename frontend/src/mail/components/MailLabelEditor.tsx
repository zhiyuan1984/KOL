import { useId, useRef, useState } from "react";
import type { MailConversation } from "../types";
import type { useMailLabels } from "../useMailLabels";
import { MailIcon, mailLabelTone } from "./MailIcon";

/**
 * 轻量整理动作：入口在工具栏，已保存标签紧凑同行；点开小型浮层搜索/选择/手工输入。
 * 标签跟人走（对方邮箱级），不是会话级。AI 推荐不在这里：统一提问框里的“推荐标签”
 * 任务出候选，采纳后保存到同一对方。
 */
export function MailLabelEditor({ actorId, mailbox, conversation, stage, labels,
}: {
  actorId: string; mailbox: string; conversation: MailConversation | null; stage: string;
  labels: ReturnType<typeof useMailLabels>;
}) {
  const scope = `${actorId}\0${mailbox}\0${conversation?.conversation_id || ""}`;
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const text = drafts[scope] || "";
  const updateDraft = (next: string) => setDrafts(previous => ({ ...previous, [scope]: next }));
  const picker = useRef<HTMLDetailsElement>(null);
  const [pending, setPending] = useState<{scope: string; mode: "add" | "remove"; id?: string} | null>(null);
  const saved = labels.data?.labels.filter(label => labels.data?.selected_label_ids.includes(label.id)) || [];
  const selection = pending?.scope === scope ? pending : null;
  const selectedName = labels.data?.labels.find(label => label.id === selection?.id)?.name || "";
  const disabled = labels.loading || labels.saving || !labels.data || !conversation;
  const filtered = labels.data?.labels.filter(label => label.name.toLowerCase().includes(query.trim().toLowerCase())) || [];
  const addManual = async () => {
    if (!text.trim() || disabled) return;
    const normalized = text.normalize("NFKC").trim().toLowerCase();
    const existing = labels.data?.labels.find(label => label.name.normalize("NFKC").trim().toLowerCase() === normalized);
    const ok = await labels.mutate(existing ? { mode: "add", label_id: existing.id } : { mode: "add", name: text.trim() });
    if (ok) { updateDraft(""); setQuery(""); }
  };
  const confirm = async () => {
    if (!selection || disabled) return;
    if (selection.id && await labels.mutate({mode: selection.mode as "add" | "remove", label_id: selection.id})) {setPending(null); if (picker.current) picker.current.open = false;}
  };
  return <section className="mr-label-editor" aria-label="对方标签" data-mail-label-editor data-mail-label-object={conversation?.conversation_id || ""}>
    <div className="mail-label-toolbar">
      <details ref={picker} className="mail-label-picker" key={scope}>
        <summary aria-label="选择对方标签" title="选择标签，不输入新名称" data-mail-label-picker><MailIcon name="tag" />标签</summary>
        <div className="mail-label-panel mail-label-picker-panel">
          <p className="muted">仅自己可见 · 跟随对方</p>
          <input type="search" aria-label="筛选已有标签" data-mail-label-search placeholder="查找已有标签" value={query} onChange={event => setQuery(event.target.value)} />
          <form className="mr-label-form" data-mail-label-manual onSubmit={event => { event.preventDefault(); void addManual(); }}>
            <label className="sr-only" htmlFor={inputId}>手动输入新标签</label>
            <input id={inputId} list={`${inputId}-labels`} data-mail-label-input placeholder="手动输入新标签…" maxLength={40}
              value={text} disabled={disabled} onChange={event => updateDraft(event.target.value)} />
            <datalist id={`${inputId}-labels`}>{labels.data?.labels.map(label => <option key={label.id} value={label.name} />)}</datalist>
            <button type="submit" className="btn ghost sm" data-mail-label-add disabled={disabled || !text.trim()}>
              {labels.saving ? "保存中…" : "确认打标"}
            </button>
          </form>
          <div className="mail-label-options" role="group" aria-label="已有标签">
            {filtered.map(label => <button type="button" key={label.id} className="mail-label-option" data-mail-label-option={label.id}
              data-label-tone={mailLabelTone(label.name)} disabled={disabled} aria-pressed={labels.data?.selected_label_ids.includes(label.id)}
              onClick={() => setPending({scope, mode: labels.data?.selected_label_ids.includes(label.id) ? "remove" : "add", id: label.id})}>
              <MailIcon name="tag" filled /><span>{label.name}</span><span>{labels.data?.selected_label_ids.includes(label.id) ? "已保存" : "选择"}</span>
            </button>)}
            {!filtered.length ? <p className="muted">{labels.data?.labels.length ? "没有匹配的已有标签。" : "尚无已保存标签，可手动输入或让 AI 推荐。"}</p> : null}
          </div>
          {selection ? <div className="mr-label-confirm" data-mail-label-remove-confirm={selection.mode === "remove" ? "true" : undefined}>
            <span>{selection.mode === "remove" ? "从对方移除" : "为对方添加"}「{selectedName}」？</span>
            <button type="button" className="btn ghost sm" data-mail-label-confirm disabled={disabled} onClick={() => void confirm()}>
              {labels.saving ? "保存中…" : selection.mode === "remove" ? "确认移除" : "确认添加"}
            </button>
            <button type="button" className="btn ghost sm" disabled={labels.saving} onClick={() => setPending(null)}>取消</button>
          </div> : null}
        </div>
      </details>
      <div className="mr-saved-labels" data-mail-saved-labels>
        {stage ? <span className="mr-saved-label is-system" data-mail-system-label title="来自合作阶段事实，与标签保存独立">阶段 · {stage}</span> : null}
        {saved.map(label => <span className="mr-saved-label" key={label.id} data-label-tone={mailLabelTone(label.name)} data-mail-saved-label={label.id}>
          <MailIcon name="tag" filled />{label.name}
          <button type="button" className="mr-label-remove" aria-label={`移除标签 ${label.name}`} disabled={disabled}
            onClick={() => {setPending({scope, mode:"remove", id:label.id}); if (picker.current) picker.current.open = true;}}><MailIcon name="close" /></button>
        </span>)}
      </div>
    </div>
    {labels.loading ? <p className="muted" role="status">正在读取此邮箱标签…</p> : null}
    {labels.error ? <p className="error mr-label-error" role="alert" data-mail-label-error>{labels.error}<button type="button" className="btn ghost sm" disabled={labels.loading || labels.saving} onClick={() => void labels.reload()}>重新读取</button></p> : null}
    {labels.notice ? <p className="muted" role="status" data-mail-label-notice>{labels.notice}</p> : null}
  </section>;
}
