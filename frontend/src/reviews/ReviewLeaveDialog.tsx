import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusLock } from "../hooks/useFocusLock";

export function ReviewLeaveDialog({ open, busy, error, onStay, onDiscard, onSave }: {
  open: boolean; busy: boolean; error: string;
  onStay: () => void; onDiscard: () => void; onSave: () => void;
}) {
  const id = useId(), rootRef = useRef<HTMLDivElement>(null), initialRef = useRef<HTMLButtonElement>(null);
  useFocusLock({ open, rootRef, initialRef, onEscape: () => { if (!busy) onStay(); }, lockBody: true, restore: true });
  if (!open) return null;
  return createPortal(<div className="admin-confirm-layer">
    <div className="admin-confirm-backdrop" />
    <div className="admin-confirm" ref={rootRef} role="dialog" aria-modal="true" aria-labelledby={id} aria-busy={busy || undefined}>
      <h2 id={id}>离开前保存修改？</h2>
      <p>当前流程有未保存修改，保存成功后再返回。</p>
      {error && <p role="alert">{error}</p>}
      <div className="admin-confirm-actions">
        <button ref={initialRef} disabled={busy} onClick={onStay}>留在此页</button>
        <button disabled={busy} onClick={onDiscard}>放弃修改并返回</button>
        <button disabled={busy} onClick={onSave}>{busy ? "正在保存…" : "保存并返回"}</button>
      </div>
    </div>
  </div>, document.body);
}
