import { useState } from "react";
import { NavLink } from "react-router-dom";
import type { Account } from "../api";
import { accountChipLabel } from "../labels";
import { useViewMode } from "../viewMode";
import { useAccount } from "./AuthGate";

export default function UserMenu({ account: accountProp }: { account?: Account | null }) {
  const { account: sessionAccount, logout } = useAccount();
  const { admin, debug, setDebug } = useViewMode();
  const [open, setOpen] = useState(false);
  const me = accountProp ?? sessionAccount;
  const adminAvailable = admin || me?.available_modes?.includes("admin") === true;

  return (
    <div className="user-menu-wrap">
      <button
        type="button"
        className="user-chip"
        data-exam={me?.exam_passed === false ? "blocked" : "ok"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sidebar-label">{accountChipLabel(me)}</span>
        <span className="rail-user" aria-hidden>{me?.name?.slice(0, 1) || "我"}</span>
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
