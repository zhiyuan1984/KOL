import { useState } from "react";
import { NavLink } from "react-router-dom";
import type { Account } from "../api";
import { accountDisplayName, accountInitial, accountRoleLabel } from "../labels";
import { useViewMode } from "../viewMode";
import { useAccount } from "./AuthGate";

export default function UserMenu({ account: accountProp }: { account?: Account | null }) {
  const { account: sessionAccount, logout } = useAccount();
  const { admin, debug, setDebug } = useViewMode();
  const [open, setOpen] = useState(false);
  const me = accountProp ?? sessionAccount;
  const adminAvailable = admin || me?.available_modes?.includes("admin") === true;
  const name = accountDisplayName(me);
  const role = accountRoleLabel(me);

  return (
    <div className="user-menu-wrap">
      <button
        type="button"
        className="user-chip account-pedestal"
        data-account-pedestal
        data-exam={me?.exam_passed === false ? "blocked" : "ok"}
        aria-expanded={open}
        aria-label={`${name} · ${role}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="account-avatar" aria-hidden>{accountInitial(me)}</span>
        <span className="account-copy sidebar-label">
          <span className="account-name" data-account-name>{name}</span>
          <span className="account-role" data-account-role>{role}</span>
        </span>
        <span className="account-more sidebar-label" aria-hidden>⋯</span>
      </button>
      {open && (
        <div className="menu-popover user-popover">
          <NavLink to="/" end onClick={() => setOpen(false)}>员工工作台</NavLink>
          {adminAvailable && <NavLink to="/admin" onClick={() => setOpen(false)}>管理控制台</NavLink>}
          {adminAvailable && (
            <button
              type="button"
              data-debug-toggle
              onClick={() => {
                setDebug(!debug);
                setOpen(false);
              }}
            >
              {debug ? "关闭调试视图" : "打开调试视图"}
            </button>
          )}
          <NavLink to="/settings" onClick={() => setOpen(false)}>个人设置</NavLink>
          <button type="button" onClick={() => void logout()}>退出登录</button>
        </div>
      )}
    </div>
  );
}
