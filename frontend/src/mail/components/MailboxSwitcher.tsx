import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { MailBoxBinding } from "../types";

/** Inline mailbox navigation; folding never changes the selected data scope. */
export function MailboxSwitcher({ current, bindings, syncing, onSelect, onSync, showSync = true }: {
  current: string;
  bindings: MailBoxBinding[];
  syncing: boolean;
  onSelect: (binding: MailBoxBinding) => void;
  onSync: () => void;
  showSync?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const address = current || "选择邮箱";
  return (
    <div className="mail-switcher mr-mailboxes" data-mail-boxbar onKeyDown={event => {
      if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); }
    }}>
      <button type="button" className="mail-switcher-current" data-mail-box-current
        aria-expanded={open} aria-controls={menuId} aria-label={`当前邮箱 ${address}`} title={address}
        onClick={() => setOpen(value => !value)}>
        <span className="mail-switcher-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="mail-switcher-addr">{address}</span>
      </button>
      {open ? <div id={menuId} className="mail-switcher-menu" data-mail-box-menu aria-label="已绑定邮箱">
        {bindings.filter(binding => binding.bound).map(binding => <button key={binding.mailbox} type="button"
          className={"mail-switcher-option" + (binding.mailbox === current ? " is-active" : "")}
          data-mail-box-option={binding.mailbox} aria-current={binding.mailbox === current ? "true" : undefined}
          title={binding.mailbox} onClick={() => { onSelect(binding); setOpen(false); }}>
          <span className="mail-switcher-option-main">
            <span>{binding.mailbox}</span>
            {binding.label && binding.label !== binding.mailbox ? <span className="muted">{binding.label}</span> : null}
          </span>
          {binding.mailbox === current ? <span className="mr-mailbox-selected" aria-hidden="true">✓</span> : null}
        </button>)}
        <div className="mail-switcher-foot">
          <Link className="btn ghost sm" to="/settings?tab=starry" data-mail-addbox>添加邮箱</Link>
          <Link className="btn ghost sm" to="/settings?tab=starry" data-mail-boxsettings>邮箱设置</Link>
        </div>
      </div> : null}
      {showSync ? <button type="button" className="btn ghost sm" data-mail-sync data-mail-entry="sync-mailbox-mail"
        disabled={syncing} onClick={onSync}>{syncing ? "正在收取…" : "收取"}</button> : null}
    </div>
  );
}
