import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useFocusLock } from "../../hooks/useFocusLock";
import { ConnectorMark } from "./ConnectorMark";
import { ConnectorToolsReadOnlyList } from "./ConnectorToolsCard";
import { connectorHref, type ConnectorCardView } from "./entity";

/**
 * Hub-side tools drawer: the read-only tool catalog of one MCP server.
 * Same list component as the detail card and the setup wizard — there is only
 * one tool-catalog implementation, and none of them writes grants or scopes.
 */
export function ConnectorToolsDrawer({ card, onClose }: {
  card: ConnectorCardView;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusLock({ open: true, rootRef: panelRef, onEscape: onClose, lockBody: true, restore: true });
  const [requestKey, setRequestKey] = useState(0);

  return createPortal(
    <div className="connector-drawer-layer" data-connector-tools-drawer>
      <div className="connector-drawer-backdrop" onClick={onClose} />
      <aside ref={panelRef} className="connector-drawer" role="dialog" aria-modal="true" aria-label={`${card.label} · 工具`}>
        <header className="connector-drawer-head">
          <div className="connector-drawer-title">
            <ConnectorMark id={card.id} label={card.label} iconUrl={card.iconUrl} />
            <div>
              <h2>{card.label} · 工具</h2>
              <p className="muted" data-connector-drawer-counts>该连接器暴露的工具清单（只读）。</p>
            </div>
          </div>
          <div className="connector-drawer-actions">
            <button type="button" className="btn sm" data-connector-drawer-discover onClick={() => setRequestKey((value) => value + 1)}>
              重新发现
            </button>
            <button type="button" className="icon-btn" aria-label="关闭" data-connector-drawer-close onClick={onClose}>
              <svg viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </header>

        <div className="connector-drawer-body">
          <p className="muted connector-drawer-note">清单只读；工具是否可用由平台校验与技能挂载决定。授权只对技能。</p>
          <ConnectorToolsReadOnlyList connectorId={card.id} requestKey={requestKey} filterable />
          <p className="muted">
            需要改动连接信息或做验证，请前往 <Link to={connectorHref(card.id)}>连接器详情</Link>。
          </p>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
