import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDismissable } from "../useDismissable";
import type { MailBoxBinding } from "../types";

/**
 * Top-level mailbox switcher: the collapsed chip names the current mailbox once,
 * by its full address; every other mailbox (and its label) lives behind ▾.
 */
export function MailboxSwitcher({
  current,
  bindings,
  syncing,
  onSelect,
  onSync,
}: {
  current: string;
  bindings: MailBoxBinding[];
  syncing: boolean;
  onSelect: (binding: MailBoxBinding) => void;
  onSync: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismissable(open, () => setOpen(false), ref);
  const active = bindings.find((row) => row.mailbox === current) || bindings[0];
  return (
    <div className="mail-switcher" ref={ref} data-mail-boxbar>
      <button
        type="button"
        className="mail-switcher-current"
        data-mail-box-current
        aria-expanded={open}
        aria-label={`当前邮箱 ${active?.mailbox || "未绑定"}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={"mail-box-dot" + (active?.error ? " is-error" : " is-ok")} aria-hidden="true" />
        <span className="mail-switcher-addr">{active?.mailbox || "选择邮箱"}</span>
        <span className="mail-switcher-caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="mail-switcher-menu" data-mail-box-menu>
          <p className="muted mail-switcher-title">切换邮箱</p>
          {bindings.map((binding) => (
            <button
              key={binding.mailbox}
              type="button"
              className={"mail-switcher-option" + (binding.mailbox === current ? " is-active" : "")}
              data-mail-box-option={binding.mailbox}
              onClick={() => {
                onSelect(binding);
                setOpen(false);
              }}
            >
              <span className={"mail-box-dot" + (binding.error ? " is-error" : " is-ok")} aria-hidden="true" />
              <span className="mail-switcher-option-main">
                <strong>{binding.label || binding.mailbox}</strong>
                <span className="muted">{binding.mailbox}</span>
              </span>
              {binding.unread > 0 ? <span className="mail-count-pill">{binding.unread}</span> : null}
            </button>
          ))}
          <div className="mail-switcher-foot">
            <Link className="btn ghost" to="/settings?tab=starry" data-mail-addbox>＋ 添加邮箱</Link>
            <Link className="btn ghost" to="/settings?tab=starry" data-mail-boxsettings>⚙ 邮箱设置</Link>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="btn work"
        data-mail-sync
        data-mail-entry="sync-mailbox-mail"
        disabled={syncing}
        onClick={onSync}
      >
        {syncing ? "正在收取…" : "收取"}
      </button>
    </div>
  );
}
