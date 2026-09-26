import { Link, useLocation } from "react-router-dom";
import type { Account } from "../api";
import { accountDisplayName, accountInitial, accountRoleLabel } from "../labels";
import { isAdminAccount } from "../viewMode";
import { useAccount } from "./AuthGate";

// 描边路径取自 Lucide（ISC）24×24 源，与侧栏导航同一绘制口径（18px、stroke 1.85、currentColor）；
// 管理端盾牌复用仓库既有盾形（与管理导航同源）。本组件自给自足，不依赖其它图标模块。
const ICON_EMPLOYEE = "M12 3a5 5 0 0 1 0 10 5 5 0 0 1 0-10 M20 21a8 8 0 0 0-16 0";
const ICON_ADMIN = "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z";
const ICON_SETTINGS =
  "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915 M15 12a3 3 0 0 1-6 0 3 3 0 0 1 6 0";
const ICON_LOGOUT = "M16 17l5-5-5-5 M21 12H9 M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4";

function Ico({ path }: { path: string }) {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 账户块：身份（头像 / 姓名 / 角色）+ 员工端⇄管理端切换 + 个人设置 + 退出登录。
 * 三件事都是常驻控件，不用弹窗；员工端侧栏脚与管理端导航脚共用本组件。
 */
export default function AccountBar({ account: accountProp }: { account?: Account | null }) {
  const { account: sessionAccount, logout } = useAccount();
  const loc = useLocation();
  const me = accountProp ?? sessionAccount;
  const adminAvailable = isAdminAccount(me);
  const name = accountDisplayName(me);
  const role = accountRoleLabel(me);
  const onAdmin = loc.pathname === "/admin" || loc.pathname.startsWith("/admin/");

  return (
    <div className="account-bar" data-account-bar>
      <div
        className="account-identity account-pedestal"
        data-account-pedestal
        data-exam={me?.exam_passed === false ? "blocked" : "ok"}
      >
        <span className="account-avatar" aria-hidden>{accountInitial(me)}</span>
        <span className="account-copy sidebar-label">
          <span className="account-name" data-account-name>{name}</span>
          <span className="account-role" data-account-role>{role}</span>
        </span>
      </div>
      <div className="account-actions">
        {adminAvailable && (
          <nav className="surface-switch" aria-label="工作界面" data-surface-switch-group>
            <Link
              to="/"
              className="surface-switch-seg"
              data-surface-switch="employee"
              aria-current={onAdmin ? undefined : "page"}
              title="员工端"
            >
              <Ico path={ICON_EMPLOYEE} />
              <span className="sr-only">员工端</span>
            </Link>
            <Link
              to="/admin"
              className="surface-switch-seg"
              data-surface-switch="admin"
              aria-current={onAdmin ? "page" : undefined}
              title="管理端"
            >
              <Ico path={ICON_ADMIN} />
              <span className="sr-only">管理端</span>
            </Link>
          </nav>
        )}
        {adminAvailable && <span className="account-actions-split" aria-hidden />}
        <Link className="account-icon-btn" to="/settings" data-account-settings aria-label="个人设置" title="个人设置">
          <Ico path={ICON_SETTINGS} />
        </Link>
        <button
          type="button"
          className="account-icon-btn"
          data-account-logout
          aria-label="退出登录"
          title="退出登录"
          onClick={() => void logout()}
        >
          <Ico path={ICON_LOGOUT} />
        </button>
      </div>
    </div>
  );
}
