import { useRef, useState } from "react";
import type { MailConversation } from "../types";
import type { useMailLabels } from "../useMailLabels";
import { MailIcon, mailLabelTone } from "./MailIcon";

import type { MailLabelSuggestion } from "../labelSuggestionTypes.js";
export type MailLabelCandidate = MailLabelSuggestion;
export function MailLabelEditor({ actorId, mailbox, conversation, stage, labels,
  candidates = [], recommending = false, recommendationError = "", onRecommend, onAdopt,
}: {
  actorId: string; mailbox: string; conversation: MailConversation | null; stage: string;
  labels: ReturnType<typeof useMailLabels>;
  candidates?: MailLabelCandidate[]; recommending?: boolean; recommendationError?: string;
  onRecommend?: () => void; onAdopt?: (candidate: MailLabelCandidate) => Promise<boolean>;
}) {
  const scope = `${actorId}\0${mailbox}\0${conversation?.conversation_id || ""}`;
  const [query, setQuery] = useState("");
  const picker = useRef<HTMLDetailsElement>(null);
  const [pending, setPending] = useState<{scope: string; mode: "add" | "remove" | "adopt"; id?: string; candidate?: MailLabelCandidate} | null>(null);
  const [adopting, setAdopting] = useState(false);
  const saved = labels.data?.labels.filter(label => labels.data?.selected_label_ids.includes(label.id)) || [];
  const selection = pending?.scope === scope ? pending : null;
  const selectedName = selection?.candidate?.name || labels.data?.labels.find(label => label.id === selection?.id)?.name || "";
  const disabled = labels.loading || labels.saving || adopting || !labels.data || !conversation;
  const filtered = labels.data?.labels.filter(label => label.name.toLowerCase().includes(query.trim().toLowerCase())) || [];
  const confirm = async () => {
    if (!selection || disabled) return;
    if (selection.mode === "adopt" && selection.candidate) {
      setAdopting(true);
      try { if (await onAdopt?.(selection.candidate)) {setPending(null); if (picker.current) picker.current.open = false;} } finally { setAdopting(false); }
    } else if (selection.id && await labels.mutate({mode: selection.mode as "add" | "remove", label_id: selection.id})) {setPending(null); if (picker.current) picker.current.open = false;}
  };
  return <section className="mr-label-editor" aria-label="会话标签" data-mail-label-editor data-mail-label-object={conversation?.conversation_id || ""}>
    <div className="mail-label-toolbar">
      <details ref={picker} className="mail-label-picker" key={scope}>
        <summary aria-label="选择会话标签" title="选择标签，不输入新名称" data-mail-label-picker><MailIcon name="tag" />标签</summary>
        <div className="mail-label-panel mail-label-picker-panel">
          <p className="muted">仅自己可见 · 当前会话</p>
          <input type="search" aria-label="筛选已有标签" data-mail-label-search placeholder="查找已有标签" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="mail-label-options" role="group" aria-label="已有标签">
            {filtered.map(label => <button type="button" key={label.id} className="mail-label-option" data-mail-label-option={label.id}
              data-label-tone={mailLabelTone(label.name)} disabled={disabled} aria-pressed={labels.data?.selected_label_ids.includes(label.id)}
              onClick={() => setPending({scope, mode: labels.data?.selected_label_ids.includes(label.id) ? "remove" : "add", id: label.id})}>
              <MailIcon name="tag" filled /><span>{label.name}</span><span>{labels.data?.selected_label_ids.includes(label.id) ? "已保存" : "选择"}</span>
            </button>)}
            {!filtered.length ? <p className="muted">{labels.data?.labels.length ? "没有匹配的已有标签。" : "尚无已保存标签，可让 AI 推荐。"}</p> : null}
          </div>
          <button type="button" className="mail-label-recommend" data-mail-label-recommend disabled={disabled || recommending || !onRecommend} onClick={onRecommend}>
            <MailIcon name="spark" />{recommending ? "AI 正在依据当前会话推荐…" : "让 AI 推荐标签"}
          </button>
          {candidates.length ? <div className="mail-label-candidates" data-mail-label-candidates>
            <p className="muted">AI 候选 · 未保存</p>
            {candidates.map(candidate => <button type="button" className="mail-label-candidate" key={candidate.name} data-mail-label-candidate={candidate.name}
              disabled={disabled} data-label-tone={mailLabelTone(candidate.name)} onClick={() => setPending({scope, mode:"adopt", candidate})}>
              <span><MailIcon name="tag" filled />{candidate.name}</span><small>{candidate.reason}</small><small>点选后确认采纳</small>
            </button>)}
          </div> : null}
          {recommendationError ? <p className="error" role="alert" data-mail-label-recommend-error>{recommendationError}</p> : null}
          {selection ? <div className="mr-label-confirm" data-mail-label-remove-confirm={selection.mode === "remove" ? "true" : undefined}>
            <span>{selection.mode === "remove" ? "从此会话移除" : selection.mode === "adopt" ? "采纳 AI 推荐" : "为此会话添加"}「{selectedName}」？</span>
            <button type="button" className="btn ghost sm" data-mail-label-confirm disabled={disabled} onClick={() => void confirm()}>
              {adopting || labels.saving ? "保存中…" : selection.mode === "remove" ? "确认移除" : selection.mode === "adopt" ? "确认采纳" : "确认添加"}
            </button>
            <button type="button" className="btn ghost sm" disabled={labels.saving || adopting} onClick={() => setPending(null)}>取消</button>
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
